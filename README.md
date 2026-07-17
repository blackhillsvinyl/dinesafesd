# DineSafeSD — South Dakota Restaurant Health Inspections

A free cross-platform app (iOS, Android, web) displaying restaurant health
inspection data on an interactive map for all of South Dakota. Read-only public
data — no accounts, no tracking, **no backend**.

## Features

- Interactive map with color-coded restaurant markers by inspection score
- Search restaurants by name, city, or address, with filters
- Detailed inspection history and violations
- Save favorites and watchlist (stored on-device)
- Data refreshed daily from official sources

## Architecture

Fully static. The pipeline maintains a JSON tree committed to the repo at
`apps/web/public/data/` (an index of all restaurants plus one detail file per
restaurant). Cloudflare Pages serves it alongside the web app; the mobile app
fetches the same files. There is no database and no API server.

```
GitHub Action (daily) ─► pipeline ─► apps/web/public/data/*.json ─► git push
                                                                      │
                              Cloudflare Pages deploys on push ◄──────┘
                                       │
                    web app (same origin) + mobile app (fetch)
```

- **Mobile App**: React Native + Expo (`apps/mobile`)
- **Web App**: Vite + React + maplibre-gl (`apps/web`) — also hosts the privacy
  policy, terms, and support pages required by the app stores
- **Data Pipeline**: Node.js + Puppeteer (`services/data-pipeline`); persistence layer is
  `src/lib/store.ts`, which writes the JSON tree and computes derived fields
  (latest/average score, violation categories)

## Project Structure

```
dinesafesd/
├── apps/mobile/          # React Native Expo app
├── apps/web/             # Web app + legal pages + published data files
├── services/data-pipeline/ # Data ingestion (SD DOH + Sioux Falls SWEEPS)
└── .github/workflows/    # Daily/monthly sync schedule (commits data)
```

## Getting Started

```bash
git clone https://github.com/blackhillsvinyl/dinesafesd.git
cd dinesafesd
npm install

# Web app (serves the committed data files)
npm run dev --workspace=web        # http://localhost:5173

# Mobile app
cd apps/mobile && npm start        # full map needs a dev build: npx expo run:ios

# Data pipeline (test mode: one county, live SD DOH)
cd services/data-pipeline && npm run sync:test
```

No environment variables are required. The mobile app optionally accepts
`EXPO_PUBLIC_DATA_URL` to point at a local data server during development.

## Data Pipeline

| Job | Schedule | What it does |
|-----|----------|--------------|
| `sync:daily` | Daily 6 AM Central | SD DOH incremental (last 7 days, all 66 counties) + Sioux Falls SWEEPS |
| `sync` + SWEEPS `--all-details` | Monthly on the 1st | Full statewide backfill |

Each run records per-source status in `index.json` (powers "Data updated X ago"
in the apps) and commits changed files; the push triggers the Cloudflare Pages
deploy. Failed scheduled runs automatically open a GitHub issue.

## Data Sources

- **South Dakota DOH**: https://sddoh.safefoodinspection.com (all 66 counties)
- **City of Sioux Falls SWEEPS**: https://sweepsdata.siouxfalls.gov

## License

MIT
