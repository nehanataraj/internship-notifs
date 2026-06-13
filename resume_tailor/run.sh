#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  echo "Tip: copy .env.example to .env and add GEMINI_API_KEY (free: https://aistudio.google.com/apikey)"
fi

exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
