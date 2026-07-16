import 'dotenv/config';
import { SDDOHSource } from '../sources/sd-doh.js';
import { store } from '../lib/store.js';

async function main() {
  console.log('Starting full sync of SD DOH inspection data...');
  console.log(`Started at: ${new Date().toISOString()}`);

  const pipeline = new SDDOHSource({
    mode: 'full',
  });

  try {
    await pipeline.initialize();
    await pipeline.syncAll();
    const { restaurantsWritten } = store.save();
    console.log('Saved ' + restaurantsWritten + ' restaurant files');
    console.log('\nFull sync completed successfully!');
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await pipeline.close();
  }

  console.log(`Finished at: ${new Date().toISOString()}`);
}

main();
