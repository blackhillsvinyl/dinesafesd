/**
 * Authoritative address-point lookup (Tier 0 of the geocode chain).
 *
 * Backed by government rooftop address points committed at
 * src/data/address-points-sd.json.gz — the City of Sioux Falls GIS (83k
 * points) merged with the USDOT National Address Database SD extract
 * (jobs/import-nad.ts; adds Union, Todd, Mellette, Tripp, and Gregory
 * counties plus Minnehaha/Lincoln gap-fills). Re-run the import when a new
 * NAD release lands, then jobs/apply-address-points.ts to apply upgrades.
 */

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');

// USPS-standard street type abbreviations (already-abbreviated forms pass through)
const TYPE_ABBR: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD',
  CIRCLE: 'CIR', LANE: 'LN', COURT: 'CT', PLACE: 'PL', HIGHWAY: 'HWY',
  TRAIL: 'TRL', PARKWAY: 'PKWY', TERRACE: 'TER', SQUARE: 'SQ', WAY: 'WAY',
  LOOP: 'LOOP', PASS: 'PASS', CROSSING: 'XING', EXPRESSWAY: 'EXPY',
};
const TYPES = new Set([...Object.keys(TYPE_ABBR), ...Object.values(TYPE_ABBR)]);
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

export interface StreetParts {
  num: string;
  predir: string;
  name: string;
  type: string;
}

/** Parse "2101 W 41ST ST" → components matching the lookup key structure. */
export function parseStreetParts(street: string): StreetParts | null {
  const tokens = street.toUpperCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !/^\d+[A-Z]?$/.test(tokens[0])) return null;
  const num = tokens[0].replace(/[A-Z]$/, '');
  let i = 1;
  let predir = '';
  if (DIRS.has(tokens[i]) && tokens.length > i + 1) {
    predir = tokens[i];
    i++;
  }
  let type = '';
  let end = tokens.length;
  const last = tokens[tokens.length - 1];
  if (TYPES.has(last)) {
    type = TYPE_ABBR[last] ?? last;
    end = tokens.length - 1;
  }
  const name = tokens.slice(i, end).join(' ');
  if (!name) return null;
  return { num, predir, name, type };
}

const DIR_WORDS: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};
const ORDINAL_WORDS: Record<string, string> = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
  ELEVENTH: '11TH', TWELFTH: '12TH',
};

/**
 * Generate ordered candidate lookup keys for one street line, covering the
 * format drift between DOH source addresses and GIS address points:
 *   - directional between name and type ("CALUMET SW AVE" vs "CALUMET AVE SW")
 *   - trailing directional folded into the name by the importers
 *   - highway forms ("US 14 HWY" / "US HWY 14" / "HIGHWAY 14" / "SD HWY 14")
 *   - spelled ordinals ("SIXTH AVE" vs "6TH AVE")
 * Keys are [num, predir, name, type] joined with '|', most-specific first.
 */
