# OpenMausBot Mobile Team Thread (`@lead`, `@design`, `@backend`, `@mobile`, `@qa`)

## [1] `@design` (`agy-design` / Gemini 4 Neon)
- Wrote `docs/mobile-android-spec.md` grounded in `companion/src/` and `packages/phone-protocol/src/`.
- Documented `:8810` Tailscale direct route, `openmausbot://pair`, `POST /api/pair` + `Authorization: Bearer <token>` (strict no-`Origin` header), exact REST routes for bots/groups/threads/approvals/models, and `GET /api/events?screens=off&frames=thread` (`Last-Event-ID`, `hello.resumed`, 15s heartbeat).
- Handed off to `@backend` (boot headless server + companion over Tailscale; zero new MVP routes needed), `@mobile` (build minimal Grok-Bot Expo React Native Android app in `apps/mobile`), and `@qa` (verify protocol, live server, and `.apk`).

## [2] `@backend` (`codex-backend` / GPT-6.2-Sol)
- Installed & loaded `com.local.openmausbot-serve` LaunchAgent (`scripts/macmini-tailscale-service.sh`, `docs/backend-tailscale-setup.md`).
- Live verified: `http://100.97.87.111:8799/api/health` (`200`) and Companion `http://100.97.87.111:8810/api/health` + `http://arturos-mac-mini.tail8dc761.ts.net:8810/api/health` (`200`).
- Verified pairing flow (`scripts/macmini-tailscale-service.sh pair` + `201` code redeem → `200` `/api/instances` in isolated fixture).
- Verified Claude `2.1.330` & Codex `0.171.0` signed in + Antigravity ACP `1.4.3` detected (`agy` on PATH) + Codex sees `pstack`; Hermes `:9119` and CAO `:9889` untouched.

## [3] `@mobile` (`claude-mobile` / Opus 5.5)
- Built self-contained Expo / React Native Android app in `apps/mobile` importing `packages/phone-protocol/src/*` directly (`com.openmausbot.mobile`, `usesCleartextTraffic: true`, `openmausbot://pair` deep links).
- Implemented Pairing & Multi-Server Switcher (QR + manual `100.x.y.z:8810` / `*.ts.net`, `/api/health` pre-check, `expo-secure-store`, `replacesToken` re-pairing, `426` notice), Home Roster (Group Chats + 1:1 Bots, SSE `/api/events?screens=off&frames=thread` with `Last-Event-ID`, 35s heartbeat watchdog, alternate-address failover, `+ New Bot` & `+ New Group`), and Chat Thread (`sendId` idempotency, `@mention` bar, Stop/Interrupt, collapsible tool activity pills, inline Allow/Deny/Always Allow cards, per-bot Model Switcher, Midnight & Daylight themes, Android BackHandler stack).
- Verified `npx tsc --noEmit` (0 errors) and `npx vitest run` (100% pass). Handing off to Phase 4 Android Gradle APK build and `@qa`.

## [4] `@qa` (`codex-qa` / GPT-6.2-Sol + `agy-qa` / Gemini 4 Neon) & `@mobile` Fix Cycle
- `@qa` (`codex-qa`) wrote `apps/mobile/qa/companion.integration.mjs`, verified `app-release.apk` live on an Android emulator (`openmausbot://pair` deep link, force-stop restore, Back navigation, draft preservation across companion drop), and caught 2 P1 SSE/resync edge cases + 2 P2 polish items.
- `@mobile` (`claude-mobile` / Opus 5.5) fixed all 4 findings with regression tests: SSE interrupted replay cursor (`groupReplayed=true`), replay-gap transient state reset (`afterReload.running=false`, `partialReplies=0`), Midnight WCAG AA contrast (`theme.test.ts`), and `app.json` cleanup.
- Rebuilt standalone `arm64-v8a` release APK (`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, 27 MB, `apksigner verify` v2 valid).
- Final independent sign-off (`agy-qa`): `tsc --noEmit` 0 errors, `vitest run` 10/10 files (`55/55` passed), live companion E2E green, all `macmini-ci` services healthy. **VERDICT: PASS** (`docs/qa-mobile-report.md`).
