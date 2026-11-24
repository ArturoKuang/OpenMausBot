import type { WireBot, WireGroup } from "@openmausbot/phone-protocol/wire.ts";
import type { Roster } from "../../state/roster";

export type ChatTarget = { kind: "bot"; id: string } | { kind: "group"; id: string };

export type ChatHost = { kind: "bot"; bot: WireBot } | { kind: "group"; group: WireGroup };

export function resolveHost(roster: Roster, target: ChatTarget): ChatHost | null {
  if (target.kind === "bot") {
    const bot = roster.bots[target.id];
    return bot ? { kind: "bot", bot } : null;
  }
  const group = roster.groups[target.id];
  return group ? { kind: "group", group } : null;
}

export const hostThreadId = (host: ChatHost): string => (host.kind === "bot" ? host.bot.threadId : host.group.threadId);

/** Whether a turn runs in the open conversation, as the roster last heard. */
export function hostBusy(host: ChatHost): boolean {
  if (host.kind === "group") return host.group.working;
  const task = host.bot.tasks?.find((candidate) => candidate.threadId === host.bot.threadId);
  return task?.busy ?? host.bot.busy ?? false;
}
