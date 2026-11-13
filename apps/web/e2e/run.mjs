// Browser checks against a production build served the way Cloudflare Pages
// serves it. Start the server first:
//   npm run build && npx wrangler@4 pages dev dist --port 8788 --compatibility-date 2026-05-01
// then: npm run test:e2e   (BASE_URL overrides the default http://127.0.0.1:8788)
//
// Covers responsive layout at 320 / 390 / 768 / 1280 in light and dark,
// keyboard-only map → report, search → report, critical vs unknown severity,
// empty results, save/watch persistence, HTTP statuses, and automated
// accessibility rules (axe-core). Screenshots land in e2e/screenshots/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8788';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'screenshots');
mkdirSync(shots, { recursive: true });

const PIZZA = 'sd_doh_rapid-city-pizza-ranch-1556-luna-ave-rapid-city';
const UNKNOWN_LATEST = 'sd_doh_comfort-suites-food-1333-n-elk-vale-rapid-city';
const SWEEPS_NONE = 'sf_sweeps_715';
const COUNT_ONLY = process.env.COUNT_ONLY_ID ?? '';

const VIEWPORTS = [
  { name: '320', width: 320, height: 640, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];
const THEMES = ['light', 'dark'];

const results = [];
const axeFindings = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function newPage(browser, vp, theme) {
  const page = await browser.newPage();
  await page.setBypassCSP(true); // only so axe-core can be injected
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  page.on('pageerror', (e) => check(`no page errors (${vp.name}/${theme})`, false, e.message));
  return page;
}

const shot = (page, name) =>
  page.screenshot({ path: path.join(shots, `${name}.jpg`), type: 'jpeg', quality: 70 });

async function waitForMap(page) {
  await page.waitForFunction(
    () => /restaurants? on the map/.test(document.querySelector('.map-status')?.textContent ?? ''),
    { timeout: 30000 }
  );
  await page.waitForFunction(() => window.__map && window.__map.loaded(), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.map-marker-btn').length > 0, {
    timeout: 30000,
  });
}

