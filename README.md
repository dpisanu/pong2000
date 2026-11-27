# Pong2000

A multi-part Pong project containing the networked LAN multiplayer arena, an upcoming standalone single-page 2-player local game, and an upcoming promotional website.

---

## Repository Structure

| Path | Purpose | Status |
| :--- | :--- | :--- |
| [`game/multi/`](game/multi/) | Self-hosted networked 2-player Pong arena (Node.js + Express + WebSocket + React) | **Implemented** |
| [`game/single/`](game/single/) | Single-page, non-networked 2-player local Pong edition | Planned |
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

## Networked Multiplayer (`game/multi/`)

See [`game/multi/README.md`](game/multi/README.md) for full gameplay documentation, [`game/multi/docs/build/README.md`](game/multi/docs/build/README.md) for Docker & offline deployment instructions, and [`game/multi/docs/architecture/design.md`](game/multi/docs/architecture/design.md) for system architecture.

Root workspace commands delegate directly to `game/multi`:

```bash
npm install --legacy-peer-deps
npm run dev      # Start Express + WS + Vite dev server on port 3000
npm test         # Run all Vitest unit (client/server/shared) & WS integration tests
npm run lint     # TypeScript typecheck
npm run build    # Build production client bundle into game/multi/dist/
```

---

## License

This project is licensed under the [MIT License](LICENSE).
