# LAN Pong Arena — Project Definition

**Version:** 1.20  
**Status:** Implemented MVP+ specification  
**Date:** 2026-11-21  
**Deployment:** Docker on a LAN host  
**Clients:** Desktop browsers, keyboard input  
**Avatar support:** Built-in gallery and custom image upload

## 1. Executive summary

LAN Pong Arena is a self-hosted, browser-native, two-player Pong application for a local area network (LAN). Each player opens the same server URL in a desktop browser, creates a lightweight profile with a unique nickname, discovers available players in a live lobby, issues or accepts challenges, and plays a synchronized match. Multiple independent matches may run simultaneously. The system does not require internet access, accounts, or cloud services.

**Architectural decision:** A single Dockerized Node.js application serves the browser client and maintains WebSocket connections. The server owns lobby, matchmaking, and game simulation state. Browsers send inputs and render authoritative snapshots.

## 2. Goals and success measures

### Goals
1. Allow two people on separate LAN devices to start and finish a Pong match without installation beyond a browser.
2. Provide a live player directory with unambiguous unique nicknames and an explicit challenge/accept workflow.
3. Maintain consistent game state through a server-authoritative simulation.
4. Handle disconnections, reconnects, invitations, and rematches predictably.
5. Run as one Docker Compose service without external dependencies.
6. Support nickname, gallery avatar, and uploaded avatar images.
7. Make LAN discovery and sharing effortless via accurate host IP detection and an offline QR code.

### Success measures
- Two devices can discover one another and complete a match on an isolated LAN.
- Two separate pairs can play at once without state leakage.
- All acceptance scenarios in §13 pass.
- A fresh host can start the application using documented Docker Compose commands.

## 3. Target users and environment

- **Players:** Attendees using current desktop Chrome, Firefox, Edge, or Safari, with a keyboard.
- **Operator:** One person starts the Docker container and shares the host's LAN URL.
- **Network:** IPv4 LAN with client-to-host connectivity; no NAT traversal, public DNS, tunneling, or internet routing is required.
- **Assumption:** The LAN permits inbound TCP traffic to the exposed application port. Conference Wi-Fi client isolation may prevent connectivity; use an access point/hotspot or network with client-to-host access.
- **Trust model:** Friendly event LAN, not a hostile public internet deployment. Basic input validation, limits, and isolation remain mandatory.

## 4. In-scope functionality — seven MVP features

### F1. Player profile
- On first visit, ask for a nickname (1–24 visible characters after trimming) and avatar.
- **Unique nicknames (v1.01):** Nicknames are enforced as case-insensitively unique across all active and disconnect-grace sessions (`NICKNAME_TAKEN` returned on collision during `session.hello` or `profile.update`). Reconnecting with a valid recovery token or updating an avatar while keeping one's own nickname is permitted.
- Avatar can be selected from 8 bundled predefined SVG emblems **or uploaded** from the player's device (including during initial onboarding, where the file is queued and uploaded immediately once the session handshake issues an upload token).
- Accept PNG, JPEG, or WebP uploads; enforce a 1 MiB file limit and decode/validate server-side via `sharp`. Re-encode to sanitized 256×256 px WebP (stripping EXIF/metadata); never serve original untrusted bytes or SVG.
- Uploaded avatars are stored in a Docker volume and exposed via generated opaque IDs/URLs, with a per-session rate limit and stored avatar cap (obsolete uploads are pruned automatically). Use `/avatars/default.svg` as a generic fallback when unavailable.
- Store nickname, avatar reference, and a reconnect credential in browser `localStorage`. The server assigns an opaque player/session ID (`pl_*`) as the canonical internal identifier and holds the HTTP upload bearer token strictly in client memory.
- Editing the profile updates lobby presence only after server validation succeeds; rejected edits (such as duplicate nicknames) keep the editor open with inline feedback and do not overwrite saved preferences. Changing an avatar does not interrupt a match.
- No password, registration, or identity verification.

### F2. Live lobby & Demo mode
- Show connected players with nickname, avatar, and status (`AVAILABLE`, `INVITED`, `IN_GAME`, `DISCONNECTED`).
- Include a built-in virtual **Demo Player** (`bot_demo_player`) that remains `AVAILABLE` in the lobby and auto-accepts challenges so any solo player can immediately test paddle movement and angled ball bounces.
- Provide client-side filtering between `All Players` and `Available Only`.
- Update the list automatically via WebSocket events; no manual refresh.
- Do not allow challenging oneself, offline players, or human players not `AVAILABLE`.
- Multiple concurrent games (including concurrent Demo matches for different players) are supported; the lobby reflects player availability accurately.
- Display a clear server-connection indicator, live WebSocket round-trip ping latency (`ms`), and reconnecting state.

