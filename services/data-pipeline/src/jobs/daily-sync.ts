import 'dotenv/config';
import { store } from '../lib/store.js';
import { SDDOHSource } from '../sources/sd-doh.js';
import { syncSiouxFalls } from './sync-sioux-falls.js';

/**
 * Daily sync of all South Dakota sources.
 *
 * Runs each source independently — one failing doesn't abort the other —
 * records each source's outcome in index.json (shown as "Data updated X ago"
 * in the apps), saves the store, and exits non-zero if any source failed.
 */

async function runSDDOH(full: boolean): Promise<boolean> {
  let pipeline: SDDOHSource;
  if (full) {
    console.log('\n========== SD DOH (statewide, full history) ==========');
    pipeline = new SDDOHSource({ mode: 'full' });
  } else {
    console.log('\n========== SD DOH (statewide, last 7 days) ==========');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    pipeline = new SDDOHSource({ mode: 'incremental', dateRange: { start: startDate, end: endDate } });
  }

  try {
    await pipeline.initialize();
    await pipeline.syncAll();
    const stats = pipeline.getStats();
    store.recordRun('sd_doh', {
      status: 'success',
      restaurants_upserted: stats.restaurants,
      inspections_upserted: stats.inspections,
      error: null,
    });
    return true;
  } catch (error) {
    console.error('SD DOH sync failed:', error);
    store.recordRun('sd_doh', {
      status: 'failure',
      restaurants_upserted: null,
      inspections_upserted: null,
      error: String(error),
    });
    return false;
  } finally {
    await pipeline.close();
  }
}

async function runSweeps(allDetails: boolean): Promise<boolean> {
  console.log('\n========== Sioux Falls SWEEPS ==========');

  try {
    const stats = await syncSiouxFalls({ allDetails });
    store.recordRun('sf_sweeps', {
      status: 'success',
      restaurants_upserted: stats.restaurantsUpserted,
      inspections_upserted: stats.inspectionsUpserted,
      error: null,
    });
    return true;
  } catch (error) {
    console.error('Sioux Falls SWEEPS sync failed:', error);
    store.recordRun('sf_sweeps', {
      status: 'failure',
      restaurants_upserted: null,
      inspections_upserted: null,
      error: String(error),
    });
    return false;
  }
}

async function main() {
  // `--full`: statewide full-history SD DOH + refetch every SWEEPS detail page.
  const full = process.argv.includes('--full');
  const allDetails = full || process.argv.includes('--all-details');
  console.log('Starting ' + (full ? 'FULL' : 'daily') + ' SD sync at ' + new Date().toISOString());

  const sdOk = await runSDDOH(full);
  const sfOk = await runSweeps(allDetails);

  const { restaurantsWritten } = store.save();

  console.log('\n========== DAILY SYNC RESULT ==========');
  console.log('SD DOH: ' + (sdOk ? 'success' : 'FAILURE'));
  console.log('Sioux Falls SWEEPS: ' + (sfOk ? 'success' : 'FAILURE'));
  console.log('Restaurant files written: ' + restaurantsWritten);
  console.log('Finished at ' + new Date().toISOString());

  if (!sdOk || !sfOk) process.exit(1);
}

main();
