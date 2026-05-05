import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useTournamentData } from "./hooks/useTournamentData";
import * as db from "./lib/db";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { TournamentPicker } from "./components/TournamentPicker";
import type { Match, Player, Team, Tournament } from "./types";

const ShuttleSVG = ({ sz = 40, color = "#fff", opacity = 0.12, style = {} as React.CSSProperties }) => (
  <svg width={sz} height={sz} viewBox="0 0 100 100" style={{ opacity, ...style }}>
    <ellipse cx="50" cy="75" rx="12" ry="12" fill={color} />
    <path d="M38 72 Q30 40 25 10 L35 15 Q40 45 42 70Z" fill={color} opacity="0.7" />
    <path d="M44 68 Q42 35 44 5 L50 10 Q50 40 48 66Z" fill={color} opacity="0.8" />
    <path d="M52 66 Q55 35 56 5 L50 10 Q52 40 52 66Z" fill={color} opacity="0.8" />
    <path d="M56 68 Q60 40 65 15 L75 10 Q70 40 62 70Z" fill={color} opacity="0.7" />
  </svg>
);

function Av({ name, photo, sz = 40, color }: { name: string; photo?: string | null; sz?: number; color?: string }) {
  if (photo) return <img src={photo} alt={name} style={{ width: sz, height: sz, borderRadius: "50%", objectFit: "cover", border: `2px solid ${color || "#457B9D"}` }} />;
  const ini = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return <div style={{ width: sz, height: sz, borderRadius: "50%", background: `linear-gradient(135deg, ${color || "#457B9D"}, ${color || "#457B9D"}dd)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: sz * 0.38, flexShrink: 0, boxShadow: `0 2px 8px ${color || "#457B9D"}44` }}>{ini}</div>;
}

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

const rName = (n: number, i: number) => { if (i === n - 1) return "🏆 Final"; if (i === n - 2) return "Semi-Final"; if (i === n - 3) return "Quarter-Final"; return `Round ${i + 1}`; };

type TeamView = Team & { p1: Player; p2: Player };

export default function App() {
  const { isAdmin, email, loading: authLoading } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [tab, setTab] = useState<"live" | "register" | "profiles" | "teams" | "groups" | "knockout" | "scoreboard">("live");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [partnerPicker, setPartnerPicker] = useState<string | null>(null); // playerId whose partner we're choosing
  const [pendingRounds, setPendingRounds] = useState(1);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null); // confirmed match being re-edited
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const reloadTournaments = async () => {
    const list = await db.listTournaments();
    setTournaments(list);
    setCurrentId(curr => {
      if (curr && list.find(t => t.id === curr)) return curr;
      return list[0]?.id ?? null;
    });
  };

  useEffect(() => { reloadTournaments(); }, []);

  useEffect(() => {
    const ch = supabase.channel("tournaments-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, reloadTournaments)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const current = tournaments.find(t => t.id === currentId) ?? null;
  const phase = current?.phase ?? "none";
  const { players, teams, matches } = useTournamentData(currentId);

  const playerById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const teamsView: TeamView[] = useMemo(
    () => teams.map(t => ({ ...t, p1: playerById[t.p1_id], p2: playerById[t.p2_id] })).filter(t => t.p1 && t.p2) as TeamView[],
    [teams, playerById]
  );
  const teamById = useMemo(() => Object.fromEntries(teamsView.map(t => [t.id, t])), [teamsView]);

  const groupMatches = useMemo(() => matches.filter(m => m.stage === "group").sort((a, b) => (a.group_idx! - b.group_idx!) || (a.slot_idx - b.slot_idx)), [matches]);
  const knockoutMatches = useMemo(() => matches.filter(m => m.stage === "knockout").sort((a, b) => (a.round_idx! - b.round_idx!) || (a.slot_idx - b.slot_idx)), [matches]);

  const groups: TeamView[][] = useMemo(() => {
    const map = new Map<number, Set<string>>();
    groupMatches.forEach(m => {
      if (m.group_idx == null) return;
      if (!map.has(m.group_idx)) map.set(m.group_idx, new Set());
      const s = map.get(m.group_idx)!;
      if (m.team_a_id) s.add(m.team_a_id);
      if (m.team_b_id) s.add(m.team_b_id);
    });
    return [...map.keys()].sort((a, b) => a - b).map(gi => [...map.get(gi)!].map(id => teamById[id]).filter(Boolean) as TeamView[]);
  }, [groupMatches, teamById]);

  const knockout: Match[][] = useMemo(() => {
    const map = new Map<number, Match[]>();
    knockoutMatches.forEach(m => {
      if (m.round_idx == null) return;
      if (!map.has(m.round_idx)) map.set(m.round_idx, []);
      map.get(m.round_idx)!.push(m);
    });
    return [...map.keys()].sort((a, b) => a - b).map(ri => map.get(ri)!.sort((a, b) => a.slot_idx - b.slot_idx));
  }, [knockoutMatches]);

  const active = players.filter(p => p.active);
  const paired = new Set(teamsView.flatMap(t => [t.p1_id, t.p2_id]));
  const unpaired = active.filter(p => !paired.has(p.id));

  const guard = () => { if (!isAdmin) { setShowLogin(true); return false; } return true; };

  const addPlayer = async () => {
    if (!guard() || !current) return;
    const n = newName.trim(); if (!n) return;
    await db.addPlayer(current.id, n, players.length);
    setNewName("");
  };
  const startEdit = (p: Player) => { if (!guard()) return; setEditingId(p.id); setEditName(p.name); };
  const saveEdit = async (id: string) => {
    const n = editName.trim();
    if (!n) { setEditingId(null); return; }
    await db.updatePlayer(id, { name: n });
    setEditingId(null); setEditName("");
  };
  const toggleActive = async (id: string) => {
    if (!guard()) return;
    const p = playerById[id]; if (!p) return;
    await db.updatePlayer(id, { active: !p.active });
    if (p.active) await db.deleteTeamsContainingPlayer(id);
  };
  const handlePhoto = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!guard()) return;
    const f = e.target.files?.[0]; if (!f) return;
    const url = await db.uploadPlayerPhoto(id, f);
    await db.updatePlayer(id, { photo_url: url });
  };
  const openPartnerPicker = (pid: string) => { if (!guard()) return; setPartnerPicker(pid); };
  const assignPartner = async (p1Id: string, p2Id: string) => {
    if (!current) return;
    await db.createTeam(current.id, p1Id, p2Id, teamsView.length);
    setPartnerPicker(null);
  };
  const autoGen = async () => {
    if (!guard() || !current) return;
    const sh = shuffle(unpaired);
    let order = teamsView.length;
    for (let i = 0; i + 1 < sh.length; i += 2) {
      await db.createTeam(current.id, sh[i].id, sh[i + 1].id, order++);
    }
  };

  const startGroupStage = async () => {
    if (!guard() || !current) return;
    await db.setRoundsPerPair(current.id, pendingRounds);
    const size = teamsView.length <= 6 ? 3 : 4;
    const sh = shuffle(teamsView);
    const nG = Math.ceil(sh.length / size);
    const gs: TeamView[][] = Array.from({ length: nG }, () => []);
    sh.forEach((t, i) => gs[i % nG].push(t));
    const rows: Omit<Match, "id">[] = [];
    let slot = 0;
    gs.forEach((g, gi) => {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        for (let r = 0; r < pendingRounds; r++) {
          rows.push({
            tournament_id: current.id, stage: "group", group_idx: gi, round_idx: null, slot_idx: slot++,
            team_a_id: g[i].id, team_b_id: g[j].id,
            score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
            status: "pending", started_at: null,
          });
        }
      }
    });
    await db.insertMatches(rows);
    await db.setPhase(current.id, "group");
    setTab("groups");
  };

  const getStandings = (g: TeamView[], gi: number) => {
    const s: Record<string, { team: TeamView; w: number; l: number; pts: number; pf: number; pa: number }> = {};
    g.forEach(t => { s[t.id] = { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 }; });
    groupMatches.filter(m => m.group_idx === gi && m.confirmed).forEach(m => {
      const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
      if (m.team_a_id && s[m.team_a_id]) { s[m.team_a_id].pf += sa; s[m.team_a_id].pa += sb; }
      if (m.team_b_id && s[m.team_b_id]) { s[m.team_b_id].pf += sb; s[m.team_b_id].pa += sa; }
      if (m.winner_id && s[m.winner_id]) {
        s[m.winner_id].w++; s[m.winner_id].pts += 3;
        const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        if (loserId && s[loserId]) s[loserId].l++;
      }
    });
    return Object.values(s).sort((a, b) => b.pts - a.pts || (b.pf - b.pa) - (a.pf - a.pa));
  };

  const allGroupsDone = groups.length > 0 && groups.every((_, gi) => {
    const ms = groupMatches.filter(m => m.group_idx === gi);
    return ms.length > 0 && ms.every(m => m.confirmed);
  });

  const startKnockout = async () => {
    if (!guard() || !current) return;
    const q: TeamView[] = [];
    groups.forEach((g, gi) => {
      const st = getStandings(g, gi);
      for (let i = 0; i < Math.min(2, st.length); i++) q.push(st[i].team);
    });
    if (q.length < 2) return;
    const rds = Math.ceil(Math.log2(q.length));
    const slots = Math.pow(2, rds);
    const seeded: (TeamView | null)[] = [...q];
    while (seeded.length < slots) seeded.push(null);
    const rows: Omit<Match, "id">[] = [];
    for (let i = 0; i < slots / 2; i++) {
      const a = seeded[i * 2], b = seeded[i * 2 + 1];
      const bye = !a || !b;
      rows.push({
        tournament_id: current.id, stage: "knockout", group_idx: null, round_idx: 0, slot_idx: i,
        team_a_id: a?.id ?? null, team_b_id: b?.id ?? null,
        score_a: null, score_b: null,
        winner_id: bye ? (a?.id ?? b?.id ?? null) : null,
        confirmed: bye, is_bye: bye,
        status: bye ? "completed" : "pending", started_at: null,
      });
    }
    let prevCount = slots / 2;
    for (let r = 1; r < rds; r++) {
      const cnt = prevCount / 2;
      for (let i = 0; i < cnt; i++) {
        rows.push({
          tournament_id: current.id, stage: "knockout", group_idx: null, round_idx: r, slot_idx: i,
          team_a_id: null, team_b_id: null, score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
          status: "pending", started_at: null,
        });
      }
      prevCount = cnt;
    }
    await db.insertMatches(rows);
    await db.setPhase(current.id, "knockout");
    setTab("knockout");
  };

  const champion = (() => {
    const last = knockout[knockout.length - 1];
    if (!last || !last[0] || !last[0].confirmed || !last[0].winner_id) return null;
    return teamById[last[0].winner_id] ?? null;
  })();

  const resetAll = async () => {
    if (!guard() || !current) return;
    if (!confirm("Wipe teams and all matches for this tournament?")) return;
    await db.deleteMatchesForTournament(current.id);
    await db.deleteTeamsForTournament(current.id);
    await db.setPhase(current.id, "none");
  };

  const startMatchHandler = async (id: string) => { if (!guard()) return; await db.startMatch(id); };
  const removeTeam = async (id: string) => { if (!guard()) return; if (!confirm("Remove this team?")) return; await db.deleteTeam(id); };

  const adjustScore = async (m: Match, side: "a" | "b", delta: number) => {
    if (!isAdmin) return;
    const cur = side === "a" ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const next = Math.max(0, cur + delta);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    await db.updateMatch(m.id, side === "a" ? { score_a: next } : { score_b: next });
  };
  const setScore = async (m: Match, side: "a" | "b", val: number) => {
    if (!isAdmin) return;
    const next = Math.max(0, isNaN(val) ? 0 : val);
    await db.updateMatch(m.id, side === "a" ? { score_a: next } : { score_b: next });
  };
  const propagateWinner = async (m: Match, winner_id: string | null) => {
    if (m.stage !== "knockout" || m.round_idx == null || !winner_id) return;
    const next = knockout[m.round_idx + 1];
    if (!next) return;
    const ni = Math.floor(m.slot_idx / 2);
    const nm = next[ni];
    if (!nm) return;
    if (m.slot_idx % 2 === 0) await db.updateMatch(nm.id, { team_a_id: winner_id });
    else await db.updateMatch(nm.id, { team_b_id: winner_id });
  };
  const confirmInline = async (m: Match) => {
    if (!guard()) return;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (sa === 0 && sb === 0) { alert("Enter a score before confirming."); return; }
    if (sa === sb) { alert("No ties allowed — set a winner."); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id, confirmed: true, status: "completed" });
    await propagateWinner(m, winner_id);
    setEditingMatchId(null);
  };
  const saveEditedMatch = async (m: Match) => {
    if (!guard()) return;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (sa === sb) { alert("No ties allowed."); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id });
    await propagateWinner(m, winner_id);
    setEditingMatchId(null);
  };

  useEffect(() => { if (current) setPendingRounds(current.rounds_per_pair || 1); }, [current?.id, current?.rounds_per_pair]);

  const btn = (bg = "#3A86FF", clr = "#fff"): React.CSSProperties => ({ background: bg, color: clr, border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all .2s", boxShadow: `0 2px 8px ${bg}33` });
  const tabBtn = (t: typeof tab, label: string, icon: string) => (
    <button key={t} onClick={() => setTab(t)} className="font-display" style={{ padding: "14px 22px", cursor: "pointer", fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", background: "transparent", color: tab === t ? "#00d4ff" : "#64748b", border: "none", borderBottom: tab === t ? "3px solid #00d4ff" : "3px solid transparent", marginBottom: -1, display: "flex", alignItems: "center", gap: 6, transition: "color .15s" }}><span style={{ fontSize: 14 }}>{icon}</span>{label}</button>
  );
  const tLabel = (t: TeamView | null) => t?.p1 && t?.p2 ? `${t.p1.name} & ${t.p2.name}` : "TBD";
  const teamFromId = (id: string | null): TeamView | null => id ? teamById[id] ?? null : null;

  const MatchCard = ({ match: m, editable = true }: { match: Match; editable?: boolean }) => {
    const ta = teamFromId(m.team_a_id);
    const tb = teamFromId(m.team_b_id);
    const isEditing = m.confirmed && editingMatchId === m.id;
    const inlineMode = isAdmin && editable && (m.status === "live" || isEditing);
    const showStaticScore = m.confirmed || (m.score_a != null || m.score_b != null);
    const winA = m.confirmed && m.winner_id === ta?.id;
    const winB = m.confirmed && m.winner_id === tb?.id;

    const teamRow = (team: typeof ta, side: "a" | "b", scoreVal: number, isWin: boolean) => {
      const stepBtn = (delta: number, label: string) => (
        <button onClick={() => adjustScore(m, side, delta)} style={{ width: 56, height: 56, borderRadius: 14, border: "2px solid #e2e8f0", background: "#fff", fontSize: 26, fontWeight: 800, color: "#1a1a2e", cursor: "pointer", touchAction: "manipulation", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }} aria-label={label}>{label}</button>
      );
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px", minWidth: 0 }}>
            {team?.p1 && <Av name={team.p1.name} photo={team.p1.photo_url} sz={34} color={team.p1.color} />}
            <span style={{ fontWeight: isWin ? 800 : 600, fontSize: 14, color: isWin ? "#16a34a" : "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tLabel(team)}</span>
          </div>
          {inlineMode ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              {stepBtn(-1, "−")}
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={scoreVal}
                onChange={e => setScore(m, side, parseInt(e.target.value, 10))}
                onFocus={e => e.target.select()}
                style={{ width: 72, height: 56, textAlign: "center", fontSize: 30, fontWeight: 900, borderRadius: 14, border: "2px solid #3A86FF", outline: "none", color: "#1a1a2e", background: "#eff6ff", padding: 0, MozAppearance: "textfield" as any }}
              />
              {stepBtn(1, "+")}
            </div>
          ) : (
            <div style={{ marginLeft: "auto", background: showStaticScore ? (isWin ? "#f0fdf4" : "#f8fafc") : "#f8fafc", border: `2px solid ${isWin ? "#86efac" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 18px", fontWeight: 900, fontSize: 22, color: isWin ? "#16a34a" : showStaticScore ? "#1a1a2e" : "#cbd5e1", minWidth: 56, textAlign: "center" }}>
              {showStaticScore ? scoreVal : "—"}
            </div>
          )}
        </div>
      );
    };

    return (
      <div style={{ background: "#fff", borderRadius: 14, border: m.status === "live" ? "2px solid #ef4444" : "1px solid #e8ecf1", overflow: "hidden", boxShadow: m.status === "live" ? "0 4px 20px rgba(239,68,68,0.25)" : "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: m.status === "live" ? "linear-gradient(90deg,#fef2f2,#fee2e2)" : m.confirmed ? "linear-gradient(90deg,#f0fdf4,#dcfce7)" : "linear-gradient(90deg,#f8fafc,#f1f5f9)", fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: "#64748b" }}>Match</span>
          {m.status === "live" && <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#dc2626", animation: "pulse 1.5s ease-in-out infinite" }} />LIVE</span>}
          {m.confirmed && !isEditing && <span style={{ color: "#16a34a" }}>✓ Confirmed</span>}
          {isEditing && <span style={{ color: "#f59e0b" }}>✏️ Editing</span>}
        </div>
        <div style={{ padding: "8px 14px 14px" }}>
          {teamRow(ta, "a", m.score_a ?? 0, winA)}
          <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
          {teamRow(tb, "b", m.score_b ?? 0, winB)}

          {editable && ta && tb && isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {m.status === "pending" && !m.confirmed && (
                <button onClick={() => startMatchHandler(m.id)} style={{ ...btn("#dc2626"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>▶ Start Match</button>
              )}
              {m.status === "live" && !m.confirmed && (
                <button onClick={() => confirmInline(m)} style={{ ...btn("#16a34a"), flex: "1 1 100%", padding: "14px", fontSize: 15, borderRadius: 10, fontWeight: 800 }}>✓ Confirm Final Score</button>
              )}
              {m.confirmed && !isEditing && (
                <button onClick={() => setEditingMatchId(m.id)} style={{ ...btn("#f59e0b"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>✏️ Edit Score</button>
              )}
              {isEditing && (
                <>
                  <button onClick={() => setEditingMatchId(null)} style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 100px", padding: "12px", fontSize: 14, borderRadius: 10, boxShadow: "none" }}>Cancel</button>
                  <button onClick={() => saveEditedMatch(m)} style={{ ...btn("#16a34a"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>💾 Save Changes</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  if (authLoading) return <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0a1628", color: "#1a1a2e", fontFamily: "'Inter','Segoe UI',system-ui,-apple-system,sans-serif" }}>
      <header style={{ background: "linear-gradient(135deg,#050d1a 0%,#0a1628 50%,#0d1f3a 100%)", color: "#fff", padding: 0, position: "relative", overflow: "hidden", borderBottom: "1px solid #1a3050" }}>
        {/* Athlete photo on the right with diagonal cutout */}
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "55%", clipPath: "polygon(20% 0, 100% 0, 100% 100%, 0 100%)", overflow: "hidden", zIndex: 0 }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B6.jpg)", backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.95 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #050d1a 0%, rgba(5,13,26,0.85) 22%, rgba(5,13,26,0.4) 50%, rgba(5,13,26,0.05) 100%)" }} />
        </div>

        {/* Cyan glow accent */}
        <div style={{ position: "absolute", top: "-30%", left: "-10%", width: 500, height: 500, background: "radial-gradient(circle, rgba(0,184,255,0.18) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, #00b8ff 20%, #00d4ff 50%, #00b8ff 80%, transparent)", zIndex: 1 }} />
        <div style={{ position: "absolute", bottom: 3, left: 0, right: 0, height: 1, background: "rgba(0,184,255,0.3)", zIndex: 1 }} />

        {/* Top bar: brand + admin chip */}
        <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: "1px solid rgba(0,184,255,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#00b8ff,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 16px rgba(0,184,255,0.4)" }}>🏸</div>
            <div>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, color: "#fff", lineHeight: 1 }}>BADMINTON<span style={{ color: "#00b8ff" }}>LIVE</span></div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>Tournament Center</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isAdmin ? (
              <>
                <span style={{ fontSize: 11, color: "#00d4ff", background: "rgba(0,184,255,0.1)", padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(0,184,255,0.3)", fontWeight: 600, letterSpacing: 0.5 }}>● {email}</span>
                <button onClick={signOut} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>SIGN OUT</button>
              </>
            ) : (
              <button onClick={() => setShowLogin(true)} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#00b8ff,#0066ff)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", boxShadow: "0 2px 12px rgba(0,184,255,0.4)" }}>Admin Sign In</button>
            )}
          </div>
        </div>

        {/* Main hero content */}
        <div className="hero-pad" style={{ position: "relative", zIndex: 2, padding: "44px 28px 36px", maxWidth: 1280, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 4, background: "rgba(0,184,255,0.12)", border: "1px solid rgba(0,184,255,0.3)", marginBottom: 18 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 8px #00d4ff" }} />
            <span className="font-display" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: "#00d4ff" }}>Doubles Tournament</span>
          </div>

          <h1 className="font-display hero-title" style={{ margin: "0 0 10px", fontSize: 64, fontWeight: 700, letterSpacing: -1, color: "#fff", lineHeight: 0.95, textTransform: "uppercase", maxWidth: "65%" }}>{current?.name ?? "Badminton Championship"}</h1>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
            {current?.event_date && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span style={{ color: "#00d4ff", fontSize: 13 }}>▸</span>
                <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", letterSpacing: 1 }}>{new Date(current.event_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toUpperCase()}</span>
              </div>
            )}
            <TournamentPicker tournaments={tournaments} current={current} onSelect={setCurrentId} isAdmin={isAdmin} onChange={reloadTournaments} />
          </div>

          {/* Quick stats — broadcast style */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: "65%" }}>
            {([[active.length, "Active Players", "#00d4ff"], [teamsView.length, "Teams", "#22c55e"], [unpaired.length, "Unpaired", "#f59e0b"]] as const).map(([v, l, c]) => (
              <div key={l} style={{ flex: "1 1 140px", background: "rgba(15,30,55,0.65)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.08)", borderLeft: `3px solid ${c}`, minWidth: 110 }}>
                <div className="font-display" style={{ fontSize: 32, fontWeight: 700, color: c, lineHeight: 1 }}>{String(v).padStart(2, "0")}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 6, background: "#0a1628", borderBottom: "1px solid #1a3050", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        {tabBtn("live", "Live", "🔴")}
        {tabBtn("register", "Players", "📋")}
        {tabBtn("profiles", "Profiles", "👤")}
        {tabBtn("teams", "Teams", "🤝")}
        {phase !== "none" && tabBtn("groups", "Groups", "📊")}
        {phase === "knockout" && tabBtn("knockout", "Knockout", "⚔️")}
        {tabBtn("scoreboard", "Scoreboard", "🏅")}
      </nav>

      <main style={{ maxWidth: 1280, margin: "24px auto", padding: "0 20px" }}>
        {!current && (
          <div style={{ position: "relative", textAlign: "center", padding: 80, color: "#64748b", background: "#0a1628", borderRadius: 14, border: "1px solid #1a3050", overflow: "hidden", minHeight: 280 }}>
            <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,22,40,0.7) 0%, rgba(10,22,40,0.95) 100%)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <ShuttleSVG sz={80} color="#00b8ff" opacity={0.5} style={{ margin: "0 auto 14px", display: "block" }} />
              <p className="font-display" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: "#fff", margin: 0 }}>{isAdmin ? "Click + New above to create your first tournament." : "No tournaments yet."}</p>
            </div>
          </div>
        )}

        {current && tab === "live" && <LiveTab teamsView={teamsView} matches={matches} groupMatches={groupMatches} knockoutMatches={knockoutMatches} phase={phase} groups={groups} getStandings={getStandings} />}

        {current && tab === "register" && (
          <div>
            {isAdmin && (
              <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} placeholder="Enter new player name..." style={{ flex: 1, minWidth: 220, padding: "12px 16px", borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", fontSize: 15, outline: "none" }} />
                <button onClick={addPlayer} style={{ ...btn(), padding: "12px 24px", fontSize: 15 }}>+ Add Player</button>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, border: "1px solid #e8ecf1", opacity: p.active ? 1 : 0.4, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: p.color, borderRadius: "0 4px 4px 0" }} />
                  <div style={{ position: "relative", cursor: isAdmin ? "pointer" : "default", marginLeft: 4 }} onClick={() => isAdmin && fileRefs.current[p.id]?.click()}>
                    <Av name={p.name} photo={p.photo_url} sz={64} color={p.color} />
                    {isAdmin && <div style={{ position: "absolute", bottom: -1, right: -1, background: "#3A86FF", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, border: "2px solid #fff", color: "#fff" }}>📷</div>}
                    <input ref={el => { fileRefs.current[p.id] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    {editingId === p.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 15, outline: "none" }} />
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 16, cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && startEdit(p)}>
                        <span style={{ color: "#94a3b8", marginRight: 6, fontSize: 12, fontWeight: 500 }}>#{i + 1}</span>{p.name}
                      </div>
                    )}
                    {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 3 }}>⚠️ {p.note}</div>}
                    {paired.has(p.id) && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 3, fontWeight: 600 }}>✓ Team assigned</div>}
                  </div>
                  {isAdmin && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      <button onClick={() => toggleActive(p.id)} style={{ ...btn(p.active ? "#e2e8f0" : "#2A9D8F", p.active ? "#475569" : "#fff"), padding: "6px 12px", fontSize: 12, borderRadius: 8, boxShadow: "none" }}>{p.active ? "Sit Out" : "Activate"}</button>
                      {p.active && !paired.has(p.id) && unpaired.length >= 2 && (
                        <button onClick={() => openPartnerPicker(p.id)} style={{ ...btn("#3A86FF"), padding: "6px 12px", fontSize: 12, borderRadius: 8 }}>Choose Partner</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && unpaired.length >= 2 && <div style={{ textAlign: "center", marginTop: 28 }}><button onClick={autoGen} style={{ ...btn("#2A9D8F"), padding: "14px 36px", fontSize: 16, borderRadius: 14 }}>🎲 Auto-Pair All Players</button></div>}
            {unpaired.length === 1 && <div style={{ textAlign: "center", marginTop: 16, padding: 14, background: "#fef3c7", borderRadius: 12, border: "1px solid #fde68a", color: "#92400e", fontSize: 14 }}>⚠️ Odd player out: <strong>{unpaired[0].name}</strong></div>}
          </div>
        )}

        {current && tab === "profiles" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>👤</span>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Player Profiles</h2>
              <span style={{ marginLeft: "auto", fontSize: 13, color: "#94a3b8" }}>{isAdmin ? "Click photo to upload, click name to edit" : "View only"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 18, overflow: "hidden", border: "1px solid #e8ecf1", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", opacity: p.active ? 1 : 0.55, position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: p.color }} />
                  <div style={{ padding: "26px 16px 18px", textAlign: "center" }}>
                    <div style={{ position: "relative", display: "inline-block", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && fileRefs.current[`prof-${p.id}`]?.click()}>
                      <Av name={p.name} photo={p.photo_url} sz={120} color={p.color} />
                      {isAdmin && <div style={{ position: "absolute", bottom: 4, right: 4, background: "#3A86FF", color: "#fff", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, border: "3px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>📷</div>}
                      <input ref={el => { fileRefs.current[`prof-${p.id}`] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
                    </div>
                    {editingId === p.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "85%", marginTop: 14, padding: "8px 12px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 17, outline: "none", textAlign: "center", fontWeight: 700 }} />
                    ) : (
                      <div onClick={() => isAdmin && startEdit(p)} style={{ marginTop: 14, fontSize: 18, fontWeight: 800, cursor: isAdmin ? "pointer" : "default", color: "#1a1a2e" }}>
                        <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, marginRight: 6 }}>#{i + 1}</span>{p.name}
                      </div>
                    )}
                    {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 6, padding: "3px 10px", background: "#fef2f2", borderRadius: 12, display: "inline-block" }}>⚠️ {p.note}</div>}
                    <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{p.active ? (paired.has(p.id) ? "✓ On a team" : "Available") : "Inactive"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {current && tab === "teams" && (
          <div>
            {teamsView.length === 0 ? (
              <div style={{ textAlign: "center", padding: 50, color: "#94a3b8" }}><p>No teams yet.</p></div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
                  {teamsView.map((t, i) => (
                    <div key={t.id} style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e8ecf1", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg,${t.p1.color},${t.p2.color})` }} />
                      {isAdmin && phase === "none" && (
                        <button onClick={() => removeTeam(t.id)} title="Remove team" style={{ position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: "50%", border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                      )}
                      <div style={{ fontWeight: 800, fontSize: 12, color: "#3A86FF", marginBottom: 14, textTransform: "uppercase", letterSpacing: 2 }}>Team {i + 1}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                        <Av name={t.p1.name} photo={t.p1.photo_url} sz={40} color={t.p1.color} />
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p1.name}</span>
                      </div>
                      <div style={{ textAlign: "center", color: "#3A86FF", fontWeight: 900, fontSize: 14, margin: "4px 0", letterSpacing: 2 }}>&amp;</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                        <Av name={t.p2.name} photo={t.p2.photo_url} sz={40} color={t.p2.color} />
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p2.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {isAdmin && teamsView.length >= 2 && phase === "none" && (
                  <div style={{ textAlign: "center", marginTop: 32, padding: 28, background: "linear-gradient(135deg,#1a1a2e,#2d3a5c)", borderRadius: 18, color: "#fff" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: "#93c5fd", textTransform: "uppercase", marginBottom: 6 }}>Configure Group Stage</div>
                    <div style={{ fontSize: 14, color: "#cbd5e1", marginBottom: 18 }}>How many times should each pair play?</div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
                      {[1, 2, 3].map(n => (
                        <button key={n} onClick={() => setPendingRounds(n)} style={{ padding: "16px 24px", minWidth: 100, borderRadius: 14, border: pendingRounds === n ? "2px solid #84cc16" : "2px solid rgba(255,255,255,0.1)", background: pendingRounds === n ? "linear-gradient(135deg,#84cc16,#65a30d)" : "rgba(255,255,255,0.04)", color: "#fff", cursor: "pointer", textAlign: "center" }}>
                          <div style={{ fontSize: 28, fontWeight: 900 }}>{n}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: pendingRounds === n ? "rgba(255,255,255,0.9)" : "#94a3b8" }}>{n === 1 ? "Match" : "Matches"}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#cbd5e1", marginBottom: 18 }}>
                      {pendingRounds === 1 && "⚡ Quick — single match per pair"}
                      {pendingRounds === 2 && "✅ Recommended — best balance of competition"}
                      {pendingRounds === 3 && "🏆 Full — most competitive, longest tournament"}
                    </div>
                    <button onClick={startGroupStage} style={{ ...btn("#84cc16"), padding: "16px 44px", fontSize: 17, borderRadius: 14, fontWeight: 800 }}>📊 Start Group Stage</button>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>Top 2 per group advance to knockouts</div>
                  </div>
                )}
              </>
            )}
            {isAdmin && <div style={{ textAlign: "center", marginTop: 20 }}><button onClick={resetAll} style={{ ...btn("#E63946"), padding: "10px 22px", fontSize: 13, borderRadius: 10 }}>🔄 Reset This Tournament</button></div>}
          </div>
        )}

        {current && tab === "groups" && (
          <div>
            {groups.map((g, gi) => {
              const st = getStandings(g, gi);
              const ms = groupMatches.filter(m => m.group_idx === gi);
              return (
                <div key={gi} style={{ marginBottom: 32, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", border: "1px solid #e8ecf1" }}>
                  <div style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)", padding: "14px 20px" }}>
                    <span style={{ background: "#3A86FF", color: "#fff", borderRadius: 8, padding: "4px 14px", fontSize: 14, fontWeight: 800 }}>Group {String.fromCharCode(65 + gi)}</span>
                    <span style={{ color: "#94a3b8", fontSize: 13, marginLeft: 10 }}>{g.length} teams • {ms.filter(m => m.confirmed).length}/{ms.length} matches</span>
                  </div>
                  <div style={{ padding: 20 }}>
                    <div style={{ overflowX: "auto", marginBottom: 16 }}>
                      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px" }}>
                        <thead><tr>{["#", "Team", "W", "L", "PF", "PA", "+/-", "Pts"].map(h => <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>)}</tr></thead>
                        <tbody>{st.map((s, si) => (
                          <tr key={s.team.id} style={{ background: si < 2 ? "#f0fdf4" : "#f8fafc" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 800, color: si < 2 ? "#16a34a" : "#94a3b8" }}>{si + 1}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.team.p1.name} & {s.team.p2.name}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: "#16a34a" }}>{s.w}</td>
                            <td style={{ padding: "10px 12px", color: "#E63946" }}>{s.l}</td>
                            <td style={{ padding: "10px 12px" }}>{s.pf}</td>
                            <td style={{ padding: "10px 12px" }}>{s.pa}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: s.pf - s.pa > 0 ? "#16a34a" : s.pf - s.pa < 0 ? "#E63946" : "#94a3b8" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 900, fontSize: 18, color: "#3A86FF" }}>{s.pts}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                      {ms.map(m => <MatchCard key={m.id} match={m} />)}
                    </div>
                  </div>
                </div>
              );
            })}
            {isAdmin && allGroupsDone && phase === "group" && (
              <div style={{ textAlign: "center", marginTop: 24, padding: 28, background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", borderRadius: 16, border: "2px solid #86efac" }}>
                <button onClick={startKnockout} style={{ ...btn("#E63946"), padding: "16px 44px", fontSize: 18, borderRadius: 14 }}>⚔️ Start Knockout Stage</button>
              </div>
            )}
          </div>
        )}

        {current && tab === "knockout" && (
          <div>
            {champion && (
              <div style={{ textAlign: "center", padding: 32, background: "linear-gradient(135deg,#fef3c7,#fde68a,#fef3c7)", borderRadius: 20, border: "3px solid #f59e0b", marginBottom: 28 }}>
                <div style={{ fontSize: 56, marginBottom: 8 }}>🏆</div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#b45309", textTransform: "uppercase", letterSpacing: 3 }}>Champions</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: "#78350f", marginTop: 10 }}>{champion.p1.name} & {champion.p2.name}</div>
              </div>
            )}
            <div style={{ overflowX: "auto", paddingBottom: 20 }}>
              <div style={{ display: "flex", gap: 0, minWidth: knockout.length * 290 }}>
                {knockout.map((round, ri) => (
                  <div key={ri} style={{ flex: 1, minWidth: 270, display: "flex", flexDirection: "column" }}>
                    <div style={{ textAlign: "center", fontWeight: 800, color: "#1a1a2e", fontSize: 13, textTransform: "uppercase", letterSpacing: 1, padding: "10px 12px", background: "linear-gradient(90deg,#e0e7ff,#ede9fe,#e0e7ff)", borderRadius: 10, margin: "0 8px 16px" }}>
                      {rName(knockout.length, ri)}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, padding: "0 8px" }}>
                      {round.map(m => <MatchCard key={m.id} match={m} editable={!m.is_bye} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {current && tab === "scoreboard" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>🏅</span>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Scoreboard</h2>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.05)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)" }}>
                  {["Rank", "Team", "W", "L", "PF", "PA", "+/-", "Status"].map(h => <th key={h} style={{ padding: "14px 16px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const all: Record<string, { team: TeamView; gw: number; gl: number; pf: number; pa: number; status: string }> = {};
                    teamsView.forEach(t => { all[t.id] = { team: t, gw: 0, gl: 0, pf: 0, pa: 0, status: "Registered" }; });
                    groupMatches.filter(m => m.confirmed).forEach(m => {
                      const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
                      if (m.team_a_id && all[m.team_a_id]) { all[m.team_a_id].pf += sa; all[m.team_a_id].pa += sb; }
                      if (m.team_b_id && all[m.team_b_id]) { all[m.team_b_id].pf += sb; all[m.team_b_id].pa += sa; }
                      if (m.winner_id && all[m.winner_id]) all[m.winner_id].gw++;
                      const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
                      if (loserId && all[loserId]) all[loserId].gl++;
                    });
                    const koT = new Set<string>(), koL = new Set<string>();
                    knockoutMatches.forEach(m => { if (m.team_a_id) koT.add(m.team_a_id); if (m.team_b_id) koT.add(m.team_b_id); });
                    knockoutMatches.filter(m => m.confirmed && !m.is_bye).forEach(m => {
                      const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
                      if (loserId) koL.add(loserId);
                    });
                    Object.values(all).forEach(s => {
                      if (champion && champion.id === s.team.id) s.status = "🏆 Champion";
                      else if (koL.has(s.team.id)) s.status = "❌ Eliminated (KO)";
                      else if (koT.has(s.team.id)) s.status = "⚔️ In Knockout";
                      else if (phase === "knockout") s.status = "❌ Eliminated (Group)";
                      else if (phase === "group") s.status = "📊 Group Stage";
                      else s.status = "📝 Registered";
                    });
                    return Object.values(all).sort((a, b) => {
                      if (champion) { if (a.team.id === champion.id) return -1; if (b.team.id === champion.id) return 1; }
                      return (b.gw * 3) - (a.gw * 3) || (b.pf - b.pa) - (a.pf - a.pa);
                    }).map((s, i) => (
                      <tr key={s.team.id} style={{ borderBottom: "1px solid #f1f5f9", background: champion && champion.id === s.team.id ? "#fefce8" : i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 900, color: i === 0 && champion ? "#f59e0b" : "#3A86FF" }}>{i + 1}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 600 }}>{s.team.p1.name} & {s.team.p2.name}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#16a34a" }}>{s.gw}</td>
                        <td style={{ padding: "12px 16px", color: "#E63946" }}>{s.gl}</td>
                        <td style={{ padding: "12px 16px" }}>{s.pf}</td>
                        <td style={{ padding: "12px 16px" }}>{s.pa}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: s.pf - s.pa > 0 ? "#16a34a" : s.pf - s.pa < 0 ? "#E63946" : "#94a3b8" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>{s.status}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {showLogin && <Login onClose={() => setShowLogin(false)} />}

      {partnerPicker && (() => {
        const me = playerById[partnerPicker];
        const choices = unpaired.filter(p => p.id !== partnerPicker);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1500, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setPartnerPicker(null)}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, textAlign: "center" }}>🤝 Choose Partner</h3>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b", textAlign: "center" }}>Pair {me?.name} with...</p>
              {choices.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No available players to pair with.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                  {choices.map(p => (
                    <button key={p.id} onClick={() => assignPartner(partnerPicker, p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", cursor: "pointer", textAlign: "left", transition: "all .15s" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#3A86FF"; e.currentTarget.style.background = "#eff6ff"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                      <Av name={p.name} photo={p.photo_url} sz={36} color={p.color} />
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setPartnerPicker(null)} style={{ width: "100%", marginTop: 18, padding: 12, background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes pulse-strong {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 12px rgba(0,184,255,0.4); }
          50% { box-shadow: 0 0 24px rgba(0,184,255,0.8); }
        }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        @media (max-width: 700px) {
          .hero-title { font-size: 36px !important; max-width: 100% !important; }
          .hero-pad { padding: 28px 18px 24px !important; }
        }
      `}</style>

      <footer style={{ textAlign: "center", padding: "32px 16px", color: "#475569", fontSize: 11, background: "#050d1a", borderTop: "1px solid #1a3050", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>
        <span style={{ color: "#00b8ff" }}>●</span> BADMINTON LIVE · MAY THE BEST TEAM WIN
      </footer>
    </div>
  );
}

// =================================================================
// Live tab — guest-friendly view of currently playing matches, upcoming, and stats
// =================================================================
function LiveTab({ teamsView, matches, groupMatches, phase, groups, getStandings }: {
  teamsView: (Team & { p1: Player; p2: Player })[];
  matches: Match[];
  groupMatches: Match[];
  knockoutMatches: Match[];
  phase: "none" | "group" | "knockout";
  groups: (Team & { p1: Player; p2: Player })[][];
  getStandings: (g: (Team & { p1: Player; p2: Player })[], gi: number) => { team: Team & { p1: Player; p2: Player }; w: number; l: number; pts: number; pf: number; pa: number }[];
}) {
  const teamById = Object.fromEntries(teamsView.map(t => [t.id, t]));
  const tName = (id: string | null) => id ? `${teamById[id]?.p1.name ?? "?"} & ${teamById[id]?.p2.name ?? "?"}` : "TBD";

  const live = matches.filter(m => m.status === "live");
  const upcoming = matches.filter(m => m.status === "pending" && !m.confirmed && m.team_a_id && m.team_b_id).slice(0, 5);
  const recent = [...matches.filter(m => m.confirmed && !m.is_bye)].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).slice(0, 5);

  // Stats: top team by points, biggest +/-
  const stats: Record<string, { team: Team & { p1: Player; p2: Player }; w: number; pts: number; pf: number; pa: number }> = {};
  teamsView.forEach(t => { stats[t.id] = { team: t, w: 0, pts: 0, pf: 0, pa: 0 }; });
  groupMatches.filter(m => m.confirmed).forEach(m => {
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (m.team_a_id && stats[m.team_a_id]) { stats[m.team_a_id].pf += sa; stats[m.team_a_id].pa += sb; }
    if (m.team_b_id && stats[m.team_b_id]) { stats[m.team_b_id].pf += sb; stats[m.team_b_id].pa += sa; }
    if (m.winner_id && stats[m.winner_id]) { stats[m.winner_id].w++; stats[m.winner_id].pts += 3; }
  });
  const ranked = Object.values(stats).sort((a, b) => b.pts - a.pts || (b.pf - b.pa) - (a.pf - a.pa));
  const topTeam = ranked[0];
  const bestDiff = [...ranked].sort((a, b) => (b.pf - b.pa) - (a.pf - a.pa))[0];

  const matchesPlayed = matches.filter(m => m.confirmed).length;
  const totalMatches = matches.filter(m => m.team_a_id && m.team_b_id && !m.is_bye).length;

  if (teamsView.length === 0) {
    return (
      <div style={{ position: "relative", background: "#0a1628", borderRadius: 14, padding: 80, color: "#64748b", textAlign: "center", border: "1px solid #1a3050", overflow: "hidden", minHeight: 280 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.35 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,22,40,0.6) 0%, rgba(10,22,40,0.95) 100%)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 64, marginBottom: 12, opacity: 0.6 }}>🏸</div>
          <p className="font-display" style={{ fontSize: 18, fontWeight: 600, color: "#fff", letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>Tournament hasn't started</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Check back soon for live action.</p>
        </div>
      </div>
    );
  }

  // Section header — angular cyan slash bar like SkyBet
  const SectionHeader = ({ accent, children, badge }: { accent: string; children: React.ReactNode; badge?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 4, height: 22, background: accent, borderRadius: 1 }} />
      <h3 className="font-display" style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>{children}</h3>
      {badge}
    </div>
  );

  const StatTile = ({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color: string }) => (
    <div style={{ flex: "1 1 200px", background: "#0f1e36", borderRadius: 8, padding: "16px 18px", border: "1px solid #1a3050", borderLeft: `3px solid ${color}`, position: "relative", overflow: "hidden" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 26, fontWeight: 700, color: "#fff", lineHeight: 1.1, letterSpacing: 0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontWeight: 500 }}>{sub}</div>}
    </div>
  );

  const stageBadge = (m: Match) => m.stage === "group" ? `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : m.stage === "knockout" ? `ROUND ${(m.round_idx ?? 0) + 1}` : "";

  return (
    <div style={{ background: "#0a1628", borderRadius: 14, padding: 24, border: "1px solid #1a3050", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>

      {/* Featured tournament spotlight panel — full-width hero card with athlete photo */}
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 28, minHeight: 180, background: "linear-gradient(135deg,#0d1f3a 0%,#0a1628 100%)", border: "1px solid #1a3050" }}>
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "60%", clipPath: "polygon(25% 0, 100% 0, 100% 100%, 0 100%)", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B2.jpg)", backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.95 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #0a1628 0%, rgba(10,22,40,0.7) 30%, rgba(10,22,40,0.1) 100%)" }} />
        </div>
        <div style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, background: "radial-gradient(circle, rgba(0,184,255,0.25) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "26px 28px", maxWidth: "55%" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 4, background: "rgba(0,184,255,0.15)", border: "1px solid rgba(0,184,255,0.35)", marginBottom: 12 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 6px #00d4ff" }} />
            <span className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#00d4ff" }}>{phase === "knockout" ? "KNOCKOUT STAGE" : phase === "group" ? "GROUP STAGE" : "TOURNAMENT"}</span>
          </div>
          <h2 className="font-display" style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 700, letterSpacing: 0.5, color: "#fff", textTransform: "uppercase", lineHeight: 1.05 }}>
            {live.length > 0 ? <><span style={{ color: "#ef4444" }}>● LIVE</span> NOW</> : phase === "none" ? "Get Ready" : "Tournament Action"}
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "#94a3b8", fontWeight: 500, maxWidth: 420 }}>
            {live.length > 0
              ? `${live.length} match${live.length > 1 ? "es" : ""} in progress · scores update in real time`
              : phase === "none"
                ? "Teams forming · matches will start soon"
                : `${matchesPlayed} of ${totalMatches} matches completed${topTeam && topTeam.pts > 0 ? ` · ${topTeam.team.p1.name} & ${topTeam.team.p2.name} leading` : ""}`}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Teams</span>
              <span className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "#00d4ff" }}>{teamsView.length}</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Played</span>
              <span className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>{matchesPlayed}/{totalMatches}</span>
            </div>
          </div>
        </div>
      </div>

      {/* LIVE NOW */}
      {live.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionHeader accent="#ef4444" badge={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", padding: "4px 10px", borderRadius: 4 }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse-strong 1.4s ease-in-out infinite", boxShadow: "0 0 6px #ef4444" }} /><span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: 2 }}>LIVE</span><span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{live.length}</span></span>}>Now Playing</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14 }}>
            {live.map(m => {
              const ta = m.team_a_id ? teamById[m.team_a_id] : null;
              const tb = m.team_b_id ? teamById[m.team_b_id] : null;
              const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
              const aLeading = sa > sb, bLeading = sb > sa;
              return (
                <div key={m.id} style={{ background: "linear-gradient(135deg,#0f1e36 0%,#11243f 100%)", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#ef4444,#f97316)" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid #1a3050" }}>
                    <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff", letterSpacing: 2 }}>{stageBadge(m)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: 2 }}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse-strong 1.4s ease-in-out infinite" }} />LIVE
                    </span>
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                      {ta?.p1 && <Av name={ta.p1.name} photo={ta.p1.photo_url} sz={38} color={ta.p1.color} />}
                      <span style={{ fontWeight: aLeading ? 800 : 600, fontSize: 14, flex: 1, color: aLeading ? "#fff" : "#cbd5e1" }}>{tName(m.team_a_id)}</span>
                      <div className="font-display" style={{ minWidth: 70, padding: "8px 16px", background: aLeading ? "linear-gradient(135deg,#00b8ff,#0066ff)" : "rgba(255,255,255,0.04)", color: aLeading ? "#fff" : "#94a3b8", borderRadius: 6, fontSize: 32, fontWeight: 700, textAlign: "center", border: aLeading ? "1px solid #00d4ff" : "1px solid #1a3050", boxShadow: aLeading ? "0 4px 16px rgba(0,184,255,0.4)" : "none", letterSpacing: 1, transition: "all .2s", lineHeight: 1 }}>{sa}</div>
                    </div>
                    <div style={{ height: 1, background: "linear-gradient(90deg,transparent,#1a3050,transparent)", margin: "2px 0" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                      {tb?.p1 && <Av name={tb.p1.name} photo={tb.p1.photo_url} sz={38} color={tb.p1.color} />}
                      <span style={{ fontWeight: bLeading ? 800 : 600, fontSize: 14, flex: 1, color: bLeading ? "#fff" : "#cbd5e1" }}>{tName(m.team_b_id)}</span>
                      <div className="font-display" style={{ minWidth: 70, padding: "8px 16px", background: bLeading ? "linear-gradient(135deg,#00b8ff,#0066ff)" : "rgba(255,255,255,0.04)", color: bLeading ? "#fff" : "#94a3b8", borderRadius: 6, fontSize: 32, fontWeight: 700, textAlign: "center", border: bLeading ? "1px solid #00d4ff" : "1px solid #1a3050", boxShadow: bLeading ? "0 4px 16px rgba(0,184,255,0.4)" : "none", letterSpacing: 1, transition: "all .2s", lineHeight: 1 }}>{sb}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tournament stats */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader accent="#00b8ff">Tournament Stats</SectionHeader>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <StatTile label="Stage" value={phase === "none" ? "Not Started" : phase === "group" ? "Group Stage" : "Knockout"} color="#00b8ff" />
          <StatTile
            label="Matches Played"
            value={
              <div>
                <span style={{ color: "#00d4ff" }}>{String(matchesPlayed).padStart(2, "0")}</span>
                <span style={{ color: "#475569", margin: "0 6px" }}>/</span>
                <span style={{ color: "#cbd5e1" }}>{String(totalMatches).padStart(2, "0")}</span>
              </div>
            }
            color="#22c55e"
            sub={totalMatches > 0 ? (
              <span>
                {Math.round(matchesPlayed / totalMatches * 100)}% complete
              </span>
            ) as any : undefined}
          />
          {topTeam && topTeam.pts > 0 && <StatTile label="Top Team" value={`${topTeam.team.p1.name} & ${topTeam.team.p2.name}`} sub={`${topTeam.pts} PTS · ${topTeam.w} W`} color="#f59e0b" />}
          {bestDiff && (bestDiff.pf - bestDiff.pa) !== 0 && <StatTile label="Best Diff" value={<><span style={{ color: bestDiff.pf - bestDiff.pa > 0 ? "#22c55e" : "#ef4444" }}>{bestDiff.pf - bestDiff.pa > 0 ? "+" : ""}{bestDiff.pf - bestDiff.pa}</span></>} sub={`${bestDiff.team.p1.name} & ${bestDiff.team.p2.name}`} color="#a855f7" />}
        </div>
        {totalMatches > 0 && (
          <div style={{ marginTop: 14, height: 4, background: "#0f1e36", borderRadius: 2, overflow: "hidden", border: "1px solid #1a3050" }}>
            <div style={{ height: "100%", width: `${Math.round(matchesPlayed / totalMatches * 100)}%`, background: "linear-gradient(90deg,#00b8ff,#00d4ff)", boxShadow: "0 0 12px rgba(0,212,255,0.6)", transition: "width .4s" }} />
          </div>
        )}
      </div>

      {/* Upcoming + Recent — two-column layout on wide screens */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 20, marginBottom: 32 }}>
        {upcoming.length > 0 && (
          <div>
            <SectionHeader accent="#00d4ff">Upcoming</SectionHeader>
            <div style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden" }}>
              {upcoming.map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < upcoming.length - 1 ? "1px solid #1a3050" : "none", gap: 12, position: "relative", background: i === 0 ? "rgba(0,212,255,0.04)" : "transparent" }}>
                  {i === 0 && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: "#00d4ff" }} />}
                  <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? "#00d4ff" : "#64748b", letterSpacing: 1.5, minWidth: 70 }}>{i === 0 ? "▸ NEXT" : stageBadge(m)}</div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "#cbd5e1" }}>{tName(m.team_a_id)}</div>
                  <div className="font-display" style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: 2 }}>VS</div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 13, textAlign: "right", color: "#cbd5e1" }}>{tName(m.team_b_id)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <SectionHeader accent="#22c55e">Recent Results</SectionHeader>
            <div style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden" }}>
              {recent.map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < recent.length - 1 ? "1px solid #1a3050" : "none", gap: 12 }}>
                  <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, minWidth: 70 }}>{stageBadge(m)}</div>
                  <div style={{ flex: 1, fontWeight: m.winner_id === m.team_a_id ? 700 : 500, color: m.winner_id === m.team_a_id ? "#22c55e" : "#94a3b8", fontSize: 13 }}>{tName(m.team_a_id)}</div>
                  <div className="font-display" style={{ fontWeight: 700, fontSize: 14, padding: "4px 10px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 4, color: "#22c55e", letterSpacing: 1 }}>{m.score_a}–{m.score_b}</div>
                  <div style={{ flex: 1, fontWeight: m.winner_id === m.team_b_id ? 700 : 500, color: m.winner_id === m.team_b_id ? "#22c55e" : "#94a3b8", textAlign: "right", fontSize: 13 }}>{tName(m.team_b_id)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Group standings */}
      {phase !== "none" && groups.length > 0 && (
        <div>
          <SectionHeader accent="#a855f7">Standings</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
            {groups.map((g, gi) => {
              const st = getStandings(g, gi);
              const groupBgs = ["/images/B5.jpg", "/images/B4.jpg", "/images/B1.jpg", "/images/B6.jpg"];
              const groupAccents = ["#00d4ff", "#22c55e", "#f59e0b", "#a855f7"];
              const accent = groupAccents[gi % groupAccents.length];
              return (
                <div key={gi} style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "relative", padding: "16px 16px 14px", borderBottom: "1px solid #1a3050", overflow: "hidden", minHeight: 76 }}>
                    <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${groupBgs[gi % groupBgs.length]})`, backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.55 }} />
                    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(15,30,55,0.95) 0%, rgba(15,30,55,0.6) 60%, rgba(15,30,55,0.3) 100%)` }} />
                    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: accent }} />
                    <div style={{ position: "relative", zIndex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>Group {String.fromCharCode(65 + gi)}</span>
                        <span className="font-display" style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: 1.5, padding: "3px 8px", background: "rgba(0,0,0,0.4)", borderRadius: 3, border: `1px solid ${accent}66` }}>TOP 2 ADVANCE</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4, fontWeight: 500, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{g.length} TEAMS · {st.reduce((acc, s) => acc + s.w + s.l, 0)} matches played</div>
                    </div>
                  </div>
                  <div>
                    {st.map((s, si) => (
                      <div key={s.team.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderTop: si === 0 ? "none" : "1px solid #1a3050", background: si < 2 ? "rgba(34,197,94,0.04)" : "transparent", position: "relative" }}>
                        {si < 2 && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 2, background: "#22c55e" }} />}
                        <div className="font-display" style={{ width: 24, fontSize: 14, fontWeight: 700, color: si === 0 ? "#fbbf24" : si === 1 ? "#22c55e" : "#475569" }}>{si + 1}</div>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{s.team.p1.name} & {s.team.p2.name}</div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{s.w}-{s.l}</span>
                          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: s.pf - s.pa > 0 ? "#22c55e" : s.pf - s.pa < 0 ? "#ef4444" : "#64748b", minWidth: 30, textAlign: "right" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</span>
                          <span className="font-display" style={{ fontSize: 18, fontWeight: 700, color: si < 2 ? "#00d4ff" : "#cbd5e1", minWidth: 24, textAlign: "right", letterSpacing: 0.5 }}>{s.pts}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {live.length === 0 && upcoming.length === 0 && recent.length === 0 && (
        <div style={{ position: "relative", textAlign: "center", padding: 60, color: "#64748b", background: "#0f1e36", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden", minHeight: 220 }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,30,55,0.6) 0%, rgba(15,30,55,0.95) 100%)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 48, marginBottom: 10, opacity: 0.5 }}>🏸</div>
            <p className="font-display" style={{ margin: 0, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#fff" }}>No matches scheduled</p>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>The tournament will begin shortly.</p>
          </div>
        </div>
      )}
    </div>
  );
}
