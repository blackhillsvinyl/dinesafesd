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

// The state inspects roughly annually, so a place with no inspection since
// before this date has likely closed. Bump forward each year.
export const POSSIBLY_CLOSED_BEFORE = '2025-01-01';

export function possiblyClosed(r: Pick<Restaurant, 'latest_inspection_date'>): boolean {
  return (r.latest_inspection_date ?? '') < POSSIBLY_CLOSED_BEFORE;
}

/** Gets a pin on the map: location verified AND plausibly still open. */
export function isMappable(
  r: Pick<Restaurant, 'geo_precision' | 'latest_inspection_date'>
): boolean {
  return isVerifiedLocation(r) && !possiblyClosed(r);
}
