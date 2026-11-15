import { useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { toast } from "./Toast";
import * as db from "../lib/db";
import { hasProgress } from "../lib/knockout";
import { planReplaceGroup, planReplaceKnockout, type ReplacePlan, type ReplaceRefusal } from "../lib/replaceTeam";
import type { Category, Match, Player, Team } from "../types";

// 🔁 Replace team (Ashish, Nov 15 2026). Knockout: put another team into a
// slot of a match that hasn't started; the team leaving keeps every result it
// played, and a bye moves with the slot. Group stage: only before the team's
// first match, and it takes all of that team's group matches. The incoming
// team can be anyone in the event that isn't still in the draw (a group team
// that didn't qualify, a team knocked out earlier, a team not drawn), or a new
// pair made here. The server (replace_team) re-checks every rule in one
// transaction and logs the reason.

type TeamView = Team & { p1: Player; p2: Player | null };
type Slot = { team: TeamView; match: Match; side: "team_a_id" | "team_b_id" };

const NEW = "__new_pair__";

const REFUSED: Record<ReplaceRefusal, string> = {
  "wrong-category": "from another event",
  "not-knockout": "not a knockout match",
  "bye": "a bye",
  "already-played": "already played",
  "in-play": "on court or in play: cancel the court first",
  "empty-slot": "empty slot",
  "same-team": "the team going out",
  "still-in-draw": "still in the draw",
  "sitting-out": "a player is sitting out",
  "knockout-started": "the knockout has started",
  "has-played": "has played (or is on court)",
  "already-in-group": "already in a group",
  "no-matches": "has no matches",
};

const SERVER: Record<string, string> = {
  match_in_play_or_played: "That match has started or finished meanwhile.",
  incoming_still_in_draw: "The team coming in is still in the draw.",
  incoming_not_in_event: "The team coming in isn't in this event.",
  incoming_sitting_out: "A player in the team coming in is sitting out.",
  outgoing_not_in_match: "The bracket changed meanwhile (another organizer?).",
  outgoing_not_in_event: "The team going out isn't in this event any more.",
  knockout_started: "This event's knockout has started.",
  group_swap_incomplete: "The groups changed meanwhile.",
  reason_required: "Type a reason first.",
  new_player_invalid: "A chosen player isn't active in this tournament.",
  wrong_team_size: "Pick two players for a doubles event, one for singles.",
  not_admin: "Only organizers can replace teams.",
  same_team: "That's the same team.",
  new_player_still_in_draw: "A chosen player is on another team still in this event's draw.",
  incoming_already_in_event: "The team coming in already has matches in this event.",
};

export function ReplaceTeamModal({
  category, matches, teams, players, label, onClose,
}: {
  category: Category;
  /** Every match of the tournament (only this event's are used). */
  matches: Match[];
  /** This event's teams. */
  teams: TeamView[];
  players: Player[];
  /** "Quarter-final 2", "Group B". */
  label: (m: Match) => string;
  onClose: () => void;
}) {
  const singles = category.team_size === 1;
  const cat = useMemo(() => matches.filter(m => m.category_id === category.id), [matches, category.id]);
  const isKo = cat.some(m => m.stage === "knockout");
  const teamById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);
  const name = (id: string | null) => {
    const t = id ? teamById[id] : null;
    return t?.p1 ? (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name) : id === NEW ? "the new pair" : "TBD";
  };
  const out = (id: string) => { const t = teamById[id]; return !!t && (t.p1?.active === false || t.p2?.active === false); };

  const [slot, setSlot] = useState<Slot | null>(null);
  const [outgoing, setOutgoing] = useState<string | null>(null);   // group stage
  const [incoming, setIncoming] = useState<string | null>(null);
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Step 1: who is going out.
  const slots: (Slot & { why: string | null })[] = useMemo(() => isKo
    ? cat.filter(m => m.stage === "knockout" && !m.is_bye && !m.confirmed)
        .flatMap(m => (["team_a_id", "team_b_id"] as const).filter(s => m[s] && teamById[m[s]!]).map(side => ({
          team: teamById[m[side]!], match: m, side, why: hasProgress(m) ? REFUSED["in-play"] : null,
        })))
    : [], [cat, isKo, teamById]);
  const groupTeams = useMemo(() => isKo ? [] : teams
    .filter(t => cat.some(m => m.stage === "group" && (m.team_a_id === t.id || m.team_b_id === t.id)))
    .map(t => {
      const r = planReplaceGroup(cat, category.id, t.id, NEW, category.id);
      return { team: t, why: r.ok ? null : REFUSED[r.reason] };
    }), [cat, category.id, isKo, teams]);

  const goingOut = isKo ? slot?.team.id ?? null : outgoing;
  const planFor = (inId: string, inCat: string | null = category.id): ReplacePlan | null => {
    if (!goingOut) return null;
    return isKo && slot
      ? planReplaceKnockout(cat, slot.match, slot.side, inId, inCat, out)
      : planReplaceGroup(cat, category.id, goingOut, inId, inCat, out);
  };

  // Step 2: who comes in.
  const kind = (id: string) => {
    const ms = cat.filter(m => m.team_a_id === id || m.team_b_id === id);
    if (!ms.length) return "Not drawn";
    if (cat.some(m => m.stage === "knockout" && m.confirmed && !m.is_bye && m.winner_id && m.winner_id !== id && (m.team_a_id === id || m.team_b_id === id))) return "Knocked out";
    if (isKo && !cat.some(m => m.stage === "knockout" && (m.team_a_id === id || m.team_b_id === id))) return "Didn't qualify";
    return "In the draw";
  };
  const candidates = useMemo(() => goingOut ? teams.filter(t => t.id !== goingOut).map(t => {
    const r = planFor(t.id);
    return { team: t, kind: kind(t.id), why: r && !r.ok ? REFUSED[r.reason] : null };
  }).sort((a, b) => Number(!!a.why) - Number(!!b.why) || a.kind.localeCompare(b.kind)) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [goingOut, teams, cat, slot]);

  const activePlayers = useMemo(() => players.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name)), [players]);
  const newPairOk = incoming === NEW && !!p1 && (singles ? true : !!p2 && p2 !== p1);
  const plan = incoming ? planFor(incoming === NEW ? NEW : incoming) : null;
  const ready = !!plan && plan.ok && (incoming !== NEW || newPairOk) && reason.trim().length > 0;

  const preview = (() => {
    if (!plan || !plan.ok || !goingOut) return null;
    const inName = incoming === NEW
      ? [activePlayers.find(p => p.id === p1)?.name, singles ? null : activePlayers.find(p => p.id === p2)?.name].filter(Boolean).join(" & ") || "the new pair"
      : name(incoming);
    if (isKo && slot) {
      const opp = slot.side === "team_a_id" ? slot.match.team_b_id : slot.match.team_a_id;
      return `${label(slot.match)}: ${name(goingOut)} v ${name(opp)} becomes ${inName} v ${name(opp)}.` +
        (plan.plan.updates.length > 1 ? ` ${inName} also takes ${name(goingOut)}'s bye.` : "");
    }
    return `${inName} takes ${name(goingOut)}'s place in all ${plan.plan.updates.length} of their group matches.`;
  })();

  const save = async () => {
    if (!ready || !plan || !plan.ok || !goingOut || busy) return;
    if (!window.confirm(`${preview}\n\nResults already played stay as they are. Replace?`)) return;
    setBusy(true);
    try {
      await db.replaceTeam({
        categoryId: category.id, outgoing: goingOut, incoming: incoming === NEW ? null : incoming,
        matchIds: plan.matchIds, reason: reason.trim(),
        newPair: incoming === NEW ? { p1, p2: singles ? null : p2 } : undefined,
      });
      toast(`Replaced. ${preview}`, "success");
      onClose();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "";
      const known = Object.keys(SERVER).find(k => msg.includes(k));
      toast(`Not replaced: ${known ? SERVER[known] : msg || "error"} Nothing was changed.`, "error");
    } finally {
      setBusy(false);
    }
  };

  const row = (key: string, title: string, sub: string, why: string | null, selected: boolean, onPick: () => void) => (
    <button key={key} type="button" disabled={!!why} onClick={onPick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: "none", borderBottom: "1px solid #11243f",
        background: selected ? "#11243f" : "transparent", color: "#fff", textAlign: "left", cursor: why ? "not-allowed" : "pointer", opacity: why ? 0.45 : 1, minHeight: 44 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{why ?? sub}</div>
      </div>
      {selected && <span style={{ color: "#22c55e", fontWeight: 800 }}>✓</span>}
    </button>
  );
  const list = { overflowY: "auto" as const, borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628", maxHeight: 260, marginBottom: 12 };
  const h = { margin: "4px 0 8px", fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#94a3b8", textTransform: "uppercase" as const };
  const select = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 14, marginBottom: 8, minHeight: 44 };

  return (
    <Modal open onClose={onClose} size="lg" surface="dark" zIndex={2000} ariaLabel="Replace team">
      <h3 className="font-display" style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>🔁 Replace team</h3>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94a3b8" }}>
        {category.name}. {isKo
          ? "Only a match that hasn't started. Results already played stay as they are."
          : "Group stage: only a team that hasn't played yet; the new team takes all its group matches."}
        {" "}If a player is leaving for the day, replace first, then Sit Out the player.
      </p>

      <div style={h}>1. Going out</div>
      <div style={list}>
        {isKo
          ? (slots.length ? slots.map(s => row(`${s.match.id}${s.side}`, name(s.team.id), label(s.match), s.why,
              slot?.match.id === s.match.id && slot.side === s.side, () => { setSlot(s); setIncoming(null); }))
            : <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>No knockout match left to play.</div>)
          : groupTeams.map(g => row(g.team.id, name(g.team.id), "Not played yet", g.why, outgoing === g.team.id, () => { setOutgoing(g.team.id); setIncoming(null); }))}
      </div>

      {goingOut && (
        <>
          <div style={h}>2. Coming in</div>
          <div style={list}>
            {row(NEW, singles ? "➕ Another player" : "➕ A new pair", singles ? "Pick the player below" : "Pick the two players below", null, incoming === NEW, () => setIncoming(NEW))}
            {candidates.map(c => row(c.team.id, name(c.team.id), c.kind, c.why, incoming === c.team.id, () => setIncoming(c.team.id)))}
          </div>
          {incoming === NEW && (
            <>
              <select aria-label="Player 1" value={p1} onChange={e => setP1(e.target.value)} style={select}>
                <option value="">{singles ? "Player…" : "Player 1…"}</option>
                {activePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {!singles && (
                <select aria-label="Player 2" value={p2} onChange={e => setP2(e.target.value)} style={select}>
                  <option value="">Player 2…</option>
                  {activePlayers.filter(p => p.id !== p1).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#fbbf24" }}>A new player needs to be on the Players tab first, and needs a waiver.</p>
            </>
          )}
        </>
      )}

      {goingOut && incoming && (
        <>
          <div style={h}>3. Reason</div>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. Partner injured"
            style={{ ...select, marginBottom: 12 }} />
          {preview && <p style={{ margin: "0 0 12px", fontSize: 13, color: "#e2e8f0", lineHeight: 1.5 }}>{preview}</p>}
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onClose} className="font-display"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", fontWeight: 700, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer", minHeight: 44 }}>
          Cancel
        </button>
        <button type="button" disabled={!ready || busy} onClick={() => void save()} className="font-display"
          style={{ flex: 2, padding: "10px 14px", borderRadius: 8, border: "none", background: ready ? "#a855f7" : "#334155", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", cursor: ready && !busy ? "pointer" : "not-allowed", minHeight: 44 }}>
          {busy ? "Replacing…" : "🔁 Replace"}
        </button>
      </div>
    </Modal>
  );
}
