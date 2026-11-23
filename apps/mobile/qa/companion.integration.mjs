import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { phonePairingLink } from "../../../packages/phone-protocol/src/pairing-link.ts";
import { launchVerificationServer } from "../../../scripts/control-omb.ts";
import { waitForExit } from "../../../server/testing/cleanup.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { EventStream } from "../src/api/sse.ts";
import { manualInvite, parsePairingLink } from "../src/pairing/invite.ts";
import { redeemInvite } from "../src/pairing/redeem.ts";
import { initialThread, threadReducer } from "../src/state/thread.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown.abort(new Error(signal)));
}

async function until(read, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(50, undefined, { signal: shutdown.signal });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function cutAfterHello(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      assert.equal(done, false, "Connection ended before hello");
      received += decoder.decode(value, { stream: true });
      const hello = /data: \{"kind":"hello"[^\n]*\}\n\n/.exec(received);
      if (hello) return new Response(received.slice(0, hello.index + hello[0].length), { status: response.status });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function verifyAndroid(serial, port, link, api, setRoutes) {
  const adb = async (...args) => (await promisify(execFile)("adb", ["-s", serial, ...args], { timeout: 15_000 })).stdout.trim();
  const app = "com.openmausbot.mobile";
  const service = `tcp:${port}`;
  const dumpPath = `/data/local/tmp/omb-qa-${randomUUID()}.xml`;
  assert.match(serial, /^emulator-\d+$/);
  assert.equal(await adb("shell", "pm", "list", "packages", app), "", "Use an emulator without this app installed");
  assert.ok(!(await adb("reverse", "--list")).includes(service));
  const apk = join(root, "apps/mobile/android/app/build/outputs/apk/release/app-release.apk");
  let installed = false;
  let reversed = false;
  const dump = async () => {
    await adb("shell", "uiautomator", "dump", dumpPath);
    return adb("shell", "cat", dumpPath);
  };
  const screen = (match, description) => until(async () => {
    const xml = await dump().catch(() => "");
    return match.test(xml) ? xml : null;
  }, description, 20_000);
  const tap = async (xml, selector) => {
    const node = xml.match(new RegExp(`<node [^>]*${selector}[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    assert.ok(node, `Missing Android element ${selector}`);
    const [, x1, y1, x2, y2] = node.map(Number);
    await adb("shell", "input", "tap", String(Math.floor((x1 + x2) / 2)), String(Math.floor((y1 + y2) / 2)));
  };
  const back = () => adb("shell", "input", "keyevent", "KEYCODE_BACK");
  const imeOpen = async () => /\bmInputShown=true\b/.test(await adb("shell", "dumpsys", "input_method"));
  try {
    console.log(`Android SDK=${await adb("shell", "getprop", "ro.build.version.sdk")} ABI=${await adb("shell", "getprop", "ro.product.cpu.abi")}`);
    await adb("reverse", service, service);
    reversed = true;
    const installation = await adb("install", apk);
    assert.match(installation, /Success/);
    installed = true;
    console.log(installation);
    const launch = await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${link}'`, "-p", app);
    assert.match(launch, /Status: ok/);
    console.log(launch.replace(/(Starting: Intent \{).*?( pkg=)/, "$1 [fixture URI omitted]$2"));
    await screen(/content-desc="QA Mobile Bot[.,]/, "Android roster after deep-link pairing");
    console.log("Android paired from the deep link over cleartext HTTP and rendered the roster");
    const { bot } = await api.createBot({ name: "QA Native Live Update" });
    assert.equal(bot.name, "QA Native Live Update");
    await screen(/content-desc="QA Native Live Update[.,]/, "roster update from the open Android SSE connection");
    console.log("Android rendered a bot created after the roster was visible, without user refresh");
    await adb("shell", "am", "force-stop", app);
    await adb("shell", "am", "start", "-W", "-n", `${app}/.MainActivity`);
    const home = await screen(/content-desc="QA Native Live Update[.,]/, "saved token and roster after Android process restart");
    console.log("Android restored the saved connection after force-stop");
    await tap(home, 'content-desc="New"');
    await screen(/text="New group"/, "Android new menu");
    await back();
    const roster = await screen(/content-desc="QA Native Live Update[.,]/, "Android roster after closing a modal with Back");
    console.log("Android Back dismissed the modal and returned to the roster");
    await tap(roster, 'content-desc="QA Mobile Group[.,][^"]*"');
    const group = await screen(/text="Message the group, @ to mention"/, "Android group composer");
    await tap(group, 'class="android.widget.EditText"');
    await until(imeOpen, "Android keyboard");
    await adb("shell", "input", "text", "@");
    const mention = /content-desc="Mention QA Mobile Bot"/;
    await screen(mention, "mention picker while the Android keyboard is open");
    assert.ok(await imeOpen());

    await setRoutes(false);
    try {
      const offline = await screen(/Offline · Reconnecting…/, "offline bar after closing the fixture route");
      assert.match(offline, /text="@"/);
    } finally {
      await setRoutes(true);
    }
    await screen(mention, "mention picker after reopening the fixture route");
    console.log("Android preserved the open group composer draft across a companion route drop");
    await back();
    const afterBack = await dump();
    const pickerStillOpen = mention.test(afterBack);
    const keyboardStillOpen = await imeOpen();
    console.log(`Android first Back with mention and IME open: mention=${pickerStillOpen} ime=${keyboardStillOpen}`);
    if (pickerStillOpen) await back();
    await screen(/^(?![\s\S]*content-desc="Mention QA Mobile Bot")[\s\S]*text="@"/, "group composer after closing the mention picker");
    if (await imeOpen()) await back();
    await back();
    await screen(/content-desc="QA Mobile Group[.,]/, "Android roster after Back from group chat");
  } finally {
    try {
      if (installed) {
        await adb("uninstall", app);
        assert.equal(await adb("shell", "pm", "list", "packages", app), "");
      }
    } finally {
      if (reversed && (await adb("reverse", "--list")).includes(service)) await adb("reverse", "--remove", service);
      await adb("shell", "rm", "-f", dumpPath);
    }
  }
}

const fixture = await launchVerificationServer({}, shutdown.signal);
const { dataDir, pid, url, logPath } = fixture.info;
let companion;
try {
  const port = await freePortBlock([0, 1]);
  const baseUrl = `http://127.0.0.1:${port}`;
  const controlUrl = `http://127.0.0.1:${port + 1}`;
  const controlToken = randomBytes(32).toString("base64url");
  const home = join(dataDir, "companion-home");
  mkdirSync(home);
  companion = spawn(process.execPath, ["--experimental-strip-types", "companion/src/index.ts"], {
    cwd: root,
    env: {
      HOME: home,
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      OMB_PORT: new URL(url).port,
      OMB_COMPANION_PORT: String(port),
      OMB_CONTROL_PORT: String(port + 1),
      OMB_COMPANION_DIR: join(dataDir, "companion"),
      OMB_COMPANION_NAME: "Mobile QA fixture",
      OMB_COMPANION_ROUTES: "wifi,tailscale",
      OMB_COMPANION_TAILNET_NAME: "mobile-qa.tailnet.ts.net",
      OMB_COMPANION_BONJOUR: "0",
      OMB_CONTROL_TOKEN: controlToken,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(`fixture harness=${url} pid=${pid} companion=${baseUrl} pid=${companion.pid} data=${dataDir}`);

  const control = (path, method = "GET", body) => fetch(controlUrl + path, {
    method,
    headers: {
      "x-openmausbot-control-token": controlToken,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(2_000)]),
  });
  const state = await until(async () => {
    assert.equal(companion.exitCode, null, "Companion exited during startup");
    const response = await control("/state").catch(() => null);
    return response?.ok ? response.json() : null;
  }, "companion control");
  assert.equal(state.pid, companion.pid);
  assert.deepEqual(state.directRoutes, { wifi: true, tailscale: true });
  await until(async () => {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    return response?.ok && (await response.json()).app === "openmausbot";
  }, "companion health");

  const openPairing = async () => {
    const response = await control("/pairing", "POST");
    assert.equal(response.status, 201);
    return response.json();
  };

  let firstEventsConnection;
  let nextEventsConnection;
  const pairingResponses = [];
  const transport = async (address, init) => {
    assert.equal(new URL(address).origin, baseUrl);
    const { pathname, search } = new URL(address);
    const headers = new Headers(init.headers);
    assert.equal(headers.has("origin"), false);
    const signal = AbortSignal.any([shutdown.signal, ...(init.signal ? [init.signal] : [])]);
    const response = await fetch(address, { ...init, headers, signal, redirect: "error" });
    const code = pathname === "/api/pair" && !response.ok ? (await response.clone().json()).code : undefined;
    if (pathname === "/api/pair") pairingResponses.push([response.status, code]);
    const cursor = headers.get("last-event-id");
    console.log(`${init.method} ${pathname}${search} -> ${response.status} Origin=absent${code ? ` code=${code}` : ""}${cursor ? ` Last-Event-ID=${cursor}` : ""}`);
    return response;
  };
  const redeem = (invite, manual, previous) => {
    assert.ok(invite.ok);
    return redeemInvite({
      invite: invite.value,
      fetch: transport,
      deviceName: "Mobile QA",
      serverId: previous?.server.id ?? randomUUID(),
      pairRequestId: randomUUID(),
      manual,
      ...(previous ? { replacesToken: previous.token } : {}),
    });
  };
  const window = await openPairing();
  const wrong = await redeem(manualInvite(baseUrl, window.code === "000000" ? "111111" : "000000"), true);
  assert.equal(wrong.ok, false);
  assert.match(wrong.problem, /code/i);
  const manual = await redeem(manualInvite(baseUrl, window.code), true);
  assert.ok(manual.ok);
  assert.equal(manual.server.manualUrl, baseUrl);
  assert.match(manual.token, /^omb_/);
  const closed = await redeem(manualInvite(baseUrl, window.code), true);
  assert.equal(closed.ok, false);
  assert.deepEqual(pairingResponses, [
    [401, "pairing_code_wrong"],
    [201, undefined],
    [401, "pairing_not_open"],
  ]);

  const client = (token) => createApiClient({ baseUrl, token, fetch: transport });
  const api = client(manual.token);
  const initial = await api.bots();
  assert.equal(initial.bots.length, 1);
  const { instances } = await api.instances();
  assert.ok(instances.some(({ instanceId }) => instanceId === "claude"));
  await assert.rejects(client("omb_invalid_qa_token").bots(), (error) => error instanceof ApiError && error.status === 401);

  const frames = [];
  let cursor;
  const firstConnection = new AbortController();
  let eventRequests = 0;
  const stream = new EventStream({
    baseUrl,
    token: manual.token,
    random: () => 0.5,
    fetch(address, init) {
      assert.equal(new URL(address).searchParams.get("screens"), "off");
      assert.equal(new URL(address).searchParams.get("frames"), "thread");
      if (++eventRequests === 1) {
        firstEventsConnection = init.headers["Last-Event-ID"];
        return transport(address, { ...init, signal: AbortSignal.any([init.signal, firstConnection.signal]) });
      }
      nextEventsConnection = init.headers["Last-Event-ID"];
      assert.equal(new URL(address).searchParams.get("since"), nextEventsConnection);
      return transport(address, init);
    },
    onCursor: (next) => { cursor = next; },
    onFrame: (frame) => frames.push(frame),
    onStatus: (status) => { if (status === "live") console.log("SSE status=live"); },
  });
  let bot;
  let group;
  let beforeDisconnect;
  try {
    stream.start();
    const hello = await until(() => frames.find(({ kind }) => kind === "hello"), "initial SSE hello");
    assert.equal(hello.resumed, false);
    assert.equal(firstEventsConnection, undefined);
    console.log(`SSE hello resumed=${hello.resumed} cursor=${hello.cursor}`);
    ({ bot } = await api.createBot({ name: "QA Mobile Bot" }));
    assert.equal(bot.name, "QA Mobile Bot");
    await until(() => frames.find((frame) => frame.kind === "bot" && frame.bot.id === bot.id), "live bot frame");
    assert.notEqual(cursor, hello.cursor);
    beforeDisconnect = cursor;
    firstConnection.abort();
    ({ group } = await api.createGroup({ name: "QA Mobile Group", memberIds: [initial.bots[0].id, bot.id] }));
    assert.deepEqual(new Set(group.memberIds), new Set([initial.bots[0].id, bot.id]));
    const resumed = await until(() => frames.filter(({ kind }) => kind === "hello")[1], "reconnect SSE hello");
    assert.equal(resumed.resumed, true);
    assert.equal(nextEventsConnection, beforeDisconnect);
    await until(() => frames.find((frame) => frame.kind === "group" && frame.group.id === group.id), "replayed group frame");
    console.log(`SSE hello resumed=${resumed.resumed} cursor=${resumed.cursor} replay=group`);
  } finally {
    stream.stop();
  }

  const interruptedReplayFrames = [];
  const replayHeaders = [];
  const interruptedReplay = new EventStream({
    baseUrl,
    token: manual.token,
    cursor: beforeDisconnect,
    random: () => 0.5,
    async fetch(address, init) {
      replayHeaders.push(init.headers["Last-Event-ID"]);
      const response = await transport(address, init);
      return replayHeaders.length === 1 ? cutAfterHello(response) : response;
    },
    onFrame: (frame) => interruptedReplayFrames.push(frame),
    onCursor() {},
    onStatus() {},
  });
  try {
    interruptedReplay.start();
    await until(() => interruptedReplayFrames.filter(({ kind }) => kind === "hello").length === 2, "hello after interrupted replay");
    const [firstHello, secondHello] = interruptedReplayFrames.filter(({ kind }) => kind === "hello");
    assert.equal(firstHello.resumed, true);
    assert.equal(secondHello.resumed, true);
    const sentinel = await api.createBot({ name: "QA Replay Sentinel" });
    await until(() => interruptedReplayFrames.some((frame) => frame.kind === "bot" && frame.bot.id === sentinel.bot.id), "live frame after interrupted replay");
    const groupReplayed = interruptedReplayFrames.some((frame) => frame.kind === "group" && frame.group.id === group.id);
    console.log(`Interrupted replay: before=${beforeDisconnect} hello=${firstHello.cursor} retry=${replayHeaders[1]} groupReplayed=${groupReplayed}`);
  } finally {
    interruptedReplay.stop();
  }

  const sendId = randomUUID();
  const message = { text: "Mobile QA live integration", threadId: bot.threadId, sendId };
  const first = await api.sendToBot(bot.id, message);
  const retry = await api.sendToBot(bot.id, message);
  assert.ok(first.message?.id);
  assert.equal(first.message.id, retry.message?.id);
  const page = await api.messages(bot.threadId);
  assert.equal(page.messages.filter((row) => row.text === message.text).length, 1);
  console.log("Identical sendId returned the same message; exactly one persisted user message");

  let gapHello;
  const gapStream = new EventStream({
    baseUrl,
    token: manual.token,
    cursor: "obsolete-stream:1",
    fetch: transport,
    onFrame: (frame) => { if (frame.kind === "hello") gapHello = frame; },
    onCursor() {},
    onStatus() {},
  });
  try {
    gapStream.start();
    const hello = await until(() => gapHello, "hello for an obsolete stream cursor");
    assert.equal(hello.resumed, false);
    let thread = initialThread(bot.threadId);
    thread = threadReducer(thread, {
      type: "frame",
      frame: {
        kind: "runtime",
        event: { threadId: bot.threadId, type: "content.delta", itemId: "qa-interrupted-item", streamKind: "assistant_text", delta: "Partial reply" },
      },
    });
    thread = threadReducer(thread, { type: "frame", frame: hello });
    thread = threadReducer(thread, { type: "loaded", page: await api.messages(bot.threadId) });
    console.log(`Replay gap: resumed=${hello.resumed} afterReload.running=${thread.running} afterReload.partialReplies=${thread.streams.length}`);
  } finally {
    gapStream.stop();
  }

  const qrWindow = await openPairing();
  const link = phonePairingLink({ address: baseUrl, token: qrWindow.token, name: "Mobile QA fixture" });
  assert.ok(link);
  const qr = await redeem(parsePairingLink(link), false, manual);
  assert.ok(qr.ok);
  assert.equal(qr.server.id, manual.server.id);
  assert.equal((await api.bots().catch((error) => error)).status, 401);
  assert.ok((await client(qr.token).bots()).bots.some((entry) => entry.id === bot.id));
  const androidSerial = process.argv.find((arg) => arg.startsWith("--android="))?.slice("--android=".length);
  if (androidSerial) {
    const androidWindow = await openPairing();
    const androidLink = phonePairingLink({ address: baseUrl, token: androidWindow.token });
    assert.ok(androidLink);
    const setRoutes = async (enabled) => {
      const response = await control("/routes", "PUT", { wifi: enabled, tailscale: enabled });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    };
    await verifyAndroid(androidSerial, port, androidLink, client(qr.token), setRoutes);
  }
  const revoked = await control(`/devices/${qr.server.deviceId}`, "DELETE");
  assert.equal(revoked.status, 200);
  await revoked.arrayBuffer();
  await assert.rejects(client(qr.token).bots(), (error) => error instanceof ApiError && error.status === 401);
  console.log("QR credential replaced the manual token. Explicit revocation also returned 401.");
} finally {
  await waitForExit(companion, { signal: "SIGTERM" });
  await fixture.close();
  assert.ok(companion == null || companion.exitCode !== null || companion.signalCode !== null);
  assert.ok(fixture.child.exitCode !== null || fixture.child.signalCode !== null);
  assert.equal(existsSync(dataDir), false);
  console.log(`cleanup harnessPid=${pid} companionPid=${companion?.pid} dataRemoved=true harnessLog=${logPath}`);
}
