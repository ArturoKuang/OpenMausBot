import { describe, expect, it } from "vitest";
import { insertMention, mentionedIds, mentionMatches, mentionQuery } from "./mentions";

const ada = { id: "b-ada", name: "Ada" };
const adam = { id: "b-adam", name: "Adam" };
const bob = { id: "b-bob", name: "Bob" };

describe("mentions", () => {
  it("finds the @word being typed at the end of the draft", () => {
    expect(mentionQuery("hey @ad")).toBe("ad");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("mail me@home")).toBeNull();
    expect(mentionQuery("hey @ada and")).toBeNull();
  });

  it("matches members by name prefix and inserts the whole name", () => {
    expect(mentionMatches([ada, adam, bob], "AD")).toEqual([ada, adam]);
    expect(insertMention("ask @ad", adam)).toBe("ask @Adam ");
  });

  it("sends only the picks still named in the text", () => {
    expect(mentionedIds("@Adam please check", [adam, bob, adam])).toEqual(["b-adam"]);
    expect(mentionedIds("never mind", [adam])).toEqual([]);
    expect(mentionedIds("@Adam, then (@Bob)", [ada, adam, bob])).toEqual(["b-adam", "b-bob"]);
    expect(mentionedIds("see /@Bob", [bob])).toEqual([]);
  });
});
