import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementStore } from "./feed.ts";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-announcements-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("AnnouncementStore", () => {
  it("is disabled and never downloads remote announcement cards or returns cards", async () => {
    const fetchMock = vi.fn();
    const store = new AnnouncementStore({ dataDir: tempDir(), fetch: fetchMock as unknown as typeof fetch });
    expect(store.disabled).toBe(true);
    expect(store.cards()).toEqual([]);
    expect(await store.cardsForPage()).toEqual([]);
    await store.refresh({ force: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
