/**
 * Work the unverified-location list ('street', 'city', null precision) down
 * to zero. A record only gets upgraded when a placement passes strict
 * verification — a wrong pin is worse than no pin, and everything that stays
 * unverified stays OFF the map (the apps gate on rooftop/address).
 *
 * Tiers, all corroborated against a per-city anchor (median of the city's
 * VERIFIED restaurants, or the settlement's OSM location):
 *
 *   A  local rooftop address point, strict ZIP agreement          → 'rooftop'
 *   A2 local rooftop point whose source had no ZIP, anchor-gated  → 'rooftop'
 *   B  rooftop with inferred cardinal (unique N/S/E/W variant)    → 'rooftop'
 *   C  SD BIT CompositeGeocodeService ROOFTOP locator, score ≥85,
 *      house number + street tokens + ZIP/city re-verified        → 'rooftop'
 *   D  OSM food POI matched by unique name near the anchor        → 'address'
 *
 * Anything that fails every tier is left untouched (and unmapped) and listed
 * in docs/geo-unresolved.md for listing-level (Google/OSM) follow-up.
 *
 * Usage: npm run verify:locations   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { parseStreetParts, candidateKeys } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POINTS_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');
const UNRESOLVED_MD = path.resolve(moduleDir, '../../../../docs/geo-unresolved.md');
const UNRESOLVED_JSON = path.resolve(moduleDir, '../../../../docs/geo-unresolved.json');

const ACCEPT_KM = 25;
const GEOCODER =
  'https://arcgis.sd.gov/arcgis/rest/services/BIT/CompositeGeocodeService/GeocodeServer/findAddressCandidates';

type Entry = [number, number, number | string];
interface Poi {
  name: string | null;
  lat: number;
  lng: number;
  city: string | null;
  street?: string | null;
  num?: string | null;
}
interface Place { name: string | null; rank: string; lat: number; lng: number }

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}
function inSouthDakota(lat: number, lng: number): boolean {
  return lat >= 42.4 && lat <= 46.05 && lng >= -104.15 && lng <= -96.4;
}

const NOISE = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'CIR', 'LN', 'CT', 'PL', 'HWY', 'WAY',
  'TRL', 'PKWY', 'TER', 'SQ', 'LOOP', 'STREET', 'AVENUE', 'DRIVE', 'ROAD',
]);
function significantTokens(street: string): string[] {
  return street
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t));
}

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

// ---- local address-point lookups (strict + zip-wildcard variants) ---------

const pointDb = (
  JSON.parse(gunzipSync(readFileSync(POINTS_FILE)).toString('utf8')) as {
    entries: Record<string, Entry>;
  }
).entries;

interface Hit { lat: number; lng: number; zip: string }

function pointLookup(street: string, zip: string | null, allowEmptyZip: boolean): Hit | null {
  for (const k of candidateKeys(street)) {
    const hit = pointDb[k];
    if (!hit) continue;
    const [lat, lng, hitZip] = hit;
    const z = String(hitZip);
    if (zip && z && z !== String(zip)) continue;
    if (!z && !allowEmptyZip) continue;
    return { lat, lng, zip: z };
  }
  return null;
}

function inferredDirectionalHit(street: string, zip: string | null, allowEmptyZip: boolean): Hit | null {
  const parts = parseStreetParts(street);
  if (!parts || parts.predir !== '') return null;
  const rest = street.replace(/^\s*\S+\s*/, '');
  const hits: Hit[] = [];
  for (const d of ['N', 'S', 'E', 'W']) {
    const hit = pointLookup(`${parts.num} ${d} ${rest}`, zip, allowEmptyZip);
    if (hit) hits.push(hit);
  }
  if (hits.length === 0) return null;
  const near = hits.every((h) => kmBetween(h.lat, h.lng, hits[0].lat, hits[0].lng) < 0.3);
  return hits.length === 1 || near ? hits[0] : null;
}

// ---- state composite geocoder, strictly re-verified ------------------------

interface StateHit { lat: number; lng: number; matched: string }

