# Claude Code guide for this repo

## Tools to use in every session

These are set up in the repo (`.mcp.json`, `.claude/settings.json`, `.claude/hooks/`, `.claude/skills/graphify/`), so every session gets them.

1. **21st MCP** (`21st` MCP server) — before hand-writing a new UI component, check 21st for a ready-made one (`get_inspiration`, `generate`), then adapt it to the app's existing styles. Needs `TWENTY_FIRST_API_KEY` set in the environment.
2. **Graphify** (`/graphify` skill, `graphify` CLI) — for architecture or "where is X / what touches Y" questions, use the graph first. Build it with `/graphify .` if `graphify-out/` is missing; refresh with `graphify update .` after big changes.
3. **Compound Engineering** (plugin) — structure non-trivial work as plan → work → review → compound using its commands/agents, and record learnings so the next task is easier.
4. **Playwright** (`playwright` MCP server) — after UI or routing changes, run the app (`npm run dev`) and check the changed user flows in the browser before calling the work done.

## Checks before pushing

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