### F3. Challenges
- An available player may invite one other available player.
- The recipient can accept or decline; the initiator can cancel.
- Invitations expire after 30 seconds with a live countdown in the lobby panel.
- Server handles races atomically: at most one active invitation per player, no double-booking, no simultaneous accept into multiple matches.
- Challenge outcomes are sent to both affected players, with structured error codes for invalid operations.
- On acceptance, create a match and assign paddle sides; notify both clients.

### F4. Pong gameplay & Demo mode
- Classic 2D Pong on a `16:10` logical arena: one paddle per player, ball, walls, swept/sub-stepped collision response, scores, center serve.
- Desktop controls: `W`/`S` and `ArrowUp`/`ArrowDown`; prevent browser scrolling (`ArrowUp`, `ArrowDown`, `Space`) while match controls are active. Keyboard listeners remain mounted stably across 30 Hz snapshots (ref-backed dispatch, `e.repeat` ignored) so initial key presses register immediately without spurious direction resets.
- Server is authoritative for paddle positions, ball physics, collision detection, scoring, and win condition, using the configured runtime `MatchRulesConfig` snapshot at match creation.
- **Demo Mode:** Challenging `Demo Player` spawns a server-authoritative practice match in which the `Demo Player` paddle spans the complete vertical height (`1.0`) of its court side, returning every incoming shot with natural hit-offset bounce angles so players can practice movement and ball control. Supports instant side-swapped rematch and standard leave/return-to-lobby cleanup.
- Fixed simulation timestep: 60 Hz (`4` collision substeps per tick to prevent ball tunneling). Broadcast snapshots at 30 Hz (every 2 ticks). Browser renders via `requestAnimationFrame`, interpolating between snapshots and applying visual-only client-side prediction for the player's own paddle reconciled smoothly against authoritative snapshots.
- Default first to 5 points wins (configurable via `/admin` from 1 to 21); show scores, avatars, side indicator, live ping latency (`ms`), and opponent connection status in the match HUD.
- Synthesized Web Audio API sound effects (paddle hits, wall bounces, countdown ticks, point chimes, match finish) with a mute/unmute toggle in the match HUD; zero external audio assets.
- Ball serves after a configurable short countdown (default `3s` initial, `1.5s` after a point, `2s` on reconnect resume). Paddles unlock for the final `1s` of the countdown (`COUNTDOWN_PADDLE_UNLOCK_MS = 1000`, i.e., from second 2 onward in the initial 3-second countdown), indicated by an emerald `1` and **"Paddles active — position now"** overlay so players get a 1-second head start to anticipate the serve before the ball moves. Use deterministic bounded speeds and hit-offset bounce angles.
- Client sends directional intent (`-1`, `0`, `1`) with monotonic `seq` only on state changes; clears intent on window blur/visibility loss.
- Input is associated with the authenticated WebSocket session; clients cannot control another player's paddle.

### F5. Match lifecycle
- Match transitions from `COUNTDOWN` to `PLAYING`, then `FINISHED`, or `PAUSED_DISCONNECT` and possibly `FORFEITED`.
- On match end, show winner, final score, outcome reason, and actions to return to lobby or request a rematch.
- Rematch requires agreement from both players; creates a **new match ID**, resets scores and physics, and automatically swaps paddle sides (`left` ↔ `right`).
- Returning to lobby marks player `AVAILABLE` once the current match is closed and cancels any pending rematch request.
- An explicit leave-match action requires an in-UI two-step confirmation (`Leave Match` → `Confirm Forfeit`) while active and is treated as a forfeit.

### F6. Connection handling
- Server detects disconnect via WebSocket close and 5-second heartbeat ping/pong (15-second timeout).
- When a player disconnects during a match, pause simulation and allow a 10-second reconnect grace period with a live countdown overlay.
- Browser reconnects with bounded exponential backoff (`0.5s`–`8s`) and a high-entropy session-recovery token; server rebinds the session after validation and rotates both recovery and upload tokens.
- On successful reconnection, send full authoritative lobby/match state and resume play after a 2-second countdown.
- If grace period expires, disconnected player forfeits and opponent receives a result. Release both player reservations.
- If a player disconnects while available or invited, cancel their active invitation immediately and remove the lobby entry after a brief refresh window (3 seconds) if not recovered.
- On server restart, volatile sessions and matches are reset. Clients recover to profile/lobby state, not the old match.

