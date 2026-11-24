import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnection } from "../../session/connection-context";
import { homeRows, type RosterRow } from "../../state/roster";
import { Avatar, Dot, IconButton, OfflineBar, PillButton, Sheet, SheetRow } from "../../ui/primitives";
import { font, radius, usePalette } from "../../ui/theme";
import { shortTime } from "../../ui/time";
import type { ChatTarget } from "../chat/target";
import { NewBotSheet, NewGroupSheet } from "./NewSheets";
import { ServerSheet, statusColor } from "./ServerSheet";

type OpenSheet = "servers" | "new" | "newBot" | "newGroup" | null;

function Row({ row, onPress }: { row: RosterRow; onPress(): void }) {
  const palette = usePalette();
  const subtitleColor = row.tone === "waiting" ? palette.warning : row.tone === "working" ? palette.inkSecondary : palette.inkTertiary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}${row.unread ? ", unread" : ""}. ${row.subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.card : "transparent" }]}
    >
      <Avatar name={row.name} colors={row.colors} />
      <View style={styles.rowText}>
        <Text style={[font.name, { color: palette.ink }]} numberOfLines={1}>{row.name}</Text>
        <Text style={[font.meta, { color: subtitleColor }]} numberOfLines={1}>{row.subtitle}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text style={[font.meta, { color: palette.inkTertiary }]}>{shortTime(row.at)}</Text>
        {row.unread ? <Dot color={palette.accent} /> : <View style={{ height: 8 }} />}
      </View>
    </Pressable>
  );
}

export function HomeScreen({ onOpen, onConnectAnother, onRepair }: {
  onOpen(target: ChatTarget): void;
  onConnectAnother(): void;
  onRepair(): void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { server, roster, status, reconnect } = useConnection();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const rows = useMemo(() => homeRows(roster), [roster]);
  const sections = [
    { title: "Group chats", data: rows.groups },
    { title: "Bots", data: rows.bots },
  ].filter((section) => section.data.length > 0);

  const opened = (target: ChatTarget) => {
    setSheet(null);
    onOpen(target);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.app, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${server.serverName}, switch computer`}
          onPress={() => setSheet("servers")}
          style={[styles.serverPill, { backgroundColor: palette.card }]}
        >
          <Dot color={statusColor(status, palette)} />
          <Text style={[font.name, { color: palette.ink, maxWidth: 200 }]} numberOfLines={1}>{server.serverName}</Text>
          <Text style={{ color: palette.inkTertiary, fontSize: 12 }}>▾</Text>
        </Pressable>
        <IconButton label="New" glyph="+" onPress={() => setSheet("new")} />
      </View>

      {status === "reconnecting" ? <OfflineBar onRetry={reconnect} /> : null}
      {server.needsPairing || status === "unpaired" ? (
        <View style={[styles.notice, { backgroundColor: palette.card }]}>
          <Text style={[font.chat, { color: palette.ink }]}>This phone was removed from {server.serverName}.</Text>
          <PillButton label="Pair again" emphasis="primary" onPress={onRepair} />
        </View>
      ) : null}
      {status === "update_app" ? (
        <View style={[styles.notice, { backgroundColor: palette.card }]}>
          <Text style={[font.chat, { color: palette.ink }]}>{server.serverName} now needs an encrypted connection. Update the app to keep chatting.</Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(row) => `${row.kind}:${row.id}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        renderSectionHeader={({ section }) => (
          <Text style={[font.meta, styles.sectionTitle, { color: palette.inkTertiary }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => <Row row={item} onPress={() => onOpen({ kind: item.kind, id: item.id })} />}
        ListEmptyComponent={
          status === "live" ? (
            <View style={styles.empty}>
              <Text style={[font.chat, { color: palette.inkSecondary }]}>No bots yet</Text>
              <PillButton label="New bot" emphasis="primary" onPress={() => setSheet("newBot")} />
            </View>
          ) : undefined
        }
      />

      <ServerSheet visible={sheet === "servers"} status={status} onClose={() => setSheet(null)} onConnectAnother={() => {
        setSheet(null);
        onConnectAnother();
      }} />
      <Sheet visible={sheet === "new"} title="New" onClose={() => setSheet(null)}>
        <SheetRow label="New bot" onPress={() => setSheet("newBot")} />
        <SheetRow label="New group" onPress={() => setSheet("newGroup")} />
      </Sheet>
      <NewBotSheet visible={sheet === "newBot"} onClose={() => setSheet(null)} onCreated={opened} />
      <NewGroupSheet visible={sheet === "newGroup"} onClose={() => setSheet(null)} onCreated={opened} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 6 },
  serverPill: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill },
  sectionTitle: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  row: { height: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  rowText: { flex: 1, gap: 2 },
  rowTrailing: { alignItems: "flex-end", gap: 6 },
  notice: { marginHorizontal: 16, marginTop: 8, padding: 16, gap: 12, borderRadius: radius.card },
  empty: { alignItems: "center", gap: 16, paddingTop: 96 },
});
