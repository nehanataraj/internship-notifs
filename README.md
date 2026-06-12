# Internship Mission Control

Two-page companion app for the Job_Notifier watcher.

- **The Board** (`index.html`) — every company the watcher tracks, with an
  "applied" checkbox. Applied companies gray out and drop to the bottom.
- **Deadlines** (`calendar.html`) — calendar for OAs / interviews / deadlines.
  A GitHub Actions cron (`remind.py`) pings Telegram **2 days before** each one.

## How sync works

State (applied flags + deadlines) is stored in `localStorage` and mirrored to a
**pinned message** in your Telegram chat with the bot. That makes the data
readable by the daily reminder workflow and shareable across devices — no
backend needed.

Configure once per device via the ⚙ settings (bot token + chat ID), or open a
`#cfg=…` magic link.

## Refreshing the company list

`companies.json` is generated from the watcher repo:

```
python scripts/build_webapp_data.py   # in the Job_Notifier repo
```

Copy the result here and push.

## Secrets (repo → Settings → Secrets → Actions)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
