# LAN Pong Arena — Project Definition

**Version:** 1.0  
**Status:** Approved MVP specification  
**Date:** 2026-11-21  
**Deployment:** Docker on a LAN host  
**Clients:** Desktop browsers, keyboard input  
**Avatar support:** Built-in gallery and custom image upload

## 1. Executive summary

LAN Pong Arena is a self-hosted, browser-native, two-player Pong application for a local area network (LAN). Each player opens the same server URL in a desktop browser, creates a lightweight profile, discovers available players in a live lobby, issues or accepts challenges, and plays a synchronized match. Multiple independent matches may run simultaneously. The system does not require internet access, accounts, or cloud services.

**Architectural decision:** A single Dockerized Node.js application serves the browser client and maintains WebSocket connections. The server owns lobby, matchmaking, and game simulation state. Browsers send inputs and render authoritative snapshots.

## 2. Goals and success measures

### Goals
1. Allow two people on separate LAN devices to start and finish a Pong match without installation beyond a browser.
2. Provide a live player directory and explicit challenge/accept workflow.
3. Maintain consistent game state through a server-authoritative simulation.
4. Handle disconnections, reconnects, invitations, and rematches predictably.
5. Run as one Docker Compose service without external dependencies.
6. Support nickname, gallery avatar, and uploaded avatar images.
7. Keep implementation comprehensible for an AI-assisted coding session.

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
- Avatar can be selected from bundled predefined images **or uploaded** from the player's device.
- Accept PNG, JPEG, or WebP uploads; enforce a 1 MiB file limit and decode/validate server-side. Re-encode to a safe bounded raster format, e.g. WebP, max 256×256 px; never serve original untrusted bytes or SVG.
- Uploaded avatars are stored in a Docker volume and exposed via generated opaque IDs/URLs. Use a generic avatar when unavailable.
- Store nickname, avatar reference, and a reconnect credential in browser localStorage. The server assigns an opaque player/session ID. The nickname is not a unique identifier.
- Editing the profile updates lobby presence; changing an avatar does not interrupt a match.
- No password, registration, or identity verification.

### F2. Live lobby
- Show connected players with nickname, avatar, and status (`AVAILABLE`, `INVITED`, `IN_GAME`, `DISCONNECTED`).
- Update the list automatically via WebSocket events; no manual refresh.
- Do not allow challenging oneself, offline players, or players not `AVAILABLE`.
- Multiple concurrent games are supported; the lobby reflects player availability accurately.
- Display a clear server-connection indicator and reconnecting state.

### F3. Challenges
- An available player may invite one other available player.
- The recipient can accept or decline; the initiator can cancel.
- Invitations expire after 30 seconds.
- Server handles races atomically: at most one active invitation per player, no double-booking, no simultaneous accept into multiple matches.
- Challenge outcomes are sent to both affected players, with structured error codes for invalid operations.
- On acceptance, create a match and assign paddle sides; notify both clients.

### F4. Pong gameplay
- Classic 2D Pong: one paddle per player, ball, walls, collision response, scores, center serve.
- Desktop controls: W/S and Arrow Up/Arrow Down; prevent browser scrolling while game controls are active.
- Server is authoritative for paddle positions, ball physics, collision detection, scoring, and win condition.
- Fixed simulation timestep: 60 Hz. Broadcast snapshots at approximately 20–30 Hz. Browser renders via `requestAnimationFrame`, interpolating between snapshots.
- First to 5 points wins; show scores and opponent identity.
- Ball serves after a short countdown, including after a point. Use deterministic bounded speeds and sensible collision angles; prevent the ball from tunneling through paddles.
- Client sends key state changes or normalized movement intent, not authoritative positions.
- Input is associated with the authenticated WebSocket session; clients cannot control another player's paddle.

### F5. Match lifecycle
- Match transitions from `COUNTDOWN` to `PLAYING`, then `FINISHED`, or `PAUSED_DISCONNECT` and possibly `FORFEITED`.
- On match end, show winner, final score, and actions to return to lobby or request a rematch.
- Rematch requires agreement from both players; reset scores and game physics and optionally swap sides.
- Returning to lobby marks player `AVAILABLE` once the current match is closed.
- An explicit leave-match action is treated as a forfeit while a match is active.

