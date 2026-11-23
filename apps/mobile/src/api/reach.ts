/** Probes every candidate at once and returns the first in list order that answered, or null when none did. */
export async function pickReachable(candidates: readonly string[], probe: (baseUrl: string) => Promise<unknown>): Promise<string | null> {
  const results = await Promise.allSettled(candidates.map((candidate) => probe(candidate)));
  const index = results.findIndex((result) => result.status === "fulfilled");
  return index === -1 ? null : candidates[index]!;
}
