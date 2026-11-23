import { phonePairingLink } from "@openmausbot/phone-protocol/pairing-link.ts";
import { describe, expect, it } from "vitest";
import { manualInvite, parsePairingCredential, parsePairingLink, parseServerAddress } from "./invite";

const TOKEN = `omb_pair_${"a".repeat(43)}`;

function link(options: Partial<Parameters<typeof phonePairingLink>[0]> = {}): string {
  const built = phonePairingLink({ address: "192.168.1.20", port: 8810, token: TOKEN, ...options });
  if (!built) throw new Error("fixture link refused");
  return built;
}

describe("parsePairingLink", () => {
  it("reads a companion link the desktop builds", () => {
    const parsed = parsePairingLink(link({ code: "123456", name: "macmini-ci" }));
    expect(parsed).toEqual({
      ok: true,
      value: { candidates: ["http://192.168.1.20:8810"], credential: TOKEN, endpoints: [], serverName: "macmini-ci" },
    });
  });

  it("dials the address first, then listed endpoints, then fallback hosts on the address's port", () => {
    const parsed = parsePairingLink(
      link({
        hosts: ["macmini.local", "10.0.0.5"],
        endpoints: [
          { url: "http://192.168.1.20:8810", kind: "lan", priority: 200 },
          { url: "http://macmini.tail1234.ts.net:8810", kind: "tailnet", priority: 100 },
        ],
      }),
    );
    expect(parsed.ok && parsed.value.candidates).toEqual([
      "http://192.168.1.20:8810",
      "http://macmini.tail1234.ts.net:8810",
      "http://macmini.local:8810",
      "http://10.0.0.5:8810",
    ]);
  });

  it("reads a server link whose address is a whole https origin", () => {
    const parsed = parsePairingLink(link({ address: "https://omb.example.com", port: undefined }));
    expect(parsed.ok && parsed.value.candidates).toEqual(["https://omb.example.com"]);
  });

  it("refuses links a phone must not redeem", () => {
    expect(parsePairingLink("https://example.com/pair?token=x").ok).toBe(false);
    expect(parsePairingLink("openmausbot://pair?address=1.2.3.4:8810&token=omb_pair_short").ok).toBe(false);
    expect(parsePairingLink(`openmausbot://pair?address=1.2.3.4&token=${TOKEN}`).ok).toBe(false);
    expect(parsePairingLink(`${link()}&e2e=not-json`).ok).toBe(false);
    expect(parsePairingLink(`${link()}&endpoints=%%%`).ok).toBe(false);
  });
});

describe("parseServerAddress", () => {
  it("defaults a bare Tailscale IP or MagicDNS name to the companion port over http", () => {
    expect(parseServerAddress("100.101.102.103")).toEqual({ ok: true, value: "http://100.101.102.103:8810" });
    expect(parseServerAddress(" macmini.tail1234.ts.net ")).toEqual({ ok: true, value: "http://macmini.tail1234.ts.net:8810" });
    expect(parseServerAddress("http://100.101.102.103:8810/")).toEqual({ ok: true, value: "http://100.101.102.103:8810" });
  });

  it("keeps https origins on their own port", () => {
    expect(parseServerAddress("https://omb.example.com")).toEqual({ ok: true, value: "https://omb.example.com" });
  });

  it("refuses paths, credentials and other schemes", () => {
    expect(parseServerAddress("http://host:8810/api").ok).toBe(false);
    expect(parseServerAddress("http://user:pw@host:8810").ok).toBe(false);
    expect(parseServerAddress("ftp://host").ok).toBe(false);
    expect(parseServerAddress("").ok).toBe(false);
  });
});

describe("parsePairingCredential", () => {
  it("accepts a computer's six digits, a server's code and a QR credential", () => {
    expect(parsePairingCredential("123 456")).toEqual({ ok: true, value: "123456" });
    expect(parsePairingCredential("7kq2-m9xd-h4tp")).toEqual({ ok: true, value: "7KQ2M9XDH4TP" });
    expect(parsePairingCredential(TOKEN)).toEqual({ ok: true, value: TOKEN });
  });

  it("explains a code of the wrong kind", () => {
    const parsed = parsePairingCredential("12345678");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problem).toMatch(/sign-in code from an email/);
  });
});

describe("manualInvite", () => {
  it("pairs a typed Tailscale address with its code", () => {
    expect(manualInvite("100.64.0.7:8810", "654321")).toEqual({
      ok: true,
      value: { candidates: ["http://100.64.0.7:8810"], credential: "654321", endpoints: [] },
    });
  });

  it("accepts a whole pairing link pasted into the address field", () => {
    const parsed = manualInvite(link(), "");
    expect(parsed.ok && parsed.value.credential).toBe(TOKEN);
  });
});
