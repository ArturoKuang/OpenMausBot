import type { RuntimeEvent } from "@openmausbot/phone-protocol/runtime-events.ts";
import {
  orderedThreadList,
  type BotsResponse,
  type ServerFrame,
  type WireBot,
  type WireGroup,
  type WireMessage,
  type WireTask,
} from "@openmausbot/phone-protocol/wire.ts";
import { progressLabel, startedLabel } from "./progress";

/** The newest readable line of a conversation, for its row's subtitle. */
export interface LastLine {
  text: string;
  at: number;
}

/** What a running turn shows on its row right now. */
export interface LiveTurn {
  label: string | null;
  typing: boolean;
}

export interface Roster {
  bots: Record<string, WireBot>;
  botOrder: string[];
  groups: Record<string, WireGroup>;
  groupOrder: string[];
  lastLine: Record<string, LastLine>;
  live: Record<string, LiveTurn>;
}

export type RosterAction =
  | { type: "snapshot"; response: BotsResponse }
  | { type: "frame"; frame: ServerFrame }
  | { type: "botSaved"; bot: WireBot }
  | { type: "groupSaved"; group: WireGroup };

export const emptyRoster: Roster = { bots: {}, botOrder: [], groups: {}, groupOrder: [], lastLine: {}, live: {} };

function readableLine(message: WireMessage): LastLine | null {
  if (message.kind !== "text" || message.queued || message.reaction) return null;
  const text = message.text?.replace(/\s+/g, " ").trim();
  return text ? { text, at: message.at } : null;
}

function lastLineOf(messages: readonly WireMessage[]): LastLine | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = readableLine(messages[index]!);
    if (line) return line;
  }
  return null;
}

/** A `?frames=thread` bot frame carries only the threads that changed. */
function mergeTasks(previous: WireTask[] | undefined, changed: WireTask[] | undefined): WireTask[] | undefined {
  if (!changed) return previous;
  const byThread = new Map((previous ?? []).map((task) => [task.threadId, task]));
  for (const task of changed) byThread.set(task.threadId, task);
  return [...byThread.values()];
}

