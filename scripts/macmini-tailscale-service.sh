#!/bin/bash
set -eu
umask 077

cd -- "$(dirname -- "$0")/.."
export OMB_DATA_DIR="${OMB_DATA_DIR:-$HOME/.openmausbot-macmini/harness}"
export OMB_COMPANION_DIR="${OMB_COMPANION_DIR:-$HOME/.openmausbot-macmini/companion}"
export OMB_PORT="${OMB_PORT:-8799}" OMB_WEBHOOK_PORT="${OMB_WEBHOOK_PORT:-8800}"
export OMB_COMPANION_PORT="${OMB_COMPANION_PORT:-8810}" OMB_CONTROL_PORT="${OMB_CONTROL_PORT:-8811}"
export OMB_COMPANION_NAME="${OMB_COMPANION_NAME:-macmini-ci}"
export OMB_COMPANION_ROUTES=tailscale OMB_COMPANION_BONJOUR=0
export OMB_COMPANION_TAILNET_NAME="${OMB_TAILNET_NAME:-}"
if [ -d "$PWD/dist" ]; then export OMB_STATIC_DIR="${OMB_STATIC_DIR:-$PWD/dist}"; fi

case "${1:-serve}" in
  serve)
    for cli in node claude codex agy; do
      printf '%s %s\n' "$cli" "$(command -v "$cli" || printf 'missing from PATH')"
    done
    ;;
  pair) ;;
  *) printf 'Usage: %s [serve|pair]\n' "$0" >&2; exit 2 ;;
esac

exec node --experimental-strip-types --input-type=module - "${1:-serve}" <<'NODE'
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import qrcode from 'qrcode-terminal';
import { ensureDataDir, writeFileAtomic } from './companion/src/state.ts';
import { phonePairingLink } from './packages/phone-protocol/src/pairing-link.ts';

const env = process.env;
const controlTokenPath = join(env.OMB_COMPANION_DIR, 'control-token');

async function pair() {
  const token = readFileSync(controlTokenPath, 'utf8');
  const response = await fetch(`http://127.0.0.1:${env.OMB_CONTROL_PORT}/pairing`, {
    method: 'POST',
    headers: { 'x-openmausbot-control-token': token },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 201) throw new Error(`Companion refused to open pairing (HTTP ${response.status})`);
  const pairing = await response.json();
  const host = pairing.tailnetName || pairing.tailscale || '127.0.0.1';
  const link = phonePairingLink({ address: host, port: pairing.port, code: pairing.code, token: pairing.token, name: env.OMB_COMPANION_NAME });
  if (!link) throw new Error('Companion returned an invalid pairing credential');
  console.log(`Address ${host}:${pairing.port}\nCode ${pairing.code}\nExpires ${new Date(pairing.pairing.expiresAt).toISOString()}`);
  qrcode.generate(link, { small: true });
}

function serve() {
  const token = randomBytes(32).toString('base64url');
  ensureDataDir();
  const harness = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { stdio: 'inherit' });
  const companion = spawn(process.execPath, ['--experimental-strip-types', 'companion/src/index.ts'], {
    env: { ...env, OMB_CONTROL_TOKEN: token },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const children = new Set([harness, companion]);
  let published = false;
  let stopping = false;

  function stop(exitCode) {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    if (published) {
      try { unlinkSync(controlTokenPath); }
      catch (error) { console.error(`Could not remove companion control token: ${error.code}`); }
    }
    for (const child of children) child.kill('SIGTERM');
    setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 15_000).unref();
  }

  createInterface({ input: companion.stdout }).on('line', (line) => {
    if (!line.includes(token)) return console.log(line);
    if (stopping) return;
    try {
      writeFileAtomic(controlTokenPath, token);
      published = true;
      console.log(`Companion pairing ready on loopback port ${env.OMB_CONTROL_PORT}`);
    } catch (error) {
      console.error(`Could not save companion control token: ${error.code}`);
      stop(1);
    }
  });

  for (const [name, child] of [['server', harness], ['companion', companion]]) {
    child.once('close', (code, signal) => {
      children.delete(child);
      if (!stopping) console.error(`${name} stopped (${signal ?? code})`);
      stop(1);
    });
    child.once('error', (error) => {
      children.delete(child);
      console.error(`${name} failed to start: ${error.code}`);
      stop(1);
    });
  }
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
}

try {
  if (process.argv[2] === 'pair') await pair();
  else serve();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
NODE
