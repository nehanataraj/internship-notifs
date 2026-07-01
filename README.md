# Intern Tracker

Companion app for the [Job_Notifier](https://github.com/nehanataraj/Job_Notifier) internship watcher.

| Page | URL | What it does |
|------|-----|--------------|
| **Companies** | [index.html](index.html) | All tracked companies — mark applied (grays out, moves to bottom); pink highlight when the watcher finds new jobs |
| **Calendar** | [calendar.html](calendar.html) | OA / interview deadlines — Telegram reminder **2 days before** each one |
| **Resume** | [resume.html](resume.html) | Tailor resume to a JD (~10 keyword swaps) — save once, download **PDF** |

**Live app (recommended):** https://webapp-two-peach.vercel.app  
**GitHub Pages mirror:** https://nehanataraj.github.io/internship-notifs/

Use the Vercel URL — it includes the API proxy browsers need for Telegram sync.

---

## One bot for everything

Use **the same bot** as your job watcher (`TELEGRAM_BOT_TOKEN` in `Job_Notifier/.env`).

| Bot | Role |
|-----|------|
| **InternshipJobWatcherBot** | Job alerts, pinned sync data, webapp sync, calendar reminders — **use this one** |
| Any other bot (e.g. InternshipNotifBot) | Can send test messages only — **cannot** read/update the pinned sync message |

**Chat ID:** your numeric Telegram user id (same as `TELEGRAM_CHAT_ID` in `.env`).

---

## Quick setup

The bot token lives **only** server-side (Vercel env vars) — there's nothing to paste into the app itself anymore.

### If you're using the live deployer's instance

Nothing to do — sync is on by default. Open Settings → **Send test** just to confirm you get a **pink dot** and a Telegram message. If it's gray, hard-refresh (**Ctrl+Shift+R** / Cmd+Shift+R on Mac).

### If you're deploying your own copy

1. Deploy this repo to Vercel (`npx vercel --prod` from this folder, or connect the repo in the Vercel dashboard).
2. Project → **Settings → Environment Variables**, add:

   | Variable | Value |
   |----------|-------|
   | `TELEGRAM_BOT_TOKEN` | Same bot token as your watcher's `Job_Notifier/.env` |
   | `TELEGRAM_CHAT_ID` | Same chat id as `.env` |

3. Redeploy so the new env vars take effect.
4. Open your deployment → Settings → **Send test** — you should get a Telegram message and a pink dot.
5. First time only, pin the shared sync message (run once from `Job_Notifier`, with `.env` filled in):

   ```bash
   cd /path/to/Job_Notifier
   .venv/bin/python scripts/bootstrap_pinned.py
   ```

   This creates and pins the `JTRACK::` data message the app, watcher, and reminders all share.

**Heads up — this is single-tenant.** Whoever's `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` is set on a given Vercel deployment is who all sync/test-message traffic goes to, for *every* visitor to that URL. There's no per-visitor login. If you want your own private sync, deploy your own copy as above rather than using someone else's live URL.

---

## How sync works

```
Job watcher (main.py)
    → sends job alert messages
    → updates pinned message (notified slugs → pink highlights on Companies page)

Webapp (browser)
    → reads/writes same pinned message via Vercel API proxy
    → also keeps localStorage for offline speed

GitHub Actions (remind.py, daily cron)
    → reads deadlines from pinned message
    → sends Telegram reminder 2 days before each OA/interview
```

**Pinned message format** (do not unpin or delete):

```
Internship tracker data — do not unpin or delete
JTRACK::{"applied":{},"notified":{},"notes":{},"deadlines":[],"updatedAt":0}
```

---

## GitHub Actions secrets

Repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret | Value |
|--------|-------|
| `TELEGRAM_BOT_TOKEN` | Same token as `Job_Notifier/.env` |
| `TELEGRAM_CHAT_ID` | Same chat id as `.env` |

The daily workflow (`.github/workflows/remind.yml`) runs `remind.py` on a cron.

---

## Embed on your website

Add Intern Tracker as a feature on any site via link or iframe:

```html
<!-- Link -->
<a href="https://webapp-two-peach.vercel.app/">Intern Tracker</a>

<!-- Embedded (compact chrome) -->
<iframe
  src="https://webapp-two-peach.vercel.app/?embed=1"
  title="Intern Tracker"
  width="100%"
  height="720"
  style="border:1px solid #ECE4E8;border-radius:10px;max-width:1040px;"
></iframe>
```

Point visitors to a specific tab: `index.html`, `calendar.html`, or `resume.html` (append `?embed=1` for iframe).

---

## Resume tailor (Fly.io backend)

Adapted from [aanil677/resume_tailor](https://github.com/aanil677/resume_tailor). Uses **OpenAI** (not Gemini). Paste markdown resume once, save, tailor per job, download PDF.

**Deploy the API** (one-time):

```bash
cd webapp/resume_tailor
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly launch --no-deploy   # app name: resume-tailor
fly secrets set OPENAI_API_KEY=sk-...
fly deploy
```

**Vercel env** (Project → Settings → Environment Variables):

| Variable | Value |
|----------|-------|
| `RESUME_API_URL` | `https://resume-tailor.fly.dev` (your Fly app URL) |

Redeploy Vercel after setting. The Resume tab calls `/api/resume/*` which proxies to Fly.

**Local API test:**

```bash
cd webapp/resume_tailor
cp .env.example .env   # add OPENAI_API_KEY
./run.sh               # or: uvicorn app.main:app --port 8765
```

---

## Refreshing the company list

`companies.json` is generated from the watcher config:

```bash
cd /path/to/Job_Notifier
.venv/bin/python scripts/build_webapp_data.py
cp companies.json webapp/companies.json   # if working from monorepo checkout
# then commit + push this repo
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Failed: Not Found · CORS relay unreachable` | Hard-refresh (Ctrl+Shift+R). Use **webapp-two-peach.vercel.app**, not old `internship-notifs.vercel.app` URLs |
| Test works but no pink dot | You may be on the wrong bot — switch to **InternshipJobWatcherBot** (see above) |
| `Bot token looks invalid` | Paste only the token line from BotFather (`123456789:ABC…`), not the whole message |
| Sync dot gray after reload | Open Settings → **Send test** again, or use the magic link |
| Job highlights not showing | Watcher and webapp must use the **same bot**; watcher calls `mark_company_notified()` after each alert |
| Resume tailor fails / 502 | Deploy Fly backend and set `RESUME_API_URL` on Vercel |

**Clear stale browser data:** DevTools → Application → Local Storage → delete `jt.proxy` if present, then reload.

---

## Local development

```bash
cd webapp
npx vercel dev          # serves static files + /api/telegram proxy
```

Deploy to Vercel:

```bash
npx vercel --prod
```

---

## Related repos

- **Job watcher:** https://github.com/nehanataraj/Job_Notifier
- **This webapp:** https://github.com/nehanataraj/internship-notifs
