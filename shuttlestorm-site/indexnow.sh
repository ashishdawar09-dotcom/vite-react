#!/bin/bash
# Tell Bing (and other IndexNow engines) that pages changed. Run after `npx wrangler deploy`.
# Usage: ./indexnow.sh            → submits every URL in public/sitemap.xml
#        ./indexnow.sh /rules ... → submits just those paths
cd "$(dirname "$0")"
KEY=$(cat .indexnow-key)
HOST=shuttlestorm.adawar.org
if [ $# -gt 0 ]; then URLS=$(printf '"https://%s%s",' $(for p in "$@"; do echo "$HOST $p"; done) | sed 's/,$//')
else URLS=$(grep -o '<loc>[^<]*</loc>' public/sitemap.xml | sed 's/<loc>\(.*\)<\/loc>/"\1"/' | paste -sd, -); fi
curl -s -o /dev/null -w "IndexNow: HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":[$URLS]}"