### F7. LAN hosting & `/admin` console
- Package server and built frontend into one Docker image (`app.Dockerfile` referenced by `compose.yaml`, plus `Dockerfile`), exposing port `3000/TCP` and mounting named volume `avatars_data` at `/data/avatars`.
- Bind the HTTP/WebSocket listener to `0.0.0.0` inside the container.
- Provide `/healthz` endpoint (counting connected human players and active matches) and Docker healthcheck.
- Client connects to WebSocket using the page's current host and appropriate `ws:`/`wss:` scheme; never hardcode `localhost` or a LAN IP.
- **Admin Configuration Console (`/admin` & `/api/admin/*`):** Protected by `ADMIN_PASSCODE` (or a one-time first-run passcode setup when unset, with in-memory bearer tokens and login attempt throttling). Allows operators to configure runtime paddle length, paddle speed, ball initial/increment/max speeds, game rounds (`winScore`), countdown/challenge/disconnect timeout values, and an explicit Host IP/URL.
- **Host LAN IP Discovery & Share Dialog:** `/api/server-info` prioritizes the Admin-configured Host IP / `PUBLIC_URL`, then the incoming non-loopback `Host`/`X-Forwarded-Host` header, then non-container LAN IPv4 interfaces—explicitly filtering out link-local (`169.254.x.x`) and Docker bridge (`172.16.0.0/12`) addresses when running inside a container. The **Share LAN URL** modal displays a copyable URL and an offline-generated QR code without inline error boxes or inline IP inputs; if no external IP is detected, it links cleanly to **Open Admin**.
- No internet connectivity required after images and dependencies have been built/pulled. Document offline image preparation (`docker save` / `docker load`).
- The Docker host firewall must allow the exposed port; include troubleshooting instructions.

## 5. Out of scope

- User accounts, passwords, OAuth, social sign-in, verified identity (beyond the single operator `/admin` passcode).
- Internet access, cloud hosting, public matchmaking, NAT traversal, WebRTC peer connections.
- Mobile/touch controls, gamepads, accessibility certification (basic keyboard/focus/contrast still expected).
- Spectators, human-like AI bots, tournaments, chat, global leaderboard, permanent match history, achievements (only the full-height static `Demo Player` practice paddle is included).
- Distributed servers, horizontal scaling, external databases, Redis, Kubernetes.
- Arbitrary profile files or animated avatars; only validated/re-encoded raster images.
- Guaranteed session/match continuity across container restarts.

## 6. Technical architecture

```text
Desktop Browser A                  Desktop Browser B
  React UI + Canvas + WebAudio       React UI + Canvas + WebAudio
  localStorage profile               localStorage profile
          | HTTP + WebSocket                  |
          +----------------+------------------+
                           |
                  LAN host :3000/TCP
                           |
                  Docker Compose service
                           |
                    Node.js + TypeScript
                 /         |          \
           HTTP/static   WS gateway   Avatar upload API
                 |         |          |
             Vite build   Session / Lobby / Challenge manager
                           |
                   Match manager (Map<matchId, Match>)
                           |
                  Authoritative 60 Hz engine
                           |
                   In-memory active state

               Named Docker volume: sanitized WebP avatars
```

### Implemented stack
- **Client:** TypeScript, React 19, Vite, Tailwind CSS, HTML5 Canvas 2D, `qrcode` (offline QR rendering), Web Audio API.
- **Server:** Node.js 22 (`--experimental-strip-types`), Express, `ws` (WebSocket), `sharp` (image validation & WebP re-encoding).
- **Shared:** TypeScript protocol schemas, types, constants, and Zod runtime validation.
- **Build:** Multi-stage Docker build (`app.Dockerfile` & `Dockerfile`) using `--legacy-peer-deps`; production runtime serves compiled `dist/` assets and backend on port 3000.
- **Tests:** Vitest unit tests (physics, validation, avatar processing, LAN URL discovery) and WebSocket integration tests (races, expiry, match isolation, reconnect recovery, disconnect forfeit, unique nicknames).

### Responsibilities and boundaries
- **Client owns:** UI, keyboard capture, local preferences, avatar selection/upload, snapshot interpolation, Web Audio FX, connection UX.
- **Server owns:** identity/session binding, nickname uniqueness, presence, invitation validity, paddle intent validation, physics, scores, match outcome, reconnect deadlines.
- **Shared package owns:** versioned protocol definitions, validation schemas, enums and error codes.
- **Avatar volume owns:** only processed WebP avatar files; game/lobby state is never persisted there.
- **Browser localStorage owns:** profile preferences and recovery credential, not authoritative game state or upload tokens.

