import 'dotenv/config';
import { SDDOHSource } from '../sources/sd-doh.js';
import { store } from '../lib/store.js';

async function main() {
  console.log('Starting TEST sync (single county)...');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Just sync one county for testing
  const pipeline = new SDDOHSource({
    mode: 'full',
    counties: ['Minnehaha'], // Sioux Falls county - most establishments
  });

  try {
    await pipeline.initialize();
    const { failedCounties } = await pipeline.syncAll();
    const { restaurantsWritten } = store.save();
    console.log('Saved ' + restaurantsWritten + ' restaurant files');
    if (failedCounties.length) {
      // Progress is saved, but the run did not cover everything it was asked to
      console.error('INCOMPLETE: could not read ' + failedCounties.join(', '));
      process.exitCode = 1;
      return;
    }
    console.log('\nTest sync completed successfully!');
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await pipeline.close();
  }

  console.log(`Finished at: ${new Date().toISOString()}`);
}

main();
