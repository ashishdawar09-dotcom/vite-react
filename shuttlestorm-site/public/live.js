// Live visitor count for the tournament directors (badminton app, Players
// tab: "N people on the website right now").
//
// While a page is open, it tells the tournament app which page it is, whether
// it's on screen and when it opened: once after the page loads, every 30
// seconds while it's on screen, when it goes to the background or comes back,
// and "bye" when it closes. A random id made fresh for each page load ties
// those messages together. Nothing is stored and there's no cookie, name or
// anything else that identifies the visitor. Sent with Supabase Realtime's
// broadcast API and the app's public (publishable) key. The message format
// matches src/lib/liveVisitors.ts in the app.
(function () {
  var API = "https://wdqooznwzesmjdvlcrxw.supabase.co/realtime/v1/api/broadcast";
  var KEY = "sb_publishable_sNQ90tNTCXIN7mhyfBDTTA_qwmtnSLX"; // public by design
  var TOPIC = "site:shuttlestorm";
  var EVERY = 30000;

  // Crawlers and page-speed tools aren't visitors.
  if (typeof fetch !== "function" || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview/i.test(navigator.userAgent || "")) return;

  var id;
  try {
    id = crypto.randomUUID();
  } catch (e) {
    id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  var since = Date.now();
  var path = location.pathname.toLowerCase().replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/+$/, "$1");
  var page = /^\/[a-z0-9\/-]{0,80}$/.test(path) ? path : "/other";
  var n = 0;
  var timer = 0;
  var started = false;

  function send(payload, keepalive) {
    n += 1;
    payload.id = id;
    payload.n = n;
    try {
      fetch(API, {
        method: "POST",
        keepalive: !!keepalive,
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ topic: TOPIC, event: "visitor", payload: payload, private: false }] }),
      }).catch(function () {});
    } catch (e) {
      // A visitor count is never worth breaking the page for.
    }
  }
  // "Bye" while the page goes away. A JSON request needs a CORS check first,
  // and Chrome drops it when the page navigates; a beacon with a form-encoded
  // body and the key in the address needs none, so it goes out.
  function bye() {
    n += 1;
    try {
      if (navigator.sendBeacon) {
        var body = new URLSearchParams();
        body.append("messages[][topic]", TOPIC);
        body.append("messages[][event]", "visitor");
        body.append("messages[][payload][id]", id);
        body.append("messages[][payload][n]", String(n));
        body.append("messages[][payload][bye]", "true");
        if (navigator.sendBeacon(API + "?apikey=" + encodeURIComponent(KEY), body)) return;
      }
    } catch (e) {
      // Fall back below.
    }
    n -= 1;
    send({ bye: true }, true);
  }
  function onScreen() {
    return document.visibilityState !== "hidden";
  }
  function here() {
    send({ at: page, visible: onScreen(), since: since });
  }
  // Every 30 s while on screen; a page in the background says so once.
  function schedule() {
    clearInterval(timer);
    timer = onScreen() ? setInterval(here, EVERY) : 0;
  }
  function start() {
    if (started) return;
    started = true;
    here();
    schedule();
    document.addEventListener("visibilitychange", function () {
      here();
      schedule();
    });
    addEventListener("pagehide", bye);
    addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      here();
      schedule();
    });
  }
  // After the page has loaded (or 3 s at most), so it never slows the page down.
  if (document.readyState === "complete") start();
  else {
    addEventListener("load", start, { once: true });
    setTimeout(start, 3000);
  }
})();
