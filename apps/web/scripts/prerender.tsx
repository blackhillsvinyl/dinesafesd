// Build step (runs after `vite build`): writes real HTML for every public URL
// into dist/, from the same JSON the pipeline publishes and the same React
// component the app renders. Because the daily data workflow rebuilds the web
// app whenever data changes, these pages stay in step with the data.
//
//   dist/r/<id>.html   one per restaurant: unique head tags + the full report
//   dist/<route>.html  search, latest, about, privacy, terms, support
//   dist/404.html      real 404 for unknown URLs (also turns off the host's
//                      "serve index.html for everything" SPA fallback)
//   dist/sitemap.xml, dist/robots.txt
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RestaurantReport from '../src/components/RestaurantReport';
import Logo from '../src/components/Logo';
import {
  HOME_INTRO,
  NOT_FOUND_META,
  STATIC_META,
  restaurantJsonLd,
  restaurantMeta,
  restaurantPath,
} from '../src/lib/meta';
import type { RestaurantDetail, RestaurantIndex } from '../src/types';
import { buildSitemap, renderPage, robotsTxt } from './html';
import type { SitemapEntry } from './html';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(webDir, 'dist');
const dataDir = path.join(webDir, 'public', 'data');

/** Header + main frame matching src/App.tsx, with plain links (no router). */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="header">
        <a href="/" className="brand" aria-label="DineSafeSD home">
          <Logo size={30} />
          <span className="brand-word" aria-hidden="true">
            DineSafe<span className="brand-sd">SD</span>
          </span>
        </a>
        <nav className="nav" aria-label="Main">
          <a href="/">Map</a>
          <a href="/search">Search</a>
          <a href="/latest">Latest</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}

function Placeholder({ heading, text }: { heading: string; text: string }) {
  return (
    <div className="page">
      <h1>{heading}</h1>
      <p>{text}</p>
      <p>
        <a href="/">Map</a> · <a href="/search">Search restaurants</a> ·{' '}
        <a href="/latest">Latest reports</a> · <a href="/about">About the data</a>
      </p>
    </div>
  );
}

const HEADINGS: Record<string, string> = {
  '/': 'South Dakota restaurant health inspections',
  '/search': 'Search restaurants',
  '/latest': 'Latest reports',
  '/about': 'About DineSafeSD',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms of Use',
  '/support': 'Support',
};

function main() {
  const started = Date.now();
  const shell = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const index = JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf8')) as RestaurantIndex;
  const updatedAt = index.updated_at;
  const sitemap: SitemapEntry[] = [];

  // Static routes
  for (const [route, meta] of Object.entries(STATIC_META)) {
    const body = renderToStaticMarkup(
      <Shell>
        <Placeholder heading={HEADINGS[route]} text={route === '/' ? HOME_INTRO : meta.description} />
      </Shell>
    );
    const file = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
    writeFileSync(path.join(dist, file), renderPage(shell, { meta, body, updatedAt }));
    sitemap.push({ path: meta.path, lastmod: updatedAt.slice(0, 10) });
  }

  writeFileSync(
    path.join(dist, '404.html'),
    renderPage(shell, {
      meta: NOT_FOUND_META,
      body: renderToStaticMarkup(
        <Shell>
          <Placeholder heading="Page not found" text="There is nothing at this address." />
        </Shell>
      ),
      updatedAt,
    })
  );

  // One page per restaurant detail file. Detail files, not the index, are
  // the source: a page exists exactly when its data file does.
  mkdirSync(path.join(dist, 'r'), { recursive: true });
  const files = readdirSync(path.join(dataDir, 'r')).filter((f) => f.endsWith('.json'));
  let written = 0;
  for (const file of files) {
    const detail = JSON.parse(readFileSync(path.join(dataDir, 'r', file), 'utf8')) as RestaurantDetail;
    if (`${detail.id}.json` !== file) {
      throw new Error(`Detail file ${file} holds id ${detail.id}`);
    }
    const meta = restaurantMeta(detail);
    const body = renderToStaticMarkup(
      <Shell>
        <RestaurantReport restaurant={detail} dataUpdatedAt={updatedAt} />
      </Shell>
    );
    writeFileSync(
      path.join(dist, 'r', `${detail.id}.html`),
      renderPage(shell, {
        meta,
        body,
        jsonLd: restaurantJsonLd(detail, meta),
        updatedAt,
        kind: 'restaurant',
      })
    );
    sitemap.push({ path: restaurantPath(detail.id), lastmod: detail.latest_inspection_date });
    written++;
  }

  writeFileSync(path.join(dist, 'sitemap.xml'), buildSitemap(sitemap));
  writeFileSync(path.join(dist, 'robots.txt'), robotsTxt());

  if (written !== index.restaurants.length) {
    console.warn(
      `prerender: ${written} detail files but ${index.restaurants.length} index rows — data tree is out of step`
    );
  }
  console.log(
    `prerender: ${written} restaurant pages, ${Object.keys(STATIC_META).length} static pages, sitemap (${sitemap.length} URLs), robots.txt, 404.html in ${Date.now() - started}ms`
  );
}

main();
