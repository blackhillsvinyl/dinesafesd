import type { Restaurant } from '../types';

// Shared fuzzy search over the restaurant index. Queries are tokenized so
// "pizza ranch rapid" matches name + city in any order; single-character
// typos in longer words are tolerated ("peirre" still finds Pierre).

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True when b is reachable from a with at most one insert/delete/substitute,
// or one adjacent-letter swap ("peirre" → "pierre").
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (la === lb) {
    // Same length: allow one substitution (checked below) or one transposition
    let first = -1;
    let diffs = 0;
    for (let k = 0; k < la; k++) {
      if (a[k] !== b[k]) {
        if (diffs === 0) first = k;
        diffs++;
        if (diffs > 2) return false;
      }
    }
    if (diffs === 1) return true;
    return diffs === 2 && a[first] === b[first + 1] && a[first + 1] === b[first];
  }
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

export interface IndexedRestaurant {
  restaurant: Restaurant;
  name: string;
  city: string;
  address: string;
  words: string[]; // name + city words, for typo matching
  nameWords: string[];
  cityWords: string[];
  /** Name without a leading article, for "starts with" and length ranking. */
  nameKey: string;
}

export function buildSearchIndex(restaurants: Restaurant[]): IndexedRestaurant[] {
  return restaurants.map((r) => {
    const name = normalize(r.name);
    const city = normalize(r.city ?? '');
    // ZIP folded into the address text so "57701" or "410 main 57769" work
    const address = normalize(`${r.address ?? ''} ${r.zip_code ?? ''}`);
    return {
      restaurant: r,
      name,
      city,
      address,
      words: `${name} ${city}`.split(' '),
      nameWords: name.split(' '),
      cityWords: city.split(' '),
      nameKey: name.replace(/^(the|a|an) /, ''),
    };
  });
}

function fuzzyWordHit(token: string, words: string[]): boolean {
  if (token.length < 4) return false;
  return words.some(
    (w) =>
      withinOneEdit(token, w) ||
      // typo inside a prefix of a longer word ("restur" → "restaurant")
      (w.length > token.length && withinOneEdit(token, w.slice(0, token.length)))
  );
}

/**
 * Every query token must hit the name, city, or address (or be a one-typo
 * miss of a name/city word). Ranking is by how well the text matches and
 * nothing else — a whole word in the name beats the start of a word, which
 * beats a fragment inside a word, then city, address, and typo matches.
 * Ties go to the shorter name, then alphabetically. The inspection score
 * plays no part: it says nothing about which place you meant, and ranking
 * by it pushed lower-scoring matches out of short lists.
 */
export function rankRestaurants(index: IndexedRestaurant[], query: string): Restaurant[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const qKey = q.replace(/^(the|a|an) /, '');
  const scored: { e: IndexedRestaurant; s: number }[] = [];
  for (const e of index) {
    let s = 0;
    let ok = true;
    for (const t of tokens) {
      if (e.nameWords.includes(t)) s += 8;
      else if (e.nameWords.some((w) => w.startsWith(t))) s += 6;
      else if (e.name.includes(t)) s += 4;
      else if (e.cityWords.some((w) => w.startsWith(t)) || e.city.includes(t)) s += 3;
      else if (e.address.includes(t)) s += 2;
      else if (fuzzyWordHit(t, e.words)) s += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (e.nameKey.startsWith(qKey)) s += 4;
    else if (e.name.includes(q)) s += 2;
    scored.push({ e, s });
  }
  return scored
    .sort(
      (a, b) =>
        b.s - a.s ||
        a.e.nameKey.length - b.e.nameKey.length ||
        a.e.name.localeCompare(b.e.name) ||
        a.e.city.localeCompare(b.e.city)
    )
    .map((x) => x.e.restaurant);
}

export function searchRestaurants(
  index: IndexedRestaurant[],
  query: string,
  limit = 50
): Restaurant[] {
  return rankRestaurants(index, query).slice(0, limit);
}

export interface CityOption {
  /** Lower-cased key used for matching and in URLs. */
  key: string;
  name: string;
  count: number;
}

/** City filter options, biggest first. Skips address fragments that leaked into the city field. */
export function buildCityOptions(restaurants: Restaurant[], minCount = 3): CityOption[] {
  const counts = new Map<string, CityOption>();
  for (const r of restaurants) {
    const name = (r.city ?? '').trim();
    if (!name || /\d/.test(name) || name.length > 30) continue;
    const key = name.toLowerCase();
    const c = counts.get(key);
    if (c) c.count++;
    else counts.set(key, { key, name, count: 1 });
  }
  return [...counts.values()].filter((c) => c.count >= minCount).sort((a, b) => b.count - a.count);
}

export function inCity(r: Pick<Restaurant, 'city'>, cityKey: string): boolean {
  return (r.city ?? '').trim().toLowerCase() === cityKey;
}
