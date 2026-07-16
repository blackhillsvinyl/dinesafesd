import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { store } from '../lib/store.js';
import { geocodeAddress } from '../processors/geocoder.js';

const BASE_URL = 'https://sweepsdata.siouxfalls.gov/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

interface SFRestaurant {
  siteId: string;
  facType: string;
  name: string;
  address: string;
  score: number | null;
}

interface SFViolation {
  code: string;
  description: string;
  severity: 'critical' | 'minor';
}

interface SFInspection {
  date: string; // YYYY-MM-DD
  score: number | null;
  comments: string;
  violations: SFViolation[];
}

export interface SweepsStats {
  restaurantsUpserted: number;
  inspectionsUpserted: number;
  errors: number;
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
  return resp.text();
}

async function fetchRestaurantList(): Promise<SFRestaurant[]> {
  console.log('Fetching SWEEPS restaurant list...');
  const html = await fetchPage(BASE_URL + 'Restaurants.aspx');
  console.log('  Fetched ' + (html.length / 1024).toFixed(0) + ' KB');

  const restaurants: SFRestaurant[] = [];
  const seen = new Set<string>();

  // Match GridView rows: detail link (inv=1 is latest inspection), name, address, score
  const rowRegex = /href='Restaurant_Detail\.aspx\?SiteID=(\d+)&FacType=(\w+)&inv=1'[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>(\d*)<\/td>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const siteId = match[1];
    if (seen.has(siteId)) continue;
    seen.add(siteId);

    const name = match[3].replace(/\s+/g, ' ').trim();
    const address = match[4].replace(/\s+/g, ' ').trim();
    const scoreStr = match[5].trim();
    const score = scoreStr ? parseInt(scoreStr, 10) : null;

    if (name && address) {
      restaurants.push({ siteId, facType: match[2], name, address, score });
    }
  }

  return restaurants;
}

/** Parse "1/28/2026" → "2026-01-28" */
function parseUSDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
}

/**
 * Fetch a restaurant's detail page and parse the real inspections it shows
 * (the page lists violations "for last two inspections", each starting with a
 * <div class="inspection"> header carrying the date and total score).
 */
async function fetchInspectionDetails(
  r: SFRestaurant
): Promise<{ inspections: SFInspection[]; phone: string | null }> {
  const url = BASE_URL + 'Restaurant_Detail.aspx?SiteID=' + r.siteId + '&FacType=' + r.facType + '&inv=1';
  const html = await fetchPage(url);

  // Row attributes carry "NAME ADDRESS City, SD ZIP PHONE"
  const phone =
    html.match(/nonformattednameaddress="[^"]*?(\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})\s*"/i)?.[1] ?? null;

  const inspections: SFInspection[] = [];
  const blocks = html.split(/<div class="inspection">/i);
  for (let b = 1; b < blocks.length; b++) {
    const block = blocks[b];
    const header = block.match(/^\s*Inspection Date:\s*([\d/]+)\s*<br\s*\/?>\s*Total Score:\s*(\d+)/i);
    if (!header) continue;
    const date = parseUSDate(header[1]);
    if (!date) continue;
    const score = parseInt(header[2], 10);

    // Violations for this inspection are grouped under "Critical Violations" /
    // "Non-Critical Violations" headers; each is a <table class="violations">
    // with a title row and a description row. A "No Violations" table may
    // still carry inspector comments.
    const violations: SFViolation[] = [];
    let comments = '';
    const sections = block.split(/<div class="violhead">/i);
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const severity: SFViolation['severity'] = /^\s*<b>\s*critical/i.test(section) ? 'critical' : 'minor';
      const tableRegex = /<table class="violations">([\s\S]*?)<\/table>/gi;
      let t;
      while ((t = tableRegex.exec(section)) !== null) {
        const table = t[1];
        const commentMatch = table.match(/Inspector Comments:\s*([\s\S]*?)<\/td>/i);
        if (commentMatch) {
          comments = (comments ? comments + ' ' : '') +
            commentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        const title = table.match(/(\d+)\s*points?:\s*<a href='[^']*\/violation\/(\d+)'>([^<]+)<\/a>/i);
        if (!title) continue;
        const descMatch = table.match(/<\/tr>\s*<tr>\s*<td>([\s\S]*?)<\/td>/i);
        const points = title[1];
        const code = title[2];
        const name = title[3].trim();
        const desc = (descMatch ? descMatch[1] : '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const existing = violations.find((v) => v.code === code);
        const description = name + ' (' + points + ' pts): ' + desc;
        if (existing) {
          // UNIQUE(inspection_id, code) — merge repeat citations of the same code
          existing.description += ' | ' + description;
        } else {
          violations.push({ code, description, severity });
        }
      }
    }

    inspections.push({ date, score, comments, violations });
  }

  return { inspections, phone };
}

