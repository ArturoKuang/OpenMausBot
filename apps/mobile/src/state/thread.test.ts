import type { ThreadAction, ThreadState } from "./thread";
import { describe, expect, it } from "vitest";
import { message, runtime } from "../testing/fixtures";
import { initialThread, threadReducer, transcriptRows } from "./thread";

const T = "t1";
const run = (actions: ThreadAction[], state: ThreadState = initialThread(T)) => actions.reduce(threadReducer, state);
const loaded = (...ids: string[]): ThreadAction => ({ type: "loaded", page: { messages: ids.map((id) => message(id)), activeLeafId: ids.at(-1) ?? null } });

describe("thread reducer", () => {
  it("streams a reply under its item id and swaps it for the stored message", () => {
    const streaming = run([
      loaded("m1"),
      { type: "frame", frame: runtime(T, { type: "turn.started", turnId: "turn-1" }) },
      { type: "frame", frame: runtime(T, { type: "content.delta", streamKind: "assistant_text", itemId: "i1", delta: "Hel" }) },
      { type: "frame", frame: runtime(T, { type: "content.delta", streamKind: "assistant_text", itemId: "i1", delta: "lo" }) },
    ]);
    expect(streaming.running).toBe(true);
    expect(streaming.turnId).toBe("turn-1");
    expect(transcriptRows(streaming).map((row) => row.key)).toEqual(["m1", "stream:i1"]);
    expect(streaming.streams[0]!.text).toBe("Hello");

    const done = run([{ type: "frame", frame: { kind: "message", threadId: T, message: message("m2", { text: "Hello", itemId: "i1" }) } }], streaming);
    expect(transcriptRows(done).map((row) => row.key)).toEqual(["m1", "m2"]);
  });

  it("drops a half-streamed turn when a replay gap forces a reload", () => {
    const interrupted = run([
      loaded("m1"),
      { type: "frame", frame: runtime(T, { type: "turn.started", turnId: "turn-1" }) },
      { type: "frame", frame: runtime(T, { type: "item.started", itemType: "tool", itemId: "tool-1" }) },
      { type: "frame", frame: runtime(T, { type: "content.delta", streamKind: "assistant_text", itemId: "i1", delta: "Partial" }) },
    ]);
    const resumed = run([{ type: "frame", frame: { kind: "hello", cursor: "s1:9", resumed: true } }], interrupted);
    expect(transcriptRows(resumed).map((row) => row.key)).toEqual(["m1", "stream:i1"]);

    const reloaded = run([{ type: "frame", frame: { kind: "hello", cursor: "s2:0", resumed: false } }, loaded("m1", "m2")], interrupted);
    expect(reloaded).toMatchObject({ running: false, turnId: null, step: null, thinking: false });
    expect(transcriptRows(reloaded).map((row) => row.key)).toEqual(["m1", "m2"]);
  });

  it("ignores frames for other threads", () => {
    const state = run([
      loaded("m1"),
      { type: "frame", frame: { kind: "message", threadId: "other", message: message("x") } },
      { type: "frame", frame: runtime("other", { type: "turn.started" }) },
    ]);
    expect(state.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(state.running).toBe(false);
  });

  it("shows a pending send until the line with its sendId is stored, and keeps it on failure for a retry", () => {
    const send = { sendId: "s-1", text: "ship it", at: 5 };
    const failed = run([loaded("m1"), { type: "sendStarted", send }, { type: "sendFailed", sendId: "s-1" }]);
    expect(failed.pending).toEqual([{ ...send, state: "failed" }]);

    const retried = run([{ type: "sendStarted", send }], failed);
    expect(retried.pending).toEqual([{ ...send, state: "sending" }]);

    const stored = run([{ type: "frame", frame: { kind: "message", threadId: T, message: message("m2", { role: "user", sendId: "s-1" }) } }], retried);
    expect(stored.pending).toEqual([]);
    expect(transcriptRows(stored).map((row) => row.key)).toEqual(["m1", "m2"]);
  });

  it("drops a pending send that a reload already shows", () => {
    const state = run([{ type: "sendStarted", send: { sendId: "s-1", text: "a", at: 1 } }]);
    const reloaded = threadReducer(state, { type: "loaded", page: { messages: [message("m1", { role: "user", sendId: "s-1" })], activeLeafId: "m1" } });
    expect(reloaded.pending).toEqual([]);
  });

  it("tracks the live step and clears it when the turn ends", () => {
    const working = run([
      { type: "frame", frame: runtime(T, { type: "turn.started", turnId: "x" }) },
      { type: "frame", frame: runtime(T, { type: "turn.progress", activity: "command", target: "pnpm test" }) },
    ]);
    expect(working.step).toBe("Running pnpm test…");
    const done = run([{ type: "frame", frame: runtime(T, { type: "turn.completed", ok: true }) }], working);
    expect(done).toMatchObject({ running: false, step: null, turnId: null });
  });

  it("holds a card as answering until its patch settles it", () => {
    const card = { title: "Run a command?", subtitle: "pnpm test", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" };
    const answering = run([
      { type: "loaded", page: { messages: [message("c1", { kind: "options", card })], activeLeafId: "c1" } },
      { type: "answerStarted", messageId: "c1" },
    ]);
    expect(answering.answering).toEqual(["c1"]);

    const patched = run([{ type: "frame", frame: { kind: "message.patch", threadId: T, message: message("c1", { kind: "options", card: { ...card, answered: "Allow" } }) } }], answering);
    expect(patched.answering).toEqual([]);

    const resolved = run([{ type: "frame", frame: runtime(T, { type: "request.resolved", requestId: "r1", behavior: "allow", source: "user" }) }], answering);
    expect(resolved.answering).toEqual([]);
  });

  it("marks the page stale when the branch moves to a leaf it doesn't have", () => {
    const state = run([loaded("m1"), { type: "frame", frame: { kind: "thread", threadId: T, activeLeafId: "m9" } }]);
    expect(state.stale).toBe(true);
    expect(threadReducer(state, loaded("m1", "m9")).stale).toBe(false);
  });

  it("prepends older pages without duplicating", () => {
    const state = run([loaded("m2", "m3"), { type: "olderLoaded", page: { messages: [message("m1"), message("m2")], activeLeafId: "m3", hasMore: false } }]);
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});
