import { useEffect, useRef, useState } from 'react';
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
import { isFavorite, favoriteCount, useSavedVersion } from '../lib/saved';
import { useEffectiveDark } from '../lib/theme';
import type { Restaurant } from '../types';

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';

export interface MapFilters {
  minScore: 'all' | '90' | '95';
  noCritical: boolean;
  favoritesOnly: boolean;
  excluded: string[]; // violation category keys to exclude
}

const NO_FILTERS: MapFilters = {
  minScore: 'all',
  noCritical: false,
  favoritesOnly: false,
  excluded: [],
};

function passesFilters(r: Restaurant, f: MapFilters): boolean {
  if (f.minScore !== 'all' && (r.latest_score == null || r.latest_score < Number(f.minScore)))
    return false;
  if (f.noCritical && r.has_critical_violations) return false;
  if (f.favoritesOnly && !isFavorite(r.id)) return false;
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

// One uniform clustered view at every zoom: cluster counts only ever
// reflect the points inside them (viewport-true), and groups split
// progressively with each zoom step — no hard city-rollup thresholds.

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
  const cityBoundsRef = useRef<Map<string, CityEntry>>(new Map());
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [stack, setStack] = useState<Restaurant[] | null>(null);
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = useEffectiveDark();
  const savedVersion = useSavedVersion();
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

  // Push the latest feature data into every map source. Safe to call any
  // time: no-ops until the style (and thus the sources) actually exists —
  // the 'idle' listener in the map effect re-runs it after initial load, so
  // the first data arrival can never race the style and leave a source
  // empty.
  const syncSources = (map: maplibregl.Map | null) => {
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('restaurants-fine') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(dataRef.current);
  };
  const syncRef = useRef(syncSources);
  syncRef.current = syncSources;

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
    cityBoundsRef.current = new Map(
      buildCityList(mappable).map((c) => [c.name.toLowerCase(), c])
    );
    syncSources(mapRef.current);
    // Restore the quick view that was open before navigating away
    if (savedView.selectedId) {
      setSelected(byId.current.get(savedView.selectedId) ?? null);
    }
    // savedVersion: favorites-only filtering must react to heart toggles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, filters, dark, savedVersion]);

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
      // One clustered source at every zoom. Cluster counts are viewport-
      // true (a cluster only counts the points inside it) and split
      // progressively as you zoom; same-address stacks that never separate
      // open a picker on tap.
      map.addSource('restaurants-fine', {
        type: 'geojson',
        data: dataRef.current,
        maxzoom: 20, // must exceed clusterMaxZoom or expansion zoom saturates
        cluster: true,
        clusterRadius: 35,
        clusterMaxZoom: 19,
      });
      // Text/halo colors for our labels, tuned per basemap
      const labelInk = dark ? '#cbd5e1' : '#334155';
      const labelHalo = dark ? '#0b1120' : '#ffffff';

      map.addLayer({
        id: 'fine-dot',
        type: 'circle',
        source: 'restaurants-fine',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 6, 17, 9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'fine-cluster',
        type: 'circle',
        source: 'restaurants-fine',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15, 100, 20, 500, 26],
        },
      });
      map.addLayer({
        id: 'fine-cluster-count',
        type: 'symbol',
        source: 'restaurants-fine',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['step', ['get', 'point_count'], 10, 100, 12],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Names once zoomed in enough for points to separate — no need to tap
      // a blank dot to find out what it is. (City names come from the
      // basemap at every zoom.)
      map.addLayer({
        id: 'restaurant-label',
        type: 'symbol',
        source: 'restaurants-fine',
        minzoom: 13,
        filter: ['!', ['has', 'point_count']],
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
      map.on('click', 'fine-dot', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) {
          stackRef.current(null);
          selectRef.current(byId.current.get(id) ?? null);
        }
      });

      for (const layer of ['fine-dot', 'fine-cluster']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      // Tapping empty map dismisses the quick view / picker
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['fine-dot', 'fine-cluster'],
        });
        if (hits.length === 0) {
          selectRef.current(null);
          stackRef.current(null);
        }
      });
    });

    // First-load belt and suspenders: once the style settles, make sure
    // every source holds the latest data (fixes the initial-load race that
    // left the fine source empty until a filter toggle).
    map.once('idle', () => syncRef.current(map));

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
      mapRef.current?.flyTo({ center: [r.longitude, r.latitude], zoom: 17.2, duration: 1200 });
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
    filters.minScore !== 'all' ||
    filters.noCritical ||
    filters.favoritesOnly ||
    filters.excluded.length > 0;
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
              <div className="mf-label">Saved</div>
              <div className="mf-chips">
                <button
                  className={`filter-chip${filters.favoritesOnly ? ' active' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, favoritesOnly: !f.favoritesOnly }))}
                >
                  ♥ Favorites only{favoriteCount() > 0 ? ` (${favoriteCount()})` : ''}
                </button>
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
        <div className="map-hint">Tap a cluster to zoom in · tap a dot for a restaurant&apos;s score</div>
      )}
    </div>
  );
}
