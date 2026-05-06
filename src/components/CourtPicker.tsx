import { useState } from "react";

export function CourtPicker({
  numCourts,
  busyCourts, // set of court numbers currently in use
  onPick,
  onCancel,
  trigger,
  warning,
}: {
  numCourts: number;
  busyCourts: Set<number>;
  onPick: (court: number) => void;
  onCancel: () => void;
  trigger?: React.ReactNode;
  warning?: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (trigger && !open) return <div onClick={() => setOpen(true)}>{trigger}</div>;
  const all = Array.from({ length: numCourts }, (_, i) => i + 1);
  const free = all.filter(n => !busyCourts.has(n));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1800, padding: 16, backdropFilter: "blur(4px)" }} onClick={onCancel}>
      <div style={{ background: "#0f1e36", borderRadius: 14, padding: 24, maxWidth: 380, width: "100%", border: "1px solid #1a3050", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
        <h3 className="font-display" style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center" }}>Pick a Court</h3>
        {warning && (
          <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 6, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: "#fbbf24", lineHeight: 1.4 }}>
            ⚠️ {warning}
          </div>
        )}
        {free.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>All courts in use. Wait for one to free up.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(free.length, 4)}, 1fr)`, gap: 10 }}>
            {free.map(n => (
              <button key={n} onClick={() => onPick(n)} className="font-display" style={{ padding: "18px 0", borderRadius: 8, border: "2px solid #00d4ff", background: "rgba(0,184,255,0.1)", color: "#fff", fontWeight: 800, fontSize: 26, cursor: "pointer", letterSpacing: 1, transition: "all .15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,184,255,0.25)"; }} onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,184,255,0.1)"; }}>
                {n}
              </button>
            ))}
          </div>
        )}
        {busyCourts.size > 0 && (
          <div style={{ marginTop: 14, padding: "8px 12px", background: "#0a1628", borderRadius: 6, fontSize: 11, color: "#64748b", textAlign: "center", letterSpacing: 1 }}>
            BUSY: {[...busyCourts].sort().map(n => `Court ${n}`).join(" · ")}
          </div>
        )}
        <button onClick={onCancel} style={{ width: "100%", marginTop: 14, padding: 10, background: "transparent", color: "#94a3b8", border: "1px solid #1a3050", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", letterSpacing: 1 }}>CANCEL</button>
      </div>
    </div>
  );
}
