import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Sentry from "@sentry/react";
import { useAuth } from "../../hooks/useAuth";
import { useIsMobile } from "../../hooks/useIsMobile";
import { listCategories, listPaymentRegistrations, listTournaments } from "../../lib/db";
import { localToday } from "../../lib/dates";
import { supabase } from "../../lib/supabase";
import { colors } from "../../lib/theme";
import { Login } from "../../components/Login";
import type { Category, PendingRegistration, Tournament } from "../../types";
import { paymentTotals, splitPaidTeams } from "./paymentTotals";

// /payments — live report of every paid entry for the tournament directors.
// Admin-only: RLS on pending_registrations already limits reads to admins, and
// the page refuses to render rows for anyone else.

const TZ = "America/Vancouver";
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" });

const money = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;

// When the money arrived: Stripe's paid_at for cards; for e-Transfer, the moment
// an admin approved the entry (that's when the transfer was confirmed).
function paymentTime(r: PendingRegistration): { at: string | null; note: string } {
  if (r.payment_method === "card") return { at: r.paid_at, note: "paid" };
  if (r.status === "approved") return { at: r.reviewed_at, note: "confirmed" };
  return { at: r.submitted_at, note: "submitted" };
}

function methodLabel(r: PendingRegistration) {
  return r.payment_method === "card" ? "Card" : "e-Transfer";
}

function pickDefault(list: Tournament[]): Tournament | null {
  const wanted = new URLSearchParams(window.location.search).get("t");
  const byParam = wanted ? list.find(t => t.id === wanted || t.slug === wanted) : undefined;
  if (byParam) return byParam;
  const today = localToday();
  const upcoming = list
    .filter(t => t.event_date && t.event_date >= today)
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1));
  return upcoming[0] ?? list[0] ?? null;
}