### F6. Connection handling
- Server detects disconnect via WebSocket close and heartbeat/ping-pong.
- When a player disconnects during a match, pause simulation and allow a 10-second reconnect grace period.
- Browser reconnects with a random, high-entropy session-recovery token; server rebinds the session after validation. Rotate the token after successful recovery where practical.
- On successful reconnection, send full authoritative lobby/match state and resume play after a short countdown.
- If grace period expires, disconnected player forfeits and opponent receives a result. Release both player reservations.
- If a player disconnects while available or invited, remove/cancel their active invitation and update the lobby promptly.
- On server restart, volatile sessions and matches are reset. Clients recover to profile/lobby state, not the old match.

### F7. LAN hosting
- Package server and built frontend into one Docker image, with a `compose.yaml` exposing port 3000/TCP and a named volume for uploaded avatars.
- Bind the HTTP/WebSocket listener to `0.0.0.0` inside the container.
- Provide `/healthz` endpoint and Docker healthcheck.
- Client connects to WebSocket using the page's current host and appropriate `ws:`/`wss:` scheme; never hardcode `localhost` or a LAN IP.
- Share `http://<LAN_HOST_IP>:3000` with players. Optional QR code may be shown, but mDNS/hostname discovery is not required.
- No internet connectivity required after images and dependencies have been built/pulled. Document offline image preparation.
- The Docker host firewall must allow the exposed port; include troubleshooting instructions.

## 5. Out of scope

- User accounts, passwords, OAuth, social sign-in, verified identity.
- Internet access, cloud hosting, public matchmaking, NAT traversal, WebRTC peer connections.
- Mobile/touch controls, gamepads, accessibility certification (basic keyboard/focus/contrast still expected).
- Spectators, bots, tournaments, chat, global leaderboard, permanent match history, achievements.
- Distributed servers, horizontal scaling, external databases, Redis, Kubernetes.
- Arbitrary profile files or animated avatars; only validated/re-encoded raster images.
- Guaranteed session/match continuity across container restarts.

## 6. Technical architecture

```text
Desktop Browser A                  Desktop Browser B
  React UI + Canvas                  React UI + Canvas
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

               Named Docker volume: sanitized avatars
```

### Proposed stack
- Client: TypeScript, React, Vite, HTML5 Canvas 2D.
- Server: Node.js, TypeScript, Fastify (HTTP/static/uploads) and `ws` (WebSocket), or an equivalently small HTTP framework.
- Shared: TypeScript message schemas/types, preferably runtime-validated with Zod or equivalent.
- Build: multi-stage Dockerfile; production runtime serves compiled assets and backend.
- Tests: Vitest for physics/state machine, integration tests for WebSocket protocol, Playwright for two-browser flows where feasible.

### Responsibilities and boundaries
- **Client owns:** UI, keyboard capture, local preferences, avatar selection/upload, snapshot interpolation, connection UX.
- **Server owns:** identity/session binding, presence, invitation validity, paddle intent validation, physics, scores, match outcome, reconnect deadlines.
- **Shared package owns:** versioned protocol definitions, validation schemas, enums and error codes.
- **Avatar volume owns:** only processed avatar files; game/lobby state is never persisted there.
- **Browser localStorage owns:** profile preferences and recovery credential, not authoritative game state.

### Suggested repository layout

```text
lan-pong-arena/
  client/src/{app,components,lobby,profile,game,network}/
  server/src/{http,ws,sessions,lobby,challenges,matches,engine,avatars}/
  shared/src/{protocol,types,validation}/
  tests/{unit,integration,e2e}/
  Dockerfile
  compose.yaml
  .dockerignore
  README.md
  PROJECT_DEFINITION.md
```

## 7. HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve browser app |
| GET | `/healthz` | Readiness/health status |
| POST | `/api/avatars` | Authenticated avatar upload with size/type validation; return avatar ID and URL |
| GET | `/api/avatars/:id` | Serve processed image with safe content type and caching |
| GET | `/ws` | WebSocket upgrade on same host/port |

Avatar upload authorization uses the session credential issued by the server, sent in an HTTP authorization header. Avoid logging tokens or exposing them in URLs. Implement upload rate limits and cap per-session stored avatar count; replace and delete obsolete avatars to avoid unbounded storage. For a simple LAN MVP, uploads may be available after the initial WebSocket handshake establishes a session.

## 8. WebSocket protocol

