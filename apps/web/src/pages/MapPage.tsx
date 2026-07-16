import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { getScoreTheme } from '../scoring';
import QuickView from '../components/QuickView';
import StackPicker from '../components/StackPicker';
import CitySearch from '../components/CitySearch';
import type { CityEntry } from '../components/CitySearch';
import type { Restaurant } from '../types';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
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
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [stack, setStack] = useState<Restaurant[] | null>(null);
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
    byId.current = new Map(index.restaurants.map((r) => [r.id, r]));
    dataRef.current = toFeatureCollection(index.restaurants);
    for (const id of ['restaurants', 'restaurants-fine']) {
      const src = mapRef.current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(dataRef.current);
    }
    // Restore the quick view that was open before navigating away
    if (savedView.selectedId) {
      setSelected(byId.current.get(savedView.selectedId) ?? null);
    }
  }, [index]);

  // Remember selection (and clear it when closed) across navigation
  useEffect(() => {
    savedView.selectedId = selected?.id ?? null;
  }, [selected]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
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
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }),
      'top-right'
    );

    map.on('load', () => {
      // Two cluster passes over the same data:
      // - coarse (z < 14): regional rollups — held one zoom longer than the
      //   old z13 handoff so expanding a city cluster doesn't flood the view
      //   with hundreds of loose dots at once
      // - fine (z ≥ 14): merges dots that would visually collide, so
      //   side-by-side storefronts group until zoom separates them; groups
      //   that no zoom can separate (same address) open a picker on tap.
      map.addSource('restaurants', {
        type: 'geojson',
        data: dataRef.current,
        cluster: true,
        clusterRadius: 52,
        clusterMaxZoom: 13,
      });
      map.addSource('restaurants-fine', {
        type: 'geojson',
        data: dataRef.current,
        maxzoom: 20, // must exceed clusterMaxZoom or expansion zoom saturates
        cluster: true,
        clusterRadius: 30,
        clusterMaxZoom: 19,
      });

      // Cluster bubbles — neutral slate (green is reserved for the rating
      // scale), sized by how many restaurants they hold
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'restaurants',
        maxzoom: 14,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#334155',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 15, 25, 20, 100, 26, 500, 34],
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'restaurants',
        maxzoom: 14,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['step', ['get', 'point_count'], 12, 100, 14],
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Individual restaurants below z14 (rural singles) — colored by tier
      map.addLayer({
        id: 'restaurant-dot',
        type: 'circle',
        source: 'restaurants',
        maxzoom: 14,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
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
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      });

      // Click a coarse cluster → zoom in to expand it
      map.on('click', 'clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        const clusterId = f.properties?.cluster_id;
        const src = map.getSource('restaurants') as maplibregl.GeoJSONSource;
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
      for (const layer of ['restaurant-dot', 'fine-dot']) {
        map.on('click', layer, (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) {
            stackRef.current(null);
            selectRef.current(byId.current.get(id) ?? null);
          }
        });
      }

      for (const layer of ['clusters', 'restaurant-dot', 'fine-dot', 'fine-cluster']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      // Tapping empty map dismisses the quick view / picker
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['clusters', 'restaurant-dot', 'fine-dot', 'fine-cluster'],
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
  }, []);

  const flyToCity = (c: CityEntry) => {
    setSelected(null);
    setStack(null);
    mapRef.current?.fitBounds(c.bounds, { padding: 70, maxZoom: 14.5, duration: 1200 });
  };

  const flyToRestaurant = (r: Restaurant) => {
    setStack(null);
    setSelected(r);
    mapRef.current?.flyTo({ center: [r.longitude, r.latitude], zoom: 16, duration: 1200 });
  };

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-container" />
      <CitySearch
        restaurants={index?.restaurants ?? []}
        onPick={flyToCity}
        onPickRestaurant={flyToRestaurant}
      />
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
        <div className="map-hint">Tap a dot for a restaurant&apos;s score · tap a cluster to zoom in</div>
      )}
    </div>
  );
}
