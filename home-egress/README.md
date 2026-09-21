# Home egress proxy (your PC → Agnes, clean residential IP)

Runs on your own computer via Docker. The Worker calls Agnes direct-first and
fails over to this lane only on IP-level throttling (or direct transport
failure); if your PC is off/asleep/offline that leg fails fast and chat answers
"busy" instead of hanging — nothing to switch either way.

## One-time setup (your PC)

1. Install **Docker Desktop** and start it.
2. In this folder: copy `.env.example` → `.env`, paste your `PROXY_SECRET` and
   `TUNNEL_TOKEN` (Cloudflare dashboard → Zero Trust → Networks → Tunnels →
   your tunnel → Configure → token).
3. Run:
   ```
   docker compose up -d --build
   docker compose logs cloudflared | grep -i "registered tunnel"
   ```
4. The public hostname is **static** (a named tunnel, e.g.
   `https://egress-bui.apotza.com`) — set it once as Worker secret
   `AGNES_PROXY_URL` (plus `AGNES_PROXY_SECRET`) and never touch it again.
   Verify: `curl https://<your-hostname>/health` → `{"ok":true,…}`.

## Notes

- Keep Docker Desktop running while you want the fallback lane active.
- Dashboard ingress for the tunnel must target **`http://localhost:3000`** —
  compose runs cloudflared in the proxy's network namespace so its localhost
  IS the proxy (port 3000 on the host itself is taken by the Next dev server).
- The proxy only forwards to `apihub.agnes-ai.com`, requires the secret on
  every call, and never logs keys or request bodies.
- Health: `GET /health` on the proxy (Docker also health-checks it).
- Logs: `docker compose logs -f proxy`
- If the tunnel ever shows `Unauthorized: Tunnel not found` in a reconnect
  loop, `docker compose restart cloudflared` re-registers it (hostname stays).
