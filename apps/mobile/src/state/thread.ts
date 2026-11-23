import type { OptionCardData, ServerFrame, WireMessage, WireMessagePage } from "@openmausbot/phone-protocol/wire.ts";
import { progressLabel, startedLabel } from "./progress";

/** Assistant text still streaming under its `itemId`, until the stored message replaces it. */
export interface StreamingReply {
  itemId: string;
  text: string;
  botId?: string;
}

/** A line the person sent that the server hasn't stored yet. Retrying reuses `sendId`, so it never sends twice. */
export interface PendingSend {
  sendId: string;
  text: string;
  at: number;
  mentions?: string[];
  state: "sending" | "queued" | "failed";
}

export interface ThreadState {
  threadId: string;
  loaded: boolean;
  messages: WireMessage[];
  hasMore: boolean;
  streams: StreamingReply[];
  thinking: boolean;
  step: string | null;
  running: boolean;
  turnId: string | null;
  pending: PendingSend[];
  /** Message ids of cards whose answer is on its way. */
  answering: string[];
  /** The visible branch moved to a leaf we don't have: load the page again. */
  stale: boolean;
}

export type ThreadAction =
  | { type: "loaded"; page: WireMessagePage }
  | { type: "olderLoaded"; page: WireMessagePage }
  | { type: "frame"; frame: ServerFrame }
  | { type: "sendStarted"; send: Omit<PendingSend, "state"> }
  | { type: "sendAccepted"; sendId: string; message?: WireMessage; queued?: boolean }
  | { type: "sendFailed"; sendId: string }
  | { type: "answerStarted"; messageId: string }
  | { type: "answerFailed"; messageId: string };

export function initialThread(threadId: string): ThreadState {
  return {
    threadId,
    loaded: false,
    messages: [],
    hasMore: false,
    streams: [],
    thinking: false,
    step: null,
    running: false,
    turnId: null,
    pending: [],
    answering: [],
    stale: false,
  };
}

/** A card nobody can answer any more. */
export function cardSettled(card: OptionCardData): boolean {
  return Boolean(card.answered || card.answeredText || card.dismissed || card.expired || card.stopped || card.autoApplied);
}

function upsert(state: ThreadState, message: WireMessage): ThreadState {
  const index = state.messages.findIndex((existing) => existing.id === message.id);
  const messages = index === -1 ? [...state.messages, message] : state.messages.map((existing, at) => (at === index ? message : existing));
  return {
    ...state,
    messages,
    streams: message.itemId ? state.streams.filter((stream) => stream.itemId !== message.itemId) : state.streams,
    pending: message.sendId ? state.pending.filter((send) => send.sendId !== message.sendId) : state.pending,
    answering: message.card && cardSettled(message.card) ? state.answering.filter((id) => id !== message.id) : state.answering,
    thinking: message.role === "bot" && message.kind === "text" ? false : state.thinking,
  };
}

function appendDelta(streams: StreamingReply[], itemId: string, delta: string, botId: string | undefined): StreamingReply[] {
  const existing = streams.find((stream) => stream.itemId === itemId);
  if (!existing) return [...streams, { itemId, text: delta, ...(botId ? { botId } : {}) }];
  return streams.map((stream) => (stream === existing ? { ...stream, text: stream.text + delta } : stream));
}

function applyFrame(state: ThreadState, frame: ServerFrame): ThreadState {
  switch (frame.kind) {
    case "message":
    case "message.patch":
      return frame.threadId === state.threadId ? upsert(state, frame.message) : state;
    case "thread":
      if (frame.threadId !== state.threadId) return state;
      return state.messages.some((message) => message.id === frame.activeLeafId) ? state : { ...state, stale: true };
    case "runtime": {
      const event = frame.event;
      if (event.threadId !== state.threadId) return state;
      switch (event.type) {
        case "turn.started":
          return { ...state, running: true, turnId: event.turnId ?? null, step: null, thinking: false };
        case "turn.completed":
          return { ...state, running: false, turnId: null, step: null, thinking: false };
        case "content.delta":
          if (event.streamKind === "reasoning_text") return state.thinking ? state : { ...state, thinking: true };
          return {
            ...state,
            running: true,
            thinking: false,
            streams: appendDelta(state.streams, event.itemId ?? event.turnId ?? "reply", event.delta, event.botId),
          };
        case "turn.progress":
          return { ...state, running: true, step: progressLabel(event) };
        case "item.started":
          return event.itemType === "tool" ? { ...state, running: true, step: startedLabel(event) } : state;
        case "item.completed":
          return event.itemType === "tool" ? { ...state, step: null } : state;
        case "request.resolved": {
          const settled = state.messages.filter((message) => message.card?.requestId === event.requestId).map((message) => message.id);
          return settled.length ? { ...state, answering: state.answering.filter((id) => !settled.includes(id)) } : state;
        }
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "loaded": {
      const stored = new Set(action.page.messages.map((message) => message.sendId).filter(Boolean));
      return {
        ...state,
        loaded: true,
        stale: false,
        messages: action.page.messages,
        hasMore: action.page.hasMore === true,
        pending: state.pending.filter((send) => !stored.has(send.sendId)),
      };
    }
    case "olderLoaded": {
      const known = new Set(state.messages.map((message) => message.id));
      return { ...state, messages: [...action.page.messages.filter((message) => !known.has(message.id)), ...state.messages], hasMore: action.page.hasMore === true };
    }
    case "frame":
      return applyFrame(state, action.frame);
    case "sendStarted": {
      const others = state.pending.filter((send) => send.sendId !== action.send.sendId);
      return { ...state, pending: [...others, { ...action.send, state: "sending" }] };
    }
    case "sendAccepted":
      if (action.message) return upsert(state, action.message);
      return {
        ...state,
        pending: state.pending.map((send) => (send.sendId === action.sendId ? { ...send, state: action.queued ? "queued" : send.state } : send)),
      };
    case "sendFailed":
      return { ...state, pending: state.pending.map((send) => (send.sendId === action.sendId ? { ...send, state: "failed" } : send)) };
    case "answerStarted":
      return state.answering.includes(action.messageId) ? state : { ...state, answering: [...state.answering, action.messageId] };
    case "answerFailed":
      return { ...state, answering: state.answering.filter((id) => id !== action.messageId) };
  }
}

export type TranscriptRow =
  | { kind: "message"; key: string; message: WireMessage }
  | { kind: "stream"; key: string; stream: StreamingReply }
  | { kind: "pending"; key: string; send: PendingSend };

/** Rows top to bottom: stored lines, then replies still streaming, then sends not stored yet. */
export function transcriptRows(state: ThreadState): TranscriptRow[] {
  const shown = state.messages.filter((message) => !message.reaction && message.kind !== "screen");
  return [
    ...shown.map((message): TranscriptRow => ({ kind: "message", key: message.id, message })),
    ...state.streams.filter((stream) => stream.text.trim()).map((stream): TranscriptRow => ({ kind: "stream", key: `stream:${stream.itemId}`, stream })),
    ...state.pending.map((send): TranscriptRow => ({ kind: "pending", key: `send:${send.sendId}`, send })),
  ];
}
