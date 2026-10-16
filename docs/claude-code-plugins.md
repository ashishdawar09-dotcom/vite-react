# Claude Code plugins

The five tools from the "You're using Claude Code wrong" carousel
(@ux.ui_lady, 9 Oct 2026). Three are Claude Code plugins and are wired into
`.claude/settings.json`, so Claude Code offers to install them the first time
you trust this repo. The other two are local proxies, not plugins: each
developer runs them on their own machine.

| # | Tool | What it does | How it's set up here |
|---|------|--------------|----------------------|
| 1 | [OmniRoute](https://github.com/diegosouzapw/OmniRoute) | AI gateway: routes Claude Code across providers/models with quota-aware fallback | Local only, see below |
| 2 | [claude-mem](https://github.com/thedotmack/claude-mem) | Persistent memory of the project across sessions | `claude-mem@thedotmack` in `.claude/settings.json` |
| 3 | [Headroom](https://github.com/chopratejas/headroom) | Compresses tool output and context so sessions use fewer tokens | Local only, see below |
| 4 | [claude-code-setup](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup) | Anthropic's plugin: scans the repo and recommends hooks, skills, MCP servers and subagents | `claude-code-setup@claude-plugins-official` in `.claude/settings.json` |
| 5 | [Task Observer](https://github.com/rebelytics/one-skill-to-rule-them-all) | Logs your corrections during a session and proposes them as skill improvements (you approve each one) | `task-observer@one-skill-to-rule-them-all` in `.claude/settings.json` |

## Plugins (2, 4, 5)

Open Claude Code in the repo and accept the plugin prompt, or install by hand:

```
/plugin install claude-code-setup@claude-plugins-official
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem@thedotmack
/plugin marketplace add rebelytics/one-skill-to-rule-them-all
/plugin install task-observer@one-skill-to-rule-them-all
```

Notes:

- **claude-mem** needs Node 18+; it installs Bun, uv and SQLite on first run
  and keeps its data in `~/.claude-mem/`. Licence is AGPL-3.0.
- **claude-code-setup** only recommends; it doesn't change config itself.
  Run it once and decide what to adopt.
- **Task Observer** under-triggers on its own. To make it run every session,
  add the activation line from its
  [`references/environments.md`](https://github.com/rebelytics/one-skill-to-rule-them-all/blob/main/references/environments.md)
  to your personal `~/.claude/CLAUDE.md`. It writes observation files to disk,
  so this is left opt-in rather than forced on everyone via a project CLAUDE.md.

## Local proxies (1, 3)

Both work by sitting between Claude Code and the API, i.e. via
`ANTHROPIC_BASE_URL`. That is deliberately **not** set in the shared
settings: if the proxy isn't running, Claude Code fails for everyone. Put it
in `.claude/settings.local.json` (gitignored) or your shell instead.

**Headroom**

```bash
pip install "headroom-ai[all]"
headroom wrap claude        # launches Claude Code with compression; undo: headroom unwrap claude
# or: headroom proxy --port 8787, then ANTHROPIC_BASE_URL=http://localhost:8787
```

Headline savings (60–95%) are the project's own best-case numbers on
structured data; expect less on ordinary coding sessions.

**OmniRoute**

Install and start it per its README (it serves on port 20128), then either:

```bash
omniroute launch                                  # starts Claude Code wired to the gateway
# or set it yourself — gateway root, no /v1 suffix:
export ANTHROPIC_BASE_URL=http://localhost:20128
```

Things to know before using it:

- It holds your provider credentials and sees every prompt and response,
  including code and any Supabase keys that show up in a session.
- Routing a Claude subscription through a third-party gateway, rotating
  accounts to dodge rate limits, or its "TLS stealth" mode may break the
  providers' terms and get accounts suspended. Using your
  own API keys for each provider is the safe setup.
- If you run both proxies, chain them (Claude Code → Headroom → OmniRoute)
  rather than pointing `ANTHROPIC_BASE_URL` at both.
