import type { Category } from "../types";

export function CategoryFilter({
  categories,
  currentCategoryId,
  onSelect,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (categories.length === 0) return null;

  const pill = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 20,
    border: active ? "2px solid #00d4ff" : "1px solid #1a3050",
    background: active ? "rgba(0,184,255,0.15)" : "transparent",
    color: active ? "#00d4ff" : "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: 0.5,
    transition: "all .15s",
  });

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
      <button onClick={() => onSelect(null)} className="font-display" style={pill(currentCategoryId === null)}>
        ALL
      </button>
      {categories.map(c => (
        <button key={c.id} onClick={() => onSelect(c.id)} className="font-display" style={pill(currentCategoryId === c.id)}>
          {c.team_size === 1 ? "👤" : "👥"} {c.name.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
