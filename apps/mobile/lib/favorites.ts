/**
 * Local favorites storage, persisted with AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dinesafesd_favorites';

let store: Set<string> | null = null;

async function load(): Promise<Set<string>> {
  if (store) return store;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    store = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    store = new Set();
  }
  return store;
}

async function save(s: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // Persisting is best-effort; the in-memory set still serves this session
  }
}

export async function getFavorites(): Promise<string[]> {
  return Array.from(await load());
}

export async function addFavorite(id: string): Promise<void> {
  const s = await load();
  s.add(id);
  await save(s);
}

export async function removeFavorite(id: string): Promise<void> {
  const s = await load();
  s.delete(id);
  await save(s);
}

export async function isFavorite(id: string): Promise<boolean> {
  return (await load()).has(id);
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const s = await load();
  const nowFavorite = !s.has(id);
  if (nowFavorite) s.add(id);
  else s.delete(id);
  await save(s);
  return nowFavorite;
}
