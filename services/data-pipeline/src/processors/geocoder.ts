/**
 * Validated, Census-free geocoding.
 *
 * Input is expected to be USPS-standardized (see lib/usps.ts). Coordinates
 * come from, in order of authority:
 *   0. Government rooftop address points (lib/address-points.ts)  → 'rooftop'
 *   1. OpenStreetMap/Nominatim, cross-checked against the USPS street + ZIP
 *      (house-number agreement → 'address'; street-level → 'street')
 *   2. City centroid with jitter                                   → 'city'
 *
 * No result is accepted — or cached — unless it agrees with the input
 * address, and everything must land inside South Dakota.
 */

import { store, type GeoPrecision } from '../lib/store.js';
import { lookupAddressPoint, parseStreetParts } from '../lib/address-points.js';

export interface GeoResult {
  lat: number;
  lng: number;
  precision: GeoPrecision;
}

interface Coordinates {
  lat: number;
  lng: number;
}

function inSouthDakota(c: Coordinates): boolean {
  return c.lat >= 42.4 && c.lat <= 46.05 && c.lng >= -104.15 && c.lng <= -96.4;
}

// Words that don't identify a street on their own
const NOISE_TOKENS = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'CIR', 'LN', 'CT', 'PL', 'HWY', 'WAY',
  'TRL', 'PKWY', 'TER', 'SQ', 'LOOP', 'STREET', 'AVENUE', 'DRIVE', 'ROAD',
]);

function significantTokens(street: string): string[] {
  return street
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t));
}

function houseNumber(street: string): string | null {
  return street.trim().match(/^(\d+)/)?.[1] ?? null;
}

const NOMINATIM_DELAY = 1150;
let lastNominatim = 0;

async function nominatim(query: string): Promise<Record<string, unknown> | null> {
  const wait = lastNominatim + NOMINATIM_DELAY - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&q=' +
      encodeURIComponent(query);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'DineSafeSD/1.0 (health-inspection-app)' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>[];
    return Array.isArray(data) && data.length ? data[0] : null;
  } catch {
    return null;
  }
}

interface NominatimHit {
  lat: number;
  lng: number;
  road: string;
  houseNumber: string | null;
  zip: string | null;
}

function parseNominatimHit(raw: Record<string, unknown> | null): NominatimHit | null {
  if (!raw) return null;
  const addr = (raw.address ?? {}) as Record<string, string>;
  return {
    lat: parseFloat(String(raw.lat)),
    lng: parseFloat(String(raw.lon)),
    road: (addr.road ?? '').toUpperCase(),
    houseNumber: addr.house_number ?? null,
    zip: addr.postcode?.slice(0, 5) ?? null,
  };
}

/**
 * Geocode a USPS-standardized address with validation.
 * `street` must be unit-free (normalizeStreet), e.g. "1835 HARMONY HEIGHTS LN".
 */
export async function geocodeValidated(
  street: string,
  city: string,
  zip5: string | null
): Promise<GeoResult | null> {
  const cacheKey = `${street}, ${city}, SD ${zip5 ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const cached = store.getCachedGeocode(cacheKey) as (Coordinates & { precision?: GeoPrecision }) | null;
  if (cached && cached.precision && inSouthDakota(cached)) {
    return { lat: cached.lat, lng: cached.lng, precision: cached.precision };
  }

  const remember = (r: GeoResult): GeoResult => {
    store.setCachedGeocode(cacheKey, r as unknown as Coordinates);
    return r;
  };

  // Tier 0: authoritative rooftop address points
  const rooftop = lookupAddressPoint(street, zip5);
  if (rooftop && inSouthDakota(rooftop)) {
    return remember({ lat: rooftop.lat, lng: rooftop.lng, precision: 'rooftop' });
  }

  const wantNumber = houseNumber(street);
  const wantTokens = significantTokens(street);
  const streetAgrees = (road: string) =>
    wantTokens.length > 0 && significantTokens(road).some((t) => wantTokens.includes(t));
  const zipAgrees = (hitZip: string | null) => !zip5 || !hitZip || hitZip === zip5;

  // Tier 1: Nominatim/OSM, cross-checked against the (USPS) input
  const queries = [
    `${street}, ${city}, SD ${zip5 ?? ''}`.trim(),
    `${street}, ${city}, South Dakota`,
    `${street}, South Dakota`,
  ];
  for (const q of queries) {
    const hit = parseNominatimHit(await nominatim(q));
    if (!hit || !inSouthDakota(hit)) continue;
    if (!streetAgrees(hit.road) || !zipAgrees(hit.zip)) continue;
    if (wantNumber && hit.houseNumber === wantNumber) {
      return remember({ lat: hit.lat, lng: hit.lng, precision: 'address' });
    }
    // Right street (and right ZIP when known) but not the exact building
    return remember({ lat: hit.lat, lng: hit.lng, precision: 'street' });
  }

  // Tier 1b: street-name-only (drops the house number entirely)
  const nameOnly = street.replace(/^\d+\s+/, '');
  if (nameOnly && nameOnly !== street) {
    const hit = parseNominatimHit(await nominatim(`${nameOnly}, ${city}, South Dakota`));
    if (hit && inSouthDakota(hit) && streetAgrees(hit.road) && zipAgrees(hit.zip)) {
      return remember({ lat: hit.lat, lng: hit.lng, precision: 'street' });
    }
  }

  return null; // caller decides on the city-centroid fallback
}

/**
 * City centroid fallback: median of already-validated restaurants in the same
 * city, with slight jitter so multiple fallbacks don't stack on one point.
 */
export function cityCentroid(
  city: string,
  validated: Array<{ city: string; latitude: number; longitude: number }>
): GeoResult | null {
  const inCity = validated.filter((r) => r.city.toLowerCase() === city.toLowerCase());
  if (inCity.length === 0) return null;
  const lats = inCity.map((r) => r.latitude).sort((a, b) => a - b);
  const lngs = inCity.map((r) => r.longitude).sort((a, b) => a - b);
  const mid = Math.floor(inCity.length / 2);
  return {
    lat: lats[mid] + (Math.random() - 0.5) * 0.006,
    lng: lngs[mid] + (Math.random() - 0.5) * 0.006,
    precision: 'city',
  };
}

/**
 * Compatibility wrapper for callers that only have a free-form address string
 * (e.g. the SWEEPS pipeline before USPS standardization is wired in there).
 * Returns city-level fallback at the SD center as a last resort.
 */
export async function geocodeAddress(address: string): Promise<Coordinates> {
  const parts = address.split(',').map((s) => s.trim());
  const street = parts[0] ?? address;
  const city = parts[1] ?? '';
  const result = await geocodeValidated(street, city, null);
  if (result) return { lat: result.lat, lng: result.lng };
  return { lat: 44.3668 + (Math.random() - 0.5) * 0.01, lng: -100.3538 + (Math.random() - 0.5) * 0.01 };
}

// Re-exported for tests
export { parseStreetParts };
