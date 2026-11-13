import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { getScoreTheme, TIERS, SCORE_BANDS, NO_SCORE_THEME } from '../scoring';
import QuickView from '../components/QuickView';
import StackPicker from '../components/StackPicker';
import CitySearch, { buildCityList } from '../components/CitySearch';
import type { CityEntry, CitySearchHandle } from '../components/CitySearch';
import { isMappable, isVerifiedLocation } from '../lib/geo';
import { CATEGORY_VISUALS } from '../violationCategories';
import { isFavorite, favoriteCount, useSavedVersion } from '../lib/saved';
import { useEffectiveDark } from '../lib/theme';
import { HOME_INTRO, STATIC_META } from '../lib/meta';
import { CRITICAL_FILTER_NOTE } from '../lib/inspection';
import { usePageMeta } from '../lib/usePageMeta';
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
    `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" aria-hidden="true" focusable="false" style="display:block;cursor:pointer">` +
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

type Panel = 'none' | 'filters' | 'legend' | 'list';

const INTRO_KEY = 'dinesafe:intro-hidden';
const LIST_LIMIT = 50;
// Individual dots get a focusable stand-in only while there are few enough
// in view to be useful; beyond this, rings and the list cover the same ground.
const MAX_DOT_PROXIES = 150;

function introHidden(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

let legendShown = false;

const [INTRO_LEAD, ...INTRO_REST] = HOME_INTRO.split('. ');

export default function MapPage() {
  usePageMeta(STATIC_META['/']);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  const byId = useRef<Map<string, Restaurant>>(new Map());
  const mappableRef = useRef<Restaurant[]>([]);
  const dataRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const cityBoundsRef = useRef<Map<string, CityEntry>>(new Map());
  const searchRef = useRef<CitySearchHandle>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [stack, setStack] = useState<Restaurant[] | null>(null);
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  // First-time visitors on a wide screen get the legend open once; it is
  // not reopened on every return to the map.
  const [panel, setPanel] = useState<Panel>(() => {
    const open = !legendShown && window.innerWidth >= 900 && !introHidden();
    legendShown = true;
    return open ? 'legend' : 'none';
  });
  const [searching, setSearching] = useState(false);
  const [showIntro, setShowIntro] = useState(() => !introHidden());
  const [shownCount, setShownCount] = useState<number | null>(null);
  const [inView, setInView] = useState<Restaurant[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = useEffectiveDark();
  const savedVersion = useSavedVersion();
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  };
  const noticeRef = useRef(showNotice);
  noticeRef.current = showNotice;
  const selectRef = useRef(setSelected);
  selectRef.current = setSelected;
  const stackRef = useRef(setStack);
  stackRef.current = setStack;
  const panelRef = useRef(panel);
  panelRef.current = panel;

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

  // Text alternative to the map: the restaurants inside the current view
  const refreshInView = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setInView(
      mappableRef.current
        .filter((r) => b.contains([r.longitude, r.latitude]))
        .sort((x, y) => x.name.localeCompare(y.name))
    );
  };
  const refreshInViewRef = useRef(refreshInView);
  refreshInViewRef.current = refreshInView;

  // Keep an id→restaurant lookup + current feature data. Push into the source
  // if it already exists; otherwise the map 'load' handler reads dataRef.
  useEffect(() => {
    if (!index) return;
    // Pins, city bubbles, and city bounds all come from verified locations
    // only — an unverified coordinate must never place anything on the map.
    // User filters (score / critical / category exclusions) apply on top.
    const mappable = index.restaurants
      .filter(isMappable)
      .filter((r) => passesFilters(r, filters));
    byId.current = new Map(index.restaurants.map((r) => [r.id, r]));
    mappableRef.current = mappable;
    setShownCount(mappable.length);
    dataRef.current = toFeatureCollection(mappable);
    cityBoundsRef.current = new Map(
      buildCityList(mappable).map((c) => [c.name.toLowerCase(), c])
    );
    syncSources(mapRef.current);
    if (panelRef.current === 'list') refreshInView();
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
    map.getCanvas().setAttribute(
      'aria-label',
      'Map of South Dakota restaurants. Arrow keys pan, plus and minus zoom.'
    );
    // Zoom buttons sit bottom-right so the search and filter bar owns the top
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    // The control draws the location dot; its icon-only button is hidden in
    // CSS and replaced by the labeled "Near me" button in the toolbar.
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      fitBoundsOptions: { maxZoom: 15 },
      showAccuracyCircle: true,
    });
    map.addControl(geolocate, 'bottom-right');
    geolocateRef.current = geolocate;
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

    map.on('load', () => {
      // The dark basemap draws place names in mid-gray at 10px on near-black.
      // Same style, same fonts — just enough ink to read them.
      if (dark) {
        for (const layer of map.getStyle().layers ?? []) {
          if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
          const place = layer.id.startsWith('place_');
          map.setPaintProperty(layer.id, 'text-color', place ? '#d5dde8' : '#9fb0c6');
          map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(5, 10, 20, 0.9)');
          map.setPaintProperty(layer.id, 'text-halo-width', 1.4);
          if (place && typeof layer.layout['text-size'] === 'number') {
            map.setLayoutProperty(layer.id, 'text-size', layer.layout['text-size'] + 2);
          }
        }
      }

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
      const labelInk = dark ? '#f1f5f9' : '#1e293b';
      const labelHalo = dark ? '#050a14' : '#ffffff';

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
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: {
          'text-color': labelInk,
          'text-halo-color': labelHalo,
          'text-halo-width': 1.8,
        },
      });

      // Rings (clusters) and dots are exposed as named DOM buttons. Rings are
      // drawn by their DOM element; dots are drawn on the canvas with an
      // invisible button on top. All of them share ONE tab stop: Tab reaches
      // the group, arrow keys move between markers in view.
      interface Marker {
        marker: maplibregl.Marker;
        el: HTMLElement;
        lngLat: [number, number];
        activate: (viaKeyboard: boolean) => void;
      }
      const pool = new Map<string, Marker>();
      let rovingKey: string | null = null;
      let focusAfterMove = false;
      const src = () => map.getSource('restaurants-fine') as maplibregl.GeoJSONSource;

      const onScreen = (lngLat: [number, number]) => {
        const p = map.project(lngLat);
        const c = map.getContainer();
        return p.x >= 0 && p.y >= 0 && p.x <= c.clientWidth && p.y <= c.clientHeight;
      };
      // Reading order: rows top to bottom, left to right within a row
      const orderedKeys = () =>
        [...pool.entries()]
          .filter(([, m]) => onScreen(m.lngLat))
          .map(([key, m]) => ({ key, p: map.project(m.lngLat) }))
          .sort((a, b) => Math.round(a.p.y / 56) - Math.round(b.p.y / 56) || a.p.x - b.p.x)
          .map((x) => x.key);
      const syncRoving = () => {
        const keys = orderedKeys();
        if (!rovingKey || !keys.includes(rovingKey)) rovingKey = keys[0] ?? null;
        const visible = new Set(keys);
        for (const [key, m] of pool) {
          m.el.tabIndex = key === rovingKey ? 0 : -1;
          // Markers outside the view are neither focusable nor announced
          if (visible.has(key)) m.el.removeAttribute('aria-hidden');
          else m.el.setAttribute('aria-hidden', 'true');
        }
      };
      const addMarker = (
        key: string,
        el: HTMLElement,
        lngLat: [number, number],
        label: string,
        activate: (viaKeyboard: boolean) => void
      ) => {
        el.classList.add('map-marker-btn');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', label);
        el.tabIndex = -1;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activate(false);
        });
        el.addEventListener('focus', () => {
          rovingKey = key;
        });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            activate(true);
            return;
          }
          const step =
            ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
              ? 1
              : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
                ? -1
                : 0;
          if (!step && ev.key !== 'Home' && ev.key !== 'End') return;
          ev.preventDefault();
          ev.stopPropagation(); // don't also pan the map
          const keys = orderedKeys();
          if (!keys.length) return;
          const at = keys.indexOf(key);
          const next =
            ev.key === 'Home'
              ? keys[0]
              : ev.key === 'End'
                ? keys[keys.length - 1]
                : keys[(at + step + keys.length) % keys.length];
          rovingKey = next;
          syncRoving();
          pool.get(next)?.el.focus();
        });
        const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        // addTo() only fills in a generic label when none is set; make sure
        // ours survives regardless of library version.
        el.setAttribute('aria-label', label);
        pool.set(key, { marker, el, lngLat, activate });
      };

      const clusterClick = (clusterId: number, coords: [number, number], viaKeyboard: boolean) => {
        src()
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (zoom <= map.getMaxZoom() && zoom > map.getZoom() + 0.05) {
              focusAfterMove = viaKeyboard;
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
        const seen = new Set<string>();
        for (const f of feats) {
          const props = f.properties as Record<string, number>;
          const id = props.cluster_id;
          const key = `c:${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!pool.has(key)) {
            const total = props.point_count;
            const counts = [props.t0, props.t1, props.t2, props.t3, props.t4, props.t5].map(
              (c) => c || 0
            );
            const el = donutElement(counts, total, dark);
            const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
            // The name starts with the text drawn in the ring ("1.1k") so
            // speech-input users can say what they see.
            const shown = total >= 1000 ? `${(total / 1000).toFixed(1)}k (${total.toLocaleString()})` : String(total);
            addMarker(key, el, coords, `${shown} restaurants. Activate to zoom in.`, (viaKeyboard) => {
              openerRef.current = el;
              clusterClick(id, coords, viaKeyboard);
            });
            // Name the area once we know it: the most common city in the ring
            src()
              .getClusterLeaves(id, 25, 0)
              .then((leaves) => {
                const tally = new Map<string, number>();
                for (const l of leaves) {
                  const city = byId.current.get((l.properties as { id?: string })?.id ?? '')?.city;
                  if (city) tally.set(city, (tally.get(city) ?? 0) + 1);
                }
                const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
                if (top) {
                  el.setAttribute(
                    'aria-label',
                    `${shown} restaurants ${tally.size > 1 ? 'around' : 'in'} ${top}. Activate to zoom in.`
                  );
                }
              })
              .catch(() => {});
          }
        }
        for (const [key, m] of pool) {
          if (key.startsWith('c:') && !seen.has(key)) {
            m.marker.remove();
            pool.delete(key);
          }
        }
      };
      // Runs when the map settles, not per frame: which dots are in view only
      // changes with the camera or the data.
      const updateDotMarkers = () => {
        if (!map.getSource('restaurants-fine')) return;
        const feats = map.querySourceFeatures('restaurants-fine', {
          filter: ['!', ['has', 'point_count']],
        } as never);
        const ids = new Set<string>();
        for (const f of feats) {
          const id = (f.properties as { id?: string }).id;
          if (id) ids.add(id);
        }
        const seen = new Set<string>();
        if (ids.size <= MAX_DOT_PROXIES) {
          for (const id of ids) {
            const r = byId.current.get(id);
            if (!r) continue;
            const key = `p:${id}`;
            seen.add(key);
            if (pool.has(key)) continue;
            const el = document.createElement('div');
            el.className = 'dot-proxy';
            const score =
              r.latest_score != null ? `Score ${r.latest_score} out of 100` : 'No score published';
            addMarker(key, el, [r.longitude, r.latitude], `${r.name}, ${r.city}. ${score}.`, () => {
              focusAfterMove = false;
              openerRef.current = el;
              stackRef.current(null);
              selectRef.current(r);
            });
          }
        }
        for (const [key, m] of pool) {
          if (key.startsWith('p:') && !seen.has(key)) {
            m.marker.remove();
            pool.delete(key);
          }
        }
      };
      map.on('render', updateClusterMarkers);
      map.on('idle', () => {
        updateDotMarkers();
        syncRoving();
        // A ring was opened from the keyboard and no longer exists; hand
        // focus to the marker nearest the middle of the new view — unless
        // the user has already moved on (opened a card, tabbed elsewhere).
        const active = document.activeElement;
        const focusIsOurs =
          !active || active === document.body || map.getContainer().contains(active);
        if (focusAfterMove && !focusIsOurs) focusAfterMove = false;
        if (focusAfterMove) {
          focusAfterMove = false;
          const c = map.getContainer();
          const mid = { x: c.clientWidth / 2, y: c.clientHeight / 2 };
          let best: string | null = null;
          let bestD = Infinity;
          for (const key of orderedKeys()) {
            const p = map.project(pool.get(key)!.lngLat);
            const d = (p.x - mid.x) ** 2 + (p.y - mid.y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = key;
            }
          }
          if (best) {
            rovingKey = best;
            syncRoving();
            pool.get(best)!.el.focus();
          } else {
            map.getCanvas().focus();
          }
        }
      });
      map.on('remove', () => {
        for (const m of pool.values()) m.marker.remove();
        pool.clear();
      });

      // Click a restaurant → quick view (pointer fallback when a dot has no
      // DOM stand-in because too many are in view)
      map.on('click', 'fine-dot', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) {
          openerRef.current = null;
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
      if (panelRef.current === 'list') refreshInViewRef.current();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      geolocateRef.current = null;
    };
  }, [dark]);

  const flyToCity = (c: CityEntry) => {
    setSelected(null);
    setStack(null);
    mapRef.current?.fitBounds(c.bounds, { padding: 70, maxZoom: 14.5, duration: 1200 });
  };

  const flyToRestaurant = (r: Restaurant) => {
    openerRef.current = null;
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
  const activeFilterCount =
    (filters.minScore !== 'all' ? 1 : 0) +
    (filters.noCritical ? 1 : 0) +
    (filters.favoritesOnly ? 1 : 0) +
    filters.excluded.length;
  const toggleCat = (key: string) =>
    setFilters((f) => ({
      ...f,
      excluded: f.excluded.includes(key)
        ? f.excluded.filter((k) => k !== key)
        : [...f.excluded, key],
    }));

  const togglePanel = (p: Panel) => {
    const next = panel === p ? 'none' : p;
    if (next === 'list') refreshInView();
    setPanel(next);
  };
  const closePanel = (restoreFocus: boolean) => {
    const was = panel;
    setPanel('none');
    if (restoreFocus) triggerRefs.current[was]?.focus();
  };

  // Close the card and, if focus was inside it, send focus back to whatever
  // opened it (a marker, the list button, or the search box).
  const closeCard = (viaKeyboard = false) => {
    const card = document.querySelector('.quickview');
    const hadFocus = viaKeyboard || (!!card && card.contains(document.activeElement));
    setSelected(null);
    setStack(null);
    if (!hadFocus) return;
    const opener = openerRef.current;
    requestAnimationFrame(() => {
      if (opener && opener.isConnected) opener.focus();
      else mapRef.current?.getCanvas().focus();
    });
  };

  const refreshed = index ? format(new Date(index.updated_at), 'MMM d, yyyy') : null;
  const panelButton = (p: Exclude<Panel, 'none'>, label: string) => (
    <button
      type="button"
      ref={(el) => {
        triggerRefs.current[p] = el;
      }}
      className={`map-btn${panel === p ? ' open' : ''}${p === 'filters' && filtering ? ' filtering' : ''}`}
      onClick={() => togglePanel(p)}
      aria-expanded={panel === p}
      aria-controls={`map-panel-${p}`}
    >
      {label}
    </button>
  );

  return (
    <div className="map-page">
      <h1 className="sr-only">South Dakota restaurant health inspection map</h1>
      {showIntro && (
        <div className="map-intro">
          <p>
            <strong>{INTRO_LEAD}.</strong> {INTRO_REST.join('. ')}
          </p>
          <button
            type="button"
            className="intro-hide"
            onClick={() => {
              setShowIntro(false);
              try {
                localStorage.setItem(INTRO_KEY, '1');
              } catch {
                /* not stored — it will show again next visit */
              }
            }}
          >
            Hide<span className="sr-only"> introduction</span>
          </button>
        </div>
      )}
      <div
        className="map-wrap"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // Close whatever holds focus first; otherwise the card, then a panel
          const inPanel = !!(e.target as HTMLElement).closest?.('.map-panel');
          if (inPanel && panel !== 'none') closePanel(true);
          else if (selected || stack) closeCard(true);
          else if (panel !== 'none') closePanel(true);
        }}
      >
        <div className={`map-toolbar${searching ? ' searching' : ''}`}>
          <CitySearch
            ref={searchRef}
            restaurants={index?.restaurants ?? []}
            onPick={flyToCity}
            onPickRestaurant={flyToRestaurant}
            onOpenChange={(open) => {
              setSearching(open);
              if (open) setPanel('none');
            }}
          />
          <div className="map-actions">
            {panelButton('filters', activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters')}
            <button
              type="button"
              className="map-btn"
              onClick={() => {
                setPanel('none');
                if (!geolocateRef.current?.trigger()) {
                  showNotice('Location isn’t available in this browser.');
                }
              }}
            >
              <svg className="map-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Near me
            </button>
            {panelButton('legend', 'Legend')}
            {panelButton('list', 'List')}
          </div>

          {panel === 'filters' && (
            <div className="map-panel" id="map-panel-filters" role="group" aria-label="Map filters">
              <div role="group" aria-labelledby="mf-score">
                <div className="mf-label" id="mf-score">Minimum score</div>
                <div className="mf-chips">
                  {(['all', '90', '95'] as const).map((k) => (
                    <button
                      type="button"
                      key={k}
                      className={`filter-chip${filters.minScore === k ? ' active' : ''}`}
                      aria-pressed={filters.minScore === k}
                      onClick={() => setFilters((f) => ({ ...f, minScore: k }))}
                    >
                      {k === 'all' ? 'Any' : `${k}+`}
                    </button>
                  ))}
                </div>
              </div>
              <div role="group" aria-labelledby="mf-saved">
                <div className="mf-label" id="mf-saved">Saved on this device</div>
                <div className="mf-chips">
                  <button
                    type="button"
                    className={`filter-chip${filters.favoritesOnly ? ' active' : ''}`}
                    aria-pressed={filters.favoritesOnly}
                    onClick={() => setFilters((f) => ({ ...f, favoritesOnly: !f.favoritesOnly }))}
                  >
                    <span aria-hidden="true">♥</span>Favorites only
                    {favoriteCount() > 0 ? ` (${favoriteCount()})` : ''}
                  </button>
                </div>
              </div>
              <div role="group" aria-labelledby="mf-crit">
                <div className="mf-label" id="mf-crit">Latest inspection</div>
                <div className="mf-chips">
                  <button
                    type="button"
                    className={`filter-chip${filters.noCritical ? ' active' : ''}`}
                    aria-pressed={filters.noCritical}
                    onClick={() => setFilters((f) => ({ ...f, noCritical: !f.noCritical }))}
                  >
                    <span aria-hidden="true">⚠</span>Hide places with critical violations
                  </button>
                </div>
                <p className="legend-note">{CRITICAL_FILTER_NOTE}</p>
              </div>
              <div role="group" aria-labelledby="mf-cats">
                <div className="mf-label" id="mf-cats">Hide places with violations for…</div>
                <div className="mf-chips">
                  {Object.entries(CATEGORY_VISUALS)
                    .filter(([k]) => k !== 'other')
                    .map(([key, cat]) => (
                      <button
                        type="button"
                        key={key}
                        className={`filter-chip${filters.excluded.includes(key) ? ' active' : ''}`}
                        aria-pressed={filters.excluded.includes(key)}
                        onClick={() => toggleCat(key)}
                      >
                        <span aria-hidden="true">{cat.icon}</span>
                        {cat.label}
                      </button>
                    ))}
                </div>
              </div>
              <div className="panel-foot">
                {filtering && (
                  <button type="button" className="filter-chip" onClick={() => setFilters(NO_FILTERS)}>
                    Reset filters
                  </button>
                )}
                <button type="button" className="filter-chip" onClick={() => closePanel(true)}>
                  Done
                </button>
              </div>
            </div>
          )}

          {panel === 'legend' && (
            <div className="map-panel map-legend" id="map-panel-legend" role="group" aria-label="Map legend">
              <div className="mf-label">Latest inspection score, out of 100</div>
              <ul className="legend-list">
                {SCORE_BANDS.map((b) => (
                  <li key={b.range}>
                    <span className="legend-dot" style={{ background: b.theme.markerColor }} />
                    {b.range}
                  </li>
                ))}
                <li>
                  <span className="legend-dot" style={{ background: NO_SCORE_THEME.markerColor }} />
                  No score published
                </li>
              </ul>
              <p className="legend-note">
                <b>Dots</b> are single restaurants. <b>Rings</b> group nearby restaurants: the
                number is how many, and the ring colors show their mix of scores. Select a ring
                to zoom in, or a dot for details.
              </p>
              <p className="legend-note">
                Colors only echo the score. A high score can still come with violations, so
                open a restaurant to read its report. <Link to="/about">More about the data</Link>
              </p>
              {refreshed && (
                <p className="legend-note">
                  Data refreshed {refreshed}. Each restaurant shows its own inspection date.
                </p>
              )}
              <div className="panel-foot">
                <button type="button" className="filter-chip" onClick={() => closePanel(true)}>
                  Close legend
                </button>
              </div>
            </div>
          )}

          {panel === 'list' && (
            <div className="map-panel map-list" id="map-panel-list" role="group" aria-label="Restaurants in this map view">
              <div className="mf-label">
                {inView.length.toLocaleString()} restaurant{inView.length === 1 ? '' : 's'} in this view
              </div>
              {inView.length > LIST_LIMIT && (
                <p className="legend-note">
                  Showing the first {LIST_LIMIT} by name. Zoom in or search to narrow the list.
                </p>
              )}
              {inView.length === 0 && (
                <p className="legend-note">
                  No restaurants here{filtering ? ' with the current filters' : ''}. Move the map
                  or search for a city.
                </p>
              )}
              <ul className="view-list">
                {inView.slice(0, LIST_LIMIT).map((r) => {
                  const theme = getScoreTheme(r.latest_score);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="sp-row"
                        onClick={() => {
                          openerRef.current = triggerRefs.current.list ?? null;
                          setPanel('none');
                          setStack(null);
                          setSelected(r);
                        }}
                      >
                        <span className="sp-name">
                          {r.name}
                          <span className="view-city"> · {r.city}</span>
                        </span>
                        <span className="sp-score" style={{ background: theme.markerColor, color: theme.onMarker }}>
                          {r.latest_score ?? <span aria-hidden="true">—</span>}
                          <span className="sr-only">
                            {r.latest_score != null ? ' out of 100' : 'No score published'}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="panel-foot">
                <button type="button" className="filter-chip" onClick={() => closePanel(true)}>
                  Close list
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={containerRef}
          className="map-container"
          onClickCapture={() => {
            // Any click on the map closes an open dropdown panel
            if (panelRef.current !== 'none') setPanel('none');
          }}
        />

        <div className="map-notice" role="alert">
          {notice}
        </div>
        {selected ? (
          <QuickView restaurant={selected} onClose={() => closeCard()} />
        ) : stack ? (
          <StackPicker
            restaurants={stack}
            onPick={(r) => {
              setStack(null);
              setSelected(r);
            }}
            onClose={() => closeCard()}
          />
        ) : null}
        <p className={`map-status${selected || stack ? ' covered' : ''}`} role="status">
          {shownCount === null ? (
            'Loading restaurants…'
          ) : (
            <>
              {shownCount.toLocaleString()} restaurant{shownCount === 1 ? '' : 's'} on the map
              {filtering ? ' (filtered)' : ''}
              {refreshed && <span className="map-status-date"> · Data refreshed {refreshed}</span>}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
