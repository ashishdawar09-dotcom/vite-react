import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, EntrySeed, EntrySeedInput, Player, PlayerCategory, Team, Tournament } from "../../types";

type TeamView = Team & { p1: Player; p2: Player | null };
import * as db from "../../lib/db";
import { toast } from "../../components/Toast";
import { planStart } from "../../lib/stageStart";
import { groupLetter } from "../../lib/groups";
import { isStrong, seedGroups, seededRng, seedingSummary, strongClashes, type SeedInfo, type SeedTier } from "../../lib/seeding";
import { eventChip, nextTier, rankEntries, removeSeed, addSeed, moveSeedUp, type Draft } from "./seedingDraft";

/**
 * Admin Seeding screen (design C, "Seeds + live draw", picked by Ashish on
 * Nov 13 2026). One ranked list per event: number the top entries 1, 2, 3…
 * and tag others A or B. "Where they'd land" runs the same seedGroups the real
 * draw uses. ADMIN-ONLY: entry_seeds has no public read, and nothing here is
 * shown on a public page.
 */

type Entry = { key: string; label: string; teamId: string | null; playerId: string | null };

const card: React.CSSProperties = { background: "#0a1628", border: "1px solid #1a3050", borderRadius: 14, padding: 14, marginBottom: 14, color: "#e2e8f0" };
const chip = (on: boolean): React.CSSProperties => ({ padding: "7px 11px", borderRadius: 999, border: `1px solid ${on ? "#00d4ff" : "#1a3050"}`, background: on ? "rgba(0,212,255,0.14)" : "#070F1F", color: on ? "#e0f9ff" : "#cbd5e1", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flex: "0 0 auto" });
const primary: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "none", background: "#00d4ff", color: "#00131A", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const ghost: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid #1a3050", background: "transparent", color: "#e2e8f0", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const circle = (seeded: boolean): React.CSSProperties => ({ width: 36, height: 36, borderRadius: "50%", flex: "0 0 36px", border: seeded ? "none" : "1px dashed #3a5070", background: seeded ? "#00d4ff" : "transparent", color: seeded ? "#00131A" : "#7a8aa0", fontWeight: 800, fontSize: seeded ? 15 : 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 });
const tierTag = (t: SeedTier | null, disabled: boolean): React.CSSProperties => ({
  minWidth: 44, height: 32, borderRadius: 8, flex: "0 0 auto", cursor: disabled ? "default" : "pointer", fontWeight: 800, fontSize: 13,
  border: `1px solid ${t === "A" ? "#facc15" : t === "B" ? "#60a5fa" : "#1a3050"}`,
  background: t === "A" ? "rgba(250,204,21,0.14)" : t === "B" ? "rgba(96,165,250,0.12)" : "transparent",
  color: t === "A" ? "#fde68a" : t === "B" ? "#bfdbfe" : "#64748b", opacity: disabled ? 0.35 : 1,
});

