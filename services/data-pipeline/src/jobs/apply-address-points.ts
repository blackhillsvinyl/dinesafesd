/**
 * Upgrade restaurant coordinates from the committed address-point file
 * (Tier 0) without re-running the full geocode chain. Useful after new
 * points land (e.g. a NAD import): every restaurant whose address now has
 * an authoritative rooftop point gets that point and geo_precision
 * 'rooftop'; everything else is left untouched.
 *
 * Usage: npm run apply:address-points   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { lookupAddressPoint } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  let upgraded = 0;
  let already = 0;
  const byCity = new Map<string, number>();

  let ambiguous = 0;

  for (const r of restaurants) {
    const zip = (r.zip_code as string) ?? null;
    const norm = normalizeStreet(String(r.address ?? ''));
    const hit = lookupAddressPoint(norm.street, zip);
    if (!hit) continue;

    // Without a ZIP the lookup can't tell same-numbered streets in different
    // towns apart ("614 MAIN ST" exists everywhere). Only trust a zipless hit
    // when it lands near the coordinates we already have (any tier is at
    // worst city-level, so 10 km separates "same town" from "wrong town").
    if (!zip) {
      const dLat = (hit.lat - Number(r.latitude)) * 111_000;
      const dLng = (hit.lng - Number(r.longitude)) * 79_000;
      if (Math.hypot(dLat, dLng) > 10_000) {
        ambiguous++;
        continue;
      }
    }

    const sameSpot =
      Math.abs(hit.lat - Number(r.latitude)) < 1e-7 &&
      Math.abs(hit.lng - Number(r.longitude)) < 1e-7;
    if (r.geo_precision === 'rooftop' && sameSpot) {
      already++;
      continue;
    }

    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city: String(r.city),
      state: 'SD',
      zip_code: (r.zip_code as string) ?? null,
      phone: (r.phone as string) ?? null,
      latitude: hit.lat,
      longitude: hit.lng,
      source: String(r.source),
      geo_precision: 'rooftop',
      source_address: (r.source_address as string) ?? null,
    });
    upgraded++;
    const city = String(r.city ?? '?');
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
  }

  const { restaurantsWritten } = store.save();
  console.log(`rooftop upgrades: ${upgraded}   already rooftop: ${already}   ambiguous (no ZIP, far hit — skipped): ${ambiguous}   files written: ${restaurantsWritten}`);
  const cities = [...byCity].sort((a, b) => b[1] - a[1]);
  for (const [city, n] of cities.slice(0, 15)) console.log(`  ${city.padEnd(20)} ${n}`);
  if (cities.length > 15) console.log(`  … and ${cities.length - 15} more cities`);
}

main();
