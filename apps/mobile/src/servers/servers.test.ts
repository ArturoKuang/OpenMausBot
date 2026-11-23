import { describe, expect, it } from "vitest";
import { dialOrder, replaceServer, routeLabel, type SavedServer } from "./servers";

const server: SavedServer = {
  id: "s1",
  serverName: "macmini-ci",
  deviceId: "d1",
  activeUrl: "http://192.168.1.20:8810",
  endpoints: [
    { url: "http://192.168.1.20:8810", kind: "lan", priority: 200 },
    { url: "https://abc.openmausbot.com", kind: "hosted", priority: 0 },
    { url: "http://macmini.tail1234.ts.net:8810", kind: "tailnet", priority: 100 },
  ],
  manualUrl: "http://100.101.102.103:8810",
};

describe("servers", () => {
  it("tries the last working route, then the companion's by priority, then the typed address", () => {
    expect(dialOrder(server)).toEqual([
      "http://192.168.1.20:8810",
      "https://abc.openmausbot.com",
      "http://macmini.tail1234.ts.net:8810",
      "http://100.101.102.103:8810",
    ]);
  });

  it("names the route a URL travels", () => {
    expect(routeLabel("http://100.101.102.103:8810")).toBe("Tailscale");
    expect(routeLabel("http://macmini.tail1234.ts.net:8810")).toBe("Tailscale");
    expect(routeLabel("http://192.168.1.20:8810")).toBe("Wi-Fi");
    expect(routeLabel("http://100.200.0.1:8810")).toBe("Wi-Fi");
    expect(routeLabel("https://abc.openmausbot.com")).toBe("Cloud");
  });

  it("keeps several computers and replaces one in place when it re-pairs", () => {
    const second = { ...server, id: "s2", serverName: "studio" };
    const list = replaceServer(replaceServer([], server), second);
    expect(list.map((entry) => entry.serverName)).toEqual(["macmini-ci", "studio"]);
    expect(replaceServer(list, { ...server, serverName: "renamed" }).map((entry) => entry.serverName)).toEqual(["renamed", "studio"]);
  });
});
