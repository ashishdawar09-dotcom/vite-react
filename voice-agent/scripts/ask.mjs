#!/usr/bin/env node
// Smoke test a deployed voice agent without a microphone: sends typed
// questions over the same WebSocket protocol the app uses and prints the
// spoken reply text plus how much audio came back.
//
//   node scripts/ask.mjs <host> <tournament-id-or-slug> "question" ["question" ...]
//
// Uses a separate room ("smoke-test") so it doesn't touch the app's history.

const [host, tournamentId, ...questions] = process.argv.slice(2);
if (!host || !tournamentId || questions.length === 0) {
  console.error('usage: node scripts/ask.mjs <host> <tournament> "question" ...');
  process.exit(2);
}

const url = `wss://${host}/agents/badminton-voice-agent/smoke-test?tournamentId=${encodeURIComponent(tournamentId)}`;

function ask(ws, text) {
  return new Promise((resolve, reject) => {
    let reply = "";
    let audioBytes = 0;
    let metrics = null;
    const timer = setTimeout(() => reject(new Error(`timeout: ${text}`)), 45_000);
    const onMessage = (ev) => {
      if (typeof ev.data !== "string") {
        audioBytes += ev.data.byteLength ?? ev.data.size ?? 0;
        return;
      }
      const msg = JSON.parse(ev.data);
      if (msg.type === "transcript" && msg.role === "assistant") reply = msg.text;
      if (msg.type === "transcript_end") reply = msg.text;
      if (msg.type === "metrics") metrics = msg;
      if (msg.type === "error") reply = `ERROR: ${msg.message}`;
      if ((msg.type === "status" && msg.status === "idle" && reply) || msg.type === "error") {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        // Let trailing audio frames arrive.
        setTimeout(() => resolve({ reply, audioBytes, metrics }), 1500);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ type: "text_message", text }));
  });
}

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), { once: true });
});
ws.send(JSON.stringify({ type: "hello", protocol_version: 1 }));

for (const q of questions) {
  try {
    const { reply, audioBytes, metrics } = await ask(ws, q);
    const ms = metrics ? ` ${metrics.total_ms}ms` : "";
    console.log(`Q: ${q}\nA: ${reply}\n   audio ${audioBytes} bytes${ms}\n`);
  } catch (e) {
    console.log(`Q: ${q}\nA: (${e.message})\n`);
  }
}
ws.close();
