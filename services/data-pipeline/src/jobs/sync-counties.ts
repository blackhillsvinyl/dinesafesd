import 'dotenv/config';
import { SDDOHSource } from '../sources/sd-doh.js';
import { store } from '../lib/store.js';

// Comma-separated so multi-word names ("Fall River", "Oglala Lakota") survive
// shell tokenization; plain space-separated single-word names still work.
const counties = process.argv.slice(2).join(' ').split(',').map((s) => s.trim()).filter(Boolean);

if (counties.length === 0) {
  console.error('Usage: tsx src/jobs/sync-counties.ts <County1>[,County2,...]');
  console.error('Example: tsx src/jobs/sync-counties.ts "Minnehaha,Fall River"');
  process.exit(1);
}

async function main() {
  console.log(`Syncing ${counties.length} county(ies): ${counties.join(', ')}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const pipeline = new SDDOHSource({
    mode: 'full',
    counties,
  });

  try {
    await pipeline.initialize();
    await pipeline.syncAll();
    const { restaurantsWritten } = store.save();
    console.log('Saved ' + restaurantsWritten + ' restaurant files');
    console.log('\nSync completed successfully!');
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await pipeline.close();
  }

  console.log(`Finished at: ${new Date().toISOString()}`);
}

main();
