/* WhatsApp chat button for shuttlestorm.adawar.org.
 *
 * A floating button, bottom right, that opens a small card and then WhatsApp
 * itself, with a message to the club number already typed. The conversation
 * happens in the visitor's own WhatsApp (they keep the reply even after
 * leaving the site); the club answers from its WhatsApp. Nothing third-party
 * is loaded; opening the card and starting a chat are counted in Google
 * Analytics through consent.js, when the visitor allows analytics.
 *
 * Steps aside while the phone menu is open or the cookie banner is showing.
 * Include on every page: <script src="/chat.js" defer></script>
 */
(function () {
  "use strict";
  if (window.__ssChat) return;
  window.__ssChat = true;

  var NUMBER = "919818338393"; // the club's WhatsApp (Evolution instance "shuttlestorm")
  var MESSAGE = "Hi Shuttle Storm! I have a question about Shuttle Storm '26: ";
  var EMAIL = "ShuttleStorm@outlook.com";
  var NUDGE_KEY = "ss-chat-nudged";
  var NUDGE_DAYS = 7;

  var WA = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  var MARK = '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><rect width="120" height="120" rx="26" fill="#0C1018"/><g color="#D4FF3A"><path d="M16 78 A46 46 0 0 1 50 15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".6"/><path d="M104 42 A46 46 0 0 1 70 105" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".6"/><g transform="rotate(32 60 60)"><path d="M33 24 L87 24 L71 82 L49 82 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><path d="M66 28 L50 56 L60 56 L53 79 L72 48 L62 48 L70 28 Z" fill="currentColor"/><circle cx="60" cy="94" r="12" fill="currentColor"/></g></g></svg>';

  var css =
    ".ssw{--ink:#06080D;--ink2:#0C1018;--bone:#ECEEF2;--body:#C4CAD6;--mute:#8F97A8;--volt:#D4FF3A;--wa:#25D366;--line:rgba(236,238,242,.14);" +
    "position:fixed;z-index:900;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));" +
    "font-family:'Archivo','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;color:var(--bone)}" +
    ".ssw *{box-sizing:border-box}" +
    // Separate rules: a browser without :has() drops only that one.
    "html.ss-menu-lock .ssw{display:none}" +
    "html:has(body > .consent) .ssw{display:none}" +
    "html.intro .ssw{visibility:hidden}" +
    "@media print{.ssw{display:none}}" +
    // Room at the end of the page, so the last footer links scroll clear of
    // the button (wide screens centre the footer well away from it).
    "@media (max-width:1240px){body::after{content:'';display:block;height:calc(66px + max(16px,env(safe-area-inset-bottom,0px)))}}" +
    "@media print{body::after{display:none}}" +
    // The site rounds focused links and buttons to 4px; keep the shapes.
    ".ssw .ssw-launch:focus-visible,.ssw .ssw-nudge button:focus-visible{border-radius:50%}" +
    ".ssw .ssw-cta:focus-visible{border-radius:999px}" +
    ".ssw-launch{position:relative;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;display:grid;place-items:center;" +
    "background:var(--wa);color:#fff;box-shadow:0 10px 30px -8px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08) inset;" +
    "transition:transform .2s ease,box-shadow .2s ease,opacity .3s ease;touch-action:manipulation;-webkit-tap-highlight-color:transparent}" +
    ".ssw-launch svg{width:30px;height:30px}" +
    ".ssw-launch:focus-visible{outline:2px solid var(--volt);outline-offset:4px}" +
    "@media (hover:hover){.ssw-launch:hover{transform:translateY(-2px);box-shadow:0 14px 34px -8px rgba(0,0,0,.65)}}" +
    ".ssw-enter{opacity:0;transform:translateY(12px) scale(.9)}" +
    ".ssw-launch .x{display:none;font-size:26px;line-height:1;font-weight:300}" +
    ".ssw.open .ssw-launch svg{display:none}.ssw.open .ssw-launch .x{display:block}" +
    ".ssw-nudge{position:absolute;right:70px;bottom:8px;width:max-content;max-width:min(240px,calc(100vw - 110px));" +
    "background:var(--bone);color:var(--ink);border-radius:16px 16px 4px 16px;padding:11px 34px 11px 14px;font-size:14.5px;line-height:1.35;" +
    "box-shadow:0 12px 30px -10px rgba(0,0,0,.6);cursor:pointer;animation:ssw-pop .35s cubic-bezier(.2,.7,.2,1)}" +
    ".ssw-nudge b{font-weight:600}" +
    ".ssw-nudge button{position:absolute;top:4px;right:4px;width:26px;height:26px;border:0;border-radius:50%;background:transparent;color:#5b6170;font-size:16px;cursor:pointer;line-height:1}" +
    ".ssw-panel{position:absolute;right:0;bottom:72px;width:min(340px,calc(100vw - 32px));background:var(--ink2);" +
    "border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 24px 60px -18px rgba(0,0,0,.75);" +
    "transform-origin:100% 100%;animation:ssw-pop .28s cubic-bezier(.2,.7,.2,1)}" +
    ".ssw-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);" +
    "background:radial-gradient(120% 140% at 100% 0,rgba(212,255,58,.10),transparent 60%)}" +
    ".ssw-head svg{width:40px;height:40px;border-radius:11px;flex:0 0 auto}" +
    ".ssw-name{font-weight:600;font-size:16px;letter-spacing:.01em}" +
    ".ssw-status{display:flex;align-items:center;gap:7px;margin-top:3px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}" +
    ".ssw-status i{width:7px;height:7px;border-radius:50%;background:var(--wa);box-shadow:0 0 0 3px rgba(37,211,102,.18)}" +
    ".ssw-body{padding:18px}" +
    ".ssw-bubble{background:rgba(236,238,242,.06);border:1px solid var(--line);border-radius:4px 16px 16px 16px;padding:12px 14px;font-size:15px;line-height:1.5;color:var(--body)}" +
    ".ssw-bubble strong{color:var(--bone);font-weight:600}" +
    ".ssw-cta{margin-top:16px;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;border-radius:999px;" +
    "background:var(--wa);color:#05210f;font-weight:700;font-size:15px;letter-spacing:.02em;text-decoration:none;transition:filter .2s ease}" +
    ".ssw-cta svg{width:20px;height:20px}" +
    "@media (hover:hover){.ssw-cta:hover{filter:brightness(1.06)}}" +
    ".ssw-cta:focus-visible{outline:2px solid var(--volt);outline-offset:3px}" +
    ".ssw-foot{margin-top:12px;font-size:12.5px;line-height:1.5;color:var(--mute);text-align:center}" +
    ".ssw-foot a{color:var(--body)}" +
    "@keyframes ssw-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion:reduce){.ssw *{animation:none!important;transition:none!important}}";

  // Google Analytics only. The privacy page limits the Meta Pixel to page
  // visits and registration counts, so chats aren't sent to Meta.
  function track(action) {
    try { if (window.gtag) window.gtag("event", "whatsapp_chat", { action: action, page: location.pathname }); } catch (e) { /* analytics off */ }
  }

  function build() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var root = document.createElement("div");
    root.className = "ssw";
    var link = "https://wa.me/" + NUMBER + "?text=" + encodeURIComponent(MESSAGE);
    root.innerHTML =
      '<div class="ssw-panel" id="ssw-panel" role="dialog" aria-modal="false" aria-labelledby="ssw-name" hidden>' +
        '<div class="ssw-head">' + MARK +
          '<div><div class="ssw-name" id="ssw-name">Shuttle Storm</div>' +
          '<div class="ssw-status"><i></i>Usually replies same day</div></div>' +
        "</div>" +
        '<div class="ssw-body">' +
          '<div class="ssw-bubble">Hi! 👋 Ask us anything about <strong>Shuttle Storm ’26</strong>: entries, finding a partner, the venue or payments.</div>' +
          '<a class="ssw-cta" href="' + link + '" target="_blank" rel="noopener">' + WA + "Chat on WhatsApp</a>" +
          '<div class="ssw-foot">Opens WhatsApp. Prefer email? <a href="mailto:' + EMAIL + '">' + EMAIL + "</a></div>" +
        "</div>" +
      "</div>" +
      '<button type="button" class="ssw-launch ssw-enter" aria-label="Chat with Shuttle Storm on WhatsApp" aria-expanded="false" aria-controls="ssw-panel">' +
        WA + '<span class="x" aria-hidden="true">×</span></button>';
    document.body.appendChild(root);

    var panel = root.querySelector(".ssw-panel");
    var launch = root.querySelector(".ssw-launch");
    var cta = root.querySelector(".ssw-cta");
    var nudge = null;

    function dropNudge(remember) {
      if (nudge) { nudge.remove(); nudge = null; }
      if (remember) { try { localStorage.setItem(NUDGE_KEY, String(Date.now())); } catch (e) { /* storage off */ } }
    }
    function open() {
      dropNudge(true);
      panel.hidden = false;
      root.classList.add("open");
      launch.setAttribute("aria-expanded", "true");
      launch.setAttribute("aria-label", "Close chat");
      track("open");
      setTimeout(function () { cta.focus({ preventScroll: true }); }, 30);
    }
    function close(focusLauncher) {
      panel.hidden = true;
      root.classList.remove("open");
      launch.setAttribute("aria-expanded", "false");
      launch.setAttribute("aria-label", "Chat with Shuttle Storm on WhatsApp");
      if (focusLauncher) launch.focus({ preventScroll: true });
    }
    launch.addEventListener("click", function () { panel.hidden ? open() : close(false); });
    cta.addEventListener("click", function () { track("start"); setTimeout(function () { close(false); }, 300); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(true); });
    // composedPath is fixed when the tap happens, so a tap on the hint (which
    // removes itself as it opens the card) still counts as inside.
    document.addEventListener("click", function (e) {
      if (!panel.hidden && e.composedPath().indexOf(root) === -1) close(false);
    });

    // Fade the button in once the page has settled, so it never competes
    // with the first paint.
    requestAnimationFrame(function () { setTimeout(function () { launch.classList.remove("ssw-enter"); }, 600); });

    // One gentle hint per week: after 12 s on a page or once a third of it
    // has been scrolled, whichever comes first.
    var last = 0;
    try { last = Number(localStorage.getItem(NUDGE_KEY) || 0); } catch (e) { /* storage off */ }
    if (Date.now() - last > NUDGE_DAYS * 864e5) {
      var shown = false;
      var show = function () {
        if (shown || !panel.hidden) return;
        shown = true;
        window.removeEventListener("scroll", onScroll);
        nudge = document.createElement("div");
        nudge.className = "ssw-nudge";
        nudge.setAttribute("role", "status");
        nudge.innerHTML = "<b>Questions?</b> Chat with us on WhatsApp" + '<button type="button" aria-label="Dismiss">×</button>';
        nudge.addEventListener("click", function (e) {
          if (e.target.closest("button")) { e.stopPropagation(); dropNudge(true); return; }
          open();
        });
        root.appendChild(nudge);
        // Out of the way again after a few seconds; the button stays.
        setTimeout(function () { dropNudge(true); }, 10000);
      };
      var onScroll = function () {
        var h = document.documentElement.scrollHeight - innerHeight;
        if (h > 0 && scrollY / h > 0.33) show();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      setTimeout(show, 12000);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
