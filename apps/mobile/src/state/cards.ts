import type { OptionCardData } from "@openmausbot/phone-protocol/wire.ts";
import type { CardResponse } from "../api/client";
import { cardSettled } from "./thread";

/** How one button answers its card: a live request through `/respond` (remembering `allowKey` first when set), or a
 * static card stored as answered and sent on as the person's own line. */
export type AnswerPlan =
  | { route: "respond"; response: CardResponse; allowKey?: string }
  | { route: "static"; answer: string };

export interface CardChoice {
  label: string;
  emphasis: "primary" | "secondary";
  plan: AnswerPlan;
}

export function cardChoices(card: OptionCardData, inRoom: boolean): CardChoice[] {
  if (cardSettled(card)) return [];
  const { requestId } = card;
  if (!requestId) {
    return inRoom ? [] : card.options.map((option, index) => ({ label: option, emphasis: index === 0 ? "primary" : "secondary", plan: { route: "static", answer: option } }));
  }
  if (!card.tool) {
    return card.options.map((option, index) => ({
      label: option,
      emphasis: index === 0 ? "primary" : "secondary",
      plan: { route: "respond", response: { requestId, behavior: "answer", message: option } },
    }));
  }
  const choices: CardChoice[] = [
    { label: "Allow", emphasis: "primary", plan: { route: "respond", response: { requestId, behavior: "allow" } } },
    { label: "Deny", emphasis: "secondary", plan: { route: "respond", response: { requestId, behavior: "deny" } } },
  ];
  if (card.allowKey) {
    choices.push({ label: "Always allow", emphasis: "secondary", plan: { route: "respond", response: { requestId, behavior: "allow" }, allowKey: card.allowKey } });
  } else if (card.allowSession) {
    choices.push({ label: "Always allow", emphasis: "secondary", plan: { route: "respond", response: { requestId, behavior: "allow", always: true } } });
  }
  return choices;
}

/** The one-line receipt a settled card collapses to. */
export function cardReceipt(card: OptionCardData): string {
  if (card.expired) return "Expired";
  if (card.stopped) return "Stopped";
  if (card.autoApplied) return card.undone ? "Undone" : "Applied";
  if (card.answered === "Deny") return "Denied";
  if (card.answered === "Allow" || card.answered?.startsWith("Always allow")) return "Allowed";
  return card.answeredText || card.answered || (card.dismissed ? "Dismissed" : "");
}
