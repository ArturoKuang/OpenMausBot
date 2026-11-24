import { forwardRef, useImperativeHandle, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../ui/primitives";
import { font, radius, usePalette } from "../../ui/theme";
import { insertMention, mentionedIds, mentionMatches, mentionQuery, type Member } from "./mentions";

export interface ComposerHandle {
  /** Closes the @mention picker; false when it wasn't open. */
  closeMentions(): boolean;
}

interface MemberChoice extends Member {
  color: string;
}

export const Composer = forwardRef<ComposerHandle, {
  members: MemberChoice[];
  running: boolean;
  bottomInset: number;
  onSend(text: string, mentions: string[]): void;
  onStop(): void;
}>(function Composer({ members, running, bottomInset, onSend, onStop }, ref) {
  const palette = usePalette();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const query = members.length ? mentionQuery(draft) : null;
  const matches = query !== null && dismissedAt !== draft ? mentionMatches(members, query) : [];
  const pickerOpen = matches.length > 0;

  useImperativeHandle(ref, () => ({
    closeMentions() {
      if (!pickerOpen) return false;
      setDismissedAt(draft);
      return true;
    },
  }), [pickerOpen, draft]);

  const pick = (member: MemberChoice) => {
    setDraft(insertMention(draft, member));
    setPicked((current) => [...current, member]);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text, mentionedIds(text, picked));
    setDraft("");
    setPicked([]);
  };

  const empty = draft.trim().length === 0;
  const showStop = running && empty;
  return (
    <View style={{ paddingBottom: bottomInset }}>
      {pickerOpen ? (
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={[styles.picker, { backgroundColor: palette.panel, borderColor: palette.hairline }]}
        >
          {matches.map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${member.name}`}
              onPress={() => pick(member)}
              style={({ pressed }) => [styles.pickerRow, { backgroundColor: pressed ? palette.control : "transparent" }]}
            >
              <Avatar name={member.name} colors={[member.color]} size={28} />
              <Text style={[font.name, { color: palette.ink }]}>{member.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.bar, { backgroundColor: palette.composer, borderColor: palette.hairline }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={members.length ? "Message the group, @ to mention" : "Message"}
          placeholderTextColor={palette.inkTertiary}
          multiline
          style={[styles.input, font.body, { color: palette.ink }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showStop ? "Stop" : running ? "Queue message" : "Send"}
          disabled={!showStop && empty}
          onPress={showStop ? onStop : send}
          style={[styles.send, { backgroundColor: showStop ? palette.danger : empty ? palette.control : palette.ink }]}
        >
          <Text style={{ color: showStop ? palette.accentInk : empty ? palette.inkTertiary : palette.app, fontSize: 16, fontWeight: "700" }}>
            {showStop ? "■" : "↑"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  picker: { maxHeight: 220, marginHorizontal: 12, marginBottom: 6, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  pickerRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    marginTop: 6,
    minHeight: 44,
    borderRadius: radius.composer,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
  },
  input: { flex: 1, maxHeight: 140, paddingVertical: 8 },
  send: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
