import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { store, type GeoPrecision } from '../lib/store.js';

/**
 * Additively merge another data snapshot into the working-tree store.
 *
 * Used by CI when `git pull --rebase` hits content conflicts: two sync runs
 * (e.g. a county history re-sync and a score backfill) each derived new data
 * from an older base, and git can't merge JSON. This job resolves at the data
 * level instead — every restaurant/inspection from the other snapshot is
 * upserted into ours, relying on the store's merge semantics (a scoreless row
 * never clobbers a known score; inspections are unique per restaurant+date).
 *
 * Usage: tsx src/jobs/merge-data.ts <theirs-data-dir>
 *   e.g. tsx src/jobs/merge-data.ts /tmp/theirs/apps/web/public/data
 */

const PRECISION_RANK: Record<string, number> = { rooftop: 4, address: 3, street: 2, city: 1 };

interface AnyDetail {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  phone?: string | null;
  latitude: number;
  longitude: number;
  source: string;
  geo_precision?: GeoPrecision | null;
  source_address?: string | null;
  inspections: Array<{
    date: string;
    score: number | null;
    grade: string | null;
    inspection_type: string | null;
    comments: string;
    violation_count: number | null;
    violations: Array<{ code: string; description: string; severity: string; corrected: boolean }>;
  }>;
}

function mergeCacheFile(oursDir: string, theirsDir: string, file: string): void {
  const oursPath = path.join(oursDir, file);
  const theirsPath = path.join(theirsDir, file);
  if (!existsSync(theirsPath)) return;
  const theirs = JSON.parse(readFileSync(theirsPath, 'utf8'));
  const ours = existsSync(oursPath) ? JSON.parse(readFileSync(oursPath, 'utf8')) : {};
  writeFileSync(oursPath, JSON.stringify({ ...theirs, ...ours }) + '\n');
}

function main() {
  const theirsDir = process.argv[2];
  if (!theirsDir || !existsSync(path.join(theirsDir, 'r'))) {
    console.error('Usage: tsx src/jobs/merge-data.ts <theirs-data-dir>');
    process.exit(1);
  }
  const oursDir =
    process.env.DATA_DIR ??
    path.resolve(import.meta.dirname, '../../../../apps/web/public/data');

  let restaurants = 0;
  let inspectionsAdded = 0;

  for (const file of readdirSync(path.join(theirsDir, 'r'))) {
    if (!file.endsWith('.json')) continue;
    const theirs = JSON.parse(
      readFileSync(path.join(theirsDir, 'r', file), 'utf8')
    ) as AnyDetail;
    const ours = store.getRestaurant(theirs.id);
    restaurants++;

    // Restaurant-level fields: prefer theirs (usually the newer sync), but
    // never lose a value or downgrade geocode precision we already have.
    const ourRank = PRECISION_RANK[ours?.geo_precision ?? ''] ?? 0;
    const theirRank = PRECISION_RANK[theirs.geo_precision ?? ''] ?? 0;
    const keepOurCoords = ours !== null && ourRank > theirRank;
    store.upsertRestaurant({
      external_id: theirs.id,
      name: theirs.name,
      address: theirs.address,
      city: theirs.city,
      state: theirs.state,
      zip_code: theirs.zip_code ?? ours?.zip_code ?? null,
      phone: theirs.phone ?? ours?.phone ?? null,
      latitude: keepOurCoords ? ours.latitude : theirs.latitude,
      longitude: keepOurCoords ? ours.longitude : theirs.longitude,
      geo_precision: keepOurCoords ? ours.geo_precision : (theirs.geo_precision ?? null),
      source_address: theirs.source_address ?? ours?.source_address ?? null,
      source: theirs.source,
    });

    for (const insp of theirs.inspections) {
      const hadInspection = ours?.inspections.some((i) => i.date === insp.date) ?? false;
      const oursHadViolations =
        (ours?.inspections.find((i) => i.date === insp.date)?.violations.length ?? 0) > 0;
      const ref = store.upsertInspection(theirs.id, {
        date: insp.date,
        score: insp.score,
        grade: insp.grade,
        inspection_type: insp.inspection_type,
        comments: insp.comments,
        violationCount: insp.violation_count,
      });
      if (!hadInspection) inspectionsAdded++;
      // Violations: take theirs only when we have none for that inspection —
      // the two sides can use different code systems (portal citation codes
      // vs PDF scoresheet item numbers), so mixing them would double-count.
      if (!oursHadViolations) {
        for (const v of insp.violations) {
          store.upsertViolation(ref, {
            code: v.code,
            description: v.description,
            severity: v.severity as 'critical' | 'major' | 'minor',
            corrected: v.corrected,
          });
        }
      }
    }
  }

  mergeCacheFile(oursDir, theirsDir, 'geocode-cache.json');
  mergeCacheFile(oursDir, theirsDir, 'usps-cache.json');

  const { restaurantsWritten } = store.save();
  console.log(
    `Merged ${restaurants} restaurants from ${theirsDir}: ` +
      `${inspectionsAdded} inspections added, ${restaurantsWritten} files written`
  );
}

main();
