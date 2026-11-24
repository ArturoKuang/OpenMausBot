# OpenMausBot Android Mobile Spec (Expo React Native)

Companion spec for the Grok-Bot-style Android client talking to OpenMausBot over Tailscale/LAN. Every route, header, and payload below matches `companion/src/`, `packages/phone-protocol/src/`, and `server/`.

## A. Companion Pairing & Auth over Tailscale

- **Listeners & ports** (`companion/src/index.ts`):
  - Device proxy: `0.0.0.0:8810` (`OMB_COMPANION_PORT`), enabled only while `wifi` or `tailscale` direct route is on.
  - Control plane: `127.0.0.1:8811` (`OMB_CONTROL_PORT`) — host loopback only, never reachable from Android.
  - Tailscale gate (`companion/src/direct-routes.ts`): host requires `tailscale: true`. Socket accepted only on host tailnet interface (`tailscale*` / `fd7a:115c:a1e0::/48`) from peer in `100.64.0.0/10` or `fd7a:115c:a1e0::/48`.
- **Endpoint priority** (`companion/src/endpoints.ts`, capped at 8):
  1. `hosted` (`https://…`, priority `0`)
  2. `tailnet` (`http://<host>.<tailnet>.ts.net:8810`, priority `100`, MagicDNS)
  3. `lan` (`http://<ipv4>:8810`, priority `200+i`)
  4. `bonjour` (`http://<host>.local:8810`, priority `300`)
  - Manual Tailscale IP (`http://100.x.y.z:8810`) works on Android (`acceptsConnection` permits `100.64/10`), even though `endpoints`/`hosts` omit bare `100.64/10` for iOS ATS.
- **QR / Deep Link** (`packages/phone-protocol/src/pairing-link.ts`):
  `openmausbot://pair?address=<host:port|origin>&token=<omb_pair_43b64u>[&code=<6digits>][&name=<serverName>][&hosts=<csv>][&endpoints=<b64uJson>][&secretKey=<87b64u>][&e2e=<b64uJson>]`
- **Pairing flow**:
  1. Probe `GET /api/health` (unauthenticated) -> `200 { app: "openmausbot", version? }` (`502` if harness stopped).
  2. Redeem `POST /api/pair` (`Content-Type: application/json`, **no `Origin` header**):
     - Body (`PairRequest`): `{ credential, deviceName, pairRequestId?, replacesToken? }` (`code` accepted as alias for `credential`).
     - Desktop companion accepts 6-digit `code` or `omb_pair_…` `token` (TTL `120s`, `5` attempts, max `20` devices; unconfirmed devices expire in `300s`). Standalone/Cloud accepts 12-char `XXXX-XXXX-XXXX` (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) or `omb_pair_…`.
     - Reply `201` (companion) / `200` (server/Cloud) (`PairResponse`): `{ token: "omb_…", device: PairedDevice, serverName, hosts?, endpoints?, e2e? }`.
     - Refusals (`400`/`401`): `{ error, code }` — branch on `code` (`pairing_not_open`, `pairing_code_wrong`, `pairing_too_many`, `pairing_device_limit`, `pairing_bad_request`, `pairing_qr_only`, `pairing_failed`).
- **Authenticated requests**:
  - Header: `Authorization: Bearer <token>`.
  - **Never send `Origin`**: `companion/src/proxy.ts` refuses any request carrying `Origin` with `403`.
  - **E2E ratchet**: once a device uses E2E (`device.e2eAt` set), plain HTTP on `:8810` returns `426 { error: "update_app" }` (except `/api/health`).
  - Refresh routes: `GET /api/companion/endpoints` -> `{ serverName, endpoints, version?, e2e? }`.

## B. REST & SSE (`/api/events`) Contract

All routes below are in `companion/src/routes.ts` `ALLOWED` (default-deny; companion strips `resumeCursors`, `sshAlias`, `vpsAlias`, `vpsAliases` from JSON/SSE).

### REST Endpoints

