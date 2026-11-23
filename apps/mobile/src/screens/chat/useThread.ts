import { randomUUID } from "expo-crypto";
import type { WireMessage } from "@openmausbot/phone-protocol/wire.ts";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { useConnection } from "../../session/connection-context";
import type { CardChoice } from "../../state/cards";
import { initialThread, threadReducer, type PendingSend } from "../../state/thread";
import type { ChatHost } from "./target";

const READ_DEBOUNCE_MS = 1000;

const failureText = (error: unknown): string =>
  error instanceof ApiError ? error.message : "Couldn't reach your computer.";

/** One open conversation: its page, its live frames, and what the person can do in it. */
export function useThread(host: ChatHost, threadId: string) {
  const { api, subscribe } = useConnection();
  const [state, dispatch] = useReducer(threadReducer, threadId, initialThread);
  const [problem, setProblem] = useState<string | null>(null);
  const loadingOlder = useRef(false);
  const hostId = host.kind === "bot" ? host.bot.id : host.group.id;
  const kind = host.kind;

  const load = useCallback(async () => {
    if (!api) return;
    try {
      dispatch({ type: "loaded", page: await api.messages(threadId) });
    } catch (error) {
      setProblem(failureText(error));
    }
  }, [api, threadId]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (state.stale) void load();
  }, [state.stale, load]);

  useEffect(
    () =>
      subscribe((frame) => {
        if (frame.kind === "hello" && !frame.resumed) void load();
        dispatch({ type: "frame", frame });
      }),
    [subscribe, load],
  );

  const messageCount = state.messages.length;
  useEffect(() => {
    if (!api) return;
    const timer = setTimeout(() => {
      const read = kind === "bot" ? api.markBotRead(hostId, threadId) : api.markGroupRead(hostId, threadId);
      read.catch(() => undefined);
    }, READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, kind, hostId, threadId, messageCount]);

  const deliver = useCallback(async (send: Omit<PendingSend, "state">) => {
    if (!api) return;
    dispatch({ type: "sendStarted", send });
    setProblem(null);
    try {
      const receipt = kind === "bot"
        ? await api.sendToBot(hostId, { text: send.text, threadId, sendId: send.sendId })
        : await api.sendToGroup(hostId, { text: send.text, threadId, sendId: send.sendId, ...(send.mentions?.length ? { mentions: send.mentions } : {}) });
      dispatch({ type: "sendAccepted", sendId: send.sendId, ...(receipt.message ? { message: receipt.message } : {}), ...(receipt.queued ? { queued: true } : {}) });
    } catch (error) {
      dispatch({ type: "sendFailed", sendId: send.sendId });
      setProblem(failureText(error));
    }
  }, [api, kind, hostId, threadId]);

  const send = useCallback(
    (text: string, mentions: string[] = []) => deliver({ sendId: randomUUID(), text, at: Date.now(), ...(mentions.length ? { mentions } : {}) }),
    [deliver],
  );

  /** The same `sendId` again: the server returns the line it already stored instead of starting a second turn. */
  const retry = useCallback((pending: PendingSend) => deliver(pending), [deliver]);

  const interrupt = useCallback(async () => {
    if (!api) return;
    try {
      if (kind === "bot") await api.interruptBot(hostId, threadId, state.turnId ?? undefined);
      else await api.interruptGroup(hostId, threadId);
    } catch (error) {
      setProblem(failureText(error));
    }
  }, [api, kind, hostId, threadId, state.turnId]);

  const answer = useCallback(async (message: WireMessage, choice: CardChoice) => {
    if (!api) return;
    dispatch({ type: "answerStarted", messageId: message.id });
    setProblem(null);
    const cardBotId = message.from?.botId ?? (kind === "bot" ? hostId : undefined);
    try {
      if (choice.plan.route === "respond") {
        if (choice.plan.allowKey && cardBotId) await api.alwaysAllow(cardBotId, threadId, choice.plan.allowKey);
        await api.respond(threadId, choice.plan.response);
      } else if (cardBotId) {
        await api.patchCard(cardBotId, message.id, { threadId, answered: choice.plan.answer, dismissed: true });
        await send(choice.plan.answer);
      }
    } catch (error) {
      dispatch({ type: "answerFailed", messageId: message.id });
      setProblem(failureText(error));
    }
  }, [api, kind, hostId, threadId, send]);

  const loadOlder = useCallback(async () => {
    const first = state.messages[0];
    if (!api || !state.hasMore || !first || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      dispatch({ type: "olderLoaded", page: await api.messages(threadId, first.id) });
    } catch {
      setProblem("Couldn't load earlier messages.");
    } finally {
      loadingOlder.current = false;
    }
  }, [api, threadId, state.messages, state.hasMore]);

  return { state, problem, send, retry, interrupt, answer, loadOlder };
}
