import { describe, expect, it } from "vitest";
import { announcementHistory, BUILT_IN_ANNOUNCEMENTS, type HistoryFacts } from "./announcement-history";

const FACTS: HistoryFacts = {
  branded: false,
  organization: false,
  cloudSale: true,
  cloudCards: true,
  remote: false,
  team: false,
  canSave: true,
  sponsors: true,
  modelgo: true,
};

describe("announcement-history", () => {
  it("has no built-in promotional or sponsor announcements", () => {
    expect(BUILT_IN_ANNOUNCEMENTS).toEqual([]);
    expect(announcementHistory({ facts: FACTS, cards: [], feedUpdatedAt: null, now: Date.UTC(2026, 10, 20) })).toEqual([]);
  });

  it("still lists release notes when provided, and none on a branded build", () => {
    const releases = [{ version: "0.1.177", date: "2026-11-20T00:00:00Z", sections: [{ title: "Fixes", items: ["Fixed a bug."] }] }];
    const items = announcementHistory({ facts: FACTS, cards: [], feedUpdatedAt: null, now: Date.UTC(2026, 10, 21), releases });
    expect(items.map(item => item.id)).toEqual(["release-0.1.177"]);
    expect(announcementHistory({ facts: { ...FACTS, branded: true }, cards: [], feedUpdatedAt: null, now: Date.UTC(2026, 10, 21), releases })).toEqual([]);
  });
});
