/**
 * Reconcile restaurants that were never validated (precision null) or sit on
 * stale 'city' fallbacks — the two classes that produce wrong-town and
 * wrong-side-of-town placements:
 *
 *   - legacy geocodes matched street names in other cities ("103 Main St,
 *     Fort Pierre" on Rapid City's Main St)
 *   - source addresses missing a cardinal ("505 5th St" that is really
 *     "505 N 5th St") land blocks away
 *
 * Fully offline: coordinates come from committed assets only (no external
 * geocoder at run time — sustained Nominatim crawls get rate-banned).
 *
 * Placement tiers, all corroborated against a per-city anchor (median of the
 * city's restaurants, or the settlement's OSM location for small towns; both
 * from src/data assets):
 *
 *   1. rooftop address point (exact)
 *   2. rooftop with inferred cardinal — when the address has no directional
 *      but exactly one N/S/E/W variant exists in the address points
 *   3. the actual listing: OSM food POI matched by name + city (skipped for
 *      chain names that repeat within the city) → 'address'
 *   4. keep existing coords if they're at least in the right area, else the
 *      city anchor with jitter → 'city' (shown as approximate in the apps)
 *
 * Usage: npm run fix:misplaced   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { lookupAddressPoint, parseStreetParts } from '../lib/address-points.js';
import type { GeoResult } from '../processors/geocoder.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');

const FLAG_KM = 20; // beyond this from the anchor, existing coords are junk
const ACCEPT_KM = 25; // candidates must land within this of the anchor

interface Poi { name: string | null; lat: number; lng: number; city: string | null }
interface Place { name: string | null; rank: string; lat: number; lng: number }

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}

/** Uppercase, drop punctuation, strip suffixes that never appear in listings. */
function normName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[\^~]/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(LLC|INC|CORP|LTD|LLP)\b\.?/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLACE_RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  const osm = JSON.parse(gunzipSync(readFileSync(POI_FILE)).toString('utf8')) as {
    pois: Poi[];
    places: Place[];
  };
  const poisByName = new Map<string, Poi[]>();
  for (const p of osm.pois) {
    if (!p.name) continue;
    const n = normName(p.name);
    if (n.length < 4) continue;
    if (!poisByName.has(n)) poisByName.set(n, []);
    poisByName.get(n)!.push(p);
  }
  const placesByName = new Map<string, Place[]>();
  for (const p of osm.places) {
    if (!p.name) continue;
    const n = p.name.toLowerCase();
    if (!placesByName.has(n)) placesByName.set(n, []);
    placesByName.get(n)!.push(p);
  }

  // Per-city anchors + duplicate-name detection (chains within one city)
  const byCity = new Map<string, Array<Record<string, unknown>>>();
  const nameCityCount = new Map<string, number>();
  for (const r of restaurants) {
    const c = String(r.city ?? '').trim().toLowerCase();
    if (c) {
      if (!byCity.has(c)) byCity.set(c, []);
      byCity.get(c)!.push(r);
    }
    const nk = `${normName(String(r.name))}|${c}`;
    nameCityCount.set(nk, (nameCityCount.get(nk) ?? 0) + 1);
  }
  const anchors = new Map<string, { lat: number; lng: number }>();
  for (const [c, members] of byCity) {
    if (members.length >= 3) {
      const lats = members.map((m) => Number(m.latitude)).sort((a, b) => a - b);
      const lngs = members.map((m) => Number(m.longitude)).sort((a, b) => a - b);
      anchors.set(c, { lat: lats[lats.length >> 1], lng: lngs[lngs.length >> 1] });
    }
  }
  function anchorFor(city: string, nearLat: number, nearLng: number) {
    const key = city.toLowerCase();
    const known = anchors.get(key);
    if (known) return known;
    const candidates = placesByName.get(key);
    if (!candidates?.length) return null;
    // Same settlement name can repeat; prefer one near the current coords,
    // else the most significant place
    const near = candidates.filter((p) => kmBetween(p.lat, p.lng, nearLat, nearLng) <= 30);
    const pick =
      near[0] ??
      [...candidates].sort(
        (a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9)
      )[0];
    return { lat: pick.lat, lng: pick.lng };
  }

  /** Tier 2: no directional in the source address — exactly one N/S/E/W
   * variant existing in the address points identifies the real street. */
  function inferredDirectionalHit(street: string, zip: string | null) {
    const parts = parseStreetParts(street);
    if (!parts || parts.predir !== '') return null;
    const rest = street.replace(/^\s*\S+\s*/, ''); // everything after the house number
    const hits: Array<{ lat: number; lng: number; zip: string }> = [];
    for (const d of ['N', 'S', 'E', 'W']) {
      const hit = lookupAddressPoint(`${parts.num} ${d} ${rest}`, zip);
      if (hit) hits.push(hit);
    }
    if (hits.length === 0) return null;
    const near = hits.every((h) => kmBetween(h.lat, h.lng, hits[0].lat, hits[0].lng) < 0.3);
    return hits.length === 1 || near ? hits[0] : null;
  }

  /** Tier 3: match the OSM listing by name. Exact normalized name, else a
   * prefix relationship ("SILVER SPUR" ↔ "Silver Spur Bar & Grill"). */
  function poiHit(name: string, anchor: { lat: number; lng: number }) {
    const clean = normName(name);
    if (clean.length < 4) return null;
    let candidates = poisByName.get(clean) ?? [];
    if (!candidates.length) {
      for (const [poiName, pois] of poisByName) {
        if (
          (poiName.startsWith(clean + ' ') || clean.startsWith(poiName + ' ')) &&
          Math.min(poiName.length, clean.length) >= 5
        ) {
          candidates = candidates.concat(pois);
        }
      }
    }
    const near = candidates.filter((p) => kmBetween(p.lat, p.lng, anchor.lat, anchor.lng) <= ACCEPT_KM);
    if (!near.length) return null;
    const agree = near.every((p) => kmBetween(p.lat, p.lng, near[0].lat, near[0].lng) < 0.3);
    return agree ? near[0] : null;
  }

  const targets = restaurants.filter((r) => {
    const p = r.geo_precision ?? null;
    return (p === null || p === 'city') && String(r.city ?? '').trim();
  });
  console.log(`targets (precision null/'city'): ${targets.length}`);

  const tiers: Record<string, number> = {};
  let done = 0;
  let kept = 0;
  for (const r of targets) {
    const city = String(r.city).trim();
    const anchor = anchorFor(city, Number(r.latitude), Number(r.longitude));
    if (!anchor) {
      kept++;
      continue;
    }
    const zip = (r.zip_code as string) ?? null;
    const norm = normalizeStreet(String(r.address ?? ''));
    const nearAnchor = (lat: number, lng: number) => kmBetween(lat, lng, anchor.lat, anchor.lng) <= ACCEPT_KM;

    let geo: GeoResult | null = null;
    let how = '';

    const rooftop = lookupAddressPoint(norm.street, zip);
    if (rooftop && nearAnchor(rooftop.lat, rooftop.lng)) {
      geo = { lat: rooftop.lat, lng: rooftop.lng, precision: 'rooftop' };
      how = 'rooftop';
    }

    if (!geo) {
      const inferred = inferredDirectionalHit(norm.street, zip);
      if (inferred && nearAnchor(inferred.lat, inferred.lng)) {
        geo = { lat: inferred.lat, lng: inferred.lng, precision: 'rooftop' };
        how = 'rooftop-inferred-dir';
      }
    }

    if (!geo) {
      const unique = (nameCityCount.get(`${normName(String(r.name))}|${city.toLowerCase()}`) ?? 0) === 1;
      if (unique) {
        const poi = poiHit(String(r.name), anchor);
        if (poi) {
          geo = { lat: poi.lat, lng: poi.lng, precision: 'address' };
          how = 'poi-name';
        }
      }
    }

    if (!geo) {
      if (kmBetween(Number(r.latitude), Number(r.longitude), anchor.lat, anchor.lng) <= FLAG_KM) {
        kept++;
        continue;
      }
      geo = {
        lat: anchor.lat + (Math.random() - 0.5) * 0.006,
        lng: anchor.lng + (Math.random() - 0.5) * 0.006,
        precision: 'city',
      };
      how = 'city-anchor';
    }

    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city,
      state: 'SD',
      zip_code: zip,
      phone: (r.phone as string) ?? null,
      latitude: geo.lat,
      longitude: geo.lng,
      source: String(r.source),
      geo_precision: geo.precision,
      source_address: (r.source_address as string) ?? null,
    });
    tiers[how] = (tiers[how] ?? 0) + 1;
    done++;
  }

  const { restaurantsWritten } = store.save();
  console.log(`repaired: ${done}   kept as-is: ${kept}   files written: ${restaurantsWritten}`);
  console.log('tiers:', JSON.stringify(tiers, null, 1));
}

main();
