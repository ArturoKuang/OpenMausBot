import { useLinkingURL } from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { parsePairingLink, type PairingInvite } from "./pairing/invite";
import { ChatScreen } from "./screens/chat/ChatScreen";
import type { ChatTarget } from "./screens/chat/target";
import { HomeScreen } from "./screens/home/HomeScreen";
import { PairingScreen } from "./screens/PairingScreen";
import type { SavedServer } from "./servers/servers";
import { ConnectionProvider, connectionKey } from "./session/connection-context";
import { ServersProvider, useServers } from "./session/servers-context";
import { usePalette } from "./ui/theme";

type Route =
  | { name: "home" }
  | { name: "chat"; target: ChatTarget }
  | { name: "pair"; replacing?: SavedServer; invite?: PairingInvite };

function Root() {
  const palette = usePalette();
  const { ready, active } = useServers();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const linkingUrl = useLinkingURL();
  const home = useCallback(() => setRoute({ name: "home" }), []);

  useEffect(() => {
    if (!linkingUrl) return;
    const parsed = parsePairingLink(linkingUrl);
    if (parsed.ok) setRoute({ name: "pair", invite: parsed.value });
  }, [linkingUrl]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.name !== "pair" || !active) return false;
      home();
      return true;
    });
    return () => subscription.remove();
  }, [route.name, active, home]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: palette.app }} />;

  if (!active || route.name === "pair") {
    const pairing: { replacing?: SavedServer; invite?: PairingInvite } = route.name === "pair" ? route : {};
    return (
      <PairingScreen
        {...(pairing.replacing ? { replacing: pairing.replacing } : {})}
        {...(pairing.invite ? { invite: pairing.invite } : {})}
        onDone={home}
        {...(active ? { onCancel: home } : {})}
      />
    );
  }

  return (
    <ConnectionProvider key={connectionKey(active)} server={active}>
      {route.name === "chat" ? (
        <ChatScreen target={route.target} onBack={home} />
      ) : (
        <HomeScreen
          onOpen={(target) => setRoute({ name: "chat", target })}
          onConnectAnother={() => setRoute({ name: "pair" })}
          onRepair={() => setRoute({ name: "pair", replacing: active })}
        />
      )}
    </ConnectionProvider>
  );
}

export function App() {
  const palette = usePalette();
  return (
    <SafeAreaProvider>
      <StatusBar style={palette.scheme === "dark" ? "light" : "dark"} />
      <ServersProvider>
        <Root />
      </ServersProvider>
    </SafeAreaProvider>
  );
}
