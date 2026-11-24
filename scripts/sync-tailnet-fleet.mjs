#!/usr/bin/env node
/**
 * Idempotent Tailscale + Hermes Fleet Sync for OpenMausBot.
 * Discovers existing Hermes specialist profiles (~/.hermes/profiles/*),
 * active projects (Hermes projects + ~/Projects/* git repos), and live Tailscale
 * peers, then syncs them into OpenMausBot (1:1 bots, Project Group Chats, and
 * shared Team Memory) without creating duplicates.
 *
 * Usage:
 *   node scripts/sync-tailnet-fleet.mjs [--url http://127.0.0.1:8799] [--include-all-projects]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const urlFlagIdx = process.argv.indexOf("--url");
const BASE_URL = (urlFlagIdx !== -1 && process.argv[urlFlagIdx + 1]) || process.env.OMB_URL || "http://127.0.0.1:8799";
const INCLUDE_ALL_PROJECTS = args.has("--include-all-projects");
const HOME = homedir();
const PROJECTS_ROOT = join(HOME, "Projects");
const HERMES_PROFILES_DIR = join(HOME, ".hermes", "profiles");

const ROLE_CONFIG = {
  director: {
    name: "Director",
    title: "Engineering Director & Team Architect",
    description: "Meta-manager coordinating teams and projects across your Tailscale fleet.",
    modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
    color: "purple",
    cwd: PROJECTS_ROOT,
  },
  pm: {
    name: "PM",
    title: "Product Manager & Delivery Orchestrator",
    description: "Triages requests, sequences vertical slices, and keeps teams unblocked.",
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" },
    color: "blue",
    cwd: PROJECTS_ROOT,
  },
  lead: {
    name: "Lead",
    title: "Systems Architect & Tech Lead",
    description: "Owns architecture, API contracts, cross-machine routing, and technical decisions.",
    modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
    color: "teal",
    cwd: PROJECTS_ROOT,
  },
  design: {
    name: "Design",
    title: "Product & Cross-Platform UI/UX Specialist",
    description: "Designs user flows, visual systems, non-happy states, and interactive mocks.",
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" },
    color: "pink",
    cwd: PROJECTS_ROOT,
  },
  coder: {
    name: "Coder",
    title: "Principal Systems & Full-Stack Engineer",
    description: "Implements Rust, TypeScript, and backend/frontend code in isolated worktrees.",
    modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
    color: "green",
    cwd: PROJECTS_ROOT,
  },
  mobile: {
    name: "Mobile",
    title: "Expo / React Native & Android Specialist",
    description: "Builds apps/mobile (Expo RN, Android Gradle APK, Tailscale companion client).",
    modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
    color: "orange",
    cwd: join(PROJECTS_ROOT, "openmausbot"),
  },
  backend: {
    name: "Backend",
    title: "Distributed Server & Tailscale Ops Engineer",
    description: "Runs OpenMausBot/TailDrive services, LaunchAgents, and multi-node Tailscale routing.",
    modelSelection: { instanceId: "codex", model: "gpt-6.2-sol" },
    color: "amber",
    cwd: join(PROJECTS_ROOT, "openmausbot"),
  },
  qa: {
    name: "QA",
    title: "Adversarial Verification & Reliability Engineer",
    description: "Cross-model independent auditor running live integration, concurrency, and APK checks.",
    modelSelection: { instanceId: "codex", model: "gpt-6.2-sol" },
    color: "red",
    cwd: PROJECTS_ROOT,
  },
};

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function getTailscalePeers() {
  try {
    const out = execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 5000 });
    const parsed = JSON.parse(out);
    const peers = [];
    if (parsed.Self) {
      peers.push({
        host: parsed.Self.HostName,
        dns: (parsed.Self.DNSName || "").replace(/\.$/, ""),
        ip: parsed.Self.TailscaleIPs?.[0] || "",
        os: parsed.Self.OS || "",
        online: true,
        self: true,
      });
    }
    for (const peer of Object.values(parsed.Peer || {})) {
      peers.push({
        host: peer.HostName,
        dns: (peer.DNSName || "").replace(/\.$/, ""),
        ip: peer.TailscaleIPs?.[0] || "",
        os: peer.OS || "",
        online: Boolean(peer.Online),
        self: false,
      });
    }
    return peers;
  } catch {
    return [];
  }
}

function readSoul(profileName) {
  const p = join(HERMES_PROFILES_DIR, profileName, "SOUL.md");
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8").trim().slice(0, 12000);
}

function readBrief(repoDir) {
  for (const fname of ["PROJECT_BRIEF.md", "docs/mobile-android-spec.md", "README.md"]) {
    const p = join(repoDir, fname);
    if (existsSync(p)) {
      return readFileSync(p, "utf8").trim().slice(0, 2500);
    }
  }
  return `Project directory: ${repoDir}`;
}

function discoverHermesProfiles() {
  if (!existsSync(HERMES_PROFILES_DIR)) return [];
  return readdirSync(HERMES_PROFILES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("tmp-"))
    .map((d) => d.name)
    .sort();
}

async function main() {
  const peers = getTailscalePeers();
  const fleetSummary = peers.length
    ? peers.map((p) => `- ${p.host} (${p.ip}${p.dns ? ` / ${p.dns}` : ""}) [${p.os}] ${p.online ? "online" : "offline"}${p.self ? " (hub)" : ""}`).join("\n")
    : "- macmini-ci (100.97.87.111)";

  // 1. Fetch existing bots & groups
  const state = await api("GET", "/api/bots?messages=1");
  const existingBotsByName = new Map(state.bots.map((b) => [b.name.toLowerCase(), b]));
  const existingGroupsByName = new Map(state.groups.map((g) => [g.name.toLowerCase(), g]));

  // 2. Sync all Hermes profiles as 1:1 bots
  const discovered = discoverHermesProfiles();
  const ordered = [
    ...Object.keys(ROLE_CONFIG).filter((k) => discovered.includes(k)),
    ...discovered.filter((k) => !ROLE_CONFIG[k]),
  ];

  const botIds = new Map();
  for (const key of ordered) {
    const cfg = ROLE_CONFIG[key] || {
      name: key.charAt(0).toUpperCase() + key.slice(1),
      title: `${key} Specialist`,
      description: `Synced from Hermes profile ~/.hermes/profiles/${key}`,
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" },
      color: "blue",
      cwd: PROJECTS_ROOT,
    };

    const hermesSoul = readSoul(key);
    const fullSoul = [
      hermesSoul || `# ${cfg.name}\n${cfg.description}`,
      "",
      "## Tailscale Fleet & Local Swarm Context",
      fleetSummary,
      `- Hermes profile: ~/.hermes/profiles/${key} (pstack skills linked in ~/.agents/skills)`,
      `- Local CAO server: http://127.0.0.1:9889 | Hermes server: http://127.0.0.1:9119`,
    ].join("\n").slice(0, 15000);

    let bot = existingBotsByName.get(cfg.name.toLowerCase());
    if (!bot) {
      const created = await api("POST", "/api/bots", {
        name: cfg.name,
        title: cfg.title,
        description: cfg.description,
        cwd: existsSync(cfg.cwd) ? cfg.cwd : PROJECTS_ROOT,
        modelSelection: cfg.modelSelection,
        color: cfg.color,
      });
      bot = created.bot;
      console.log(`+ Created bot: ${bot.name} (${cfg.modelSelection.instanceId}/${cfg.modelSelection.model})`);
    } else {
      console.log(`= Bot exists: ${bot.name}`);
    }

    // Sync SOUL.md into bot profile
    await api("PATCH", `/api/bots/${bot.id}/profile`, {
      title: cfg.title,
      description: cfg.description,
      soul: fullSoul,
    });
    botIds.set(key, bot.id);
  }

  // 3. Build project rooms list
  const memberList = (keys) => keys.map((k) => botIds.get(k)).filter(Boolean);
  const projectRooms = [
    {
      name: "Fleet HQ (Tailscale)",
      cwd: PROJECTS_ROOT,
      members: memberList(["director", "pm", "lead", "design", "coder", "mobile", "backend", "qa"]),
      defaultResponder: botIds.get("director") || botIds.get("pm") || botIds.get("lead"),
      bulletin: `# Tailscale Fleet HQ\n\n## Nodes\n${fleetSummary}\n\n## Active Projects on macmini-ci\n- TailDrive: ~/Projects/taildrive\n- OpenMausBot Mobile: ~/Projects/openmausbot\n- Reader: ~/Projects/reader (+ MacBook Pro ~/Projects/reader)\n`,
    },
    {
      name: "TailDrive",
      cwd: join(PROJECTS_ROOT, "taildrive"),
      members: memberList(["pm", "lead", "design", "coder", "qa"]),
      defaultResponder: botIds.get("pm") || botIds.get("lead"),
      bulletin: `# TailDrive Project Room\nRepo: ~/Projects/taildrive (macmini-ci)\n\n${readBrief(join(PROJECTS_ROOT, "taildrive"))}`,
    },
    {
      name: "OpenMausBot Mobile",
      cwd: join(PROJECTS_ROOT, "openmausbot"),
      members: memberList(["pm", "lead", "design", "mobile", "backend", "qa"]),
      defaultResponder: botIds.get("pm") || botIds.get("lead"),
      bulletin: `# OpenMausBot Mobile & Tailscale Swarm Room\nRepo: ~/Projects/openmausbot (branch feat/android-expo-mobile)\n\n${readBrief(join(PROJECTS_ROOT, "openmausbot"))}`,
    },
    {
      name: "Reader",
      cwd: join(PROJECTS_ROOT, "reader"),
      members: memberList(["pm", "lead", "design", "coder", "mobile", "qa"]),
      defaultResponder: botIds.get("pm") || botIds.get("lead"),
      bulletin: `# Reader Project Room\nRepos:\n- macmini-ci: ~/Projects/reader & ~/Projects/reader-mobile-build\n- MacBook Pro (100.76.186.6): ~/Projects/reader\n\n${readBrief(join(PROJECTS_ROOT, "reader"))}`,
    },
  ];

  if (INCLUDE_ALL_PROJECTS && existsSync(PROJECTS_ROOT)) {
    const knownDirs = new Set(["taildrive", "openmausbot", "reader", "reader-mobile-build", "qa"]);
    for (const d of readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory() || knownDirs.has(d.name)) continue;
      const full = join(PROJECTS_ROOT, d.name);
      if (!existsSync(join(full, ".git"))) continue;
      projectRooms.push({
        name: d.name,
        cwd: full,
        members: memberList(["lead", "coder", "qa"]),
        defaultResponder: botIds.get("lead") || botIds.get("coder"),
        bulletin: `# ${d.name}\nRepo: ${full}\n\n${readBrief(full)}`,
      });
    }
  }

  for (const room of projectRooms) {
    if (!existsSync(room.cwd) || room.members.length < 2) continue;
    let group = existingGroupsByName.get(room.name.toLowerCase());
    if (!group) {
      const created = await api("POST", "/api/groups", {
        name: room.name,
        memberIds: room.members,
      });
      group = created.group;
      console.log(`+ Created project group: ${room.name} (${room.members.length} bots)`);
    } else {
      console.log(`= Project group exists: ${room.name}`);
    }
    if (!group.setupCompletedAt) {
      await api("PATCH", `/api/groups/${group.id}/setup`, {
        action: "complete",
        cwd: room.cwd,
        defaultResponder: { kind: "auto", fallbackBotId: room.defaultResponder || room.members[0] },
        bulletin: room.bulletin.slice(0, 11500),
      });
      console.log(`  -> Bound cwd=${room.cwd} & project brief`);
    }
  }

  // 4. Write Tailscale fleet inventory into shared Team Memory
  try {
    const existingMem = await api("GET", "/api/team-memory");
    const items = existingMem.entries || existingMem.items || [];
    const hasFleet = Array.isArray(items) && items.some((x) => String(x.text || x.content || "").includes("Tailscale Fleet Inventory"));
    if (!hasFleet) {
      await api("POST", "/api/team-memory", {
        text: `Tailscale Fleet Inventory (auto-synced):\n${fleetSummary}\nProjects on macmini-ci: TailDrive (~/Projects/taildrive), OpenMausBot (~/Projects/openmausbot), Reader (~/Projects/reader). Projects on MacBook Pro: Reader (~/Projects/reader), ast-grep-mcp, MCPTestApp.`,
      });
      console.log("+ Added Tailscale Fleet Inventory to shared Team Memory");
    }
  } catch (err) {
    console.log(`(team-memory note: ${err.message})`);
  }

  // 5. Final summary
  const finalState = await api("GET", "/api/bots?messages=0");
  console.log(`\nDone! OpenMausBot now has ${finalState.bots.length} bots and ${finalState.groups.length} project group chats.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
