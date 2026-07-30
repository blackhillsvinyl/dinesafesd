/**
 * Last-mile resolver for docs/geo-unresolved.json (produced by
 * verify:locations): the records no local address point or state rooftop
 * locator could place.
 *
 * Two strictly-validated OSM/Nominatim passes per record (1.15s apart —
 * Nominatim usage policy):
 *
 *   E1 structured address search — accepted only when the hit's house
 *      number matches exactly, the street shares a significant token, the
 *      ZIP agrees when both sides know it, and the point sits within 25 km
 *      of the city anchor                                        → 'address'
 *   E2 place-listing search by name ("<name>, <city>, South Dakota") —
 *      accepted only when the listing's name matches (normalized
 *      equality or prefix), its class is a business/POI type, and it sits
 *      within 25 km of the city anchor                           → 'address'
 *
 * Everything still unresolved is rewritten to docs/geo-unresolved.{json,md}
 * and stays OFF the map.
 *
 * Usage: npm run resolve:tail   (in services/data-pipeline)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');
const UNRESOLVED_MD = path.resolve(moduleDir, '../../../../docs/geo-unresolved.md');
const UNRESOLVED_JSON = path.resolve(moduleDir, '../../../../docs/geo-unresolved.json');

const ACCEPT_KM = 25;
const DELAY = 1150;

interface Unresolved {
  id: string;
  name: string;
  address: string;
  city: string;
  zip: string | null;
  precision: string | null;
}

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
  'NORTH', 'SOUTH', 'EAST', 'WEST',
]);
function significantTokens(s: string): string[] {
  return s
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
    .replace(/\b(LLC|INC|CORP|LTD|LLP|THE)\b\.?/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let lastCall = 0;
async function nominatim(params: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  const wait = lastCall + DELAY - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const qs = new URLSearchParams({
    format: 'json',
    limit: '5',
    countrycodes: 'us',
    addressdetails: '1',
    ...params,
  });
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { 'User-Agent': 'DineSafeSD/1.0 (health-inspection-app; geo repair)' },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<Record<string, unknown>>;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const GOOD_CLASSES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'building']);

async function main() {
  const unresolved = JSON.parse(readFileSync(UNRESOLVED_JSON, 'utf8')) as Unresolved[];
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  // Anchors from verified records + OSM settlement locations
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
  const byCity = new Map<string, Array<Record<string, unknown>>>();
  for (const r of restaurants) {
    if (r.geo_precision !== 'rooftop' && r.geo_precision !== 'address') continue;
    const c = String(r.city ?? '').trim().toLowerCase();
    if (!c) continue;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c)!.push(r);
  }
  function anchorFor(city: string): { lat: number; lng: number } | null {
    const key = city.toLowerCase();
    const members = byCity.get(key);
    if (members && members.length >= 3) {
      const lats = members.map((m) => Number(m.latitude)).sort((a, b) => a - b);
      const lngs = members.map((m) => Number(m.longitude)).sort((a, b) => a - b);
      return { lat: lats[lats.length >> 1], lng: lngs[lngs.length >> 1] };
    }
    const candidates = placesByName.get(key);
    if (!candidates?.length) return null;
    const pick = [...candidates].sort(
      (a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9)
    )[0];
    return { lat: pick.lat, lng: pick.lng };
  }

  const byId = new Map(restaurants.map((r) => [String(r.id), r]));
  const tiers: Record<string, number> = {};
  const still: Unresolved[] = [];
  let done = 0;

  for (const u of unresolved) {
    const r = byId.get(String(u.id));
    if (!r) continue;
    const anchor = anchorFor(u.city);
    const norm = normalizeStreet(u.address);
    const wantNum = norm.street.trim().match(/^(\d+)/)?.[1] ?? null;
    const wantTokens = significantTokens(norm.street.replace(/^\d+\s*/, ''));
    const near = (lat: number, lng: number) =>
      !!anchor && kmBetween(lat, lng, anchor.lat, anchor.lng) <= ACCEPT_KM;

    let geo: { lat: number; lng: number } | null = null;
    let how = '';

    // E1: structured address search, fully validated
    if (wantNum && wantTokens.length && anchor) {
      const hits = await nominatim({
        street: norm.street,
        city: u.city,
        state: 'South Dakota',
        ...(u.zip ? { postalcode: u.zip } : {}),
      });
      for (const h of hits) {
        const addr = (h.address ?? {}) as Record<string, string>;
        const lat = parseFloat(String(h.lat));
        const lng = parseFloat(String(h.lon));
        if (!inSouthDakota(lat, lng) || !near(lat, lng)) continue;
        if ((addr.house_number ?? '') !== wantNum) continue;
        const roadTokens = significantTokens(addr.road ?? '');
        if (!roadTokens.some((t) => wantTokens.includes(t))) continue;
        const hitZip = addr.postcode?.slice(0, 5) ?? null;
        if (u.zip && hitZip && hitZip !== u.zip) continue;
        geo = { lat, lng };
        how = 'E1-nominatim-address';
        break;
      }
    }

    // E2: the actual listing by name
    if (!geo && anchor) {
      const clean = normName(u.name);
      if (clean.length >= 4) {
        const hits = await nominatim({ q: `${u.name}, ${u.city}, South Dakota` });
        for (const h of hits) {
          if (!GOOD_CLASSES.has(String(h.class ?? ''))) continue;
          const lat = parseFloat(String(h.lat));
          const lng = parseFloat(String(h.lon));
          if (!inSouthDakota(lat, lng) || !near(lat, lng)) continue;
          const hitName = normName(String(h.name ?? ''));
          if (!hitName) continue;
          if (
            hitName !== clean &&
            !hitName.startsWith(clean + ' ') &&
            !clean.startsWith(hitName + ' ')
          )
            continue;
          geo = { lat, lng };
          how = 'E2-nominatim-listing';
          break;
        }
      }
    }

    if (!geo) {
      still.push(u);
      continue;
    }

    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city: u.city,
      state: 'SD',
      zip_code: u.zip,
      phone: (r.phone as string) ?? null,
      latitude: geo.lat,
      longitude: geo.lng,
      source: String(r.source),
      geo_precision: 'address',
      source_address: (r.source_address as string) ?? null,
    });
    tiers[how] = (tiers[how] ?? 0) + 1;
    done++;
    if (done % 20 === 0) process.stdout.write(`\rresolved ${done}`);
  }

  const { restaurantsWritten } = store.save();
  console.log(`\nresolved: ${done}   still unresolved: ${still.length}   files written: ${restaurantsWritten}`);
  console.log('tiers:', JSON.stringify(tiers, null, 1));

  writeFileSync(UNRESOLVED_JSON, JSON.stringify(still, null, 1));
  const lines = [
    '# Unverified restaurant locations',
    '',
    `Generated by \`npm run verify:locations\` + \`npm run resolve:tail\` — ${still.length}`,
    'records that no authoritative source could place yet. These are EXCLUDED',
    'from the map (the apps only pin rooftop/address precision) until resolved.',
    '',
    '| City | Name | Address | ZIP | Prior precision |',
    '|---|---|---|---|---|',
    ...still.map(
      (u) => `| ${u.city} | ${u.name} | ${u.address} | ${u.zip ?? ''} | ${u.precision ?? 'null'} |`
    ),
  ];
  writeFileSync(UNRESOLVED_MD, lines.join('\n') + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
