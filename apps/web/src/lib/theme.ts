import { useSyncExternalStore } from 'react';

// User-selectable theme, persisted on the device. 'auto' follows the OS.
export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'dinesafe:theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function load(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

let pref: ThemePref = load();
const listeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  // Keep the browser chrome color in step with the effective theme
  const dark = pref === 'dark' || (pref === 'auto' && media.matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', dark ? '#101a2e' : '#ffffff');
    m.removeAttribute('media');
  }
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    if (p === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
  apply();
  listeners.forEach((l) => l());
}

export function effectiveDark(): boolean {
  return pref === 'dark' || (pref === 'auto' && media.matches);
}

/** Subscribes to both the user preference and the OS scheme. */
export function useEffectiveDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      media.addEventListener('change', cb);
      return () => {
        listeners.delete(cb);
        media.removeEventListener('change', cb);
      };
    },
    effectiveDark
  );
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pref
  );
}

apply();