async function stateRooftop(
  street: string,
  city: string,
  zip: string | null
): Promise<StateHit | null> {
  const params = new URLSearchParams({
    Street: street,
    City: city,
    ZIP: zip ?? '',
    outFields: '*',
    outSR: '4326',
    maxLocations: '5',
    f: 'json',
  });
  let data: {
    candidates?: Array<{
      address: string;
      score: number;
      location: { x: number; y: number };
      attributes: Record<string, unknown>;
    }>;
  };
  try {
    const resp = await fetch(`${GEOCODER}?${params}`);
    if (!resp.ok) return null;
    data = (await resp.json()) as typeof data;
  } catch {
    return null;
  }
  const wantParts = parseStreetParts(street);
  const wantTokens = significantTokens(street.replace(/^\d+\s*/, ''));
  for (const c of data.candidates ?? []) {
    if (!String(c.attributes.Loc_name ?? '').toUpperCase().startsWith('ROOFTOP')) continue;
    if (c.score < 85) continue;
    const [candStreet, candCity, candZip] = c.address.split(',').map((s) => s.trim());
    if (!candStreet) continue;
    const candParts = parseStreetParts(candStreet);
    // House number must agree exactly
    if (!wantParts || !candParts || wantParts.num !== candParts.num) continue;
    // Street name tokens must overlap
    const candTokens = significantTokens(candStreet.replace(/^\d+\s*/, ''));
    if (!wantTokens.length || !candTokens.some((t) => wantTokens.includes(t))) continue;
    // ZIP must agree when both sides know it
    if (zip && candZip && candZip.slice(0, 5) !== zip) continue;
    // City must agree (anchor distance is checked by the caller)
    if (candCity && city && candCity.toUpperCase() !== city.toUpperCase()) continue;
    if (!inSouthDakota(c.location.y, c.location.x)) continue;
    return { lat: c.location.y, lng: c.location.x, matched: c.address };
  }
  return null;
}

// ---- main -------------------------------------------------------------------