### Repository layout

```text
lan-pong-arena/
  src/{admin,audio,components,game,leaderboard,lobby,network,profile,storage}/
  server/src/{avatars,challenges,config,engine,http,leaderboard,matches,sessions,ws}/
  shared/src/{constants,protocol,types,validation}/
  public/avatars/
  tests/{unit,integration}/
  docs/PROJECT_DEFINITION.md
  server.ts
  app.Dockerfile
  Dockerfile
  compose.yaml
  .dockerignore
  .env.example
  LICENSE
  README.md
```

## 7. HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/`, `/leaderboard`, `/admin` | Serve browser app (lobby/arena, runtime leaderboard, and operator admin console SPA routes) |
| GET | `/healthz` | Readiness/health status (`status`, `uptimeSeconds`, `activePlayers`, `activeMatches`) |
| GET | `/api/server-info` | Return prioritized host LAN URLs, port, and container detection metadata |
| GET | `/api/config` | Return current public gameplay rules (excludes admin-only `hostIp` setting) |
| GET | `/api/leaderboard` | Return runtime player standings (including `Demo Player`) with played, won, lost, forfeited, longest match, and ping stats |
| GET | `/api/admin/status` | Check whether first-run passcode setup is needed and verify Bearer session |
| POST | `/api/admin/setup` | One-time first-run passcode creation when `ADMIN_PASSCODE` is unset (returns Bearer token) |
| POST | `/api/admin/login` | Rate-limited passcode authentication returning in-memory admin Bearer token |
| POST | `/api/admin/logout` | Revoke current admin Bearer token |
| GET/PUT | `/api/admin/config` | Authenticated read/update of runtime physics, rounds, timeouts, and `hostIp` |
| POST | `/api/admin/config/reset` | Authenticated reset of runtime configuration to server defaults |
| POST | `/api/avatars` | Bearer-authenticated binary image upload (`PNG`/`JPEG`/`WebP` ≤ 1 MiB); returns `avatarId` & `avatarUrl` |
| GET | `/api/avatars/:id` | Serve processed WebP image with `nosniff` and immutable caching |
| GET | `/ws` | WebSocket upgrade on same host/port |

Avatar and Admin authorization use memory-held bearer tokens sent in the `Authorization: Bearer <token>` header. Tokens are never logged or placed in URLs. Upload rate limits (`6` uploads / 60s), stored avatar caps (`2` files per session), and admin login throttling (`8` attempts / 60s per IP) protect server resources.

## 8. WebSocket protocol

### Envelope
All messages are JSON and contain `type`, `requestId` (for commands and acknowledgements), and `payload`. Server events additionally contain `serverTime` and `protocolVersion`. Protocol version is `1`; incompatible clients receive `PROTOCOL_MISMATCH`.

Example command:

```json
{
  "type": "challenge.create",
  "requestId": "req-123",
  "payload": { "targetPlayerId": "pl_456" }
}
```

Example authoritative game snapshot:

```json
{
  "type": "match.snapshot",
  "protocolVersion": 1,
  "serverTime": 1795300000000,
  "payload": {
    "matchId": "mt_123",
    "tick": 1452,
    "phase": "PLAYING",
    "paddlesUnlocked": true,
    "ball": { "x": 0.52, "y": 0.31, "vx": 0.72, "vy": -0.18 },
    "paddles": { "leftY": 0.4, "rightY": 0.58 },
    "score": { "left": 2, "right": 3 }
  }
}
```

Coordinates are normalized to the logical playfield (`0–1`); paddle Y coordinates refer to their centers. `paddlesUnlocked` indicates when paddle movement is active (`true` during `PLAYING` and during the final `1s` of `COUNTDOWN`). Geometry and velocities are defined in shared constants; the client does not simulate authoritative physics.

### Client → server commands

| Type | Key payload | Behavior |
|---|---|---|
| `session.hello` | `protocolVersion`, `profile`, optional `recoveryToken` | Validate unique nickname, establish/recover session |
| `profile.update` | `nickname`, `avatarId` | Validate unique nickname & avatar, broadcast changes |
| `challenge.create` | `targetPlayerId` | Reserve invitation if both available |
| `challenge.accept` | `challengeId` | Atomically start match |
| `challenge.decline` | `challengeId` | End invitation |
| `challenge.cancel` | `challengeId` | Withdraw outgoing invitation |
| `match.input` | `matchId`, `direction` (`-1`, `0`, `1`), `seq` | Set paddle movement intent |
| `match.leave` | `matchId` | Forfeit/leave match |
| `match.rematch.request` | `matchId` | Request rematch |
| `match.rematch.accept` | `matchId` | Accept pending rematch |
| `lobby.join` | none | Return to lobby after match closure |
| `ping` | `clientTime` | Application-level latency probe answered with `pong` |

