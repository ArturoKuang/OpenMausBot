import { ApiError, createApiClient, pairingRefusalText, type FetchLike } from "../api/client";
import { pickReachable } from "../api/reach";
import { pairedServer, type SavedServer } from "../servers/servers";
import type { PairingInvite } from "./invite";

export type PairOutcome = { ok: true; server: SavedServer; token: string } | { ok: false; problem: string };

export const UNREACHABLE =
  "Can't reach that computer. Check that OpenMausBot is open there and that Tailscale is connected on both devices.";
export const UPDATE_APP = "This computer needs a newer version of the app for its encrypted connection.";

export async function probeHealth(fetch: FetchLike, baseUrl: string): Promise<void> {
  const health = await createApiClient({ baseUrl, token: null, fetch }).health();
  if (health?.app !== "openmausbot") throw new Error("not an OpenMausBot server");
}

export async function redeemInvite(input: {
  invite: PairingInvite;
  fetch: FetchLike;
  deviceName: string;
  serverId: string;
  pairRequestId: string;
  manual: boolean;
  /** The token this phone already holds for the same computer, so re-pairing replaces its old device entry. */
  replacesToken?: string;
}): Promise<PairOutcome> {
  const { invite, fetch } = input;
  const reached = await pickReachable(invite.candidates, (url) => probeHealth(fetch, url));
  if (!reached) return { ok: false, problem: UNREACHABLE };
  try {
    const response = await createApiClient({ baseUrl: reached, token: null, fetch }).pair({
      credential: invite.credential,
      deviceName: input.deviceName,
      pairRequestId: input.pairRequestId,
      ...(input.replacesToken ? { replacesToken: input.replacesToken } : {}),
    });
    const server = pairedServer({ id: input.serverId, response, reachedUrl: reached, inviteEndpoints: invite.endpoints, manual: input.manual });
    return { ok: true, server: invite.serverName && !response.serverName ? { ...server, serverName: invite.serverName } : server, token: response.token };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, problem: error.status === 426 ? UPDATE_APP : pairingRefusalText(error) };
    return { ok: false, problem: UNREACHABLE };
  }
}
