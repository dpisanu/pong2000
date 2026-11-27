# Pong2000 Website

> **Status:** Implemented (GitHub Pages ready)

The public landing page and showcase website for **Pong2000**, featuring:
- Overview of both Pong2000 editions (**Networked LAN Arena** + **Single-Page Local 2-Player**)
- Embedded commercial trailers (`docs/videos/01/` and `docs/videos/02/`)
- Interactive screenshot showcase (`docs/screenshots/`)
- A live **Test It** tab embedding the single-page 2-player game (`W / S` vs `↑ / ↓`) directly from `game/multi`'s shared physics and UI components

---

## Local Commands

From the repository root (`/`), after `npm install --legacy-peer-deps`:

```bash
npm run dev:website     # Start local Vite dev server on http://localhost:3002
npm run lint:website    # TypeScript typecheck
npm run build:website   # Build static GitHub Pages bundle into website/dist/
npm run deploy:website  # Build and push website/dist/ to the gh-pages branch
```

---

## GitHub Pages Deployment

Two deployment paths are included:

1. **Automated via GitHub Actions (Recommended):**
   - Workflow file: [`../.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
   - Automatically builds `website/dist/` and deploys to GitHub Pages on every push to `main` (or manually via **Run workflow**).
2. **Manual branch deploy script:**
   - Script: [`scripts/deploy-gh-pages.sh`](scripts/deploy-gh-pages.sh) (`npm run deploy:website`)
   - Builds `website/dist/` and force-pushes the static output (including `.nojekyll`) to the `gh-pages` branch on `origin`.

`vite.config.ts` uses `base: './'` and bundles shared trailers, screenshots, and SVG avatars directly into `website/dist/`, so the built site works cleanly on both project sites (`https://<user>.github.io/<repo>/`) and user/organization root sites (`https://<user>.github.io/`).
