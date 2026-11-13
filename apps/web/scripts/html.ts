import { SITE_NAME, SITE_ORIGIN, SOCIAL_IMAGE } from '../src/lib/meta';
import type { PageMeta } from '../src/lib/meta';

// Pure string builders for the prerender step. No file access here, so the
// rules (escaping, canonical URLs, sitemap shape) are unit-testable.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON that is safe inside a <script> element. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function headBlock(meta: PageMeta, jsonLd?: unknown): string {
  const url = SITE_ORIGIN + meta.path;
  const lines = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    ...(meta.noindex
      ? ['<meta name="robots" content="noindex" />']
      : [`<link rel="canonical" href="${escapeHtml(url)}" />`]),
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    ...(meta.noindex ? [] : [`<meta property="og:url" content="${escapeHtml(url)}" />`]),
    `<meta property="og:image" content="${SOCIAL_IMAGE}" />`,
    '<meta name="twitter:card" content="summary" />',
    ...(jsonLd ? [`<script type="application/ld+json">${safeJson(jsonLd)}</script>`] : []),
  ];
  return lines.join('\n    ');
}

const META_BLOCK = /<!--page-meta-->[\s\S]*?<!--\/page-meta-->/;
const ROOT = '<div id="root"></div>';

export interface PageOptions {
  meta: PageMeta;
  /** Markup placed inside #root; React replaces it when the app starts. */
  body: string;
  jsonLd?: unknown;
  updatedAt?: string | null;
  kind?: 'restaurant';
}

/** Fills the built app shell with one page's head tags and initial markup. */
export function renderPage(shell: string, o: PageOptions): string {
  if (!META_BLOCK.test(shell)) throw new Error('index.html is missing the <!--page-meta--> block');
  if (!shell.includes(ROOT)) throw new Error('index.html is missing <div id="root"></div>');
  const attrs = [
    o.updatedAt ? ` data-updated-at="${escapeHtml(o.updatedAt)}"` : '',
    o.kind ? ` data-prerendered="${o.kind}"` : '',
  ].join('');
  return shell
    .replace(META_BLOCK, () => `<!--page-meta-->\n    ${headBlock(o.meta, o.jsonLd)}\n    <!--/page-meta-->`)
    .replace(ROOT, () => `<div id="root"${attrs}>${o.body}</div>`);
}

export interface SitemapEntry {
  path: string;
  /** YYYY-MM-DD */
  lastmod?: string | null;
}

export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const lastmod = e.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod) ? `<lastmod>${e.lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeHtml(SITE_ORIGIN + e.path)}</loc>${lastmod}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ''].join('\n');
}
