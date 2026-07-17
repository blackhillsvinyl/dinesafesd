/**
 * Import South Dakota address points from the USDOT National Address Database
 * into src/data/address-points-sd.json.gz (Tier 0 of the geocode chain).
 *
 * The NAD is public domain, aggregated from state/local/tribal governments
 * (https://www.transportation.gov/gis/national-address-database). South Dakota
 * is only partially represented — as of the 2026-06 release: Minnehaha and
 * Lincoln (the Sioux Falls metro, already covered by the City GIS extract),
 * plus Union, Todd, Mellette, Tripp, and Gregory counties. Re-run when a new
 * NAD release lands; existing entries always win on key conflicts.
 *
 * Usage: npm run import:nad   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStreetParts } from '../lib/address-points.js';

const SERVICE =
  'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/' +
  'Address_Points_from_National_Address_Database_view/FeatureServer/0/query';

// SD bounding box; State attribute filters exact membership client-side
// (attribute-only where clauses time out against the ~98M-row service).
const SD_ENVELOPE = '-104.06,42.48,-96.43,45.95';
const PAGE_SIZE = 2000;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');

const DIR_ABBR: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};

interface NadAttrs {
  Add_Number: number | string | null;
  St_PreDir: string | null;
  St_PreTyp: string | null;
  St_Name: string | null;
  St_PosTyp: string | null;
  St_PosDir: string | null;
  State: string | null;
  County: string | null;
  Zip_Code: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

function abbrevDir(dir: string | null): string {
  if (!dir) return '';
  const up = dir.trim().toUpperCase();
  return DIR_ABBR[up] ?? up;
}

/** Assemble the postal-style street line, then key it exactly like lookups do. */
function keyFor(a: NadAttrs): string | null {
  if (a.Add_Number == null || !a.St_Name) return null;
  const line = [
    String(a.Add_Number),
    abbrevDir(a.St_PreDir),
    a.St_PreTyp ?? '',
    a.St_Name,
    a.St_PosTyp ?? '',
    abbrevDir(a.St_PosDir),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = parseStreetParts(line);
  if (!parts) return null;
  return [parts.num, parts.predir, parts.name, parts.type].join('|');
}

async function fetchPage(offset: number): Promise<Array<{ attributes: NadAttrs }>> {
  const params = new URLSearchParams({
    geometry: SD_ENVELOPE,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields:
      'Add_Number,St_PreDir,St_PreTyp,St_Name,St_PosTyp,St_PosDir,State,County,Zip_Code,Latitude,Longitude',
    returnGeometry: 'false',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'OBJECTID',
    f: 'json',
  });
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${SERVICE}?${params}`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        features?: Array<{ attributes: NadAttrs }>;
        error?: unknown;
      };
      if (!data.error) return data.features ?? [];
    }
    if (attempt >= 5) throw new Error(`NAD query failed at offset ${offset} (HTTP ${resp.status})`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

async function main() {
  const existing = existsSync(DATA_FILE)
    ? (JSON.parse(gunzipSync(readFileSync(DATA_FILE)).toString('utf8')) as {
        source: string;
        extracted: string;
        note: string;
        entries: Record<string, [number, number, number | string]>;
      })
    : { source: '', extracted: '', note: 'key: HOUSENUM|PREDIR|STNAME|STTYPE -> [lat,lng,zip]', entries: {} };

  const before = Object.keys(existing.entries).length;
  let fetched = 0;
  let sd = 0;
  let added = 0;
  let kept = 0;
  let unkeyed = 0;
  const byCounty = new Map<string, number>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;
    fetched += page.length;
    for (const { attributes: a } of page) {
      if (a.State !== 'SD') continue;
      sd++;
      if (a.Latitude == null || a.Longitude == null) continue;
      const key = keyFor(a);
      if (!key) {
        unkeyed++;
        continue;
      }
      if (existing.entries[key]) {
        kept++;
        continue;
      }
      existing.entries[key] = [
        Math.round(a.Latitude * 1e7) / 1e7,
        Math.round(a.Longitude * 1e7) / 1e7,
        a.Zip_Code ?? '',
      ];
      added++;
      const county = a.County ?? '?';
      byCounty.set(county, (byCounty.get(county) ?? 0) + 1);
    }
    process.stdout.write(`\rfetched ${fetched}  sd ${sd}  added ${added}`);
  }

  existing.source =
    'City of Sioux Falls GIS (Data/Property/MapServer/0) + USDOT National Address Database (SD extract)';
  existing.extracted = new Date().toISOString().slice(0, 10);
  writeFileSync(DATA_FILE, gzipSync(JSON.stringify(existing), { level: 9 }));

  console.log(`\n\nNAD import complete:`);
  console.log(`  fetched (bbox): ${fetched}   SD records: ${sd}`);
  console.log(`  entries: ${before} -> ${Object.keys(existing.entries).length} (+${added})`);
  console.log(`  existing keys kept on conflict: ${kept}   unparseable: ${unkeyed}`);
  console.log(`  new points by county:`);
  for (const [county, n] of [...byCounty].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${county.padEnd(12)} ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
