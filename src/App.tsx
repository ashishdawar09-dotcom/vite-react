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
    <button key={t} onClick={() => setTab(t)} style={{ padding: "12px 20px", cursor: "pointer", fontWeight: tab === t ? 700 : 500, fontSize: 14, background: tab === t ? "#fff" : "transparent", color: tab === t ? "#1a1a2e" : "#94a3b8", borderRadius: "12px 12px 0 0", border: "none", borderBottom: tab === t ? "3px solid #3A86FF" : "3px solid transparent", marginBottom: -1, display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 16 }}>{icon}</span>{label}</button>
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
    <div style={{ minHeight: "100vh", background: "#f0f2f5", color: "#1a1a2e", fontFamily: "'Segoe UI',system-ui,-apple-system,sans-serif" }}>
      <header style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e293b 40%,#1a1a2e 100%)", color: "#fff", padding: 0, position: "relative", overflow: "hidden" }}>
        {/* Hero banner image */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=1600&q=80)", backgroundSize: "cover", backgroundPosition: "center 40%", opacity: 0.25, filter: "blur(1px)" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,23,42,0.7) 0%, rgba(26,26,46,0.95) 100%)" }} />
        <div style={{ position: "absolute", top: 10, left: "5%" }}><ShuttleSVG sz={60} opacity={0.06} /></div>
        <div style={{ position: "absolute", top: 40, right: "10%", transform: "rotate(45deg)" }}><ShuttleSVG sz={80} opacity={0.05} /></div>
        <div style={{ position: "absolute", bottom: 10, left: "20%", transform: "rotate(-30deg)" }}><ShuttleSVG sz={50} opacity={0.07} /></div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: "linear-gradient(90deg,#3A86FF,#2A9D8F,#E63946,#F4A261,#3A86FF)" }} />

        <div style={{ position: "absolute", top: 14, right: 16, zIndex: 2, display: "flex", gap: 8, alignItems: "center" }}>
          {isAdmin ? (
            <>
              <span style={{ fontSize: 12, color: "#86efac", background: "rgba(34,197,94,0.15)", padding: "5px 12px", borderRadius: 20, border: "1px solid rgba(34,197,94,0.3)" }}>✓ {email}</span>
              <button onClick={signOut} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>Sign out</button>
            </>
          ) : (
            <button onClick={() => setShowLogin(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(58,134,255,0.4)", background: "rgba(58,134,255,0.2)", color: "#93c5fd", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>🔐 Admin Sign In</button>
          )}
        </div>

        <div style={{ position: "relative", zIndex: 1, padding: "36px 20px 28px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "rgba(58,134,255,0.15)", borderRadius: 50, padding: "6px 20px", marginBottom: 16, border: "1px solid rgba(58,134,255,0.2)" }}>
            <span style={{ fontSize: 22 }}>🏸</span>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#93c5fd" }}>Doubles Tournament</span>
            <span style={{ fontSize: 22 }}>🏸</span>
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 34, fontWeight: 900, letterSpacing: -1, background: "linear-gradient(90deg,#fff,#93c5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{current?.name ?? "Badminton Championship"}</h1>
          <p style={{ margin: "0 0 16px", fontSize: 17, color: "#94a3b8", fontWeight: 500 }}>{current?.event_date ? `📅 ${current.event_date}` : "—"}</p>
          <TournamentPicker tournaments={tournaments} current={current} onSelect={setCurrentId} isAdmin={isAdmin} onChange={reloadTournaments} />
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
            {([[active.length, "Active Players", "#3A86FF", "rgba(58,134,255,0.12)"], [teamsView.length, "Teams", "#2A9D8F", "rgba(42,157,143,0.12)"], [unpaired.length, "Unpaired", "#E63946", "rgba(230,57,70,0.12)"]] as const).map(([v, l, c, bg]) => (
              <div key={l} style={{ background: bg, borderRadius: 14, padding: "12px 24px", textAlign: "center", border: `1px solid ${c}22`, minWidth: 110 }}>
                <div style={{ fontSize: 30, fontWeight: 900, color: c }}>{v}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 14, background: "#f0f2f5", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 100 }}>
        {tabBtn("live", "Live", "🔴")}
        {tabBtn("register", "Players", "📋")}
        {tabBtn("profiles", "Profiles", "👤")}
        {tabBtn("teams", "Teams", "🤝")}
        {phase !== "none" && tabBtn("groups", "Groups", "📊")}
        {phase === "knockout" && tabBtn("knockout", "Knockout", "⚔️")}
        {tabBtn("scoreboard", "Scoreboard", "🏅")}
      </nav>

      <main style={{ maxWidth: 960, margin: "24px auto", padding: "0 16px" }}>
        {!current && (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
            <ShuttleSVG sz={80} color="#94a3b8" opacity={0.3} style={{ margin: "0 auto 12px", display: "block" }} />
            <p style={{ fontSize: 16 }}>{isAdmin ? "Click + New above to create your first tournament." : "No tournaments yet."}</p>
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
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        @media (max-width: 600px) {
          h1 { font-size: 26px !important; }
          .hero-pad { padding: 24px 14px 20px !important; }
        }
      `}</style>

      <footer style={{ textAlign: "center", padding: "36px 16px", color: "#94a3b8", fontSize: 12, background: "linear-gradient(180deg,#f0f2f5,#e2e8f0)" }}>
        🏸 Badminton Tournament — May the best team win!
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
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>🏸</div>
        <p style={{ fontSize: 16 }}>The tournament hasn't started yet. Check back soon!</p>
      </div>
    );
  }

  const StatCard = ({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: string }) => (
    <div style={{ flex: "1 1 220px", background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e8ecf1", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, color: "#1a1a2e" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* Currently live matches */}
      {live.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#dc2626", animation: "pulse 1.5s ease-in-out infinite" }} />
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#dc2626" }}>LIVE NOW</h2>
            <span style={{ background: "#fef2f2", color: "#dc2626", padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>{live.length} match{live.length > 1 ? "es" : ""}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
            {live.map(m => {
              const ta = m.team_a_id ? teamById[m.team_a_id] : null;
              const tb = m.team_b_id ? teamById[m.team_b_id] : null;
              const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
              const aLeading = sa > sb, bLeading = sb > sa;
              return (
                <div key={m.id} style={{ background: "linear-gradient(135deg,#fff,#fef2f2)", borderRadius: 14, padding: 18, border: "2px solid #ef4444", boxShadow: "0 4px 20px rgba(239,68,68,0.2)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#dc2626", letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>{m.stage === "group" ? `Group ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : "Knockout"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    {ta?.p1 && <Av name={ta.p1.name} photo={ta.p1.photo_url} sz={36} color={ta.p1.color} />}
                    <span style={{ fontWeight: aLeading ? 800 : 600, fontSize: 14, flex: 1, color: aLeading ? "#dc2626" : "#1a1a2e" }}>{tName(m.team_a_id)}</span>
                    <div style={{ minWidth: 56, padding: "8px 14px", background: aLeading ? "#dc2626" : "#fff", color: aLeading ? "#fff" : "#dc2626", borderRadius: 10, fontSize: 28, fontWeight: 900, textAlign: "center", border: "2px solid #ef4444", boxShadow: aLeading ? "0 2px 8px rgba(239,68,68,0.4)" : "none", transition: "all .2s" }}>{sa}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {tb?.p1 && <Av name={tb.p1.name} photo={tb.p1.photo_url} sz={36} color={tb.p1.color} />}
                    <span style={{ fontWeight: bLeading ? 800 : 600, fontSize: 14, flex: 1, color: bLeading ? "#dc2626" : "#1a1a2e" }}>{tName(m.team_b_id)}</span>
                    <div style={{ minWidth: 56, padding: "8px 14px", background: bLeading ? "#dc2626" : "#fff", color: bLeading ? "#fff" : "#dc2626", borderRadius: 10, fontSize: 28, fontWeight: 900, textAlign: "center", border: "2px solid #ef4444", boxShadow: bLeading ? "0 2px 8px rgba(239,68,68,0.4)" : "none", transition: "all .2s" }}>{sb}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tournament stats */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
        <StatCard label="Tournament" value={phase === "none" ? "Not started" : phase === "group" ? "Group Stage" : "Knockout"} color="#3A86FF" icon="🏸" />
        <StatCard label="Matches Played" value={`${matchesPlayed} / ${totalMatches}`} color="#2A9D8F" icon="✅" sub={totalMatches > 0 ? `${Math.round(matchesPlayed / totalMatches * 100)}% complete` : undefined} />
        {topTeam && topTeam.pts > 0 && <StatCard label="Top Team" value={`${topTeam.team.p1.name} & ${topTeam.team.p2.name}`} sub={`${topTeam.pts} points • ${topTeam.w} wins`} color="#f59e0b" icon="🏆" />}
        {bestDiff && (bestDiff.pf - bestDiff.pa) !== 0 && <StatCard label="Best +/-" value={`${bestDiff.pf - bestDiff.pa > 0 ? "+" : ""}${bestDiff.pf - bestDiff.pa}`} sub={`${bestDiff.team.p1.name} & ${bestDiff.team.p2.name}`} color="#8b5cf6" icon="📈" />}
      </div>

      {/* Upcoming matches */}
      {upcoming.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>⏭️ Upcoming Matches</h3>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1", overflow: "hidden" }}>
            {upcoming.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: i < upcoming.length - 1 ? "1px solid #f1f5f9" : "none", gap: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", minWidth: 80 }}>{m.stage === "group" ? `Group ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : `Round ${(m.round_idx ?? 0) + 1}`}</div>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{tName(m.team_a_id)}</div>
                <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 700, letterSpacing: 2 }}>VS</div>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 14, textAlign: "right" }}>{tName(m.team_b_id)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent results */}
      {recent.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>✅ Recent Results</h3>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1", overflow: "hidden" }}>
            {recent.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: i < recent.length - 1 ? "1px solid #f1f5f9" : "none", gap: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", minWidth: 80 }}>{m.stage === "group" ? `Group ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : `Round ${(m.round_idx ?? 0) + 1}`}</div>
                <div style={{ flex: 1, fontWeight: m.winner_id === m.team_a_id ? 700 : 500, color: m.winner_id === m.team_a_id ? "#16a34a" : "#475569", fontSize: 14 }}>{tName(m.team_a_id)}</div>
                <div style={{ fontWeight: 800, fontSize: 16, padding: "4px 12px", background: "#f0fdf4", borderRadius: 8, color: "#16a34a" }}>{m.score_a} – {m.score_b}</div>
                <div style={{ flex: 1, fontWeight: m.winner_id === m.team_b_id ? 700 : 500, color: m.winner_id === m.team_b_id ? "#16a34a" : "#475569", textAlign: "right", fontSize: 14 }}>{tName(m.team_b_id)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group standings preview */}
      {phase !== "none" && groups.length > 0 && (
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>📊 Standings</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
            {groups.map((g, gi) => {
              const st = getStandings(g, gi);
              return (
                <div key={gi} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1", padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#3A86FF", marginBottom: 10 }}>Group {String.fromCharCode(65 + gi)}</div>
                  {st.map((s, si) => (
                    <div key={s.team.id} style={{ display: "flex", alignItems: "center", padding: "8px 4px", borderTop: si === 0 ? "none" : "1px solid #f1f5f9" }}>
                      <div style={{ width: 22, fontSize: 12, fontWeight: 800, color: si < 2 ? "#16a34a" : "#94a3b8" }}>{si + 1}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.team.p1.name} & {s.team.p2.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#3A86FF", minWidth: 28, textAlign: "right" }}>{s.pts}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {live.length === 0 && upcoming.length === 0 && recent.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏸</div>
          <p style={{ margin: 0 }}>No matches scheduled yet. The tournament will begin shortly.</p>
        </div>
      )}
    </div>
  );
}