async function main() {
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
  // POIs that carry an OSM address — allows matching by street+number even
  // when the name doesn't line up with the license name
  const poisWithAddr = osm.pois.filter((p) => p.num && p.street);
  const placesByName = new Map<string, Place[]>();
  for (const p of osm.places) {
    if (!p.name) continue;
    const n = p.name.toLowerCase();
    if (!placesByName.has(n)) placesByName.set(n, []);
    placesByName.get(n)!.push(p);
  }
  const PLACE_RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };

  // Anchors from VERIFIED restaurants only — unverified coords must not
  // influence where we allow new placements.
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
    const near = candidates.filter((p) => kmBetween(p.lat, p.lng, nearLat, nearLng) <= 30);
    const pick =
      near[0] ??
      [...candidates].sort((a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9))[0];
    return { lat: pick.lat, lng: pick.lng };
  }

  // Duplicate names within a city (chains) can't be resolved by name alone
  const nameCityCount = new Map<string, number>();
  for (const r of restaurants) {
    const nk = `${normName(String(r.name))}|${String(r.city ?? '').trim().toLowerCase()}`;
    nameCityCount.set(nk, (nameCityCount.get(nk) ?? 0) + 1);
  }
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
    return p === null || p === 'city' || p === 'street';
  });
  console.log(`unverified targets: ${targets.length}`);

  const tiers: Record<string, number> = {};
  const unresolved: Array<Record<string, unknown>> = [];
  let done = 0;
  let sinceThrottle = 0;

  for (const r of targets) {
    const city = String(r.city ?? '').trim();
    const zip = (r.zip_code as string) || null;
    const norm = normalizeStreet(String(r.address ?? ''));
    const anchor = city ? anchorFor(city, Number(r.latitude), Number(r.longitude)) : null;
    const nearAnchor = (lat: number, lng: number) =>
      !!anchor && kmBetween(lat, lng, anchor.lat, anchor.lng) <= ACCEPT_KM;

    let geo: { lat: number; lng: number; precision: 'rooftop' | 'address' } | null = null;
    let how = '';

    // Tier A: strict local rooftop (ZIP-agreeing entries only)
    const strict = pointLookup(norm.street, zip, false);
    if (strict && inSouthDakota(strict.lat, strict.lng) && (!anchor || nearAnchor(strict.lat, strict.lng))) {
      geo = { lat: strict.lat, lng: strict.lng, precision: 'rooftop' };
      how = 'A-rooftop';
    }

    // Tier A2: entries whose source lacked a ZIP — must corroborate via anchor
    if (!geo) {
      const loose = pointLookup(norm.street, zip, true);
      if (loose && inSouthDakota(loose.lat, loose.lng) && nearAnchor(loose.lat, loose.lng)) {
        geo = { lat: loose.lat, lng: loose.lng, precision: 'rooftop' };
        how = 'A2-rooftop-nozip';
      }
    }

    // Tier B: missing cardinal — a unique N/S/E/W variant identifies the street
    if (!geo) {
      const inferred = inferredDirectionalHit(norm.street, zip, false) ??
        inferredDirectionalHit(norm.street, zip, true);
      if (inferred && inSouthDakota(inferred.lat, inferred.lng) && nearAnchor(inferred.lat, inferred.lng)) {
        geo = { lat: inferred.lat, lng: inferred.lng, precision: 'rooftop' };
        how = 'B-inferred-dir';
      }
    }

    // Tier C: state E911 rooftop locator, strictly re-verified
    if (!geo && city) {
      if (++sinceThrottle % 4 === 0) await new Promise((s) => setTimeout(s, 400));
      const hit = await stateRooftop(norm.street, city, zip);
      if (hit && (!anchor || nearAnchor(hit.lat, hit.lng))) {
        geo = { lat: hit.lat, lng: hit.lng, precision: 'rooftop' };
        how = 'C-state-rooftop';
      }
    }

    // Tier D0: OSM POI whose tagged address matches the target street+number
    if (!geo && anchor) {
      const wantParts = parseStreetParts(norm.street);
      const wantTokens = significantTokens(norm.street.replace(/^\d+\s*/, ''));
      if (wantParts && wantTokens.length) {
        const matches = poisWithAddr.filter((p) => {
          if (String(p.num).toUpperCase() !== wantParts.num) return false;
          const poiTokens = significantTokens(String(p.street));
          if (!poiTokens.some((t) => wantTokens.includes(t))) return false;
          return kmBetween(p.lat, p.lng, anchor.lat, anchor.lng) <= ACCEPT_KM;
        });
        if (
          matches.length &&
          matches.every((p) => kmBetween(p.lat, p.lng, matches[0].lat, matches[0].lng) < 0.3)
        ) {
          geo = { lat: matches[0].lat, lng: matches[0].lng, precision: 'address' };
          how = 'D0-poi-address';
        }
      }
    }

    // Tier D: the actual listing — unique name match near the anchor
    if (!geo && anchor) {
      const unique =
        (nameCityCount.get(`${normName(String(r.name))}|${city.toLowerCase()}`) ?? 0) === 1;
      if (unique) {
        const poi = poiHit(String(r.name), anchor);
        if (poi) {
          geo = { lat: poi.lat, lng: poi.lng, precision: 'address' };
          how = 'D-poi-name';
        }
      }
    }

    if (!geo) {
      unresolved.push({
        id: r.id,
        name: r.name,
        address: r.address,
        city,
        zip,
        precision: r.geo_precision ?? null,
      });
      continue;
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
    if (done % 50 === 0) process.stdout.write(`\rresolved ${done}`);
  }

  const { restaurantsWritten } = store.save();
  console.log(`\nresolved: ${done}   unresolved: ${unresolved.length}   files written: ${restaurantsWritten}`);
  console.log('tiers:', JSON.stringify(tiers, null, 1));

  unresolved.sort((a, b) =>
    String(a.city).localeCompare(String(b.city)) || String(a.name).localeCompare(String(b.name))
  );
  writeFileSync(UNRESOLVED_JSON, JSON.stringify(unresolved, null, 1));
  const lines = [
    '# Unverified restaurant locations',
    '',
    `Generated by \`npm run verify:locations\` — ${unresolved.length} records that no`,
    'authoritative source could place yet. These are EXCLUDED from the map',
    '(the apps only pin rooftop/address precision) until resolved.',
    '',
    '| City | Name | Address | ZIP | Prior precision |',
    '|---|---|---|---|---|',
    ...unresolved.map(
      (u) => `| ${u.city} | ${u.name} | ${u.address} | ${u.zip ?? ''} | ${u.precision ?? 'null'} |`
    ),
  ];
  writeFileSync(UNRESOLVED_MD, lines.join('\n') + '\n');
  console.log(`unresolved list: docs/geo-unresolved.md (+ .json)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
