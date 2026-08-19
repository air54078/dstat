# dstat

Self-hosted L4/L7 traffic testing cockpit for Cloudflare-proxied services.
The dashboard is designed to sit behind your own domain and Cloudflare DNS / Tunnel.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Production build and server:

```bash
npm run build
npm run start
```

The default server listens on port `3000`. Put it behind your reverse proxy or
Cloudflare Tunnel, for example:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /etc/cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: dstat.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Create the DNS route for `dstat.example.com` in Cloudflare as a Tunnel route.
The target services being tested can remain proxied through Cloudflare as usual.

## Test-agent integration

The current UI includes a live telemetry simulator so the dashboard can be
previewed immediately. The **Agent endpoint** field in the test runner is the
integration point for a self-hosted test agent. The agent should be responsible
for raw TCP/UDP work and controlled HTTP load, because browsers cannot open raw
L4 sockets or emit packets directly.

Recommended API shape:

- `POST /tests` — start an L7 HTTP, L4 TCP, or L4 UDP run
- `GET /tests/:id/events` — stream `rpm`, `gbps`, `packets`, `latency`, and status
  as Server-Sent Events or WebSocket messages
- `POST /tests/:id/stop` — stop a running test

Keep the agent private behind a separate Cloudflare Access policy or a tunnel
service token. Do not expose an unauthenticated load-generation endpoint.

## Project shape

- `app/page.tsx` — dashboard, live graph, metric cards, and test runner
- `app/globals.css` — responsive dark monitoring UI
- `.openai/hosting.json` — left empty because this project is intended for your
  own server rather than Sites-managed hosting
