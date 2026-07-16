import { store } from '../lib/store.js';

// Recompute all derived fields + the index from existing detail files.
// No syncing. Run after changing derived-field logic in the store.
const marked = store.reindexAll();
const { restaurantsWritten } = store.save();
console.log('reindexed ' + marked + ' restaurants, wrote ' + restaurantsWritten + ' files');
