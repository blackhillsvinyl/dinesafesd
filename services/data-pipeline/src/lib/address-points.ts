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
  const parts = parseStreetParts(street);
  if (!parts) return null;
  const db = load();

  const candidates = [
    [parts.num, parts.predir, parts.name, parts.type],
    [parts.num, parts.predir, parts.name, ''],
    [parts.num, '', parts.name, parts.type],
  ];
  for (const c of candidates) {
    const hit = db[c.join('|')];
    if (hit) {
      const [lat, lng, hitZip] = hit;
      // If we know the ZIP, it must agree — same street numbers repeat across towns
      if (zip && String(hitZip) !== String(zip)) continue;
      return { lat, lng, zip: String(hitZip) };
    }
  }
  return null;
}
