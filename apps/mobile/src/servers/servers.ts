import type { CompanionEndpoint } from "@openmausbot/phone-protocol/pairing-link.ts";
import type { CompanionEndpointsSnapshot, PairResponse } from "@openmausbot/phone-protocol/wire.ts";

/** A computer or server this phone paired with. Its device token lives apart, in the Keystore. */
export interface SavedServer {
  id: string;
  serverName: string;
  deviceId: string;
  /** The base URL that answered last. */
  activeUrl: string;
  endpoints: CompanionEndpoint[];
  /** What the person typed, kept as a route even though the companion never lists bare Tailscale IPs. */
  manualUrl?: string;
  /** `<streamId>:<seq>` of the last event seen, sent back as `Last-Event-ID`. */
  cursor?: string;
  /** The computer removed this phone: its token no longer works. */
  needsPairing?: true;
}

export type RouteKind = "tailscale" | "wifi" | "cloud";

const ROUTE_LABEL: Record<RouteKind, string> = { tailscale: "Tailscale", wifi: "Wi-Fi", cloud: "Cloud" };

function inTailnetRange(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

export function routeKind(url: string): RouteKind {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.endsWith(".ts.net") || inTailnetRange(host) || host.startsWith("fd7a:115c:a1e0:")) return "tailscale";
  return parsed.protocol === "https:" ? "cloud" : "wifi";
}

export const routeLabel = (url: string): string => ROUTE_LABEL[routeKind(url)];

/** Every base URL worth trying, best first: the one that worked last, the companion's own list, then the typed one. */
export function dialOrder(server: SavedServer): string[] {
  const listed = [...server.endpoints].sort((left, right) => left.priority - right.priority).map((endpoint) => endpoint.url);
  return [...new Set([server.activeUrl, ...listed, ...(server.manualUrl ? [server.manualUrl] : [])])];
}

export function pairedServer(input: {
  id: string;
  response: PairResponse;
  reachedUrl: string;
  inviteEndpoints: CompanionEndpoint[];
  manual: boolean;
}): SavedServer {
  const { id, response, reachedUrl, inviteEndpoints, manual } = input;
  return {
    id,
    serverName: response.serverName,
    deviceId: response.device.id,
    activeUrl: reachedUrl,
    endpoints: response.endpoints?.length ? response.endpoints : inviteEndpoints,
    ...(manual ? { manualUrl: reachedUrl } : {}),
  };
}

export function withEndpoints(server: SavedServer, snapshot: CompanionEndpointsSnapshot): SavedServer {
  return { ...server, serverName: snapshot.serverName || server.serverName, endpoints: snapshot.endpoints };
}

export function replaceServer(servers: readonly SavedServer[], server: SavedServer): SavedServer[] {
  return servers.some((existing) => existing.id === server.id)
    ? servers.map((existing) => (existing.id === server.id ? server : existing))
    : [...servers, server];
}
