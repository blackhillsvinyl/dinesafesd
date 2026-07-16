import { useMemo, useRef, useState } from 'react';
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
}

export default function CitySearch({ restaurants, onPick, onPickRestaurant }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cities = useMemo(() => buildCityList(restaurants), [restaurants]);
  const searchIndex = useMemo(() => buildSearchIndex(restaurants), [restaurants]);

  const q = normalize(query);
  const cityMatches = q
    ? cities.filter((c) => normalize(c.name).includes(q)).slice(0, 3)
    : [];
  const restaurantMatches = q.length >= 2 ? searchRestaurants(searchIndex, query, 5) : [];

  const close = () => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const pick = (c: CityEntry) => {
    onPick(c);
    close();
  };

  const pickRestaurant = (r: Restaurant) => {
    onPickRestaurant(r);
    close();
  };

  return (
    <div className="city-search">
      <input
        ref={inputRef}
        className="cs-input"
        type="search"
        placeholder="Search city or restaurant…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (cityMatches[0]) pick(cityMatches[0]);
            else if (restaurantMatches[0]) pickRestaurant(restaurantMatches[0]);
          }
          if (e.key === 'Escape') close();
        }}
        aria-label="Search city or restaurant"
      />
      {open && (cityMatches.length > 0 || restaurantMatches.length > 0) && (
        <div className="cs-list" role="listbox">
          {cityMatches.map((c) => (
            <button key={c.name} className="cs-row" onClick={() => pick(c)} role="option" aria-selected={false}>
              <span className="cs-name">{c.name}</span>
              <span className="cs-count">{c.count}</span>
            </button>
          ))}
          {restaurantMatches.map((r) => (
            <button
              key={r.id}
              className="cs-row"
              onClick={() => pickRestaurant(r)}
              role="option"
              aria-selected={false}
            >
              <span
                className="cs-dot"
                style={{ background: getScoreTheme(r.latest_score).markerColor }}
              />
              <span className="cs-name">{r.name}</span>
              <span className="cs-count">{r.city}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