async function axe(page, label, exclude = []) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async (exclude) => {
    const ctx = exclude.length ? { exclude: exclude.map((s) => [s]) } : document;
    const r = await window.axe.run(ctx, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.slice(0, 220) })),
      count: v.nodes.length,
    }));
  }, exclude);
  // WCAG 2.5.8 exempts targets whose position is essential, and names map
  // pins as the example: two restaurants that are close together on the
  // ground are close together on the map. Recorded, not counted as failures.
  const exempt = (v) => v.id === 'target-size' && v.nodes.every((n) => n.target.includes('.map-marker-btn'));
  for (const v of res) axeFindings.push({ label, exempt: exempt(v), ...v });
  const real = res.filter((v) => !exempt(v));
  const noted = res.length - real.length;
  check(
    `axe: no WCAG A/AA violations — ${label}`,
    real.length === 0,
    real.map((v) => `${v.id}×${v.count}`).join(', ') + (noted ? `${real.length ? '; ' : ''}map-marker spacing noted as exempt` : '')
  );
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function layoutChecks(browser, vp, theme) {
  const tag = `${vp.name}/${theme}`;
  const page = await newPage(browser, vp, theme);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForMap(page);
  // let tiles settle for the screenshot
  await page.waitForFunction(() => window.__map.areTilesLoaded(), { timeout: 30000 }).catch(() => {});

  check(`home: no horizontal overflow (${tag})`, await noOverflow(page));
  const header = await page.evaluate(() => {
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    };
    const word = document.querySelector('.brand-word');
    const items = [...document.querySelectorAll('.header .nav > *')];
    return {
      wordmark: inView(word),
      wordText: word.textContent,
      nav: items.every(inView),
      brandName: document.querySelector('.brand').getAttribute('aria-label'),
    };
  });
  check(`header: wordmark visible and unclipped (${tag})`, header.wordmark, header.wordText);
  check(`header: every nav item inside the viewport (${tag})`, header.nav);
  check(`header: home link has an accessible name (${tag})`, header.brandName === 'DineSafeSD home', header.brandName);

  const search = await page.evaluate(() => {
    const input = document.querySelector('#map-search');
    const label = document.querySelector('label[for="map-search"]');
    const cs = getComputedStyle(input);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const lr = label.getBoundingClientRect();
    return {
      label: label.textContent.trim(),
      labelVisible: lr.width > 0 && lr.height > 0,
      placeholder: input.placeholder,
      placeholderWidth: Math.ceil(ctx.measureText(input.placeholder).width),
      inputWidth: input.clientWidth,
    };
  });
  check(`map search: persistent visible label (${tag})`, search.labelVisible && search.label === 'Search', search.label);
  check(
    `map search: placeholder fits without clipping (${tag})`,
    search.placeholderWidth <= search.inputWidth,
    `"${search.placeholder}" ${search.placeholderWidth}px in ${search.inputWidth}px`
  );
  check(
    `home: introduction visible (${tag})`,
    await page.evaluate(() => /South Dakota restaurant health inspections\./.test(document.querySelector('.map-intro')?.textContent ?? ''))
  );
  check(
    `home: labeled location action (${tag})`,
    await page.evaluate(() => [...document.querySelectorAll('.map-btn')].some((b) => b.textContent.trim() === 'Near me'))
  );
  check(
    `home: data refresh date shown apart from inspection dates (${tag})`,
    await page.evaluate(() => {
      const open = [...document.querySelectorAll('.map-btn')].find((b) => b.textContent.trim() === 'Legend');
      if (open.getAttribute('aria-expanded') !== 'true') open.click();
      return true;
    }).then(() =>
      page.waitForFunction(() => /Data refreshed .*Each restaurant shows its own inspection date/.test(document.querySelector('#map-panel-legend')?.textContent ?? ''), { timeout: 5000 }).then(() => true, () => false)
    )
  );
  const legend = await page.evaluate(() => ({
    rows: document.querySelectorAll('#map-panel-legend .legend-list li').length,
    text: document.querySelector('#map-panel-legend')?.textContent ?? '',
  }));
  check(`legend: score bands and ring explanation (${tag})`, legend.rows === 6 && /Rings/.test(legend.text), `${legend.rows} rows`);
  await shot(page, `home-legend-${vp.name}-${theme}`);
  await axe(page, `home with legend (${tag})`);

  // Filters open, then typing in search: the two must never share space
  await page.evaluate(() => [...document.querySelectorAll('.map-btn')].find((b) => /^Filters/.test(b.textContent.trim())).click());
  await page.waitForSelector('#map-panel-filters');
  const pressed = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#map-panel-filters .filter-chip[aria-pressed]')];
    return { n: chips.length, any: chips.find((c) => c.textContent.trim() === 'Any')?.getAttribute('aria-pressed') };
  });
  check(`filters: chips expose selected state (${tag})`, pressed.n >= 14 && pressed.any === 'true', `${pressed.n} chips, Any=${pressed.any}`);
  await shot(page, `home-filters-${vp.name}-${theme}`);
  await axe(page, `home with filters (${tag})`);
  const before = await page.$eval('.map-status', (e) => e.textContent);
  await page.evaluate(() => [...document.querySelectorAll('#map-panel-filters .filter-chip')].find((c) => c.textContent.trim() === '95+').click());
  await page.waitForFunction((b) => document.querySelector('.map-status').textContent !== b, {}, before);
  const after = await page.$eval('.map-status', (e) => `${e.getAttribute('role')}: ${e.textContent}`);
  check(`filters: result count announced via live status (${tag})`, /^status: .*\(filtered\)/.test(after), after);
  await page.evaluate(() => [...document.querySelectorAll('#map-panel-filters .filter-chip')].find((c) => c.textContent.trim() === 'Reset filters').click());

  await page.click('#map-search');
  await page.type('#map-search', 'rapid');
  await page.waitForSelector('#cs-listbox:not([hidden]) [role="option"]');
  const overlap = await page.evaluate(() => {
    const list = document.querySelector('#cs-listbox').getBoundingClientRect();
    const hit = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return !(r.right <= list.left || r.left >= list.right || r.bottom <= list.top || r.top >= list.bottom);
    };
    return {
      panelOpen: !!document.querySelector('.map-panel'),
      actions: hit(document.querySelector('.map-actions')),
      options: document.querySelectorAll('#cs-listbox [role="option"]').length,
      expanded: document.querySelector('#map-search').getAttribute('aria-expanded'),
    };
  });
  check(
    `search suggestions never overlap filters (${tag})`,
    !overlap.panelOpen && !overlap.actions && overlap.options > 0 && overlap.expanded === 'true',
    JSON.stringify(overlap)
  );
  await shot(page, `home-suggestions-${vp.name}-${theme}`);
  await page.keyboard.press('Escape');

  // Map search no-match recovery
  await page.type('#map-search', 'zzzzqqq');
  await page.waitForSelector('.cs-empty');
  check(`map search: no-match message with a way forward (${tag})`, await page.$eval('.cs-empty', (e) => /open full search/.test(e.textContent)));
  await page.keyboard.press('Escape');

  // Report page
  await page.goto(`${BASE}/r/${PIZZA}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.save-btn');
  check(`report: no horizontal overflow (${tag})`, await noOverflow(page));
  await shot(page, `report-critical-${vp.name}-${theme}`);
  if (vp.name === '390' || vp.name === 'desktop') {
    await page.screenshot({ path: path.join(shots, `report-critical-full-${vp.name}-${theme}.jpg`), type: 'jpeg', quality: 70, fullPage: true });
  }
  await axe(page, `report (${tag})`);

  // Search with results, Latest
  await page.goto(`${BASE}/search?q=pizza+ranch`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.result-card');
  check(`search: no horizontal overflow (${tag})`, await noOverflow(page));
  await page.evaluate(() => document.querySelector('[aria-controls="more-filters"]').click());
  await page.waitForSelector('#more-filters');
  await shot(page, `search-${vp.name}-${theme}`);
  await axe(page, `search results (${tag})`);
  await page.goto(`${BASE}/latest`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.result-card');
  check(`latest: no horizontal overflow (${tag})`, await noOverflow(page));
  await shot(page, `latest-${vp.name}-${theme}`);
  await axe(page, `latest (${tag})`);
  await page.close();
}

async function httpChecks() {
  const get = async (p) => {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() };
  };
  const robots = await get('/robots.txt');
  check('http: /robots.txt is text/plain 200 with Sitemap line', robots.status === 200 && /text\/plain/.test(robots.type) && /Sitemap: https:\/\/dinesafesd\.com\/sitemap\.xml/.test(robots.body), `${robots.status} ${robots.type}`);
  const sm = await get('/sitemap.xml');
  check('http: /sitemap.xml is XML 200', sm.status === 200 && /xml/.test(sm.type) && sm.body.startsWith('<?xml'), `${sm.status} ${sm.type}, ${(sm.body.match(/<url>/g) ?? []).length} URLs`);
  check('http: sitemap lists the example restaurant', sm.body.includes(`https://dinesafesd.com/r/${PIZZA}</loc>`));
  const r = await get(`/r/${PIZZA}`);
  check('http: restaurant page 200', r.status === 200, r.status);
  check('initial HTML: unique title', /<title>RAPID CITY PIZZA RANCH — Rapid City, SD health inspections \| DineSafeSD<\/title>/.test(r.body));
  check('initial HTML: canonical', r.body.includes(`<link rel="canonical" href="https://dinesafesd.com/r/${PIZZA}" />`));
  check('initial HTML: Open Graph title/description/url', /og:title/.test(r.body) && /og:description/.test(r.body) && /og:url/.test(r.body));
  check('initial HTML: report content without JavaScript', /<h1>RAPID CITY PIZZA RANCH<\/h1>/.test(r.body) && /Critical violations recorded on this inspection/.test(r.body) && /July 20, 2026/.test(r.body));
  check('initial HTML: structured data has no rating/review', /application\/ld\+json/.test(r.body) && !/"(aggregateRating|review|ratingValue)"/i.test(r.body));
  const home = await get('/');
  check('initial HTML: homepage has intro text and canonical', /South Dakota restaurant health inspections/.test(home.body.split('<body>')[1] ?? '') && /rel="canonical" href="https:\/\/dinesafesd\.com\/"/.test(home.body));
  for (const p of ['/search', '/latest', '/about', '/privacy', '/terms', '/support']) {
    const x = await get(p);
    check(`http: ${p} direct load 200 with its own title`, x.status === 200 && !/<title>DineSafeSD — South Dakota Restaurant Health Inspections<\/title>/.test(x.body), x.status);
  }
  const missing = await get('/r/this-restaurant-does-not-exist');
  check('http: unknown restaurant returns 404', missing.status === 404, missing.status);
  check('http: 404 page is noindex', /name="robots" content="noindex"/.test(missing.body));
  const junk = await get('/no/such/page');
  check('http: unknown path returns 404', junk.status === 404, junk.status);
  const nodata = await get('/data/r/nope.json');
  check('http: missing data file returns 404', nodata.status === 404, nodata.status);
}

