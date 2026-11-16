// Volunteer check-in desk. Talks to one endpoint (the volunteer-desk Edge
// Function) with the volunteer's private link key. No framework, no build.
(() => {
  "use strict";

  const cfg = window.DESK_CONFIG || {};
  const API = `${cfg.supabaseUrl}/functions/v1/volunteer-desk`;
  const PHOTO_PREFIX = `${cfg.supabaseUrl}/storage/v1/object/public/player-photos/`;
  const KEY_STORE = "shuttlestorm.desk.key";
  const REFRESH_MS = 20000;
  const MAX_EDGE = 1200; // same as the app's own photo page
  const JPEG_QUALITY = 0.86;
  const MAX_UPLOAD_BYTES = 3000000;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ── The link key ──────────────────────────────────────────────────────
  // It arrives after the # so it is never sent to this site's server or
  // kept in its logs. It is then held on this phone and taken out of the
  // address bar.
  let key = null;
  function readKey() {
    const m = /^#k=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (m) {
      key = m[1];
      try { localStorage.setItem(KEY_STORE, key); } catch { /* private mode: keep it for this visit */ }
      history.replaceState(null, "", location.pathname);
      return;
    }
    try {
      const saved = localStorage.getItem(KEY_STORE);
      if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved)) key = saved;
    } catch { /* no storage */ }
  }
  function forgetKey() {
    key = null;
    try { localStorage.removeItem(KEY_STORE); } catch { /* nothing kept */ }
  }

  // ── Talking to the desk service ───────────────────────────────────────
  async function call(body, timeoutMs = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.publishableKey },
        body: JSON.stringify({ key, ...body }),
        cache: "no-store",
        signal: ctl.signal,
      });
    } catch {
      return { ok: false, network: true, error: "No connection. Please try again." };
    } finally {
      clearTimeout(timer);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      return { ok: false, status: resp.status, code: data.code, data, error: data.error || "Something went wrong. Please try again." };
    }
    return { ok: true, data };
  }

  // ── State ─────────────────────────────────────────────────────────────
  let players = [];
  let consentText = "";
  let filter = "todo";
  let query = "";
  let changes = 0; // counts local changes, so a slow refresh never overwrites a newer tap
  let refreshing = false;
  const busy = new Map(); // player id → "checkin" | "photo"
  const brokenPhotos = new Set(); // photo addresses that failed to load: show initials instead
  let drawn = ""; // the list as last drawn, so an unchanged refresh doesn't redraw (no flicker)

  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const initials = (name) => {
    const w = name.trim().split(/\s+/);
    return ((w[0]?.[0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
  };
  const safePhoto = (url) => (typeof url === "string" && url.startsWith(PHOTO_PREFIX) && !brokenPhotos.has(url) ? url : null);

  // ── Gate (loading, and links that don't work) ─────────────────────────
  function showGate(title, text, retry) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gate-title").textContent = title;
    $("gate-text").textContent = text || "";
    $("gate-retry").hidden = !retry;
  }
  function gateFor(r) {
    if (r.network) return showGate("No connection", "Check the Wi-Fi or mobile data on this phone, then try again.", true);
    if (r.code === "not_yet") {
      const when = r.data?.starts_at ? new Date(r.data.starts_at).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "game day";
      return showGate("Not open yet", `Your link is fine. The desk opens ${when}.`, true);
    }
    if (r.code === "revoked") return showGate("This link is switched off", "Please see the organizer.", false);
    if (r.code === "expired") return showGate("The desk is closed", "This link has ended. Thank you for helping today.", false);
    if (r.code === "bad_link") {
      forgetKey();
      return showGate("This link doesn't work", "Open the link the organizer sent you again, or ask them for a new one.", false);
    }
    return showGate("Couldn't open the desk", r.error, true);
  }

  // ── Loading the list ──────────────────────────────────────────────────
  async function refresh(first) {
    if (!key) return showGate("You need your personal link", "Open the check-in link the organizer sent you. This page doesn't work without it.", false);
    if (refreshing) return;
    refreshing = true;
    const seen = changes;
    const r = await call({ action: "list" });
    refreshing = false;
    if (!r.ok) {
      // A link that stopped working closes the desk; a dropped connection just waits.
      if (first || ["revoked", "expired", "bad_link", "not_yet"].includes(r.code)) gateFor(r);
      return;
    }
    if (seen !== changes) return; // something was tapped meanwhile; the next refresh will catch up
    const fresh = JSON.stringify(r.data.players);
    const same = fresh === drawn && !$("app").hidden;
    drawn = fresh;
    players = r.data.players;
    consentText = r.data.consent_text;
    $("who").textContent = `${r.data.volunteer} · ${r.data.tournament.name}`;
    $("updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    $("gate").hidden = true;
    $("app").hidden = false;
    if (!same) render();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function visiblePlayers() {
    const q = norm(query.trim());
    if (q) {
      // A search looks at everyone, whatever filter is on.
      const words = q.split(/\s+/);
      return players.filter((p) => { const n = norm(p.name); return words.every((w) => n.includes(w)); });
    }
    if (filter === "todo") return players.filter((p) => !p.checked_in_at);
    if (filter === "nophoto") return players.filter((p) => !p.photo_url);
    return players;
  }

  function render() {
    const total = players.length;
    const checked = players.filter((p) => p.checked_in_at).length;
    $("count-in").textContent = String(checked);
    $("count-of").textContent = `of ${total} in`;
    $("bar-fill").style.width = total ? `${Math.round((checked / total) * 100)}%` : "0";
    $("n-todo").textContent = String(total - checked);
    $("n-nophoto").textContent = String(players.filter((p) => !p.photo_url).length);
    $("n-all").textContent = String(total);
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === filter && !query.trim())));

    const shown = visiblePlayers();
    $("list").replaceChildren(...shown.map(card));
    const empty = $("empty");
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.textContent = query.trim() ? `No player matches "${query.trim()}".`
        : filter === "todo" ? (total ? "Everyone is checked in." : "No players yet.")
        : filter === "nophoto" ? "Every player has a photo." : "No players yet.";
    }
  }

  function card(p) {
    const li = el("li", `card${p.checked_in_at ? " in" : ""}`);
    li.dataset.id = p.id;

    const top = el("div", "card-top");
    const av = el("div", "avatar");
    const photo = safePhoto(p.photo_url);
    if (photo) {
      const img = el("img");
      img.src = photo;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => { brokenPhotos.add(photo); av.replaceChildren(document.createTextNode(initials(p.name))); });
      av.append(img);
    } else {
      av.textContent = initials(p.name);
    }
    const who = el("div", "who");
    who.append(el("p", "name", p.name));
    if (p.events.length) who.append(el("p", "events", p.events.map((e) => (e.partner ? `${e.name} with ${e.partner}` : e.name)).join(" · ")));
    if (p.checked_in_at) who.append(el("p", "status", `✓ Checked in ${timeOf(p.checked_in_at)}`));
    top.append(av, who);

    const actions = el("div", "card-actions");
    const state = busy.get(p.id);
    const check = p.checked_in_at ? el("button", "btn btn-quiet", "Undo check-in") : el("button", "btn btn-primary", "Check in");
    check.type = "button";
    check.dataset.act = p.checked_in_at ? "undo" : "checkin";
    if (state === "checkin") check.classList.add("busy");
    const cam = el("button", `btn${p.checked_in_at && !p.photo_url ? " btn-need" : ""}`, p.photo_url ? "New photo" : "Take photo");
    cam.type = "button";
    cam.dataset.act = "photo";
    if (state === "photo") cam.classList.add("busy");
    check.disabled = cam.disabled = Boolean(state);
    actions.append(check, cam);

    li.append(top, actions);
    return li;
  }

  const patch = (id, fields) => {
    changes += 1;
    drawn = "";
    players = players.map((p) => (p.id === id ? { ...p, ...fields } : p));
  };
  const byId = (id) => players.find((p) => p.id === id);

  // ── Toast ─────────────────────────────────────────────────────────────
  let toastTimer = null;
  let toastUndo = null;
  function toast(text, { bad = false, undo = null } = {}) {
    clearTimeout(toastTimer);
    toastUndo = undo;
    $("toast-text").textContent = text;
    $("toast-undo").hidden = !undo;
    $("toast").classList.toggle("bad", bad);
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; toastUndo = null; }, undo ? 8000 : 4000);
  }

  // ── Check-in ──────────────────────────────────────────────────────────
  async function setCheckin(id, on) {
    const p = byId(id);
    if (!p || busy.has(id)) return;
    busy.set(id, "checkin");
    render();
    const r = await call({ action: on ? "check_in" : "undo_check_in", player_id: id });
    busy.delete(id);
    if (!r.ok) {
      render();
      if (["revoked", "expired", "bad_link", "not_yet"].includes(r.code)) return gateFor(r);
      return toast(r.error, { bad: true });
    }
    patch(id, { checked_in_at: r.data.checked_in_at });
    render();
    if (on) toast(`${p.name} is checked in`, { undo: () => setCheckin(id, false) });
    else toast(`Check-in undone for ${p.name}`);
  }

  // ── Photo ─────────────────────────────────────────────────────────────
  let photoFor = null; // player id the camera was opened for
  let photoData = null; // the shrunk JPEG as a data URL

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        if (!img.naturalWidth || !img.naturalHeight) return reject(new Error("unreadable"));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("unreadable"));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h); // drawing also drops the camera's location data
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        if (!dataUrl.startsWith("data:image/jpeg;base64,")) return reject(new Error("unreadable"));
        if ((dataUrl.length - 23) * 0.75 > MAX_UPLOAD_BYTES) return reject(new Error("too-big"));
        resolve(dataUrl);
      };
      img.src = url;
    });
  }

  function openCamera(id) {
    photoFor = id;
    const cam = $("camera");
    cam.value = "";
    cam.click();
  }

  async function onPicked() {
    const file = $("camera").files?.[0];
    const p = byId(photoFor);
    if (!file || !p) return;
    try {
      photoData = await shrink(file);
    } catch {
      photoData = null;
      return toast("Couldn't read that photo. Please take it again.", { bad: true });
    }
    $("sheet-name").textContent = `Photo of ${p.name}`;
    $("sheet-img").src = photoData;
    $("sheet-consent").checked = false;
    $("sheet-consent-text").textContent = consentText;
    $("sheet-save").disabled = true;
    $("sheet-save").classList.remove("busy");
    $("sheet-error").hidden = true;
    if (!$("sheet").open) $("sheet").showModal();
  }

  function closeSheet() {
    if ($("sheet").open) $("sheet").close();
    $("sheet-img").removeAttribute("src");
    photoData = null;
  }

  async function savePhoto() {
    const id = photoFor;
    const p = byId(id);
    if (!p || !photoData || !$("sheet-consent").checked || busy.has(id)) return;
    busy.set(id, "photo");
    $("sheet-save").classList.add("busy");
    $("sheet-save").disabled = $("sheet-retake").disabled = $("sheet-cancel").disabled = true;
    const r = await call({ action: "photo", player_id: id, image: photoData, consent: true }, 60000);
    busy.delete(id);
    $("sheet-save").classList.remove("busy");
    $("sheet-retake").disabled = $("sheet-cancel").disabled = false;
    $("sheet-save").disabled = !$("sheet-consent").checked;
    if (!r.ok) {
      if (["revoked", "expired", "bad_link", "not_yet"].includes(r.code)) { closeSheet(); return gateFor(r); }
      $("sheet-error").textContent = r.error;
      $("sheet-error").hidden = false;
      render();
      return;
    }
    patch(id, { photo_url: r.data.photo_url });
    closeSheet();
    render();
    toast(`Photo saved for ${p.name}`, { undo: () => undoPhoto(id) });
  }

  async function undoPhoto(id) {
    const p = byId(id);
    if (!p || busy.has(id)) return;
    busy.set(id, "photo");
    render();
    const r = await call({ action: "undo_photo", player_id: id });
    busy.delete(id);
    if (!r.ok) { render(); return toast(r.error, { bad: true }); }
    patch(id, { photo_url: r.data.photo_url });
    render();
    toast(`Photo removed for ${p.name}`);
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  $("list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    const li = e.target.closest("li.card");
    if (!btn || !li || btn.disabled) return;
    const id = li.dataset.id;
    if (btn.dataset.act === "checkin") void setCheckin(id, true);
    else if (btn.dataset.act === "undo") {
      const p = byId(id);
      if (p && window.confirm(`Undo the check-in for ${p.name}?`)) void setCheckin(id, false);
    } else if (btn.dataset.act === "photo") openCamera(id);
  });
  $("camera").addEventListener("change", () => void onPicked());
  $("sheet-consent").addEventListener("change", () => { $("sheet-save").disabled = !$("sheet-consent").checked; });
  $("sheet-save").addEventListener("click", () => void savePhoto());
  $("sheet-retake").addEventListener("click", () => openCamera(photoFor));
  $("sheet-cancel").addEventListener("click", closeSheet);
  $("sheet").addEventListener("cancel", (e) => { if (busy.has(photoFor)) e.preventDefault(); else photoData = null; });
  $("toast-undo").addEventListener("click", () => {
    const undo = toastUndo;
    $("toast").hidden = true;
    toastUndo = null;
    if (undo) void undo();
  });
  $("search").addEventListener("input", (e) => { query = e.target.value; render(); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    filter = c.dataset.filter;
    query = "";
    $("search").value = "";
    render();
  }));
  $("gate-retry").addEventListener("click", () => { showGate("Opening the desk…", "", false); void refresh(true); });
  $("forget").addEventListener("click", () => {
    if (!window.confirm("Remove the check-in link from this phone? You will need the organizer's link to open the desk again.")) return;
    forgetKey();
    showGate("Link removed", "This phone no longer has the check-in link.", false);
  });
  const setOffline = () => { $("offline").hidden = navigator.onLine; };
  window.addEventListener("online", () => { setOffline(); void refresh(false); });
  window.addEventListener("offline", setOffline);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("app").hidden) void refresh(false); });
  setInterval(() => { if (!document.hidden && !$("app").hidden && key) void refresh(false); }, REFRESH_MS);

  readKey();
  setOffline();
  void refresh(true);
})();
