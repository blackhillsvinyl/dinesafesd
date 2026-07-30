/**
 * The DOH source publishes no ZIP codes, so restaurants carry zip_code null
 * even though the rooftop address points we placed them with know the ZIP.
 * Backfill zip_code from the matching address point — accepted only when
 * that point sits within ~200 m of the restaurant's verified coordinates,
 * so a same-street-name match in another town can't attach a wrong ZIP.
 *
 * Usage: npm run backfill:zips   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { candidateKeys } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POINTS_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');

const pointDb = (
  JSON.parse(gunzipSync(readFileSync(POINTS_FILE)).toString('utf8')) as {
    entries: Record<string, [number, number, number | string]>;
  }
).entries;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  let filled = 0;
  let already = 0;
  for (const r of restaurants) {
    if (r.zip_code) {
      already++;
      continue;
    }
    if (r.geo_precision !== 'rooftop' && r.geo_precision !== 'address') continue;
    const norm = normalizeStreet(String(r.address ?? ''));
    let zip: string | null = null;
    for (const key of candidateKeys(norm.street)) {
      const hit = pointDb[key];
      if (!hit) continue;
      const [lat, lng, hitZip] = hit;
      const z = String(hitZip).slice(0, 5);
      if (!/^\d{5}$/.test(z)) continue;
      if (kmBetween(lat, lng, Number(r.latitude), Number(r.longitude)) > 0.2) continue;
      zip = z;
      break;
    }
    if (!zip) continue;
    r.zip_code = zip; // keep the in-memory copy current for phase 2
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city: String(r.city),
      state: 'SD',
      zip_code: zip,
      phone: (r.phone as string) ?? null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      source: String(r.source),
      geo_precision: r.geo_precision as 'rooftop' | 'address',
      source_address: (r.source_address as string) ?? null,
    });
    filled++;
  }

  // Phase 2: propagate from the nearest ZIP-bearing verified neighbor within
  // 500 m — ZIP zones span whole towns, so this can't cross into a wrong one
  // at that radius.
  const donors = restaurants.filter(
    (r) => r.zip_code && (r.geo_precision === 'rooftop' || r.geo_precision === 'address')
  );
  let propagated = 0;
  for (const r of restaurants) {
    if (r.zip_code) continue;
    if (r.geo_precision !== 'rooftop' && r.geo_precision !== 'address') continue;
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    let best: { zip: string; d: number } | null = null;
    for (const d of donors) {
      const dist = kmBetween(lat, lng, Number(d.latitude), Number(d.longitude));
      if (dist <= 0.5 && (!best || dist < best.d)) {
        best = { zip: String(d.zip_code), d: dist };
      }
    }
    if (!best) continue;
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city: String(r.city),
      state: 'SD',
      zip_code: best.zip,
      phone: (r.phone as string) ?? null,
      latitude: lat,
      longitude: lng,
      source: String(r.source),
      geo_precision: r.geo_precision as 'rooftop' | 'address',
      source_address: (r.source_address as string) ?? null,
    });
    propagated++;
  }

  const { restaurantsWritten } = store.save();
  console.log(
    `zips filled: ${filled}   propagated: ${propagated}   already had: ${already}   files written: ${restaurantsWritten}`
  );
}

main();