function calculateGrade(score: number | null): string {
  if (score === null) return 'N/A';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExistingRestaurant {
  id: string;
  address: string | null;
  latest_score: number | null;
}

function loadExistingRestaurants(): Map<string, ExistingRestaurant> {
  const map = new Map<string, ExistingRestaurant>();
  for (const r of store.getRestaurantsBySource('sf_sweeps')) {
    map.set(r.id, { id: r.id, address: r.address, latest_score: r.latest_score });
  }
  return map;
}

/**
 * Sync Sioux Falls SWEEPS.
 *
 * - Geocodes only restaurants that are new or whose address changed
 *   (Nominatim is rate-limited to ~1 req/s).
 * - Fetches the inv=1 detail page for the real inspection date + violations,
 *   but only when the list score differs from what we already have —
 *   pass allDetails=true (monthly backfill) to refetch every detail page.
 */
export async function syncSiouxFalls(options: { allDetails?: boolean } = {}): Promise<SweepsStats> {
  console.log('=== Sioux Falls SWEEPS Source ===\n');

  const restaurants = await fetchRestaurantList();
  console.log('Found ' + restaurants.length + ' unique restaurants\n');
  if (restaurants.length === 0) {
    throw new Error('SWEEPS list parse returned 0 restaurants — page layout may have changed');
  }

  const existing = loadExistingRestaurants();
  console.log('Known restaurants in store: ' + existing.size + '\n');

  const stats: SweepsStats = { restaurantsUpserted: 0, inspectionsUpserted: 0, errors: 0 };
  let geocoded = 0;
  let detailsFetched = 0;

  for (let i = 0; i < restaurants.length; i++) {
    const r = restaurants[i];
    if (i % 100 === 0 && i > 0) {
      console.log('  Progress: ' + i + '/' + restaurants.length +
        ' (' + stats.restaurantsUpserted + ' upserted, ' + detailsFetched + ' details, ' + stats.errors + ' errors)');
    }

    try {
      const externalId = 'sf_sweeps_' + r.siteId;
      const known = existing.get(externalId);
      const isNew = !known;
      const addressChanged = !!known && known.address !== r.address;

      let restaurantId = known?.id;

      if (isNew || addressChanged) {
        // Geocode with Nominatim rate limiting
        let coords = { lat: 43.5446, lng: -96.7311 };
        try {
          coords = await geocodeAddress(r.address + ', Sioux Falls, SD');
          geocoded++;
        } catch {
          coords = {
            lat: 43.5446 + (Math.random() - 0.5) * 0.02,
            lng: -96.7311 + (Math.random() - 0.5) * 0.02,
          };
        }
        await randomDelay(1100, 1500);

        restaurantId = store.upsertRestaurant({
          external_id: externalId,
          name: r.name,
          address: r.address,
          city: 'Sioux Falls',
          state: 'SD',
          latitude: coords.lat,
          longitude: coords.lng,
          source: 'sf_sweeps',
        });
        stats.restaurantsUpserted++;
      }

      if (!restaurantId) continue;

      // Fetch the real inspections (date, score, violations) when the score is
      // new/changed, or always during a full backfill.
      const scoreChanged = r.score !== null && (isNew || known!.latest_score !== r.score);
      if (r.score !== null && (options.allDetails || scoreChanged)) {
        const { inspections, phone } = await fetchInspectionDetails(r);
        detailsFetched++;
        await randomDelay(250, 500); // be polite to the city site

        if (phone) {
          const cur = store.getRestaurant(restaurantId);
          if (cur && cur.phone !== phone) {
            store.upsertRestaurant({
              external_id: cur.id, name: cur.name, address: cur.address, city: cur.city,
              state: cur.state, zip_code: cur.zip_code, phone,
              latitude: cur.latitude, longitude: cur.longitude, source: cur.source,
            });
          }
        }

        for (const inspection of inspections) {
          const ref = store.upsertInspection(restaurantId, {
            date: inspection.date,
            score: inspection.score,
            grade: calculateGrade(inspection.score),
            inspection_type: 'Routine',
            comments: inspection.comments,
            violationCount: inspection.violations.length,
          });
          stats.inspectionsUpserted++;

          for (const v of inspection.violations) {
            store.upsertViolation(ref, {
              code: v.code,
              description: v.description,
              severity: v.severity,
              corrected: false,
            });
          }
        }
      }
    } catch (error) {
      console.error('  Error processing ' + r.name + ': ' + error);
      stats.errors++;
    }
  }

  console.log('\n=== SWEEPS SUMMARY ===');
  console.log('Total found: ' + restaurants.length);
  console.log('Restaurants upserted: ' + stats.restaurantsUpserted);
  console.log('Geocoded: ' + geocoded);
  console.log('Details fetched: ' + detailsFetched);
  console.log('Inspections upserted: ' + stats.inspectionsUpserted);
  console.log('Errors: ' + stats.errors);
  return stats;
}

// CLI entry: `npm run sync:sioux-falls [-- --all-details]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allDetails = process.argv.includes('--all-details');
  syncSiouxFalls({ allDetails })
    .then((stats) => {
      store.recordRun('sf_sweeps', {
        status: 'success',
        restaurants_upserted: stats.restaurantsUpserted,
        inspections_upserted: stats.inspectionsUpserted,
        error: null,
      });
      const { restaurantsWritten } = store.save();
      console.log('Saved ' + restaurantsWritten + ' restaurant files');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
