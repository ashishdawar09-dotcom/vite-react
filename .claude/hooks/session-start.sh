#!/usr/bin/env bash
# SessionStart hook: makes the graphify CLI available in every session.
# (21st MCP and Playwright MCP are in .mcp.json; Compound Engineering is in .claude/settings.json.)
# graphify needs Python >= 3.10; macOS ships 3.9, so install it with uv, which fetches its own Python.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
command -v graphify >/dev/null 2>&1 && exit 0
if ! command -v uv >/dev/null 2>&1; then
  python3 -m pip install --quiet --user uv >/dev/null 2>&1 || { echo "graphify: could not install uv" >&2; exit 0; }
  export PATH="$(python3 -m site --user-base)/bin:$PATH"
fi
uv tool install --quiet graphifyy >/dev/null 2>&1 || echo "graphify: uv install failed" >&2
exit 0
