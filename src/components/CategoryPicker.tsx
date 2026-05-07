import React from "react";
import type { Category } from "../types";

export const CategoryPicker = React.memo(function CategoryPicker({
  categories,
  currentId,
  onSelect,
}: {
  categories: Category[];
  currentId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 14px", borderRadius: 6, background: "rgba(0,184,255,0.1)", border: "1px solid rgba(0,184,255,0.3)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#00d4ff", textTransform: "uppercase" }}>Category</span>
      <select
        value={currentId ?? ""}
        onChange={e => onSelect(e.target.value || null)}
        className="font-display"
        style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(0,184,255,0.3)", background: "#0a1628", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}
      >
        <option value="" style={{ background: "#0a1628", color: "#fff" }}>ALL CATEGORIES</option>
        {categories.map(c => (
          <option key={c.id} value={c.id} style={{ background: "#0a1628", color: "#fff" }}>
            {c.team_size === 1 ? "👤 " : "👥 "}{c.name.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
});
