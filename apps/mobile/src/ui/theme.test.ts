import { describe, expect, it, vi } from "vitest";
import { midnight } from "./theme";

vi.mock("react-native", () => ({ useColorScheme: () => "dark" }));

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("midnight contrast", () => {
  it.each([
    ["accentInk on accent", midnight.accentInk, midnight.accent],
    ["accentInk on danger", midnight.accentInk, midnight.danger],
    ["purple on card", midnight.identity.purple, midnight.card],
    ["blue on card", midnight.identity.blue, midnight.card],
  ])("%s clears WCAG AA", (_pair, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
  });
});