function toCsv(rows: PendingRegistration[], catName: (id: string) => string): string {
  const head = ["Status", "Payment date", "Payment time", "Amount", "Method", "Reference", "Category",
    "Name", "Email", "Phone", "Partner", "Partner email", "Partner phone", "Paid for partner"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map(r => {
    const { at } = paymentTime(r);
    return [
      r.status === "approved" ? "In" : "Waiting for approval",
      at ? dateFmt.format(new Date(at)) : "",
      at ? timeFmt.format(new Date(at)) : "",
      r.amount_due_cents === null ? "" : (r.amount_due_cents / 100).toFixed(2),
      methodLabel(r),
      r.payment_reference ?? "",
      catName(r.category_id),
      r.player_name, r.player_email, r.player_phone ?? "",
      r.partner_name ?? "", r.partner_email ?? "", r.partner_phone ?? "",
      r.payment_paid_full_for_partner ? "Yes" : "No",
    ].map(v => esc(String(v))).join(",");
  });
  return [head.join(","), ...lines].join("\n");
}

export function PaymentsPage() {
  const { isAdmin, email, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const [showLogin, setShowLogin] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<PendingRegistration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => { document.title = "Payments · BadmintonLive"; }, []);

  useEffect(() => {
    if (!isAdmin) return;
    listTournaments()
      .then(list => { setTournaments(list); setTournament(t => t ?? pickDefault(list)); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [isAdmin]);

  const load = useCallback(async () => {
    if (!tournament || !isAdmin) return;
    try {
      const [regs, cats] = await Promise.all([
        listPaymentRegistrations(tournament.id),
        listCategories(tournament.id),
      ]);
      setRows(regs);
      setCategories(cats);
      setLoadedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tournament, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  // Live updates: any change to this tournament's registrations reloads the list.
  useEffect(() => {
    if (!tournament || !isAdmin) return;
    const channel = supabase
      .channel(`payments:${tournament.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "pending_registrations", filter: `tournament_id=eq.${tournament.id}` },
        () => {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(() => { void load(); }, 300);
        });
    try {
      channel.subscribe(status => setLive(status === "SUBSCRIBED"));
    } catch (err) {
      Sentry.addBreadcrumb({ category: "realtime", level: "warning", message: "payments subscribe failed", data: { error: String(err) } });
    }
    // Backstop for sleeping phones and dropped sockets.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => void load(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
      setLive(false);
    };
  }, [tournament, isAdmin, load]);

  const catName = useCallback(
    (id: string) => categories.find(c => c.id === id)?.name ?? "—",
    [categories],
  );

  const approved = useMemo(() => rows.filter(r => r.status === "approved"), [rows]);
  const waiting = useMemo(() => rows.filter(r => r.status === "pending"), [rows]);
  const sortByPaid = (list: PendingRegistration[]) =>
    [...list].sort((a, b) => (paymentTime(b).at ?? "").localeCompare(paymentTime(a).at ?? ""));

  const totals = useMemo(() => paymentTotals(approved), [approved]);
  const splitTeams = useMemo(() => splitPaidTeams(approved), [approved]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv([...sortByPaid(approved), ...waiting], catName)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(tournament?.name ?? "payments").replace(/[^\w]+/g, "-")}-payments.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- gates ----------
  if (authLoading) return <Shell><p style={muted}>Loading…</p></Shell>;
  if (!email) {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ margin: "0 0 8px", color: colors.text.primaryLight }}>Payments</h2>
          <p style={{ ...muted, marginTop: 0 }}>Sign in with your tournament director account to see payments.</p>
          <button style={primaryBtn} onClick={() => setShowLogin(true)}>Sign in</button>
        </div>
        {showLogin && <Login onClose={() => setShowLogin(false)} />}
      </Shell>
    );
  }
  if (!isAdmin) {
    return <Shell><div style={card}><p style={{ margin: 0, color: colors.text.primaryLight }}>This page is only for tournament directors. You're signed in as {email}.</p></div></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, color: "#fff", letterSpacing: 0.5 }}>Payments</h1>
          <p style={{ margin: "4px 0 0", color: colors.text.mutedDark, fontSize: 13 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 6, background: live ? "#22c55e" : "#f59e0b" }} />
            {live ? "Live" : "Connecting…"}{loadedAt ? ` · updated ${clockFmt.format(loadedAt)}` : ""} · times in Pacific
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tournaments.length > 1 && (
            <select
              value={tournament?.id ?? ""}
              onChange={e => setTournament(tournaments.find(t => t.id === e.target.value) ?? null)}
              style={{ ...ghostBtn, paddingRight: 8 }}
            >
              {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button style={ghostBtn} onClick={downloadCsv} disabled={!rows.length}>Download CSV</button>
          <a style={{ ...ghostBtn, textDecoration: "none" }} href="/">Back to app</a>
        </div>
      </div>

      {error && <div style={{ ...card, borderColor: "#fecaca", color: "#b91c1c", marginBottom: 16 }}>Couldn't load payments: {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <Stat label="Entries in" value={String(totals.entries)}
          sub={`${totals.players} player${totals.players === 1 ? "" : "s"} · ${totals.payments} payment${totals.payments === 1 ? "" : "s"}`} />
        <Stat label="Total received" value={money(totals.total)} sub="approved entries" />
        <Stat label="e-Transfer" value={money(totals.etransfer)} />
        <Stat label="Card" value={money(totals.card)} sub="before Stripe fees" />
      </div>

      <Section title={`Paid and in (${approved.length})`}>
        {approved.length === 0
          ? <p style={muted}>No approved entries yet.</p>
          : <Rows list={sortByPaid(approved)} catName={catName} isMobile={isMobile} splitTeams={splitTeams} />}
      </Section>

      {waiting.length > 0 && (
        <Section title={`Waiting for your approval (${waiting.length})`} note="Card entries here are already paid. For e-Transfer, check the reference arrived before approving in the Players tab.">
          <Rows list={waiting} catName={catName} isMobile={isMobile} />
        </Section>
      )}
    </Shell>
  );
}

// "(paid for both)" or, when each partner paid their own share, "(paid separately)".
function partnerNote(r: PendingRegistration, splitTeams?: Set<string>): string {
  if (r.payment_paid_full_for_partner) return " (paid for both)";
  if (r.approved_team_id && splitTeams?.has(r.approved_team_id)) return " (paid separately)";
  return "";
}

function Rows({ list, catName, isMobile, splitTeams }: {
  list: PendingRegistration[]; catName: (id: string) => string; isMobile: boolean; splitTeams?: Set<string>;
}) {
  if (isMobile) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {list.map(r => {
          const { at, note } = paymentTime(r);
          return (
            <div key={r.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <strong style={{ color: colors.text.primaryLight, fontSize: 16 }}>{r.player_name}</strong>
                <strong style={{ color: colors.text.primaryLight }}>{money(r.amount_due_cents)}</strong>
              </div>
              <div style={{ color: colors.brand.primary, fontWeight: 600, fontSize: 13, margin: "2px 0 8px" }}>{catName(r.category_id)}</div>
              <Line k={note === "submitted" ? "Submitted" : "Paid"} v={at ? `${dateFmt.format(new Date(at))}, ${timeFmt.format(new Date(at))}` : "—"} />
              <Line k="Method" v={methodLabel(r)} />
              <Line k="Reference" v={r.payment_reference ?? "—"} mono />
              <Line k="Email" v={<a href={`mailto:${r.player_email}`}>{r.player_email}</a>} />
              <Line k="Phone" v={r.player_phone ? <a href={`tel:${r.player_phone}`}>{r.player_phone}</a> : "—"} />
              {r.partner_name && <Partner r={r} note={partnerNote(r, splitTeams)} />}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {["Payment", "Amount", "Method", "Reference", "Category", "Name", "Email", "Phone"].map(h => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const { at, note } = paymentTime(r);
            return (
              <tr key={r.id}>
                <td style={td}>
                  {at ? <>{dateFmt.format(new Date(at))}<br /><span style={muted}>{timeFmt.format(new Date(at))} · {note}</span></> : "—"}
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{money(r.amount_due_cents)}</td>
                <td style={td}>{methodLabel(r)}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, maxWidth: 180, wordBreak: "break-all" }}>{r.payment_reference ?? "—"}</td>
                <td style={td}>{catName(r.category_id)}</td>
                <td style={td}>
                  <strong>{r.player_name}</strong>
                  {r.partner_name && <><br /><span style={muted}>with {r.partner_name}{partnerNote(r, splitTeams)}</span></>}
                </td>
                <td style={td}>
                  <a href={`mailto:${r.player_email}`}>{r.player_email}</a>
                  {r.partner_email && <><br /><a style={muted} href={`mailto:${r.partner_email}`}>{r.partner_email}</a></>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.player_phone ? <a href={`tel:${r.player_phone}`}>{r.player_phone}</a> : "—"}
                  {r.partner_phone && <><br /><a style={muted} href={`tel:${r.partner_phone}`}>{r.partner_phone}</a></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Partner({ r, note }: { r: PendingRegistration; note: string }) {
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border.light}` }}>
      <Line k="Partner" v={`${r.partner_name}${note}`} />
      {r.partner_email && <Line k="Email" v={<a href={`mailto:${r.partner_email}`}>{r.partner_email}</a>} />}
      {r.partner_phone && <Line k="Phone" v={<a href={`tel:${r.partner_phone}`}>{r.partner_phone}</a>} />}
    </div>
  );
}

function Line({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 14, padding: "2px 0" }}>
      <span style={{ ...muted, minWidth: 74 }}>{k}</span>
      <span style={{ color: colors.text.primaryLight, wordBreak: "break-all", fontFamily: mono ? "ui-monospace, Menlo, monospace" : undefined, fontSize: mono ? 12 : 14 }}>{v}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ ...muted, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: colors.text.primaryLight, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ ...muted, fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, letterSpacing: 1.2, textTransform: "uppercase", color: "#cbd5e1", margin: "0 0 6px" }}>{title}</h2>
      {note && <p style={{ margin: "0 0 10px", color: colors.text.mutedDark, fontSize: 13 }}>{note}</p>}
      {children}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: colors.bg.deep, fontFamily: "'Inter Variable', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 16px 48px" }}>{children}</div>
    </div>
  );
}

const muted: React.CSSProperties = { color: colors.text.mutedLight };
const card: React.CSSProperties = {
  background: colors.bg.card, border: `1px solid ${colors.border.light}`, borderRadius: 12, padding: 14,
};
const th: React.CSSProperties = {
  textAlign: "left", padding: "12px 14px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
  color: colors.text.mutedLight, borderBottom: `1px solid ${colors.border.light}`, background: colors.bg.muted, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "12px 14px", borderBottom: `1px solid ${colors.border.light}`, verticalAlign: "top", color: colors.text.primaryLight,
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 14px", minHeight: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)",
  background: "transparent", color: "#e2e8f0", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center",
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 20px", minHeight: 44, borderRadius: 10, border: "none", background: colors.gradient.brandCta,
  color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700,
};
