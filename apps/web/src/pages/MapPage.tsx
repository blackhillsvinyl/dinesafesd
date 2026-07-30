import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { getScoreTheme, TIERS } from '../scoring';
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
        tier: scoreTier(r.latest_score),
      },
    })),
  };
}

// One uniform clustered view at every zoom: cluster counts only ever
// reflect the points inside them (viewport-true), and groups split
// progressively with each zoom step — no hard city-rollup thresholds.

// Score tier index for cluster aggregation: 0..3 = TIERS order (96+, 90+,
// 83+, 76+), 4 = below 76, 5 = unscored. Matches TIER_COLORS below.
function scoreTier(score: number | null): number {
  if (score == null) return 5;
  for (let i = 0; i < TIERS.length; i++) {
    if (score >= TIERS[i].min) return i;
  }
  return 5;
}
const TIER_COLORS = [...TIERS.map((t) => t.theme.markerColor), '#94a3b8'];

// SVG donut for a cluster: ring segments proportional to each score tier's
// share (best -> worst), count in the hole. Replaces the flat gray circle.
function donutElement(counts: number[], total: number, dark: boolean): HTMLDivElement {
  const r = total >= 500 ? 30 : total >= 100 ? 25 : total >= 10 ? 20 : 16;
  const ring = Math.max(5, Math.round(r * 0.3));
  const r0 = r - ring;
  const w = r * 2;
  let angle = -Math.PI / 2; // start at 12 o'clock
  const segs: string[] = [];
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue;
    const frac = counts[i] / total;
    const a0 = angle;
    const a1 = angle + frac * 2 * Math.PI;
    angle = a1;
    if (frac >= 0.999) {
      segs.push(
        `<circle cx="${r}" cy="${r}" r="${(r + r0) / 2}" fill="none" stroke="${TIER_COLORS[i]}" stroke-width="${ring}"/>`
      );
      continue;
    }
    const mid = (r + r0) / 2;
    const x0 = r + mid * Math.cos(a0);
    const y0 = r + mid * Math.sin(a0);
    const x1 = r + mid * Math.cos(a1);
    const y1 = r + mid * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    segs.push(
      `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${mid} ${mid} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${TIER_COLORS[i]}" stroke-width="${ring}"/>`
    );
  }
  const bg = dark ? '#101a2e' : '#ffffff';
  const ink = dark ? '#e2e8f0' : '#0f172a';
  const fontSize = total >= 1000 ? 11 : total >= 100 ? 12 : 12;
  const label = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
  const el = document.createElement('div');
  el.innerHTML =
    `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" style="display:block;cursor:pointer">` +
    `<circle cx="${r}" cy="${r}" r="${r0 + 1}" fill="${bg}"/>` +
    segs.join('') +
    `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-weight="700" fill="${ink}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">${label}</text>` +
    `</svg>`;
  return el;
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
      const tierCounter = (i: number): maplibregl.ExpressionSpecification =>
        ['+', ['case', ['==', ['get', 'tier'], i], 1, 0]] as unknown as maplibregl.ExpressionSpecification;
      map.addSource('restaurants-fine', {
        type: 'geojson',
        data: dataRef.current,
        maxzoom: 20, // must exceed clusterMaxZoom or expansion zoom saturates
        cluster: true,
        clusterRadius: 35,
        clusterMaxZoom: 19,
        clusterProperties: {
          t0: tierCounter(0), t1: tierCounter(1), t2: tierCounter(2),
          t3: tierCounter(3), t4: tierCounter(4), t5: tierCounter(5),
        },
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

      // Clusters render as DOM donut markers (score-tier spectrum ring).
      // Pool keyed by cluster_id; synced on every render while the source
      // has loaded tiles.
      const markerPool = new Map<number, maplibregl.Marker>();
      const src = () => map.getSource('restaurants-fine') as maplibregl.GeoJSONSource;
      const clusterClick = (clusterId: number, coords: [number, number]) => {
        src()
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (zoom <= map.getMaxZoom() && zoom > map.getZoom() + 0.05) {
              map.easeTo({ center: coords, zoom });
            } else {
              src()
                .getClusterLeaves(clusterId, 100, 0)
                .then((leaves) => {
                  const group = leaves
                    .map((l) => byId.current.get((l.properties as { id?: string })?.id ?? ''))
                    .filter((rr): rr is Restaurant => !!rr);
                  if (group.length) {
                    selectRef.current(null);
                    stackRef.current(group);
                  }
                });
            }
          });
      };
      const updateClusterMarkers = () => {
        if (!map.getSource('restaurants-fine')) return;
        const feats = map.querySourceFeatures('restaurants-fine', {
          filter: ['has', 'point_count'],
        } as never);
        const seen = new Set<number>();
        for (const f of feats) {
          const props = f.properties as Record<string, number>;
          const id = props.cluster_id;
          if (seen.has(id)) continue;
          seen.add(id);
          if (!markerPool.has(id)) {
            const total = props.point_count;
            const counts = [props.t0, props.t1, props.t2, props.t3, props.t4, props.t5].map(
              (c) => c || 0
            );
            const el = donutElement(counts, total, dark);
            const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
            el.addEventListener('click', (ev) => {
              ev.stopPropagation();
              clusterClick(id, coords);
            });
            markerPool.set(id, new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map));
          }
        }
        for (const [id, marker] of markerPool) {
          if (!seen.has(id)) {
            marker.remove();
            markerPool.delete(id);
          }
        }
      };
      map.on('render', updateClusterMarkers);
      map.on('remove', () => {
        for (const m of markerPool.values()) m.remove();
        markerPool.clear();
      });

      // Click a restaurant → quick view
      map.on('click', 'fine-dot', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) {
          stackRef.current(null);
          selectRef.current(byId.current.get(id) ?? null);
        }
      });

      map.on('mouseenter', 'fine-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'fine-dot', () => { map.getCanvas().style.cursor = ''; });

      // Tapping empty map dismisses the quick view / picker
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['fine-dot'],
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
