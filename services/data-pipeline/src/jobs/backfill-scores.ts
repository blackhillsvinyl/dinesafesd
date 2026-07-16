import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { store, DATA_DIR } from '../lib/store.js';
import { SDDOHSource } from '../sources/sd-doh.js';

/**
 * PDF score backfill: historical SD DOH inspections captured from the "Past
 * Inspections" expander carry dates and violation counts but no scores —
 * scores live only in each inspection's PDF report. This job walks the portal
 * and downloads/parses the report PDF for every stored inspection that lacks
 * a score, filling in true score history (and violation details).
 *
 * Usage: tsx src/jobs/backfill-scores.ts [County ...]   (default: all counties)
 */

function buildTargets(): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>();
  const dir = path.join(DATA_DIR, 'r');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    if (d.source !== 'sd_doh') continue;
    const dates = d.inspections
      .filter((i: { score: number | null }) => i.score === null)
      .map((i: { date: string }) => i.date);
    if (dates.length) targets.set(d.id, new Set(dates));
  }
  return targets;
}

async function main() {
  // Comma-separated so multi-word names ("Fall River") survive shell tokenization
  const counties = process.argv.slice(2).join(' ').split(',').map((s) => s.trim()).filter(Boolean);
  const targets = buildTargets();
  const total = [...targets.values()].reduce((n, s) => n + s.size, 0);
  console.log(`Backfill targets: ${targets.size} restaurants, ${total} scoreless inspections`);
  if (targets.size === 0) return;

  const pipeline = new SDDOHSource({
    mode: 'backfill-scores',
    backfillTargets: targets,
    ...(counties.length ? { counties } : {}),
  });

  const startedAt = new Date();
  try {
    await pipeline.initialize();
    await pipeline.syncAll();
    store.recordRun('sd_doh', {
      status: 'success',
      restaurants_upserted: 0,
      inspections_upserted: pipeline.getStats().inspections,
      error: null,
    });
  } catch (error) {
    console.error('Backfill failed:', error);
    store.recordRun('sd_doh', {
      status: 'failure',
      restaurants_upserted: null,
      inspections_upserted: null,
      error: String(error),
    });
    process.exitCode = 1;
  } finally {
    const { restaurantsWritten } = store.save();
    console.log(`Scores filled: ${pipeline.getStats().inspections} | files written: ${restaurantsWritten}`);
    console.log(`Elapsed: ${Math.round((Date.now() - startedAt.getTime()) / 60000)} min`);
    await pipeline.close();
  }
}

main();
