import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { getScoreTheme } from '../scoring';
import QuickView from '../components/QuickView';
import StackPicker from '../components/StackPicker';
import CitySearch, { buildCityList } from '../components/CitySearch';
import type { CityEntry } from '../components/CitySearch';
import { isVerifiedLocation } from '../lib/geo';
import { CATEGORY_VISUALS } from '../violationCategories';
import type { Restaurant } from '../types';

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function useDarkMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      darkQuery.addEventListener('change', cb);
      return () => darkQuery.removeEventListener('change', cb);
    },
    () => darkQuery.matches
  );
}

export interface MapFilters {
  minScore: 'all' | '90' | '95';
  noCritical: boolean;
  excluded: string[]; // violation category keys to exclude
}

const NO_FILTERS: MapFilters = { minScore: 'all', noCritical: false, excluded: [] };

function passesFilters(r: Restaurant, f: MapFilters): boolean {
  if (f.minScore !== 'all' && (r.latest_score == null || r.latest_score < Number(f.minScore)))
    return false;
  if (f.noCritical && r.has_critical_violations) return false;
  if (f.excluded.length && r.violation_categories.some((c) => f.excluded.includes(c)))
    return false;
  return true;
}
const DEFAULT_CENTER: [number, number] = [-100.0, 44.4];
// South Dakota bounding box, padded generously so towns on the state line
// (Sioux Falls, North Sioux City, Belle Fourche…) can still be centered on
// screen — the map just can't wander off to other states entirely.
const SD_BOUNDS: [[number, number], [number, number]] = [
  [-106.8, 40.9],
  [-93.7, 47.6],
];

function toFeatureCollection(restaurants: Restaurant[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: restaurants.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
      properties: {
        id: r.id,
        name: r.name,
        color: getScoreTheme(r.latest_score).markerColor,
      },
    })),
  };
}

// Cities with at most this many restaurants trade their bubble for
// individual dots at a much lower zoom — a handful of dots can't collide,
// and rural users shouldn't have to dive to z14 to see what's in town.
const SMALL_CITY_MAX = 6;
const SMALL_CITY_DOT_ZOOM = 11;

// One rollup per city (count ≥ 2) — the coarse view is city bubbles, not
// radius-based cluster blobs, so a town is always exactly one thing to tap.
// Single-restaurant towns render as the restaurant's own colored dot.
function toCityCollections(restaurants: Restaurant[]) {
  const cities = buildCityList(restaurants);
  const multi = cities.filter((c) => c.count >= 2);
  const singleCityNames = new Set(
    cities.filter((c) => c.count === 1).map((c) => c.name.toLowerCase())
  );
  const cityFC: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: multi.map((c) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [(c.bounds[0][0] + c.bounds[1][0]) / 2, (c.bounds[0][1] + c.bounds[1][1]) / 2],
      },
      properties: { city: c.name, count: c.count },
    })),
  };
  // Restaurants that aren't inside a bubbled city (single-restaurant towns
  // plus records whose city field didn't survive buildCityList's cleanup)
  const bubbled = new Set(multi.map((c) => c.name.toLowerCase()));
  const singles = restaurants.filter((r) => {
    const c = (r.city ?? '').trim().toLowerCase();
    return !bubbled.has(c) || singleCityNames.has(c);
  });
  // Small-town restaurants: shown as dots once their bubble retires (z ≥ 11)
  const smallCities = new Set(
    multi.filter((c) => c.count <= SMALL_CITY_MAX).map((c) => c.name.toLowerCase())
  );
  const smallDots = restaurants.filter((r) =>
    smallCities.has((r.city ?? '').trim().toLowerCase())
  );
  return {
    cityFC,
    singlesFC: toFeatureCollection(singles),
    smallDotsFC: toFeatureCollection(smallDots),
  };
}