### Envelope
All messages are JSON and contain `type`, `requestId` (for commands and acknowledgements), and `payload`. Server events may additionally contain `serverTime` and `protocolVersion`. Set protocol version to `1`; reject incompatible clients with a helpful error.

Example command:

```json
{
  "type": "challenge.create",
  "requestId": "req-123",
  "payload": { "targetPlayerId": "player-456" }
}
```

Example authoritative game snapshot:

```json
{
  "type": "match.snapshot",
  "payload": {
    "matchId": "match-123",
    "tick": 1452,
    "phase": "PLAYING",
    "ball": { "x": 0.52, "y": 0.31 },
    "paddles": { "leftY": 0.4, "rightY": 0.58 },
    "score": { "left": 2, "right": 3 }
  }
}
```

Coordinates are normalized to the logical playfield (0–1); paddle Y coordinates refer to their centers. Geometry and velocities are defined in shared constants; the client does not simulate authoritative physics.

### Client → server commands

| Type | Key payload | Behavior |
|---|---|---|
| `session.hello` | `protocolVersion`, `profile`, optional `recoveryToken` | Establish/recover player session |
| `profile.update` | `nickname`, `avatarId` | Validate and broadcast changes |
| `challenge.create` | `targetPlayerId` | Reserve invitation if both available |
| `challenge.accept` | `challengeId` | Atomically start match |
| `challenge.decline` | `challengeId` | End invitation |
| `challenge.cancel` | `challengeId` | Withdraw outgoing invitation |
| `match.input` | `matchId`, `direction` (`-1`, `0`, `1`), `seq` | Set paddle movement intent |
| `match.leave` | `matchId` | Forfeit/leave match |
| `match.rematch.request` | `matchId` | Request rematch |
| `match.rematch.accept` | `matchId` | Accept pending rematch |
| `lobby.join` | none | Return to lobby after match closure |

### Server → client events

| Type | Purpose |
|---|---|
| `session.ready` | Player ID, fresh recovery token, full lobby/match resync state |
| `lobby.snapshot` | Initial authoritative roster |
| `lobby.player.upsert` / `lobby.player.remove` | Incremental presence changes |
| `challenge.received` | Incoming invitation and expiration |
| `challenge.updated` | Accepted/declined/cancelled/expired and reason |
| `match.started` | Match ID, side assignment, participants, initial state |
| `match.snapshot` | Tick-stamped authoritative state |
| `match.phase` | Countdown, paused, resumed, finished |
| `match.finished` | Winner, final score, outcome reason |
| `match.rematch.updated` | Rematch request/acceptance state |
| `command.ack` | Command accepted, matching request ID |
| `command.error` | Rejected command, matching request ID, stable error code |
| `server.notice` | Restart/maintenance or other user-facing notice |

### Protocol invariants
- Commands are validated against schemas and current state; never trust IDs or coordinates sent by clients.
- Server derives actor identity from the WebSocket session, not from a claimed `playerId` in a message.
- Only the two participants receive detailed match snapshots; all lobby participants receive presence changes.
- A command cannot affect a match unless the sender is a participant.
- Include monotonic `tick` and input `seq`; ignore stale snapshots on the client and stale input sequences on the server.
- Enforce max message size, rate limits, and bounded queues. Reject malformed JSON safely.
- Acknowledge commands and use request IDs to suppress accidental duplicate actions.

## 9. State machines

### Player session state

```text
CONNECTING -> AVAILABLE
AVAILABLE -> INVITED -> IN_GAME
INVITED -> AVAILABLE           (decline, cancel, timeout)
IN_GAME -> AVAILABLE           (match closed)
ANY_CONNECTED -> DISCONNECTED  (socket loss)
DISCONNECTED -> PRIOR_STATE    (valid recovery within grace window)
DISCONNECTED -> REMOVED        (timeout / session expiry)
```

