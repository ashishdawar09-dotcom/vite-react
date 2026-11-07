import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type CSSProperties } from "react";
import { useLiveVisitors } from "../../hooks/useLiveVisitors";
import {
  FORM_SPOT_LABEL,
  isFormSpot,
  sitePageLabel,
  timeOnPage,
  TOURNAMENT_SITE,
  type Visitor,
  type VisitorList,
} from "../../lib/liveVisitors";
import { colors, motion as motionTokens, radii, shadows, spacing, typography } from "../../lib/theme";
import type { Tournament } from "../../types";

type Props = { tournament: Tournament | null; isAdmin: boolean };

// At most this many people are listed per row; the rest are "+N more".
const LISTED = 8;

// Admin-only card at the top of the Players tab: how many people have the
// tournament's website and its registration form open right now, and where
// each is. Live and anonymous (see src/lib/liveVisitors.ts).
export function LiveVisitors({ tournament, isAdmin }: Props) {
  const hasSite = !!tournament && !!TOURNAMENT_SITE[tournament.id];
  const enabled = isAdmin && !!tournament && (tournament.registration_open || hasSite);
  const live = useLiveVisitors(tournament?.id, enabled);
  const reduce = useReducedMotion();
  const now = useNow(live.form.total + (live.site?.total ?? 0) > 0 ? 30_000 : null);
  if (!enabled || !tournament) return null;

  const showForm = tournament.registration_open || live.form.total > 0;

  return (
    <div
      data-testid="live-visitors"
      title="Live and anonymous: each open page shares only where it is, whether it's in front, and when it opened."
      style={{
        marginBottom: spacing.lg,
        background: colors.bg.card,
        border: `1px solid ${colors.border.light}`,
        borderRadius: radii.xl,
        padding: `${spacing.md}px ${spacing.lg}px`,
        boxShadow: shadows.md,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      {live.status !== "live" ? (
        <Row testId="live-status" on={false} pulse={false}
          headline={live.status === "offline" ? "The live count is off. Refresh the page to try again." : "Connecting to the live count…"} />
      ) : (
        <>
          {live.site && (
            <Row testId="live-site" on={live.site.total > 0} pulse={!reduce}
              headline={headline(live.site, "the website", live.filling)}
              chips={chips(live.site, now, (v) => sitePageLabel(v.at), (v) => v.at === "/register")} />
          )}
          {showForm && (
            <Row testId="live-form" on={live.form.total > 0} pulse={!reduce}
              headline={headline(live.form, "the registration form", live.filling)}
              chips={chips(live.form, now, (v) => (isFormSpot(v.at) ? FORM_SPOT_LABEL[v.at] : v.at), (v) => v.at === "pay")} />
          )}
          {live.filling && (
            <span style={{ fontSize: 12, lineHeight: "16px", color: colors.text.mutedLight }}>
              Still counting: pages that were already open show up within 30 seconds.
            </span>
          )}
        </>
      )}
    </div>
  );
}

function headline(list: VisitorList, place: string, filling: boolean): string {
  const n = list.total;
  if (n > 0) return `${n} ${n === 1 ? "person" : "people"} on ${place} right now`;
  return filling ? `Checking who's on ${place}…` : `No one on ${place} right now`;
}

type Chip = { key: string; text: string; strong: boolean; away: boolean };

function chips(list: VisitorList, now: number, label: (v: Visitor) => string, strong: (v: Visitor) => boolean): Chip[] {
  const shown: Chip[] = list.visitors.slice(0, LISTED).map((v) => ({
    key: v.id,
    text: `${label(v)} · ${timeOnPage(v.since, now)}${v.visible ? "" : " · away"}`,
    strong: strong(v),
    away: !v.visible,
  }));
  if (list.total > LISTED) shown.push({ key: "more", text: `+${list.total - LISTED} more`, strong: false, away: false });
  return shown;
}

function Row({ testId, on, pulse, headline, chips = [] }: { testId: string; on: boolean; pulse: boolean; headline: string; chips?: Chip[] }) {
  return (
    <div data-testid={testId}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
        <Dot on={on} pulse={pulse} />
        <span role="status" style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: colors.text.primaryLight, ...typography.tabular }}>
          {headline}
        </span>
      </div>
      {chips.length > 0 && (
        <ul style={{ listStyle: "none", margin: `${spacing.sm}px 0 0`, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => (
            <li key={c.key} style={chipStyle(c)}>{c.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dot({ on, pulse }: { on: boolean; pulse: boolean }) {
  const style: CSSProperties = {
    width: 8,
    height: 8,
    flex: "none",
    borderRadius: radii.pill,
    background: on ? colors.state.completed : colors.state.pending,
  };
  return on && pulse ? (
    <motion.span
      aria-hidden
      style={style}
      animate={{ opacity: [1, 0.4, 1] }}
      transition={{ duration: motionTokens.duration.pulse, repeat: Infinity, ease: "easeInOut" }}
    />
  ) : (
    <span aria-hidden style={style} />
  );
}

// Payment (form) and Register (website) stand out; a page in the background is faded.
function chipStyle(c: Chip): CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: radii.pill,
    fontSize: 12,
    lineHeight: "18px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    background: c.strong ? colors.state.completedSubtle : colors.bg.muted,
    color: c.strong ? colors.state.completed : colors.text.primaryLight,
    opacity: c.away ? 0.6 : 1,
    ...typography.tabular,
  };
}

// The time now, refreshed every `ms` (null: not refreshed) so "4 min" moves on.
function useNow(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
