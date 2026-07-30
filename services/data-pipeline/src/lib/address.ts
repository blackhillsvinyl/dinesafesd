/**
 * Address parsing and normalization.
 *
 * The DOH source renders one line per establishment:
 *   "501 N  SPLIT ROCK  BLVD  Brandon, SD 57005"
 * We parse street / city / zip out of that (keeping the ZIP — it's the best
 * key for validation), strip unit designators that break address matching,
 * and can repair rows where a previous parser bled street tokens into the
 * city field ("808 W SIOUX" / "AVE STE 100 Pierre").
 */

export interface ParsedAddress {
  street: string;
  unit: string | null;
  city: string;
  zip: string | null;
}

// Multi-word SD cities the suffix matcher must know (single-word cities are
// handled generically). Extend as new ones appear in source data.
export const MULTI_WORD_CITIES = [
  'Rapid City', 'Sioux Falls', 'North Sioux City', 'Box Elder',
  'Belle Fourche', 'Hot Springs', 'Fort Pierre', 'Dell Rapids',
  'Black Hawk', 'Hill City', 'Lead Deadwood', 'Pine Ridge',
  'Eagle Butte', 'Elk Point', 'Tea Area', 'Dakota Dunes',
  'Whitewood', 'Summerset', 'Colonial Pine Hills', 'Wessington Springs',
  'Lake Andes', 'Long Lake', 'Rose Hill', 'Sioux City',
  'De Smet', 'Lake Norden', 'Lake Preston', 'Lake City',
  'Big Stone City', 'White River', 'White Lake', 'Mount Vernon',
  'New Underwood', 'New Effington', 'Fort Thompson', 'Wessington',
];

const UNIT_RE = /(?:\b(?:APT|STE|SUITE|UNIT|LOT|TRLR|BLDG|RM|FL|SPC)\b|#)\s*\.?\s*([A-Z0-9-]+)\b\.?/i;

/** Collapse whitespace and pull unit designators (APT 101, STE B, #4) out. */
export function normalizeStreet(street: string): { street: string; unit: string | null } {
  let s = street.replace(/\s+/g, ' ').trim();
  const units: string[] = [];
  // Source data sometimes stacks designators ("STE 4 UNIT B") — strip them all
  for (let i = 0; i < 3; i++) {
    const m = s.match(UNIT_RE);
    if (!m) break;
    units.push(m[0].replace(/\s+/g, ' ').trim());
    s = (s.slice(0, m.index) + ' ' + s.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim();
  }
  return { street: s, unit: units.length ? units.join(' ') : null };
}

/**
 * Split a "STREET City" string on the longest known-city suffix.
 * knownCities should include MULTI_WORD_CITIES plus single-word city names
 * observed in clean data.
 */
function splitOnCitySuffix(
  combined: string,
  knownCities: string[]
): { street: string; city: string } | null {
  const lower = combined.toLowerCase();
  let best: { idx: number; city: string } | null = null;
  for (const c of knownCities) {
    const cl = c.toLowerCase();
    if (lower.endsWith(' ' + cl) || lower === cl) {
      const idx = lower.length - cl.length;
      if (idx > 0 && (!best || c.length > best.city.length)) {
        best = { idx, city: combined.slice(idx).trim() };
      }
    }
  }
  if (!best) return null;
  return {
    street: combined.slice(0, best.idx).replace(/\s+/g, ' ').trim(),
    city: best.city,
  };
}

/**
 * Parse the raw source line "STREET  City, SD ZIP".
 * Falls back to the double-space heuristic when the city isn't known.
 */
export function parseSourceAddress(rawDiv: string, knownCities: string[]): ParsedAddress {
  const zipMatch = rawDiv.match(/,\s*SD\s*(\d{5})?(?:-\d{4})?\s*$/i);
  const zip = zipMatch?.[1] ?? null;
  const beforeSD = (zipMatch ? rawDiv.slice(0, zipMatch.index) : rawDiv).trim();

  const bySuffix = splitOnCitySuffix(beforeSD.replace(/\s+/g, ' '), knownCities);
  if (bySuffix) {
    const { street, unit } = normalizeStreet(bySuffix.street);
    return { street, unit, city: bySuffix.city, zip };
  }

  // Heuristic fallback: source separates street and city with two spaces
  const lastDouble = beforeSD.lastIndexOf('  ');
  let rawStreet = beforeSD;
  let city = '';
  if (lastDouble > 0) {
    rawStreet = beforeSD.slice(0, lastDouble);
    city = beforeSD.slice(lastDouble).trim();
  } else {
    const lastSpace = beforeSD.lastIndexOf(' ');
    if (lastSpace > 0) {
      rawStreet = beforeSD.slice(0, lastSpace);
      city = beforeSD.slice(lastSpace).trim();
    }
  }
  const { street, unit } = normalizeStreet(rawStreet);
  return { street, unit, city, zip };
}

const CITY_CONTAMINATION = /\b(ST|AVE|BLVD|DR|RD|CIR|LN|CT|PL|HWY|STE|APT|UNIT|SUITE)\b|\d|#/i;

/** Does this city value look like it contains street fragments? */
export function isCorruptedCity(city: string): boolean {
  return CITY_CONTAMINATION.test(city) && !/^(fort|ft)\b/i.test(city.trim());
}

/**
 * Repair a corrupted street/city split by rejoining and re-splitting on a
 * known-city suffix. Returns null when no known city matches.
 */
export function repairCityStreetSplit(
  street: string,
  city: string,
  knownCities: string[]
): { street: string; unit: string | null; city: string } | null {
  // Pull unit designators out BEFORE suffix matching — a unit stuck between
  // the city's words ("109 4th SW ST De UNIT 1" + "Smet") otherwise hides
  // the city name from the matcher.
  const combined = normalizeStreet((street + ' ' + city).replace(/\s+/g, ' ').trim());
  const split = splitOnCitySuffix(combined.street, knownCities);
  if (!split) return null;
  const norm = normalizeStreet(split.street);
  return { street: norm.street, unit: norm.unit ?? combined.unit, city: split.city };
}
