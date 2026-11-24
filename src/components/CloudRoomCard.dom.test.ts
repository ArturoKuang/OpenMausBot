// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloudRoomCard } from "./CloudRoomCard";

describe("the room card", () => {
  it("is disabled and renders nothing (no sidebar Cloud upsell)", () => {
    expect(renderToStaticMarkup(createElement(CloudRoomCard))).toBe("");
  });
});