/** Await with a label, so a timeout says which step stalled. */
async function step(label, promise) {
  try {
    return await promise;
  } catch (e) {
    throw new Error(`${label}: ${e.message}`);
  }
}

async function describeFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { what: 'body' };
    const cs = getComputedStyle(el);
    const ring =
      (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
      // the map search draws its ring on the field wrapper
      (el.id === 'map-search' && getComputedStyle(el.closest('.cs-field')).outlineStyle !== 'none');
    return {
      what:
        (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60),
      cls: el.className?.toString().slice(0, 40) ?? '',
      marker: el.classList.contains('map-marker-btn'),
      ring,
    };
  });
}

async function keyboardFlow(browser) {
  const vp = VIEWPORTS[3];
  const page = await newPage(browser, vp, 'light');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForMap(page);
  await page.waitForFunction(() => document.querySelector('.map-marker-btn[tabindex="0"]'), { timeout: 20000 });

  const markers = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.map-marker-btn')];
    return {
      total: all.length,
      tabbable: all.filter((m) => m.tabIndex === 0).length,
      generic: all.filter((m) => /^map marker$/i.test(m.getAttribute('aria-label') ?? '')).length,
      unnamed: all.filter((m) => !m.getAttribute('aria-label')).length,
      roles: all.every((m) => m.getAttribute('role') === 'button'),
      sample: all.slice(0, 3).map((m) => m.getAttribute('aria-label')),
    };
  });
  check('markers: each has a specific accessible name and button role', markers.generic === 0 && markers.unnamed === 0 && markers.roles && markers.total > 0, `${markers.total} markers, e.g. ${markers.sample.join(' | ')}`);
  check('markers: exactly one tab stop for the whole set', markers.tabbable === 1, `${markers.tabbable} of ${markers.total} tabbable`);

  // Tab from the top of the page until a marker takes focus
  const order = [];
  let reached = false;
  let ringless = [];
  for (let i = 0; i < 30 && !reached; i++) {
    await page.keyboard.press('Tab');
    const f = await describeFocus(page);
    order.push(f.what);
    if (!f.ring) ringless.push(f.what);
    reached = f.marker;
  }
  check('keyboard: Tab reaches a map marker', reached, order.join(' → '));
  check('keyboard: every stop on the way shows a focus indicator', ringless.length === 0, ringless.join(', '));
  check(
    'keyboard: search, filters, location, legend and list come before the map',
    ['Search', 'Filters', 'Near me', 'Legend', 'List'].every((w) => order.some((o) => o.startsWith(w) || o.includes(w))),
    ''
  );
  await shot(page, 'keyboard-marker-focus-desktop-light');

  const first = await describeFocus(page);
  await page.keyboard.press('ArrowRight');
  const second = await describeFocus(page);
  check('keyboard: arrow keys move between markers', second.marker && second.what !== first.what, `${first.what} → ${second.what}`);

  // Drill in with Enter until a restaurant card opens
  let opened = false;
  const zooms = [];
  for (let i = 0; i < 14 && !opened; i++) {
    const zoomBefore = await page.evaluate(() => window.__map.getZoom());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (z) => document.querySelector('.quickview') || (Math.abs(window.__map.getZoom() - z) > 0.05 && !window.__map.isMoving()),
        { timeout: 15000 },
        zoomBefore
      )
      .catch(() => {});
    opened = !!(await page.$('.quickview'));
    if (!opened) {
      // wait for the map to settle and hand focus to a marker in the new view
      await page.waitForFunction(() => window.__map.loaded() && !window.__map.isMoving(), { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      await page.waitForFunction(() => document.activeElement?.classList.contains('map-marker-btn'), { timeout: 15000 }).catch(() => {});
      zooms.push((await page.evaluate(() => window.__map.getZoom())).toFixed(1));
      const f = await describeFocus(page);
      if (!f.marker) break;
    }
  }
  check('keyboard: Enter on markers drills down to a restaurant card', opened, `zoom steps ${zooms.join(', ')}`);
  if (opened && (await page.$('.stack-picker'))) {
    // a same-address group: pick the first row
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.quickview:not(.stack-picker)');
  }
  await step('focus into card', page.waitForFunction(() => document.querySelector('.quickview')?.contains(document.activeElement)));
  check('quick view: focus moves into the card', true);
  await shot(page, 'keyboard-quickview-desktop-light');
  const name = await page.$eval('#qv-name', (e) => e.textContent.trim());

  // Escape closes and focus returns to the map
  await page.keyboard.press('Escape');
  await step('card closes on Escape', page.waitForFunction(() => !document.querySelector('.quickview')));
  await new Promise((r) => setTimeout(r, 150)); // focus restore runs on the next frame
  const back = await describeFocus(page);
  check('quick view: Escape closes and returns focus to the map', back.marker || /Map of South Dakota/.test(back.what), back.what);

  // Reopen and follow the report link by keyboard
  if (back.marker) await page.keyboard.press('Enter');
  else {
    await page.evaluate(() => document.querySelector('.dot-proxy')?.focus());
    await page.keyboard.press('Enter');
  }
  await step('card reopens', page.waitForSelector('.quickview .qv-cta'));
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.classList.contains('qv-cta'))) break;
  }
  await page.keyboard.press('Enter');
  await step('report opens from card link', page.waitForFunction(() => location.pathname.startsWith('/r/')));
  await step('report renders', page.waitForSelector('article.report h1'));
  const h1 = await page.$eval('article.report h1', (e) => e.textContent.trim());
  check('keyboard: map → report without a pointer', !!h1, `${name} → ${h1}`);
  check('navigation: focus moves into the new page', await page.evaluate(() => document.activeElement?.id === 'main' || document.querySelector('#main').contains(document.activeElement)));

  // Text alternative to the map
  await page.goBack();
  await step('map after Back', waitForMap(page));
  await page.evaluate(() => document.querySelector('.qv-close')?.click());
  await page.evaluate(() => [...document.querySelectorAll('.map-btn')].find((b) => b.textContent.trim() === 'List').click());
  await page.waitForSelector('#map-panel-list .view-list li');
  const list = await page.evaluate(() => ({
    heading: document.querySelector('#map-panel-list .mf-label').textContent.trim(),
    rows: document.querySelectorAll('#map-panel-list .view-list li').length,
  }));
  check('text alternative: list of restaurants in the current view', list.rows > 0, `${list.heading}; ${list.rows} rows shown`);
  await shot(page, 'list-panel-desktop-light');
  await page.focus('#map-panel-list .view-list button');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.quickview');
  await page.waitForFunction(() => document.querySelector('.quickview')?.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.quickview'));
  await new Promise((r) => setTimeout(r, 150)); // focus restore runs on the next frame
  const listBack = await describeFocus(page);
  check('text alternative: closing the card restores focus to the List button', listBack.what === 'List', listBack.what);

  // Panel dismissal
  await page.keyboard.press('Enter');
  await page.waitForSelector('#map-panel-list');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#map-panel-list'));
  check('panels: Escape closes and restores focus to the trigger', (await describeFocus(page)).what === 'List');

  // Combobox keyboard use
  await page.focus('#map-search');
  await page.keyboard.type('pizza ranch rapid');
  await page.waitForSelector('#cs-listbox [role="option"]');
  await page.keyboard.press('ArrowDown');
  const combo = await page.evaluate(() => {
    const i = document.querySelector('#map-search');
    const a = document.getElementById(i.getAttribute('aria-activedescendant') ?? '');
    return { role: i.getAttribute('role'), active: a?.textContent.trim(), selected: a?.getAttribute('aria-selected') };
  });
  check('map search: combobox with arrow-key selection', combo.role === 'combobox' && combo.selected === 'true', JSON.stringify(combo));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.quickview');
  check('map search → card', /PIZZA RANCH/i.test(await page.$eval('#qv-name', (e) => e.textContent)));
  const qv = await page.$eval('.quickview', (e) => e.textContent);
  check('map card: critical status shown', /Critical violations found on latest inspection/.test(qv));
  await page.close();
}

