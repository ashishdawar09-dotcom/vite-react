import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LottieLoader } from "../../components/ui/lottie-loader";
import { PlayerProfileView } from "../../components/PlayerProfileView";
import { useTournamentData } from "../../hooks/useTournamentData";
import { useScheduling } from "../../hooks/useScheduling";
import * as db from "../../lib/db";
import { derivePublicTournamentState } from "./publicDerive";
import type { Player, Tournament } from "../../types";

/**
 * Public player profile — /p/:id
 *
 * Two-step fetch: the player row tells us which tournament they belong to,
 * then we load that tournament via usePublicTournament. The same
 * PlayerProfileView the admin uses powers the page — passing isAdmin=false
 * disables the email-edit affordance for anonymous viewers.
 */
export function PublicPlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Step 1 — resolve the player so we know which tournament to load.
  const [player, setPlayer] = useState<Player | null>(null);
  const [resolving, setResolving] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setResolving(false);
      setNotFound(true);
      return;
    }
    setResolving(true);
    setNotFound(false);
    setError(null);
    db.getPlayerById(id)
      .then(p => {
        if (cancelled) return;
        if (!p) setNotFound(true);
        else setPlayer(p);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // Step 2 — fetch the player's tournament directly by id. We don't go
  // through usePublicTournament here because that hook is slug-first; doing
  // tournament_id → useTournamentData directly skips an extra resolve step
  // and works pre-migration (when slugs may not yet exist on the row).
  const [tournament, setTournament] = useState<Tournament | null>(null);
  useEffect(() => {
    if (!player) return;
    let cancelled = false;
    db.getTournamentById(player.tournament_id)
      .then(found => {
        if (cancelled) return;
        setTournament(found);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [player]);

  // Spectator-mode data fetch — bypasses slug resolution entirely.
  const tournamentId = tournament?.id ?? null;
  const { players, teams, matches, categories, playerCategories } = useTournamentData(tournamentId, false);
  const numCourts = tournament?.num_courts ?? 2;
  const { projected } = useScheduling(matches, categories, numCourts);

  const derived = useMemo(() => {
    if (!tournament) return null;
    return derivePublicTournamentState(players, teams, matches, categories);
  }, [tournament, players, teams, matches, categories]);

  // Loading: resolving the player, OR we've got a player but haven't yet
  // resolved their tournament + initial snapshot. Once derived is non-null
  // we render even if categories/matches are empty.
  if (resolving || (player && (!tournament || !derived))) {
    return <LottieLoader fullScreen label="Loading profile…" />;
  }

  if (notFound || !player) {
    return <NotFound id={id} />;
  }

  if (error) {
    return (
      <PageShell>
        <div style={{ padding: 40, textAlign: "center", color: "#ef4444" }}>
          Couldn't load this profile: {error}
        </div>
      </PageShell>
    );
  }

  if (!derived || !tournament) {
    return <LottieLoader fullScreen label="Loading profile…" />;
  }

  // Pre-migration tournaments have an undefined slug at runtime even though
  // the type says string. Fall back to id-based navigation so links still
  // route to a valid surface (the spectator page will 404 gracefully there
  // until the operator runs the v15 migration).
  const slugForLinks = tournament.slug || tournament.id;

  return (
    <PageShell>
      <div style={{ marginBottom: 18 }}>
        <Link to={`/t/${slugForLinks}`} style={{ color: "#3A86FF", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          ← {tournament.name}
        </Link>
      </div>
      <PlayerProfileView
        player={player}
        allTeams={derived.teamsView}
        matches={projected}
        categories={categories}
        playerCategories={playerCategories}
        groups={derived.groups}
        getStandings={derived.getStandings}
        onBack={() => navigate(`/t/${slugForLinks}`)}
        onShowProfile={(pid) => navigate(`/p/${pid}`)}
        isAdmin={false}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "#f1f5f9",
      paddingTop: "calc(env(safe-area-inset-top) + 18px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 18px)",
      paddingLeft: 16,
      paddingRight: 16,
    }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {children}
      </div>
    </div>
  );
}

function NotFound({ id }: { id: string | undefined }) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "#f1f5f9",
      color: "#0a1628",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      textAlign: "center",
    }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>🏸</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 8px" }}>Player not found</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>
          No player matches the link <code style={{ background: "#fff", padding: "2px 6px", borderRadius: 4, color: "#0a1628", border: "1px solid #cbd5e1" }}>{id ?? "(empty)"}</code>.
        </p>
        <Link to="/" style={{ color: "#3A86FF", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Back to home</Link>
      </div>
    </div>
  );
}
