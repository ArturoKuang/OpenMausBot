import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "../testing/fake-fetch";
import { ApiError, createApiClient, isUnpaired, needsAppUpdate } from "./client";

const BASE = "http://100.101.102.103:8810";

const hasOrigin = (headers: Record<string, string>) => Object.keys(headers).some((name) => name.toLowerCase() === "origin");

describe("api client", () => {
  it("sends the device token as a Bearer header and never an Origin", async () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(200, { bots: [], groups: [], sections: [], botQueuedMessages: {}, computerControl: {} }));
    const api = createApiClient({ baseUrl: `${BASE}/`, token: "omb_device", fetch });

    await api.bots("bot-1");
    await api.sendToBot("bot-1", { text: "hi", threadId: "t-1", sendId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" });

    expect(requests.map((request) => request.url)).toEqual([
      `${BASE}/api/bots?messages=40&tail=10&open=bot-1`,
      `${BASE}/api/bots/bot-1/messages`,
    ]);
    for (const request of requests) {
      expect(request.headers.Authorization).toBe("Bearer omb_device");
      expect(hasOrigin(request.headers)).toBe(false);
    }
    expect(requests[1]!.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(requests[1]!.body!)).toEqual({ text: "hi", threadId: "t-1", sendId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" });
  });

  it("pairs without a token or an Origin", async () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(201, { token: "omb_new", device: { id: "d1" }, serverName: "macmini-ci" }));
    await createApiClient({ baseUrl: BASE, token: null, fetch }).pair({ credential: "123456", deviceName: "Pixel", pairRequestId: "r1" });

    const [request] = requests;
    expect(request!.method).toBe("POST");
    expect(request!.url).toBe(`${BASE}/api/pair`);
    expect(request!.headers.Authorization).toBeUndefined();
    expect(hasOrigin(request!.headers)).toBe(false);
    expect(JSON.parse(request!.body!)).toEqual({ credential: "123456", deviceName: "Pixel", pairRequestId: "r1" });
  });

  it("escapes ids in paths", async () => {
    const { fetch, requests } = fakeFetch(() => jsonResponse(200, {}));
    await createApiClient({ baseUrl: BASE, token: "t", fetch }).patchCard("a/b", "m?1", { threadId: "t", answered: "Yes", dismissed: true });
    expect(requests[0]!.url).toBe(`${BASE}/api/bots/a%2Fb/cards/m%3F1`);
  });

  it("turns refusals into ApiError with the server's code", async () => {
    const refusing = (status: number, body: unknown) => createApiClient({ baseUrl: BASE, token: "t", fetch: fakeFetch(() => jsonResponse(status, body)).fetch });

    const wrong = await refusing(401, { error: "wrong code", code: "pairing_code_wrong" }).instances().catch((error: unknown) => error);
    expect(wrong).toBeInstanceOf(ApiError);
    expect(wrong).toMatchObject({ status: 401, code: "pairing_code_wrong", message: "wrong code" });
    expect(isUnpaired(wrong)).toBe(true);

    const update = await refusing(426, { error: "update_app" }).instances().catch((error: unknown) => error);
    expect(update).toMatchObject({ status: 426, code: "update_app" });
    expect(needsAppUpdate(update)).toBe(true);
  });

  it("aborts a health probe that takes too long", async () => {
    const fetch = (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(createApiClient({ baseUrl: BASE, token: null, fetch }).health(10)).rejects.toThrow("aborted");
  });
});
