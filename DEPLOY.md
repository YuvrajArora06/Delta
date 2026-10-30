# Deploying: frontend on Vercel, backend on your Mac

```
Browser ──► your-app.vercel.app                 (frontend, Vercel)
   └─────► https://….trycloudflare.com/api/...  (tunnel)
              └──► your Mac: backend :8000      (FastAPI + permanent cache)
                       └──► LM Studio :1234     (Gemma)
```

The backend keeps running on your Mac with its permanent cache and direct
access to LM Studio. A Cloudflare tunnel gives it a public HTTPS address that
the Vercel site calls.

**The site only works while your Mac is awake and both the backend and the
tunnel are running.**

---

## 1. Frontend on Vercel (once)

In the Vercel dashboard:

- **Add New → Project →** import `dasham-j/Delta`
- **Root Directory:** `frontend` (Vercel detects Next.js)
- **Deploy**, and note the site address, e.g. `https://delta-xyz.vercel.app`

## 2. Allow the Vercel site to call the backend (once)

Create `backend/.env` (git ignores it) with the Vercel address. Keep the
localhost entry so local development still works:

```
APEX_CORS_ORIGINS=https://delta-xyz.vercel.app,http://localhost:3000
```

## 3. Start the backend and the tunnel (every session)

Two terminals:

```bash
cd "/Users/dasham/apex telemetry /Delta/backend" && .venv/bin/uvicorn app.main:app --port 8000
```

```bash
cloudflared tunnel --url http://localhost:8000
```

The tunnel prints an address like `https://random-words.trycloudflare.com`.
Check it with `https://random-words.trycloudflare.com/api/health`.

## 4. Point Vercel at the tunnel (whenever the address changes)

Vercel → the project → **Settings → Environment Variables**:

- `NEXT_PUBLIC_API_BASE` = `https://random-words.trycloudflare.com`
  (no trailing slash, no `/api`)

Then **Deployments → ⋯ → Redeploy**. The address is built into the page, so
the redeploy is needed every time it changes.

---

## Notes

- **The quick-tunnel address changes every time `cloudflared` restarts**, which
  means repeating step 4. For a permanent address, create a named Cloudflare
  tunnel on a domain you add to Cloudflare.
- **The tunnel makes the backend public.** Anyone with the address can use it,
  including the race engineer, which runs on your LM Studio. Keep
  `GEMMA_TOKEN` set, stop the tunnel when you are not using it, and do not
  share the address.
- **Pushing to `main` redeploys the frontend automatically**; the backend runs
  whatever is checked out on your Mac.
- **Vercel preview deployments** use different addresses and are refused by
  the backend unless added to `APEX_CORS_ORIGINS`.