### Server → client events

| Type | Purpose |
|---|---|
| `session.ready` | Player ID, fresh recovery token, memory-only upload token, `arenaConfig`, full lobby/match resync state |
| `config.updated` | Broadcast updated `PublicArenaConfig` whenever an admin saves or resets settings |
| `leaderboard.updated` | Broadcast updated runtime `LeaderboardEntry[]` standings on match completion, joins, or disconnects |
| `pong` | Echo `clientTime` and `requestId` so clients measure live WebSocket round-trip ping (`ms`) |
| `lobby.snapshot` | Initial authoritative roster (includes `Demo Player`) |
| `lobby.player.upsert` / `lobby.player.remove` | Incremental presence changes |
| `challenge.received` | Incoming invitation and expiration |
| `challenge.updated` | Accepted/declined/cancelled/expired/invalidated and reason |
| `match.started` | Match ID, side assignment, participants, `MatchRulesConfig`, initial state |
| `match.snapshot` | Tick-stamped authoritative state |
| `match.phase` | Countdown, paused, resumed, finished |
| `match.finished` | Winner, final score, outcome reason |
| `match.rematch.updated` | Rematch request/acceptance state |
| `command.ack` | Command accepted, matching request ID |
| `command.error` | Rejected command, matching request ID, stable error code (`NICKNAME_TAKEN`, `INVALID_PROFILE`, `PLAYER_UNAVAILABLE`, etc.) |
| `server.notice` | Restart/maintenance or other user-facing notice |

### Protocol invariants
- Commands are validated against Zod schemas and current state; never trust IDs or coordinates sent by clients.
- Server derives actor identity from the WebSocket session, not from a claimed `playerId` in a message.
- Only the two participants receive detailed match snapshots; all lobby participants receive presence changes.
- A command cannot affect a match unless the sender is a participant.
- Include monotonic `tick` and input `seq`; ignore stale snapshots on the client and stale input sequences on the server.
- Enforce max message size (`16 KiB`), per-socket rate limits, `Origin` verification, and bounded request deduplication queues. Reject malformed JSON safely.

## 9. State machines

### Player session state

```text
CONNECTING -> AVAILABLE
AVAILABLE -> INVITED -> IN_GAME
INVITED -> AVAILABLE           (decline, cancel, timeout)
IN_GAME -> AVAILABLE           (match closed / lobby.join)
ANY_CONNECTED -> DISCONNECTED  (socket loss)
DISCONNECTED -> PRIOR_STATE    (valid recovery within grace window)
DISCONNECTED -> REMOVED        (timeout / session expiry)
```

A player may have only one active match or invitation. For an in-game disconnect, retain match membership while paused. For lobby/invitation disconnect, cancel invitations immediately and remove the session after a 3-second grace window if not recovered.

### Challenge state

```text
PENDING -> ACCEPTED -> MATCH_CREATED
PENDING -> DECLINED
PENDING -> CANCELLED
PENDING -> EXPIRED
PENDING -> INVALIDATED (participant disconnects/becomes unavailable)
```

All terminal states are idempotent; only one transition from `PENDING` can win.

### Match state

```text
CREATED -> COUNTDOWN -> PLAYING
PLAYING -> COUNTDOWN          (point scored / next serve)
PLAYING -> PAUSED_DISCONNECT  (participant lost)
COUNTDOWN -> PAUSED_DISCONNECT
PAUSED_DISCONNECT -> COUNTDOWN (recovered)
PAUSED_DISCONNECT -> FORFEITED (grace expired)
PLAYING -> FINISHED           (winning score)
COUNTDOWN/PLAYING/PAUSED_DISCONNECT -> FORFEITED (explicit leave)
FINISHED/FORFEITED -> CLOSED  (return to lobby / rematch resolution)
```

Rematch creates a **new match ID** with swapped sides after both players agree, rather than resurrecting a finished match. When a match becomes terminal, stop its simulation loop and release resources.

## 10. Game rules and simulation

