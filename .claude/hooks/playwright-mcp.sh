#!/usr/bin/env bash
# Launches the Playwright MCP server. In Claude Code cloud sessions it uses the
# pre-installed Chromium; locally it falls back to Playwright's own browser.
set -euo pipefail
args=(--headless --isolated --output-dir "${CLAUDE_PROJECT_DIR:-.}/.playwright-mcp")
if [ -x /opt/pw-browsers/chromium ]; then
  args+=(--browser chromium --executable-path /opt/pw-browsers/chromium)
fi
exec npx -y @playwright/mcp@0.0.83 "${args[@]}"
