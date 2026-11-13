import { useEffect } from 'react';
import { SITE_ORIGIN } from './meta';
import type { PageMeta } from './meta';

function setMeta(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const metaTag = (key: 'name' | 'property', value: string) => () => {
  const m = document.createElement('meta');
  m.setAttribute(key, value);
  return m;
};

/** Keeps the document head in step with the current route during SPA navigation. */
export function applyPageMeta(meta: PageMeta): void {
  const url = SITE_ORIGIN + meta.path;
  document.title = meta.title;
  setMeta('meta[name="description"]', metaTag('name', 'description'), 'content', meta.description);
  setMeta(
    'link[rel="canonical"]',
    () => {
      const l = document.createElement('link');
      l.setAttribute('rel', 'canonical');
      return l;
    },
    'href',
    url
  );
  setMeta('meta[property="og:title"]', metaTag('property', 'og:title'), 'content', meta.title);
  setMeta('meta[property="og:description"]', metaTag('property', 'og:description'), 'content', meta.description);
  setMeta('meta[property="og:url"]', metaTag('property', 'og:url'), 'content', url);
  const robots = document.head.querySelector('meta[name="robots"]');
  if (meta.noindex) {
    setMeta('meta[name="robots"]', metaTag('name', 'robots'), 'content', 'noindex');
  } else if (robots) {
    robots.remove();
  }
}

export function usePageMeta(meta: PageMeta): void {
  const { title, description, path, noindex } = meta;
  useEffect(() => {
    applyPageMeta({ title, description, path, noindex });
  }, [title, description, path, noindex]);
}