// Survives SPA navigation (e.g. quick view → full report → back), so the map
// reopens exactly where the user left it instead of resetting statewide.
const savedView: {
  center: [number, number];
  zoom: number;
  selectedId: string | null;
} = { center: DEFAULT_CENTER, zoom: 6.4, selectedId: null };

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const byId = useRef<Map<string, Restaurant>>(new Map());
  const dataRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const citiesRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const singlesRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const smallDotsRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const cityBoundsRef = useRef<Map<string, CityEntry>>(new Map());
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [stack, setStack] = useState<Restaurant[] | null>(null);
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = useDarkMode();
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };
  const noticeRef = useRef(showNotice);
  noticeRef.current = showNotice;
  const selectRef = useRef(setSelected);
  selectRef.current = setSelected;
  const stackRef = useRef(setStack);
  stackRef.current = setStack;

  const { data: index } = useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
  });

  // Keep an id→restaurant lookup + current feature data. Push into the source
  // if it already exists; otherwise the map 'load' handler reads dataRef.
  useEffect(() => {
    if (!index) return;
    // Pins, city bubbles, and city bounds all come from verified locations
    // only — an unverified coordinate must never place anything on the map.
    // User filters (score / critical / category exclusions) apply on top.
    const mappable = index.restaurants
      .filter(isVerifiedLocation)
      .filter((r) => passesFilters(r, filters));
    byId.current = new Map(index.restaurants.map((r) => [r.id, r]));
    dataRef.current = toFeatureCollection(mappable);
    const { cityFC, singlesFC, smallDotsFC } = toCityCollections(mappable);
    citiesRef.current = cityFC;
    singlesRef.current = singlesFC;
    smallDotsRef.current = smallDotsFC;
    cityBoundsRef.current = new Map(
      buildCityList(mappable).map((c) => [c.name.toLowerCase(), c])
    );
    const push = (id: string, data: GeoJSON.FeatureCollection) => {
      const src = mapRef.current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
    };
    push('restaurants-fine', dataRef.current);
    push('cities', citiesRef.current);
    push('city-singles', singlesRef.current);
    push('city-small-dots', smallDotsRef.current);
    // Restore the quick view that was open before navigating away
    if (savedView.selectedId) {
      setSelected(byId.current.get(savedView.selectedId) ?? null);
    }
  }, [index, filters, dark]);

  // Remember selection (and clear it when closed) across navigation
  useEffect(() => {
    savedView.selectedId = selected?.id ?? null;
  }, [selected]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: dark ? DARK_STYLE : LIGHT_STYLE,
      center: savedView.center,
      zoom: savedView.zoom,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: SD_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Exposed for end-to-end tests (canvas layers aren't DOM-inspectable)
    (window as unknown as { __map: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      fitBoundsOptions: { maxZoom: 15 },
      showAccuracyCircle: true,
    });
    map.addControl(geolocate, 'top-right');
    // Surface geolocation failures instead of a silently dead button
    geolocate.on('error', (e: GeolocationPositionError) => {
      const msg =
        e?.code === 1
          ? 'Location permission is blocked — allow location access for this site and try again.'
          : e?.code === 3
            ? 'Locating timed out — try again.'
            : 'Could not determine your location.';
      noticeRef.current(msg);
    });
    geolocate.on('outofmaxbounds', () => {
      noticeRef.current("You're outside South Dakota — the map stays within the state.");
    });
    // Text/halo colors for our labels, tuned per basemap
    const labelInk = dark ? '#cbd5e1' : '#334155';
    const labelHalo = dark ? '#0b1120' : '#ffffff';

    map.on('load', () => {
      // Two passes over the same data:
      // - coarse (z < 14): ONE bubble per city — never a sea of cluster
      //   blobs. Tapping a city zooms to its footprint. Single-restaurant
      //   towns show as the restaurant's own colored dot. Only at statewide
      //   zoom do physically-overlapping neighbor towns merge (radius 30,
      //   through z8) so Lead/Deadwood-style pairs stay tappable.
      // - fine (z ≥ 14): merges dots that would visually collide, so
      //   side-by-side storefronts group until zoom separates them; groups
      //   that no zoom can separate (same address) open a picker on tap.
      map.addSource('cities', {
        type: 'geojson',
        data: citiesRef.current,
        cluster: true,
        clusterRadius: 30,
        clusterMaxZoom: 8,
        clusterProperties: { total: ['+', ['get', 'count']] },
      });
      map.addSource('city-singles', {
        type: 'geojson',
        data: singlesRef.current,
      });
      map.addSource('city-small-dots', {
        type: 'geojson',
        data: smallDotsRef.current,
      });
      map.addSource('restaurants-fine', {
        type: 'geojson',
        data: dataRef.current,
        maxzoom: 20, // must exceed clusterMaxZoom or expansion zoom saturates
        cluster: true,
        clusterRadius: 30,
        clusterMaxZoom: 19,
      });

      // City bubbles — neutral slate (green is reserved for the rating
      // scale), sized by how many restaurants the city holds. Small towns
      // (≤ SMALL_CITY_MAX) retire their bubble early in favor of dots.
      const notCluster: maplibregl.FilterSpecification = ['!', ['has', 'point_count']];
      const isSmallCity: maplibregl.FilterSpecification = [
        'all', notCluster, ['<=', ['get', 'count'], SMALL_CITY_MAX],
      ];
      const isLargeCity: maplibregl.FilterSpecification = [
        'all', notCluster, ['>', ['get', 'count'], SMALL_CITY_MAX],
      ];
      map.addLayer({
        id: 'city-bubble',
        type: 'circle',
        source: 'cities',
        maxzoom: 14,
        filter: isLargeCity,
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'count'], 12, 10, 15, 50, 19, 200, 25, 800, 32],
        },
      });
      map.addLayer({
        id: 'city-bubble-sm',
        type: 'circle',
        source: 'cities',
        maxzoom: SMALL_CITY_DOT_ZOOM,
        filter: isSmallCity,
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': 12,
        },
      });
      map.addLayer({
        id: 'city-count',
        type: 'symbol',
        source: 'cities',
        maxzoom: 14,
        filter: isLargeCity,
        layout: {
          'text-field': ['get', 'count'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['step', ['get', 'count'], 11, 100, 13],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'city-count-sm',
        type: 'symbol',
        source: 'cities',
        maxzoom: SMALL_CITY_DOT_ZOOM,
        filter: isSmallCity,
        layout: {
          'text-field': ['get', 'count'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
      // City name under the bubble once bubbles have separated a bit
      map.addLayer({
        id: 'city-name',
        type: 'symbol',
        source: 'cities',
        minzoom: 7,
        maxzoom: 14,
        filter: isLargeCity,
        layout: {
          'text-field': ['get', 'city'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          // Clear the bubble's radius (which steps with count), or the label
          // collides with its own bubble and gets dropped
          'text-offset': [
            'step', ['get', 'count'],
            ['literal', [0, 1.4]], 10, ['literal', [0, 1.7]], 50, ['literal', [0, 2.1]],
            200, ['literal', [0, 2.7]], 800, ['literal', [0, 3.3]],
          ],
          'text-optional': true,
        },
        paint: {
          'text-color': labelInk,
          'text-halo-color': labelHalo,
          'text-halo-width': 1.4,
        },
      });
      // Statewide-zoom merges of physically-overlapping neighbor towns
      map.addLayer({
        id: 'city-merged',
        type: 'circle',
        source: 'cities',
        maxzoom: 14,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'total'], 13, 50, 19, 200, 25, 800, 32],
        },
      });
      map.addLayer({
        id: 'city-merged-count',
        type: 'symbol',
        source: 'cities',
        maxzoom: 14,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'total'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Name label for small-town bubbles too (they retire at z11)
      map.addLayer({
        id: 'city-name-sm',
        type: 'symbol',
        source: 'cities',
        minzoom: 7,
        maxzoom: SMALL_CITY_DOT_ZOOM,
        filter: isSmallCity,
        layout: {
          'text-field': ['get', 'city'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1.4],
          'text-optional': true,
        },
        paint: {
          'text-color': labelInk,
          'text-halo-color': labelHalo,
          'text-halo-width': 1.4,
        },
      });

      // Single-restaurant towns below z14 — the restaurant's own colored dot
      map.addLayer({
        id: 'city-single-dot',
        type: 'circle',
        source: 'city-singles',
        maxzoom: 14,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // Small-town restaurants as individual dots from z11 (the fine pass
      // takes over at z14); names show so nobody has to tap blind dots
      map.addLayer({
        id: 'city-small-dot',
        type: 'circle',
        source: 'city-small-dots',
        minzoom: SMALL_CITY_DOT_ZOOM,
        maxzoom: 14,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'city-small-dot-label',
        type: 'symbol',
        source: 'city-small-dots',
        minzoom: SMALL_CITY_DOT_ZOOM + 0.5,
        maxzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: {
          'text-color': labelInk,
          'text-halo-color': labelHalo,
          'text-halo-width': 1.4,
        },
      });

      // Fine pass (z ≥ 14): singles, overlap groups, and labels
      map.addLayer({
        id: 'fine-dot',
        type: 'circle',
        source: 'restaurants-fine',
        minzoom: 14,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 7, 17, 9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'fine-cluster',
        type: 'circle',
        source: 'restaurants-fine',
        minzoom: 14,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15],
        },
      });
      map.addLayer({
        id: 'fine-cluster-count',
        type: 'symbol',
        source: 'restaurants-fine',
        minzoom: 14,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 10,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Names once zoomed in enough for points to separate — no need to tap a
      // blank dot to find out what it is. Overlap groups get one count label.
      // (City names come from the basemap at every zoom.)
      map.addLayer({
        id: 'restaurant-label',
        type: 'symbol',
        source: 'restaurants-fine',
        minzoom: 14,
        layout: {
          'text-field': [
            'case',
            ['has', 'point_count'],
            ['concat', ['get', 'point_count_abbreviated'], ' restaurants'],
            ['get', 'name'],
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: {
          'text-color': labelInk,
          'text-halo-color': labelHalo,
          'text-halo-width': 1.4,
        },
      });

      // Click a city bubble → zoom to that city's footprint
      for (const layer of ['city-bubble', 'city-bubble-sm']) {
        map.on('click', layer, (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: [layer] })[0];
          const city = String(f.properties?.city ?? '').toLowerCase();
          const entry = cityBoundsRef.current.get(city);
          if (entry) {
            selectRef.current(null);
            stackRef.current(null);
            map.fitBounds(entry.bounds, { padding: 70, maxZoom: 14.5, duration: 900 });
          }
        });
      }

      // Click a statewide merge of neighbor towns → zoom until they separate
      map.on('click', 'city-merged', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['city-merged'] })[0];
        const clusterId = f.properties?.cluster_id;
        const src = map.getSource('cities') as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
        });
      });

      // Click a fine cluster → zoom if that separates it, else picker list
      map.on('click', 'fine-cluster', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['fine-cluster'] })[0];
        const clusterId = f.properties?.cluster_id;
        const src = map.getSource('restaurants-fine') as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          // Only zoom when it would actually change the view AND split the
          // cluster — otherwise list the members.
          if (zoom <= map.getMaxZoom() && zoom > map.getZoom() + 0.05) {
            map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          } else {
            src.getClusterLeaves(clusterId, 100, 0).then((leaves) => {
              const group = leaves
                .map((l) => byId.current.get((l.properties as { id?: string })?.id ?? ''))
                .filter((r): r is Restaurant => !!r);
              if (group.length) {
                selectRef.current(null);
                stackRef.current(group);
              }
            });
          }
        });
      });

      // Click a restaurant → quick view
      for (const layer of ['city-single-dot', 'city-small-dot', 'fine-dot']) {
        map.on('click', layer, (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) {
            stackRef.current(null);
            selectRef.current(byId.current.get(id) ?? null);
          }
        });
      }

      for (const layer of ['city-bubble', 'city-bubble-sm', 'city-merged', 'city-single-dot', 'city-small-dot', 'fine-dot', 'fine-cluster']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      // Tapping empty map dismisses the quick view / picker
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['city-bubble', 'city-bubble-sm', 'city-merged', 'city-single-dot', 'city-small-dot', 'fine-dot', 'fine-cluster'],
        });
        if (hits.length === 0) {
          selectRef.current(null);
          stackRef.current(null);
        }
      });
    });

    // Remember the camera so returning from a report resumes this view
    map.on('moveend', () => {
      const c = map.getCenter();
      savedView.center = [c.lng, c.lat];
      savedView.zoom = map.getZoom();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [dark]);

  const flyToCity = (c: CityEntry) => {
    setSelected(null);
    setStack(null);
    mapRef.current?.fitBounds(c.bounds, { padding: 70, maxZoom: 14.5, duration: 1200 });
  };

  const flyToRestaurant = (r: Restaurant) => {
    setStack(null);
    setSelected(r);
    if (isVerifiedLocation(r)) {
      mapRef.current?.flyTo({ center: [r.longitude, r.latitude], zoom: 16, duration: 1200 });
    } else {
      // No trusted pin to fly to — settle for the city footprint if we have
      // one, and let the quick view carry the details.
      const entry = cityBoundsRef.current.get((r.city ?? '').trim().toLowerCase());
      if (entry) {
        mapRef.current?.fitBounds(entry.bounds, { padding: 70, maxZoom: 14.5, duration: 1200 });
      }
    }
  };

  const filtering =
    filters.minScore !== 'all' || filters.noCritical || filters.excluded.length > 0;
  const toggleCat = (key: string) =>
    setFilters((f) => ({
      ...f,
      excluded: f.excluded.includes(key)
        ? f.excluded.filter((k) => k !== key)
        : [...f.excluded, key],
    }));

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-container" />
      <CitySearch
        restaurants={index?.restaurants ?? []}
        onPick={flyToCity}
        onPickRestaurant={flyToRestaurant}
      />
      <div className="map-filters">
        <button
          className={`mf-toggle${filtering ? ' filtering' : ''}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          Filters{filtering ? ' ●' : ''}
        </button>
        {filtersOpen && (
          <div className="mf-panel" role="group" aria-label="Map filters">
            <div>
              <div className="mf-label">Minimum score</div>
              <div className="mf-chips">
                {(['all', '90', '95'] as const).map((k) => (
                  <button
                    key={k}
                    className={`filter-chip${filters.minScore === k ? ' active' : ''}`}
                    onClick={() => setFilters((f) => ({ ...f, minScore: k }))}
                  >
                    {k === 'all' ? 'Any' : `${k}+`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mf-label">Violations</div>
              <div className="mf-chips">
                <button
                  className={`filter-chip${filters.noCritical ? ' active' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, noCritical: !f.noCritical }))}
                >
                  ⚠ Hide critical
                </button>
              </div>
            </div>
            <div>
              <div className="mf-label">Hide places with…</div>
              <div className="mf-chips">
                {Object.entries(CATEGORY_VISUALS)
                  .filter(([k]) => k !== 'other')
                  .map(([key, cat]) => (
                    <button
                      key={key}
                      className={`filter-chip${filters.excluded.includes(key) ? ' active' : ''}`}
                      onClick={() => toggleCat(key)}
                    >
                      {cat.icon} {cat.label}
                    </button>
                  ))}
              </div>
            </div>
            {filtering && (
              <button className="filter-chip" onClick={() => setFilters(NO_FILTERS)}>
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>
      {notice && <div className="map-notice">{notice}</div>}
      {selected ? (
        <QuickView restaurant={selected} onClose={() => setSelected(null)} />
      ) : stack ? (
        <StackPicker
          restaurants={stack}
          onPick={(r) => {
            setStack(null);
            setSelected(r);
          }}
          onClose={() => setStack(null)}
        />
      ) : (
        <div className="map-hint">Tap a city to zoom in · tap a dot for a restaurant&apos;s score</div>
      )}
    </div>
  );
}
