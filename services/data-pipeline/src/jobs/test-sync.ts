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
    await pipeline.syncAll();
    const { restaurantsWritten } = store.save();
    console.log('Saved ' + restaurantsWritten + ' restaurant files');
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
