import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { replaceServer, type SavedServer } from "../servers/servers";
import { deleteToken, loadServers, saveServers, saveToken, type SavedState } from "../servers/storage";

interface ServersValue extends SavedState {
  ready: boolean;
  active: SavedServer | null;
  addPaired(server: SavedServer, token: string): Promise<void>;
  forget(serverId: string): Promise<void>;
  switchTo(serverId: string): void;
  update(serverId: string, change: (server: SavedServer) => SavedServer): void;
}

const ServersContext = createContext<ServersValue | null>(null);

export function ServersProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SavedState>({ servers: [], activeId: null });
  const [ready, setReady] = useState(false);
  const latest = useRef(state);

  useEffect(() => {
    void loadServers().then((loaded) => {
      latest.current = loaded;
      setState(loaded);
      setReady(true);
    });
  }, []);

  const commit = useCallback((next: SavedState) => {
    latest.current = next;
    setState(next);
    void saveServers(next);
  }, []);

  const addPaired = useCallback(async (server: SavedServer, token: string) => {
    await saveToken(server.id, token);
    commit({ servers: replaceServer(latest.current.servers, server), activeId: server.id });
  }, [commit]);

  const forget = useCallback(async (serverId: string) => {
    await deleteToken(serverId);
    const servers = latest.current.servers.filter((server) => server.id !== serverId);
    const activeId = latest.current.activeId === serverId ? servers[0]?.id ?? null : latest.current.activeId;
    commit({ servers, activeId });
  }, [commit]);

  const switchTo = useCallback((serverId: string) => commit({ ...latest.current, activeId: serverId }), [commit]);

  const update = useCallback((serverId: string, change: (server: SavedServer) => SavedServer) => {
    const current = latest.current.servers.find((server) => server.id === serverId);
    if (current) commit({ ...latest.current, servers: replaceServer(latest.current.servers, change(current)) });
  }, [commit]);

  const value = useMemo<ServersValue>(() => ({
    ...state,
    ready,
    active: state.servers.find((server) => server.id === state.activeId) ?? null,
    addPaired,
    forget,
    switchTo,
    update,
  }), [state, ready, addPaired, forget, switchTo, update]);

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

export function useServers(): ServersValue {
  const value = useContext(ServersContext);
  if (!value) throw new Error("useServers outside ServersProvider");
  return value;
}
