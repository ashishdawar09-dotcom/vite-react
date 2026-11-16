// Organizer screen of the volunteer desk: sign in with the organizer email
// code (the same sign-in the app uses), invite volunteers by email, switch
// their links on and off. Talks to Supabase Auth and to one endpoint, the
// volunteer-desk-admin Edge Function. No framework, no build.
(() => {
  "use strict";

  const cfg = window.DESK_CONFIG || {};
  const AUTH = `${cfg.supabaseUrl}/auth/v1`;
  const API = `${cfg.supabaseUrl}/functions/v1/volunteer-desk-admin`;
  const STORE = "shuttlestorm.desk.organizer";
  const REFRESH_MS = 20000;
  // British Columbia is UTC-7 all year from Nov 2026. Hours are entered and
  // shown in that fixed zone, whatever this device's own clock rules say.
  const TZ = "Etc/GMT+7";
  const OFFSET = "-07:00";

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const fmt = (iso, opts) => new Date(iso).toLocaleString("en-CA", { timeZone: TZ, hour12: true, ...opts }).replace(/\./g, "");
  const dayOf = (iso) => fmt(iso, { weekday: "short", month: "short", day: "numeric" });
  const timeOf = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });
  const whenOf = (iso) => `${dayOf(iso)}, ${timeOf(iso)}`;
  // The date and 24-hour time of an instant, in BC time, for the form fields.
  const parts = (iso) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  // Day + from + until fields → two instants. An "until" at or before "from" means the next day.
  const windowOf = (day, from, until) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(until)) return null;
    const a = new Date(`${day}T${from}:00${OFFSET}`);
    let b = new Date(`${day}T${until}:00${OFFSET}`);
    if (b.getTime() <= a.getTime()) b = new Date(b.getTime() + 24 * 60 * 60 * 1000);
    return { valid_from: a.toISOString(), valid_until: b.toISOString() };
  };

  // ── Session ───────────────────────────────────────────────────────────
  let session = null;
  try { session = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { session = null; }
  const keep = (s) => {
    session = s;
    try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch { /* private mode: this visit only */ }
  };
  const fromAuth = (d) => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, email: d.user?.email || session?.email || "" });

  async function post(url, body, token) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: ctl.signal,
      });
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, data };
    } catch {
      return { ok: false, network: true, status: 0, data: {} };
    } finally {
      clearTimeout(timer);
    }
  }

  let refreshingToken = null;
  function renew() {
    if (!session?.refresh_token) return Promise.resolve(false);
    refreshingToken ||= post(`${AUTH}/token?grant_type=refresh_token`, { refresh_token: session.refresh_token }).then((r) => {
      refreshingToken = null;
      if (r.ok && r.data.access_token) { keep(fromAuth(r.data)); return true; }
      if (!r.network) keep(null); // the sign-in has ended; a dropped connection keeps it
      return false;
    });
    return refreshingToken;
  }

  // One call to the organizer service, signed in. Renews the sign-in when it is about to run out.
  async function call(body) {
    if (!session) return { ok: false, signedOut: true, error: "Please sign in again." };
    if (session.expires_at - Date.now() < 60000 && !(await renew()) && !session) return { ok: false, signedOut: true, error: "Please sign in again." };
    let r = await post(API, body, session.access_token);
    if (r.status === 401 && (await renew())) r = await post(API, body, session.access_token);
    if (r.network) return { ok: false, network: true, error: "No connection. Please try again." };
    if (r.status === 401) { keep(null); return { ok: false, signedOut: true, error: "Please sign in again." }; }
    if (!r.ok || !r.data.success) return { ok: false, status: r.status, code: r.data.code, error: r.data.error || "Something went wrong. Please try again." };
    return { ok: true, data: r.data };
  }

  // ── Sign in ───────────────────────────────────────────────────────────
  let signinEmail = "";
  const signinError = (text) => { $("signin-error").textContent = text || ""; $("signin-error").hidden = !text; };
  function showSignin(note) {
    $("app").hidden = true;
    $("signin").hidden = false;
    $("email-form").hidden = false;
    $("code-form").hidden = true;
    $("signin-text").textContent = note || "Sign in with your organizer email. We'll send you a code, the same as for the app.";
    signinError("");
  }
  const busyBtn = (btn, on) => { btn.classList.toggle("busy", on); btn.disabled = on; };

  $("email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("signin-email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signinError("Enter a valid email address.");
    signinError("");
    busyBtn($("email-send"), true);
    // create_user false: only an existing organizer account gets a code.
    const r = await post(`${AUTH}/otp`, { email, create_user: false });
    busyBtn($("email-send"), false);
    if (r.network) return signinError("No connection. Please try again.");
    if (r.status === 429) return signinError("Too many tries. Please wait a minute and try again.");
    if (!r.ok) return signinError("That email isn't an organizer account. Use the email you sign in to the app with.");
    signinEmail = email;
    $("email-form").hidden = true;
    $("code-form").hidden = false;
    $("signin-text").textContent = `We sent a code to ${email}. It can take a minute to arrive.`;
    $("signin-code").value = "";
    $("signin-code").focus();
  });

  $("code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("signin-code").value.replace(/\D/g, "");
    if (token.length < 6) return signinError("Enter the full code from your email (usually 6 to 8 digits).");
    signinError("");
    busyBtn($("code-send"), true);
    const r = await post(`${AUTH}/verify`, { type: "email", email: signinEmail, token });
    busyBtn($("code-send"), false);
    if (r.network) return signinError("No connection. Please try again.");
    if (!r.ok || !r.data.access_token) return signinError("That code didn't work. Check it, or ask for a new one.");
    keep(fromAuth(r.data));
    await load(true);
  });
  $("code-back").addEventListener("click", () => showSignin());

  $("signout").addEventListener("click", async () => {
    const token = session?.access_token;
    keep(null);
    showSignin("You are signed out.");
    if (token) await post(`${AUTH}/logout`, {}, token);
  });

  // ── State and loading ─────────────────────────────────────────────────
  let data = null;
  let tournamentId = null;
  let loading = false;
  let changes = 0;
  const busy = new Set(); // link ids with an action in flight

  async function load(first) {
    if (!session) return showSignin();
    if (loading) return;
    loading = true;
    const seen = changes;
    const r = await call({ action: "overview", ...(tournamentId ? { tournament_id: tournamentId } : {}) });
    loading = false;
    if (!r.ok) {
      if (r.signedOut) return showSignin("Your sign-in has ended. Please sign in again.");
      if (r.code === "not_admin") { const who = session?.email; keep(null); return showSignin(`${who || "That email"} isn't a tournament organizer, so it can't open this page.`); }
      if (first) { showSignin(); signinError(r.error); }
      return;
    }
    if (seen !== changes) return;
    const firstDraw = !data;
    data = r.data;
    tournamentId = data.tournament?.id ?? null;
    $("signin").hidden = true;
    $("app").hidden = false;
    render();
    if (firstDraw) presetHours();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  const STATE = { active: "Working now", not_yet: "Ready", expired: "Ended", revoked: "Switched off" };
  const ACTION = { check_in: "checked in", undo_check_in: "undid the check-in of", photo: "took a photo of", undo_photo: "removed the photo of" };

  function render() {
    const t = data.tournament;
    $("who").textContent = `${data.admin}${t ? ` · ${t.name}` : ""}`;
    const sel = $("tournament");
    $("tournament-row").hidden = data.tournaments.length < 2;
    sel.replaceChildren(...data.tournaments.map((x) => { const o = el("option", "", x.event_date ? `${x.name} (${x.event_date})` : x.name); o.value = x.id; o.selected = x.id === t?.id; return o; }));
    $("stat-in").textContent = String(data.players?.checked_in ?? 0);
    $("stat-in-label").textContent = `of ${data.players?.active ?? 0} checked in`;
    $("stat-desk").textContent = String(Math.max(0, data.totals.check_ins));
    $("stat-photos").textContent = String(Math.max(0, data.totals.photos));
    $("links-count").textContent = data.links.length ? `(${data.links.length})` : "";
    $("links").replaceChildren(...data.links.map(linkCard));
    $("links-empty").hidden = data.links.length > 0;
    $("activity").replaceChildren(...data.activity.map((a) => {
      const li = el("li");
      const time = el("time", "", timeOf(a.at));
      time.dateTime = a.at;
      li.append(time, el("span", "", `${a.volunteer} ${ACTION[a.action] || a.action} ${a.player}`));
      return li;
    }));
    $("activity-empty").hidden = data.activity.length > 0;
    $("updated").textContent = `Updated ${fmt(new Date().toISOString(), { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  }

  function linkCard(l) {
    const li = el("li", "card");
    li.dataset.id = l.id;
    const top = el("div", "vol-top");
    const who = el("div");
    who.append(el("p", "name", l.name));
    if (l.email) who.append(el("p", "email", l.email));
    top.append(who, el("span", `badge ${l.state}`, STATE[l.state] || l.state));
    const sameDay = dayOf(l.valid_from) === dayOf(l.valid_until);
    const hours = sameDay ? `${dayOf(l.valid_from)}, ${timeOf(l.valid_from)} to ${timeOf(l.valid_until)}` : `${whenOf(l.valid_from)} to ${whenOf(l.valid_until)}`;
    const used = l.last_used_at ? `Opened ${whenOf(l.last_used_at)}` : "Not opened yet";
    const did = l.check_ins || l.photos ? ` · ${l.check_ins} check-in${l.check_ins === 1 ? "" : "s"}, ${l.photos} photo${l.photos === 1 ? "" : "s"}` : "";
    const meta = el("p", "vol-meta");
    meta.append(document.createTextNode(`Works ${hours}`), el("br"), document.createTextNode(`${used}${did}`));
    const actions = el("div", "vol-actions");
    const isBusy = busy.has(l.id);
    const mk = (label, act, cls, off) => { const b = el("button", `btn ${cls || ""}`.trim(), label); b.type = "button"; b.dataset.act = act; b.disabled = isBusy || Boolean(off); return b; };
    actions.append(
      l.on ? mk("Switch off", "off", "btn-danger") : mk("Switch on", "on", "btn-need"),
      mk("Hours", "hours"),
      mk("Send again", "resend", "", !l.email || !l.on || l.state === "expired"),
    );
    li.append(top, meta, actions);
    return li;
  }

  const patchLink = (link) => {
    changes += 1;
    const i = data.links.findIndex((x) => x.id === link.id);
    // The answer to one change carries no desk counts: keep the ones we have.
    if (i >= 0) data.links[i] = { ...link, check_ins: data.links[i].check_ins, photos: data.links[i].photos };
    else data.links.push(link);
  };

  // ── Toast ─────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, bad) {
    clearTimeout(toastTimer);
    $("toast-text").textContent = text;
    $("toast").classList.toggle("bad", Boolean(bad));
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, bad ? 6000 : 4000);
  }
  const failed = (r) => {
    if (r.signedOut) return showSignin("Your sign-in has ended. Please sign in again.");
    toast(r.error, true);
  };

  // ── Invite ────────────────────────────────────────────────────────────
  function presetHours() {
    const day = data.tournament?.event_date || parts(new Date().toISOString()).day;
    if (!$("inv-day").value) $("inv-day").value = day;
    if (!$("inv-from").value) $("inv-from").value = "07:00";
    if (!$("inv-until").value) $("inv-until").value = "22:00";
  }
  const inviteError = (text) => { $("invite-error").textContent = text || ""; $("invite-error").hidden = !text; };

  $("invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("inv-send").disabled) return;
    const name = $("inv-name").value.trim();
    const email = $("inv-email").value.trim();
    const w = windowOf($("inv-day").value, $("inv-from").value, $("inv-until").value);
    if (!name) return inviteError("Please enter the volunteer's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return inviteError("Please enter a valid email address.");
    if (!w) return inviteError("Please choose the day and the hours.");
    inviteError("");
    $("sent").hidden = true;
    busyBtn($("inv-send"), true);
    const r = await call({ action: "invite", tournament_id: tournamentId, name, email, ...w });
    busyBtn($("inv-send"), false);
    if (!r.ok) {
      if (r.signedOut) return showSignin("Your sign-in has ended. Please sign in again.");
      return inviteError(r.error);
    }
    patchLink(r.data.link);
    render();
    $("sent-text").textContent = `Sent to ${r.data.link.email}.`;
    $("sent-url").value = r.data.url;
    $("sent").hidden = false;
    $("inv-name").value = "";
    $("inv-email").value = "";
    $("inv-name").focus();
  });

  $("sent-copy").addEventListener("click", async () => {
    const input = $("sent-url");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    toast("Link copied");
  });

  // ── One link: switch, hours, send again ───────────────────────────────
  async function act(id, body, done) {
    if (busy.has(id)) return;
    busy.add(id);
    render();
    const r = await call({ ...body, link_id: id });
    busy.delete(id);
    if (!r.ok) { render(); return failed(r); }
    patchLink(r.data.link);
    render();
    done(r.data);
  }

  let hoursFor = null;
  $("links").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    const li = e.target.closest("li.card");
    if (!btn || !li || btn.disabled) return;
    const l = data.links.find((x) => x.id === li.dataset.id);
    if (!l) return;
    if (btn.dataset.act === "off") {
      if (window.confirm(`Switch off ${l.name}'s link? It stops working at once. You can switch it back on.`)) void act(l.id, { action: "set_state", on: false }, () => toast(`${l.name}'s link is off`));
    } else if (btn.dataset.act === "on") {
      void act(l.id, { action: "set_state", on: true }, () => toast(`${l.name}'s link is back on`));
    } else if (btn.dataset.act === "resend") {
      if (window.confirm(`Send ${l.name} a new link at ${l.email}? Their old link stops working.`)) {
        void act(l.id, { action: "resend" }, (d) => {
          $("sent-text").textContent = `New link sent to ${d.link.email}. The old one no longer works.`;
          $("sent-url").value = d.url;
          $("sent").hidden = false;
          toast(`New link sent to ${l.name}`);
        });
      }
    } else if (btn.dataset.act === "hours") {
      hoursFor = l.id;
      const a = parts(l.valid_from), b = parts(l.valid_until);
      $("hours-name").textContent = `Hours for ${l.name}`;
      $("hrs-day").value = a.day;
      $("hrs-from").value = a.time;
      $("hrs-until").value = b.time;
      $("hours-error").hidden = true;
      $("hours").showModal();
    }
  });
  $("hrs-cancel").addEventListener("click", () => $("hours").close());
  $("hours-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = windowOf($("hrs-day").value, $("hrs-from").value, $("hrs-until").value);
    if (!w) { $("hours-error").textContent = "Please choose the day and the hours."; $("hours-error").hidden = false; return; }
    busyBtn($("hrs-save"), true);
    const r = await call({ action: "set_hours", link_id: hoursFor, ...w });
    busyBtn($("hrs-save"), false);
    if (!r.ok) {
      if (r.signedOut) { $("hours").close(); return showSignin("Your sign-in has ended. Please sign in again."); }
      $("hours-error").textContent = r.error;
      $("hours-error").hidden = false;
      return;
    }
    patchLink(r.data.link);
    $("hours").close();
    render();
    toast("Hours saved");
  });

  $("tournament").addEventListener("change", (e) => {
    tournamentId = e.target.value;
    changes += 1;
    $("sent").hidden = true;
    $("inv-day").value = "";
    void load(false).then(presetHours);
  });

  const setOffline = () => { $("offline").hidden = navigator.onLine; };
  window.addEventListener("online", () => { setOffline(); void load(false); });
  window.addEventListener("offline", setOffline);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("app").hidden) void load(false); });
  setInterval(() => { if (!document.hidden && !$("app").hidden && session && !$("hours").open) void load(false); }, REFRESH_MS);

  setOffline();
  void load(true);
})();
