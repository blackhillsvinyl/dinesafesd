/**
 * Find nominally-verified records ('rooftop'/'address') that sit more than
 * 25 km from their city's verified median — the signature of legacy
 * wrong-town geocodes ("622 MAIN ST, Britton" matched on some other town's
 * Main St). Demote them to precision null so they drop off the map and
 * re-enter the verify:locations pipeline.
 *
 * Usage: npm run demote:outliers   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const FLAG_KM = 25;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;
  const verified = restaurants.filter(
    (r) => r.geo_precision === 'rooftop' || r.geo_precision === 'address'
  );

  const byCity = new Map<string, Array<Record<string, unknown>>>();
  for (const r of verified) {
    const c = String(r.city ?? '').trim().toLowerCase();
    if (!c) continue;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c)!.push(r);
  }

  let demoted = 0;
  for (const [, members] of byCity) {
    if (members.length < 3) continue;
    const lats = members.map((m) => Number(m.latitude)).sort((a, b) => a - b);
    const lngs = members.map((m) => Number(m.longitude)).sort((a, b) => a - b);
    const aLat = lats[lats.length >> 1];
    const aLng = lngs[lngs.length >> 1];
    for (const m of members) {
      const d = kmBetween(Number(m.latitude), Number(m.longitude), aLat, aLng);
      if (d <= FLAG_KM) continue;
      console.log(
        `demote ${String(m.name)} | ${String(m.address)}, ${String(m.city)} | ${d.toFixed(1)}km | was ${String(m.geo_precision)}`
      );
      store.upsertRestaurant({
        external_id: String(m.id),
        name: String(m.name),
        address: String(m.address),
        city: String(m.city),
        state: 'SD',
        zip_code: (m.zip_code as string) ?? null,
        phone: (m.phone as string) ?? null,
        latitude: Number(m.latitude),
        longitude: Number(m.longitude),
        source: String(m.source),
        geo_precision: null,
        source_address: (m.source_address as string) ?? null,
      });
      demoted++;
    }
  }

  const { restaurantsWritten } = store.save();
  console.log(`demoted: ${demoted}   files written: ${restaurantsWritten}`);
}

main();