export function candidateKeys(street: string): string[] {
  const rawTokens = street.toUpperCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  if (rawTokens.length < 2 || !/^\d+[A-Z]?$/.test(rawTokens[0])) return [];
  const num = rawTokens[0].replace(/[A-Z]$/, '');
  const tokens = rawTokens.slice(1).map((t) => ORDINAL_WORDS[t] ?? TYPE_ABBR[t] ?? t);
  // A spelled-out direction word is only a directional when it is NOT the
  // street's own name: "E NORTH ST" keeps NORTH (the street is North St),
  // while "NORTH MAIN ST" abbreviates to a predir. Rule: map the word only
  // when the next token exists and is not a street type.
  for (let i = 0; i < tokens.length; i++) {
    const d = DIR_WORDS[tokens[i]];
    if (d && i + 1 < tokens.length && !TYPES.has(tokens[i + 1])) tokens[i] = d;
  }

  let predir = '';
  if (tokens.length > 1 && DIRS.has(tokens[0])) predir = tokens.shift()!;
  let postdir = '';
  if (tokens.length > 1 && DIRS.has(tokens[tokens.length - 1])) postdir = tokens.pop()!;
  let type = '';
  if (tokens.length > 1 && TYPES.has(tokens[tokens.length - 1])) {
    const t = tokens.pop()!;
    type = TYPE_ABBR[t] ?? t;
  }
  let middir = '';
  if (tokens.length > 1 && DIRS.has(tokens[tokens.length - 1])) middir = tokens.pop()!;
  const name = tokens.join(' ');
  if (!name) return [];

  const combos: Array<[string, string, string]> = [];
  const push = (p: string, n: string, t: string) => combos.push([p, n.replace(/\s+/g, ' ').trim(), t]);
  const dirs = [...new Set([middir, postdir, predir].filter(Boolean))];

  // As-written first (back-compat with parseStreetParts keying)
  push(predir, `${name} ${middir}`.trim(), type);
  push(predir, name, type);
  // Directional moved: as predir, folded after the type, or dropped
  for (const d of dirs) {
    push(d, name, type);
    push(predir || d, `${name} ${type} ${d === predir ? postdir || middir || '' : d}`.trim(), '');
    push('', `${name} ${type} ${d}`.trim(), '');
  }
  push(predir, `${name} ${type} ${postdir}`.trim(), '');
  push(predir, name, '');
  push('', name, type);
  push('', name, '');

  // Highway permutations
  const hwyMatch = `${name} ${type}`.match(/\b(?:(US|SD|STATE)\s+)?(?:HWY\s+(\d+[A-Z]?)|(\d+[A-Z]?)\s+HWY)\b/);
  if (hwyMatch || (type === 'HWY' && /\d/.test(name)) || /\bHWY\b/.test(name)) {
    const route = (name + ' ' + type).match(/\b(\d+[A-Z]?)\b/)?.[1];
    if (route) {
      for (const sys of ['US', 'SD', '']) {
        const s = sys ? sys + ' ' : '';
        push(predir, `${s}HWY ${route}`, '');
        push('', `${s}HWY ${route}`, '');
        push(predir, `${s}HIGHWAY ${route}`, '');
        push('', `${s}HIGHWAY ${route}`, '');
        push(predir, `${s}${route}`, 'HWY');
        push('', `${s}${route}`, 'HWY');
        push('', `${s}${route}`, '');
      }
    }
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  const push2 = (p: string, n: string, t: string) => {
    const k = [num, p, n, t].join('|');
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  for (const [p, n, t] of combos) {
    if (!n) continue;
    push2(p, n, t);
    // Spacing drift: "LACROSSE" vs "LA CROSSE", "ST CHARLES" vs "STCHARLES"
    if (n.includes(' ')) push2(p, n.replace(/\s+/g, ''), t);
    const m = n.match(/^(LA|LE|DE|DEL|EL|MC|MAC|ST|SAN|VAN)([A-Z]{3,}.*)$/);
    if (m && !n.includes(' ')) push2(p, `${m[1]} ${m[2]}`, t);
  }
  return keys;
}

type LookupValue = [number, number, number | string]; // [lat, lng, zip]

let entries: Record<string, LookupValue> | null = null;

function load(): Record<string, LookupValue> {
  if (entries) return entries;
  if (!existsSync(DATA_FILE)) {
    entries = {};
    return entries;
  }
  const raw = JSON.parse(gunzipSync(readFileSync(DATA_FILE)).toString('utf8'));
  entries = raw.entries as Record<string, LookupValue>;
  return entries;
}

export interface PointHit {
  lat: number;
  lng: number;
  zip: string;
}

/**
 * Exact rooftop match for a street address. Tries with the parsed street
 * type, then without it (source data sometimes omits the suffix), then
 * without the directional.
 */
export function lookupAddressPoint(street: string, zip?: string | null): PointHit | null {
  const db = load();
  for (const key of candidateKeys(street)) {
    const hit = db[key];
    if (hit) {
      const [lat, lng, hitZip] = hit;
      // If we know the ZIP, it must agree — same street numbers repeat across towns
      if (zip && String(hitZip) !== String(zip)) continue;
      return { lat, lng, zip: String(hitZip) };
    }
  }
  return null;
}
