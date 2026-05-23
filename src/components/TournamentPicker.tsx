import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { AgeBand, Tournament, TournamentFees } from "../types";
import * as db from "../lib/db";
import { toast } from "./Toast";

type EditState = {
  name: string;
  event_date: string;            // YYYY-MM-DD
  num_courts: number;
  venue_name: string;
  venue_address: string;
  venue_map_url: string;
  event_time: string;            // HH:MM
  registration_deadline: string; // YYYY-MM-DDTHH:mm (datetime-local)
  contact_info: string;
  e_transfer_email: string;
  registration_open: boolean;
  terms_text: string;
  fees: TournamentFees;
};

function emptyEditState(): EditState {
  return {
    name: "", event_date: "", num_courts: 4,
    venue_name: "", venue_address: "", venue_map_url: "",
    event_time: "", registration_deadline: "",
    contact_info: "", e_transfer_email: "",
    registration_open: true, terms_text: "",
    fees: {},
  };
}

// Convert a YYYY-MM-DD event_date into a "2 days before, 23:59 local" deadline
// formatted as YYYY-MM-DDTHH:mm for the datetime-local input.
function defaultDeadlineFor(eventDate: string): string {
  const [y, m, d] = eventDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d - 2, 23, 59); // local
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Convert an ISO timestamp (from DB) to YYYY-MM-DDTHH:mm in local time
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TournamentPicker({
  tournaments,
  current,
  onSelect,
  isAdmin,
  onChange,
}: {
  tournaments: Tournament[];
  current: Tournament | null;
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  // Create-only state (separate from Edit so the two flows don't stomp on each other)
  const [createName, setCreateName] = useState("");
  const [createDate, setCreateDate] = useState("");
  const [seed, setSeed] = useState(true);
  const [busy, setBusy] = useState(false);
  // Edit form (all v12 fields)
  const [form, setForm] = useState<EditState>(emptyEditState);

  // Hydrate edit form from current tournament when modal opens.
  useEffect(() => {
    if (editing && current) {
      setForm({
        name: current.name,
        event_date: current.event_date ?? "",
        num_courts: current.num_courts || 4,
        venue_name: current.venue_name ?? "",
        venue_address: current.venue_address ?? "",
        venue_map_url: current.venue_map_url ?? "",
        event_time: (current.event_time ?? "").slice(0, 5), // strip seconds for HTML time input
        registration_deadline: isoToDatetimeLocal(current.registration_deadline),
        contact_info: current.contact_info ?? "",
        e_transfer_email: current.e_transfer_email ?? "",
        registration_open: current.registration_open ?? true,
        terms_text: current.terms_text ?? "",
        fees: current.fees ?? {},
      });
    }
  }, [editing, current]);

  const setField = <K extends keyof EditState>(key: K, value: EditState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const loadDefaults = () => {
    setForm((f) => {
      const next: EditState = { ...f };
      if (!next.event_time) next.event_time = "09:00";
      if (!next.registration_deadline && next.event_date) {
        next.registration_deadline = defaultDeadlineFor(next.event_date);
      }
      // Only set fees if no bands are populated yet
      if (Object.keys(next.fees).length === 0) {
        next.fees = { adult: { member: 20, non_member: 20 } };
      }
      if (!next.terms_text) {
        next.terms_text =
          "Each participant must submit this form separately for each category.\n\n" +
          "Payment must be completed via e-Transfer BEFORE submitting this form. Enter the reference number to complete registration.\n\n" +
          "Minimum of 6 pairs/players required to conduct a category.\n\n" +
          "Non-marking shoes only at the venue.";
      }
      if (next.registration_open !== true) next.registration_open = true;
      return next;
    });
    toast("Filled in template defaults — review then Save", "info");
  };

  const create = async () => {
    if (!createName.trim()) return;
    setBusy(true);
    try {
      const t = await db.createTournament(createName.trim(), createDate || null, seed);
      setCreating(false);
      setCreateName(""); setCreateDate(""); setSeed(true);
      onSelect(t.id);
      onChange();
    } catch (e: any) {
      toast(e?.message ?? "Failed to create tournament", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!current || !form.name.trim()) return;
    setBusy(true);
    try {
      const patch: Partial<Tournament> = {
        name: form.name.trim(),
        event_date: form.event_date || null,
        num_courts: form.num_courts,
        venue_name: form.venue_name.trim() || null,
        venue_address: form.venue_address.trim() || null,
        venue_map_url: form.venue_map_url.trim() || null,
        event_time: form.event_time || null,
        registration_deadline: form.registration_deadline
          ? new Date(form.registration_deadline).toISOString()
          : null,
        contact_info: form.contact_info.trim() || null,
        e_transfer_email: form.e_transfer_email.trim() || null,
        registration_open: form.registration_open,
        terms_text: form.terms_text.trim() || null,
        fees: form.fees,
      };
      await db.updateTournament(current.id, patch);
      setEditing(false);
      onChange();
      toast("Tournament updated", "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to update tournament", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeCurrent = async () => {
    if (!current) return;
    if (!confirm(`Delete "${current.name}" and all its data? This cannot be undone.`)) return;
    await db.deleteTournament(current.id);
    onChange();
  };

  const copyRegistrationLink = async () => {
    if (!current) return;
    const url = `${window.location.origin}/register/${current.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link copied — share via WhatsApp/text: ${url}`, "success");
    } catch {
      // Clipboard API may fail in non-secure contexts. Fall back to a prompt.
      window.prompt("Copy this registration link:", url);
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
      <select
        value={current?.id ?? ""}
        onChange={e => onSelect(e.target.value)}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
      >
        {tournaments.length === 0 && <option value="">— No tournaments —</option>}
        {tournaments.map(t => <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name}{t.event_date ? ` (${t.event_date})` : ""}</option>)}
      </select>
      {isAdmin && (
        <>
          <button onClick={() => setCreating(true)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(58,134,255,0.4)", background: "rgba(58,134,255,0.2)", color: "#93c5fd", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ New</button>
          {current && <button onClick={() => setEditing(true)} title="Edit tournament settings — name, date, venue, fees, registration form" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(168,85,247,0.4)", background: "rgba(168,85,247,0.2)", color: "#c4b5fd", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✏️ Edit</button>}
          {current && <button onClick={copyRegistrationLink} title="Copy public registration link — share via WhatsApp/text" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.5)", background: "rgba(0,212,255,0.2)", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 Copy Registration Link</button>}
          {current && <button onClick={() => navigate(`/register/${current.id}`)} title="Open the public registration form in this window — useful for testing push notifications inside the PWA" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(250,204,21,0.5)", background: "rgba(250,204,21,0.2)", color: "#fde68a", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🧪 Test as Player</button>}
          {current && <button onClick={removeCurrent} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(230,57,70,0.4)", background: "rgba(230,57,70,0.2)", color: "#fca5a5", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>}
        </>
      )}
      {creating && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setCreating(false)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 420, width: "100%", color: "#1a1a2e" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 800 }}>🏸 New Tournament</h3>
            <label style={labelStyle}>Name</label>
            <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Summer Cup 2026" style={lightInputStyle} />
            <label style={labelStyle}>Event date (optional)</label>
            <input type="date" value={createDate} onChange={e => setCreateDate(e.target.value)} style={lightInputStyle} />
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={seed} onChange={e => setSeed(e.target.checked)} />
              Seed with the default 14 players
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setCreating(false)} disabled={busy} style={cancelBtn}>Cancel</button>
              <button onClick={create} disabled={busy || !createName.trim()} style={{ ...primaryBtn("#16a34a"), opacity: busy || !createName.trim() ? 0.6 : 1 }}>{busy ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {editing && current && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setEditing(false)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 560, width: "100%", color: "#1a1a2e", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>✏️ Edit Tournament</h3>
              <button onClick={loadDefaults} type="button" title="Fill in empty fields with sensible defaults" style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.5)", background: "rgba(0,212,255,0.12)", color: "#0369a1", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>🪄 Load template</button>
            </div>

            <SectionHeader>Basics</SectionHeader>
            <label style={labelStyle}>Name</label>
            <input value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Tournament name" style={lightInputStyle} autoFocus />
            <label style={labelStyle}>Event date</label>
            <input type="date" value={form.event_date} onChange={e => setField("event_date", e.target.value)} style={lightInputStyle} />
            <label style={labelStyle}>Number of courts</label>
            <input type="number" min={1} max={20} value={form.num_courts} onChange={e => setField("num_courts", Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))} style={lightInputStyle} />

            <SectionHeader>Venue & Schedule</SectionHeader>
            <label style={labelStyle}>Venue name</label>
            <input value={form.venue_name} onChange={e => setField("venue_name", e.target.value)} placeholder="e.g. Surrey Badminton Club" style={lightInputStyle} />
            <label style={labelStyle}>Venue address</label>
            <input value={form.venue_address} onChange={e => setField("venue_address", e.target.value)} placeholder="19025 52 Ave, Surrey, BC V3S 8E5" style={lightInputStyle} />
            <label style={labelStyle}>Google Maps URL (optional)</label>
            <input value={form.venue_map_url} onChange={e => setField("venue_map_url", e.target.value)} placeholder="https://maps.app.goo.gl/…" style={lightInputStyle} />
            <label style={labelStyle}>Start time (event begins)</label>
            <input type="time" value={form.event_time} onChange={e => setField("event_time", e.target.value)} style={lightInputStyle} />

            <SectionHeader>Registration</SectionHeader>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={form.registration_open} onChange={e => setField("registration_open", e.target.checked)} />
              <span><strong>Registration open</strong> — uncheck to close the form (shows a "closed" banner)</span>
            </label>
            <label style={labelStyle}>Registration deadline</label>
            <input type="datetime-local" value={form.registration_deadline} onChange={e => setField("registration_deadline", e.target.value)} style={lightInputStyle} />
            <label style={labelStyle}>e-Transfer email (for payments)</label>
            <input type="email" value={form.e_transfer_email} onChange={e => setField("e_transfer_email", e.target.value)} placeholder="payments@yourclub.com" style={lightInputStyle} />
            <label style={labelStyle}>Contact info (shown on the form)</label>
            <textarea value={form.contact_info} onChange={e => setField("contact_info", e.target.value)} placeholder="Email: organizer@club.com&#10;Phone: 604-XXX-XXXX" rows={3} style={{ ...lightInputStyle, resize: "vertical" }} />

            <SectionHeader>Fees</SectionHeader>
            <FeeEditor value={form.fees} onChange={(next) => setField("fees", next)} />

            <SectionHeader>Terms & rules (shown on the form)</SectionHeader>
            <textarea value={form.terms_text} onChange={e => setField("terms_text", e.target.value)} placeholder="Type each paragraph separated by a blank line…" rows={6} style={{ ...lightInputStyle, resize: "vertical", fontFamily: "inherit" }} />

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditing(false)} disabled={busy} style={cancelBtn}>Cancel</button>
              <button onClick={saveEdit} disabled={busy || !form.name.trim()} style={{ ...primaryBtn("#a855f7"), opacity: busy || !form.name.trim() ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------- Styles ---------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginTop: 2,
};

const lightInputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0",
  fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: "border-box", outline: "none",
};

const cancelBtn: React.CSSProperties = {
  flex: 1, padding: 12, borderRadius: 10, border: "none",
  background: "#e2e8f0", color: "#475569", fontWeight: 600, cursor: "pointer",
};

function primaryBtn(bg: string): React.CSSProperties {
  return {
    flex: 1, padding: 12, borderRadius: 10, border: "none",
    background: bg, color: "#fff", fontWeight: 700, cursor: "pointer",
  };
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: 1.5,
      textTransform: "uppercase", borderBottom: "1px solid #e2e8f0",
      paddingBottom: 6, marginTop: 18, marginBottom: 10,
    }}>{children}</div>
  );
}

// ---------- FeeEditor -----------------------------------------------------

const BANDS: { key: AgeBand; label: string }[] = [
  { key: "kid",   label: "Kids (8-12)" },
  { key: "teen",  label: "Teens (13-17)" },
  { key: "adult", label: "Adults (18+)" },
];

function FeeEditor({ value, onChange }: { value: TournamentFees; onChange: (next: TournamentFees) => void }) {
  // Determine initial "member discount" toggle from the data: ON if any band
  // has member !== non_member.
  const initialDiscount = BANDS.some(b => {
    const cell = value[b.key];
    return cell && typeof cell.member === "number" && typeof cell.non_member === "number" && cell.member !== cell.non_member;
  });
  const [discount, setDiscount] = useState(initialDiscount);

  const setBand = (band: AgeBand, field: "member" | "non_member", raw: string) => {
    const num = raw === "" ? NaN : Number(raw);
    const next: TournamentFees = { ...value };
    const cell = { ...(next[band] ?? { member: NaN, non_member: NaN }) };
    if (Number.isNaN(num)) {
      // Clearing the input — remove that side
      (cell as any)[field] = undefined;
    } else {
      cell[field] = num;
      if (!discount) {
        // Mirror to the other side so the schema shape stays consistent (flat fee)
        cell.member = num;
        cell.non_member = num;
      }
    }
    // Drop entirely if both sides are empty/NaN
    const hasMember = typeof cell.member === "number" && !Number.isNaN(cell.member);
    const hasNon = typeof cell.non_member === "number" && !Number.isNaN(cell.non_member);
    if (!hasMember && !hasNon) {
      delete next[band];
    } else {
      next[band] = {
        member: hasMember ? cell.member! : (hasNon ? cell.non_member! : 0),
        non_member: hasNon ? cell.non_member! : (hasMember ? cell.member! : 0),
      };
    }
    onChange(next);
  };

  const onToggleDiscount = (checked: boolean) => {
    setDiscount(checked);
    if (!checked) {
      // Collapse: mirror non_member into member for every band
      const next: TournamentFees = {};
      for (const band of BANDS) {
        const cell = value[band.key];
        if (cell) {
          const v = typeof cell.non_member === "number" ? cell.non_member : cell.member;
          if (typeof v === "number") next[band.key] = { member: v, non_member: v };
        }
      }
      onChange(next);
    }
  };

  return (
    <div>
      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={discount} onChange={e => onToggleDiscount(e.target.checked)} />
        <span><strong>Enable member discount</strong> — show a second column for member rate</span>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: discount ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <div />
        {discount && <div style={miniLabel}>Member ($)</div>}
        <div style={miniLabel}>{discount ? "Non-member ($)" : "Fee ($)"}</div>
      </div>
      {BANDS.map(b => {
        const cell = value[b.key];
        const mem = cell && typeof cell.member === "number" ? cell.member : "";
        const non = cell && typeof cell.non_member === "number" ? cell.non_member : "";
        return (
          <div key={b.key} style={{ display: "grid", gridTemplateColumns: discount ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>{b.label}</label>
            {discount && (
              <input
                type="number" min={0} step={1} value={mem}
                onChange={e => setBand(b.key, "member", e.target.value)}
                placeholder="—"
                style={{ ...lightInputStyle, marginTop: 0, marginBottom: 0 }}
              />
            )}
            <input
              type="number" min={0} step={1} value={non}
              onChange={e => setBand(b.key, "non_member", e.target.value)}
              placeholder="—"
              style={{ ...lightInputStyle, marginTop: 0, marginBottom: 0 }}
            />
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
        Leave a row blank to hide that age band. {discount ? "" : "Both columns will be set to the same value (no discount)."}
      </div>
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase",
};
