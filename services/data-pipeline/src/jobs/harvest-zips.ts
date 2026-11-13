import 'dotenv/config';
import { SDDOHSource } from '../sources/sd-doh.js';
import { store } from '../lib/store.js';
import { dohRunComplete } from '../lib/run-record.js';

/**
 * One-shot statewide ZIP harvest: walk every county's listing pages on the
 * DOH portal (which prints "ADDRESS City, SD ZIP" for every establishment)
 * and attach the portal's own ZIP to each existing record. List pages only —
 * no per-establishment requests, no geocoding, no PDFs.
 *
 * Usage: npm run harvest:zips
 */
async function main() {
  console.log('Starting statewide ZIP harvest from the DOH portal...');
  console.log(`Started at: ${new Date().toISOString()}`);

  const pipeline = new SDDOHSource({ mode: 'zip-harvest' });

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
    console.log('\nZIP harvest completed!');
  } catch (error) {
    console.error('Harvest failed:', error);
    process.exit(1);
  } finally {
    await pipeline.close();
  }

  console.log(`Finished at: ${new Date().toISOString()}`);
}

main();
