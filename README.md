# LAN Pong Arena

Self-hosted, browser-native two-player Pong arena for a local area network (LAN). Players open the host URL in a desktop browser, pick a nickname and avatar (bundled gallery or uploaded PNG/JPEG/WebP), discover players in a live lobby, exchange challenges, and play server-authoritative 60 Hz matches with automatic reconnect recovery.

## Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` if you want to customize settings (optional):
   ```bash
   cp .env.example .env
   ```
2. Build and start the container:
   ```bash
   docker compose up -d --build
   ```
3. Verify health:
   ```bash
   curl http://127.0.0.1:3000/healthz
   ```
4. Share the host LAN URL (`http://<LAN_HOST_IP>:3000`) with players. You can also click **Share LAN URL** in the app header to view detected LAN IPv4 addresses and an offline QR code.

Uploaded avatars are stored as sanitized 256x256 WebP images inside the `avatars_data` Docker volume (`/data/avatars`) and persist across container restarts. Active matches and lobby sessions stay in memory and reset cleanly on container restart.

## Offline / Air-Gapped LAN Preparation

Build and export the image while connected to the internet, then load it on an isolated LAN host:

```bash
# On a machine with Docker and internet access
docker build -f app.Dockerfile -t lan-pong-arena:latest .
docker save -o lan-pong-arena.tar lan-pong-arena:latest

# On the offline LAN host
docker load -i lan-pong-arena.tar
docker compose up -d --no-build
```

No external CDNs, hosted fonts, or cloud APIs are used at runtime.

## Local Development & Tests

```bash
npm install --legacy-peer-deps
npm run dev      # Starts Express + WebSocket + Vite dev middleware on port 3000
npm test         # Runs Vitest unit and WebSocket protocol integration tests
npm run lint     # TypeScript typecheck
npm run build    # Builds production client bundle into dist/
npm start        # Runs production server via Node.js (requires npm run build first)
```

## Controls, Demo Mode & Match Rules

- **Move Paddle:** `W` / `S` or `ArrowUp` / `ArrowDown`
- **Demo Mode (`Demo Player`):** Challenge **Demo Player** in the Lobby at any time to auto-start a practice match against a full-height opponent paddle to test paddle controls and angled ball bounces.
- **Countdown Head Start:** Paddles unlock during the final 1 second of the pre-serve countdown (from second 2 onward on match start) so players can position before the ball moves.
- **Win Condition & Timeouts:** Default first to 5 points wins, 30s challenge expiry, and 10s disconnect grace (all configurable at runtime in `/admin`).
- **Live Server Ping:** Real-time WebSocket round-trip latency (`ms`) appears in the Top Bar and Match HUD to spot network lag immediately.

## Leaderboard (`/leaderboard`)

Visit `/leaderboard` (or click **Leaderboard** in the top navigation bar, or query `GET /api/leaderboard`) to view live runtime rankings since the server started, including **Demo Player**. Top three players display Gold, Silver, and Bronze trophy icons alongside total matches played, won, lost, forfeited, longest match duration, and live ping / lag status.

## Admin Console (`/admin`)

Visit `/admin` (or click **Admin** in the top navigation bar) to configure runtime server settings without restarting the container:

- **Host IP / URL:** Explicitly set the LAN IPv4 address or URL shown in **Share LAN URL** (recommended when running inside Docker on bridge networking).
- **Gameplay Physics & Rules:** Tune paddle length (`0.08–0.45`), paddle speed (`0.30–2.50`), ball initial/increment/max speeds, and points to win (`1–21`).
- **Timeouts:** Adjust challenge expiry, disconnect grace period, and initial/after-point/reconnect countdown durations.

Set `ADMIN_PASSCODE` in `.env` to lock `/admin` with a predefined passcode, or leave it unset to claim a one-time passcode on your first visit to `/admin`.

## Troubleshooting

- **Other devices cannot reach the page:**
  - Confirm the host's LAN IPv4 address (`ip addr`, `ifconfig`, or `ipconfig`) and share `http://<LAN_HOST_IP>:3000`, not `localhost` or `127.0.0.1`.
  - Allow inbound TCP port `3000` on the host firewall (e.g., `sudo ufw allow 3000/tcp`).
- **Devices on the same Wi-Fi cannot connect to each other:**
  - Public, conference, or guest Wi-Fi networks often enable **AP/client isolation**, blocking peer-to-host LAN traffic. Use a private router, travel AP, or mobile hotspot.
- **WebSocket connection fails through a reverse proxy:**
  - Ensure your proxy forwards `Upgrade` and `Connection: upgrade` headers for `/ws`, and add the proxy origin to `ALLOWED_ORIGINS` if `Origin` differs from `Host`.
- **Trust Note (LAN MVP):**
  - Traffic on a plain HTTP LAN (`http://` / `ws://`) is unencrypted; run behind a trusted local network or terminate TLS in front if deploying on untrusted networks.

## License

This project is licensed under the [MIT License](LICENSE).
