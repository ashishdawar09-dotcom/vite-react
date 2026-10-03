# Badminton voice agent

Cloudflare Worker + Durable Object behind the app's mic button
(`src/features/voice/VoiceWidget.tsx`, `VITE_VOICE_WORKER_URL`).

- Speech in: Workers AI `@cf/deepgram/flux`
- Tool choice: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Speech out: `@cf/deepgram/aura-1` (asteria)
- Data: the public `live_snapshot` RPC, read with the anon key. Read-only.

The model only picks one of nine tools; every answer is built deterministically
from live data in `src/tools.ts`.

## Provenance

The original project was never committed. This source was rebuilt on
2 October 2026 from the Worker deployed on 23 July 2026:

- Dependencies are pinned (including `overrides`) to what that build used. The
  rebuilt bundle's library code is byte-identical to production.
- `test/parity.test.ts` checks every answer function against the deployed logic
  kept in `test/reference/`.
- Live and staging gave identical replies and audio for the same questions.

## Workers

| Worker | URL |
|---|---|
| `badminton-voice-agent` (production) | https://badminton-voice-agent.ashishdawar09.workers.dev |
| `badminton-voice-agent-staging` | https://badminton-voice-agent-staging.ashishdawar09.workers.dev |

Both need the `SUPABASE_ANON_KEY` secret (`wrangler secret put SUPABASE_ANON_KEY [--env staging]`).

## Workflow

```bash
npm ci
npm test                    # parity tests
npm run typecheck
npm run deploy:staging      # test here first
node scripts/ask.mjs badminton-voice-agent-staging.ashishdawar09.workers.dev sg-club-tournament "Who is leading group A?"
npm run deploy              # production
```

`scripts/ask.mjs` sends typed questions over the app's WebSocket protocol, so a
deploy can be checked without a microphone.

## Known issues (inherited from the July build)

- All visitors share one agent room (`default`), whose stored history feeds the
  last four messages to the model, so separate users' questions can mix.
- `playerId` comes from the client and is a hint, not an authenticated identity.
- CORS is open (`cors: true`) and there is no rate limiting.
- "Thanks!" is answered with a tournament summary instead of a pleasantry.
