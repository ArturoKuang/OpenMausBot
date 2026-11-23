import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useConnection } from "../../session/connection-context";
import { cardChoices, cardReceipt, type CardChoice } from "../../state/cards";
import type { PendingSend, StreamingReply } from "../../state/thread";
import { PillButton } from "../../ui/primitives";
import { font, identityColor, radius, usePalette } from "../../ui/theme";

function Speaker({ name, color }: { name: string; color: string | undefined }) {
  const palette = usePalette();
  return <Text style={[font.speaker, { color: identityColor(color, palette), marginBottom: 2 }]}>{name}</Text>;
}

export function Bubble({ text, mine, speaker, faded, footnote }: {
  text: string;
  mine: boolean;
  speaker?: { name: string; color?: string };
  faded?: boolean;
  footnote?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
      <View style={{ maxWidth: "82%", alignItems: mine ? "flex-end" : "flex-start" }}>
        {speaker ? <Speaker name={speaker.name} color={speaker.color} /> : null}
        <View style={[styles.bubble, { backgroundColor: mine ? palette.bubbleUser : palette.card, opacity: faded ? 0.6 : 1 }]}>
          <Text selectable style={[font.chat, { color: mine ? palette.bubbleUserInk : palette.ink }]}>{text}</Text>
        </View>
        {footnote}
      </View>
    </View>
  );
}

/** A tool call: one collapsed line; tapping it shows what the call printed, fetched when the stored copy was clipped. */
export function ActivityPill({ message, threadId }: { message: WireMessage; threadId: string }) {
  const palette = usePalette();
  const { api } = useConnection();
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string | null>(message.tool?.output ?? null);
  const [loading, setLoading] = useState(false);
  const tool = message.tool;
  const label = tool?.label || tool?.summary || tool?.name || message.text || "Step";
  const failed = tool?.ok === false;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && tool?.clipped && api && !loading) {
      setLoading(true);
      try {
        setOutput((await api.toolOutput(threadId, message.id)).output);
      } catch {
        setOutput(output ?? "Couldn't load the output.");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <View style={styles.pillRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={[styles.pill, { backgroundColor: palette.control, borderColor: palette.hairline }]}
      >
        <Text style={[styles.pillText, { color: failed ? palette.danger : palette.inkSecondary }]} numberOfLines={1}>{label}</Text>
        <Text style={{ color: palette.inkTertiary, fontSize: 12 }}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View style={[styles.output, { backgroundColor: palette.card, borderColor: palette.hairline }]}>
          {loading ? <ActivityIndicator color={palette.inkTertiary} /> : null}
          <ScrollView horizontal>
            <Text selectable style={[styles.mono, { color: palette.inkSecondary }]}>{output || tool?.input || "No output"}</Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function OptionsCard({ message, inRoom, answering, onAnswer }: {
  message: WireMessage;
  inRoom: boolean;
  answering: boolean;
  onAnswer(choice: CardChoice): void;
}) {
  const palette = usePalette();
  const card = message.card!;
  const choices = cardChoices(card, inRoom);
  const receipt = cardReceipt(card);
  if (choices.length === 0) {
    return (
      <View style={styles.pillRow}>
        <Text style={[font.meta, { color: palette.inkTertiary }]} numberOfLines={1}>
          {card.title}{receipt ? ` · ${receipt}` : ""}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.hairline }]}>
      <Text style={[font.name, { color: palette.ink }]}>{card.title}</Text>
      {card.subtitle ? <Text selectable style={[font.chat, { color: palette.inkSecondary }]}>{card.subtitle}</Text> : null}
      <View style={styles.choices}>
        {answering ? (
          <PillButton label="Answering…" disabled onPress={() => undefined} />
        ) : (
          choices.map((choice) => (
            <PillButton key={choice.label} label={choice.label} emphasis={choice.emphasis} onPress={() => onAnswer(choice)} />
          ))
        )}
      </View>
    </View>
  );
}

export function StreamingBubble({ stream, speaker }: { stream: StreamingReply; speaker?: { name: string; color?: string } }) {
  return <Bubble text={stream.text} mine={false} {...(speaker ? { speaker } : {})} />;
}

export function PendingBubble({ send, onRetry }: { send: PendingSend; onRetry(): void }) {
  const palette = usePalette();
  const note =
    send.state === "failed" ? (
      <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={10}>
        <Text style={[font.meta, { color: palette.danger, marginTop: 4 }]}>Not sent · Retry</Text>
      </Pressable>
    ) : (
      <Text style={[font.meta, { color: palette.inkTertiary, marginTop: 4 }]}>{send.state === "queued" ? "Queued" : "Sending…"}</Text>
    );
  return <Bubble text={send.text} mine faded={send.state !== "failed"} footnote={note} />;
}

export function LiveLine({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.pillRow, { flexDirection: "row", alignItems: "center", gap: 8 }]} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={palette.inkTertiary} />
      <Text style={[font.meta, { color: palette.inkSecondary }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 3 },
  bubble: { borderRadius: radius.bubble, paddingHorizontal: 14, paddingVertical: 9 },
  pillRow: { paddingHorizontal: 16, paddingVertical: 4, alignItems: "flex-start" },
  pill: {
    minHeight: 32,
    maxWidth: "90%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 13, flexShrink: 1 },
  output: { marginTop: 6, alignSelf: "stretch", maxHeight: 240, padding: 10, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth },
  mono: { fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  card: { marginHorizontal: 16, marginVertical: 6, padding: 16, gap: 8, borderRadius: radius.card, borderWidth: 1 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
