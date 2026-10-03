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

- Dependencies are pinned (including `overrides`) to what that build used, and
  the rebuilt library code was byte-identical to production. `fast-uri` has
  since been raised to 3.1.8 for security fixes.
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

## Abuse protection

- Only the app's origins may connect (production, the Vercel alias, this team's
  preview deployments, localhost); everything else gets 403.
- `CONNECT_LIMITER`: 20 new sessions per client IP per minute (approximate, per
  Cloudflare location).
- Per connection: at most one model call per second and 30 per 10 minutes;
  questions are cut to 300 characters.
- The app opens a fresh agent instance per panel session, so visitors never
  share conversation history.

## Known limitations

- `playerId` comes from the client and is a hint, not an authenticated identity.
  It only selects which public schedule to read out.
- "Thanks!" is answered with a tournament summary instead of a pleasantry.
