# Run OpenMausBot on macmini-ci over Tailscale

`com.local.openmausbot-serve` runs OpenMausBot and the Phone Companion Sidecar as `arturokuang` on `macmini-ci` (`100.97.87.111`). OpenMausBot uses its direct tailnet listener, and the sidecar accepts loopback and Tailscale peers. The deployment uses HTTP inside Tailscale and leaves Serve and Funnel configuration alone.

| Service | On macmini-ci | On the tailnet |
| --- | --- | --- |
| OpenMausBot API | `http://127.0.0.1:8799` | `http://arturos-mac-mini.tail8dc761.ts.net:8799` or `http://100.97.87.111:8799` |
| Webhook receiver | `http://127.0.0.1:8800` | Loopback only |
| Android companion | `http://127.0.0.1:8810` | `http://arturos-mac-mini.tail8dc761.ts.net:8810` or `http://100.97.87.111:8810` |
| Companion pairing and device control | `http://127.0.0.1:8811` | Loopback only |
| Hermes | `127.0.0.1:9119` | Existing service |
| CAO server | `127.0.0.1:9889` | Existing service |

## Pair Android

1. Connect the phone to the tailnet. Allow TCP `8810` to `macmini-ci` in the tailnet policy if the policy restricts access. [Tailscale grants](https://tailscale.com/docs/features/access-control/grants)
2. On `macmini-ci`, run this in a private terminal. The QR and six-digit code expire after two minutes.

   ```sh
   cd ~/Projects/openmausbot
   scripts/macmini-tailscale-service.sh pair
   ```

3. Scan the terminal QR in the Android app. To enter the code manually, use `http://100.97.87.111:8810` as the address. The QR uses MagicDNS. [Tailscale MagicDNS](https://tailscale.com/docs/features/magicdns)

Android redeems the QR token or code via `POST /api/pair` on `8810`, with no `Origin` header. The reply is HTTP `201` and includes the device bearer token. Keep the QR, code, and bearer token private.

To revoke a phone, open the loopback control page on `macmini-ci` and choose **Remove** beside the device. The service rotates the control token at start and stores it in a `0600` file. The control URL fragment stays out of the service log.

```sh
open "http://127.0.0.1:8811/#token=$(cat "$HOME/.openmausbot-macmini/companion/control-token")"
```

## Operate the LaunchAgent

The installed plist is `~/Library/LaunchAgents/com.local.openmausbot-serve.plist`. It points at the checkout in `~/Projects/openmausbot` and sets PATH explicitly for Node 24 and the provider CLIs. The script runs `server/index.ts` and `companion/src/index.ts` from source. Keep the checkout and its installed dependencies available. This deployment serves the API without built browser assets.

Keep the Mac on AC power and the `arturokuang` session logged in. Display lock is fine. The Mac's current AC sleep setting is `0`. After a reboot, sign in to start the per-user LaunchAgent and Tailscale. LaunchAgent `KeepAlive` restarts the service after a process exits. [Apple launchd guide](https://support.apple.com/guide/terminal/script-management-with-launchd-apdc6c1077b-5d5d-4d35-9c19-60f2397b2369/mac), [Tailscale unattended mode](https://tailscale.com/docs/how-to/run-unattended)

```sh
domain="gui/$(id -u)"
job="$domain/com.local.openmausbot-serve"
plist="$HOME/Library/LaunchAgents/com.local.openmausbot-serve.plist"

launchctl print "$job"
tail -f "$HOME/Library/Logs/openmausbot-serve.log"
```

Restart after a source update with `launchctl kickstart -k "$job"`. To stop the job or reload changed plist settings, run `launchctl bootout "$job"`. To load the plist again, run `plutil -lint "$plist" && launchctl bootstrap "$domain" "$plist"`.

The server stores its data in `~/.openmausbot-macmini/harness`. The sidecar stores its paired devices in `~/.openmausbot-macmini/companion`. If you replace the NVM Node installation, update the Node bin directory in the plist and reload it.

## Check health and providers

Run the health commands on `macmini-ci`. Repeat the Tailscale IP or MagicDNS commands from a second tailnet device to check that device's route and policy.

```sh
for addr in 127.0.0.1 100.97.87.111 arturos-mac-mini.tail8dc761.ts.net; do
	for port in 8799 8810; do
		curl --noproxy '*' -sS --max-time 5 -w " $addr:$port HTTP %{http_code}\n" \
			"http://$addr:$port/api/health"
	done
done
```

On 2026-11-22, all six requests returned HTTP `200` and `app: openmausbot` from `macmini-ci`. Unauthenticated `GET /api/instances` over the Tailscale IP returned `403` on `8799` and `401` on `8810`. A malformed `POST /api/pair` returned `400 pairing_bad_request` on `8810` through both addresses without opening a pairing window. The isolated fixture generated a QR and code, redeemed the code with `201`, and received `200` from the paired companion's `GET /api/instances`.

Query the provider registry from loopback. The filter leaves account identifiers out of the output.

```sh
curl -fsS 'http://127.0.0.1:8799/api/instances?fresh=1' |
	jq -c '.instances[] | select(.instanceId == "claude" or .instanceId == "codex" or .instanceId == "antigravity") |
		{instanceId, snapshot: (.snapshot | {state, version, authenticated})}'
```

| LaunchAgent PATH entry | Registry result |
| --- | --- |
| `~/.local/bin/claude` | `claude` available, Claude Code `2.1.330`, authenticated |
| `~/.nvm/versions/node/v24.14.0/bin/codex` | `codex` available, Codex CLI `0.171.0`, authenticated |
| `~/.local/bin/agy` | `antigravity` available via the installed official Google ACP runtime `1.4.3`. Complete **Sign in with Google** for the OpenMausBot Antigravity instance before running a turn. |

OpenMausBot resolves Antigravity through the official ACP runtime. The `agy` command on PATH and its existing login are separate. On a fresh service data directory, install the runtime through **Install official Antigravity** or the owner-only loopback endpoint. [Antigravity provider guide](../apps/docs/content/docs/providers/antigravity.mdx)

```sh
curl -fsS --max-time 300 -H 'Content-Type: application/json' -d '{}' \
	http://127.0.0.1:8799/api/instances/antigravity/install -o /dev/null
```

### pstack skills

The service runs with the account's usual home, and Codex loads `~/.codex/skills` and `~/.agents/skills` natively. The installed pstack skill links in both folders resolve into `~/.agents/repos/pstack/plugins/pstack/skills`. Control a Codex bot's native skills in **Bot Settings → Skills**. The desktop **Import & export** flow copies selected skills from other tools and is unavailable on this headless server. To share a pstack skill across engines, add that skill to the OpenMausBot skill library and grant it to the intended bot. Claude's separate native option reads `~/.claude/skills`. [Local skill configuration](custom-mcp-servers.md)

## Connect another Tailscale worker

- **Worker as an OpenMausBot client.** Join it to the same tailnet and allow TCP `8799` to `macmini-ci`. Curl `http://arturos-mac-mini.tail8dc761.ts.net:8799/api/health` from the worker. On the Mac, run the following and pass the one-time link through a private channel. In the desktop app on the worker, choose **Connect to a server** and paste the link. [Self-hosted client setup](self-hosting.md#using-it-from-your-computer)

  ```sh
  cd ~/Projects/openmausbot
  pnpm omb pair --port 8799 --client --label 'Tailscale worker' \
    --public-url http://arturos-mac-mini.tail8dc761.ts.net:8799
  ```

- **Worker as a bot's computer.** Join the Linux Docker host to the tailnet and allow SSH from `macmini-ci`. On the Mac, configure an SSH alias with `HostName` set to the worker's MagicDNS name or Tailscale IP. As `arturokuang`, verify `docker -H ssh://<alias> info`, then choose the SSH alias for the bot's **Self-hosted VPS** computer in OpenMausBot. The engine CLI runs on `macmini-ci`, and the worker runs the bot's Docker desktop. [SSH alias and worker setup](byo-vps.md#the-required-ssh-config-alias)
