#!/usr/bin/env python3
"""Daily deadline reminder.

Reads the tracker data from the pinned Telegram message (the webapp keeps it
there) and sends a reminder for every deadline exactly 2 days away.
Runs from GitHub Actions on a daily cron; needs TELEGRAM_BOT_TOKEN and
TELEGRAM_CHAT_ID env vars.
"""

import json
import os
import sys
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

MARKER = "JTRACK::"
TZ = ZoneInfo("America/New_York")
REMIND_DAYS = 2

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT = os.environ["TELEGRAM_CHAT_ID"]


def tg(method: str, params: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TOKEN}/{method}",
        data=json.dumps(params).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.loads(r.read())
    if not out.get("ok"):
        raise RuntimeError(f"{method}: {out}")
    return out["result"]


def main() -> int:
    chat = tg("getChat", {"chat_id": CHAT})
    pinned = chat.get("pinned_message") or {}
    text = pinned.get("text") or ""
    idx = text.find(MARKER)
    if idx == -1:
        print("No tracker data pinned yet; nothing to do.")
        return 0

    data = json.loads(text[idx + len(MARKER):])
    deadlines = data.get("deadlines") or []
    today = datetime.now(TZ).date()

    due = []
    for ev in deadlines:
        try:
            d = date.fromisoformat(ev["date"])
        except (KeyError, ValueError):
            continue
        if (d - today).days == REMIND_DAYS:
            due.append(ev)

    if not due:
        print(f"{len(deadlines)} deadlines tracked; none due in {REMIND_DAYS} days.")
        return 0

    lines = [f"Reminder — due in {REMIND_DAYS} days:"]
    for ev in sorted(due, key=lambda e: (e.get("time") or "99:99")):
        d = date.fromisoformat(ev["date"])
        when = d.strftime("%a, %b %d")
        if ev.get("time"):
            when += f" at {ev['time']}"
        line = f"  • {ev.get('company', '?')} — {ev.get('kind', 'Deadline')} ({when})"
        if ev.get("notes"):
            line += f"\n    {ev['notes']}"
        lines.append(line)

    tg("sendMessage", {"chat_id": CHAT, "text": "\n".join(lines)})
    print(f"Sent reminder for {len(due)} deadline(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
