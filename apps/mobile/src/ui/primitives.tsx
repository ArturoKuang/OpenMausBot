import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, identityColor, radius, usePalette } from "./theme";

export const TOUCH = 44;

export function Avatar({ name, colors, size = 40 }: { name: string; colors: string[]; size?: number }) {
  const palette = usePalette();
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  if (colors.length >= 2) {
    const small = Math.round(size * 0.7);
    return (
      <View style={{ width: size, height: size }} accessibilityElementsHidden>
        <View style={[styles.avatar, { width: small, height: small, backgroundColor: identityColor(colors[1], palette), top: 0, right: 0 }]} />
        <View
          style={[
            styles.avatar,
            { width: small, height: small, backgroundColor: identityColor(colors[0], palette), bottom: 0, left: 0, borderColor: palette.app, borderWidth: 2 },
          ]}
        />
      </View>
    );
  }
  return (
    <View style={[styles.avatarSingle, { width: size, height: size, backgroundColor: identityColor(colors[0], palette) }]} accessibilityElementsHidden>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function PillButton({
  label,
  onPress,
  emphasis = "secondary",
  disabled,
  busy,
  tint,
  style,
}: {
  label: string;
  onPress(): void;
  emphasis?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const primary = emphasis === "primary";
  const background = tint ?? (primary ? palette.ink : palette.control);
  const ink = tint ? palette.accentInk : primary ? palette.app : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : <Text style={[font.name, { color: ink }]}>{label}</Text>}
    </Pressable>
  );
}

export function IconButton({ label, glyph, onPress, disabled, color }: { label: string; glyph: string; onPress(): void; disabled?: boolean; color?: string }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color: color ?? palette.ink, fontSize: 22, lineHeight: 26 }}>{glyph}</Text>
    </Pressable>
  );
}

/** A bottom sheet. Android's back button closes it through `onRequestClose`. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose(): void; children: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={[styles.sheetRoot, { backgroundColor: palette.backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: palette.panel, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.grabber, { backgroundColor: palette.hairline }]} />
          <Text style={[font.header, { color: palette.ink, marginBottom: 12 }]}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetRow({ label, detail, onPress, onLongPress, leading, trailing }: {
  label: string;
  detail?: string;
  onPress(): void;
  onLongPress?(): void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.sheetRow, { backgroundColor: pressed ? palette.control : "transparent" }]}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[font.name, { color: palette.ink }]} numberOfLines={1}>{label}</Text>
        {detail ? <Text style={[font.meta, { color: palette.inkTertiary }]} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const palette = usePalette();
  const { label, style, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[font.meta, { color: palette.inkSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.inkTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        style={[styles.field, font.body, { backgroundColor: palette.composer, borderColor: palette.hairline, color: palette.ink }, style]}
      />
    </View>
  );
}

/** A quiet line under the header while the stream is down. Never a modal. */
export function OfflineBar({ onRetry }: { onRetry(): void }) {
  const palette = usePalette();
  return (
    <View style={[styles.offline, { backgroundColor: palette.card, borderColor: palette.hairline }]}>
      <Text style={[font.meta, { color: palette.inkSecondary, flex: 1 }]}>Offline · Reconnecting…</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={10}>
        <Text style={[font.meta, { color: palette.accent }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { position: "absolute", borderRadius: radius.pill },
  avatarSingle: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  initial: { color: "#ffffff", fontWeight: "600" },
  pill: { minHeight: TOUCH, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  icon: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingHorizontal: 16, paddingTop: 8, maxHeight: "85%" },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: radius.control },
  field: { minHeight: TOUCH, borderRadius: radius.control, borderWidth: 1, paddingHorizontal: 14 },
  offline: { height: 28, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});
