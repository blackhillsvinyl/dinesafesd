# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Everyday South Dakota diners checking a restaurant before eating there — a quick, mostly-on-phone lookup ("is this place clean?"). No login, no onboarding hurdle; a first-time visitor should get an answer in seconds. Secondary audiences (journalists, officials) exist but are not the design target.

## Product Purpose

DineSafeSD is a free, public-good map of restaurant health-inspection data for all of South Dakota, on web (dinesafesd.com), iOS, and Android. Success means it exists, is accurate and current, and costs approximately nothing to run — a community service (and portfolio piece), not a revenue product. Confirmed: this is not monetized and has no growth targets.

## Positioning

The only statewide SD inspection map: official state (SD DOH, all 66 counties) and Sioux Falls SWEEPS data, refreshed daily, presented as a searchable color-coded map instead of the state's raw portal. Durable historical record: the state only keeps 2 years of scores, so DineSafeSD's own store becomes the longest-running public history. Radically simple stance a competitor would struggle to copy honestly: no accounts, no tracking, no ads, no backend.

## Operating Context

- Typical use: standing outside or searching a town before a meal; phone-first, short sessions.
- Web app doubles as the host for privacy policy, terms, and support pages required by the app stores.
- Data flows one way: a daily GitHub Action runs the pipeline, commits JSON to `apps/web/public/data/`, and Cloudflare Pages deploys; mobile fetches the same static files.
- Live at dinesafesd.com; mobile app is v1.0.0 pending app-store accounts/submission.

## Capabilities and Constraints

- Interactive map (maplibre-gl on web; native map in Expo) with color-coded markers by inspection score; search by name/city/address with filters; per-restaurant inspection history and violation details; on-device favorites/watchlist.
- Fully static architecture is a hard constraint: no database, no API server, no auth. Anything requiring server state is out of scope.
- Read-only public data; the app never edits or interprets beyond derived fields (latest/average score, violation categories).
- One shared product across web + iOS + Android; the mobile app is a real native (React Native + Expo) app, not a web wrapper, with a single shared design language rather than per-OS variants.
- Known data gaps future work must state honestly, never paper over (see `docs/data-coverage.md`): tribal lands (IHS/tribal inspections not published), score history depth (scores only in report PDFs; some old inspections have violation counts but no score), SWEEPS limited to two most recent inspections per establishment.
- Terminology: "inspection score", "violations", establishments come from official sources — do not invent grading language (e.g. letter grades) the state doesn't use.

## Brand Commitments

- Name **DineSafeSD** and domain **dinesafesd.com** are binding.
- The current visual identity (green #22c55e icon/splash, current app look) is explicitly **open to revisiting** — treat as incumbent evidence, not a commitment.
- Voice: factual, neutral civic tone; the app reports official data and must never editorialize a restaurant as "dirty" or "unsafe".

## Evidence on Hand

- Real, refreshed-daily inspection data for all 66 counties committed at `apps/web/public/data/` (index + per-restaurant detail files), including per-source sync status powering "Data updated X ago".
- Official sources: SD DOH portal (sddoh.safefoodinspection.com), Sioux Falls SWEEPS (sweepsdata.siouxfalls.gov). Coverage and gap detail in `docs/data-coverage.md`.
- App icons/splash assets in `apps/mobile/assets/`.
- No testimonials, press, or usage metrics exist — never fabricate any.

## Product Principles

1. **Answer in seconds** — a stranger with a restaurant name should reach its score without instructions, accounts, or ceremony.
2. **Report, don't judge** — present official scores and violations neutrally; the data carries the verdict.
3. **Honest about gaps** — coverage limits (tribal lands, score history) are stated in-product, not hidden.
4. **Static forever** — every feature must work as committed JSON on a CDN; simplicity is the reliability model.
5. **Free means free** — no accounts, tracking, ads, or dark patterns, ever.

## Accessibility & Inclusion

No formal standard mandated, but as a public civic service the practical bar is WCAG 2.1 AA on web and platform accessibility (VoiceOver/TalkBack) on mobile. Score color-coding must never be the sole carrier of meaning — pair color with the numeric score.
