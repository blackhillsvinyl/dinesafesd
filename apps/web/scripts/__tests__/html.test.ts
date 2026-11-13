import { describe, expect, it } from 'vitest';
import { buildSitemap, headBlock, renderPage, robotsTxt, safeJson } from '../html';
import { restaurantJsonLd, restaurantMeta } from '../../src/lib/meta';
import type { RestaurantDetail } from '../../src/types';

const SHELL = `<html><head>
    <!--page-meta-->
    <title>Home</title>
    <!--/page-meta-->
  </head><body><div id="root"></div></body></html>`;

const detail: RestaurantDetail = {
  id: 'sd_doh_test-cafe-1-main-st-pierre',
  name: 'TEST "CAFE" & <GRILL>',
  address: '1 Main ST',
  city: 'Pierre',
  state: 'SD',
  zip_code: '57501',
  phone: null,
  latitude: 44.37,
  longitude: -100.35,
  source: 'sd_doh',
  latest_score: 98,
  latest_inspection_date: '2026-07-20',
  average_score: 98,
  inspection_count: 1,
  has_critical_violations: true,
  violation_categories: ['contamination'],
  score_history: [],
  score_trend: null,
  violation_history: [{ date: '2026-07-20', count: 1 }],
  violation_trend: null,
  geo_precision: 'street',
  inspections: [
    {
      date: '2026-07-20',
      score: 98,
      grade: 'A',
      inspection_type: 'Routine',
      comments: '',
      violation_count: 1,
      violations: [{ code: '44:02:07:24', description: 'x', severity: 'critical', corrected: false }],
    },
  ],
};

describe('restaurant page metadata', () => {
  const meta = restaurantMeta(detail);

  it('is unique to the restaurant and states the inspection date and score', () => {
    expect(meta.title).toContain('TEST "CAFE" & <GRILL>');
    expect(meta.title).toContain('Pierre, SD');
    expect(meta.description).toContain('Latest inspection July 20, 2026');
    expect(meta.description).toContain('score 98 out of 100');
    expect(meta.description).toContain('1 violation recorded');
    expect(meta.path).toBe('/r/sd_doh_test-cafe-1-main-st-pierre');
  });

  it('escapes names in head tags and sets the canonical URL', () => {
    const head = headBlock(meta);
    expect(head).toContain('<title>TEST &quot;CAFE&quot; &amp; &lt;GRILL&gt;');
    expect(head).toContain(
      '<link rel="canonical" href="https://dinesafesd.com/r/sd_doh_test-cafe-1-main-st-pierre" />'
    );
    expect(head).toContain('property="og:title"');
    expect(head).not.toContain('<GRILL>');
  });

  it('describes a business at an address — never a rating or review', () => {
    const ld = safeJson(restaurantJsonLd(detail, meta));
    expect(ld).toContain('"@type":"LocalBusiness"');
    expect(ld).not.toMatch(/rating|review/i);
    // street-level coordinates are not verified, so no geo is published
    expect(ld).not.toContain('GeoCoordinates');
    expect(ld).not.toContain('<');
  });
});

describe('renderPage', () => {
  it('fills head and root, and marks restaurant pages for the app', () => {
    const html = renderPage(SHELL, {
      meta: restaurantMeta(detail),
      body: '<h1>x</h1>',
      updatedAt: '2026-11-08T18:23:29.785Z',
      kind: 'restaurant',
    });
    expect(html).toContain('<div id="root" data-updated-at="2026-11-08T18:23:29.785Z" data-prerendered="restaurant"><h1>x</h1></div>');
    expect(html).not.toContain('<title>Home</title>');
  });

  it('marks not-found pages noindex with no canonical', () => {
    const head = headBlock({ title: 't', description: 'd', path: '/', noindex: true });
    expect(head).toContain('<meta name="robots" content="noindex" />');
    expect(head).not.toContain('rel="canonical"');
  });

  it('fails loudly if the shell loses its markers', () => {
    expect(() => renderPage('<html></html>', { meta: restaurantMeta(detail), body: '' })).toThrow();
  });
});

describe('sitemap and robots', () => {
  it('emits valid absolute URLs with optional lastmod', () => {
    const xml = buildSitemap([
      { path: '/', lastmod: '2026-11-08' },
      { path: '/r/a', lastmod: null },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<url><loc>https://dinesafesd.com/</loc><lastmod>2026-11-08</lastmod></url>');
    expect(xml).toContain('<url><loc>https://dinesafesd.com/r/a</loc></url>');
  });

  it('points robots at the sitemap', () => {
    expect(robotsTxt()).toContain('Sitemap: https://dinesafesd.com/sitemap.xml');
  });
});
