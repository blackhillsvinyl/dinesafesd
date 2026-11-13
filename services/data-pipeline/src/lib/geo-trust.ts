// When an address arrives without a ZIP, a street-and-number match says
// nothing about which town it is in: "2101 W 41ST ST" exists in more than
// one South Dakota city, and the address-point table is keyed by street
// alone. These checks decide whether such a match may be trusted as the
// requested city's. Pure, so they are unit-tested.

export function normalizeCity(city: string | null | undefined): string {
  return (city ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * May a ZIP-less lookup accept an address point? Only when the point's own
 * ZIP is one already recorded for the requested city. An unknown city (no
 * ZIPs on record) cannot be confirmed, so the point is not used.
 */
export function pointMatchesCity(hitZip: string | null, knownZipsForCity: ReadonlySet<string>): boolean {
  return !!hitZip && knownZipsForCity.has(hitZip.slice(0, 5));
}

/**
 * May a geocoder hit be accepted for the requested place?
 * With a ZIP: the hit's ZIP must not contradict it (as before).
 * Without one: the hit must name the same city, or sit in a ZIP already
 * recorded for that city.
 */
export function hitMatchesPlace(
  want: { city: string; zip5: string | null },
  hit: { city: string | null; zip: string | null },
  knownZipsForCity: ReadonlySet<string>
): boolean {
  if (want.zip5) return !hit.zip || hit.zip === want.zip5;
  if (hit.city && normalizeCity(hit.city) === normalizeCity(want.city)) return true;
  return !!hit.zip && knownZipsForCity.has(hit.zip);
}
