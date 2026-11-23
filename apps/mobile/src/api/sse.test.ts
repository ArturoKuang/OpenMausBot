import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { controlledStream, fakeFetch, jsonResponse, type RecordedRequest } from "../testing/fake-fetch";
import { backoffMs, EventStream, SseParser, WATCHDOG_MS, type StreamStatus } from "./sse";

describe("SseParser", () => {
  it("assembles events split across chunks and line endings", () => {
    const parser = new SseParser();
    expect(parser.feed('id: s1:4\r\ndata: {"kind":')).toEqual([]);
    expect(parser.feed('"thread"}\r')).toEqual([]);
    expect(parser.feed("\n\r\n")).toEqual([{ id: "s1:4", data: '{"kind":"thread"}' }]);
  });

  it("skips comments and joins multi-line data", () => {
    const parser = new SseParser();
    const events = parser.feed(': keepalive\n\ndata: {"kind":"ping"}\n\nevent: x\ndata: a\ndata: b\n\n');
    expect(events).toEqual([{ data: '{"kind":"ping"}' }, { event: "x", data: "a\nb" }]);
  });
});

describe("backoffMs", () => {
  it("doubles from one second and caps at thirty", () => {
    const flat = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 9].map((attempt) => backoffMs(attempt, flat))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(backoffMs(0, () => 0)).toBe(800);
    expect(backoffMs(9, () => 1)).toBe(30000);
  });
});

const settle = async () => {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe("EventStream", () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => void vi.useRealTimers());

  function harness(answer: (request: RecordedRequest, index: number) => ReturnType<typeof jsonResponse>, cursor?: string) {
    let index = 0;
    const { fetch, requests } = fakeFetch((request) => answer(request, index++));
    const frames: ServerFrame[] = [];
    const statuses: StreamStatus[] = [];
    const cursors: string[] = [];
    const stream = new EventStream({
      baseUrl: "http://100.64.0.7:8810",
      token: "omb_device",
      fetch,
      ...(cursor ? { cursor } : {}),
      random: () => 0.5,
      onFrame: (frame) => frames.push(frame),
      onStatus: (status) => statuses.push(status),
      onCursor: (next) => cursors.push(next),
    });
    return { stream, requests, frames, statuses, cursors };
  }

  it("resumes from the last event id after the connection drops", async () => {
    const first = controlledStream();
    const second = controlledStream();
    const bodies = [first, second];
    const { stream, requests, frames, statuses, cursors } = harness((_request, index) => ({ ...jsonResponse(200, undefined), body: bodies[index]!.body }));

    stream.start();
    await settle();
    first.push('data: {"kind":"hello","cursor":"s1:0","resumed":false}\n\n');
    first.push(': keepalive\n\ndata: {"kind":"ping"}\n\n');
    first.push('id: s1:1\ndata: {"kind":"thread","threadId":"t1","activeLeafId":"m1"}\n\n');
    await settle();
    first.end();
    await settle();

    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
    expect(frames.map((frame) => frame.kind)).toEqual(["hello", "thread"]);
    expect(cursors).toEqual(["s1:0", "s1:1"]);

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toBe("http://100.64.0.7:8810/api/events?screens=off&frames=thread");
    expect(requests[0]!.headers["Last-Event-ID"]).toBeUndefined();
    expect(requests[1]!.url).toBe("http://100.64.0.7:8810/api/events?screens=off&frames=thread&since=s1%3A1");
    expect(requests[1]!.headers["Last-Event-ID"]).toBe("s1:1");
    for (const request of requests) {
      expect(request.headers.Authorization).toBe("Bearer omb_device");
      expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain("origin");
    }
    stream.stop();
  });

  it("reconnects when heartbeats stop arriving", async () => {
    const bodies = [controlledStream(), controlledStream()];
    const { stream, requests } = harness((_request, index) => ({ ...jsonResponse(200, undefined), body: bodies[index]!.body }), "s1:9");

    stream.start();
    await settle();
    bodies[0]!.push('data: {"kind":"hello","cursor":"s1:9","resumed":true}\n\n');
    await settle();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1);
    await settle();
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers["Last-Event-ID"]).toBe("s1:9");
    stream.stop();
  });

  it("stops for good when the device is unpaired or must update", async () => {
    for (const [status, expected] of [[401, "unpaired"], [426, "update_app"]] as const) {
      const { stream, requests, statuses } = harness(() => jsonResponse(status, { error: "x" }));
      stream.start();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(statuses.at(-1)).toBe(expected);
      expect(requests).toHaveLength(1);
    }
  });

  it("retries a refused connection with growing waits", async () => {
    const { stream, requests } = harness(() => jsonResponse(502, { error: "harness stopped" }));
    stream.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    await settle();
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(requests).toHaveLength(3);
    stream.stop();
  });
});
