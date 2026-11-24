import type { RuntimeEvent } from "@openmausbot/phone-protocol/runtime-events.ts";
import type { ServerFrame, WireBot, WireGroup, WireMessage, WireTask } from "@openmausbot/phone-protocol/wire.ts";

export function task(threadId: string, extra: Partial<WireTask> = {}): WireTask {
  return { threadId, title: threadId, createdAt: 1, ...extra };
}

export function bot(id: string, extra: Partial<WireBot> = {}): WireBot {
  return {
    id,
    threadId: `${id}-t1`,
    name: id,
    title: "",
    description: "",
    notifications: true,
    color: "blue",
    avatarUrl: null,
    unread: false,
    modelSelection: { instanceId: "claude", model: "opus" },
    createdAt: 1,
    tasks: [task(`${id}-t1`)],
    ...extra,
  } as WireBot;
}

export function group(id: string, memberIds: string[], extra: Partial<WireGroup> = {}): WireGroup {
  return {
    id,
    threadId: `${id}-t1`,
    name: id,
    memberIds,
    defaultResponder: { kind: "auto" },
    bulletin: "",
    unread: false,
    createdAt: 1,
    working: false,
    ...extra,
  };
}

export function message(id: string, extra: Partial<WireMessage> = {}): WireMessage {
  return { id, role: "bot", kind: "text", text: id, at: 1, ...extra };
}

export function runtime(threadId: string, event: Record<string, unknown>): ServerFrame {
  return { kind: "runtime", event: { eventId: "e", provider: "claude", createdAt: "", threadId, ...event } as RuntimeEvent };
}
