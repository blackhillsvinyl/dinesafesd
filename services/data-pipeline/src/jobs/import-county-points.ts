/**
 * Import address/parcel-situs points for the SD counties that publish public
 * ArcGIS layers (endpoints and field mappings collected from the
 * OpenAddresses us/sd source configs into src/data/county-sources.json).
 *
 * Point layers (E911 address points) come in as rooftop coordinates; parcel
 * layers come in as the parcel's centroid — for in-town lots that is within
 * meters of the building. Existing entries (Sioux Falls GIS, NAD, Pennington
 * GIS) always win on key conflicts. Entries with no ZIP in the source are
 * stored with '' — the strict lookup path skips them when the query has a
 * ZIP, but the verify job may accept them gated by a city-anchor check.
 *
 * Usage: npm run import:counties   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStreetParts } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');
const SOURCES_FILE = path.resolve(moduleDir, '../data/county-sources.json');
const PAGE_SIZE = 1000;

interface Source {
  name: string;
  url: string;
  mode: 'fields' | 'combined' | 'numPlusCombined';
  numField?: string;
  streetFields?: string[];
  combinedField?: string;
  zipField: string | null;
}

interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    x?: number;
    y?: number;
    rings?: number[][][];
  };
  centroid?: { x: number; y: number };
}

const TYPES = new Set([
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'CIR', 'LN', 'CT', 'PL', 'HWY', 'WAY',
  'TRL', 'PKWY', 'TER', 'SQ', 'LOOP', 'PASS', 'XING', 'EXPY',
  'STREET', 'AVENUE', 'BOULEVARD', 'DRIVE', 'ROAD', 'CIRCLE', 'LANE',
  'COURT', 'PLACE', 'HIGHWAY', 'TRAIL', 'PARKWAY', 'TERRACE', 'SQUARE',
]);
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

/**
 * Parcel situs strings sometimes carry a trailing town name
 * ("20853 389 AV WOLSEY"). Cut everything after the last street-type token —
 * unless what follows is a route number or a directional, which are part of
 * the street ("1600 W HWY 14", "123 MAIN ST W").
 */
function stripTrailingTown(line: string): string {
  const tokens = line.split(/\s+/).filter(Boolean);
  let lastType = -1;
  for (let i = 1; i < tokens.length; i++) {
    if (TYPES.has(tokens[i].toUpperCase())) lastType = i;
  }
  if (lastType < 0 || lastType === tokens.length - 1) return line;
  const rest = tokens.slice(lastType + 1);
  if (rest.some((t) => /^\d+$/.test(t) || DIRS.has(t.toUpperCase()))) return line;
  return tokens.slice(0, lastType + 1).join(' ');
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function buildLine(src: Source, attrs: Record<string, unknown>): string | null {
  if (src.mode === 'combined') {
    const v = str(attrs[src.combinedField!]);
    if (!v) return null;
    return stripTrailingTown(v);
  }
  if (src.mode === 'numPlusCombined') {
    const num = str(attrs[src.numField!]);
    const rest = str(attrs[src.combinedField!]).split(/\s+/);
    if (!num || rest.length < 2) return null;
    // postfixed_street: the combined field repeats the house number up front
    const street = /^\d/.test(rest[0]) ? rest.slice(1).join(' ') : rest.join(' ');
    return stripTrailingTown(`${num} ${street}`);
  }
  const num = str(attrs[src.numField!]);
  if (!num) return null;
  const street = (src.streetFields ?? []).map((f) => str(attrs[f])).join(' ');
  const line = `${num} ${street}`.replace(/\s+/g, ' ').trim();
  // Some "fields" sources put the full line in a single street field
  if (street.startsWith(num + ' ')) return stripTrailingTown(street);
  return stripTrailingTown(line);
}

function coordsOf(f: EsriFeature): { lat: number; lng: number } | null {
  if (f.centroid && Number.isFinite(f.centroid.y)) return { lat: f.centroid.y, lng: f.centroid.x };
  const g = f.geometry;
  if (!g) return null;
  if (Number.isFinite(g.x) && Number.isFinite(g.y)) return { lat: g.y!, lng: g.x! };
  if (g.rings?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of g.rings[0]) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
    if (Number.isFinite(minX)) return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
  }
  return null;
}

function inSouthDakota(lat: number, lng: number): boolean {
  return lat >= 42.4 && lat <= 46.05 && lng >= -104.15 && lng <= -96.4;
}

async function fetchPage(src: Source, offset: number): Promise<EsriFeature[] | null> {
  const outFields = [
    src.numField,
    src.combinedField,
    ...(src.streetFields ?? []),
    src.zipField,
  ]
    .filter(Boolean)
    .join(',');
  const params = new URLSearchParams({
    where: '1=1',
    outFields,
    returnGeometry: 'true',
    returnCentroid: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'json',
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const resp = await fetch(`${src.url}/query?${params}`);
      if (resp.ok) {
        const data = (await resp.json()) as { features?: EsriFeature[]; error?: unknown };
        if (!data.error) return data.features ?? [];
        // Some servers reject returnCentroid — retry without it once
        if (params.has('returnCentroid')) {
          params.delete('returnCentroid');
          continue;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  return null;
}

async function main() {
  const sources = JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) as Source[];
  const existing = JSON.parse(gunzipSync(readFileSync(DATA_FILE)).toString('utf8')) as {
    source: string;
    extracted: string;
    note: string;
    entries: Record<string, [number, number, number | string]>;
  };
  const before = Object.keys(existing.entries).length;
  const only = process.argv[2]; // optional: run a single county

  for (const src of sources) {
    if (only && src.name !== only) continue;
    let added = 0;
    let skipped = 0;
    let failed = false;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await fetchPage(src, offset);
      if (page === null) {
        failed = true;
        break;
      }
      if (page.length === 0) break;
      for (const f of page) {
        const line = buildLine(src, f.attributes);
        if (!line) { skipped++; continue; }
        const parts = parseStreetParts(line);
        if (!parts) { skipped++; continue; }
        const c = coordsOf(f);
        if (!c || !inSouthDakota(c.lat, c.lng)) { skipped++; continue; }
        const key = [parts.num, parts.predir, parts.name, parts.type].join('|');
        if (existing.entries[key]) continue;
        existing.entries[key] = [
          Math.round(c.lat * 1e7) / 1e7,
          Math.round(c.lng * 1e7) / 1e7,
          src.zipField ? str(f.attributes[src.zipField]).slice(0, 5) : '',
        ];
        added++;
      }
      if (page.length < PAGE_SIZE) break;
    }
    console.log(
      `${src.name.padEnd(14)} ${failed ? 'FAILED' : 'ok'}  +${added}  skipped ${skipped}`
    );
  }

  existing.extracted = new Date().toISOString().slice(0, 10);
  writeFileSync(DATA_FILE, gzipSync(JSON.stringify(existing), { level: 9 }));
  console.log(`\nentries: ${before} -> ${Object.keys(existing.entries).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
