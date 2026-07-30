/**
 * Detect coordinate pile-ups: 3+ verified records stacked on one point
 * (~30 m) whose addresses say they belong on different streets — the
 * signature of chain stores all matched to a single listing ("BIG D OIL CO
 * 4/8/17/22/24/42/45" all on one downtown node). Genuine complexes (food
 * court vendors at one address, Hy-Vee departments) share a street and a
 * tight house-number range and are left alone.
 *
 * Flagged members are demoted to precision null so verify:locations can
 * re-place them individually (or leave them off the map).
 *
 * Usage: npm run demote:pileups   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');

const NOISE = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST',
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'CIR', 'LN', 'CT', 'PL', 'HWY', 'WAY',
  'TRL', 'PKWY', 'TER', 'SQ', 'LOOP', 'STREET', 'AVENUE', 'DRIVE', 'ROAD', 'US', 'SD',
  // unit-ish words that survive normalizeStreet and are not street identity
  'STORE', 'ATTN', 'BLDG', 'BUILDING', 'MALL',
]);
function streetKey(address: string): string {
  return normalizeStreet(address)
    .street.toUpperCase()
    .replace(/^\d+\s*/, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t))
    .sort()
    .join(' ');
}
function houseNum(address: string): number | null {
  const m = normalizeStreet(address).street.trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;
  const ver = restaurants.filter(
    (r) => r.geo_precision === 'rooftop' || r.geo_precision === 'address'
  );

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const r of ver) {
    // ~30 m buckets
    const key = `${Math.round(Number(r.latitude) / 0.0003)}|${Math.round(Number(r.longitude) / 0.0004)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  let demoted = 0;
  for (const [, members] of groups) {
    if (members.length < 3) continue;
    const streets = new Set(members.map((m) => streetKey(String(m.address))));
    const nums = members
      .map((m) => houseNum(String(m.address)))
      .filter((n): n is number => n !== null);
    const numSpread = nums.length ? Math.max(...nums) - Math.min(...nums) : 0;
    // One street and a tight number range = one building/complex — fine.
    // Multiple distinct streets, or a wide number spread on one street,
    // stacked on a single point = someone got matched to the wrong listing.
    if (streets.size <= 1 && numSpread <= 40) continue;
    console.log(
      `pile-up @ ${Number(members[0].latitude).toFixed(5)},${Number(members[0].longitude).toFixed(5)} (${members[0].city}): ${members.length} records, ${streets.size} streets, num spread ${numSpread}`
    );
    for (const m of members) {
      console.log(`   demote ${String(m.name).slice(0, 40)} | ${String(m.address).slice(0, 34)}`);
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
