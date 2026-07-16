/**
 * File-backed data store — the only persistence layer.
 *
 * The pipeline maintains a static JSON tree under apps/web/public/data/ that
 * Cloudflare Pages serves directly and both apps fetch:
 *
 *   index.json            all restaurants (list/map/search fields) + freshness meta
 *   r/<external_id>.json  full detail: restaurant + inspections + violations
 *   geocode-cache.json    normalized address -> coordinates (Nominatim results)
 *
 * Restaurants are identified by their deterministic external_id
 * (sd_doh_<name-address-city slug> or sf_sweeps_<siteId>). Inspections are
 * unique per (restaurant, date); violations unique per (inspection, code) —
 * the same constraints the old Postgres schema enforced.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.DATA_DIR ?? path.resolve(moduleDir, '../../../../apps/web/public/data');

export type Severity = 'critical' | 'major' | 'minor';

export interface StoredViolation {
  code: string;
  description: string;
  severity: Severity;
  corrected: boolean;
}

export interface StoredInspection {
  date: string; // YYYY-MM-DD
  score: number | null;
  grade: string | null;
  inspection_type: string | null;
  comments: string;
  // Known violation count, even when the individual violations weren't fetched
  // (SD DOH "Past Inspections" expander gives a count but no details/score).
  violation_count: number | null;
  violations: StoredViolation[];
}

export type GeoPrecision = 'rooftop' | 'address' | 'street' | 'city';

export interface RestaurantFields {
  external_id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code?: string | null;
  phone?: string | null;
  latitude: number;
  longitude: number;
  source: string;
  geo_precision?: GeoPrecision | null;
  // Raw address string as published by the source, for traceability when the
  // stored address is the USPS-standardized form
  source_address?: string | null;
}

export interface ScorePoint {
  date: string; // YYYY-MM-DD
  score: number;
}

export interface ViolationPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface IndexRestaurant {
  id: string; // = external_id
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  source: string;
  latest_score: number | null;
  latest_inspection_date: string | null;
  average_score: number | null;
  inspection_count: number;
  has_critical_violations: boolean;
  violation_categories: string[];
  // Compact history for trend cues (sparkline/arrow) on cards, oldest→newest,
  // last 6 inspections. Full history lives in the detail file. Score trend is
  // preferred; violation-count trend is the fallback where scores aren't
  // available over time (e.g. SD DOH past inspections carry counts, not scores).
  score_history: ScorePoint[];
  score_trend: 'up' | 'down' | 'flat' | null;
  violation_history: ViolationPoint[];
  violation_trend: 'up' | 'down' | 'flat' | null; // 'up' = improving (fewer)
  geo_precision: GeoPrecision | null;
  source_address: string | null;
}

export interface DetailRestaurant extends IndexRestaurant {
  inspections: StoredInspection[];
}

export interface SourceRun {
  status: 'success' | 'failure';
  finished_at: string;
  restaurants_upserted: number | null;
  inspections_upserted: number | null;
  error: string | null;
}

interface IndexFile {
  updated_at: string;
  sources: Record<string, SourceRun>;
  restaurants: IndexRestaurant[];
}

export interface InspectionRef {
  restaurantId: string;
  date: string;
}

// "Pests" is reserved for evidence of actual pest activity — not prevention
// citations (door gaps, screens, trap placement) and not words like "raw
// animal food" or "pesticide" that merely contain pest-ish substrings.
const PEST_NOUN = /\b(mice|mouse|rodents?|rats?|roach\w*|cockroach\w*|insects?|flies|fly|gnats?|vermin|pests?)\b/i;
const PEST_STRONG_EVIDENCE = /feces|droppings|excrement|infestation|dead (flies|insects|pests|rodents|mice)/i;
const PEST_OBSERVED = /\b(observed|noted|seen|found|present|presence|activity|alive|dead)\b/i;
const PEST_PREVENTION_ONLY = /would allow|entrance|entry of|protect|screen|door sweep|electrocution|trapping device|air curtain|fly ?strip/i;

function isPestEvidence(description: string): boolean {
  if (PEST_STRONG_EVIDENCE.test(description)) return true;
  return (
    PEST_NOUN.test(description) &&
    PEST_OBSERVED.test(description) &&
    !PEST_PREVENTION_ONLY.test(description)
  );
}

// Remaining categories, first match wins. Matched against the citation's
// code TITLE first (the text before the "—"/"(N pts):" detail) — the title
// is authoritative, whereas detail text mentions locations incidentally
// ("stored in the refrigerator" is not a temperature violation). Full-text
// matching is the fallback for titles no pattern knows.
const CATEGORY_PATTERNS: [string, RegExp][] = [
  ['handwashing', /handwash|hand wash|wash(ing)? hands/i],
  ['temperature', /temperature|hot storage|cold storage|refrigerat|cooling|heating|reheating|thawing|cooking potentially|time as a public health/i],
  ['cleanliness', /clean-in-place|cleaning frequency|cleaning and maintenance|sanitiz|surfaces? ?-? ?clean/i],
  ['contamination', /contamina|food protection|food display|food source|food supplies|date marking|dating and disposition/i],
  ['chemicals', /poison|toxic/i],
  ['plumbing', /plumbing|backflow|water supply|sewage/i],
  ['personnel', /employee|person in charge|knowledge|manager cert/i],
  ['facility', /floor|wall|ceiling|ventilation|lighting|premises|toilet|locker|linen/i],
  ['equipment', /equipment|utensil|design and construction|single-service|surfaces? ?-? ?design|\bdesign\b/i],
  ['storage', /storage|refuse|recyclable/i],
];

function citationTitle(description: string): string {
  return description.split(/—|\(\d+ ?pts?\):/)[0];
}

function categorize(description: string): string {
  if (isPestEvidence(description)) return 'pests';
  const title = citationTitle(description);
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(description)) return category;
  }
  return 'other';
}

class Store {
  private index: IndexFile | null = null;
  private details = new Map<string, DetailRestaurant>();
  private dirty = new Set<string>();
  private geocodeCache: Record<string, { lat: number; lng: number }> | null = null;
  private geocodeCacheDirty = false;

  private readJson<T>(file: string): T | null {
    const p = path.join(DATA_DIR, file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  }

  private writeJson(file: string, value: unknown): void {
    const p = path.join(DATA_DIR, file);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value) + '\n');
  }

  private loadIndex(): IndexFile {
    if (!this.index) {
      this.index = this.readJson<IndexFile>('index.json') ?? {
        updated_at: new Date().toISOString(),
        sources: {},
        restaurants: [],
      };
    }
    return this.index;
  }

  private loadDetail(id: string): DetailRestaurant | null {
    if (this.details.has(id)) return this.details.get(id)!;
    const detail = this.readJson<DetailRestaurant>(`r/${id}.json`);
    if (detail) this.details.set(id, detail);
    return detail;
  }

  /** Read a restaurant's current stored state (null when unknown). */
  getRestaurant(id: string): DetailRestaurant | null {
    return this.loadDetail(id);
  }

  /** Create or update a restaurant; returns its id (= external_id). */
  upsertRestaurant(fields: RestaurantFields): string {
    const id = fields.external_id;
    const existing = this.loadDetail(id);
    const detail: DetailRestaurant = existing ?? {
      id,
      name: fields.name,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      zip_code: fields.zip_code ?? null,
      phone: fields.phone ?? null,
      latitude: fields.latitude,
      longitude: fields.longitude,
      source: fields.source,
      latest_score: null,
      latest_inspection_date: null,
      average_score: null,
      inspection_count: 0,
      has_critical_violations: false,
      violation_categories: [],
      score_history: [],
      score_trend: null,
      violation_history: [],
      violation_trend: null,
      geo_precision: null,
      source_address: null,
      inspections: [],
    };
    detail.name = fields.name;
    detail.address = fields.address;
    detail.city = fields.city;
    detail.state = fields.state;
    if (fields.zip_code !== undefined) detail.zip_code = fields.zip_code;
    if (fields.phone !== undefined) detail.phone = fields.phone;
    detail.latitude = fields.latitude;
    detail.longitude = fields.longitude;
    detail.source = fields.source;
    if (fields.geo_precision !== undefined) detail.geo_precision = fields.geo_precision;
    if (fields.source_address !== undefined) detail.source_address = fields.source_address;

    this.details.set(id, detail);
    this.dirty.add(id);
    return id;
  }

  /**
   * Upsert an inspection, unique per (restaurant, date). Merges rather than
   * clobbers: a scoreless source (e.g. the Past Inspections expander) never
   * overwrites a score/grade/comments we already learned from a richer source.
   */
  upsertInspection(
    restaurantId: string,
    fields: {
      date: string;
      score: number | null;
      grade?: string | null;
      inspection_type?: string | null;
      comments?: string;
      violationCount?: number | null;
    }
  ): InspectionRef {
    const detail = this.loadDetail(restaurantId);
    if (!detail) throw new Error(`upsertInspection: unknown restaurant ${restaurantId}`);

    let inspection = detail.inspections.find((i) => i.date === fields.date);
    if (!inspection) {
      inspection = {
        date: fields.date,
        score: fields.score,
        grade: fields.grade ?? null,
        inspection_type: fields.inspection_type ?? null,
        comments: fields.comments ?? '',
        violation_count: fields.violationCount ?? null,
        violations: [],
      };
      detail.inspections.push(inspection);
    } else {
      if (fields.score !== null && fields.score !== undefined) {
        inspection.score = fields.score;
        if (fields.grade !== undefined) inspection.grade = fields.grade;
      }
      if (fields.inspection_type) inspection.inspection_type = fields.inspection_type;
      if (fields.comments) inspection.comments = fields.comments;
      if (fields.violationCount !== undefined && fields.violationCount !== null) {
        inspection.violation_count = fields.violationCount;
      }
    }

    this.dirty.add(restaurantId);
    return { restaurantId, date: fields.date };
  }

  /** Upsert a violation, unique per (inspection, code). */
  upsertViolation(ref: InspectionRef, violation: StoredViolation): void {
    const detail = this.loadDetail(ref.restaurantId);
    const inspection = detail?.inspections.find((i) => i.date === ref.date);
    if (!detail || !inspection) {
      throw new Error(`upsertViolation: unknown inspection ${ref.restaurantId} ${ref.date}`);
    }
    const existing = inspection.violations.findIndex((v) => v.code === violation.code);
    if (existing >= 0) inspection.violations[existing] = violation;
    else inspection.violations.push(violation);
    this.dirty.add(ref.restaurantId);
  }

  /** Index rows for one source (used by the SWEEPS pipeline to diff). */
  getRestaurantsBySource(source: string): IndexRestaurant[] {
    return this.loadIndex().restaurants.filter((r) => r.source === source);
  }

  getCachedGeocode(address: string): { lat: number; lng: number } | null {
    if (!this.geocodeCache) {
      this.geocodeCache =
        this.readJson<Record<string, { lat: number; lng: number }>>('geocode-cache.json') ?? {};
    }
    return this.geocodeCache[address.toLowerCase().trim()] ?? null;
  }

  setCachedGeocode(address: string, coords: { lat: number; lng: number }): void {
    if (!this.geocodeCache) {
      this.geocodeCache =
        this.readJson<Record<string, { lat: number; lng: number }>>('geocode-cache.json') ?? {};
    }
    this.geocodeCache[address.toLowerCase().trim()] = coords;
    this.geocodeCacheDirty = true;
  }

  /** Drop every cached geocode (used when rebuilding with validated results). */
  clearGeocodeCache(): void {
    this.geocodeCache = {};
    this.geocodeCacheDirty = true;
  }

  // USPS standardization cache: key -> canonical form (null = unknown to USPS)
  private uspsCache: Record<string, unknown> | null = null;
  private uspsCacheDirty = false;

  getCachedUsps<T>(key: string): T | null | undefined {
    if (!this.uspsCache) {
      this.uspsCache = this.readJson<Record<string, unknown>>('usps-cache.json') ?? {};
    }
    if (!(key in this.uspsCache)) return undefined;
    return this.uspsCache[key] as T | null;
  }

  setCachedUsps(key: string, value: unknown): void {
    if (!this.uspsCache) {
      this.uspsCache = this.readJson<Record<string, unknown>>('usps-cache.json') ?? {};
    }
    this.uspsCache[key] = value;
    this.uspsCacheDirty = true;
  }

  /** Record a sync run's outcome — replaces the old sync_runs table. */
  recordRun(source: string, run: Omit<SourceRun, 'finished_at'>): void {
    this.loadIndex().sources[source] = { ...run, finished_at: new Date().toISOString() };
  }

  /**
   * Load every detail file and mark it dirty so the next save() recomputes all
   * derived fields and rebuilds the index. Use after changing derived-field
   * logic (no re-sync needed).
   */
  reindexAll(): number {
    const dir = path.join(DATA_DIR, 'r');
    if (!existsSync(dir)) return 0;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      const detail = this.readJson<DetailRestaurant>(`r/${file}`);
      if (detail) {
        this.details.set(id, detail);
        this.dirty.add(id);
      }
    }
    return this.dirty.size;
  }

  /**
   * Recompute derived fields for touched restaurants and write everything out.
   * Ported from the update_restaurant_stats (001) and
   * update_restaurant_violation_summary (003) triggers.
   */
  save(): { restaurantsWritten: number } {
    const index = this.loadIndex();
    const byId = new Map(index.restaurants.map((r) => [r.id, r]));

    for (const id of this.dirty) {
      const detail = this.details.get(id)!;

      // Newest first — the apps and the derived fields both want this order
      detail.inspections.sort((a, b) => b.date.localeCompare(a.date));
      const latest = detail.inspections[0] ?? null;
      const scored = detail.inspections.filter((i) => i.score !== null);

      detail.latest_inspection_date = latest?.date ?? null;
      detail.latest_score = scored[0]?.score ?? null; // most recent scored
      detail.inspection_count = detail.inspections.length;
      detail.average_score = scored.length
        ? Math.round((scored.reduce((sum, i) => sum + i.score!, 0) / scored.length) * 10) / 10
        : null;
      detail.has_critical_violations = (latest?.violations ?? []).some(
        (v) => v.severity === 'critical'
      );
      detail.violation_categories = [
        ...new Set((latest?.violations ?? []).map((v) => categorize(v.description))),
      ].sort();

      // Compact score history (oldest→newest) + trend vs the previous scored
      // inspection. `scored` is newest-first from the sort above.
      detail.score_history = scored
        .slice(0, 6)
        .map((i) => ({ date: i.date, score: i.score! }))
        .reverse();
      if (scored.length >= 2) {
        const delta = scored[0].score! - scored[1].score!;
        detail.score_trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      } else {
        detail.score_trend = null;
      }

      // Violation-count history (fallback trend where scores aren't available
      // over time). Prefer fetched-violation length, else the known count.
      // `inspections` is newest-first. 'up' = improving = fewer violations.
      const counted = detail.inspections
        .map((i) => ({
          date: i.date,
          count: i.violations.length > 0 ? i.violations.length : i.violation_count,
        }))
        .filter((x): x is ViolationPoint => x.count !== null && x.count !== undefined);
      detail.violation_history = counted.slice(0, 6).map((x) => ({ date: x.date, count: x.count })).reverse();
      if (counted.length >= 2) {
        const delta = counted[0].count - counted[1].count;
        detail.violation_trend = delta < 0 ? 'up' : delta > 0 ? 'down' : 'flat';
      } else {
        detail.violation_trend = null;
      }

      this.writeJson(`r/${id}.json`, detail);

      const { inspections: _inspections, ...indexRow } = detail;
      byId.set(id, indexRow);
    }

    const written = this.dirty.size;
    if (written > 0 || !existsSync(path.join(DATA_DIR, 'index.json'))) {
      index.restaurants = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      index.updated_at = new Date().toISOString();
    }
    // Always write the index so recordRun() metadata lands even on no-op runs
    this.writeJson('index.json', index);

    if (this.geocodeCacheDirty) {
      this.writeJson('geocode-cache.json', this.geocodeCache);
      this.geocodeCacheDirty = false;
    }
    if (this.uspsCacheDirty) {
      this.writeJson('usps-cache.json', this.uspsCache);
      this.uspsCacheDirty = false;
    }

    this.dirty.clear();
    return { restaurantsWritten: written };
  }
}

export const store = new Store();
export { DATA_DIR };
