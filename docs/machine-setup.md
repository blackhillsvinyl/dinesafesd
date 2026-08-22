# Machine setup — running DineSafeSD from any device

Everything operational lives off-machine: the daily data sync runs in GitHub
Actions (`.github/workflows/data-pipeline.yml`) and Cloudflare Pages deploys on
every push to `main`. **No secrets are required** — the project is fully static
and the repo is the single source of truth. Setting up a new machine is just
clone + install.

## 1. Prerequisites

- **Node.js 20+** (project developed on 24/26; no `engines` pin)
- **git**, and the **GitHub CLI** (`gh auth login`) with push access to
  `blackhillsvinyl/dinesafesd`
- (optional, only to run the pipeline locally) Chromium for Puppeteer:
  `npx puppeteer browsers install chrome` — normally unnecessary, CI runs it

## 2. Clone and verify

```bash
git clone https://github.com/blackhillsvinyl/dinesafesd.git
cd dinesafesd
npm install
npm run build                      # turbo builds web + packages
npm run dev --workspace=web        # http://localhost:5173 — map should load
```

If the map renders with data, the machine is fully set up. The web app serves
the committed JSON under `apps/web/public/data/` — no database, no API keys.

## 3. What does NOT transfer (and why that's fine)

- `services/data-pipeline/.env` (SUPABASE_*) — **legacy**, referenced by
  nothing in the codebase; do not copy it to new machines. Delete the old
  Supabase project when convenient.
- `.env.local` at the repo root — empty; ignore.
- The mobile app needs no env config (`apps/mobile/.env.example`).

## 4. Claude Code state (optional but recommended)

Machine-local Claude state does not travel with git:

- **Project memory**: `~/.claude/projects/<slugified-repo-path>/memory/`
  (the slug is the absolute repo path with `/` → `-`, e.g.
  `-home-user-dinesafesd`). Copy the memory `*.md` files from the old
  machine into the new path after opening Claude Code in the repo once.
- **Permission allowlist**: `.claude/settings.local.json` in the repo dir
  (git-ignored). Copy it over, or just re-approve prompts as they come.

## 5. Remote management

Options, best first:

1. **Tailscale + SSH** — install Tailscale on both devices, enable
   Tailscale SSH on the always-on box, then `ssh <box>` from anywhere and run
   `claude` in the repo. Zero open ports, works from a phone with Termius.
2. **Claude Code teleport** — start work on any device and `/teleport` the
   session, or use claude.ai/code cloud sessions against the GitHub repo.
3. **tmux** on the always-on box so long-running Claude sessions survive
   SSH disconnects: `tmux new -s dinesafe`, later `tmux attach -t dinesafe`.

## 6. Routine operations cheat-sheet

| Task | Where it runs | How |
|---|---|---|
| Daily data sync | GitHub Actions | automatic; check the Actions tab |
| Deploy web | Cloudflare Pages | automatic on push to `main` |
| Manual sync | any machine | `npm run sync:incremental` |
| Data backup | GitHub Actions | `backup-data.yml` |