function withOrder(order: string[], id: string): string[] {
  return order.includes(id) ? order : [...order, id];
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function applyRuntime(live: Record<string, LiveTurn>, event: RuntimeEvent): Record<string, LiveTurn> {
  const current = live[event.threadId] ?? { label: null, typing: false };
  switch (event.type) {
    case "turn.started":
      return { ...live, [event.threadId]: { label: null, typing: false } };
    case "turn.completed":
      return without(live, event.threadId);
    case "turn.progress":
      return { ...live, [event.threadId]: { ...current, label: progressLabel(event) } };
    case "item.started":
      return event.itemType === "tool" ? { ...live, [event.threadId]: { ...current, label: startedLabel(event) } } : live;
    case "content.delta":
      return event.streamKind === "assistant_text" && !current.typing
        ? { ...live, [event.threadId]: { label: null, typing: true } }
        : live;
    default:
      return live;
  }
}

export function rosterReducer(state: Roster, action: RosterAction): Roster {
  switch (action.type) {
    case "snapshot": {
      const { bots, groups } = action.response;
      const lastLine: Record<string, LastLine> = {};
      for (const host of [...bots, ...groups]) {
        const line = lastLineOf(host.messages);
        if (line) lastLine[host.threadId] = line;
      }
      const strip = <T extends { messages: unknown; hasMore?: unknown; activeLeafId: unknown }>({ messages: _m, hasMore: _h, activeLeafId: _a, ...rest }: T) => rest;
      return {
        bots: Object.fromEntries(bots.map((bot) => [bot.id, strip(bot) as WireBot])),
        botOrder: bots.map((bot) => bot.id),
        groups: Object.fromEntries(groups.map((group) => [group.id, strip(group) as WireGroup])),
        groupOrder: groups.map((group) => group.id),
        lastLine,
        live: state.live,
      };
    }
    case "botSaved":
      return { ...state, bots: { ...state.bots, [action.bot.id]: action.bot }, botOrder: withOrder(state.botOrder, action.bot.id) };
    case "groupSaved":
      return { ...state, groups: { ...state.groups, [action.group.id]: action.group }, groupOrder: withOrder(state.groupOrder, action.group.id) };
    case "frame":
      return applyFrame(state, action.frame);
  }
}

function applyFrame(state: Roster, frame: ServerFrame): Roster {
  switch (frame.kind) {
    case "bot": {
      const previous = state.bots[frame.bot.id];
      const bot = frame.tasksPartial ? { ...frame.bot, tasks: mergeTasks(previous?.tasks, frame.bot.tasks) } : frame.bot;
      return { ...state, bots: { ...state.bots, [bot.id]: bot }, botOrder: withOrder(state.botOrder, bot.id) };
    }
    case "bot.deleted":
      return { ...state, bots: without(state.bots, frame.botId), botOrder: state.botOrder.filter((id) => id !== frame.botId) };
    case "bots.order":
      return { ...state, botOrder: [...frame.botIds, ...state.botOrder.filter((id) => !frame.botIds.includes(id))] };
    case "group":
      return { ...state, groups: { ...state.groups, [frame.group.id]: frame.group }, groupOrder: withOrder(state.groupOrder, frame.group.id) };
    case "group.deleted":
      return { ...state, groups: without(state.groups, frame.groupId), groupOrder: state.groupOrder.filter((id) => id !== frame.groupId) };
    case "groups.order":
      return { ...state, groupOrder: [...frame.groupIds, ...state.groupOrder.filter((id) => !frame.groupIds.includes(id))] };
    case "message": {
      const line = readableLine(frame.message);
      if (!line) return state;
      const live = frame.message.role === "bot" && frame.message.turnTerminal ? without(state.live, frame.threadId) : state.live;
      return { ...state, lastLine: { ...state.lastLine, [frame.threadId]: line }, live };
    }
    case "runtime": {
      const live = applyRuntime(state.live, frame.event);
      return live === state.live ? state : { ...state, live };
    }
    default:
      return state;
  }
}

export type RowTone = "quiet" | "working" | "waiting";

export interface RosterRow {
  kind: "bot" | "group";
  id: string;
  threadId: string;
  name: string;
  subtitle: string;
  tone: RowTone;
  unread: boolean;
  at: number;
  colors: string[];
}

const WAITING = "Waiting for your approval";

function botRow(state: Roster, bot: WireBot): RosterRow {
  const task = bot.tasks?.find((candidate) => candidate.threadId === bot.threadId);
  const line = state.lastLine[bot.threadId];
  const live = state.live[bot.threadId];
  const working = bot.activity === "working" || bot.busy === true || live !== undefined;
  const waiting = bot.activity === "waiting-on-you";
  return {
    kind: "bot",
    id: bot.id,
    threadId: bot.threadId,
    name: bot.name,
    subtitle: waiting ? WAITING : working ? (live?.typing ? "Typing…" : live?.label ?? "Working…") : line?.text ?? bot.title ?? "",
    tone: waiting ? "waiting" : working ? "working" : "quiet",
    unread: bot.unread,
    at: line?.at ?? task?.updatedAt ?? bot.createdAt,
    colors: [bot.color],
  };
}

function groupRow(state: Roster, group: WireGroup): RosterRow {
  const line = state.lastLine[group.threadId];
  const live = state.live[group.threadId];
  const speaker = group.busyBotId ? state.bots[group.busyBotId]?.name : undefined;
  const waiting = group.tasks?.some((task) => task.threadId === group.threadId && task.activity === "waiting-on-you") ?? false;
  const working = group.working || live !== undefined;
  const members = group.memberIds.map((id) => state.bots[id]).filter((bot): bot is WireBot => bot !== undefined);
  return {
    kind: "group",
    id: group.id,
    threadId: group.threadId,
    name: group.name,
    subtitle: waiting
      ? WAITING
      : working
        ? live?.label ?? (speaker ? `${speaker} is typing…` : "Working…")
        : line?.text ?? members.map((bot) => bot.name).join(", "),
    tone: waiting ? "waiting" : working ? "working" : "quiet",
    unread: group.unread,
    at: line?.at ?? group.createdAt,
    colors: members.slice(0, 2).map((bot) => bot.color),
  };
}

/** Home's two lists, most recent first: group chats (never bot-to-bot channels) and visible bots. */
export function homeRows(state: Roster): { groups: RosterRow[]; bots: RosterRow[] } {
  const recent = (rows: RosterRow[], pinned: (id: string) => boolean) =>
    orderedThreadList(rows.map((row) => ({ row, pinned: pinned(row.id), lastThreadOrderAt: row.at }))).map((entry) => entry.row);
  const groups = state.groupOrder.map((id) => state.groups[id]).filter((group): group is WireGroup => group !== undefined && !group.dm);
  const bots = state.botOrder.map((id) => state.bots[id]).filter((bot): bot is WireBot => bot !== undefined && !bot.hidden);
  return {
    groups: recent(groups.map((group) => groupRow(state, group)), () => false),
    bots: recent(bots.map((bot) => botRow(state, bot)), (id) => state.bots[id]?.pinned === true),
  };
}
