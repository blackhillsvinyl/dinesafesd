# DineSafeSD update: plan, status, and handoff

Source: live-site review of https://dinesafesd.com on 2026-11-12.
Branch: `dinesafe-update` (local only; not pushed, merged, or deployed). Base: `b055729a`.

Owners: **Claude** owns production implementation. **Codex** owns its review record
(add it under "Codex review" at the bottom) and any test/build task explicitly assigned there.
This file is a handoff record, not a lock.

## How to verify

```bash
npm ci
cd apps/web
npm test                 # vitest: 33 unit tests (+4 published-data contract tests owned by Codex, untracked)
npm run build            # tsc (app) + tsc (scripts) + vite build + prerender
npx wrangler@4 pages dev dist --port 8788 --compatibility-date 2026-05-01   # Cloudflare Pages emulator
COUNT_ONLY_ID=sd_doh_al-s-hotwing-sauce-219-se-1st-ave-watertown npm run test:e2e   # in a second shell
cd ../../services/data-pipeline && npm test    # vitest: 24 pipeline unit tests
```

`--compatibility-date` is only needed because the locally installed wrangler (4.90.1) is older
than today's default date. `npm run test:e2e` writes `apps/web/e2e/results.json` and
`apps/web/e2e/screenshots/` (both git-ignored). A copy of the last run is in
`docs/dinesafe-update-evidence/`.

## Results of the last run (2026-11-12, after the second round of review fixes)

