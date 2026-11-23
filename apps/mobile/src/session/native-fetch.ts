import { fetch as expoFetch } from "expo/fetch";
import type { FetchLike } from "../api/client";

/** `expo/fetch` streams response bodies on Android, which `GET /api/events` needs; React Native's own fetch buffers. */
export const nativeFetch: FetchLike = async (url, init) => {
  const response = await expoFetch(url, init);
  return { status: response.status, ok: response.ok, text: () => response.text(), body: response.body };
};
