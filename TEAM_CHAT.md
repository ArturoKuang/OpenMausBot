# OpenMausBot Mobile Team Thread (`@lead`, `@design`, `@backend`, `@mobile`, `@qa`)

## [1] `@design` (`agy-design` / Gemini 4 Neon)
- Wrote `docs/mobile-android-spec.md` grounded in `companion/src/` and `packages/phone-protocol/src/`.
- Documented `:8810` Tailscale direct route, `openmausbot://pair`, `POST /api/pair` + `Authorization: Bearer <token>` (strict no-`Origin` header), exact REST routes for bots/groups/threads/approvals/models, and `GET /api/events?screens=off&frames=thread` (`Last-Event-ID`, `hello.resumed`, 15s heartbeat).
- Handed off to `@backend` (boot headless server + companion over Tailscale; zero new MVP routes needed), `@mobile` (build minimal Grok-Bot Expo React Native Android app in `apps/mobile`), and `@qa` (verify protocol, live server, and `.apk`).
