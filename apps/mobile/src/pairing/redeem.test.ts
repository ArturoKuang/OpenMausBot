import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "../testing/fake-fetch";
import { redeemInvite, UNREACHABLE } from "./redeem";

const PAIRED = {
  token: "omb_device",
  device: { id: "dev-1", name: "Pixel", createdAt: 1, lastSeenAt: 1 },
  serverName: "macmini-ci",
  endpoints: [{ url: "http://macmini.tail1234.ts.net:8810", kind: "tailnet", priority: 100 }],
};

const redeem = (fetch: ReturnType<typeof fakeFetch>["fetch"], candidates: string[], extra: { replacesToken?: string } = {}) =>
  redeemInvite({
    invite: { candidates, credential: "123456", endpoints: [] },
    fetch,
    deviceName: "Pixel",
    serverId: "srv-1",
    pairRequestId: "req-1",
    manual: true,
    ...extra,
  });

describe("redeemInvite", () => {
  it("pairs through the first address that answers its health check", async () => {
    const { fetch, requests } = fakeFetch((request) => {
      if (request.url.startsWith("http://10.0.0.5")) throw new Error("unreachable");
      if (request.url.endsWith("/api/health")) return jsonResponse(200, { app: "openmausbot" });
      return jsonResponse(201, PAIRED);
    });

    const outcome = await redeem(fetch, ["http://10.0.0.5:8810", "http://100.64.0.7:8810"], { replacesToken: "omb_old" });

    expect(outcome).toEqual({
      ok: true,
      token: "omb_device",
      server: {
        id: "srv-1",
        serverName: "macmini-ci",
        deviceId: "dev-1",
        activeUrl: "http://100.64.0.7:8810",
        endpoints: PAIRED.endpoints,
        manualUrl: "http://100.64.0.7:8810",
      },
    });
    const pair = requests.find((request) => request.url.endsWith("/api/pair"))!;
    expect(pair.url).toBe("http://100.64.0.7:8810/api/pair");
    expect(JSON.parse(pair.body!)).toEqual({ credential: "123456", deviceName: "Pixel", pairRequestId: "req-1", replacesToken: "omb_old" });
    expect(requests.every((request) => !Object.keys(request.headers).some((name) => name.toLowerCase() === "origin"))).toBe(true);
  });

  it("says the computer is unreachable before it ever sends the code", async () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(502, { error: "harness stopped" }));
    expect(await redeem(fetch, ["http://100.64.0.7:8810"])).toEqual({ ok: false, problem: UNREACHABLE });
    expect(requests.some((request) => request.url.endsWith("/api/pair"))).toBe(false);
  });

  it("words a wrong code by its refusal code", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/api/health") ? jsonResponse(200, { app: "openmausbot" }) : jsonResponse(401, { error: "no", code: "pairing_code_wrong" }),
    );
    const outcome = await redeem(fetch, ["http://100.64.0.7:8810"]);
    expect(outcome.ok === false && outcome.problem).toMatch(/didn't match/);
  });
});
