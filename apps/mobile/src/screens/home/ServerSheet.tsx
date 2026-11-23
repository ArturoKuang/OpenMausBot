import { Alert, Text, View } from "react-native";
import type { StreamStatus } from "../../api/sse";
import { routeLabel } from "../../servers/servers";
import { useServers } from "../../session/servers-context";
import { Dot, Sheet, SheetRow } from "../../ui/primitives";
import { font, usePalette, type Palette } from "../../ui/theme";

export function statusColor(status: StreamStatus, palette: Palette): string {
  if (status === "live") return palette.success;
  if (status === "connecting" || status === "reconnecting") return palette.warning;
  return palette.inkTertiary;
}

export function ServerSheet({ visible, status, onClose, onConnectAnother }: {
  visible: boolean;
  status: StreamStatus;
  onClose(): void;
  onConnectAnother(): void;
}) {
  const palette = usePalette();
  const { servers, activeId, switchTo, forget } = useServers();

  const confirmForget = (id: string, name: string) =>
    Alert.alert(`Forget ${name}?`, "This phone stops connecting to it. You can pair again later.", [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => void forget(id) },
    ]);

  return (
    <Sheet visible={visible} title="Computers" onClose={onClose}>
      <View>
        {servers.map((server) => {
          const active = server.id === activeId;
          return (
            <SheetRow
              key={server.id}
              label={server.serverName}
              detail={server.needsPairing ? "Needs pairing" : routeLabel(server.activeUrl)}
              leading={<Dot color={active ? statusColor(status, palette) : palette.inkTertiary} />}
              trailing={active ? <Text style={[font.meta, { color: palette.accent }]}>Current</Text> : undefined}
              onPress={() => {
                if (!active) switchTo(server.id);
                onClose();
              }}
              onLongPress={() => confirmForget(server.id, server.serverName)}
            />
          );
        })}
        <SheetRow label="+ Connect another computer" onPress={onConnectAnother} />
      </View>
    </Sheet>
  );
}
