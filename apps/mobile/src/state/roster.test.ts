import type { BotsResponse } from "@openmausbot/phone-protocol/wire.ts";
import { describe, expect, it } from "vitest";
import { bot, group, message, runtime, task } from "../testing/fixtures";
import { emptyRoster, homeRows, rosterReducer, type Roster, type RosterAction } from "./roster";

const snapshot = (response: Partial<BotsResponse>): RosterAction => ({
  type: "snapshot",
  response: { bots: [], groups: [], sections: [], botQueuedMessages: {}, computerControl: {}, ...response },
});
const run = (actions: RosterAction[], state: Roster = emptyRoster) => actions.reduce(rosterReducer, state);

describe("roster", () => {
  it("lists group chats and visible bots, newest conversation first, with their last line", () => {
    const state = run([
      snapshot({
        bots: [
          { ...bot("ada"), messages: [message("a1", { text: "old", at: 10 })], activeLeafId: "a1" },
          { ...bot("bob"), messages: [message("b1", { text: "Shipped  the\nfix", at: 20 })], activeLeafId: "b1" },
          { ...bot("ghost", { hidden: true }), messages: [], activeLeafId: null },
        ],
        groups: [
          { ...group("crew", ["ada", "bob"]), messages: [], activeLeafId: null },
          { ...group("dm", ["ada", "bob"], { dm: true }), messages: [], activeLeafId: null },
        ],
      }),
    ]);
    const rows = homeRows(state);
    expect(rows.bots.map((row) => [row.name, row.subtitle])).toEqual([["bob", "Shipped the fix"], ["ada", "old"]]);
    expect(rows.groups.map((row) => [row.name, row.subtitle])).toEqual([["crew", "ada, bob"]]);
  });

  it("shows live progress, typing and waiting on the row", () => {
    const base = run([snapshot({ bots: [{ ...bot("ada"), messages: [], activeLeafId: null }] })]);
    const progress = run([
      { type: "frame", frame: runtime("ada-t1", { type: "turn.started" }) },
      { type: "frame", frame: runtime("ada-t1", { type: "turn.progress", activity: "edit", file: "routes.ts" }) },
    ], base);
    expect(homeRows(progress).bots[0]).toMatchObject({ subtitle: "Editing routes.ts…", tone: "working" });

    const typing = run([{ type: "frame", frame: runtime("ada-t1", { type: "content.delta", streamKind: "assistant_text", delta: "x" }) }], progress);
    expect(homeRows(typing).bots[0]!.subtitle).toBe("Typing…");

    const done = run([{ type: "frame", frame: runtime("ada-t1", { type: "turn.completed", ok: true }) }], typing);
    expect(homeRows(done).bots[0]!.tone).toBe("quiet");

    const waiting = run([{ type: "frame", frame: { kind: "bot", bot: bot("ada", { activity: "waiting-on-you", unread: true }) } }], done);
    expect(homeRows(waiting).bots[0]).toMatchObject({ subtitle: "Waiting for your approval", tone: "waiting", unread: true });
  });

  it("merges a partial bot frame's tasks instead of replacing them", () => {
    const base = run([snapshot({ bots: [{ ...bot("ada", { tasks: [task("t1"), task("t2")] }), messages: [], activeLeafId: null }] })]);
    const merged = run([{ type: "frame", frame: { kind: "bot", bot: bot("ada", { tasks: [task("t2", { title: "renamed" })] }), tasksPartial: true } }], base);
    expect(merged.bots.ada!.tasks!.map((t) => [t.threadId, t.title])).toEqual([["t1", "t1"], ["t2", "renamed"]]);

    const replaced = run([{ type: "frame", frame: { kind: "bot", bot: bot("ada", { tasks: [task("t3")] }) } }], base);
    expect(replaced.bots.ada!.tasks!.map((t) => t.threadId)).toEqual(["t3"]);
  });

  it("follows deletes, order and new lines from the stream", () => {
    const base = run([snapshot({ bots: [{ ...bot("ada"), messages: [], activeLeafId: null }, { ...bot("bob"), messages: [], activeLeafId: null }] })]);
    const state = run([
      { type: "frame", frame: { kind: "message", threadId: "ada-t1", message: message("n1", { text: "new", at: 99 }) } },
      { type: "frame", frame: { kind: "bots.order", botIds: ["bob", "ada"] } },
      { type: "frame", frame: { kind: "bot.deleted", botId: "bob" } },
    ], base);
    expect(state.botOrder).toEqual(["ada"]);
    expect(homeRows(state).bots[0]).toMatchObject({ subtitle: "new", at: 99 });
  });
});
