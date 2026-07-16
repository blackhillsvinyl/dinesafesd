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
}

export function buildSearchIndex(restaurants: Restaurant[]): IndexedRestaurant[] {
  return restaurants.map((r) => {
    const name = normalize(r.name);
    const city = normalize(r.city ?? '');
    const address = normalize(r.address ?? '');
    return { restaurant: r, name, city, address, words: `${name} ${city}`.split(' ') };
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
 * miss of a name/city word). Results rank name matches above city/address
 * matches, with the latest score as the tiebreaker.
 */
export function searchRestaurants(
  index: IndexedRestaurant[],
  query: string,
  limit = 50
): Restaurant[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const scored: { r: Restaurant; s: number }[] = [];
  for (const e of index) {
    let s = 0;
    let ok = true;
    for (const t of tokens) {
      if (e.name.includes(t)) s += 3;
      else if (e.city.includes(t)) s += 2;
      else if (e.address.includes(t)) s += 1;
      else if (fuzzyWordHit(t, e.words)) s += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (e.name.startsWith(q)) s += 4;
    else if (e.name.includes(q)) s += 2;
    scored.push({ r: e.restaurant, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || (b.r.latest_score ?? -1) - (a.r.latest_score ?? -1))
    .slice(0, limit)
    .map((x) => x.r);
}