| Check | Command | Result |
|---|---|---|
| Web unit tests | `npm test` in `apps/web` | 37 passed, 0 failed (33 of mine, 4 of Codex's `published-data.test.ts`) |
| Pipeline unit tests | `npm test` in `services/data-pipeline` | 24 passed, 0 failed, including a run of the real `syncAll` loop with a stubbed page and a throwaway data directory |
| Pipeline type-check | `npx tsc --noEmit -p services/data-pipeline` | passed |
| Production build | `npm run build` | passed; 4,486 restaurant pages + 7 static pages + 404 + sitemap (4,493 URLs) + robots in about 1.8 s |
| Browser suite | `npm run test:e2e` | 287 passed, 0 failed; keyboard group rerun twice more, 20 of 20 each time |
| Automated accessibility | axe-core 4.14, WCAG 2.0/2.1/2.2 A+AA tags, inside the browser suite | 48 runs (6 screens × 4 widths × 2 themes), 0 violations counted; map-marker spacing noted as exempt (see Remaining issues) |
| Live Sioux Falls parse | refactored parser against the live city pages for sites 144, 715, 2400 | all three match the stored records |
| Live state sync | one county (Hughes), last 45 days, against a temporary copy of the data | 7 establishments, 35 violations, no failed counties; output byte-identical to the stored data |

The browser suite ran in headless Chromium (Puppeteer) against the production build on the
Pages emulator, at 320, 390, 768, and 1280 px, in light and dark. Earlier in the day one
`npm run build` failed once in `vite build` and passed on immediate retry with no change; Codex
was building in the same checkout at the time, which is the likely cause but was not confirmed.

**Automated versus manual.** Everything in the table is automated. Manual work was limited to
reading the screenshots in `docs/dinesafe-update-evidence/`. **Not done:** a real screen reader
(VoiceOver, NVDA, TalkBack), real phones, Safari, Firefox, and real geolocation. The live site
was only used to reproduce the observations; none of this is deployed.

## Reproduction of the observations

| Observation | Reproduced? | Evidence |
|---|---|---|
| Map card warns "critical", full report has no written warning, severity is color bars only | Yes | `QuickView.tsx` showed the warning; `RestaurantPage.tsx` had none and drew a colored `violation-bar` |
| "✓ Clean" on Latest | Yes | `LatestPage.tsx` showed it whenever `violation_categories` was empty |
| Source link | Yes, and worse than reported | The state link went to `https://sddoh.safefoodinspection.com/`, which is a licensee **login** page |
| Homepage has no intro or legend | Yes | `MapPage.tsx` |
| Wordmark disappears on mobile | Yes | `styles.css`: `.brand-word { display: none }` at ≤ 400 px |
| Placeholder clipped, Filters overlaps suggestions | Yes | Search was `min(230px, 100% − 120px)` wide with a 33-character placeholder; both panels were independent overlays |
| Dark map labels hard to read | Yes | OpenFreeMap dark style draws place names `rgb(101,101,101)` at 10 px on `rgb(12,12,12)` |
| Markers announced "Map marker", not focusable | Yes | maplibre default label; cluster elements had no role, name, or tabindex; dots are canvas only |
| Logo link has no accessible name | Yes | Logo SVG is `aria-hidden`, wordmark hidden on mobile |
| Search relies on placeholder | Yes | Both search inputs |
| Filter chips expose no selected state; results not announced | Yes | No `aria-pressed`, no live region |
| White on `#4ade80` ≈ 1.74:1 | Yes | Unit test reproduces it. Also found: white on `#facc15`, `#f97316`, `#94a3b8`; score text on the 90–95 tint (3.15:1); `--faint` body text (about 2.5:1); colored category-chip text |
| Restaurant pages reuse homepage title/description | Yes | Live `curl` |
| `/robots.txt` and `/sitemap.xml` return the app shell with 200 | Yes | Live `curl`: `200 text/html` for both, and for `/r/does-not-exist` and `/data/r/nope.json` |
| No canonical or Open Graph tags; content needs JavaScript | Yes | Live `curl` |
| Heart/eye rely on icons and hover; Watch is unexplained | Yes | `SaveButtons.tsx` |
| "No restaurants found." only; no city filter on Latest | Yes | `SearchPage.tsx`, `LatestPage.tsx` |

Nothing was already fixed or not reproducible.

## Issues

Status values: done (implemented and verified by the run above), partial, open.

### 1. Inspection meaning — Claude — done

Acceptance criteria:
- The report states in words what the map card states about critical violations.
- Severity is text beside each violation, with where the label comes from.
- Inspection date is the most prominent fact; a high score with critical findings is explained.
- "No violations recorded" appears only when the data has an explicit zero count.
- Official scores, dates, descriptions, correction info, and attribution are unchanged.
- The source link opens the exact record where possible; otherwise portal + copy-name + steps.

What severity is traced to (updated after the mapping failed verification; see below):

| Record | Where severity comes from | Shown as |
|---|---|---|
| Sioux Falls SWEEPS | The city report's "Critical Violations" / "Non-Critical Violations" headings (`sync-sioux-falls.ts`) | Critical / Non-critical, "per city report" |
| SD DOH scoresheet PDF (codes 1–60) | The `*` mark on the state form (`pdf-parser.ts`) | Critical / Non-critical, "per state scoresheet" |
| SD DOH portal citation (codes like `44:02:07:24`) | Nothing. The portal publishes no severity and the rule does not rank its sections. | "Severity not published", "state portal citation" |

The Pizza Ranch example is the third kind. Its card and report now agree: 2 violations recorded,
no critical claim. Official-critical behavior is exercised with `sf_sweeps_144` (score 97 with a
critical violation under the city's heading).

Changed files: `src/lib/inspection.ts`, `src/lib/sources.ts`, `src/components/RestaurantReport.tsx`,
`src/components/QuickView.tsx`, `src/components/ResultCard.tsx`, `src/pages/RestaurantPage.tsx`,
`src/pages/LatestPage.tsx`, `src/pages/AboutPage.tsx`, `src/types.ts`.

Evidence: unit tests `severity provenance`, `inspectionFindings`, `index flags from before severity rules 2`,
`latestStatus`, `official source links`; browser checks beginning `report`, `map card:`, `search card:`,
`unknown:`, `none recorded:`, `source:`, `latest: no “Clean” wording`;
screenshots `report-critical-full-*.jpg` (official mark), `report-portal-full-390-dark.jpg` (portal citations),
`quickview-official-critical-desktop-light.jpg`, `report-unknown-390-light.jpg`.
SWEEPS deep link checked by hand against the live city site for site 715 (same facility, date, score).

### 2. Homepage and mobile — Claude — done

Acceptance criteria: intro copy visible; search prominent with a short persistent label and an
unclipped placeholder; legend and labeled location action discoverable; refresh date separate
from inspection dates; search and filter panels never overlap; wordmark visible at 320 px;
dark labels legible.

Changed files: `src/pages/MapPage.tsx`, `src/components/CitySearch.tsx`, `src/App.tsx`, `src/styles.css`.

Notes: the intro can be hidden (remembered on the device). The legend opens once for first-time
visitors on wide screens. Zoom buttons moved bottom-right. Dark place names keep the same
basemap and font, with lighter ink and 2 px more size.

Evidence: browser checks beginning `home:`, `header:`, `map search:`, `legend:`,
`search suggestions never overlap filters` at all four widths and both themes; screenshots `home-*.jpg`.

### 3. Accessibility — Claude — done (automated), screen-reader pass open

Acceptance criteria: markers named and keyboard operable without flooding the tab order; text
alternative to the map; home-link name; persistent labels; selected state; announcements;
score contrast ≥ 4.5:1 in both themes; visible focus, Escape dismissal, focus restoration, touch targets.

How markers work: rings and dots are DOM buttons with specific names
("16 restaurants around Lemmon. Activate to zoom in.", "AL'S GRILL, Lemmon. Score 92 out of 100.").
The whole set is **one** tab stop; arrow keys, Home, and End move between markers in view;
markers outside the view are not focusable or announced. Dots get a button only while 150 or
fewer are in view. The **List** button gives the same restaurants as text.

Changed files: `src/pages/MapPage.tsx`, `src/components/CitySearch.tsx` (ARIA combobox),
`src/components/QuickView.tsx`, `src/components/StackPicker.tsx`, `src/components/SaveButtons.tsx`,
`src/scoring.ts`, `src/App.tsx` (skip link, focus on navigation), `src/styles.css`.

Evidence: unit test `score colors`; browser checks beginning `markers:`, `keyboard:`, `quick view:`,
`text alternative:`, `panels:`, `filters:`, `touch targets:`, and all `axe:` runs;
screenshots `keyboard-*.jpg`, `list-panel-desktop-light.jpg`.

### 4. Discovery and sharing — Claude — done

Acceptance criteria: valid `robots.txt` and XML sitemap; unique title, description, canonical,
and social tags per restaurant; restaurant content in the initial HTML; pages follow data
updates; correct status codes; structured data with no ratings.

Approach and why: a build step (`scripts/prerender.tsx`, run by `npm run build`) renders the
same `RestaurantReport` React component to static HTML for every data file. No framework
migration was needed: the site is already static, the data is already on disk at build time,
and the daily data workflow already rebuilds and deploys the web app whenever data changes, so
pages stay in step with no workflow change. The app replaces the static markup when it starts,
after loading that page's data, so there is no loading flash.

`public/_redirects` (the catch-all that made every URL return 200) is removed. Static routes
now have real files, and `404.html` gives unknown URLs a real 404.

Changed files: `scripts/prerender.tsx`, `scripts/html.ts`, `src/lib/meta.ts`, `src/lib/usePageMeta.ts`,
`src/lib/prerendered.ts`, `src/main.tsx`, `src/lib/api.ts`, `index.html`, `package.json`,
`tsconfig.scripts.json`, `public/_redirects` (deleted).

Evidence: unit tests in `scripts/__tests__/html.test.ts`; browser checks beginning `http:` and
`initial HTML:`, `missing restaurant:`, `report: SPA navigation updates title and canonical`.

### 5. Return visits and recovery — Claude — done

Acceptance criteria: Save/Watch have visible labels and visible, announced feedback; state that
data stays on this device and where "New report" appears; nothing implies email or push;
no-match states offer clear-filter and broader-search actions; active filters stay visible;
Latest has a city filter.

Changed files: `src/components/SaveButtons.tsx`, `src/lib/saved.ts`, `src/pages/SearchPage.tsx`,
`src/pages/LatestPage.tsx`, `src/lib/search.ts`, `src/pages/PrivacyPage.tsx`, `src/pages/RestaurantPage.tsx`.

Notes: the Search query and the Search/Latest city are kept in the URL, so Back from a report
and a refresh both restore them.

Evidence: browser checks beginning `save`, `watch:`, `empty results:`, `search:`, `latest:`;
screenshots `report-saved-390-light.jpg`, `search-new-report-390-light.jpg`,
`search-empty-390-light.jpg`, `latest-city-390-light.jpg`.

## Bugs found by the tests and fixed before handoff

- A search box bound directly to the URL dropped fast keystrokes ("pizza ranch rapid" became a shorter query).
- After a keyboard zoom, a late map event could pull focus off a card that had just opened.
- With the legend open, Escape closed the legend instead of the open card.
- Rings of 1,000+ showed "1.1k" while their accessible name gave only the full number.

## Remaining issues

1. **Critical flags now cover far fewer restaurants.** After option A, 143 Sioux Falls restaurants
   carry a critical flag and no state-inspected restaurant does, because every state latest
   inspection comes from the portal. The two critical filters say so in a note. This is the
   honest state of the published data, not a defect, but it changes what those filters do.
2. **Screen reader and real-device testing not done** (see "Automated versus manual").
3. **Map marker spacing.** axe reports two overlapping markers at 390 px. WCAG 2.5.8 exempts
   targets whose position is essential and names map pins; recorded as exempt, not fixed.
4. **Targets between 24 and 44 px**: header nav links (36 px tall), theme toggle (30 px),
   card close button (36 px). They meet WCAG 2.2 AA (24 px) but not the 44 px guideline.
5. **Deploy size.** `dist/` grows from about 27 MB to about 82 MB and from about 4,500 to about
   9,000 files. This is within Cloudflare Pages limits (20,000 files) but uploads will take longer.
   First deploy should be watched.
6. **SWEEPS deep link** assumes facility type `16F`, which all 1,272 listed establishments use
   today. The page keeps a "search for the name" fallback sentence.
7. **Social preview image** is the app icon for every page; there is no per-restaurant image.
8. **Mobile app** (`apps/mobile`) still says "Clean inspection — no violations", treats an empty
   list as no violations, and has the old score colors (Codex R9). Not touched; fix before store submission.
9. **CI** does not run `npm test` or the browser suite. Not changed; assign if wanted.
10. Static pages other than restaurants (About, Privacy, and so on) prerender a heading and
    description only; their full text still needs JavaScript.

## Severity mapping verification (2026-11-12)

Question: are the section ranges in `mapSDCodeToSeverity` (`services/data-pipeline/src/sources/sd-doh.ts`)
supported by the rule text?

Sources: ARSD chapter 44:02:07 as published by the SD Legislature
(`https://sdlegislature.gov/api/Rules/44:02:07`, fetched 2026-11-12), and the critical marks on
the state's own scoresheet items as stored in this repo's data (codes 1–44).

Findings:

1. **The rule does not designate sections as critical.** 44:02:07:01(12) defines "critical item"
   in general terms. No section is marked critical, and "major" and "minor" do not appear as
   categories. The ranges cannot be derived from the rule text.
2. **The topics the code comment assigns to each range do not match the section titles.**
   The comment says :09–:14 is temperature control and :32–:46 is toxic substances. In the rule,
   :09–:12 are employee exclusions, :32 is cooling, :33 is reheating, and toxic materials are :85–:86.
3. **The mapping disagrees with the state's scoresheet in both directions.** The item-to-section
   pairing below is by topic and is my reading; there is no official crosswalk.

   | Rule section | Mapping says | State scoresheet item on the same topic |
   |---|---|---|
   | :24 contamination from equipment, utensils, wiping cloths (739 violations, the Pizza Ranch case) | Critical | 10, not critical |
   | :59, :60 storage and handling of clean equipment | Critical | 31, not critical |
   | :22 contamination during storage | Critical | 7, not critical (8, separation, is critical) |
   | :32 cooling, :33 reheating | Major | 16 and 14, critical |
   | :68, :69 handwashing lavatories and supplies (739 violations) | Minor | 37, critical |
   | :85, :86 poisonous and toxic materials | Minor | 43, critical |
   | :67 backflow, :64 water supply | Minor, Major | 36 and 34, critical |
   | :03–:05 person in charge | Minor | 1, critical |

4. **Stored data is inconsistent.** About 830 portal inspections dated before early 2026 are stored
   with every violation "minor", from before the mapping existed, so the same section carries two
   labels (for example :13 is critical 191 times and minor 70 times).

Effect on the site today: 1,329 state-inspected restaurants show a critical flag, and every one of
those flags rests only on this mapping. About 316 more cite a topic the state form marks critical
and are not flagged.

Conclusion: the ranges are not verified and should not be presented as severity.

Decision (owner, 2026-11-12): **option A — stop classifying portal citations.** Option B (a
crosswalk confirmed by SD DOH) was not chosen.

### Option A as implemented

Pipeline (`services/data-pipeline`):
- `sources/sd-doh.ts`: `mapSDCodeToSeverity` removed; portal citations are recorded as `unclassified`.
- `lib/store.ts`: `publishedSeverity(source, code, severity)` is applied on every violation write
  and again in `save()`, so severities written under the old rules, or merged in from an older
  snapshot by `merge-data.ts`, are normalized. `has_critical_violations` therefore comes only from
  official marks. A full reindex stamps `severity_rules: 2` on `index.json` and does not move
  `updated_at` (visitors see that as the data refresh date).
- `npm run reindex` script added; `.github/workflows/data-pipeline.yml` gains a `reindex` mode.
- Raw citations, descriptions, scores, dates, and counts are untouched.

Site (`apps/web`):
- `lib/inspection.ts`: severity is shown only where the record states it; portal citations read
  "Severity not published" regardless of what a data file says.
- `lib/api.ts` `applySeverityRules`: if `index.json` has no `severity_rules: 2` stamp, state
  critical flags are ignored. This makes deploy order safe: the site is correct whether or not
  the data has been reindexed yet.
- Critical filters on the map and in Search carry a note about which records have official marks.

Data: commit "data: reindex under severity rules 2" rewrites 2,791 files under
`apps/web/public/data` (12,683 portal citations set to `unclassified`; 1,329 state flags cleared;
nothing else in the index changed). It is a separate commit so it can be dropped.

**Merging.** The daily bot commits data to `main`, so the data commit will conflict there
(`index.json` certainly). Resolve by taking `main`'s data and re-running the reindex, which is
deterministic:

```bash
git checkout --theirs apps/web/public/data   # or --ours, whichever side is main in your merge
cd services/data-pipeline && npm run reindex
```

Or drop the data commit before merging and run the workflow once with mode `reindex` afterward.

R1 is this change and awaits Codex's independent check. The other findings are answered in
"Response to Codex's findings" below.

## Response to Codex's findings (`docs/dinesafe-review.md`)

Reproduced each in the code before changing anything. All of this awaits Codex's independent check.

| Finding | Status | What changed | Evidence |
|---|---|---|---|
| R1 unverified severity | fixed | See "Option A as implemented" above | web and pipeline unit tests; browser checks `map card:`, `search card:`, `report` |
| R2 missing count becomes zero | fixed going forward | `lib/parsing.ts` `parseViolationCount` returns null for missing or unreadable text; the page now hands back raw link text and the count is parsed outside the browser. Both the results grid and Past Inspections use it. An unknown count still tries the violations link. For Sioux Falls, no parsed rows count as zero only when the score is 100. | pipeline tests `SD DOH violation count (R2)`, `counts zero only when the score is 100`; live one-county run unchanged |
| R3 same-score Sioux Falls inspections never fetched | fixed | The list page publishes only "Last Score" (checked on the live page). Each daily run now also re-reads a rotating one-seventh of establishments, so every one, including those with no list score, is re-read at least weekly (about 180 extra requests a day). Detail fetches retry once. | pipeline tests `SWEEPS detail refresh (R3)`; live parse matches stored records |
| R4 partial ingestion marked successful | fixed | `syncAll()` returns failed counties; run records gain a `partial` status with what was missed; every sync job exits non-zero after saving progress. Sioux Falls per-establishment errors make the run partial. The site shows a plain-language notice on Latest, Search, About, and the map legend when a source failed, was partial, or has not been checked for 3 days. Internal error text is never shown. | pipeline tests `run records (R4)`; web tests `source health notices (R4)` |
| R5 ZIP-less rooftop lookup ignores city | fixed | Without a ZIP, an address point is accepted only if its ZIP is already on record for the requested city, and a Nominatim hit must name the same city or sit in one of its ZIPs. With a ZIP, behavior is unchanged. | pipeline tests `ZIP-less location trust (R5)` |
| R6 itemized rows replace the source count | fixed | When the record's count and its itemized rows differ, the report states both and limits severity statements to "the itemized ones". Stored counts are untouched. | web tests `source count versus itemized rows (R6)`; browser check on the 2nd Street Diner record |
| R7 failed fetches have no recovery | fixed | A 404 is "not found"; anything else is an outage with a message and a working Try again on the map, Search, Latest, and reports. An outage on an existing report is no longer "not found" or `noindex`. Outages retry twice automatically; a missing record is never retried. | web test `load failures (R7)`; nine browser checks beginning `outage:` |
| R8 Search drops filters on Back | fixed | Score, critical, saved, and sort are in the URL with query and city. Map filters persist while the page is open. | browser checks `search: score filter and sort survive Back`, `filters survive refresh`, `map: filters survive leaving the map` |
| R9 native app wording and contrast | **not fixed** | The native app cannot be built or run here, and its status logic is a separate copy. Recommend porting `lib/inspection.ts` and `scoring.ts` rather than patching strings. Must be done before store submission. | none |
| R10 dependency advisories | partly | `maplibre-gl` 5.24.0 → 5.24.1 (the patched release for GHSA-jrc7-96c5-q579); lockfile only. No other upgrades; the rest need the reachability triage Codex describes. | full browser suite on the new version |

Known limits of these fixes:

- **R2 does not repair stored data.** No stored zero contradicts its score (none sits beside a
  score under 100). 67 past state inspections have a zero count and no score; those cannot be
  told apart from the old parser's fallback and are left as published.
- **R3 worst case is 7 days** for a same-score Sioux Falls inspection to appear.
- **R4 will open a GitHub issue on any partial run**, including one unreadable Sioux Falls page
  after a retry. That is deliberate; loosen it if it proves noisy.
- **R5 changes nothing already stored.** It only affects future geocoding. Existing pins were
  not re-audited here.
- **R7 on a prerendered report** replaces the static report with the outage message rather than
  keeping it on screen.
- The current local `index.json` shows the state source last checked on November 8, so the new
  3-day notice appears in today's screenshots. That is accurate for this checkout.

## Response to Codex's second pass (at `56f7febc`)

| Codex item | Status | What changed | Evidence |
|---|---|---|---|
| 1. State establishment failures look successful (R4) | fixed | `sd-doh.ts` records every establishment it could not process, every violations list or history it could not read, and a count above zero with no rows read. `syncAll()` returns them as `failedRecords`; any makes the run `partial` and the job exit non-zero. `extractViolations` and `extractPastInspections` no longer turn an error into an empty list. A county missing from the portal's list is now a failed county, not a silent skip. | `doh-run.test.ts`: real `syncAll`/`syncByCounty` loop, one failing record among three → partial, other two still processed |
| 2. Score of 100 stands in for missing evidence (R2) | **inference kept, by owner decision**; tightened | The live city page for a clean inspection prints only the date and "Total Score:100", so there is no explicit zero to read. Zero is now taken from, in order: parsed rows; an explicit "No Violations" statement; or a score of 100 with no violation markup on the report at all. Violation markup that cannot be read is unknown even at 100. The report says the zero is read from the score, and About explains it. | pipeline tests `infers zero from a score of 100 only when the report lists nothing at all`, `does not infer zero when violation markup is present but unreadable`, `takes an explicit “No Violations” statement as zero`; web test `Sioux Falls zero read from the score`; browser check `none recorded (Sioux Falls)` |
| 3. Unreadable HTTP-200 Sioux Falls page counted as success (R4) | fixed | `detailProblem` rejects a response that is not an establishment page, has an unreadable inspection block, or shows no inspection although the list has a score. Such a page gets one retry, then counts as a failed establishment (partial run); stored records are untouched. | pipeline tests `unreadable SWEEPS responses (R4)`; live pages for sites 144, 715, 2400 still parse and match stored records |
| 4. HTML outage mistaken for absence (R7) | fixed | Only a 404 is "not found". A 200 that is not JSON is an outage with a retry, and is not `noindex`. | browser check `outage: an HTML 200 response is an outage` |
| Intermittent List → card → Escape focus on body | fixed, cause identified | Focus was restored inside `requestAnimationFrame`, which does not fire in a background or throttled tab. It now runs in an effect after the card is removed. The tests wait on focus itself instead of a fixed 150 ms. | keyboard group passed 3 runs in a row; not reproduced before or after on this machine, so the cause is inferred from the code, not observed |

Codex's fixture for item 2 ("Findings unavailable" text beside a score of 100) still yields zero,
because the page carries no violation markup. That is the inference the owner chose to keep.

Side effect to expect: with item 1, a dev server that returns the app shell for a missing data
file (Vite does) now shows the outage message for an unknown restaurant instead of "not found".
The production host returns a real 404.

## Codex review

_(Codex: record findings here.)_
