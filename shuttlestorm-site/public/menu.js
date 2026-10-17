/*
 * Shuttle Storm phone/tablet menu.
 * Pages carry a <button data-menu-toggle> in the header (shown by CSS on narrow
 * screens); this script builds the full-screen menu once and wires it up.
 * The link list lives here so every page gets the same menu.
 */
(function () {
  var LINKS = [
    ["/", "Home"],
    ["/about", "About"],
    ["/founders", "Founders"],
    ["/sponsors", "Sponsors"],
    ["/categories", "Categories"],
    ["/register", "Register & fees"],
    ["/venue", "Venue"],
    ["/faq", "FAQ"],
    ["/rules", "Rules"]
  ];
  var REGISTER = "https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb";

  function init() {
    var toggle = document.querySelector("[data-menu-toggle]");
    if (!toggle) return;
    var root = document.documentElement;
    var here = location.pathname.replace(/\/index\.html$/, "/").replace(/(.)\/$/, "$1");

    var css = document.createElement("style");
    css.textContent =
      ".ss-menu{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;background:radial-gradient(ellipse at 85% 0%,rgba(212,255,58,.08),rgba(6,8,13,0) 55%),radial-gradient(ellipse at 0% 100%,rgba(107,134,255,.12),rgba(6,8,13,0) 55%),#06080D;color:#ECEEF2;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);visibility:hidden;opacity:0;transition:opacity .35s ease,visibility 0s linear .35s}" +
      ".ss-menu.open{visibility:visible;opacity:1;transition:opacity .35s ease}" +
      ".ss-menu-top{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:72px;padding:0 clamp(16px,4vw,48px);border-bottom:1px solid rgba(236,238,242,.12)}" +
      ".ss-menu-top .ss-brand{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}" +
      ".ss-menu-top .ss-brand b{font-family:'Archivo','Helvetica Neue',Arial,sans-serif;font-weight:600;font-stretch:125%;font-size:13px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}" +
      ".ss-close{width:44px;height:44px;border-radius:50%;border:1px solid currentColor;background:none;color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}" +
      ".ss-menu-list{flex:1;overflow-y:auto;overscroll-behavior:contain;list-style:none;margin:0;padding:8px clamp(16px,4vw,48px) 0;counter-reset:ss}" +
      ".ss-menu-list li{border-bottom:1px solid rgba(236,238,242,.12);opacity:0;transform:translateY(14px);transition:opacity .45s ease,transform .6s cubic-bezier(.2,.7,.2,1);transition-delay:calc(var(--i) * 35ms + 60ms)}" +
      ".ss-menu.open .ss-menu-list li{opacity:1;transform:none}" +
      ".ss-menu-list a{display:flex;align-items:baseline;gap:16px;padding:13px 0;color:#ECEEF2;text-decoration:none;font-family:'Archivo','Helvetica Neue',Arial,sans-serif;font-weight:200;font-stretch:118%;text-transform:uppercase;font-size:clamp(28px,7.4vw,46px);line-height:1;letter-spacing:-.01em}" +
      ".ss-menu-list a::before{counter-increment:ss;content:counter(ss,decimal-leading-zero);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.16em;color:#8F97A8;min-width:22px;transform:translateY(-.9em)}" +
      ".ss-menu-list a[aria-current=page]{color:#D4FF3A}" +
      ".ss-menu-list a:active{color:#D4FF3A}" +
      ".ss-menu-foot{padding:20px clamp(16px,4vw,48px) 24px;display:flex;flex-direction:column;gap:14px}" +
      ".ss-menu-cta{display:flex;align-items:center;justify-content:center;gap:12px;min-height:54px;border-radius:999px;background:#D4FF3A;color:#06080D;font-family:'Archivo','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:14px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none}" +
      ".ss-menu-meta{display:flex;justify-content:space-between;gap:12px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8F97A8}" +
      ".ss-menu-meta a{color:inherit;text-decoration:none;margin-left:14px}" +
      "html.ss-menu-lock,html.ss-menu-lock body{overflow:hidden}" +
      "@media (prefers-reduced-motion:reduce){.ss-menu,.ss-menu-list li{transition:none!important}}";
    document.head.appendChild(css);

    var brand = document.querySelector("header .brand svg");
    var menu = document.createElement("div");
    menu.className = "ss-menu";
    menu.id = "ss-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-label", "Site menu");
    menu.innerHTML =
      '<div class="ss-menu-top"><a class="ss-brand" href="/">' + (brand ? brand.outerHTML : "") + "<b>Shuttle Storm</b></a>" +
      '<button type="button" class="ss-close" aria-label="Close menu"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3l12 12M15 3L3 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
      '<ul class="ss-menu-list">' +
      LINKS.map(function (l, i) {
        return '<li style="--i:' + i + '"><a href="' + l[0] + '"' + (l[0] === here ? ' aria-current="page"' : "") + ">" + l[1].replace("&", "&amp;") + "</a></li>";
      }).join("") +
      "</ul>" +
      '<div class="ss-menu-foot"><a class="ss-menu-cta" data-track="begin_registration" href="' + REGISTER + '">Register now <span aria-hidden="true">→</span></a>' +
      '<div class="ss-menu-meta"><span>Sat Nov 21 · UFV North Gym</span><span><a href="https://www.instagram.com/shuttlstorm/" target="_blank" rel="me noopener">IG ↗</a><a href="https://www.facebook.com/profile.php?id=61595251802328" target="_blank" rel="me noopener">FB ↗</a></span></div></div>';
    document.body.appendChild(menu);

    var close = menu.querySelector(".ss-close");
    toggle.setAttribute("aria-controls", "ss-menu");
    toggle.setAttribute("aria-expanded", "false");

    function focusables() {
      return Array.prototype.slice.call(menu.querySelectorAll("a[href],button"));
    }
    function open() {
      menu.classList.add("open");
      root.classList.add("ss-menu-lock");
      toggle.setAttribute("aria-expanded", "true");
      if (window.ssLenis) window.ssLenis.stop();
      setTimeout(function () { close.focus(); }, 30);
    }
    function shut(restoreFocus) {
      if (!menu.classList.contains("open")) return;
      menu.classList.remove("open");
      root.classList.remove("ss-menu-lock");
      toggle.setAttribute("aria-expanded", "false");
      if (window.ssLenis) window.ssLenis.start();
      if (restoreFocus) toggle.focus();
    }
    toggle.addEventListener("click", open);
    close.addEventListener("click", function () { shut(true); });
    menu.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (a) shut(false);
    });
    document.addEventListener("keydown", function (e) {
      if (!menu.classList.contains("open")) return;
      if (e.key === "Escape") { shut(true); return; }
      if (e.key !== "Tab") return;
      var f = focusables(), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // Leaving phone/tablet width with the menu open: close it.
    var mq = window.matchMedia(toggle.getAttribute("data-menu-max") || "(max-width:980px)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function (m) { if (!m.matches) shut(false); });
    // Coming back via the browser's back button restores a closed menu.
    window.addEventListener("pageshow", function () { shut(false); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
