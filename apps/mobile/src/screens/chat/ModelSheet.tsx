import type { WireBot, WireInstance } from "@openmausbot/phone-protocol/wire.ts";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { ApiError } from "../../api/client";
import { useConnection } from "../../session/connection-context";
import { Sheet, SheetRow } from "../../ui/primitives";
import { font, usePalette } from "../../ui/theme";

export function ModelSheet({ bot, visible, onClose }: { bot: WireBot; visible: boolean; onClose(): void }) {
  const palette = usePalette();
  const { api, dispatch } = useConnection();
  const [instances, setInstances] = useState<WireInstance[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const current = bot.modelSelection;

  useEffect(() => {
    if (!visible || !api) return;
    setProblem(null);
    api.instances().then(
      (response) => setInstances(response.instances),
      () => setProblem("Couldn't load the models."),
    );
  }, [visible, api]);

  const choose = async (instanceId: string, model: string) => {
    if (!api) return;
    const key = `${instanceId}:${model}`;
    setSaving(key);
    setProblem(null);
    try {
      const response = await api.setBotModel(bot.id, { instanceId, model });
      dispatch({ type: "botSaved", bot: response.bot });
      onClose();
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 409 ? "Wait for the reply to finish, then switch." : error instanceof Error ? error.message : "Couldn't switch models.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet visible={visible} title="Model" onClose={onClose}>
      {problem ? <Text style={[font.chat, { color: palette.danger, marginBottom: 8 }]}>{problem}</Text> : null}
      {instances === null && !problem ? <ActivityIndicator color={palette.inkTertiary} /> : null}
      <ScrollView>
        {(instances ?? []).filter((instance) => !instance.readOnly).map((instance) => [
          <Text key={instance.instanceId} style={[font.meta, { color: palette.inkTertiary, paddingHorizontal: 8, paddingTop: 12 }]}>
            {instance.displayName}
            {instance.snapshot.state === "unavailable" ? ` · ${instance.snapshot.reason ?? "Unavailable"}` : ""}
          </Text>,
          ...(instance.snapshot.state === "available" ? instance.models.options : []).map((option) => {
            const key = `${instance.instanceId}:${option.id}`;
            const selected = current.instanceId === instance.instanceId && current.model === option.id;
            return (
              <SheetRow
                key={key}
                label={option.label}
                onPress={() => void choose(instance.instanceId, option.id)}
                trailing={
                  saving === key ? <ActivityIndicator size="small" color={palette.inkTertiary} />
                  : selected ? <Text style={{ color: palette.accent }}>✓</Text>
                  : undefined
                }
              />
            );
          }),
        ])}
      </ScrollView>
    </Sheet>
  );
}
