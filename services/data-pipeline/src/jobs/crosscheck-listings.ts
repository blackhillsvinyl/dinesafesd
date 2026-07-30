/**
 * Listing-first validation of EVERY verified record: does a real-world
 * listing (OSM POI) for this business agree with where our pin sits?
 *
 * Name families (store numbers stripped) are matched city-wide. Chains are
 * handled by mutual-nearest assignment: each of our records pairs with a
 * listing only when they choose each other, so three Little Caesars can't
 * all grab the same node. Corrections:
 *
 *   - paired listing >300 m away, record has NO rooftop evidence of its own
 *     → snap to the listing ('address')
 *   - paired listing >300 m away but rooftop evidence supports the current
 *     pin → keep (address data beats name data)
 *   - ambiguous pairings and unpaired disagreements → docs/geo-flagged.md
 *     for the manual/agent fix cycle
 *
 * Usage: npm run crosscheck:listings   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { candidateKeys } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POINTS_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');
const FLAGGED_MD = path.resolve(moduleDir, '../../../../docs/geo-flagged.md');

const AGREE_KM = 0.3;
const VICINITY_KM = 25;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}

function normName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[\^~*=]/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(LLC|INC|CORP|LTD|LLP|THE|OF)\b\.?/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const family = (name: string) => normName(name).replace(/(\s+\d+[A-Z]?)+$/, '');

const pointDb = (
  JSON.parse(gunzipSync(readFileSync(POINTS_FILE)).toString('utf8')) as {
    entries: Record<string, [number, number, number | string]>;
  }
).entries;

interface Poi { name: string | null; lat: number; lng: number; street?: string | null; num?: string | null }

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;
  const osm = JSON.parse(gunzipSync(readFileSync(POI_FILE)).toString('utf8')) as { pois: Poi[] };

  const poisByFamily = new Map<string, Poi[]>();
  for (const p of osm.pois) {
    if (!p.name) continue;
    const f = family(p.name);
    if (f.length < 5) continue; // too generic to trust name-only
    if (!poisByFamily.has(f)) poisByFamily.set(f, []);
    poisByFamily.get(f)!.push(p);
  }

  const ver = restaurants.filter(
    (r) => r.geo_precision === 'rooftop' || r.geo_precision === 'address'
  );

  // Does the record's own address rooftop-resolve near its current pin?
  function rooftopSupports(r: Record<string, unknown>): boolean {
    const norm = normalizeStreet(String(r.address ?? ''));
    const zip = (r.zip_code as string) || null;
    for (const key of candidateKeys(norm.street)) {
      const hit = pointDb[key];
      if (!hit) continue;
      const [lat, lng, hitZip] = hit;
      if (zip && String(hitZip) && String(hitZip) !== zip) continue;
      if (kmBetween(lat, lng, Number(r.latitude), Number(r.longitude)) <= AGREE_KM) return true;
    }
    return false;
  }

  let agreed = 0;
  let snapped = 0;
  let keptRooftop = 0;
  const flags: Array<{ r: Record<string, unknown>; why: string; dist: number }> = [];

  // Group our records by family for mutual-nearest assignment
  const oursByFamily = new Map<string, Array<Record<string, unknown>>>();
  for (const r of ver) {
    const f = family(String(r.name));
    if (f.length < 5) continue;
    if (!oursByFamily.has(f)) oursByFamily.set(f, []);
    oursByFamily.get(f)!.push(r);
  }

  for (const [f, ours] of oursByFamily) {
    const pois = poisByFamily.get(f);
    if (!pois?.length) continue;

    for (const r of ours) {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      // Listings plausibly for THIS record: within vicinity of the pin
      const near = pois.filter((p) => kmBetween(p.lat, p.lng, lat, lng) <= VICINITY_KM);
      if (!near.length) continue;

      // Address-corroborated listing wins outright
      const norm = normalizeStreet(String(r.address ?? ''));
      const wantNum = norm.street.trim().match(/^(\d+)/)?.[1] ?? null;
      const addrMatch = wantNum ? near.find((p) => String(p.num ?? '') === wantNum) : undefined;

      // Otherwise mutual-nearest: the listing closest to us must also have
      // us as its closest same-family record
      let pick = addrMatch;
      if (!pick) {
        const nearest = [...near].sort(
          (a, b) => kmBetween(a.lat, a.lng, lat, lng) - kmBetween(b.lat, b.lng, lat, lng)
        )[0];
        const rivals = ours.filter((o) => o !== r);
        const mutual = rivals.every(
          (o) =>
            kmBetween(nearest.lat, nearest.lng, Number(o.latitude), Number(o.longitude)) >=
            kmBetween(nearest.lat, nearest.lng, lat, lng)
        );
        if (mutual) pick = nearest;
      }
      if (!pick) continue;

      const dist = kmBetween(pick.lat, pick.lng, lat, lng);
      if (dist <= AGREE_KM) {
        agreed++;
        continue;
      }
      // Listing disagrees. Address evidence for the current pin?
      if (rooftopSupports(r)) {
        keptRooftop++;
        continue;
      }
      if (addrMatch || ours.length === 1) {
        // Unambiguous: single store in the area, or the listing carries our
        // exact house number — snap to the listing
        store.upsertRestaurant({
          external_id: String(r.id),
          name: String(r.name),
          address: String(r.address),
          city: String(r.city),
          state: 'SD',
          zip_code: (r.zip_code as string) ?? null,
          phone: (r.phone as string) ?? null,
          latitude: pick.lat,
          longitude: pick.lng,
          source: String(r.source),
          geo_precision: 'address',
          source_address: (r.source_address as string) ?? null,
        });
        snapped++;
        console.log(
          `snap ${dist.toFixed(2).padStart(6)}km  ${String(r.name).slice(0, 32).padEnd(34)} ${String(r.address).slice(0, 30).padEnd(32)} ${r.city}`
        );
      } else {
        flags.push({ r, why: `listing ${dist.toFixed(1)}km away, chain ambiguity`, dist });
      }
    }
  }

  const { restaurantsWritten } = store.save();
  console.log(
    `\nlisting cross-check: agreed ${agreed}   snapped ${snapped}   kept (rooftop-backed) ${keptRooftop}   flagged ${flags.length}   written ${restaurantsWritten}`
  );

  flags.sort((a, b) => b.dist - a.dist);
  const lines = [
    '# Listing cross-check flags',
    '',
    'Verified records whose real-world listing disagrees with the pin but',
    'automation could not resolve unambiguously. Work these manually or via',
    'a research pass.',
    '',
    '| Name | Address | City | Pin | Why |',
    '|---|---|---|---|---|',
    ...flags.map(
      ({ r, why }) =>
        `| ${r.name} | ${r.address} | ${r.city} | ${Number(r.latitude).toFixed(5)},${Number(r.longitude).toFixed(5)} | ${why} |`
    ),
  ];
  writeFileSync(FLAGGED_MD, lines.join('\n') + '\n');
  console.log(`flags: docs/geo-flagged.md (${flags.length})`);
}

main();
