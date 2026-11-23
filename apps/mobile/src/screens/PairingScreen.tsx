import { CameraView, useCameraPermissions } from "expo-camera";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { manualInvite, parsePairingLink, type PairingInvite } from "../pairing/invite";
import { redeemInvite } from "../pairing/redeem";
import type { SavedServer } from "../servers/servers";
import { readToken } from "../servers/storage";
import { nativeFetch } from "../session/native-fetch";
import { useServers } from "../session/servers-context";
import { Field, IconButton, PillButton } from "../ui/primitives";
import { font, radius, usePalette } from "../ui/theme";

const deviceName = (): string => (Platform.OS === "android" ? Platform.constants.Model : "") || "Android phone";

type Phase = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; problem: string };

export function PairingScreen({ replacing, invite, onDone, onCancel }: {
  /** The server whose token stopped working: re-pairing replaces its device entry and keeps its place in the list. */
  replacing?: SavedServer;
  /** A link the app was opened with. */
  invite?: PairingInvite;
  onDone(): void;
  onCancel?(): void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { addPaired } = useServers();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState(replacing?.manualUrl ?? "");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = useRef(false);

  const pair = async (next: PairingInvite, typed: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: "pairing" });
    const replacesToken = replacing ? await readToken(replacing.id) : null;
    const outcome = await redeemInvite({
      invite: next,
      fetch: nativeFetch,
      deviceName: deviceName(),
      serverId: replacing?.id ?? randomUUID(),
      pairRequestId: randomUUID(),
      manual: typed,
      ...(replacesToken ? { replacesToken } : {}),
    });
    busy.current = false;
    if (!outcome.ok) return setPhase({ kind: "failed", problem: outcome.problem });
    await addPaired(outcome.server, outcome.token);
    onDone();
  };

  const latestPair = useRef(pair);
  latestPair.current = pair;
  useEffect(() => {
    if (invite) void latestPair.current(invite, false);
  }, [invite]);

  const scanned = (data: string) => {
    if (busy.current || phase.kind === "pairing") return;
    const parsed = parsePairingLink(data);
    if (parsed.ok) void pair(parsed.value, false);
    else setPhase({ kind: "failed", problem: parsed.problem });
  };

  const submit = () => {
    const parsed = manualInvite(address, code);
    if (parsed.ok) void pair(parsed.value, !address.trim().toLowerCase().startsWith("openmausbot:"));
    else setPhase({ kind: "failed", problem: parsed.problem });
  };

  const pairing = phase.kind === "pairing";
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.app }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.header}>
          {onCancel ? <IconButton label="Back" glyph="‹" onPress={onCancel} /> : <View style={{ width: 44 }} />}
        </View>
        <Text style={[font.title, { color: palette.ink }]}>{replacing ? `Pair again with ${replacing.serverName}` : "Connect to your computer"}</Text>
        <Text style={[font.chat, { color: palette.inkSecondary }]}>
          {manual ? "Enter the address and code from Settings → Phone & devices." : "Scan the code in Settings → Phone & devices on your computer."}
        </Text>

        {manual ? (
          <View style={{ gap: 16 }}>
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="100.101.102.103:8810"
              keyboardType="url"
              editable={!pairing}
              returnKeyType="next"
            />
            <Field
              label="Code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              autoCapitalize="characters"
              editable={!pairing}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <PillButton label="Connect" emphasis="primary" busy={pairing} onPress={submit} />
          </View>
        ) : (
          <View style={[styles.scanner, { backgroundColor: palette.card, borderColor: palette.hairline }]}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={pairing ? undefined : ({ data }) => scanned(data)}
              />
            ) : (
              <View style={styles.permission}>
                <Text style={[font.chat, { color: palette.inkSecondary, textAlign: "center" }]}>The camera reads the pairing code.</Text>
                <PillButton label="Allow camera" emphasis="primary" onPress={() => void requestPermission()} />
              </View>
            )}
          </View>
        )}

        {pairing && !manual ? <Text style={[font.chat, { color: palette.inkSecondary }]}>Connecting…</Text> : null}
        {phase.kind === "failed" ? (
          <Text accessibilityLiveRegion="polite" style={[font.chat, { color: palette.danger }]}>{phase.problem}</Text>
        ) : null}

        <PillButton
          label={manual ? "Scan a code instead" : "Enter address and code"}
          disabled={pairing}
          onPress={() => {
            setManual((value) => !value);
            setPhase({ kind: "idle" });
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 16 },
  header: { height: 44, flexDirection: "row", marginLeft: -12 },
  scanner: { aspectRatio: 1, borderRadius: radius.card, borderWidth: 1, overflow: "hidden" },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
});