- Logical arena dimensions are fixed (`16:10` aspect ratio) and independent of browser viewport; Canvas scales crisply with `devicePixelRatio`.
- Two vertical paddles, one ball, top/bottom wall bounce, paddle bounce, and goal boundaries.
- Paddle velocity is bounded and server-controlled. Clamp paddles inside the arena.
- Ball speed and bounce angle are deterministic given current state and collision point; cap speed to preserve playability.
- Simulation uses an accumulator/fixed delta at 60 Hz, with 4 collision substeps and a cap on catch-up steps (`4`) to avoid spiraling after host stalls.
- A goal increments exactly one player's score, recenters the ball, and starts a new countdown. During the final `1s` (`COUNTDOWN_PADDLE_UNLOCK_MS = 1000`) of any countdown, `stepPaddlesOnly` advances and broadcasts paddle positions at 60 Hz / 30 Hz (`paddlesUnlocked: true`) while the ball stays centered until the countdown reaches zero.
- First player to 5 points ends the match. No win-by-two requirement.
- Server uses monotonic time (`performance.now()`) for deadlines and simulation scheduling.
- Client interpolates between received snapshots for visual smoothness and applies visual-only client paddle prediction while `PLAYING` or `paddlesUnlocked === true` (smoothly reconciled to server snapshots); never uses client-rendered state for scoring or collision decisions.
- Define paddle side mapping once in `match.started`; left/right ownership remains stable during a match.

## 11. Reliability, security, and operational constraints

### Reliability
- Heartbeat at 5-second intervals, with a 15-second timeout; distinguish transient network loss from voluntary match leave.
- Reconnect grace for in-game sessions: 10 seconds. If both players disconnect, pause and apply independent deadlines; close match when recovery is impossible.
- Browser retries WebSocket connection with bounded exponential backoff (`0.5s`–`8s`) and displays connection status.
- Reconnect resynchronizes from a full snapshot rather than replaying every missed event.
- Server restart clears all active matches and presence; saved browser profile and processed avatars remain.
- Clear all timers, intervals, and WebSocket listeners upon match closure and graceful `SIGTERM`/`SIGINT` shutdown.

### Basic security
- Validate nickname length and uniqueness, avatar ownership/existence, image magic bytes and dimensions, and all message payloads.
- Generate cryptographically random session/recovery/upload tokens; do not use nicknames as credentials.
- Treat tokens as bearer secrets; never log them, put them in URLs, or expose them to other players.
- Check WebSocket `Origin` and `POST /api/avatars` `Origin` against the request `Host` or `ALLOWED_ORIGINS`.
- Enforce upload and WebSocket rate limits; set body (`1 MiB`) and WS payload (`16 KiB`) size caps.
- Re-encode uploads to 256×256 WebP to remove metadata and unsafe content; reject SVG payloads; enforce `path.resolve` + `path.sep` storage confinement; serve with `X-Content-Type-Options: nosniff`.
- HTTP is acceptable only on a trusted LAN for the MVP. Traffic and recovery tokens are not encrypted; document this limitation. HTTPS/WSS may be added via a TLS reverse proxy.

### Operational requirements
- One Docker Compose command starts the app: `docker compose up -d --build` (using `app.Dockerfile`).
- One TCP port exposed (default `3000`), configurable via `PORT` environment variable.
- Named volume `avatars_data` retains processed avatars across container replacement.
- Provide `/healthz` endpoint, Docker healthcheck, structured JSON server logs (without secrets), graceful `SIGTERM` shutdown, and `.env.example`.
- No database or cloud service; match and presence data stay in memory.
- Document Docker image preloading for internet-free operation (`docker save` / `docker load`).
- Provide clear troubleshooting for wrong host IP, port firewall, client isolation, and WebSocket upgrade failure.

## 12. Nonfunctional requirements

| Category | MVP target |
|---|---|
| Browser support | Current desktop Chrome, Firefox, Edge, Safari |
| Responsiveness | Playable at common laptop resolutions; Canvas preserves `16:10` aspect ratio |
| Concurrency | At least 4 concurrent matches / 8 active players on a typical laptop host |
| Game cadence | 60 Hz authoritative simulation, 30 Hz snapshot broadcast |
| Usability | No installation, no account, visible connection state, inline errors, offline QR share |
| Offline operation | No external runtime calls, CDNs, or hosted fonts |
| Maintainability | Shared Zod schemas, modular server components, documented setup |
| Observability | Structured logs for startup and shutdown; health endpoint; no secrets |
| Accessibility baseline | Keyboard focus, readable labels, sufficient contrast; gameplay keyboard-only |

