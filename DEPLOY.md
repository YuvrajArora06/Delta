# Deploying to DigitalOcean

One Droplet runs three containers:

```
Internet ──► Caddy :443 (automatic HTTPS)
               ├── /api/*, /docs  ──► backend  (FastAPI, :8000)
               └── everything else ──► frontend (Next.js, :3000)
```

The browser talks to one address, so there is no cross-site configuration to
get wrong. The permanent cache lives on the Droplet's disk in
`backend/.apex-cache`, and survives restarts and redeploys.

Use a **Droplet**, not App Platform: App Platform wipes its filesystem on every
deploy, which would throw the cache away each time.

---

## 1. Create the Droplet (DigitalOcean dashboard)

- **Create → Droplets**
- **Region:** the one closest to your users (e.g. Bangalore `BLR1`)
- **Image:** Ubuntu 24.04 LTS
- **Size:** Basic, Regular, **2 GB RAM / 1 CPU** (about $12/month). 1 GB is not
  enough to build the frontend.
- **Authentication:** SSH key (add your Mac's `~/.ssh/id_ed25519.pub`; create
  one with `ssh-keygen -t ed25519` if you have none)
- Create it and copy its **IP address**.

## 2. Prepare the server

From your Mac:

```bash
ssh root@YOUR_IP
```

On the server:

```bash
# Firewall: SSH and web only
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Docker and Docker Compose
curl -fsSL https://get.docker.com | sh

# The app
git clone https://github.com/dasham-j/Delta.git
cd Delta
```

## 3. Choose the site address

```bash
cp deploy.env.example .env
nano .env
```

Set `SITE_ADDRESS` to either:

- **No domain:** the IP with dashes plus `.sslip.io`, e.g. IP `203.0.113.5` →
  `203-0-113-5.sslip.io`. Real HTTPS, nothing to buy.
- **Your domain:** e.g. `apex.example.com`, after adding a DNS **A record**
  pointing it at the Droplet's IP.

## 4. (Optional) Copy your cache up

The cache built on your Mac works as-is on the server, so the site starts
fast instead of fetching everything from OpenF1 again. From your **Mac**:

```bash
rsync -az --info=progress2 \
  "/Users/dasham/apex telemetry /Delta/backend/.apex-cache/" \
  root@YOUR_IP:Delta/backend/.apex-cache/
```

## 5. Start it

On the server, in `~/Delta`:

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then open `https://YOUR_SITE_ADDRESS`.
Check the API with `https://YOUR_SITE_ADDRESS/api/health` and the cache with
`/api/cache`.

---

## Everyday operations

| Task | Command (on the server, in `~/Delta`) |
|---|---|
| Deploy the latest `main` | `git pull && docker compose up -d --build` |
| See logs | `docker compose logs -f backend` (or `frontend`, `caddy`) |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (the cache is kept) |
| Pre-fill the cache | `docker compose exec backend python -m app.warm` |
| Cache size | `du -sh backend/.apex-cache` |

## Alternative: frontend on Vercel, backend on the Droplet

Vercel is a good home for the Next.js frontend. The backend stays on the
Droplet: Vercel Functions start each instance with an empty, temporary disk, so
the permanent cache would be lost and every instance would fetch from OpenF1
again (and count its own rate limit, exceeding OpenF1's 30 requests a minute
together).

```
Browser ──► your-app.vercel.app            (frontend, Vercel)
   └─────► https://API_ADDRESS/api/...     (backend + cache, Droplet)
```

**1. Backend on the Droplet.** Follow steps 1–4 above. `SITE_ADDRESS` is now the
API's address (e.g. `203-0-113-5.sslip.io`). Start only the backend and Caddy:

```bash
docker compose up -d --build backend caddy
```

Check `https://API_ADDRESS/api/health`.

**2. Frontend on Vercel** (vercel.com dashboard):

- **Add New → Project →** import the `dasham-j/Delta` GitHub repository
- **Root Directory:** `frontend` (Vercel then detects Next.js on its own)
- **Environment Variables:** `NEXT_PUBLIC_API_BASE` = `https://API_ADDRESS`
  (no trailing slash, no `/api`)
- **Deploy**, then copy the site address, e.g. `https://delta-xyz.vercel.app`

`NEXT_PUBLIC_API_BASE` is built into the page, so changing it needs a
**Redeploy** in Vercel.

**3. Let the Vercel site call the API.** On the Droplet, add to `~/Delta/.env`:

```
APEX_CORS_ORIGINS=https://delta-xyz.vercel.app
```

then `docker compose up -d backend`. Add any custom domain you give the
Vercel site too, comma-separated. Vercel's per-commit preview addresses are
different each time and are not allowed unless added here.

**Updates:** pushing to `main` redeploys the frontend on Vercel automatically.
The backend still updates with `git pull && docker compose up -d --build backend caddy`
on the Droplet.

## Gemma on the live site (optional)

Without settings, the Race Engineer page still shows its full evidence bundle,
just without Gemma's write-up. LM Studio runs on your Mac, which the server
cannot reach directly, so it needs a tunnel, and it only works while your Mac
and LM Studio are running.

1. On your Mac: `brew install cloudflared`, then
   `cloudflared tunnel --url http://localhost:1234`. It prints an
   `https://….trycloudflare.com` address (a new one each time you start it).
2. On the server, create `backend/.env`:
   ```
   GEMMA_TOKEN=your-lm-studio-token
   GEMMA_BASE_URL=https://….trycloudflare.com/v1
   ```
3. `docker compose up -d backend`

Keep `GEMMA_TOKEN` set: it is what stops anyone who finds the tunnel address
from using your LM Studio.

## Troubleshooting

- **HTTPS certificate errors right after start:** Caddy is still fetching the
  certificate. Check `docker compose logs caddy`. Ports 80 and 443 must be open,
  and for your own domain the DNS record must already point at the server.
- **Page loads without styling:** the frontend image is stale; run
  `docker compose up -d --build frontend`.
- **Build killed while building the frontend:** the Droplet has too little
  memory; use 2 GB or add swap.
