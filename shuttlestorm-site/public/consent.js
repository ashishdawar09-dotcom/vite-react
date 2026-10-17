/*
 * Google Analytics 4 with Consent Mode v2.
 *
 * Usage: <script src="/consent.js" data-ga="G-XXXXXXXXXX" data-privacy="/privacy" [data-ads="on"] defer></script>
 * With data-ga empty, nothing loads and no banner shows.
 *
 * - Without data-ads="on", advertising storage is always denied.
 * - With data-ads="on" (sites we advertise with Google Ads), ad_storage and
 *   ad_user_data follow the same choice as analytics, so ad clicks can be
 *   tied to registrations. ad_personalization stays denied everywhere: no
 *   remarketing or personalised ads.
 * - Visitors who appear to be in the EEA, UK or Switzerland start with
 *   analytics denied and see a banner. Detection is the browser time zone;
 *   Google's IP-based regional default below is the backstop, so an EU
 *   visitor with a non-European clock still starts denied (cookieless pings).
 * - Everyone else starts granted. Anyone can change their choice through
 *   any element with data-consent-open (e.g. a "Cookie settings" link).
 * - Links marked data-track="event_name" send that GA event when clicked.
 */
(function () {
  var script = document.currentScript;
  var GA_ID = script && script.getAttribute("data-ga");
  var PRIVACY = (script && script.getAttribute("data-privacy")) || "/privacy";
  var ADS = !!script && script.getAttribute("data-ads") === "on";
  if (!GA_ID) return;

  var KEY = "analytics-consent"; // "granted" | "denied"
  var REGIONS = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", // EU
    "IS", "LI", "NO", // EEA
    "GB", "CH",
  ];

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  var europe = inEurope();
  // One choice drives analytics and, where enabled, ad measurement.
  function consentFor(v) {
    var ads = ADS ? v : "denied";
    return { analytics_storage: v, ad_storage: ads, ad_user_data: ads, ad_personalization: "denied" };
  }
  gtag("consent", "default", Object.assign(consentFor("denied"), { region: REGIONS, wait_for_update: 500 }));
  gtag("consent", "default", consentFor(europe ? "denied" : "granted"));

  function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } }

  var stored = read();
  if (stored === "granted" || stored === "denied") gtag("consent", "update", consentFor(stored));

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
  gtag("js", new Date());
  gtag("config", GA_ID);

  function inEurope() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      return /^Europe\//.test(tz) ||
        /^(Atlantic\/(Canary|Madeira|Azores|Faroe|Reykjavik)|Arctic\/Longyearbyen)$/.test(tz);
    } catch { return false; }
  }

  var banner;
  function close() { if (banner) { banner.remove(); banner = null; } }
  function choose(v) {
    write(v);
    gtag("consent", "update", consentFor(v));
    close();
  }

  function show() {
    if (banner) return;
    var style = document.getElementById("consent-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "consent-style";
      style.textContent =
        ".consent{position:fixed;z-index:1000;left:16px;right:16px;bottom:16px;max-width:560px;margin-inline:auto;" +
        "padding:18px 20px;border-radius:14px;background:#11141b;color:#eceef2;border:1px solid rgba(236,238,242,.16);" +
        "box-shadow:0 18px 50px rgba(0,0,0,.45);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
        ".consent p{margin:0 0 14px}.consent a{color:inherit;text-decoration:underline}" +
        ".consent-actions{display:flex;flex-wrap:wrap;gap:10px}" +
        ".consent button{font:inherit;font-weight:600;min-height:44px;padding:0 20px;border-radius:999px;cursor:pointer;" +
        "border:1px solid rgba(236,238,242,.35);background:transparent;color:inherit}" +
        ".consent button.yes{background:#eceef2;color:#06080d;border-color:#eceef2}" +
        ".consent button:focus-visible{outline:2px solid #d4ff3a;outline-offset:3px}";
      document.head.appendChild(style);
    }
    banner = document.createElement("div");
    banner.className = "consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", ADS ? "Analytics and advertising cookies" : "Analytics cookies");
    banner.innerHTML =
      (ADS
        ? '<p>We use Google Analytics and Google Ads cookies to count visits and see whether our ads lead to registrations. ' +
          'No personalised ads. The site works the same either way. <a href="' + PRIVACY + '">Privacy policy</a></p>'
        : '<p>We use Google Analytics cookies to count visits and see which pages are useful. ' +
          'No advertising. The site works the same either way. <a href="' + PRIVACY + '">Privacy policy</a></p>') +
      '<div class="consent-actions"><button type="button" class="yes">Accept</button>' +
      '<button type="button" class="no">Decline</button></div>';
    banner.querySelector(".yes").addEventListener("click", function () { choose("granted"); });
    banner.querySelector(".no").addEventListener("click", function () { choose("denied"); });
    document.body.appendChild(banner);
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  ready(function () {
    if (!stored && europe) show();
    document.addEventListener("click", function (e) {
      var el = e.target instanceof Element ? e.target : null;
      var t = el && el.closest("[data-consent-open]");
      if (t) { e.preventDefault(); show(); return; }
      // Links marked data-track="event_name" send that GA event on click.
      var tracked = el && el.closest("[data-track]");
      if (tracked) gtag("event", tracked.getAttribute("data-track"), { link_url: tracked.href || undefined });
    });
  });
})();
