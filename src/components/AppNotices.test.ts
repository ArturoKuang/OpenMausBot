// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  state: {
    bots: [{ id: "b1", name: "Bot", tasks: [{ id: "t1", createdAt: 1, usage: { turns: 2 } }] }],
    groups: [],
    routines: [],
    routinesLoadState: "ready",
    instances: [{ instanceId: "claude", snapshot: { state: "available", authenticated: true } }],
    config: { onboarding: { hintsSeen: [] as string[] } },
    connected: true,
    activeView: "chat",
    appSettingsOpen: false,
    pluginsOpen: false,
    shortcutsOpen: false,
    cloudAdd: null,
    cloudHowTo: false,
    liveCall: null,
  } as Record<string, unknown>,
  dispatch: vi.fn(),
  twoSuggest: null as { key: string; name: string; kind: "server" | "cloud" } | null,
  twoAccept: vi.fn(async () => {}),
  twoDismiss: vi.fn(),
  linkPhones: [] as Array<{ id: string; name: string }>,
  simplePromptSeen: true,
  newLookDue: false,
  advancedBackDue: false,
  advancedMode: false,
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({})),
  useStore: () => ({ state: f.state, dispatch: f.dispatch }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), emailGateDone: () => true }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => null }));
vi.mock("@/lib/two-places", () => ({ useTwoPlaces: () => ({ suggest: f.twoSuggest, accept: f.twoAccept, dismiss: f.twoDismiss }) }));
vi.mock("@/lib/simple-mode-prompt", () => ({ useSimpleModePromptSeen: () => f.simplePromptSeen }));
vi.mock("@/lib/new-look", () => ({ useNewLookDue: () => f.newLookDue, useAdvancedBackDue: () => f.advancedBackDue }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => f.advancedMode }));
vi.mock("@/lib/onboarding", async (orig) => ({ ...(await orig<typeof import("@/lib/onboarding")>()), welcomeFinishedThisLaunch: () => false, welcomeDue: () => false }));
vi.mock("@/lib/launch-dialogs", () => ({ launchDialogShown: () => null, markLaunchDialog: vi.fn() }));
vi.mock("./MausBotWelcome", () => ({ useMausBotWelcomeDue: () => ({ due: false }) }));
vi.mock("./PhoneUpdateNotice", () => ({
  useRetiredLinkPhones: () => f.linkPhones,
  phonesToTell: (phones: Array<{ id: string; name: string }>) => phones,
  PhoneUpdateCard: ({ phones }: { phones: Array<{ name: string }> }) => createElement("div", { "data-phone-update": phones[0]?.name ?? "" }),
}));
vi.mock("./TwoPlacesCard", () => ({
  TwoPlacesCard: ({ suggest }: { suggest: { name: string } }) => createElement("div", { "data-two-places": suggest.name }),
}));
vi.mock("./SimpleModePrompt", () => ({
  SimpleModePrompt: () => createElement("div", { "data-simple-prompt": "" }),
  reportSimpleModePrompt: vi.fn(),
}));
vi.mock("./NewLookNotice", () => ({
  NewLookNotice: () => createElement("div", { "data-new-look": "" }),
  reportNewLook: vi.fn(),
}));
vi.mock("./onboarding/WelcomeGate", () => ({ localDesktopPage: () => true }));
vi.mock("./notice-dialogs", () => ({ useOtherDialogOpen: () => false }));

import { AppNotices } from "./AppNotices";

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  sessionStorage.clear();
  localStorage.clear();
  f.twoSuggest = null;
  f.linkPhones = [];
  f.simplePromptSeen = true;
  f.newLookDue = false;
  f.advancedBackDue = false;
  f.advancedMode = false;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host.remove();
});

async function renderNotices() {
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppNotices, { viewer: { hosted: false, canSave: true } }));
  });
}

describe("AppNotices (upsells and ads removed)", () => {
  it("never renders Teams, Cloud trial, What's new, Boat, ModelGo, Product Hunt, Star, Updates consent, Grok move, or remote announcement popups", async () => {
    await renderNotices();
    expect(host.innerHTML).toBe("");
  });

  it("still renders functional notices like PhoneUpdateCard and TwoPlacesCard", async () => {
    f.linkPhones = [{ id: "p1", name: "Pixel" }];
    await renderNotices();
    expect(host.querySelector('[data-phone-update="Pixel"]')).not.toBeNull();

    await act(async () => root?.unmount());
    root = null;
    sessionStorage.clear();
    f.linkPhones = [];
    f.twoSuggest = { key: "server:1", name: "Garage", kind: "server" };
    await renderNotices();
    expect(host.querySelector('[data-two-places="Garage"]')).not.toBeNull();
  });
});