export function SeedingTab({ tournament, categories, players, playerCategories, allTeamsView }: {
  tournament: Tournament;
  categories: Category[];
  players: Player[];
  playerCategories: PlayerCategory[];
  allTeamsView: TeamView[];
}) {
  const events = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order), [categories]);
  const [catId, setCatId] = useState<string | null>(null);
  const cat = events.find(c => c.id === catId) ?? events[0] ?? null;
  const [saved, setSaved] = useState<EntrySeed[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSaved(await db.listEntrySeeds(tournament.id));
      setLoadError(null);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setLoadError(code === "42P01" || code === "PGRST205"
        ? "The seeding table isn't in the database yet (the update hasn't been applied)."
        : `Couldn't load the seeds: ${(e as { message?: string })?.message ?? "error"}`);
    }
  }, [tournament.id]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  // The event's entries: players for singles, teams for doubles.
  const entries = useMemo<Entry[]>(() => {
    if (!cat) return [];
    if (cat.team_size === 1) {
      const inCat = new Set(playerCategories.filter(pc => pc.category_id === cat.id).map(pc => pc.player_id));
      return players.filter(p => p.active && inCat.has(p.id))
        .map(p => ({ key: `p:${p.id}`, label: p.name, teamId: null, playerId: p.id }));
    }
    return allTeamsView.filter(t => t.category_id === cat.id)
      .map(t => ({ key: `t:${t.id}`, label: t.p2 ? `${t.p1.name} + ${t.p2.name}` : t.name || t.p1.name, teamId: t.id, playerId: null }));
  }, [cat, players, playerCategories, allTeamsView]);

  // Reset the draft from the saved rows when the event or the saved rows change.
  useEffect(() => {
    if (!cat) return;
    const d: Draft = {};
    for (const r of saved) {
      if (r.category_id !== cat.id) continue;
      const key = r.team_id ? `t:${r.team_id}` : `p:${r.player_id}`;
      d[key] = { seed: r.seed, tier: r.tier };
    }
    const t = setTimeout(() => { setDraft(d); setDirty(false); }, 0);
    return () => clearTimeout(t);
  }, [cat, saved]);

  const infoOf = useCallback((e: Entry): SeedInfo | null => draft[e.key] ?? null, [draft]);
  const ranked = useMemo(() => rankEntries(entries, e => e.key, draft), [entries, draft]);

  const plan = cat ? planStart(entries.length, undefined, cat) : { kind: "too-few" as const };
  const groupSizes = plan.kind === "groups" ? plan.groupSizes : [];
  const G = groupSizes.length;
  const seededCount = entries.filter(e => draft[e.key]?.seed != null).length;
  const tierACount = entries.filter(e => draft[e.key]?.seed == null && draft[e.key]?.tier === "A").length;
  const summary = seedingSummary(G, seededCount, tierACount);

  // Same function as the real draw, with a fixed RNG so the preview holds still.
  const sizesKey = groupSizes.join(",");
  const preview = useMemo(
    () => (sizesKey ? seedGroups(entries, sizesKey.split(",").map(Number), infoOf, seededRng(20261121)) : []),
    [entries, infoOf, sizesKey]);
  const clashes = strongClashes(preview, infoOf);
  const seedNo = (n: number) => entries.find(e => draft[e.key]?.seed === n);

  const update = (fn: (d: Draft) => Draft) => { setDraft(fn); setDirty(true); };
  const pickEvent = (id: string) => {
    if (dirty && !confirm("You have unsaved seeds for this event. Leave without saving?")) return;
    setCatId(id);
  };
  const save = async () => {
    if (!cat) return;
    setBusy(true);
    try {
      const rows: EntrySeedInput[] = entries
        .filter(e => draft[e.key]?.seed != null || draft[e.key]?.tier)
        .map(e => ({ team_id: e.teamId, player_id: e.playerId, seed: draft[e.key]?.seed ?? null, tier: draft[e.key]?.tier ?? null, note: null }));
      const fresh = await db.saveEntrySeeds(cat.id, rows);
      setSaved(s => [...s.filter(r => r.category_id !== cat.id), ...fresh]);
      setDirty(false);
      toast(`Seeds saved for ${cat.name}.`, "success");
    } catch (e) {
      toast(`Not saved: ${(e as { message?: string })?.message ?? "error"}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!cat) return <div style={card}>No events yet.</div>;
  const noun = cat.team_size === 1 ? (entries.length === 1 ? "player" : "players") : (entries.length === 1 ? "team" : "teams");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 4px 96px" }} data-testid="seeding-tab">
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 10px", color: "#e2e8f0" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Seeding</h2>
        <span title="Only tournament admins can see seeds and tiers" style={{ fontSize: 12, color: "#94a3b8", border: "1px solid #1a3050", borderRadius: 999, padding: "3px 9px" }}>🔒 Admin only · players never see this</span>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 6 }} role="tablist" aria-label="Event">
        {events.map(c => (
          <button key={c.id} role="tab" aria-selected={c.id === cat.id} title={c.name} style={chip(c.id === cat.id)} onClick={() => pickEvent(c.id)}>{eventChip(c.name)}</button>
        ))}
      </div>

      {loadError && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fecaca" }}>{loadError}</div>}

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{cat.name}</div>
        <div data-testid="seeding-note" style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
          {entries.length} {noun}
          {G > 0 ? <> · {G} group{G === 1 ? "" : "s"} · seed at least {summary.minSeeds} · {seededCount} seeded{tierACount ? ` · ${tierACount} tier A` : ""}</>
            : plan.kind === "final" ? <> · final only (no groups)</> : <> · too few to draw</>}
        </div>
        {cat.phase !== "none" && (
          <div style={{ fontSize: 13, color: "#fde68a", marginTop: 6 }}>
            {cat.phase === "group" ? "Groups are already drawn. Seeds now only order the knockout." : "The knockout has started. Changing seeds won't move anyone now."}
          </div>
        )}
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          Tap + to give the next seed number; tap a number to clear it. Tap the tag to cycle A / B / none. Unrated entries are drawn at random.
        </div>
      </div>

      <div style={{ ...card, padding: 6 }}>
        {ranked.length === 0 && <div style={{ padding: 12, color: "#94a3b8" }}>No {noun} in this event yet.</div>}
        {ranked.map(e => {
          const d = draft[e.key];
          const seed = d?.seed ?? null;
          return (
            <div key={e.key} data-testid="seeding-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderBottom: "1px solid #12233d" }}>
              <button
                style={circle(seed != null)}
                aria-label={seed != null ? `Seed ${seed}: tap to clear` : `Give ${e.label} the next seed number`}
                onClick={() => update(dr => (seed != null ? removeSeed(dr, e.key) : addSeed(dr, e.key)))}
              >{seed ?? "+"}</button>
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: seed != null ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
              {seed != null && seed > 1 && (
                <button style={{ ...ghost, padding: "6px 9px" }} aria-label={`Move ${e.label} up to seed ${seed - 1}`} onClick={() => update(dr => moveSeedUp(dr, e.key))}>▲</button>
              )}
              <button
                style={tierTag(d?.tier ?? null, seed != null)}
                disabled={seed != null}
                aria-label={`Tier for ${e.label}: ${d?.tier ?? "none"}`}
                onClick={() => update(dr => ({ ...dr, [e.key]: { seed: dr[e.key]?.seed ?? null, tier: nextTier(dr[e.key]?.tier ?? null) } }))}
              >{seed != null ? "—" : d?.tier ?? "–"}</button>
            </div>
          );
        })}
      </div>

      {G > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Where they'd land</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {preview.map((g, gi) => {
              const strong = g.filter(e => isStrong(infoOf(e)));
              return (
                <div key={gi} data-testid="seeding-group" style={{ border: `1px solid ${clashes.includes(gi) ? "#f87171" : "#1a3050"}`, borderRadius: 10, padding: 8, background: "#070F1F" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#94a3b8", marginBottom: 4 }}>Group {groupLetter(gi)} · {g.length}</div>
                  {strong.length === 0 && <div style={{ fontSize: 13, color: "#64748b" }}>open</div>}
                  {strong.map(e => {
                    const i = infoOf(e)!;
                    return (
                      <div key={e.key} style={{ fontSize: 13, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <b style={{ color: i.seed != null ? "#00d4ff" : "#fde68a" }}>{i.seed != null ? `[${i.seed}]` : "A"}</b> {e.label}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
            {seedNo(1) && seedNo(2) && G >= 2 && <div style={{ color: "#86efac" }}>1 and 2 can only meet in the final (if both win their groups).</div>}
            {seededCount > 0 && seededCount < G && <div style={{ color: "#94a3b8" }}>{G - seededCount} group{G - seededCount === 1 ? " has" : "s have"} no seed yet.</div>}
            {clashes.length > 0 && (
              <div data-testid="seeding-warning" style={{ color: "#fca5a5" }}>
                ⚠ {summary.strong} strong entries for {G} groups: Group{clashes.length === 1 ? "" : "s"} {clashes.map(groupLetter).join(", ")} would get two. Tier fewer entries A, or accept that they can meet in a group.
              </div>
            )}
            {tierACount > 0 && <div style={{ color: "#64748b" }}>Tier A entries go to these groups in a random order on the day.</div>}
          </div>
        </div>
      )}

      <div style={{ position: "sticky", bottom: 12, display: "flex", gap: 8, justifyContent: "flex-end", padding: 10, background: "rgba(7,15,31,0.92)", border: "1px solid #1a3050", borderRadius: 12 }}>
        {(seededCount > 0 || entries.some(e => draft[e.key]?.tier)) && (
          <button style={ghost} onClick={() => { if (confirm(`Clear every seed and tier for ${cat.name}? (Not saved until you tap Save.)`)) update(() => ({})); }}>Clear all</button>
        )}
        <button style={{ ...primary, opacity: dirty && !busy ? 1 : 0.5 }} disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : dirty ? "Save seeds" : "Saved"}</button>
      </div>
    </div>
  );
}
