import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { SavedServer } from "./servers";

const SERVERS_KEY = "openmausbot.servers.v1";
const tokenKey = (serverId: string) => `omb_token_${serverId}`;

export interface SavedState {
  servers: SavedServer[];
  activeId: string | null;
}

export async function loadServers(): Promise<SavedState> {
  const raw = await AsyncStorage.getItem(SERVERS_KEY);
  if (!raw) return { servers: [], activeId: null };
  try {
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    const activeId = servers.some((server) => server.id === parsed.activeId) ? parsed.activeId! : servers[0]?.id ?? null;
    return { servers, activeId };
  } catch {
    return { servers: [], activeId: null };
  }
}

export const saveServers = (state: SavedState): Promise<void> => AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(state));

/** Device tokens go to the Android Keystore-backed store, never AsyncStorage. */
export const saveToken = (serverId: string, token: string): Promise<void> => SecureStore.setItemAsync(tokenKey(serverId), token);
export const readToken = (serverId: string): Promise<string | null> => SecureStore.getItemAsync(tokenKey(serverId));
export const deleteToken = (serverId: string): Promise<void> => SecureStore.deleteItemAsync(tokenKey(serverId));