Performance values are design targets to verify on real hardware, not guaranteed latency measurements.

## 13. Acceptance criteria / definition of done

### Functional acceptance scenarios
- [x] **A01 Profile:** A player can enter a unique nickname (1–24 chars), select a bundled avatar, refresh, and retain the profile while preserving session continuity.
- [x] **A02 Unique Nicknames (v1.01):** Attempting to join (`session.hello`) or rename (`profile.update`) to an already-active nickname (case-insensitive) is rejected with `NICKNAME_TAKEN` and inline feedback without overwriting saved preferences or disrupting other players.
- [x] **A03 Upload:** A player can upload a valid PNG/JPEG/WebP image (including queued upload during initial onboarding), see the processed 256×256 WebP avatar in lobby/game, and retain it after container restart. Invalid, SVG, or oversized (> 1 MiB) files are rejected clearly.
- [x] **A04 Presence:** Two devices connect and see each other's nickname/avatar/status without refresh, with live filtering (`All Players` / `Available Only`).
- [x] **A05 Challenge:** A player can invite another, who sees an invitation with a live 30-second countdown and can accept or decline.
- [x] **A06 Expiry/cancel:** Invitation cancellation and 30-second expiry return both players to a valid available state.
- [x] **A07 Race safety:** Simultaneous conflicting challenges cannot put a player into two matches.
- [x] **A08 Match start:** Acceptance creates exactly one match; each browser receives a different paddle assignment.
- [x] **A09 Controls & Audio:** Each keyboard controls only its own paddle (`W/S` or `↑/↓`) with immediate initial-press responsiveness (stable listeners across snapshots and visual-only local prediction), browser scrolling is suppressed during active play, server clamps paddle positions, and the HUD provides an audio mute toggle plus a two-step forfeit leave confirmation.
- [x] **A10 Consistency:** Ball, collisions, and scores agree on both devices; paddles unlock for the final 1 second of pre-serve countdowns (starting at second 2 of the 3s start) before the ball serves; first to five wins.
- [x] **A11 End/rematch:** Both see the result, can return to lobby, and can mutually start a new match (new match ID with swapped sides).
- [x] **A12 Reconnect:** A player reconnecting within 10 seconds resumes the paused match from authoritative state with rotated tokens.
- [x] **A13 Forfeit:** A player who does not reconnect within 10 seconds forfeits; the other player is notified and can return to lobby.
- [x] **A14 Multiple matches:** Two separate pairs play concurrently without receiving each other's private snapshots.
- [x] **A15 Restart:** Restarting the container clears active matches but retains stored avatars and browser-local profiles.
- [x] **A16 LAN & Share URL (v1.01):** The app is usable from two LAN devices without internet access; **Share LAN URL** displays the real host LAN URL (from Admin `hostIp`/`PUBLIC_URL`, non-loopback `Host` header, or host network interface) and offline QR code without exposing Docker container bridge (`172.16–31.x.x`) or link-local (`169.254.x.x`) IPs, and omits error boxes or inline IP forms (linking instead to **Open Admin** when no external IP is detected).
- [x] **A17 Validation:** Invalid commands, malformed messages, unauthorized match input, and invalid uploads do not crash the server.
- [x] **A18 Admin Configuration (`/admin`):** Operators authenticate via `ADMIN_PASSCODE` or first-run passcode setup and configure paddle length, paddle speed, ball velocities, game rounds, timeouts, and Host IP; changes take effect for new matches and broadcast to connected clients.
- [x] **A19 Demo Mode & Ping Readout:** Players can challenge `Demo Player` from the lobby to enter an immediate practice match against a full-height (`1.0`) opponent paddle, and can inspect their live server round-trip ping latency (`ms`) in both the Top Bar and Match HUD.
- [x] **A20 Runtime Leaderboard (`/leaderboard` & `GET /api/leaderboard`):** Displays ranked players for the current server runtime (including `Demo Player`), showing Gold/Silver/Bronze trophy icons before the top 3 players' names along with total matches played, won, lost, forfeited, longest match duration, and live ping/lag status.

