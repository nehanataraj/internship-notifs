# Intern Tracker

Two-page companion app for the [Job_Notifier](https://github.com/nehanataraj/Job_Notifier) internship watcher.

| Page | URL | What it does |
|------|-----|--------------|
| **Companies** | [index.html](index.html) | All tracked companies — mark applied (grays out, moves to bottom); pink highlight when the watcher finds new jobs |
| **Calendar** | [calendar.html](calendar.html) | OA / interview deadlines — Telegram reminder **2 days before** each one |
| **Notes** | [notes.html](notes.html) | Per-company **markdown** prep notes with live preview + AI polish (OpenAI) |

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

### Option A — Settings (manual)

1. Open https://webapp-two-peach.vercel.app
2. Click **Settings**
3. Paste **bot token** and **chat ID** from `Job_Notifier/.env`
4. Click **Send test** — you should get a Telegram message and a **pink dot** next to Settings
5. Hard-refresh once if needed: **Ctrl+Shift+R** (Cmd+Shift+R on Mac)

### Option B — Magic link (one click)

From the `Job_Notifier` repo (with `.env` filled in):

```bash
cd /path/to/Job_Notifier
.venv/bin/python -c "
import base64, os
from dotenv import load_dotenv
load_dotenv()
payload = base64.b64encode(
    f\"{os.environ['TELEGRAM_BOT_TOKEN']}|{os.environ['TELEGRAM_CHAT_ID']}\".encode()
).decode()
print(f'https://webapp-two-peach.vercel.app/#cfg={payload}')
"
```

Open the printed URL once — settings save automatically and the hash is stripped from the address bar.

### Option C — Pin the sync message (first time only)

If the webapp has nothing to sync against yet, run once from `Job_Notifier`:

```bash
cd /path/to/Job_Notifier
.venv/bin/python scripts/bootstrap_pinned.py
```

This creates and pins the `JTRACK::` data message the app, watcher, and reminders all share.

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

## OpenAI (Notes AI editing)

The **Notes** tab uses GPT-4o-mini to polish, expand, or summarize markdown. The API key stays on the server — never in the browser or git.

**Vercel** (Project → Settings → Environment Variables):

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | Your OpenAI project key |

Redeploy after adding. Local dev: copy `.env.example` to `.env` and run `npx vercel dev`.

**Security:** If a key was ever pasted in chat or committed, rotate it at [platform.openai.com](https://platform.openai.com/api-keys).

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

Point visitors to a specific tab: `index.html`, `calendar.html`, or `notes.html` (append `?embed=1` for iframe).

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
