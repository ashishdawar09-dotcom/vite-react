// Serves api/snapshot.ts on http://localhost:8790/api/snapshot for local
// fallback tests (no CDN, so no caching). `kill -USR1 <pid>` toggles a
// failure mode that answers 502, the way a broken deploy or function would.
//
//   SUPABASE_URL=<scratch url> SUPABASE_PUBLISHABLE_KEY=<scratch key> \
//     node scripts/loadtest/local-endpoint.mjs

import http from "node:http";
import { GET } from "../../api/snapshot.ts";

const PORT = Number(process.env.PORT ?? 8790);
let failing = false;

process.on("SIGUSR1", () => {
  failing = !failing;
  console.log(`${new Date().toISOString()} endpoint ${failing ? "FAILING (502)" : "healthy"}`);
});

http
  .createServer(async (req, res) => {
    if (failing) {
      res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":"injected failure"}');
      return;
    }
    const r = await GET(new Request(`http://localhost${req.url}`));
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
  })
  .listen(PORT, () => console.log(`local endpoint on :${PORT} (pid ${process.pid})`));
