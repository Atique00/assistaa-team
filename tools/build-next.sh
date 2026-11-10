#!/usr/bin/env bash
# Builds the TEST copy of the app at /next/ (team.assistaa.com/next/), running on Supabase.
# Same code as the live app; only config, storage prefix, manifest and a TEST label differ.
# Run from the repo root:  bash tools/build-next.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf next && mkdir -p next/js next/css
cp -r assets icons next/
cp css/app.css next/css/
cp js/app.js next/js/
cp firebase-messaging-sw.js next/
sed -i "s/'assistaa-v\([0-9]*\)'/'assistaa-next-v\1'/" next/firebase-messaging-sw.js

API=https://zciuchdximmzwiisdkqu.supabase.co/functions/v1/team-api
python3 - "$API" <<'PY'
import re, sys
api = sys.argv[1]
c = open('js/config.js').read()
c = re.sub(r"url: 'https://script\.google\.com/macros/s/[^']+'", lambda m, it=iter(['store', 'support']): f"url: '{api}?team={next(it)}&forceFunctionRegion=ap-southeast-1'", c, count=2)
store = re.search(r"https://script\.google\.com/macros/s/[^']+", open('js/config.js').read()).group(0)
c = c.replace("owner: 'Atiq',", f"owner: 'Atiq',\n  storagePrefix: 'assistaa-next.',\n  issuesUrl: '{store}?view=issues',\n  test: true,")
open('next/js/config.js', 'w').write("/* TEST copy (Supabase). Built by tools/build-next.sh: do not edit by hand. */\n" + c)

h = open('index.html').read()
h = h.replace('<title>Assistaa Team</title>', '<title>Assistaa Team · TEST</title>')
h = h.replace('</body>', '  <div style="position:fixed;top:calc(env(safe-area-inset-top) + 6px);left:50%;transform:translateX(-50%);z-index:9999;background:#ffb547;color:#1a1200;font:700 11px/1 Inter,sans-serif;letter-spacing:.08em;padding:5px 10px;border-radius:99px;pointer-events:none">TEST · NEW SYSTEM</div>\n</body>')
open('next/index.html', 'w').write(h)

m = open('manifest.webmanifest').read()
m = m.replace('"name": "Assistaa Team"', '"name": "Assistaa Team (TEST)"').replace('"short_name": "Assistaa"', '"short_name": "Assistaa TEST"')
m = m.replace('"start_url": "./",', '"id": "/next/",\n  "start_url": "./",')
open('next/manifest.webmanifest', 'w').write(m)
PY
echo "built next/ ->"; ls next next/js
