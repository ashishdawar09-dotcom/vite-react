import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LiveTab } from "../../components/LiveTab";
import { LottieLoader } from "../../components/ui/lottie-loader";
import { usePublicTournament } from "./usePublicTournament";
import { derivePublicTournamentState } from "./publicDerive";

/**
 * Public spectator URL — /t/:slug
 *
 * Renders the same LiveTab the admin shell uses, but without the auth/admin
 * chrome. Anyone with the URL can watch: scores update via the spectator
 * polling path in useTournamentData (live_snapshot RPC every 5s).
 *
 * Player names are click-through to the public profile route /p/:id.
 * Header has links to the venue-TV view and the printable results page.
 */
export function PublicSpectatorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const ctx = usePublicTournament(slug);

  const derived = useMemo(() => {
    if (!ctx.tournament) return null;
    return derivePublicTournamentState(ctx.players, ctx.teams, ctx.matches, ctx.categories);
  }, [ctx.tournament, ctx.players, ctx.teams, ctx.matches, ctx.categories]);

  if (ctx.resolving) {
    return <LottieLoader fullScreen label="Loading tournament…" />;
  }

  if (ctx.notFound || !ctx.tournament) {
    return <NotFound slug={slug} />;
  }

  if (ctx.error) {
    return (
      <PublicPageShell tournamentName={ctx.tournament.name} slug={ctx.tournament.slug}>
        <div style={{ padding: 40, textAlign: "center", color: "#fbbf24" }}>
          Couldn't load this tournament: {ctx.error}
        </div>
      </PublicPageShell>
    );
  }

  if (!derived) {
    return <LottieLoader fullScreen label="Loading scores…" />;
  }

  return (
    <PublicPageShell
      tournamentName={ctx.tournament.name}
      venueName={ctx.tournament.venue_name}
      eventDate={ctx.tournament.event_date}
      slug={ctx.tournament.slug}
    >
      <LiveTab
        teamsView={derived.teamsView}
        allTeamById={derived.allTeamById}
        matches={ctx.matches}
        groupMatches={derived.groupMatches}
        knockoutMatches={derived.knockoutMatches}
        phase={derived.phase}
        groups={derived.groups}
        getStandings={derived.getStandings}
        categories={ctx.categories}
        numCourts={ctx.numCourts}
        liveByCourt={ctx.liveByCourt}
        projectedById={ctx.byId}
        projectedMatches={ctx.projected}
        players={ctx.players}
        playerCategories={ctx.playerCategories}
        onShowProfile={(pid) => navigate(`/p/${pid}`)}
      />
    </PublicPageShell>
  );
}

/**
 * Shared layout chrome for every /t/:slug/* surface — title row, venue meta,
 * and the cross-links between spectator / venue TV / printable results.
 */
export function PublicPageShell({
  tournamentName,
  venueName,
  eventDate,
  slug,
  children,
  hideCrossLinks,
}: {
  tournamentName: string;
  venueName?: string | null;
  eventDate?: string | null;
  slug: string;
  children: React.ReactNode;
  hideCrossLinks?: boolean;
}) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "#070F1F",
      color: "#fff",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <header style={{
        padding: "18px 24px 14px",
        background: "linear-gradient(180deg,#0a1628 0%,#070F1F 100%)",
        borderBottom: "1px solid #1a3050",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#00d4ff", textTransform: "uppercase" }}>Live Tournament</div>
          <h1 className="font-display" style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700, letterSpacing: 0.5, color: "#fff", textTransform: "uppercase", lineHeight: 1.1 }}>{tournamentName}</h1>
          {(venueName || eventDate) && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
              {[venueName, eventDate && new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        {!hideCrossLinks && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ChromeLink to={`/t/${slug}/tv`} title="Big-screen view for venue TVs">📺 Venue TV</ChromeLink>
            <ChromeLink to={`/t/${slug}/results`} title="Printable results card">🖨️ Print Results</ChromeLink>
          </div>
        )}
      </header>
      <main style={{ padding: "16px 24px 40px", maxWidth: 1400, margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}

function ChromeLink({ to, children, title }: { to: string; children: React.ReactNode; title?: string }) {
  return (
    <Link
      to={to}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        background: "rgba(0,184,255,0.08)",
        border: "1px solid rgba(0,184,255,0.35)",
        borderRadius: 8,
        color: "#00d4ff",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >{children}</Link>
  );
}

function NotFound({ slug }: { slug: string | undefined }) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "#070F1F",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      textAlign: "center",
    }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>🏸</div>
        <h1 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 8px" }}>
          Tournament not found
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>
          No tournament matches the link <code style={{ background: "#0a1628", padding: "2px 6px", borderRadius: 4, color: "#fbbf24" }}>{slug ?? "(empty)"}</code>. Double-check the URL — slugs are part of the link your admin shared.
        </p>
        <Link to="/" style={{ color: "#00d4ff", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Back to home</Link>
      </div>
    </div>
  );
}
