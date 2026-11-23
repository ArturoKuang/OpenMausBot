import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnection } from "../../session/connection-context";
import { transcriptRows, type TranscriptRow } from "../../state/thread";
import { Avatar, IconButton, OfflineBar } from "../../ui/primitives";
import { font, radius, usePalette } from "../../ui/theme";
import { Composer, type ComposerHandle } from "./Composer";
import { ModelSheet } from "./ModelSheet";
import { ActivityPill, Bubble, LiveLine, OptionsCard, PendingBubble, StreamingBubble } from "./rows";
import { hostBusy, hostThreadId, resolveHost, type ChatHost, type ChatTarget } from "./target";
import { useThread } from "./useThread";

export function ChatScreen({ target, onBack }: { target: ChatTarget; onBack(): void }) {
  const { roster } = useConnection();
  const host = resolveHost(roster, target);
  useEffect(() => {
    if (!host) onBack();
  }, [host, onBack]);
  if (!host) return null;
  const threadId = hostThreadId(host);
  return <Thread key={threadId} host={host} threadId={threadId} onBack={onBack} />;
}

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}

function Thread({ host, threadId, onBack }: { host: ChatHost; threadId: string; onBack(): void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { roster, status, reconnect } = useConnection();
  const { state, problem, send, retry, interrupt, answer, loadOlder } = useThread(host, threadId);
  const [modelOpen, setModelOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const keyboardOpen = useKeyboardOpen();
  const inRoom = host.kind === "group";
  const running = state.running || hostBusy(host);
  const name = host.kind === "bot" ? host.bot.name : host.group.name;

  const members = useMemo(
    () =>
      host.kind === "group"
        ? host.group.memberIds.flatMap((id) => {
            const bot = roster.bots[id];
            return bot ? [{ id, name: bot.name, color: bot.color }] : [];
          })
        : [],
    [host, roster.bots],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (composer.current?.closeMentions()) return true;
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const speakerFor = (botId: string | undefined) => {
    if (!inRoom || !botId) return undefined;
    const bot = roster.bots[botId];
    return bot ? { name: bot.name, color: bot.color } : undefined;
  };

  const renderMessage = (message: WireMessage) => {
    if (message.kind === "activity") return <ActivityPill message={message} threadId={threadId} />;
    if (message.kind === "options" && message.card) {
      return <OptionsCard message={message} inRoom={inRoom} answering={state.answering.includes(message.id)} onAnswer={(choice) => void answer(message, choice)} />;
    }
    const mine = message.role === "user";
    const speaker = !mine && inRoom && message.from ? { name: message.from.name, color: message.from.color } : undefined;
    const text = message.text?.trim() || (message.kind === "text" ? "" : "Open this on your computer to see it.");
    if (!text) return null;
    return <Bubble text={text} mine={mine} {...(speaker ? { speaker } : {})} />;
  };

  const renderRow = ({ item }: { item: TranscriptRow }) => {
    if (item.kind === "message") return renderMessage(item.message);
    if (item.kind === "stream") {
      const speaker = speakerFor(item.stream.botId);
      return <StreamingBubble stream={item.stream} {...(speaker ? { speaker } : {})} />;
    }
    return <PendingBubble send={item.send} onRetry={() => void retry(item.send)} />;
  };

  const rows = useMemo(() => transcriptRows(state).reverse(), [state]);
  const live = state.thinking ? "Thinking…" : state.step ?? (running && state.streams.length === 0 ? "Working…" : null);
  const model = host.kind === "bot" ? host.bot.modelSelection.model : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.app }}>
      <View style={[styles.header, { paddingTop: insets.top, height: 56 + insets.top }]}>
        <IconButton label="Back" glyph="‹" onPress={onBack} />
        <Avatar name={name} colors={host.kind === "bot" ? [host.bot.color] : members.slice(0, 2).map((member) => member.color)} size={32} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.header, { color: palette.ink }]} numberOfLines={1}>{name}</Text>
          {model ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Model ${model}${running ? ", busy" : ""}`}
              disabled={running}
              onPress={() => setModelOpen(true)}
              hitSlop={8}
              style={[styles.modelChip, { backgroundColor: palette.control, opacity: running ? 0.5 : 1 }]}
            >
              <Text style={[font.meta, { color: palette.inkSecondary }]} numberOfLines={1}>{model} ▾</Text>
            </Pressable>
          ) : (
            <Text style={[font.meta, { color: palette.inkTertiary }]} numberOfLines={1}>{members.map((member) => member.name).join(", ")}</Text>
          )}
        </View>
      </View>
      {status === "reconnecting" ? <OfflineBar onRetry={reconnect} /> : null}

      <FlatList
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onEndReached={() => void loadOlder()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingVertical: 8 }}
        ListHeaderComponent={live ? <LiveLine label={live} /> : undefined}
        ListEmptyComponent={
          state.loaded && !live ? (
            <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
              <Text style={[font.chat, { color: palette.inkTertiary }]}>Say hello to {name}</Text>
            </View>
          ) : undefined
        }
      />

      {problem ? <Text style={[font.meta, styles.problem, { color: palette.danger }]}>{problem}</Text> : null}
      <Composer
        ref={composer}
        members={members}
        running={running}
        bottomInset={keyboardOpen ? 8 : insets.bottom + 8}
        onSend={(text, mentions) => void send(text, mentions)}
        onStop={() => void interrupt()}
      />
      {host.kind === "bot" ? <ModelSheet bot={host.bot} visible={modelOpen} onClose={() => setModelOpen(false)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 16 },
  modelChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, maxWidth: 220 },
  empty: { alignItems: "center", paddingTop: 96 },
  problem: { paddingHorizontal: 16, paddingTop: 4 },
});
