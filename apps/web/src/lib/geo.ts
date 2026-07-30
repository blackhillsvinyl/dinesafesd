import type { Restaurant } from '../types';

/**
 * Only rooftop- and address-precision coordinates are trusted for map
 * placement. Everything else ('street', 'city', null) is excluded from the
 * map until it can be verified — a pin in the wrong place is worse than no
 * pin. See services/data-pipeline/src/processors/geocoder.ts for tiers.
 */
export function isVerifiedLocation(r: Pick<Restaurant, 'geo_precision'>): boolean {
  return r.geo_precision === 'rooftop' || r.geo_precision === 'address';
}
