import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import { requestHeaders, type FetchLike } from "./client";

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

/** An incremental `text/event-stream` reader: feed it text as it arrives, get whole events back. */
export class SseParser {
  private buffer = "";
  private data: string[] = [];
  private id: string | undefined;
  private event: string | undefined;

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      // A lone trailing \r may be the first half of \r\n: wait for the next chunk.
      if (!match || (match[0] === "\r" && match.index === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.line(line);
      if (event) events.push(event);
    }
    return events;
  }

  private line(line: string): SseEvent | null {
    if (line === "") {
      if (this.data.length === 0) {
        this.event = undefined;
        return null;
      }
      const event: SseEvent = { data: this.data.join("\n"), ...(this.id !== undefined ? { id: this.id } : {}), ...(this.event ? { event: this.event } : {}) };
      this.data = [];
      this.id = undefined;
      this.event = undefined;
      return event;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.id = value;
    else if (field === "event") this.event = value;
    return null;
  }
}

export const HEARTBEAT_MS = 15_000;
/** More than two missed heartbeats: the connection is dead even if the socket says otherwise. */
export const WATCHDOG_MS = 35_000;
const MAX_BACKOFF_MS = 30_000;

/** 1s, 2s, 4s, 8s … capped at 30s, each ±20% so phones that dropped together don't return together. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (0.8 + 0.4 * random())));
}

export type StreamStatus = "connecting" | "live" | "reconnecting" | "unpaired" | "update_app" | "stopped";

export interface EventStreamOptions {
  baseUrl: string;
  token: string;
  fetch: FetchLike;
  cursor?: string;
  onFrame(frame: ServerFrame): void;
  onStatus(status: StreamStatus, attempt: number): void;
  onCursor(cursor: string): void;
  random?: () => number;
}

export function eventsUrl(baseUrl: string, cursor: string | undefined): string {
  const since = cursor ? `&since=${encodeURIComponent(cursor)}` : "";
  return `${baseUrl.replace(/\/+$/, "")}/api/events?screens=off&frames=thread${since}`;
}

type StreamFrame = ServerFrame | { kind: "ping" };

/** `GET /api/events` kept open: resumes from the last cursor through `Last-Event-ID`, reconnects with backoff, and
 * treats 35s of silence as a dropped connection. */
export class EventStream {
  private cursor: string | undefined;
  private attempt = 0;
  private running = false;
  private controller: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: EventStreamOptions) {
    this.cursor = options.cursor;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.controller?.abort();
    this.controller = null;
    this.options.onStatus("stopped", this.attempt);
  }

  /** Skip the backoff wait: the network or the app just came back. */
  reconnectNow(): void {
    if (!this.running || this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.retryTimer = null;
    this.watchdog = null;
  }

  private armWatchdog(controller: AbortController): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => controller.abort(), WATCHDOG_MS);
  }

  private async connect(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.options.onStatus(this.attempt === 0 ? "connecting" : "reconnecting", this.attempt);
    this.armWatchdog(controller);
    await this.open(controller).catch(() => undefined);
    if (this.controller === controller) this.scheduleRetry();
  }

  private async open(controller: AbortController): Promise<void> {
    const { baseUrl, token, fetch } = this.options;
    const response = await fetch(eventsUrl(baseUrl, this.cursor), {
      method: "GET",
      headers: requestHeaders(token, false, {
        Accept: "text/event-stream",
        ...(this.cursor ? { "Last-Event-ID": this.cursor } : {}),
      }),
      signal: controller.signal,
    });
    if (response.status === 401) return this.halt("unpaired");
    if (response.status === 426) return this.halt("update_app");
    if (!response.ok || !response.body) return;
    await this.read(response.body, controller);
  }

  private async read(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const abort = () => void reader.cancel().catch(() => {});
    controller.signal.addEventListener("abort", abort);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !this.running || controller.signal.aborted) return;
        this.armWatchdog(controller);
        for (const event of parser.feed(decoder.decode(value, { stream: true }))) this.dispatch(event);
      }
    } finally {
      controller.signal.removeEventListener("abort", abort);
    }
  }

  private dispatch(event: SseEvent): void {
    let frame: StreamFrame;
    try {
      frame = JSON.parse(event.data) as StreamFrame;
    } catch {
      return;
    }
    if (frame.kind === "ping") return;
    if (event.id) this.setCursor(event.id);
    if (frame.kind === "hello") {
      this.setCursor(frame.cursor);
      this.attempt = 0;
      this.options.onStatus("live", 0);
    }
    this.options.onFrame(frame);
  }

  private setCursor(cursor: string): void {
    this.cursor = cursor;
    this.options.onCursor(cursor);
  }

  private halt(status: "unpaired" | "update_app"): void {
    this.running = false;
    this.clearTimers();
    this.controller = null;
    this.options.onStatus(status, this.attempt);
  }

  private scheduleRetry(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (!this.running) return;
    this.attempt += 1;
    this.options.onStatus("reconnecting", this.attempt);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, backoffMs(this.attempt - 1, this.options.random));
  }
}
