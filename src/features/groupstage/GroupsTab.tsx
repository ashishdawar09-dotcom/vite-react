import { CategoryFilter } from "../../components/CategoryFilter";
import type { Category, Match, TeamWithPlayers } from "../../types";
import { groupKeyOf, groupLetter, isRoundRobinOnly, type GroupTie } from "../../lib/groups";

export type GroupStanding = { team: TeamWithPlayers; w: number; l: number; pts: number; pf: number; pa: number };

/**
 * Group-stage view: per-group standings tables + match cards.
 *
 * Admin sees a "Start Knockout" CTA once every group's matches are confirmed;
 * a round-robin-only event shows its champion instead. Rows that go through
 * (or the round-robin winner) are highlighted green.
 *
 * Once a group is finished, a note under its table says how any tie was
 * decided (lib/groups.ts: wins, point difference, head-to-head, coin toss).
 * A coin toss gets a warning and, for admins, buttons to record who won it.
 */
export function GroupsTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  currentCategory,
  groups,
  groupMatches,
  getStandings,
  getTies,
  tossWinners,
  onRecordToss,
  onClearToss,
  champion,
  isAdmin,
  allGroupsDone,
  phase,
  onStartKnockout,
  btn,
  MatchCard,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  currentCategory: Category | null;
  groups: TeamWithPlayers[][];
  groupMatches: Match[];
  getStandings: (g: TeamWithPlayers[], gi: number) => GroupStanding[];
  getTies: (g: TeamWithPlayers[]) => GroupTie<TeamWithPlayers>[];
  tossWinners: string[];
  onRecordToss: (teamId: string) => void;
  onClearToss: (teamIds: string[]) => void;
  /** Round-robin-only event: its winner once every match is confirmed. */
  champion: TeamWithPlayers | null;
  isAdmin: boolean;
  allGroupsDone: boolean;
  phase: "none" | "group" | "knockout";
  onStartKnockout: () => void;
  btn: (bg?: string, clr?: string) => React.CSSProperties;
  MatchCard: React.ComponentType<{ match: Match; editable?: boolean; matchMinutes?: number }>;
}) {
  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
      {groups.map((g, gi) => {
        const st = getStandings(g, gi);
        // group_idx restarts in every category: match on both.
        const key = groupKeyOf(g, groupMatches);
        const ms = key ? groupMatches.filter(m => m.category_id === key.category_id && m.group_idx === key.group_idx) : [];
        const cat = key ? categories.find(c => c.id === key.category_id) : undefined;
        const catName = !currentCategoryId ? cat?.name : null;
        const rrOnly = isRoundRobinOnly(cat);
        // Places through: the round-robin winner, else the saved top N (2 if unknown).
        const through = rrOnly ? 1 : cat?.top_n_advance && cat.top_n_advance > 0 ? cat.top_n_advance : 2;
        const finished = ms.length > 0 && ms.every(m => m.confirmed);
        const ties = finished ? getTies(g) : [];
        return (
          <div key={key ? `${key.category_id}-${key.group_idx}` : gi} style={{ marginBottom: 32, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", border: "1px solid #e8ecf1" }}>
            <div style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)", padding: "14px 20px" }}>
              <span style={{ background: "#3A86FF", color: "#fff", borderRadius: 8, padding: "4px 14px", fontSize: 14, fontWeight: 800 }}>{catName ? `${catName} · ` : ""}Group {groupLetter(key?.group_idx ?? gi)}</span>
              <span style={{ color: "#94a3b8", fontSize: 13, marginLeft: 10 }}>{g.length} teams • {ms.filter(m => m.confirmed).length}/{ms.length} matches</span>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ overflowX: "auto", marginBottom: 16 }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px" }}>
                  <thead><tr>{["#", "Team", "W", "L", "PF", "PA", "+/-", "Pts"].map(h => <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>)}</tr></thead>
                  <tbody>{st.map((s, si) => (
                    <tr key={s.team.id} style={{ background: si < through ? "#f0fdf4" : "#f8fafc" }}>
                      {/* MAKEOVER: tabular-nums on all numeric columns for clean digit alignment */}
                      <td style={{ padding: "10px 12px", fontWeight: 800, color: si < through ? "#16a34a" : "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{si + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{s.w}</td>
                      <td style={{ padding: "10px 12px", color: "#E63946", fontVariantNumeric: "tabular-nums" }}>{s.l}</td>
                      <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>{s.pf}</td>
                      <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>{s.pa}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: s.pf - s.pa > 0 ? "#16a34a" : s.pf - s.pa < 0 ? "#E63946" : "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                      <td className="font-display" style={{ padding: "10px 12px", fontWeight: 800, fontSize: 18, color: "#3A86FF", fontVariantNumeric: "tabular-nums" }}>{s.pts}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {ties.map(t => (
                <TieNote key={t.teams.map(x => x.id).join("|")} tie={t} through={rrOnly ? 0 : through} rrOnly={rrOnly}
                  isAdmin={isAdmin} tossWinners={tossWinners} onRecordToss={onRecordToss} onClearToss={onClearToss} />
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                {ms.map(m => <MatchCard key={m.id} match={m} matchMinutes={currentCategory?.match_minutes} />)}
              </div>
            </div>
          </div>
        );
      })}
      {allGroupsDone && phase === "group" && isRoundRobinOnly(currentCategory) && (
        <div style={{ textAlign: "center", marginTop: 24, padding: 24, background: "linear-gradient(135deg,#fef9c3,#fde68a)", borderRadius: 16, border: "2px solid #f59e0b" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#92400e", textTransform: "uppercase" }}>Round robin · {currentCategory?.name}</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#1a1a2e" }}>
            {champion ? `🏆 Champion: ${teamName(champion)}` : "First place needs a coin toss (see the table)"}
          </div>
          {isAdmin && (
            <button onClick={onStartKnockout} style={{ ...btn("#e2e8f0", "#475569"), marginTop: 14, padding: "8px 16px", fontSize: 13, borderRadius: 10, boxShadow: "none" }}>
              Start a knockout anyway
            </button>
          )}
        </div>
      )}
      {isAdmin && allGroupsDone && phase === "group" && !isRoundRobinOnly(currentCategory) && (
        <div style={{ textAlign: "center", marginTop: 24, padding: 28, background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", borderRadius: 16, border: "2px solid #86efac" }}>
          <button onClick={onStartKnockout} style={{ ...btn("#E63946"), padding: "16px 44px", fontSize: 18, borderRadius: 14 }}>⚔️ Start Knockout Stage</button>
        </div>
      )}
    </div>
  );
}

const teamName = (t: TeamWithPlayers) => (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** How a tie in a finished group was decided; a coin toss asks the directors to record it. */
function TieNote({ tie, through, rrOnly, isAdmin, tossWinners, onRecordToss, onClearToss }: {
  tie: GroupTie<TeamWithPlayers>;
  /** Places that go through to the knockout (0: none). */
  through: number;
  rrOnly: boolean;
  isAdmin: boolean;
  tossWinners: string[];
  onRecordToss: (teamId: string) => void;
  onClearToss: (teamIds: string[]) => void;
}) {
  const [from, to] = tie.places;
  const places = from === to ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`;
  const names = tie.teams.map(teamName);
  if (tie.decidedBy === "head-to-head") {
    return (
      <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#f1f5f9", color: "#475569", fontSize: 13 }}>
        ℹ️ {listOf(names)} finished level on wins and point difference. Head-to-head puts them in this order: {names.join(", then ")}.
      </div>
    );
  }
  const stakes = through > 0 && from <= through && through < to ? " It decides who goes through to the knockout."
    : rrOnly && from === 1 ? " It decides the champion."
    : rrOnly && from <= 3 ? " It decides the podium." : "";
  const recorded = tie.teams.filter(t => tossWinners.includes(t.id));
  const open = tie.teams.filter(t => !tossWinners.includes(t.id));
  return (
    <div role="status" style={{ margin: "-6px 0 14px", padding: "10px 12px", borderRadius: 10, fontSize: 13,
      background: tie.tossed ? "#f0fdf4" : "#fef3c7", border: `1px solid ${tie.tossed ? "#86efac" : "#f59e0b"}`, color: "#1a1a2e" }}>
      {tie.tossed ? (
        <>🪙 Coin toss for {places}: {names.join(", then ")}. Recorded on this device.</>
      ) : (
        <>⚠️ <strong>Coin toss needed for {places}.</strong> {listOf(names)} are level on wins, point difference and head-to-head.{stakes} Until the toss is recorded, the table shows them in draw order.</>
      )}
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {!tie.tossed && open.map(t => (
            <button key={t.id} onClick={() => onRecordToss(t.id)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #f59e0b", background: "#fff", color: "#92400e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              🪙 {teamName(t)} won{recorded.length ? " the next toss" : " the toss"}
            </button>
          ))}
          {recorded.length > 0 && (
            <button onClick={() => onClearToss(tie.teams.map(t => t.id))}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Undo toss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
