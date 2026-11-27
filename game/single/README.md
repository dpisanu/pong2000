# Pong2000 — Single-Page Local 2-Player Edition

> **Status:** Implemented

A standalone, non-networked 2-player local edition of **Pong2000** for shared-keyboard couch play in a single browser page — no backend server, lobby, or WebSocket connection required.

Opening the app immediately enters a live match with two human-controlled paddles (`Player 1` on the left, `Player 2` on the right).

For full local serving, production build, and static hosting instructions, see [`docs/build/README.md`](docs/build/README.md).

---

## Controls

| Player | Paddle | Keys |
| :--- | :--- | :--- |
| **Left Player** (`Player 1`) | Emerald paddle (left) | `W` (Up) / `S` (Down) |
| **Right Player** (`Player 2`) | Sky paddle (right) | `↑` (Up) / `↓` (Down) |

Both players control their paddles simultaneously on the same keyboard. Matches play to **5 points** with pre-serve countdowns, WebAudio sound effects, and instant **Play Again** or **Swap Sides & Rematch** actions.

---

## Shared Architecture (Zero Code Duplication)

`game/single` is a thin Vite + React shell that directly imports the canonical game logic, physics, and UI components from [`../multi/`](../multi/) via the `@multi` path alias and Vite `publicDir`:

| Layer | Reused Module in `game/multi/` |
| :--- | :--- |
| **Game Physics & AI** | [`game/multi/src/shared/pongEngine.ts`](../multi/src/shared/pongEngine.ts) |
| **60 Hz Match Loop** | [`game/multi/src/shared/localMatch.ts`](../multi/src/shared/localMatch.ts) |
| **Constants & Types** | [`game/multi/src/shared/constants.ts`](../multi/src/shared/constants.ts), [`types.ts`](../multi/src/shared/types.ts) |
| **Match HUD & Controls** | [`game/multi/src/client/game/MatchView.tsx`](../multi/src/client/game/MatchView.tsx) |
| **Arena Canvas & Audio** | [`game/multi/src/client/game/PongArenaCanvas.tsx`](../multi/src/client/game/PongArenaCanvas.tsx), [`soundFx.ts`](../multi/src/client/audio/soundFx.ts) |
| **Styles & Avatars** | [`game/multi/src/client/index.css`](../multi/src/client/index.css), [`game/multi/assets/avatars/`](../multi/assets/avatars/) |

Updates to shared physics, court styling, audio, or match HUD in `game/multi` automatically apply to `game/single`.

---

## Commands

Run from the repository root (after `npm install --legacy-peer-deps`):

```bash
npm run dev:single    # Start Vite dev server on port 3001
npm run test:single   # Run Vitest unit tests in game/single/tests/
npm run lint:single   # TypeScript typecheck
npm run build:single  # Build static SPA into game/single/dist/
```

Or run directly inside `game/single/`:

```bash
npm run dev
npm test
npm run lint
npm run build
```
