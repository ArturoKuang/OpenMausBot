import type { PairingErrorCode } from "@openmausbot/phone-protocol/pairing-code.ts";
import type {
  BotCreateResponse,
  BotsResponse,
  InstancesResponse,
  PairRequest,
  PairResponse,
  RoomCreateResponse,
  WireBot,
  WireGroup,
  WireMessage,
  WireMessagePage,
} from "@openmausbot/phone-protocol/wire.ts";

/** The slice of `fetch` this client needs: `expo/fetch` on the phone, a fake in tests. */
export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

export interface RequestInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface ResponseLike {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}

/** A refusal from the server: `code` is its machine-readable reason (`pairing_code_wrong`, `update_app`, …). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The device token stopped working: the computer removed this phone. */
export const isUnpaired = (error: unknown): boolean => error instanceof ApiError && error.status === 401;
/** The companion wants an end-to-end encrypted client for this device. */
export const needsAppUpdate = (error: unknown): boolean => error instanceof ApiError && error.status === 426;

/** Every request's headers. The companion refuses any request that carries `Origin` (403), so none is ever set. */
export function requestHeaders(token: string | null, hasBody: boolean, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

const seg = encodeURIComponent;

export type SendFollowUp = "steer" | "queue" | "restart";

export interface BotSend {
  text: string;
  threadId: string;
  sendId: string;
  followUp?: SendFollowUp;
}

export interface GroupSend {
  text: string;
  threadId: string;
  sendId: string;
  mentions?: string[];
}

/** 202 from either send route: the stored line, or its place in the steer queue. */
export interface SendReceipt {
  ok: boolean;
  threadId: string;
  message?: WireMessage;
  queued?: boolean;
  queueId?: string;
}

export interface CardResponse {
  requestId: string;
  behavior: "allow" | "deny" | "answer";
  message?: string;
  always?: boolean;
}

export interface NewBot {
  name: string;
  title?: string;
}

export interface NewGroup {
  name?: string;
  memberIds: string[];
}

export interface ModelChoice {
  instanceId: string;
  model: string;
  effort?: string;
}

interface CallOptions {
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  token: string | null;
  fetch: FetchLike;
}

function linkedAbort(outer: AbortSignal | undefined, timeoutMs: number | undefined): { signal?: AbortSignal; done(): void } {
  if (!outer && !timeoutMs) return { done() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort);
  if (outer?.aborted) controller.abort();
  const timer = timeoutMs ? setTimeout(abort, timeoutMs) : undefined;
  return {
    signal: controller.signal,
    done() {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", abort);
    },
  };
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createApiClient({ baseUrl, token, fetch }: ApiClientOptions) {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, { body, timeoutMs, signal }: CallOptions = {}): Promise<T> {
    const abort = linkedAbort(signal, timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: requestHeaders(token, body !== undefined),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(abort.signal ? { signal: abort.signal } : {}),
      });
      const parsed = parseJson(await response.text()) as { error?: unknown; code?: unknown } | undefined;
      if (!response.ok) {
        const error = typeof parsed?.error === "string" ? parsed.error : `Request failed (${response.status})`;
        const code = typeof parsed?.code === "string" ? parsed.code : response.status === 426 ? "update_app" : undefined;
        throw new ApiError(response.status, error, code);
      }
      return parsed as T;
    } finally {
      abort.done();
    }
  }

  return {
    baseUrl: base,
    health: (timeoutMs = 3000) => call<{ app?: string; version?: string }>("GET", "/api/health", { timeoutMs }),
    pair: (request: PairRequest) => call<PairResponse>("POST", "/api/pair", { body: request, timeoutMs: 15_000 }),

    bots: (openId?: string) =>
      call<BotsResponse>("GET", `/api/bots?messages=40&tail=10${openId ? `&open=${seg(openId)}` : ""}`),
    createBot: (bot: NewBot) => call<BotCreateResponse>("POST", "/api/bots", { body: bot }),
    createGroup: (group: NewGroup) => call<RoomCreateResponse>("POST", "/api/groups", { body: group }),
    instances: () => call<InstancesResponse>("GET", "/api/instances"),
    setBotModel: (botId: string, choice: ModelChoice) =>
      call<{ bot: WireBot }>("PATCH", `/api/bots/${seg(botId)}/model`, { body: choice }),

    messages: (threadId: string, before?: string) =>
      call<WireMessagePage>("GET", `/api/threads/${seg(threadId)}/messages?limit=40${before ? `&before=${seg(before)}` : ""}`),
    toolOutput: (threadId: string, messageId: string) =>
      call<{ output: string }>("GET", `/api/threads/${seg(threadId)}/messages/${seg(messageId)}/tool`),

    sendToBot: (botId: string, send: BotSend) =>
      call<SendReceipt>("POST", `/api/bots/${seg(botId)}/messages`, { body: send }),
    sendToGroup: (groupId: string, send: GroupSend) =>
      call<SendReceipt>("POST", `/api/groups/${seg(groupId)}/messages`, { body: send }),
    interruptBot: (botId: string, threadId: string, turnId?: string) =>
      call<{ ok: boolean; outcome?: string }>("POST", `/api/bots/${seg(botId)}/interrupt`, { body: { threadId, ...(turnId ? { turnId } : {}) } }),
    interruptGroup: (groupId: string, threadId: string) =>
      call<{ ok: boolean; outcome?: string }>("POST", `/api/groups/${seg(groupId)}/interrupt`, { body: { threadId } }),
    markBotRead: (botId: string, threadId: string) =>
      call<{ bot: WireBot }>("POST", `/api/bots/${seg(botId)}/read`, { body: { threadId } }),
    markGroupRead: (groupId: string, threadId: string) =>
      call<{ group: WireGroup }>("POST", `/api/groups/${seg(groupId)}/read`, { body: { threadId } }),

    respond: (threadId: string, response: CardResponse) =>
      call<{ ok: boolean; outcome?: string; late?: boolean }>("POST", `/api/threads/${seg(threadId)}/respond`, { body: response }),
    alwaysAllow: (botId: string, threadId: string, allowKey: string) =>
      call<{ bot: WireBot }>("POST", `/api/bots/${seg(botId)}/always-allow`, { body: { allowKey, threadId } }),
    patchCard: (botId: string, messageId: string, patch: { threadId: string; answered?: string; dismissed?: boolean }) =>
      call<{ message: WireMessage }>("PATCH", `/api/bots/${seg(botId)}/cards/${seg(messageId)}`, { body: patch }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

const PAIRING_REFUSALS: Partial<Record<PairingErrorCode, string>> = {
  pairing_not_open: "Pairing isn't open on that computer. Open Settings → Phone & devices there and try again.",
  pairing_code_wrong: "That code didn't match. Check the code on your computer and try again.",
  pairing_too_many: "Too many wrong codes. Start pairing again on your computer.",
  pairing_device_limit: "That computer has as many phones as it allows. Remove an old one there first.",
  pairing_qr_only: "This connection only pairs by scanning the QR code.",
};

/** The sentence a refused pairing shows: ours for the codes a phone meets, else the server's own words. */
export function pairingRefusalText(error: ApiError): string {
  return (error.code && PAIRING_REFUSALS[error.code as PairingErrorCode]) || error.message;
}
