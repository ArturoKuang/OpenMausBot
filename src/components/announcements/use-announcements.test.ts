// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  state: { config: { onboarding: { hintsSeen: [] as string[] } }, bots: [], routines: [], routinesLoadState: "ready", instances: [] } as Record<string, unknown>,
  dispatch: vi.fn(),
  session: { hosted: false, scopes: ["admin"] } as unknown,
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({})),
  useStore: () => ({ state: f.state, dispatch: f.dispatch }),
}));
vi.mock("@/lib/session", () => ({ readSessionState: async () => f.session }));
vi.mock("@/lib/brand", () => ({ brandStatus: () => ({ brand: { name: "OpenMausBot" }, source: "default", file: "" }) }));

import { useAnnouncements } from "./use-announcements";

let host: HTMLDivElement;
let root: Root | null = null;
let found!: ReturnType<typeof useAnnouncements>;

function Probe() {
  found = useAnnouncements();
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host.remove();
});

describe("useAnnouncements", () => {
  it("returns no promo items and never raises the unread dot", async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(found.items).toEqual([]);
    expect(found.unread).toBe(false);
  });
});
