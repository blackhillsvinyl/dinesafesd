/**
 * Repair records whose street/city split went wrong at ingest ("2200 N
 * MAPLE AVE UNIT 606 Rapid" + city "City"), using the known-city suffix
 * matcher in lib/address.ts. Repaired records that weren't verified are
 * reset to precision null so verify:locations re-places them with the
 * corrected city; verified records just get their labels fixed.
 *
 * Usage: npm run repair:cities   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import {
  MULTI_WORD_CITIES,
  isCorruptedCity,
  repairCityStreetSplit,
} from '../lib/address.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');

// Trailing words of multi-word cities — the classic "split at last space"
// failure leaves these as the whole city value.
const FRAGMENTS = new Set(
  MULTI_WORD_CITIES.flatMap((c) => {
    const words = c.split(' ');
    return words.length > 1 ? [words[words.length - 1]] : [];
  })
);

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  // Known cities: multi-word list + clean single-word cities seen in data
  const singles = new Set<string>();
  for (const r of restaurants) {
    const c = String(r.city ?? '').trim();
    if (c && !c.includes(' ') && !/\d/.test(c) && c.length <= 20 && !FRAGMENTS.has(c)) {
      singles.add(c);
    }
  }
  const knownCities = [...MULTI_WORD_CITIES, ...singles];

  let repaired = 0;
  for (const r of restaurants) {
    const city = String(r.city ?? '').trim();
    const street = String(r.address ?? '').trim();
    if (!city || (!isCorruptedCity(city) && !FRAGMENTS.has(city))) continue;

    const fix = repairCityStreetSplit(street, city, knownCities);
    if (!fix || (fix.city === city && fix.street === street)) {
      console.log(`no repair: "${street}" | "${city}"`);
      continue;
    }
    const wasVerified = r.geo_precision === 'rooftop' || r.geo_precision === 'address';
    console.log(
      `repair: "${street}" | "${city}"  ->  "${fix.street}" | "${fix.city}"` +
        (wasVerified ? '  (kept verified coords)' : '')
    );
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: fix.street,
      city: fix.city,
      state: 'SD',
      zip_code: (r.zip_code as string) ?? null,
      phone: (r.phone as string) ?? null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      source: String(r.source),
      geo_precision: wasVerified
        ? (r.geo_precision as 'rooftop' | 'address')
        : null,
      source_address: (r.source_address as string) ?? null,
    });
    repaired++;
  }

  const { restaurantsWritten } = store.save();
  console.log(`repaired: ${repaired}   files written: ${restaurantsWritten}`);
}

main();
