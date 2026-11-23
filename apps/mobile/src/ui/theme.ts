import { useColorScheme } from "react-native";
import { isMausColor, type MausColor } from "@openmausbot/phone-protocol/wire.ts";

export interface Palette {
  scheme: "dark" | "light";
  app: string;
  panel: string;
  card: string;
  control: string;
  composer: string;
  hairline: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  bubbleUser: string;
  bubbleUserInk: string;
  accent: string;
  accentInk: string;
  success: string;
  warning: string;
  danger: string;
  backdrop: string;
  identity: Record<MausColor, string>;
}

/** The phone ramp and identity colours from src/styles.css. */
export const midnight: Palette = {
  scheme: "dark",
  app: "#141414",
  panel: "#1c1c1e",
  card: "#242426",
  control: "#2c2c2e",
  composer: "#2c2c2e",
  hairline: "#3a3a3c",
  ink: "#f5f5f5",
  inkSecondary: "#f5f5f5a8",
  inkTertiary: "#f5f5f591",
  bubbleUser: "#5a5a5a",
  bubbleUserInk: "#f5f5f5",
  accent: "#1084fe",
  accentInk: "#ffffff",
  success: "#38d591",
  warning: "#ff9800",
  danger: "#ff5667",
  backdrop: "#00000099",
  identity: {
    green: "#009957", blue: "#377fe6", red: "#d94b52", orange: "#e78531", purple: "#8d69ce", cyan: "#0ea5c6",
    pink: "#d84f8b", yellow: "#d8a729", teal: "#01a492", coral: "#e5634e", silver: "#a8adb4", chrome: "#b3bac4",
  },
};

export const daylight: Palette = {
  scheme: "light",
  app: "#fcfcfc",
  panel: "#f5f5f5",
  card: "#efefef",
  control: "#e3e3e3",
  composer: "#ffffff",
  hairline: "#1c1c1c3d",
  ink: "#1c1c1c",
  inkSecondary: "#1c1c1cad",
  inkTertiary: "#1c1c1ca6",
  bubbleUser: "#1c1c1c",
  bubbleUserInk: "#fcfcfc",
  accent: "#126fd4",
  accentInk: "#ffffff",
  success: "#007a44",
  warning: "#9c5b00",
  danger: "#cd2834",
  backdrop: "#00000066",
  identity: {
    green: "#007f48", blue: "#1b6adc", red: "#d12c34", orange: "#a95914", purple: "#8057c8", cyan: "#0a7891",
    pink: "#ca2d72", yellow: "#896a19", teal: "#017c6f", coral: "#cd361e", silver: "#686f79", chrome: "#646f80",
  },
};

export const usePalette = (): Palette => (useColorScheme() === "light" ? daylight : midnight);

export const radius = { pill: 9999, control: 12, card: 18, bubble: 18, composer: 22 } as const;

export const font = {
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  header: { fontSize: 17, fontWeight: "600" },
  chat: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  name: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  speaker: { fontSize: 13, fontWeight: "600" },
  meta: { fontSize: 12, lineHeight: 16, fontWeight: "500", fontVariant: ["tabular-nums"] },
  body: { fontSize: 16 },
} as const;

/** A bot's identity colour; a message's `from.color` may already be a literal. */
export function identityColor(color: string | undefined, palette: Palette): string {
  if (!color) return palette.inkTertiary;
  if (color.startsWith("#")) return color;
  return isMausColor(color) ? palette.identity[color] : palette.accent;
}
