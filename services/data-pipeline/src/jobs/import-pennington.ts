/**
 * Import Pennington County address points from the official Rapid City /
 * Pennington County GIS into src/data/address-points-sd.json.gz (Tier 0 of
 * the geocode chain).
 *
 * Covers all of Pennington County: Rapid City, Box Elder, Hill City,
 * Keystone, Wall, New Underwood, Wasta, Quinn, and unincorporated areas
 * (~63k points) — the largest gap in the NAD/Sioux Falls asset.
 *
 * Usage: npm run import:pennington   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStreetParts } from '../lib/address-points.js';

const SERVICE =
  'https://gis.rcgov.org/server/rest/services/PublicSites/PublicRapidMap/MapServer/7/query';
const PAGE_SIZE = 2000;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');

interface RcAttrs {
  AddressNumber: string | null;
  PrefixDir: string | null;
  StreetName: string | null;
  StreetType: string | null;
  SuffixDir: string | null;
  City: string | null;
  ZIP: string | null;
}

interface RcFeature {
  attributes: RcAttrs;
  geometry?: { x: number; y: number };
}

/** Assemble the postal-style street line, then key it exactly like lookups do. */
function keyFor(a: RcAttrs): string | null {
  if (!a.AddressNumber || !a.StreetName) return null;
  const line = [
    String(a.AddressNumber).trim(),
    (a.PrefixDir ?? '').trim(),
    a.StreetName.trim(),
    (a.StreetType ?? '').trim(),
    (a.SuffixDir ?? '').trim(),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = parseStreetParts(line);
  if (!parts) return null;
  return [parts.num, parts.predir, parts.name, parts.type].join('|');
}

async function fetchPage(offset: number): Promise<RcFeature[]> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'AddressNumber,PrefixDir,StreetName,StreetType,SuffixDir,City,ZIP',
    returnGeometry: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'OBJECTID',
    f: 'json',
  });
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${SERVICE}?${params}`);
    if (resp.ok) {
      const data = (await resp.json()) as { features?: RcFeature[]; error?: unknown };
      if (!data.error) return data.features ?? [];
    }
    if (attempt >= 5) throw new Error(`query failed at offset ${offset} (HTTP ${resp.status})`);
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
  let added = 0;
  let kept = 0;
  let unkeyed = 0;

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;
    fetched += page.length;
    for (const f of page) {
      const a = f.attributes;
      if (!f.geometry || f.geometry.x == null || f.geometry.y == null) continue;
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
        Math.round(f.geometry.y * 1e7) / 1e7,
        Math.round(f.geometry.x * 1e7) / 1e7,
        (a.ZIP ?? '').trim(),
      ];
      added++;
    }
    process.stdout.write(`\rfetched ${fetched}  added ${added}`);
  }

  existing.source =
    'City of Sioux Falls GIS + USDOT NAD (SD extract) + Rapid City/Pennington County GIS (PublicRapidMap/7)';
  existing.extracted = new Date().toISOString().slice(0, 10);
  writeFileSync(DATA_FILE, gzipSync(JSON.stringify(existing), { level: 9 }));

  console.log(`\n\nPennington import complete:`);
  console.log(`  fetched: ${fetched}`);
  console.log(`  entries: ${before} -> ${Object.keys(existing.entries).length} (+${added})`);
  console.log(`  existing keys kept on conflict: ${kept}   unparseable: ${unkeyed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
