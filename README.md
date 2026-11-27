# Pong2000

A multi-part Pong project containing the networked LAN multiplayer arena, an upcoming standalone single-page 2-player local game, and an upcoming promotional website.

---

## Repository Structure

| Path | Purpose | Status |
| :--- | :--- | :--- |
| [`game/multi/`](game/multi/) | Self-hosted networked 2-player Pong arena (Node.js + Express + WebSocket + React) | **Implemented** |
| [`game/single/`](game/single/) | Single-page, non-networked 2-player local Pong edition (`W/S` vs `↑/↓`) | **Implemented** |
| [`website/`](website/) | Pong2000 marketing & landing website | Planned |
| [`docs/`](docs/) | Shared product definition, screenshots, and commercial videos | Active |

---

## Showcase Media (`docs/`)

### Commercial Videos
- [Video 01](docs/videos/01/pong2000-commercial.mp4) — [`docs/videos/01/video.md`](docs/videos/01/video.md)
- [Video 02](docs/videos/02/pong2000-commercial.mp4) — [`docs/videos/02/video.md`](docs/videos/02/video.md)

### Screenshots
- **Initial Profile Creation:** [`docs/screenshots/initial-profile.png`](docs/screenshots/initial-profile.png)
- **Arena Lobby:** [`docs/screenshots/arena-lobby.png`](docs/screenshots/arena-lobby.png)
- **Edit Profile (Profile & Demo Player Modes):** [`docs/screenshots/edit-profile-tab.png`](docs/screenshots/edit-profile-tab.png) · [`docs/screenshots/edit-demo-modes-tab.png`](docs/screenshots/edit-demo-modes-tab.png)
- **Arena Leaderboard:** [`docs/screenshots/leaderboard.png`](docs/screenshots/leaderboard.png)
- **Live Two-Player Match:** [`docs/screenshots/gameplay-session.gif`](docs/screenshots/gameplay-session.gif)
- **Admin Console:** [`docs/screenshots/admin.png`](docs/screenshots/admin.png)

---

## Playable Editions

- **Networked Multiplayer ([`game/multi/`](game/multi/)):** See [`game/multi/README.md`](game/multi/README.md) for gameplay documentation, [`game/multi/docs/build/README.md`](game/multi/docs/build/README.md) for Docker & offline deployment, and [`game/multi/docs/architecture/design.md`](game/multi/docs/architecture/design.md) for system architecture.
- **Single-Page Local 2-Player ([`game/single/`](game/single/)):** See [`game/single/README.md`](game/single/README.md) for shared-keyboard play (`W/S` vs `↑/↓`) reusing `game/multi`'s physics, match logic, and UI.

Root workspace commands:

```bash
npm install --legacy-peer-deps
npm run dev           # Start multi Express + WS + Vite dev server on port 3000
npm run dev:single    # Start single-page local 2-player Vite server on port 3001
npm test              # Run all Vitest unit & integration suites (multi + single)
npm run lint          # TypeScript typecheck (game/multi; use lint:single for game/single)
npm run build         # Build production client bundle (use build:single for game/single)
```

---

## License

This project is licensed under the [MIT License](LICENSE).