| Action | Method & Path | Request / Query | Response |
|---|---|---|---|
| Fleet & roster | `GET /api/bots` | `?messages=40&tail=10&open=<botId>` | `BotsResponse`: `{ bots, groups, sections, botQueuedMessages, computerControl }` |
| Create bot | `POST /api/bots` | `{ name, title?, description?, soul?, color?, section?, modelSelection? }` (no host/admin fields from phone) | `201 { bot, warnings?, paused? }` |
| Create group | `POST /api/groups` | `{ name?, memberIds: string[], section?, setup?: { bulletin, defaultResponder } }` | `201 { group }` |
| New / switch bot thread | `POST /api/bots/:botId/tasks` / `POST /api/bots/:botId/tasks/:threadId` | `{ title?, select? }` / `?messages=40` | `201 { bot, task }` / `200 { bot }` |
| New / switch group thread | `POST /api/groups/:groupId/tasks` / `POST /api/groups/:groupId/tasks/:threadId` | `{ title? }` / `?messages=40` | `201 { group, task }` / `200 { group }` |
| Load messages | `GET /api/threads/:threadId/messages` | `?limit=40[&before=<msgId>\|&around=<msgId>]` | `WireMessagePage`: `{ messages, hasMore?, activeLeafId }` |
| Tool output / screen | `GET /api/threads/:threadId/messages/:msgId/tool` \| `/image` | — | `{ output }` \| image bytes |
| Mark read | `POST /api/bots/:botId/read` \| `/api/groups/:groupId/read` | `{ threadId? }` | `200 { bot }` \| `200 { group }` |
| Send 1:1 msg | `POST /api/bots/:botId/messages` | `{ text, threadId?, sendId, replyToId?, mode?: "chat"\|"goal", followUp?: "steer"\|"queue"\|"restart", mentions? }` | `202 { ok, threadId, message? \| queued?, queueId? }` |
| Send group msg | `POST /api/groups/:groupId/messages` | `{ text, threadId?, sendId, replyToId?, mode?: "chat"\|"goal", mentions?: string[] }` | `202 { ok, threadId, message? \| queued?, queueId? }` |
| Queue steer / cancel | `POST .../queue/:queueId/steer` \| `DELETE .../queue/:queueId` | `{ threadId? }` (on `/api/bots/:id` or `/api/groups/:id`) | `200 { ok, steered?\|queued? }` |
| Interrupt (Stop) | `POST /api/bots/:botId/interrupt` \| `/api/groups/:groupId/interrupt` | `{ threadId?, turnId? }` \| `{ threadId?, stopId? }` | `200 { ok, outcome? }` |
| Answer approval/card | `POST /api/threads/:threadId/respond` (or `/api/bots/:botId/respond`) | `{ requestId, behavior: "allow"\|"deny"\|"answer", message?, always?, rememberCommand?, reviewedSha256? }` | `200 { ok, outcome, late? }` |
| Remember grant / static card | `POST /api/bots/:botId/always-allow` \| `PATCH /api/bots/:botId/cards/:msgId` | `{ allowKey, threadId? }` \| `{ threadId?, answered?, dismissed? }` | `200 { bot }` \| `200 { message }` |
| List models | `GET /api/instances` | — | `{ instances: WireInstance[] }` (`models.options`, `capabilities.effortLevels`) |
| Switch bot / thread model | `PATCH /api/bots/:botId/model` \| `PATCH /api/bots/:botId/tasks/:threadId` | `{ instanceId, model, effort?, variant? }` \| `{ modelSelection, updateBotDefault?, requireAvailableModel: true }` | `200 { bot }` \| `200 { task, bot }` (`409` if busy) |

- Other inline cards on allowlist: `connector` (`POST /api/bots/:id/connector-cards/:msgId/(authorize|resume|dismiss)`), `signIn` (`.../sign-in-cards/:msgId/(done|cancel)`), `secret` (`.../secret-cards/:msgId/(provide|save|resume|dismiss)`).

### SSE Stream (`GET /api/events`)

- Query & headers: `GET /api/events?screens=off&frames=thread[&since=<streamId>:<seq>]`, `Authorization: Bearer <token>`, `Last-Event-ID: <streamId>:<seq>` (server prefers header over `?since=`).
- First frame (no `id:`): `{ kind: "hello", cursor: "<streamId>:<lastSeq>", resumed: boolean }`. When `resumed === false`, client must re-fetch `GET /api/bots`.
- Heartbeat every `15s` (`SSE_HEARTBEAT_MS`): `: keepalive\n\ndata: {"kind":"ping"}\n\n` (no `id:`). Replay buffer caps at `500` frames / `8 MB`.
- Frames to handle (`ServerFrame`):
  - Roster/state: `bot` (if `tasksPartial: true`, merge `bot.tasks` by `threadId` instead of replacing), `bot.deleted`, `bots.order`, `group`, `group.deleted`, `groups.order`, `sections`, `bot.queued`.
  - Transcript: `message`, `message.patch`, `thread` (`activeLeafId`).
  - Live runtime (`kind: "runtime"`, `event: RuntimeEvent`): `turn.started`, `turn.completed`, `turn.retrying`, `turn.progress` (`activity`, `target`, `detail`, `file`, `bytes`, `quiet`, `tail`), `item.started`, `item.completed`, `content.delta` (`streamKind: "assistant_text"|"reasoning_text"`, `delta`, `botId?`), `request.opened`, `request.resolved`, `runtime.error`, `runtime.notice`.
  - Sidecar / team: `companion.endpoints` (no `id:`, update stored endpoints), `team.presence` / `thread.presence` / `team.people`.
