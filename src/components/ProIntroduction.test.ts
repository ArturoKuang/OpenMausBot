import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: vi.fn() }) }));

import { CloudPlanFootnote, ProCompareRow, proOfferAvailable } from "./ProIntroduction";

describe("ProIntroduction", () => {
  it("never offers paid Cloud upsells, compare rows, or footnotes", () => {
    vi.stubGlobal("window", {});
    expect(proOfferAvailable(null)).toBe(false);
    expect(proOfferAvailable({ status: "signed-out" })).toBe(false);
    expect(proOfferAvailable({ status: "connected", account: { id: "a", email: "a@b.test" }, entitlement: { plan: "free", status: "inactive", expiresAt: null, version: 1 } })).toBe(false);
    expect(renderToStaticMarkup(createElement(ProCompareRow))).toBe("");
    expect(renderToStaticMarkup(createElement(CloudPlanFootnote))).toBe("");
  });
});
