import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildSearchIndex, searchRestaurants, normalize } from '../lib/search';
import { getScoreTheme } from '../scoring';
import type { Restaurant } from '../types';

export interface CityEntry {
  name: string;
  count: number;
  bounds: [[number, number], [number, number]]; // [[w,s],[e,n]]
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

// Cities and their extents come straight from the restaurant data — no
// geocoding service needed, and the zoom fits each city's actual footprint.
// Bounds are percentile-trimmed so a single mis-geocoded outlier can't
// stretch a city's box across half the state.
export function buildCityList(restaurants: Restaurant[]): CityEntry[] {
  const acc = new Map<string, { name: string; lats: number[]; lngs: number[] }>();
  for (const r of restaurants) {
    const name = (r.city ?? '').trim();
    if (!name || /\d/.test(name) || name.length > 30) continue;
    const key = name.toLowerCase();
    const c = acc.get(key);
    if (c) {
      c.lats.push(r.latitude);
      c.lngs.push(r.longitude);
    } else {
      acc.set(key, { name, lats: [r.latitude], lngs: [r.longitude] });
    }
  }

  // Fold address fragments that leaked into the city field ("ST STE B Rapid
  // City") into the real city they end with.
  for (const [key, c] of acc) {
    for (const [otherKey, other] of acc) {
      if (key !== otherKey && key.endsWith(' ' + otherKey) && other.lats.length > c.lats.length * 5) {
        other.lats.push(...c.lats);
        other.lngs.push(...c.lngs);
        acc.delete(key);
        break;
      }
    }
  }
  // Drop lone fragments that are a strict suffix of a bigger city ("Rapids")
  for (const [key, c] of acc) {
    if (c.lats.length === 1) {
      for (const [otherKey, other] of acc) {
        if (key !== otherKey && otherKey.endsWith(key) && other.lats.length > 3) {
          acc.delete(key);
          break;
        }
      }
    }
  }

  return [...acc.values()]
    .sort((a, b) => b.lats.length - a.lats.length)
    .map((c) => {
      const lats = [...c.lats].sort((x, y) => x - y);
      const lngs = [...c.lngs].sort((x, y) => x - y);
      const pad = 0.004;
      return {
        name: c.name,
        count: c.lats.length,
        bounds: [
          [percentile(lngs, 0.05) - pad, percentile(lats, 0.05) - pad],
          [percentile(lngs, 0.95) + pad, percentile(lats, 0.95) + pad],
        ] as CityEntry['bounds'],
      };
    });
}

interface Props {
  restaurants: Restaurant[];
  onPick: (city: CityEntry) => void;
  onPickRestaurant: (restaurant: Restaurant) => void;
  /** Lets the map hide competing panels while suggestions are showing. */
  onOpenChange?: (open: boolean) => void;
}

export interface CitySearchHandle {
  focus: () => void;
}

type Option =
  | { kind: 'area'; id: string; label: string; detail: string; entry: CityEntry }
  | { kind: 'restaurant'; id: string; label: string; detail: string; restaurant: Restaurant };

/**
 * Map search: an ARIA combobox over cities, ZIP codes, and restaurants.
 * Arrow keys move through suggestions, Enter picks, Escape closes.
 */
const CitySearch = forwardRef<CitySearchHandle, Props>(function CitySearch(
  { restaurants, onPick, onPickRestaurant, onOpenChange },
  handle
) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => inputRef.current?.focus() }));
  const cities = useMemo(() => buildCityList(restaurants), [restaurants]);
  const searchIndex = useMemo(() => buildSearchIndex(restaurants), [restaurants]);

  // ZIP-code areas, built from verified coordinates only
  const zips = useMemo(() => {
    const acc = new Map<string, { lats: number[]; lngs: number[] }>();
    for (const r of restaurants) {
      const zip = (r.zip_code ?? '').slice(0, 5);
      if (!/^\d{5}$/.test(zip)) continue;
      if (r.geo_precision !== 'rooftop' && r.geo_precision !== 'address') continue;
      const e = acc.get(zip);
      if (e) {
        e.lats.push(r.latitude);
        e.lngs.push(r.longitude);
      } else {
        acc.set(zip, { lats: [r.latitude], lngs: [r.longitude] });
      }
    }
    const entries: CityEntry[] = [];
    for (const [zip, e] of acc) {
      const lats = e.lats.sort((a, b) => a - b);
      const lngs = e.lngs.sort((a, b) => a - b);
      const pad = 0.004;
      entries.push({
        name: zip,
        count: lats.length,
        bounds: [
          [percentile(lngs, 0.05) - pad, percentile(lats, 0.05) - pad],
          [percentile(lngs, 0.95) + pad, percentile(lats, 0.95) + pad],
        ],
      });
    }
    return entries;
  }, [restaurants]);

  const q = normalize(query);
  const options = useMemo<Option[]>(() => {
    if (!q) return [];
    const out: Option[] = [];
    if (/^\d{3,5}$/.test(q)) {
      for (const z of zips.filter((z) => z.name.startsWith(q)).slice(0, 3)) {
        out.push({ kind: 'area', id: `zip-${z.name}`, label: `ZIP ${z.name}`, detail: `${z.count} on map`, entry: z });
      }
    }
    for (const c of cities.filter((c) => normalize(c.name).includes(q)).slice(0, 3)) {
      out.push({ kind: 'area', id: `city-${c.name}`, label: c.name, detail: `${c.count} restaurants`, entry: c });
    }
    if (q.length >= 2) {
      for (const r of searchRestaurants(searchIndex, query, 5)) {
        out.push({ kind: 'restaurant', id: `r-${r.id}`, label: r.name, detail: r.city, restaurant: r });
      }
    }
    return out;
  }, [q, query, zips, cities, searchIndex]);

  const showList = open && q.length > 0;
  const noMatches = showList && q.length >= 2 && options.length === 0;

  useEffect(() => {
    onOpenChange?.(showList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showList]);

  useEffect(() => {
    setActive(-1);
  }, [q]);

  const close = (clear: boolean) => {
    if (clear) setQuery('');
    setOpen(false);
    setActive(-1);
  };

  const pick = (o: Option) => {
    if (o.kind === 'area') onPick(o.entry);
    else onPickRestaurant(o.restaurant);
    close(true);
  };

  const optionId = (i: number) => `cs-opt-${i}`;

  return (
    <div
      className="city-search"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <div className="cs-field">
        <label className="cs-label" htmlFor="map-search">
          Search
        </label>
        <input
          ref={inputRef}
          id="map-search"
          className="cs-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="City, ZIP, or restaurant"
          value={query}
          role="combobox"
          aria-expanded={showList}
          aria-controls="cs-listbox"
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && options.length) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === 'ArrowUp' && options.length) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
            } else if (e.key === 'Enter') {
              const o = options[active >= 0 ? active : 0];
              if (o) pick(o);
            } else if (e.key === 'Escape' && (showList || query)) {
              e.stopPropagation();
              close(true);
            }
          }}
        />
      </div>
      <ul
        id="cs-listbox"
        className="cs-list"
        role="listbox"
        aria-label="Search suggestions"
        hidden={!showList || options.length === 0}
      >
        {showList &&
          options.map((o, i) => (
            <li
              key={o.id}
              id={optionId(i)}
              className={`cs-row${i === active ? ' active' : ''}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the list doesn't close mid-click
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o.kind === 'restaurant' && (
                <span
                  className="cs-dot"
                  aria-hidden="true"
                  style={{ background: getScoreTheme(o.restaurant.latest_score).markerColor }}
                />
              )}
              <span className="cs-name">{o.label}</span>
              <span className="cs-count">{o.detail}</span>
            </li>
          ))}
      </ul>
      {noMatches && (
        <div className="cs-list cs-empty">
          <p>No city, ZIP, or restaurant matches “{query.trim()}”.</p>
          <p>
            Check the spelling or try fewer words, or{' '}
            <Link to={`/search?q=${encodeURIComponent(query.trim())}`}>open full search</Link>.
          </p>
        </div>
      )}
      <span className="sr-only" role="status">
        {showList
          ? options.length
            ? `${options.length} suggestion${options.length === 1 ? '' : 's'}. Use the arrow keys to choose.`
            : noMatches
              ? 'No matches.'
              : ''
          : ''}
      </span>
    </div>
  );
});

export default CitySearch;
