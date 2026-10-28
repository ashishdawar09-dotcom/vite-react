/** Search box for the player lists on the Players and Profiles tabs. */
export function PlayerSearch({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div style={{ position: "relative", maxWidth: 360, marginBottom: 16 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search players…"
        aria-label="Search players"
        style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 16, outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}
