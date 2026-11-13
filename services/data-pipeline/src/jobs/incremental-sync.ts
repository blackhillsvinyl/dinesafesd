import 'dotenv/config';
import { SDDOHSource } from '../sources/sd-doh.js';
import { store } from '../lib/store.js';
import { dohRunComplete } from '../lib/run-record.js';

async function main() {
  console.log('Starting incremental sync of SD DOH inspection data...');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Sync inspections from the last 7 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  console.log(`Date range: ${startDate.toDateString()} to ${endDate.toDateString()}`);

  const pipeline = new SDDOHSource({
    mode: 'incremental',
    dateRange: { start: startDate, end: endDate },
  });

  try {
    await pipeline.initialize();
    const failed = await pipeline.syncAll();
    const { restaurantsWritten } = store.save();
    console.log('Saved ' + restaurantsWritten + ' restaurant files');
    if (!dohRunComplete(failed)) {
      // Progress is saved, but the run did not cover everything it was asked to
      console.error('INCOMPLETE: could not read ' + [...failed.failedCounties, ...failed.failedRecords].join('; '));
      process.exitCode = 1;
      return;
    }
    console.log('\nIncremental sync completed successfully!');
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await pipeline.close();
  }

  console.log(`Finished at: ${new Date().toISOString()}`);
}

main();
