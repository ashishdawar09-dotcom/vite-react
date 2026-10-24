#!/usr/bin/env bash
# SessionStart hook: makes the graphify CLI available in every session.
# (21st MCP and Playwright MCP are in .mcp.json; Compound Engineering is in .claude/settings.json.)
set -uo pipefail
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install --quiet graphifyy >/dev/null 2>&1 || echo "graphify: uv install failed" >&2
  else
    python3 -m pip install --quiet --user graphifyy >/dev/null 2>&1 || echo "graphify: pip install failed" >&2
  fi
fi
exit 0
