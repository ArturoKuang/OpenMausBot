import type { LiveStep, TurnProgressActivity } from "@openmausbot/phone-protocol/turn-progress.ts";

const VERB: Record<TurnProgressActivity, string> = {
  write: "Writing",
  edit: "Editing",
  command: "Running",
  web: "Searching",
  read: "Reading",
  fetch: "Reading",
  search: "Searching",
  tool: "Using",
};

const FALLBACK: Record<TurnProgressActivity, string> = {
  write: "Writing a file…",
  edit: "Editing a file…",
  command: "Running a command…",
  web: "Searching the web…",
  read: "Reading a file…",
  fetch: "Reading a page…",
  search: "Searching files…",
  tool: "Working…",
};

/** One status-line phrase for what a turn is doing now: "Running pnpm test…", "Editing routes.ts…". */
export function progressLabel(step: { activity: TurnProgressActivity; target?: string; file?: string; tool?: string }): string {
  const subject = step.target || step.file || (step.activity === "tool" ? step.tool : undefined);
  return subject ? `${VERB[step.activity]} ${subject}…` : FALLBACK[step.activity];
}

/** The phrase an `item.started` tool call shows before any progress report. */
export function startedLabel(event: { step?: LiveStep; title?: string; summary?: string }): string {
  if (event.step) return progressLabel(event.step);
  const subject = event.summary || event.title;
  return subject ? `${subject}…` : "Working…";
}