async function contentFlows(browser) {
  const page = await newPage(browser, VIEWPORTS[1], 'light');

  // search → report
  await page.goto(BASE + '/search', { waitUntil: 'networkidle0' });
  const label = await page.evaluate(() => document.querySelector('.search-input').closest('label')?.querySelector('.field-label')?.textContent);
  check('search page: persistent visible label on the input', label === 'Name, address, or ZIP', label);
  await page.type('.search-input', 'pizza ranch rapid');
  await page.waitForSelector('.result-card');
  const count = await page.$eval('.result-count', (e) => `${e.getAttribute('role')}: ${e.textContent}`);
  check('search: result count announced', /^status: \d+ restaurants? found\./.test(count), count);
  const card = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.result-card')].find((x) => /1556 Luna/.test(x.textContent));
    c?.click();
    return c?.textContent ?? '';
  });
  check('search card: critical status and inspection date in text', /Critical violation on latest inspection/.test(card) && /Inspected Jul 20, 2026/.test(card), card.slice(0, 120));
  await page.waitForFunction(() => location.pathname.startsWith('/r/'));
  await page.waitForSelector('article.report');
  const rep = await page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    text: document.querySelector('article.report').innerText,
    sev: [...document.querySelectorAll('.inspection-card')][0]
      ? [...[...document.querySelectorAll('.inspection-card')][0].querySelectorAll('.violation')].map((v) => v.querySelector('.violation-meta').innerText.replace(/\s+/g, ' '))
      : [],
    dateSize: parseFloat(getComputedStyle(document.querySelector('.latest-date')).fontSize),
  }));
  check('search → report', /RAPID CITY PIZZA RANCH/.test(rep.text));
  check('report: SPA navigation updates title and canonical', /^RAPID CITY PIZZA RANCH — Rapid City, SD/.test(rep.title) && rep.canonical?.endsWith(`/r/${PIZZA}`), rep.title);
  check('report: written critical warning matches the map card', /Critical violations recorded on this inspection\./.test(rep.text));
  check('report: explains high score with critical findings', /A high score can still include a critical violation/.test(rep.text));
  check('report: says where the critical label comes from', /DineSafeSD’s classification based on the rule section cited/.test(rep.text));
  check('report: severity in text beside each violation', rep.sev.length === 2 && /^Critical DineSafeSD classification Code 44:02:07:24/.test(rep.sev[0]) && /^Major /.test(rep.sev[1]), rep.sev.join(' || '));
  check('report: inspection date prominent', /LATEST INSPECTION\s+July 20, 2026/i.test(rep.text) && rep.dateSize >= 20, `${rep.dateSize}px`);
  check('report: refresh date distinguished from inspection date', /Dates shown are when the inspector visited\. DineSafeSD last refreshed its copy of the official data on/.test(rep.text));
  check('report: official scoresheet criticals labeled as such', /Critical\s+per state scoresheet\s+Code 30/.test(rep.text.replace(/\n/g, ' ')));
  const src = await page.evaluate(() => ({
    href: [...document.querySelectorAll('article.report a')].find((a) => /public inspection search/.test(a.textContent))?.href,
    copy: !!document.querySelector('.copy-btn'),
    steps: document.querySelector('.source-steps')?.innerText ?? '',
  }));
  check('report (state): portal link goes to the public search, with copy-name and steps', /publicinspectionsearch\.aspx$/.test(src.href ?? '') && src.copy && /Establishment Name/.test(src.steps), src.href);
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write']);
  await page.bringToFront();
  await page.click('.copy-btn');
  await step('copy status appears', page.waitForFunction(() => document.querySelector('.copy-status').textContent.trim().length > 0));
  const copyStatus = await page.$eval('.copy-status', (e) => `${e.getAttribute('role')}: ${e.textContent.trim()}`);
  check('report: copy-name gives visible, announced feedback', copyStatus === 'status: Copied.', copyStatus);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `unreadable (${e.message})`);
  check('report: copy-name puts the exact name on the clipboard', clip === 'RAPID CITY PIZZA RANCH', clip);

  // Back restores the search
  await page.goBack();
  await page.waitForSelector('.result-card');
  check('search: Back from a report restores the query', (await page.$eval('.search-input', (e) => e.value)) === 'pizza ranch rapid');

  // save / watch
  await page.goto(`${BASE}/r/${PIZZA}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.save-btn');
  const help = await page.$eval('.save-help', (e) => e.textContent);
  check('save/watch: visible explanation, device-only, no notifications implied', /stored only in this browser on this device/.test(help) && /no emails or notifications are sent/.test(help));
  const labels = await page.$$eval('.save-btn', (b) => b.map((x) => `${x.textContent.trim()}:${x.getAttribute('aria-pressed')}`));
  check('save/watch: visible text labels with pressed state', labels.join(',') === 'Save:false,Watch:false', labels.join(','));
  await page.click('.save-btn:not(.watch)');
  const s1 = await page.$eval('.save-status', (e) => `${e.getAttribute('role')}: ${e.textContent}`);
  check('save: visible, announced feedback', /^status: Saved to Favorites on this device/.test(s1), s1);
  await page.click('.save-btn.watch');
  const s2 = await page.$eval('.save-status', (e) => e.textContent);
  check('watch: explains the “New report” badge and that nothing is sent', /“New report” badge will appear/.test(s2) && /No emails or notifications/.test(s2), s2);
  await shot(page, 'report-saved-390-light');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.save-btn');
  const persisted = await page.$$eval('.save-btn', (b) => b.map((x) => x.getAttribute('aria-pressed')).join(','));
  check('save/watch: persists across reload', persisted === 'true,true', persisted);
  await page.goto(BASE + '/search', { waitUntil: 'networkidle0' });
  await page.click('[aria-controls="more-filters"]');
  await page.evaluate(() => [...document.querySelectorAll('#more-filters .filter-chip')].find((c) => /Favorites \(1\)/.test(c.textContent)).click());
  await page.waitForSelector('.result-card');
  check('save: favorite appears under Search → Favorites', /RAPID CITY PIZZA RANCH/.test(await page.$eval('.result-list', (e) => e.textContent)));
  const active = await page.$eval('.active-filters', (e) => e.innerText);
  await page.click('[aria-controls="more-filters"]');
  check('search: active filter stays visible when More filters is closed', /Favorites/.test(active) && !(await page.$('#more-filters')) && !!(await page.$('.active-filters .removable')));
  // a newer inspection than the one seen → badge
  await page.evaluate((id) => {
    const w = JSON.parse(localStorage.getItem('dinesafe:watches'));
    w[id] = '2026-01-01';
    localStorage.setItem('dinesafe:watches', JSON.stringify(w));
  }, PIZZA);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.type('.search-input', 'pizza ranch rapid');
  await page.waitForSelector('.result-card');
  check('watch: “New report” badge appears when a newer inspection exists', /New report/.test(await page.$eval('.result-list', (e) => e.textContent)));
  await shot(page, 'search-new-report-390-light');

  // empty results + recovery
  await page.goto(`${BASE}/search?q=zzzzqqq&city=rapid+city`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.empty-state');
  const empty = await page.$eval('.empty-state', (e) => e.innerText);
  check('empty results: explains what was searched and offers actions', /No restaurants match “zzzzqqq” with City: Rapid City/.test(empty) && /Search all cities/.test(empty) && /Clear search text/.test(empty) && /Browse the map/.test(empty), empty.replace(/\n/g, ' | '));
  await shot(page, 'search-empty-390-light');
  await page.evaluate(() => [...document.querySelectorAll('.empty-actions .filter-chip')].find((c) => c.textContent.trim() === 'Clear search text').click());
  await page.waitForSelector('.result-card');
  check('empty results: recovery action returns results', /found|Showing/.test(await page.$eval('.result-count', (e) => e.textContent)));

  // critical vs unknown vs none
  await page.goto(`${BASE}/r/${UNKNOWN_LATEST}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('article.report');
  const unk = await page.$eval('.latest-summary', (e) => e.innerText);
  check('unknown: missing violation data is not described as clean', /Violation details are not available for this inspection\./.test(unk) && !/No violations/.test(unk) && !/critical/i.test(unk), unk.replace(/\n/g, ' | ').slice(0, 200));
  await shot(page, 'report-unknown-390-light');
  if (COUNT_ONLY) {
    await page.goto(`${BASE}/r/${COUNT_ONLY}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('article.report');
    const co = await page.$eval('article.report', (e) => e.innerText);
    check('unknown: count-only inspections say severity is unknown', /Itemized details are not published, so severity is unknown\./.test(co));
  }
  await page.goto(`${BASE}/r/${SWEEPS_NONE}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('article.report');
  const sw = await page.evaluate(() => ({
    summary: document.querySelector('.latest-summary').innerText,
    link: [...document.querySelectorAll('article.report a')].find((a) => /official record/.test(a.textContent))?.href,
  }));
  check('none recorded: stated only on an explicit zero count', /No violations were recorded on this inspection\./.test(sw.summary));
  check('source: Sioux Falls record deep link', sw.link === 'https://sweepsdata.siouxfalls.gov/Restaurant_Detail.aspx?SiteID=715&FacType=16F&inv=1', sw.link);

  // Latest: wording and city filter
  await page.goto(BASE + '/latest', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.result-card');
  const latest = await page.$eval('.page', (e) => e.innerText);
  check('latest: no “Clean” wording', !/\bClean\b/.test(latest.replace(/Cleanliness/g, '')));
  check('latest: factual wording present', /No violations recorded|violations? recorded|Violation details not available|Critical violation on latest inspection/.test(latest));
  check('latest: states refresh date separately from inspection dates', /grouped by the date of the inspection/.test(latest) && /last refreshed its data on/.test(latest) && /INSPECTED /i.test(latest));
  const sel = await page.evaluate(() => {
    const s = document.querySelector('.field-row select');
    return { label: s.closest('label')?.querySelector('.field-label')?.textContent, options: s.options.length };
  });
  check('latest: labeled city filter', sel.label === 'City' && sel.options > 50, `${sel.options} options`);
  await page.select('.field-row select', 'rapid city');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('city') === 'rapid city');
  const cityOnly = await page.evaluate(() => ({
    all: [...document.querySelectorAll('.result-addr')].every((a) => /Rapid City, SD$/.test(a.textContent.trim())),
    n: document.querySelectorAll('.result-card').length,
    status: document.querySelector('.result-count').textContent,
  }));
  check('latest: city filter limits the feed and is announced', cityOnly.all && cityOnly.n > 0 && /in Rapid City/.test(cityOnly.status), `${cityOnly.n} cards; ${cityOnly.status}`);
  await shot(page, 'latest-city-390-light');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.result-card');
  check('latest: city filter survives refresh', (await page.$eval('.field-row select', (s) => s.value)) === 'rapid city');

  // missing restaurant in the app
  await page.goto(`${BASE}/r/this-restaurant-does-not-exist`, { waitUntil: 'domcontentloaded' });
  await step('not-found UI', page.waitForFunction(() => document.querySelector('.page h1')?.textContent === 'Restaurant not found'));
  const nf = await page.evaluate(() => ({ h1: document.querySelector('.page h1').textContent, title: document.title, robots: document.querySelector('meta[name="robots"]')?.content }));
  check('missing restaurant: clear message, not-found title, noindex', nf.h1 === 'Restaurant not found' && /not found/i.test(nf.title) && nf.robots === 'noindex', JSON.stringify(nf));

  // touch targets on a phone
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForMap(page);
  await page.type('#map-search', 'pizza ranch rapid');
  await page.waitForSelector('#cs-listbox [role="option"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.quickview');
  const targets = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.header a, .header button, .map-btn, .cs-field, .quickview button, .quickview a, .intro-hide')];
    return els
      .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 28), r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0)
      .map((x) => ({ t: x.t, w: Math.round(x.r.width), h: Math.round(x.r.height) }));
  });
  const small = targets.filter((t) => t.w < 24 || t.h < 24);
  check('touch targets: all at least 24×24 (WCAG 2.2 AA) on a 390px phone', small.length === 0, small.map((t) => `${t.t} ${t.w}×${t.h}`).join(', '));
  const under44 = targets.filter((t) => t.h < 44 && t.w < 44);
  console.log('  info: targets under 44px in both dimensions:', under44.map((t) => `${t.t} ${t.w}×${t.h}`).join(', ') || 'none');
  await shot(page, 'quickview-390-light');
  await page.close();
}

const ONLY = process.env.ONLY ?? '';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  if (!ONLY || ONLY === 'http') await httpChecks();
  if (!ONLY || ONLY === 'keyboard') await keyboardFlow(browser);
  if (!ONLY || ONLY === 'content') await contentFlows(browser);
  if (!ONLY || ONLY === 'layout') {
    for (const vp of VIEWPORTS) for (const theme of THEMES) await layoutChecks(browser, vp, theme);
  }
} catch (e) {
  check('e2e run completed', false, e.stack?.split('\n').slice(0, 3).join(' ') ?? String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(here, 'results.json'), JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results, axeFindings }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
