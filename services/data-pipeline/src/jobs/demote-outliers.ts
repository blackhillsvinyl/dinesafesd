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
import { gunzipSync } from 'node:zlib';
import { store } from '../lib/store.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');
// Rural establishments legitimately sit 25-45 km from their postal town
// (Lake Oahe resorts addressed to Pierre, Hwy 385 outposts to Deadwood).
// Every genuine wrong-town geocode found so far was 61-472 km off, so 60
// separates the two cleanly.
const FLAG_KM = 60;
const FLAG_KM_PLACE = 60;

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

  // OSM settlement locations — the reference for cities with too few
  // verified members to trust a median
  const osm = JSON.parse(gunzipSync(readFileSync(POI_FILE)).toString('utf8')) as {
    places: Array<{ name: string | null; rank: string; lat: number; lng: number }>;
  };
  const PLACE_RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };
  const placesByName = new Map<string, Array<{ rank: string; lat: number; lng: number }>>();
  for (const p of osm.places) {
    if (!p.name) continue;
    const n = p.name.toLowerCase();
    if (!placesByName.has(n)) placesByName.set(n, []);
    placesByName.get(n)!.push(p);
  }

  let demoted = 0;
  for (const [cityKey, members] of byCity) {
    let aLat: number;
    let aLng: number;
    let flagKm = FLAG_KM;
    if (members.length >= 3) {
      const lats = members.map((m) => Number(m.latitude)).sort((a, b) => a - b);
      const lngs = members.map((m) => Number(m.longitude)).sort((a, b) => a - b);
      aLat = lats[lats.length >> 1];
      aLng = lngs[lngs.length >> 1];
    } else {
      const candidates = placesByName.get(cityKey);
      if (!candidates?.length) continue;
      const pick = [...candidates].sort(
        (a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9)
      )[0];
      aLat = pick.lat;
      aLng = pick.lng;
      flagKm = FLAG_KM_PLACE;
    }
    for (const m of members) {
      const d = kmBetween(Number(m.latitude), Number(m.longitude), aLat, aLng);
      if (d <= flagKm) continue;
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
