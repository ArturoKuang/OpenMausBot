import type { OptionCardData } from "@openmausbot/phone-protocol/wire.ts";
import { describe, expect, it } from "vitest";
import { cardChoices, cardReceipt } from "./cards";

const approval: OptionCardData = { title: "Run a command?", subtitle: "pnpm test", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" };

describe("cardChoices", () => {
  it("offers Allow and Deny on a tool approval, and Always allow through the bot's grant when it has a key", () => {
    expect(cardChoices({ ...approval, allowKey: "Bash(pnpm test)" }, false).map((choice) => [choice.label, choice.plan])).toEqual([
      ["Allow", { route: "respond", response: { requestId: "r1", behavior: "allow" } }],
      ["Deny", { route: "respond", response: { requestId: "r1", behavior: "deny" } }],
      ["Always allow", { route: "respond", response: { requestId: "r1", behavior: "allow" }, allowKey: "Bash(pnpm test)" }],
    ]);
  });

  it("remembers for the session through the engine when it can", () => {
    expect(cardChoices({ ...approval, allowSession: true }, false).at(-1)!.plan).toEqual({
      route: "respond",
      response: { requestId: "r1", behavior: "allow", always: true },
    });
  });

  it("answers a live question with the chosen words", () => {
    const question: OptionCardData = { title: "Which one?", subtitle: "", options: ["Red", "Blue"], requestId: "q1" };
    expect(cardChoices(question, true).map((choice) => choice.plan)).toEqual([
      { route: "respond", response: { requestId: "q1", behavior: "answer", message: "Red" } },
      { route: "respond", response: { requestId: "q1", behavior: "answer", message: "Blue" } },
    ]);
  });

  it("sends a static card's choice as the person's line, but not in a room", () => {
    const pick: OptionCardData = { title: "Pick", subtitle: "", options: ["A", "B"] };
    expect(cardChoices(pick, false)[1]!.plan).toEqual({ route: "static", answer: "B" });
    expect(cardChoices(pick, true)).toEqual([]);
  });

  it("offers nothing on a settled card and says how it ended", () => {
    expect(cardChoices({ ...approval, answered: "Allow" }, false)).toEqual([]);
    expect(cardReceipt({ ...approval, answered: "Allow" })).toBe("Allowed");
    expect(cardReceipt({ ...approval, answered: "Deny" })).toBe("Denied");
    expect(cardReceipt({ ...approval, expired: true })).toBe("Expired");
    expect(cardReceipt({ ...approval, stopped: true })).toBe("Stopped");
  });
});
