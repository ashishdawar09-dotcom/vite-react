#!/usr/bin/env bash
# Exports every public table (as JSON) and the player photos to a private
# folder outside the repo. The Free plan has no Supabase backups, so run this
# before each event:  bash scripts/backup-db.sh
# Needs the Supabase CLI logged in (`supabase login`). Output contains player
# contact details: keep it off shared drives.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${BACKUP_DIR:-$HOME/Developer/badminton-backups}/$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$OUT/photos"
chmod 700 "$(dirname "$OUT")" "$OUT"

TABLES=(tournaments categories players player_categories teams matches
  pending_registrations tournament_admins notification_log push_subscriptions
  match_audit_log)

for t in "${TABLES[@]}"; do
  supabase db query --linked \
    "select coalesce(json_agg(x), '[]'::json) as rows from public.$t x" 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); json.dump(d["rows"][0]["rows"], sys.stdout, indent=1, default=str)' \
    > "$OUT/$t.json"
  echo "$t: $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$OUT/$t.json") rows"
done

# Photos are public URLs stored on players.photo_url.
python3 - "$OUT" <<'EOF'
import json, os, sys, urllib.request
out = sys.argv[1]
n = 0
for p in json.load(open(os.path.join(out, "players.json"))):
    url = p.get("photo_url")
    if not url:
        continue
    name = url.split("/")[-1].split("?")[0]
    urllib.request.urlretrieve(url, os.path.join(out, "photos", name))
    n += 1
print(f"photos: {n}")
EOF

echo "Backup written to $OUT"
