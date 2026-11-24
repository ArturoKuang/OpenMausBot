import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ApiError } from "../../api/client";
import { useConnection } from "../../session/connection-context";
import { homeRows } from "../../state/roster";
import { Avatar, Field, PillButton, Sheet, SheetRow } from "../../ui/primitives";
import { font, usePalette } from "../../ui/theme";
import type { ChatTarget } from "../chat/target";

const problemText = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach your computer. Try again.");

export function NewBotSheet({ visible, onClose, onCreated }: { visible: boolean; onClose(): void; onCreated(target: ChatTarget): void }) {
  const palette = usePalette();
  const { api, dispatch } = useConnection();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const create = async () => {
    if (!api || !name.trim()) return;
    setSaving(true);
    setProblem(null);
    try {
      const { bot } = await api.createBot({ name: name.trim() });
      dispatch({ type: "botSaved", bot });
      setName("");
      onCreated({ kind: "bot", id: bot.id });
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} title="New bot" onClose={onClose}>
      <View style={{ gap: 16 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Researcher" autoCapitalize="words" autoFocus onSubmitEditing={create} />
        {problem ? <Text style={[font.chat, { color: palette.danger }]}>{problem}</Text> : null}
        <PillButton label="Create" emphasis="primary" busy={saving} disabled={!name.trim()} onPress={create} />
      </View>
    </Sheet>
  );
}

export function NewGroupSheet({ visible, onClose, onCreated }: { visible: boolean; onClose(): void; onCreated(target: ChatTarget): void }) {
  const palette = usePalette();
  const { api, roster, dispatch } = useConnection();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const bots = homeRows(roster).bots;

  const toggle = (id: string) => setMembers((current) => (current.includes(id) ? current.filter((member) => member !== id) : [...current, id]));

  const create = async () => {
    if (!api || members.length === 0) return;
    setSaving(true);
    setProblem(null);
    try {
      const { group } = await api.createGroup({ ...(name.trim() ? { name: name.trim() } : {}), memberIds: members });
      dispatch({ type: "groupSaved", group });
      setName("");
      setMembers([]);
      onCreated({ kind: "group", id: group.id });
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} title="New group" onClose={onClose}>
      <View style={{ gap: 12, flexShrink: 1 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Launch crew" autoCapitalize="words" />
        <Text style={[font.meta, { color: palette.inkSecondary }]}>Members</Text>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {bots.length === 0 ? <Text style={[font.chat, { color: palette.inkTertiary }]}>No bots yet</Text> : null}
          {bots.map((bot) => {
            const picked = members.includes(bot.id);
            return (
              <SheetRow
                key={bot.id}
                label={bot.name}
                onPress={() => toggle(bot.id)}
                leading={<Avatar name={bot.name} colors={bot.colors} size={32} />}
                trailing={<Text style={{ color: picked ? palette.accent : palette.inkTertiary, fontSize: 18 }}>{picked ? "●" : "○"}</Text>}
              />
            );
          })}
        </ScrollView>
        {problem ? <Text style={[font.chat, { color: palette.danger }]}>{problem}</Text> : null}
        <PillButton label="Create" emphasis="primary" busy={saving} disabled={members.length === 0} onPress={create} />
      </View>
    </Sheet>
  );
}
