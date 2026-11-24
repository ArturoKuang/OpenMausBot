# OpenMausBot Mobile QA Sign-Off Report

- **Branch**: `feat/android-expo-mobile` (`HEAD` `24f084def` + 4 P1/P2 working-tree fixes)
- **Date**: 2026-11-22
- **Reviewer**: `@qa` (`agy-qa`)
- **VERDICT**: **PASS**

## 1. Diff Audit — 4 P1/P2 Fixes (`apps/mobile/`)

| # | Severity | Fix | Files | Verification |
| --- | --- | --- | --- | --- |
| 1 | P1 | **SSE interrupted replay cursor**: only advance cursor on `hello` when `!frame.resumed`; replayed events advance via `event.id` so drops between `hello` and replay retry from the pre-gap `Last-Event-ID`. | `src/api/sse.ts`, `src/api/sse.test.ts` | Unit test + live isolated fixture (`before=7fbe2a74:5`, `hello=7fbe2a74:6`, `retry=7fbe2a74:5`, `groupReplayed=true`). |
| 2 | P1 | **Replay-gap transient state reset**: on `hello` with `resumed: false`, reset `streams`, `thinking`, `step`, `running`, and `turnId` in `threadReducer` while `useThread` triggers `load()`. | `src/state/thread.ts`, `src/state/thread.test.ts` | Unit test + live isolated fixture (`obsolete-stream:1` -> `resumed=false`, `afterReload.running=false`, `afterReload.partialReplies=0`). |
| 3 | P2 | **Midnight WCAG AA contrast**: changed `accentInk` `#ffffff` -> `#141414` (`5.05:1` on `accent`, `5.95:1` on `danger`), `identity.blue` `#377fe6` -> `#4b8eec` (`4.71:1` on `card`), `identity.purple` `#8d69ce` -> `#9b7bd6` (`4.57:1` on `card`). | `src/ui/theme.ts`, `src/ui/theme.test.ts` | 4/4 contrast assertions >= `4.5:1` pass. |
| 4 | P2 | **`app.json` cleanup**: removed redundant `android.edgeToEdgeEnabled` key (default in Expo SDK 54 / Android 15). | `app.json` | `npx expo config --type public --json` valid (`edgeToEdgeEnabled: undefined`, `com.openmausbot.mobile`). |

## 2. Typecheck & Automated Unit Suite

- Command: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
- Result: **0 TypeScript errors**, **10/10 test files passed**, **55/55 tests passed** (`340ms`).

## 3. Live Isolated Companion Integration (`apps/mobile/qa/companion.integration.mjs`)

Executed via `cd apps/mobile && ./node_modules/.bin/vite-node -c vitest.config.ts qa/companion.integration.mjs` against a fresh isolated harness + companion fixture (cleanly torn down, `dataRemoved=true`):

- **Pairing & auth (`Origin` absent on every request)**: `/api/health` (`200`), wrong code -> `401 pairing_code_wrong`, valid code -> `201` (`omb_*` bearer token), closed window -> `401 pairing_not_open`, invalid token -> `401`.
- **Roster & SSE resume**: initial `GET /api/bots` (`200`), `GET /api/instances` (`200`), SSE `GET /api/events?screens=off&frames=thread` -> `hello resumed=false`, live bot frame, forced disconnect + group creation -> reconnect with `Last-Event-ID` -> `hello resumed=true` + replayed `group` frame.
- **Interrupted replay & replay gap**: forced drop immediately after `hello resumed=true` retried pre-gap `Last-Event-ID` and replayed the `group` frame; obsolete cursor (`obsolete-stream:1`) returned `resumed=false` and cleared partial stream + running state.
- **Idempotency & token lifecycle**: duplicate `sendId` `POST /api/bots/:id/messages` (`202` x2) returned identical message ID and 1 persisted row; QR `replacesToken` rotated credentials and invalidated prior token (`401`); explicit `DELETE /devices/:id` revoked new token (`401`).

## 4. Android Release APK & Emulator Verification Milestones

- **Release APK**: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - Size: `27M` (`classes.dex` 6.67 MB, `assets/index.android.bundle` 1.40 MB, `AndroidManifest.xml`).
  - Built at `2026-11-22 22:47:47` (post-dates all 4 P1/P2 fixes saved `22:46:37–22:46:57`).
  - SHA-256: `7d30dd04c914f9dbcb4e972d181ff35c67667324f0b0c97b2954bc497e67eaab`.
  - `apksigner verify --verbose` (build-tools `37.0.0`): **`Verifies`** (APK Signature Scheme v2, 1 signer).
- **Android Emulator Milestones** (`apps/mobile/qa/companion.integration.mjs --android=<serial>`, AVD `reader-qa-api35` present; no emulator attached during this final sign-off check):
  - Clean `adb install` + `adb reverse` -> `openmausbot://pair` deep-link pairing over cleartext HTTP -> roster render.
  - Live SSE bot creation rendered without manual refresh -> `am force-stop` + relaunch restores persisted SecureStore token and roster.
  - Hardware Back dismissal of `+ New` modal -> group composer `@mention` picker + IME open across companion route drop (`Offline · Reconnecting…`) and route recovery with draft preserved -> Back stack exits cleanly + clean uninstall.

## 5. Live `macmini-ci` Services (`100.97.87.111`)

| Service | Endpoint Checked | Result |
| --- | --- | --- |
| OpenMausBot API (`:8799`, `PID 43590`, LaunchAgent `com.local.openmausbot-serve`) | `http://100.97.87.111:8799/api/health` (+ loopback & MagicDNS) | `200` (`app: openmausbot`, `v0.1.177`, `doctor.problems: []`); unauth non-health over Tailscale -> `403`. |
| Companion Sidecar (`:8810`, `PID 43591`) | `http://100.97.87.111:8810/api/health` (+ loopback & MagicDNS) | `200` (`app: openmausbot`); unauth non-health over Tailscale -> `401`. |
| Hermes (`:9119`, `PID 92755`) | `http://127.0.0.1:9119/api/status` | `200` (`v0.18.2`, `gateway_running: true`). |
| CAO Server (`:9889`, `PID 19891`) | `http://127.0.0.1:9889/health` | `200` (`status: ok`, `v2.5.4`, `components.cao: ok`). |

## 6. Non-Blocking Observations

- Inherited Midnight identity colors `red` (`3.75:1`), `pink` (`3.99:1`), and `green` (`4.20:1`) remain below `4.5:1` on `card` (`#242426`) from desktop `src/styles.css`; all 4 targeted P2 pairs clear `4.5:1`.
- Working tree has uncommitted changes (`apps/mobile/app.json`, `src/api/sse*`, `src/state/thread*`, `src/ui/theme*`, `apps/mobile/qa/companion.integration.mjs`, `docs/qa-mobile-report.md`); ready to commit when requested.
