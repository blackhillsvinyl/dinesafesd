import { useSyncExternalStore } from 'react';

// Favorites (♥) and watches (👁), kept in localStorage — no accounts.
// A watch remembers the latest inspection date you've seen, so the UI can
// flag watched restaurants whose latest report changed since your last look.

const FAV_KEY = 'dinesafe:favorites';
const WATCH_KEY = 'dinesafe:watches';

type Watches = Record<string, string>; // id -> last seen latest_inspection_date

function loadFavs(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function loadWatches(): Watches {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    return raw ? (JSON.parse(raw) as Watches) : {};
  } catch {
    return {};
  }
}

let favs = loadFavs();
let watches = loadWatches();
let version = 0;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
    localStorage.setItem(WATCH_KEY, JSON.stringify(watches));
  } catch {
    /* storage full/blocked — keep in-memory state */
  }
  version++;
  listeners.forEach((l) => l());
}

// Cross-tab sync
window.addEventListener('storage', (e) => {
  if (e.key === FAV_KEY || e.key === WATCH_KEY) {
    favs = loadFavs();
    watches = loadWatches();
    version++;
    listeners.forEach((l) => l());
  }
});

/** Re-renders the caller whenever favorites/watches change (any tab). */
export function useSavedVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
}

export function isFavorite(id: string): boolean {
  return favs.has(id);
}

export function toggleFavorite(id: string): void {
  if (!favs.delete(id)) favs.add(id);
  persist();
}

export function isWatched(id: string): boolean {
  return id in watches;
}

/** Toggling a watch ON records the current latest date as "seen". */
export function toggleWatch(id: string, latestInspectionDate: string | null): void {
  if (id in watches) delete watches[id];
  else watches[id] = latestInspectionDate ?? '';
  persist();
}

/** True when a watched restaurant's latest report is newer than last seen. */
export function hasNewReport(id: string, latestInspectionDate: string | null): boolean {
  if (!(id in watches) || !latestInspectionDate) return false;
  return latestInspectionDate > watches[id];
}

/** Viewing the full report catches the watch up to the latest date. */
export function markSeen(id: string, latestInspectionDate: string | null): void {
  if (!(id in watches)) return;
  const d = latestInspectionDate ?? '';
  if (watches[id] === d) return;
  watches[id] = d;
  persist();
}

export function favoriteCount(): number {
  return favs.size;
}

export function watchCount(): number {
  return Object.keys(watches).length;
}
