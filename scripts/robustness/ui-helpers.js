// Match-day robustness test helpers (docs/test-reports/match-day-robustness-2026.md).
// Paste into the admin page or load with Playwright addInitScript. They click the
// app's real buttons; window.confirm is stubbed to auto-accept and log each prompt.
window.__log = []; window.__answers = [];
window.confirm = (m) => { const a = window.__answers.length ? window.__answers.shift() : true; window.__log.push({ t: 'confirm', m, a }); return a; };
window.alert = (m) => { window.__log.push({ t: 'alert', m }); };
window.sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
window.btns = (txt) => [...document.querySelectorAll('button')].filter(b => norm(b.innerText).toLowerCase().includes(txt.toLowerCase()));
window.click = (txt, i = 0) => { const b = btns(txt)[i]; if (!b) return 'NO BUTTON ' + txt; b.click(); return 'clicked ' + txt; };
window.pill = (txt) => { const b = [...document.querySelectorAll('main button')].find(b => norm(b.innerText).toLowerCase().replace(/^\S+\s/, '') === txt.toLowerCase() || norm(b.innerText).toLowerCase() === txt.toLowerCase()); if (!b) return 'NO PILL ' + txt; b.click(); return 'pill ' + txt; };
window.toasts = () => [...document.querySelectorAll('[role=status],[role=alert]')].map(e => e.innerText).filter(Boolean).join(' | ');
window.rows = () => [...document.querySelectorAll('button')].filter(b => b.innerText.includes('LOG')).map(b => b.parentElement.parentElement);
window.rbtn = (r, txt) => r && [...r.querySelectorAll('button')].find(b => norm(b.innerText).toLowerCase().includes(txt.toLowerCase()));
window.dlg = () => document.querySelector('[role=dialog]')?.innerText ?? null;
window.court = (n) => { const d = document.querySelector('[role=dialog]'); if (!d) return 'NO DIALOG'; const b = [...d.querySelectorAll('button')].find(b => b.innerText.trim() === String(n)); if (!b) return 'NO COURT ' + n; b.click(); return 'court ' + n; };
window.dclick = (txt) => { const d = document.querySelector('[role=dialog]'); if (!d) return 'NO DIALOG'; const b = [...d.querySelectorAll('button')].find(b => b.innerText.trim().toLowerCase() === txt.toLowerCase()); if (!b) return 'NO ' + txt; b.click(); return 'ok'; };
window.cards = () => [...document.querySelectorAll('main div')].filter(d => d.children.length >= 2 && /^Match/.test(d.innerText.trim()) && (d.innerText.match(/^Match/gm) || []).length === 1 && d.querySelector('button'));
window.card = (a, b) => cards().filter(c => c.innerText.includes(a) && c.innerText.includes(b)).sort((x, y) => x.innerText.length - y.innerText.length)[0];
window.cbtn = (a, b, t) => { const c = card(a, b); return c && [...c.querySelectorAll('button')].find(x => x.innerText.includes(t)); };
window.cardText = (a, b) => card(a, b) ? norm(card(a, b).innerText) : null;
window.setIn = async (a, b, idx, v) => { const el = card(a, b).querySelectorAll('input')[idx]; el.focus(); await sleep(50); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150); el.blur(); await sleep(50); };
window.setVerified = async (a, b, idx, v) => { for (let k = 0; k < 6; k++) { await setIn(a, b, idx, v); await sleep(1500); const el = card(a, b)?.querySelectorAll('input')[idx]; if (el && el.value === String(v)) return k; } return 'FAILED'; };
// Allocate a court, begin scoring, enter scores via the score boxes, confirm. sa/sb are for a/b.
window.play = async (a, b, sa, sb, opts = {}) => {
  const log = [];
  let x = cbtn(a, b, 'Start Match');
  if (x) {
    x.click(); await sleep(400);
    const d = document.querySelector('[role=dialog]');
    const free = [...d.querySelectorAll('button')].filter(q => /^\d$/.test(q.innerText.trim())).map(q => q.innerText.trim());
    let ok = false;
    for (const f of free) { court(f); await sleep(1500); if (!document.querySelector('[role=dialog]')) { ok = true; log.push('court ' + f); break; } }
    if (!ok) { dclick('cancel'); return 'NO COURT ' + toasts(); }
  }
  x = cbtn(a, b, 'Begin Scoring'); if (x) { x.click(); await sleep(1800); }
  if (!card(a, b)?.querySelector('input')) return 'not live: ' + cardText(a, b);
  const t = card(a, b).innerText; const first = t.indexOf(a) < t.indexOf(b);
  log.push('r' + await setVerified(a, b, 0, first ? sa : sb)); log.push('r' + await setVerified(a, b, 1, first ? sb : sa));
  if (opts.noConfirm) return log.join(',');
  x = cbtn(a, b, 'Confirm'); x.click(); await sleep(2200);
  return log.join(',') + ' -> ' + cardText(a, b);
};
window.lowWins = (a, b) => { const na = +a.match(/P(\d+)/)[1], nb = +b.match(/P(\d+)/)[1]; return na < nb ? [21, 10 + nb] : [10 + na, 21]; };
window.playAll = async (prefix, suffix, scoreFn, out) => {
  for (let guard = 0; guard < 40; guard++) {
    const c = cards().filter(c => c.innerText.includes(prefix + ' P') && /Start Match|Begin Scoring|Confirm Final/.test(c.innerText)).sort((x, y) => x.innerText.length - y.innerText.length)[0];
    if (!c) return;
    const re = new RegExp(prefix + ' P(\\d+)' + suffix, 'g');
    const ns = [...new Set([...c.innerText.matchAll(re)].map(m => m[0]))];
    if (ns.length < 2) { out.push('parse fail ' + norm(c.innerText)); return; }
    const [sa, sb] = scoreFn(ns[0], ns[1]);
    out.push(await play(ns[0], ns[1], sa, sb));
  }
};
