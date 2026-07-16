import 'dotenv/config';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { store, DATA_DIR } from '../lib/store.js';
import {
  MULTI_WORD_CITIES,
  isCorruptedCity,
  repairCityStreetSplit,
  normalizeStreet,
} from '../lib/address.js';
import { standardizeAddress, uspsAvailable } from '../lib/usps.js';
import { geocodeValidated, cityCentroid, type GeoResult } from '../processors/geocoder.js';

/**
 * Full re-geocode of every restaurant through the USPS-validated pipeline:
 * repair corrupted address/city splits → strip units → USPS standardize →
 * rooftop/OSM validated coordinates → city-centroid fallback (marked).
 * Emits docs/address-audit.md. Reusable whenever the pipeline improves.
 */

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function main() {
  if (!uspsAvailable()) {
    console.error('USPS credentials not configured — aborting (see lib/usps.ts).');
    process.exit(1);
  }

  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;
  console.log('restaurants:', restaurants.length);

  // Known cities = curated multi-word list + clean values seen in data
  const known = new Set<string>(MULTI_WORD_CITIES);
  for (const r of restaurants) {
    const c = String(r.city ?? '').trim();
    if (c && !isCorruptedCity(c)) known.add(c);
  }
  const knownCities = [...known];

  // The old cache holds unvalidated/Census-derived coords — start clean.
  store.clearGeocodeCache();

  interface AuditRow {
    id: string;
    name: string;
    raw: string;
    usps: string;
    tier: string;
    note: string;
  }
  const audit: AuditRow[] = [];
  const pending: Array<{ r: Record<string, unknown>; street: string; unit: string | null; city: string; row: AuditRow }> = [];
  const tierCounts: Record<string, number> = {};
  const validatedForCentroid: Array<{ city: string; latitude: number; longitude: number }> = [];

  let done = 0;
  for (const r of restaurants) {
    const id = String(r.id);
    let street = String(r.address ?? '');
    let city = String(r.city ?? '');
    const rawAddress = `${street}, ${city}`;

    // 1) repair corrupted splits
    if (isCorruptedCity(city)) {
      const rep = repairCityStreetSplit(street, city, knownCities);
      if (rep) {
        street = rep.unit ? `${rep.street} ${rep.unit}` : rep.street;
        city = rep.city;
      }
    }

    // 2) strip units for matching (kept for display)
    const norm = normalizeStreet(street);

    // 3) USPS standardization
    let usps = null;
    try {
      usps = await standardizeAddress(norm.street, city, (r.zip_code as string) ?? null);
    } catch (e) {
      console.error('USPS error for', id, String(e).slice(0, 120));
    }
    const geoStreet = usps?.street ?? norm.street;
    const geoCity = usps ? titleCase(usps.city) : city;
    const geoZip = usps?.zip5 ?? ((r.zip_code as string) ?? null);

    const row: AuditRow = {
      id,
      name: String(r.name),
      raw: rawAddress,
      usps: usps ? `${usps.street}, ${usps.city} ${usps.zip5}` : '(unknown to USPS)',
      tier: '',
      note: usps ? '' : 'USPS could not validate',
    };

    // 4) validated coordinates
    const geo = await geocodeValidated(geoStreet, geoCity, geoZip);
    if (geo) {
      applyResult(r, geo, geoStreet, norm.unit, geoCity, geoZip, rawAddress);
      validatedForCentroid.push({ city: geoCity, latitude: geo.lat, longitude: geo.lng });
      row.tier = geo.precision;
    } else {
      row.tier = 'city (pending)';
      pending.push({ r, street: geoStreet, unit: norm.unit, city: geoCity, row });
    }
    audit.push(row);
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${restaurants.length} (pending centroid: ${pending.length})`);
  }

  // 5) centroid fallbacks from validated same-city medians
  for (const p of pending) {
    const c = cityCentroid(p.city, validatedForCentroid) ??
      // No validated sibling in that city: land at the median of everything (rare)
      cityCentroid(p.city, restaurants.map((x) => ({ city: String(x.city), latitude: Number(x.latitude), longitude: Number(x.longitude) })));
    const geo: GeoResult = c ?? { lat: 44.3668, lng: -100.3538, precision: 'city' };
    applyResult(p.r, geo, p.street, p.unit, p.city, null, p.row.raw);
    p.row.tier = 'city';
  }

  function applyResult(
    r: Record<string, unknown>,
    geo: GeoResult,
    street: string,
    unit: string | null,
    city: string,
    zip: string | null,
    rawAddress: string
  ) {
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: unit ? `${street} ${unit}` : street,
      city,
      state: 'SD',
      zip_code: zip,
      phone: (r.phone as string) ?? null,
      latitude: geo.lat,
      longitude: geo.lng,
      source: String(r.source),
      geo_precision: geo.precision,
      source_address: rawAddress,
    });
    tierCounts[geo.precision] = (tierCounts[geo.precision] ?? 0) + 1;
  }

  const { restaurantsWritten } = store.save();
  console.log('written:', restaurantsWritten, '| tiers:', JSON.stringify(tierCounts));

  // 6) audit report
  const uspsUnknown = audit.filter((a) => a.note);
  const cityTier = audit.filter((a) => a.tier === 'city');
  const lines = [
    '# Address Audit — USPS-validated geocoding',
    '',
    `Generated by \`jobs/regeocode-all.ts\`. Restaurants: ${audit.length}.`,
    '',
    '## Coordinate precision',
    '',
    ...Object.entries(tierCounts).map(([t, n]) => `- **${t}**: ${n}`),
    '',
    `## Unknown to USPS (${uspsUnknown.length})`,
    '',
    'Addresses USPS could not validate — likely new construction, private',
    'roads, or source typos. These carry street/city-level coordinates.',
    '',
    ...uspsUnknown.slice(0, 200).map((a) => `- ${a.name}: \`${a.raw}\``),
    '',
    `## City-level placements (${cityTier.length})`,
    '',
    'No validated coordinate source knew these addresses; shown near the city',
    'center and marked approximate in the apps.',
    '',
    ...cityTier.slice(0, 200).map((a) => `- ${a.name}: \`${a.raw}\` → USPS: ${a.usps}`),
    '',
  ];
  const auditPath = path.resolve(DATA_DIR, '../../../docs/address-audit.md');
  writeFileSync(auditPath, lines.join('\n'));
  console.log('audit written:', auditPath);
}

main();