- **Multi-server switching**: store `{ id, serverName, deviceId, endpoints, activeUrl, e2e?, lastCursor? }` locally and bearer `token` in Android Keystore via `expo-secure-store`. Switching aborts active SSE + fetch `AbortController`s, renders cached roster immediately, then resumes `/api/events` (or snapshots `GET /api/bots` + `GET /api/instances`).

## C. Minimal Grok-Bot Android UX (Expo React Native)

Follows `DESIGN.md`: calm by default, sentence case, 4px spacing grid, 44dp min touch targets, **no ops dashboards, no bottom tab bar, no numeric unread count badges or "needs you" banners**.

- **Tokens** (from `src/styles.css` phone ramp):
  - **Midnight (default dark)**: `app #141414`, `panel #1c1c1e`, `card #242426`, `composer #2c2c2e`, `hairline #3a3a3c`, `ink #f5f5f5`, `inkSecondary #f5f5f5a8`, `inkTertiary #f5f5f591`, `bubbleUser #5a5a5a`, `accent #1084fe`, `success #38d591`, `warning #ff9800`, `danger #ff5667`.
  - **Daylight (light)**: `app #fcfcfc`, `panel #f5f5f5`, `card #efefef`, `composer #ffffff`, `hairline #1c1c1c3d`, `ink #1c1c1c`, `inkSecondary #1c1c1cad`, `inkTertiary #1c1c1ca6`, `bubbleUser #1c1c1c` (`#fcfcfc` ink), `accent #126fd4`, `success #007a44`, `warning #9c5b00`, `danger #cd2834`.
  - **Type & shape**: System/Geist sans + mono; titles `20px/600` (`-0.01em`), header/sheet `17px/600`, chat `15/22px 400`, list names `15/20px 500`, speaker `13px/600` (bot `color`), meta/timestamps `12/16px 500 tabular-nums`. Radii: pills `9999`, controls `12`, cards/sheets `18`, bubbles `18` (6px tail in sender runs), composer `22`.
- **Screen 1 — Pairing & Server Switcher** (full screen on first run; bottom sheet from Home header):
  - Camera QR scanner (`openmausbot://pair`) + `"Enter address and code"` toggle (`host:8810` or `*.ts.net:8810` + 6-digit or 12-char code). Runs `GET /api/health` first so unreachable Tailscale errors clearly distinguish offline host vs wrong code.
  - Switcher sheet: paired servers with route badge (`Tailscale` / `Wi-Fi` / `Cloud`), live status dot, `+ Connect another computer`, long-press to forget locally.
- **Screen 2 — Home Roster**:
  - Header (`56dp`, `16dp` inset): Server pill left (`serverName` + 8dp live dot: `success` live, `warning` reconnecting, `inkTertiary` offline) + `+` icon button right (`New bot` / `New group` sheet).
  - Sections separated by `20dp` vertical space (no divider under headings): **Group chats** (`!group.dm`) and **Bots** (`!bot.hidden`), ordered by `orderedThreadList` recency.
  - Row (`64dp`, `40dp` bot avatar or stacked pair for groups, `12dp` gap): name (`1 line`), live subtitle (`activity === "working"` or `group.working` -> `TurnProgress.target` or `"Working…"` / `activity === "waiting-on-you"` -> `"Waiting for your approval"` in `warning` / idle -> last text snippet), trailing timestamp + `8dp` `accent` dot if `unread`.
