import { describe, expect, it } from "vitest";
import type { AnnouncementCard } from "../../shared/announcements";
import { cardsForPerson, pickAnnouncement, type PickContext } from "./announcements";

const CARD: AnnouncementCard = {
  id: "promo-1",
  kind: "sponsor",
  ends: "2099-01-01T00:00:00Z",
  title: { en: "Sponsor" },
  body: { en: "Buy now" },
  primary: { label: { en: "Open" }, action: { open_url: "https://example.test" } },
  audience: {},
};

const CTX: PickContext = {
  facts: {
    nowMs: Date.UTC(2026, 10, 15),
    version: "0.1.177",
    platform: "mac",
    surface: "desktop",
    plan: "none",
    people: "existing",
    locale: "en",
    conditions: { no_api_key: false, one_bot_only: false, no_routine: false },
  },
  seen: { record: undefined, desktop: [], team: false },
  branded: false,
  sponsors: true,
  admin: true,
};

describe("announcements", () => {
  it("never picks or lists remote promo or sponsor announcement cards", () => {
    expect(pickAnnouncement([CARD], CTX)).toBeNull();
    expect(cardsForPerson([CARD], CTX)).toEqual([]);
  });
});
