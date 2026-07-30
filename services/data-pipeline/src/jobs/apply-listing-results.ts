/**
 * Apply web-listing research results (geo-results-*.jsonl produced by the
 * listing-lookup agents) to the store, with the same guardrails as every
 * other placement path:
 *
 *   - a corrected/completed address is tried against the rooftop
 *     address-point DB first (agent coords must corroborate within 500 m)
 *     → 'rooftop'
 *   - otherwise the listing coordinates are used → 'address', but only when
 *     they sit inside South Dakota and within 25 km of the city's verified
 *     anchor
 *   - refused entries are reported, never written
 *
 * Also rewrites docs/geo-unresolved.{json,md} minus the records resolved.
 *
 * Usage: npm run apply:listings -- <dir-with-geo-results-*.jsonl>
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { lookupAddressPoint } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');
const UNRESOLVED_MD = path.resolve(moduleDir, '../../../../docs/geo-unresolved.md');
const UNRESOLVED_JSON = path.resolve(moduleDir, '../../../../docs/geo-unresolved.json');
// Rural SD reality: a ranch lodge's postal town can be 40+ km away. High-
// confidence listings get the wide gate; medium stays tight.
const ACCEPT_KM_HIGH = 60;
const ACCEPT_KM_MED = 25;

interface ListingResult {
  id: string;
  lat?: number;
  lng?: number;
  source_url?: string;
  confidence?: string;
  corrected_address?: string;
  corrected_zip?: string;
  skipped?: string;
}

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}
function inSouthDakota(lat: number, lng: number): boolean {
  return lat >= 42.4 && lat <= 46.05 && lng >= -104.15 && lng <= -96.4;
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: apply-listing-results <dir with geo-results-*.jsonl>');

  const results: ListingResult[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^geo-results-.*\.jsonl$/.test(f)) continue;
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        results.push(JSON.parse(t));
      } catch {
        console.log('bad line skipped:', t.slice(0, 80));
      }
    }
  }
  console.log(`listing results: ${results.length}`);

  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;
  const byId = new Map(restaurants.map((r) => [String(r.id), r]));

  // City anchors from currently-verified records
  const byCity = new Map<string, Array<Record<string, unknown>>>();
  for (const r of restaurants) {
    if (r.geo_precision !== 'rooftop' && r.geo_precision !== 'address') continue;
    const c = String(r.city ?? '').trim().toLowerCase();
    if (!c) continue;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c)!.push(r);
  }
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

  function anchorFor(city: string): { lat: number; lng: number } | null {
    const members = byCity.get(city.toLowerCase());
    if (members && members.length >= 2) {
      const lats = members.map((m) => Number(m.latitude)).sort((a, b) => a - b);
      const lngs = members.map((m) => Number(m.longitude)).sort((a, b) => a - b);
      return { lat: lats[lats.length >> 1], lng: lngs[lngs.length >> 1] };
    }
    // Fall back to the settlement's own OSM location for tiny towns
    const candidates = placesByName.get(city.toLowerCase().replace(/^saint /, 'st. '))
      ?? placesByName.get(city.toLowerCase());
    if (!candidates?.length) return null;
    const pick = [...candidates].sort(
      (a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9)
    )[0];
    return { lat: pick.lat, lng: pick.lng };
  }

  const tiers: Record<string, number> = {};
  const resolvedIds = new Set<string>();
  const refused: string[] = [];

  for (const res of results) {
    const r = byId.get(String(res.id));
    if (!r) continue;
    if (r.geo_precision === 'rooftop' || r.geo_precision === 'address') continue; // already fixed
    if (res.skipped || res.lat == null || res.lng == null) continue;
    const city = String(r.city ?? '').trim();
    const anchor = anchorFor(city);
    const acceptKm = res.confidence === 'high' ? ACCEPT_KM_HIGH : ACCEPT_KM_MED;
    const agentOk =
      inSouthDakota(res.lat, res.lng) &&
      !!anchor &&
      kmBetween(res.lat, res.lng, anchor.lat, anchor.lng) <= acceptKm;

    let geo: { lat: number; lng: number; precision: 'rooftop' | 'address' } | null = null;
    let how = '';

    // Corrected address → rooftop DB, corroborated by the listing coords
    if (res.corrected_address) {
      const norm = normalizeStreet(res.corrected_address);
      const hit = lookupAddressPoint(norm.street, res.corrected_zip ?? null);
      if (hit && agentOk && kmBetween(hit.lat, hit.lng, res.lat, res.lng) <= 0.5) {
        geo = { lat: hit.lat, lng: hit.lng, precision: 'rooftop' };
        how = 'F-corrected-rooftop';
      }
    }
    if (!geo && agentOk) {
      geo = { lat: res.lat, lng: res.lng, precision: 'address' };
      how = `F-listing-${res.confidence ?? 'unknown'}`;
    }
    if (!geo) {
      refused.push(`${r.name} | ${city} | ${res.lat},${res.lng} (${res.confidence ?? '-'})`);
      continue;
    }

    const newAddress = res.corrected_address
      ? normalizeStreet(res.corrected_address).street
      : String(r.address);
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: newAddress,
      city,
      state: 'SD',
      zip_code: res.corrected_zip ?? ((r.zip_code as string) || null),
      phone: (r.phone as string) ?? null,
      latitude: geo.lat,
      longitude: geo.lng,
      source: String(r.source),
      geo_precision: geo.precision,
      source_address: (r.source_address as string) ?? null,
    });
    tiers[how] = (tiers[how] ?? 0) + 1;
    resolvedIds.add(String(r.id));
  }

  const { restaurantsWritten } = store.save();
  console.log(`applied: ${resolvedIds.size}   refused: ${refused.length}   files written: ${restaurantsWritten}`);
  console.log('tiers:', JSON.stringify(tiers, null, 1));
  for (const line of refused) console.log('  refused:', line);

  // Trim the unresolved worklist
  const unresolved = (JSON.parse(readFileSync(UNRESOLVED_JSON, 'utf8')) as Array<{ id: string }>).filter(
    (u) => !resolvedIds.has(String(u.id))
  );
  writeFileSync(UNRESOLVED_JSON, JSON.stringify(unresolved, null, 1));
  const lines = [
    '# Unverified restaurant locations',
    '',
    `${unresolved.length} records that no authoritative source could place yet. These are`,
    'EXCLUDED from the map (the apps only pin rooftop/address precision) until resolved.',
    '',
    '| City | Name | Address | ZIP | Prior precision |',
    '|---|---|---|---|---|',
    ...(unresolved as Array<Record<string, unknown>>).map(
      (u) => `| ${u.city} | ${u.name} | ${u.address} | ${u.zip ?? ''} | ${u.precision ?? 'null'} |`
    ),
  ];
  writeFileSync(UNRESOLVED_MD, lines.join('\n') + '\n');
  console.log(`unresolved remaining: ${unresolved.length}`);
}

main();