- **Screen 3 — Chat Thread**:
  - Header (`56dp`): Back, avatar + name & active model chip (`12px`, taps open Model Picker sheet; disabled while `busy`), thread switcher chevron (`tasks`), `+` New thread button.
  - Transcript:
    - **Bubbles**: User right (`bubbleUser`, max 82% width); Bot left (`card`, markdown + `from.name` in groups). Stream `content.delta` (`assistant_text`) by `itemId` and swap atomically when durable `message` arrives. Collapse `reasoning_text` into muted `"Thinking…"` pill.
    - **Collapsible inline tool/activity pills** (`kind: "activity"` + live `turn.progress` / `item.started`): single `32dp` pill (`control` bg, `1px hairline`, `13px`), collapsed by default (e.g., `Running pnpm test…` / `Edited routes.ts` + `12px` chevron). Tap expands inline output; if `tool.clipped`, lazy-load `GET /api/threads/:tid/messages/:mid/tool`. Show `message.handoff` (`claimed|working|waiting|done|failed`) as a 1-line compact chip.
    - **Inline Approval / Question / Interrupt cards** (`kind: "options"`, `card`): `18px` `card` container with `1px hairline`. Renders `card.title`, `card.subtitle`, and `44dp` pills: primary neutral ink (`Allow` / choice), secondary `control` (`Deny`), optional `Always allow` when `card.allowKey` or `card.allowSession` is set. Disable buttons (`Answering…`) on tap until `message.patch` / `request.resolved` settles it into a 1-line receipt (`Allowed`, `Denied`, `Expired`, `Stopped`).
  - **Composer**: bottom pill (`minHeight 44dp`, `rounded-[22px]`, `16px` input). In groups, typing `@` opens an above-composer member picker inserting `@Name` and appending `bot.id` to `mentions[]`. While turn runs: Send icon becomes `Stop` (`danger` tint -> `/interrupt`), while non-empty input still allows `Queue` / `Steer` sends; queued chips sit above composer with `×` (`DELETE .../queue/:queueId`).

## Handoff to @mobile, @backend, and @qa

### @mobile
- **Tailscale reconnect**: listen to `NetInfo` + `AppState` (`active`). On reconnect, race `GET /api/health` (3s timeout) across saved `endpoints` by `priority` (plus manual host), falling back with jittered backoff (`1s -> 2s -> 4s -> 8s -> max 30s`). Never clear composer draft or transcript scroll offset on reconnect.
- **SSE `Last-Event-ID` & resync**: persist `cursor` (`<streamId>:<seq>`) per server from `hello.cursor` and every frame's `id:`. Reconnect sends `Last-Event-ID` (and `?since=` query fallback). Arm a `35s` liveness watchdog (>2× `15s` ping). If `hello.resumed === false`, clear transient streaming buffers and run full `GET /api/bots?messages=40&tail=10&open=<activeBotId>`. On `401`, flag server `"Needs pairing"` and pass old token as `replacesToken` on re-pair. On `426` (`update_app`), block plain HTTP and prompt E2E-capable client update.
- **Idempotency & offline**: generate UUID `sendId` per user send so retries after network drop never duplicate turns (`202` returns existing message; handle `409` cleanly). Show a quiet `28dp` offline bar (`Offline · Reconnecting…` + `Retry`), never modal alerts. Empty states: one line + one action (`No bots yet` -> `New bot`).
- **Android back button & keyboard**: `BackHandler` priority stack: close `@mention` popover -> close bottom sheet -> blur keyboard -> navigate Chat to Home -> system default on Home. Use `softwareKeyboardLayoutMode: "resize"` + `useSafeAreaInsets()` so composer and `@mention` sheet stay flush above IME and gesture/3-button nav bar. Strip `Origin` on every `fetch`/SSE call.

### @backend
- Companion allowlist (`companion/src/routes.ts`) already exposes every route in Section B — no new endpoints required for MVP.
- Keep `GET /api/events?screens=off&frames=thread` + `Last-Event-ID` forwarding intact in `companion/src/proxy.ts`; verify `POST /api/bots` `adminOnlyBotSetting` error messages stay plain-worded when phone omits admin fields.
- If Android adds direct Tailscale IP (`100.x.y.z:8810`) to QR links later, coordinate with `packages/phone-protocol/src/pairing-link.ts` (`qrEndpoints` currently requires `tailnet` URLs to end in `.ts.net`).

### @qa
- Verify against an isolated fixture (`docs/verification/README.md`) running harness + companion (`OMB_COMPANION_ROUTES=wifi,tailscale OMB_COMPANION_TAILNET_NAME=<host>.ts.net`), never live user data.
- **Matrix**: (1) QR + manual 6-digit pairing, wrong code (`pairing_code_wrong`), expired window (`pairing_not_open`), device revocation (`401` -> re-pair with `replacesToken`); (2) SSE reconnect with `Last-Event-ID` (`resumed: true`) and post-restart/overflow gap (`resumed: false` -> full resync); (3) Tailscale VPN toggle mid-stream (draft preserved, `sendId` retry produces 0 duplicate messages); (4) 1:1 & group `@mention` routing, inline Approve/Deny/Always-allow settlement, mid-turn `Stop` (`/interrupt`), and mid-turn model switch `409` lock; (5) Android back button stack, IME resize with `@mention` list open, Midnight + Daylight contrast, and offline/empty states.
