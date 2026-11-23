import {
  PAIRING_INPUT_PROBLEM_KEY,
  PAIRING_INPUT_PROBLEM_TEXT,
  readPairingInput,
} from "@openmausbot/phone-protocol/pairing-code.ts";
import { qrEndpoints, type CompanionEndpoint } from "@openmausbot/phone-protocol/pairing-link.ts";

export const COMPANION_PORT = 8810;

/** What a scan, a deep link or typed fields resolve to: where to dial and what to redeem there. */
export interface PairingInvite {
  /** Base URLs (origins), in the order to try them. */
  candidates: string[];
  credential: string;
  serverName?: string;
  endpoints: CompanionEndpoint[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

const PAIR_TOKEN = /^omb_pair_[A-Za-z0-9_-]{43}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const NOT_A_LINK = "That isn't a pairing link. Scan the code in Settings → Phone & devices on your computer.";

const fail = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

function decodeBase64Url(value: string): string | null {
  if (!B64U.test(value)) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function decodeJson(value: string): unknown {
  const text = decodeBase64Url(value);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function validE2E(value: string): boolean {
  const descriptor = decodeJson(value) as { v?: unknown; k?: unknown } | undefined;
  return descriptor?.v === 1 && typeof descriptor.k === "string" && descriptor.k.length === 87 && B64U.test(descriptor.k);
}

/** An http(s) origin with nothing after it, or null. */
function bareOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A link's `address`: a whole origin (a server) or `host:port` (a computer's companion, plain http). */
function addressOrigin(address: string): string | null {
  if (/^https?:\/\//i.test(address)) return bareOrigin(address);
  if (!/:\d+$/.test(address)) return null;
  return bareOrigin(`http://${address}`);
}

function hostOrigin(host: string, port: string): string | null {
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return bareOrigin(`http://${authority}${port ? `:${port}` : ""}`);
}

/** Reads `openmausbot://pair?address=…&token=…`, as `phonePairingLink` writes it. A malformed `endpoints` or `e2e`
 * refuses the whole link, as the other phones do. */
export function parsePairingLink(raw: string): Parsed<PairingInvite> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail(NOT_A_LINK);
  }
  if (url.protocol !== "openmausbot:" || url.hostname !== "pair") return fail(NOT_A_LINK);
  const params = url.searchParams;

  const address = addressOrigin(params.get("address")?.trim() ?? "");
  const token = params.get("token") ?? "";
  if (!address || !PAIR_TOKEN.test(token)) return fail(NOT_A_LINK);

  let endpoints: CompanionEndpoint[] = [];
  const encodedEndpoints = params.get("endpoints");
  if (encodedEndpoints !== null) {
    const decoded = decodeJson(encodedEndpoints);
    if (!Array.isArray(decoded)) return fail(NOT_A_LINK);
    endpoints = qrEndpoints(decoded as CompanionEndpoint[]);
  }
  const e2e = params.get("e2e");
  if (e2e !== null && !validE2E(e2e)) return fail(NOT_A_LINK);

  const port = new URL(address).port;
  const hosts = (params.get("hosts") ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => hostOrigin(host, port))
    .filter((origin): origin is string => origin !== null);

  const name = params.get("name")?.trim();
  return {
    ok: true,
    value: {
      candidates: [...new Set([address, ...endpoints.map((endpoint) => endpoint.url), ...hosts])],
      credential: token,
      endpoints,
      ...(name ? { serverName: name } : {}),
    },
  };
}

/** A typed address: `100.x.y.z:8810`, `mac.tailnet.ts.net`, `http://…` or `https://…`. Plain http without a port
 * means the companion's own port. */
export function parseServerAddress(raw: string): Parsed<string> {
  const value = raw.trim();
  if (!value) return fail("Enter the address shown on your computer.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const origin = bareOrigin(withScheme);
  if (!origin) return fail("That address doesn't look right. Try something like 100.101.102.103:8810.");
  const url = new URL(origin);
  if (url.protocol === "http:" && !url.port) url.port = String(COMPANION_PORT);
  return { ok: true, value: url.origin };
}

/** A typed pairing secret: a computer's six digits, a server's 12-character code, or an `omb_pair_` credential. */
export function parsePairingCredential(raw: string): Parsed<string> {
  const digits = raw.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(digits)) return { ok: true, value: digits };
  const input = readPairingInput(raw);
  switch (input.kind) {
    case "code":
      return { ok: true, value: input.code };
    case "credential":
      return { ok: true, value: input.credential };
    case "empty":
      return fail("Enter the code shown on your computer.");
    case "wrong":
      return fail(PAIRING_INPUT_PROBLEM_TEXT[PAIRING_INPUT_PROBLEM_KEY[input.problem]]);
  }
}

/** Typed fields, or a whole pairing link pasted into the address field. */
export function manualInvite(addressInput: string, codeInput: string): Parsed<PairingInvite> {
  if (addressInput.trim().toLowerCase().startsWith("openmausbot:")) return parsePairingLink(addressInput);
  const address = parseServerAddress(addressInput);
  if (!address.ok) return address;
  const credential = parsePairingCredential(codeInput);
  if (!credential.ok) return credential;
  return { ok: true, value: { candidates: [address.value], credential: credential.value, endpoints: [] } };
}
