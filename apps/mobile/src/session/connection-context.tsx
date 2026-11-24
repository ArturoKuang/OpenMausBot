import NetInfo from "@react-native-community/netinfo";
import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { createApiClient, isUnpaired, type ApiClient } from "../api/client";
import { pickReachable } from "../api/reach";
import { EventStream, type StreamStatus } from "../api/sse";
import { probeHealth } from "../pairing/redeem";
import { dialOrder, withEndpoints, type SavedServer } from "../servers/servers";
import { readToken } from "../servers/storage";
import { emptyRoster, rosterReducer, type Roster, type RosterAction } from "../state/roster";
import { nativeFetch } from "./native-fetch";
import { useServers } from "./servers-context";

type FrameListener = (frame: ServerFrame) => void;

interface ConnectionValue {
  server: SavedServer;
  api: ApiClient | null;
  roster: Roster;
  status: StreamStatus;
  dispatch(action: RosterAction): void;
  /** Every frame the stream delivers, for an open chat. Returns the unsubscribe. */
  subscribe(listener: FrameListener): () => void;
  reconnect(): void;
}

const ConnectionContext = createContext<ConnectionValue | null>(null);

export const connectionKey = (server: SavedServer): string => `${server.id}:${server.deviceId}`;

const rosterCache = new Map<string, Roster>();
const CURSOR_SAVE_MS = 3000;
const FAILOVER_AFTER = 2;

/** One server's live state. Mount it with `key={connectionKey(server)}`: switching servers, or pairing one again,
 * tears the old stream down and shows that server's last roster straight away. */
export function ConnectionProvider({ server, children }: { server: SavedServer; children: ReactNode }) {
  const { update } = useServers();
  const [roster, dispatchRoster] = useReducer(rosterReducer, rosterCache.get(server.id) ?? emptyRoster);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [token, setToken] = useState<string | null>(null);
  const listeners = useRef(new Set<FrameListener>());
  const stream = useRef<EventStream | null>(null);
  const haveSnapshot = useRef(rosterCache.has(server.id));

  useEffect(() => void rosterCache.set(server.id, roster), [server.id, roster]);

  useEffect(() => {
    let current = true;
    void readToken(server.id).then((stored) => current && setToken(stored));
    return () => {
      current = false;
    };
  }, [server.id]);

  const api = useMemo(
    () => (token ? createApiClient({ baseUrl: server.activeUrl, token, fetch: nativeFetch }) : null),
    [server.activeUrl, token],
  );

  const serverRef = useRef(server);
  serverRef.current = server;

  useEffect(() => {
    if (!api || !token) return;
    const serverId = server.id;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    let latestCursor: string | null = null;
    let failoverTried = false;
    const snapshot = () =>
      api.bots().then(
        (response) => {
          haveSnapshot.current = true;
          dispatchRoster({ type: "snapshot", response });
        },
        (error: unknown) => {
          if (isUnpaired(error)) update(serverId, (saved) => ({ ...saved, needsPairing: true }));
        },
      );

    const failover = async () => {
      failoverTried = true;
      const reached = await pickReachable(dialOrder(serverRef.current), (url) => probeHealth(nativeFetch, url));
      if (reached && reached !== serverRef.current.activeUrl) update(serverId, (saved) => ({ ...saved, activeUrl: reached }));
    };

    const events = new EventStream({
      baseUrl: server.activeUrl,
      token,
      fetch: nativeFetch,
      ...(serverRef.current.cursor ? { cursor: serverRef.current.cursor } : {}),
      onStatus: (next, attempt) => {
        setStatus(next);
        if (next === "live") failoverTried = false;
        if (next === "unpaired") update(serverId, (saved) => ({ ...saved, needsPairing: true }));
        if (next === "reconnecting" && attempt >= FAILOVER_AFTER && !failoverTried) void failover();
      },
      onCursor: (cursor) => {
        latestCursor = cursor;
        cursorTimer ??= setTimeout(() => {
          cursorTimer = null;
          const saved = latestCursor;
          if (saved) update(serverId, (server) => ({ ...server, cursor: saved }));
        }, CURSOR_SAVE_MS);
      },
      onFrame: (frame) => {
        if (frame.kind === "hello" && (!frame.resumed || !haveSnapshot.current)) void snapshot();
        if (frame.kind === "companion.endpoints") update(serverId, (saved) => withEndpoints(saved, frame));
        dispatchRoster({ type: "frame", frame });
        for (const listener of listeners.current) listener(frame);
      },
    });
    stream.current = events;
    events.start();

    const appState = AppState.addEventListener("change", (state) => state === "active" && events.reconnectNow());
    const netInfo = NetInfo.addEventListener((state) => state.isConnected && events.reconnectNow());
    return () => {
      appState.remove();
      netInfo();
      if (cursorTimer) clearTimeout(cursorTimer);
      events.stop();
      stream.current = null;
    };
  }, [api, token, server.id, server.activeUrl, update]);

  const subscribe = useCallback((listener: FrameListener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const reconnect = useCallback(() => stream.current?.reconnectNow(), []);

  const value = useMemo<ConnectionValue>(
    () => ({ server, api, roster, status, dispatch: dispatchRoster, subscribe, reconnect }),
    [server, api, roster, status, subscribe, reconnect],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection outside ConnectionProvider");
  return value;
}
