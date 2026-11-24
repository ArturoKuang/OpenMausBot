import type { FetchLike, RequestInitLike, ResponseLike } from "../api/client";

export interface RecordedRequest extends RequestInitLike {
  url: string;
}

export type Route = (request: RecordedRequest) => ResponseLike | Promise<ResponseLike>;

export function jsonResponse(status: number, body: unknown): ResponseLike {
  const text = body === undefined ? "" : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, body: null };
}

/** A fetch that records every request and answers from `route`. */
export function fakeFetch(route: Route): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const request = { url, ...init };
    requests.push(request);
    return route(request);
  };
  return { fetch, requests };
}

/** A streaming body the test pushes SSE text into, chunk by chunk. */
export function controlledStream(): { body: ReadableStream<Uint8Array>; push(text: string): void; end(): void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const encoder = new TextEncoder();
  return {
    body,
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}