A player may have only one active match or invitation. For an in-game disconnect, retain match membership while paused. For lobby/invitation disconnect, cancel invitations immediately; remove or mark the player offline until recovery policy expires.

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
COUNTDOWN/PLAYING -> FORFEITED (explicit leave)
FINISHED/FORFEITED -> CLOSED  (return to lobby / rematch resolution)
```

Rematch creates a **new match ID**, after both players agree, rather than resurrecting a finished match. When a match becomes terminal, stop its simulation loop and release resources.

## 10. Game rules and simulation

- Logical arena dimensions are fixed and independent of browser viewport; Canvas scales to fit.
- Two vertical paddles, one ball, top/bottom wall bounce, paddle bounce, and goal boundaries.
- Paddle velocity is bounded and server-controlled. Clamp paddles inside the arena.
- Ball speed and bounce angle are deterministic given current state and collision point; cap speed to preserve playability.
- Simulation uses an accumulator/fixed delta at 60 Hz, with a cap on catch-up steps to avoid spiraling after host stalls.
- A goal increments exactly one player's score, recenters the ball, and starts a new countdown.
- First player to 5 points ends the match. No win-by-two requirement.
- Server uses monotonic time for deadlines and simulation scheduling.
- Interpolate between received snapshots for visual smoothness; do not use client-rendered state for scoring or collision decisions.
- Define paddle side mapping once in `match.started`; left/right ownership remains stable during a match.

## 11. Reliability, security, and operational constraints

### Reliability
- Heartbeat at approximately 5-second intervals, with a bounded timeout; distinguish transient network loss from voluntary match leave.
- Reconnect grace for in-game sessions: 10 seconds. If both players disconnect, pause and apply independent deadlines; close match when recovery is impossible.
- Browser should retry WebSocket connection with bounded exponential backoff and show connection status.
- Reconnect resynchronizes from a full snapshot rather than replaying every missed event.
- Server restart clears all active matches and presence; saved browser profile and processed avatars remain.
- Do not leak timers, intervals, or WebSocket listeners after match closure.

### Basic security
- Validate nickname length, avatar ownership/reference, image type and dimensions, and all message payloads.
- Generate cryptographically random session/recovery tokens; do not use nicknames as credentials.
- Treat session token as a bearer secret; do not log it, put it in a URL, or expose it to other players.
- Check WebSocket `Origin` against the configured application origin(s); limit cross-origin upload requests.
- Use upload and WebSocket rate limits; set body and message size caps.
- Re-encode uploads to remove metadata and unsafe content; use non-guessable avatar IDs and appropriate response headers.
- HTTP is acceptable only on a trusted LAN for the MVP. Traffic and recovery tokens are not encrypted; document this limitation. HTTPS/WSS may be added later.

### Operational requirements
- One Docker Compose command starts the app: `docker compose up -d --build`.
- One TCP port exposed (default 3000), configurable via environment.
- Named volume retains processed avatars across container replacement.
- Provide healthcheck, logs, graceful SIGTERM shutdown, and a `.env.example`.
- No database or cloud service; match and presence data stay in memory.
- Document Docker image preloading for internet-free operation (`docker save` / `docker load`).
- Provide clear troubleshooting for wrong host IP, port firewall, client isolation, and WebSocket upgrade failure.

## 12. Nonfunctional requirements

| Category | MVP target |
|---|---|
| Browser support | Current desktop Chrome, Firefox, Edge, Safari |
| Responsiveness | Playable at common laptop resolutions; Canvas preserves aspect ratio |
| Concurrency | At least 4 concurrent matches / 8 active players on a typical laptop host |
| Game cadence | 60 Hz authoritative simulation, 20–30 Hz snapshot broadcast |
| Usability | No installation, no account, visible connection state and errors |
| Offline operation | No external runtime calls, CDNs, or hosted fonts |
| Maintainability | Shared schemas, modular server components, documented setup |
| Observability | Structured logs for connection, invitation, match, disconnect, errors; no secrets |
| Accessibility baseline | Keyboard focus, readable labels, sufficient contrast; gameplay keyboard-only |

Performance values are design targets to verify on real hardware, not guaranteed latency measurements.

## 13. Acceptance criteria / definition of done

### Functional acceptance scenarios
- [ ] **A01 Profile:** A player can enter a nickname, select a bundled avatar, refresh, and retain the profile.
- [ ] **A02 Upload:** A player can upload a valid PNG/JPEG/WebP image, see the processed avatar in lobby/game, and retain it after container restart. Invalid/oversized files are rejected clearly.
- [ ] **A03 Presence:** Two devices connect and see each other's nickname/avatar/status without refresh.
- [ ] **A04 Challenge:** A player can invite another, who sees an invitation and can accept or decline.
- [ ] **A05 Expiry/cancel:** Invitation cancellation and 30-second expiry return both players to a valid available state.
- [ ] **A06 Race safety:** Simultaneous conflicting challenges cannot put a player into two matches.
- [ ] **A07 Match start:** Acceptance creates exactly one match; each browser receives a different paddle assignment.
- [ ] **A08 Controls:** Each keyboard controls only its own paddle; the server clamps paddle positions.
- [ ] **A09 Consistency:** Ball, collisions, and scores agree on both devices; first to five wins.
- [ ] **A10 End/rematch:** Both see the result, can return to lobby, and can mutually start a new match.
- [ ] **A11 Reconnect:** A player reconnecting within 10 seconds resumes the paused match from authoritative state.
- [ ] **A12 Forfeit:** A player who does not reconnect within 10 seconds forfeits; the other player is notified and can return to lobby.
- [ ] **A13 Multiple matches:** Two separate pairs play concurrently without receiving each other's private snapshots.
- [ ] **A14 Restart:** Restarting the container clears active matches but retains stored avatars and browser-local profiles.
- [ ] **A15 LAN:** The app is usable from two LAN devices without internet access after deployment assets are available.
- [ ] **A16 Validation:** Invalid commands, malformed messages, unauthorized match input, and invalid uploads do not crash the server.

### Engineering definition of done
- [ ] Clean Docker build and Compose startup from README instructions.
- [ ] Unit tests cover wall/paddle collision, score, win condition, and state transitions.
- [ ] Integration tests cover challenge race, disconnect timeout, reconnect, and match isolation.
- [ ] End-to-end manual test performed on two physical LAN devices.
- [ ] No known blocker or critical defect in the accepted scenarios.
- [ ] No runtime dependency on external APIs, hosted assets, or cloud services.
- [ ] README includes configuration, startup, sharing LAN URL, and troubleshooting.

## 14. Implementation milestones

| Milestone | Deliverables | Exit gate |
|---|---|---|
| **M1 — Skeleton & Docker** | Monorepo, shared types, React shell, Node server, Dockerfile/Compose, health endpoint | Two LAN browsers load app and connect via WS |
| **M2 — Profiles & presence** | Nickname, bundled avatar gallery, upload processing/storage, live lobby | Two players see updated profiles and statuses |
| **M3 — Challenges & matchmaking** | Invitations, accept/decline/cancel/timeout, race-safe reservations | One invitation starts exactly one match |
| **M4 — Game engine & rendering** | Canvas, input protocol, server physics, scoring, snapshots | Two devices complete first-to-five match |
| **M5 — Lifecycle & recovery** | Results, rematch, leave, heartbeat, pause/reconnect/forfeit | Reconnect and abandonment scenarios pass |
| **M6 — Validation & delivery** | Tests, multi-match validation, docs, offline LAN test, polish | All §13 acceptance criteria pass |

**Recommended build order:** Implement a vertical slice (two clients connect → challenge → play) before polishing avatars and recovery. Preserve the full agreed MVP scope, but prioritize the riskiest multiplayer path early.

## 15. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Conference Wi-Fi isolates devices | Test early; use a dedicated LAN/hotspot if needed |
| Browser refresh breaks a match | Recovery token, 10-second grace, full resync |
| Conflicting invitations cause duplicate matches | Central atomic reservation/state transition |
| Uploads create security/storage problems | Re-encode images, size caps, opaque IDs, rate limits, volume cleanup |
| Simulation jitter | Fixed timestep, bounded catch-up, interpolation |
| Docker works locally but not from other devices | Bind to `0.0.0.0`, publish port, test host firewall |
| Scope grows during coding | Enforce §5 exclusions and §13 definition of done |

## 16. Open implementation choices (nonblocking)

The following may be selected during implementation without changing the agreed scope:
- Exact UI design, avatar artwork, sound effects (optional, locally bundled).
- Fastify versus an equivalently small HTTP framework.
- Exact normalized arena dimensions and physics tuning.
- Whether to show an optional QR code for the LAN URL.
- Whether rematches automatically swap sides.

Any change to the seven MVP features, Docker deployment, desktop-only support, or both avatar methods requires an explicit scope revision.

## 17. Final project statement

**Build a Docker-hosted, LAN-only, browser-native Pong arena in which desktop players create profiles with gallery or uploaded avatars, discover one another in a live lobby, exchange challenges, play server-authoritative real-time Pong, complete/rematch games, and recover safely from network disconnections.** Deliver the source, container configuration, tests, and instructions required to run and demonstrate the application on a local network.
