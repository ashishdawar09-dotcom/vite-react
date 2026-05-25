import { useEffect, useMemo, useState } from "react";
import * as db from "../lib/db";
import { toast } from "./Toast";
import { recommendFormats, describeFormat, type FormatPlan } from "../lib/formatPlanner";
import type { AgeBand, Category, Player, PlayerCategory } from "../types";

export function CategoryEditor({
  tournamentId,
  category,
  players,
  playerCategories,
  numCourts,
  onClose,
}: {
  tournamentId: string;
  category?: Category;
  players: Player[];
  playerCategories: PlayerCategory[];
  numCourts: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [teamSize, setTeamSize] = useState<1 | 2>(category?.team_size ?? 2);
  const [matchMin, setMatchMin] = useState(category?.match_minutes ?? 12);
  const [startsAt, setStartsAt] = useState<string>(category?.starts_at ? toLocalInput(category.starts_at) : "");
  const [ageBand, setAgeBand] = useState<AgeBand | null>(category?.age_band ?? null);
  const [allowSolo, setAllowSolo] = useState<boolean>(category?.allow_solo_signup ?? false);
  const [hasBronze, setHasBronze] = useState<boolean>(category?.has_bronze_match ?? false);
  const [busy, setBusy] = useState(false);

  // Estimated number of teams in this category — drives the format recommender.
  // Doubles → floor(activePlayers / 2). Singles → activePlayers.
  const estimatedTeamCount = useMemo(() => {
    if (!category) return 0;
    const idsInCat = new Set(playerCategories.filter(pc => pc.category_id === category.id).map(pc => pc.player_id));
    const activeInCat = players.filter(p => p.active && idsInCat.has(p.id));
    return teamSize === 2 ? Math.floor(activeInCat.length / 2) : activeInCat.length;
  }, [category, players, playerCategories, teamSize]);

  // Format option cards (recommended / more games / compact). Computed once per
  // (estimatedTeamCount) and selection is stored as the picked plan's label.
  const formatOptions = useMemo<FormatPlan[]>(
    () => estimatedTeamCount >= 2 ? recommendFormats(estimatedTeamCount) : [],
    [estimatedTeamCount],
  );

  // Pick the option that best matches the saved category settings; default to "Recommended".
  const initialLabel: FormatPlan["label"] = useMemo(() => {
    if (!category || formatOptions.length === 0) return "Recommended";
    const match = formatOptions.find(o =>
      o.groupsCount === category.groups_count &&
      o.topNAdvance === category.top_n_advance &&
      o.roundsPerPair === category.rounds_per_pair,
    );
    return match?.label ?? "Recommended";
  }, [category, formatOptions]);
  const [selectedLabel, setSelectedLabel] = useState<FormatPlan["label"]>(initialLabel);

  // Re-sync selectedLabel when the recomputed initialLabel changes (e.g.
  // formatOptions array refreshes due to teamSize toggle).
  useEffect(() => { setSelectedLabel(initialLabel); }, [initialLabel]);

  // Optimistic local state for player↔category checkboxes. Initialized from
  // `playerCategories` prop, kept in sync via the useEffect below so realtime
  // updates from other admins are reflected. Click handlers update locally
  // first (instant UX), then fire the async server write — revert on error.
  const [localAssigned, setLocalAssigned] = useState<Set<string>>(() =>
    new Set(playerCategories.filter(pc => pc.category_id === category?.id).map(pc => pc.player_id))
  );

  useEffect(() => {
    if (!category) return;
    setLocalAssigned(new Set(playerCategories.filter(pc => pc.category_id === category.id).map(pc => pc.player_id)));
  }, [playerCategories, category?.id]);

  const save = async () => {
    if (!name.trim()) { toast("Category name required", "warn"); return; }
    setBusy(true);
    try {
      const startsIso = startsAt ? new Date(startsAt).toISOString() : null;
      const selectedPlan = formatOptions.find(o => o.label === selectedLabel);
      if (category) {
        const patch: Partial<Category> = {
          name: name.trim(),
          team_size: teamSize,
          match_minutes: matchMin,
          starts_at: startsIso,
          age_band: ageBand,
          allow_solo_signup: allowSolo,
          has_bronze_match: hasBronze,
        };
        if (selectedPlan) {
          patch.groups_count = selectedPlan.groupsCount;
          patch.top_n_advance = selectedPlan.topNAdvance;
          patch.rounds_per_pair = selectedPlan.roundsPerPair;
        }
        await db.updateCategory(category.id, patch);
      } else {
        const created = await db.createCategory(tournamentId, name.trim(), teamSize, startsIso, matchMin);
        if (ageBand !== null || allowSolo || hasBronze) {
          await db.updateCategory(created.id, { age_band: ageBand, allow_solo_signup: allowSolo, has_bronze_match: hasBronze });
        }
      }
      onClose();
    } catch (e: any) { toast(e?.message ?? "Save failed", "error"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!category) return;
    if (!confirm(`Delete "${category.name}" — all teams + matches in this category will be removed. Continue?`)) return;
    setBusy(true);
    try { await db.deleteCategory(category.id); onClose(); }
    catch (e: any) { toast(e?.message ?? "Delete failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: "#0f1e36", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: "1px solid #1a3050", color: "#fff" }} onClick={e => e.stopPropagation()}>
        <h3 className="font-display" style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{category ? "Edit Category" : "New Category"}</h3>

        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Men's Singles" style={inputStyle} autoFocus />
        </Field>

        <Field label="Format">
          <div style={{ display: "flex", gap: 8 }}>
            <FormatBtn active={teamSize === 1} onClick={() => setTeamSize(1)}>👤 SINGLES</FormatBtn>
            <FormatBtn active={teamSize === 2} onClick={() => setTeamSize(2)}>👥 DOUBLES</FormatBtn>
          </div>
        </Field>

        <Field label="Match duration (default minutes)">
          <input type="number" min={5} max={60} value={matchMin} onChange={e => setMatchMin(parseInt(e.target.value) || 12)} style={inputStyle} />
        </Field>

        <Field label="Start time (optional)">
          <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Age band (drives registration fee tier)">
          <select
            value={ageBand ?? ""}
            onChange={e => setAgeBand((e.target.value || null) as AgeBand | null)}
            style={inputStyle}
          >
            <option value="">— None —</option>
            <option value="kid">Kid (8-12)</option>
            <option value="teen">Teen (13-17)</option>
            <option value="adult">Adult (18+)</option>
          </select>
        </Field>

        {teamSize === 2 && (
          <Field label="Allow solo signup">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "#cbd5e1" }}>
              <input
                type="checkbox"
                checked={allowSolo}
                onChange={e => setAllowSolo(e.target.checked)}
                style={{ accentColor: "#00d4ff", width: 16, height: 16 }}
              />
              <span>Players can register without a partner (we'll pair them)</span>
            </label>
          </Field>
        )}

        <Field label="3rd-place playoff">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "#cbd5e1" }}>
            <input
              type="checkbox"
              checked={hasBronze}
              onChange={e => setHasBronze(e.target.checked)}
              style={{ accentColor: "#f59e0b", width: 16, height: 16 }}
            />
            <span>Add a bronze match — the two semi-final losers play for 3rd place.</span>
          </label>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
            Only takes effect once the bracket has semi-finals (4 or more qualifiers).
          </div>
        </Field>

        {/* Tournament format recommender — appears once the category has assigned
            players (so the team count is known). Picking an option saves
            groups_count + top_n_advance + rounds_per_pair on Save. */}
        {category && formatOptions.length > 0 && (
          <Field label={`Tournament format · ${estimatedTeamCount} team${estimatedTeamCount === 1 ? "" : "s"} estimated`}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${formatOptions.length}, 1fr)`, gap: 8 }}>
              {formatOptions.map(opt => {
                const selected = opt.label === selectedLabel;
                const accent = opt.label === "Recommended" ? "#22c55e" : opt.label === "More games" ? "#a855f7" : "#3b82f6";
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedLabel(opt.label)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: selected ? `2px solid ${accent}` : "1px solid #1a3050",
                      background: selected ? `${accent}14` : "#0a1628",
                      color: "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all .12s",
                    }}
                  >
                    <div className="font-display" style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
                      {selected && "✓ "}{opt.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 4, lineHeight: 1.3 }}>{describeFormat(opt)}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {opt.totalMatches} match{opt.totalMatches === 1 ? "" : "es"} · ~{opt.estimatedMinutes(matchMin, Math.max(1, numCourts))} min
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
              Time estimates assume {numCourts} court{numCourts === 1 ? "" : "s"} running in parallel · {matchMin} min/match.
            </div>
          </Field>
        )}

        {category && estimatedTeamCount === 1 && (
          <div style={{ padding: "10px 12px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 8, fontSize: 12, color: "#fbbf24", marginBottom: 14 }}>
            Only 1 active team in this category. Add at least 2 active teams to see format options.
          </div>
        )}

        {category && (() => {
          const sorted = [...players].sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return a.sort_order - b.sort_order;
          });
          return (
            <Field label={`Players in this category (${localAssigned.size})`}>
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #1a3050", borderRadius: 6, background: "#0a1628" }}>
                {sorted.map(p => {
                  const has = localAssigned.has(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1a3050", opacity: p.active ? 1 : 0.5 }}>
                      <input type="checkbox" checked={has} onChange={async () => {
                        // Optimistic toggle
                        setLocalAssigned(prev => {
                          const next = new Set(prev);
                          if (has) next.delete(p.id); else next.add(p.id);
                          return next;
                        });
                        try {
                          if (has) await db.removePlayerFromCategory(p.id, category.id);
                          else await db.addPlayerToCategory(p.id, category.id);
                        } catch (e: any) {
                          // Revert on failure
                          setLocalAssigned(prev => {
                            const next = new Set(prev);
                            if (has) next.add(p.id); else next.delete(p.id);
                            return next;
                          });
                          toast(e?.message ?? "Failed to update category assignment", "error");
                        }
                      }} style={{ accentColor: "#00d4ff", width: 16, height: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: has ? "#00d4ff" : "#94a3b8" }}>{p.name}</span>
                      {!p.active && <span style={{ fontSize: 10, color: "#64748b" }}>(inactive)</span>}
                    </label>
                  );
                })}
              </div>
            </Field>
          );
        })()}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          {category && <button disabled={busy} onClick={remove} style={{ padding: "10px 16px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12, letterSpacing: 1 }}>DELETE</button>}
          <div style={{ flex: 1 }} />
          <button disabled={busy} onClick={onClose} style={{ padding: "10px 18px", background: "transparent", color: "#94a3b8", border: "1px solid #1a3050", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 12, letterSpacing: 1 }}>CANCEL</button>
          <button disabled={busy} onClick={save} className="font-display" style={{ padding: "10px 24px", background: "linear-gradient(135deg,#00b8ff,#0066ff)", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontSize: 13, letterSpacing: 1.5, opacity: busy ? 0.6 : 1 }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

function FormatBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="font-display" style={{ flex: 1, padding: "10px 12px", borderRadius: 6, border: active ? "2px solid #00d4ff" : "1px solid #1a3050", background: active ? "rgba(0,184,255,0.15)" : "transparent", color: active ? "#00d4ff" : "#94a3b8", fontWeight: 700, cursor: "pointer", fontSize: 12, letterSpacing: 1.5, transition: "all .15s" }}>
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box" };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  // produce YYYY-MM-DDTHH:MM in LOCAL time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