### Engineering definition of done
- [x] Clean Docker build (`app.Dockerfile`) and Compose startup (`compose.yaml`) from README instructions.
- [x] Unit tests cover wall/paddle collision, anti-tunneling, full-height Demo paddle rebounds, score, `stepPaddlesOnly` & `MatchManager` countdown paddle head-start timing, nickname/avatar validation, `ServerConfigService` & `AdminAuthService`, `LeaderboardService`, WebP sanitization, and LAN URL filtering (`tests/unit/`).
- [x] Integration tests cover challenge race, expiry, disconnect timeout, reconnect recovery, match isolation, unique nickname enforcement, `ping`/`pong`, Demo Player auto-accept matches, `/api/admin/*`, and `/api/leaderboard` (`tests/integration/`).
- [x] Verified on Docker Compose LAN host (`/healthz`, container build, multi-client play).
- [x] No runtime dependency on external APIs, hosted assets, or cloud services.
- [x] README includes configuration, startup, `/leaderboard` & `/admin` usage, Demo Mode, sharing LAN URL, offline `docker save`/`load`, licensing (MIT `LICENSE`), and troubleshooting.

## 14. Implementation milestones

| Milestone | Deliverables | Status |
|---|---|---|
| **M1 — Skeleton & Docker** | Shared types, React shell, Express + `ws` server, `app.Dockerfile`/`compose.yaml`, `/healthz` | Complete |
| **M2 — Profiles & presence** | Unique nicknames, bundled SVG gallery, WebP upload pipeline, live lobby + filters | Complete |
| **M3 — Challenges & matchmaking** | Invitations, accept/decline/cancel/30s expiry, race-safe reservations | Complete |
| **M4 — Game engine & rendering** | 16:10 Canvas, snapshot interpolation, 60 Hz physics, scoring, Web Audio FX | Complete |
| **M5 — Lifecycle & recovery** | Results, side-swap rematch, confirm-leave, heartbeat, 10s pause/reconnect/forfeit | Complete |
| **M6 — Validation & LAN polish** | Unit & integration tests, host LAN IP discovery, offline QR share, v1.01 docs | Complete |

## 15. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Conference Wi-Fi isolates devices | Document AP/hotspot workaround in README and Share modal |
| Browser refresh breaks a match | Recovery token, 10-second grace, full resync |
| Conflicting invitations cause duplicate matches | Central atomic reservation/state transition |
| Uploads create security/storage problems | Re-encode to 256×256 WebP, 1 MiB cap, opaque IDs, rate limits, per-session pruning |
| Simulation jitter | Fixed 60 Hz timestep, bounded catch-up, client snapshot interpolation |
| Docker Share URL shows internal bridge IP | Prioritize Admin `hostIp` / `PUBLIC_URL` & non-loopback `Host` header, filter `172.16–31.x.x` in container, link to `/admin` |
| Project archive drops extensionless `Dockerfile` | Provide `app.Dockerfile` referenced by `compose.yaml` alongside `Dockerfile` |
| Duplicate player names confuse lobby/matches | Case-insensitive unique nickname enforcement in `SessionManager` & `WsGateway` |
| Initial paddle key presses feel sluggish or miss | Keep keyboard listeners ref-stable across snapshots, ignore `e.repeat`, add client visual prediction, and unlock paddles 1s before serve |
| Solo players want to test controls & bounces alone | Virtual `Demo Player` auto-accepts challenges with a full-height (`1.0`) rebounding paddle |
| Players suspect Wi-Fi/network lag | 2-second WebSocket `ping`/`pong` RTT indicator displayed in Top Bar and Match HUD |

## 16. Resolved implementation choices

The following nonblocking choices from v1.0 were resolved in v1.01:
- **HTTP/WS Stack:** Express + `ws` on Node.js 22 (`--experimental-strip-types`), serving Vite middleware in dev and compiled `dist/` in production.
- **Arena & Audio:** `16:10` normalized playfield with synthesized Web Audio API sound effects (mute toggle included).
- **Countdown & Controls:** 1-second pre-serve paddle movement head start (`COUNTDOWN_PADDLE_UNLOCK_MS = 1000`, active at second 2 of the 3s start) with visual-only local paddle prediction.
- **LAN Discovery:** Offline QR code generation via `qrcode` inside the **Share LAN URL** dialog with smart container IP filtering.
- **Rematch Behavior:** Mutual rematch automatically swaps paddle sides (`left` ↔ `right`) in a new match ID.
- **Licensing:** Entire project released under the MIT License (`LICENSE`).

## 17. Final project statement

**Build a Docker-hosted, LAN-only, browser-native Pong arena in which desktop players create profiles with unique nicknames and gallery or uploaded avatars, discover one another in a live lobby, exchange challenges, play server-authoritative real-time Pong, complete/rematch games, and recover safely from network disconnections.** Deliver the source, container configuration, tests, and instructions required to run and demonstrate the application on a local network.
