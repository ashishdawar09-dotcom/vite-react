import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type CSSProperties } from "react";
import { colors, easings, radii, shadows, spacing, typography } from "../../lib/theme";
import type { Tournament } from "../../types";
import { useEntryCapacity } from "../publicRegistration/useEntryCapacity";
import { useRegistrationWaitlist } from "./useRegistrationWaitlist";
import { alertProblem, dialHref, joinedLabel, prettyPhone, waitlistCsv } from "./waitlist";

type Props = { tournament: Tournament | null; isAdmin: boolean };

const updatedFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit" });

// Admin-only card on the Players tab: everyone who joined the waitlist from
// the public "we're full" page, first to join first, with Call / Text / Email
// buttons and a CSV download. Shown for any tournament with an entry cap, and
// for any tournament that has waitlist names.
export function WaitlistPanel({ tournament, isAdmin }: Props) {
  const reduce = useReducedMotion();
  const enabled = isAdmin && !!tournament;
  const { rows, loaded, error, readAt } = useRegistrationWaitlist(tournament?.id, enabled);
  const { capacity } = useEntryCapacity(enabled ? tournament!.id : undefined);
  const [open, setOpen] = useState(true);

  if (!enabled || !tournament) return null;
  if (!capacity && rows.length === 0 && !error) return null;

  const downloadCsv = () => {
    const blob = new Blob([waitlistCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tournament.name.replace(/[^\w]+/g, "-")}-waitlist.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section
      data-testid="waitlist-panel"
      aria-labelledby="waitlist-panel-title"
      style={{
        marginBottom: spacing.lg,
        background: colors.bg.card,
        border: `1px solid ${colors.border.light}`,
        borderRadius: radii.xl,
        padding: spacing.md,
        boxShadow: shadows.md,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="waitlist-panel-body"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
          width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
          <span id="waitlist-panel-title" style={{
            fontFamily: typography.display, fontSize: 16, fontWeight: 800,
            color: colors.text.primaryLight, letterSpacing: 0.3,
          }}>
            Waitlist
          </span>
          <span data-testid="waitlist-count" style={{
            padding: "2px 10px", borderRadius: radii.pill,
            background: rows.length > 0 ? colors.state.warmingSubtle : colors.bg.muted,
            color: rows.length > 0 ? colors.state.warming : colors.text.mutedLight,
            fontSize: 12, fontWeight: 800, ...typography.tabular,
          }}>
            {loaded ? rows.length : "…"}
          </span>
          {capacity && (
            <span data-testid="waitlist-capacity" style={{
              fontSize: 12, fontWeight: 700, ...typography.tabular,
              color: capacity.full ? colors.state.live : colors.text.mutedLight,
            }}>
              {capacity.full
                ? `Entries full · ${capacity.taken} of ${capacity.cap}`
                : `${capacity.remaining} ${capacity.remaining === 1 ? "spot" : "spots"} left · ${capacity.taken} of ${capacity.cap}`}
            </span>
          )}
          {capacity && !capacity.waitlistOpen && (
            <span data-testid="waitlist-closed-badge" style={{
              padding: "2px 10px", borderRadius: radii.pill, background: colors.bg.muted,
              color: colors.text.mutedLight, fontSize: 12, fontWeight: 800,
            }}>
              Closed to new names
            </span>
          )}
        </span>
        <span aria-hidden style={{
          fontSize: 18, color: colors.text.mutedLight, transition: "transform 200ms",
          transform: open ? "rotate(0deg)" : "rotate(-90deg)", display: "inline-block",
        }}>▾</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="waitlist-panel-body"
            key="body"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: easings.standard }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ marginTop: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm }}>
              {error && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: colors.state.live }}>
                  Couldn't load the waitlist: {error}
                </p>
              )}

              {loaded && rows.length === 0 && !error && (
                <p data-testid="waitlist-empty" style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: colors.text.mutedLight }}>
                  {capacity && !capacity.waitlistOpen
                    ? "Nobody on the waitlist. It's closed: the registration page says entries are fully booked and takes no new names."
                    : "Nobody on the waitlist yet. When entries are full, the registration form offers the waitlist, and each new name also emails the directors."}
                </p>
              )}

              {capacity && !capacity.waitlistOpen && rows.length > 0 && (
                <p data-testid="waitlist-closed-note" style={{ margin: 0, fontSize: 13, lineHeight: "18px", color: colors.text.mutedLight }}>
                  The waitlist is closed. The registration page says entries are fully booked and takes no new names. These people joined before it closed.
                </p>
              )}

              {rows.length > 0 && (
                <ol data-testid="waitlist-rows" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: spacing.sm }}>
                  {rows.map((r, i) => {
                    const problem = alertProblem(r.admin_email_status);
                    return (
                      <li key={r.id} data-testid="waitlist-row" style={rowStyle}>
                        <span aria-label={`Place ${i + 1}`} style={placeStyle}>#{i + 1}</span>
                        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: colors.text.primaryLight, overflowWrap: "anywhere" }}>{r.name}</div>
                          <div data-testid="waitlist-event" style={{ fontSize: 13, fontWeight: 600, color: r.category_name ? colors.text.primaryLight : colors.text.subtleLight, marginTop: 2 }}>
                            {r.category_name ?? "No event chosen"}
                          </div>
                          <div style={{ fontSize: 13, color: colors.text.mutedLight, marginTop: 2, ...typography.tabular, overflowWrap: "anywhere" }}>
                            {prettyPhone(r.phone)} · {r.email}
                          </div>
                          <div style={{ fontSize: 12, color: colors.text.subtleLight, marginTop: 2 }}>
                            Joined {joinedLabel(r.created_at)}
                          </div>
                          {problem && (
                            <div style={{ fontSize: 12, color: colors.state.warming, fontWeight: 600, marginTop: 4 }}>{problem}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <a href={dialHref("tel", r.phone)} aria-label={`Call ${r.name}`} style={actionStyle}>Call</a>
                          <a href={dialHref("sms", r.phone)} aria-label={`Text ${r.name}`} style={actionStyle}>Text</a>
                          <a href={`mailto:${r.email}?subject=${encodeURIComponent(`${tournament.name}: a spot for you`)}`} aria-label={`Email ${r.name}`} style={actionStyle}>Email</a>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap", marginTop: 4 }}>
                <span style={{ fontSize: 12, lineHeight: "16px", color: colors.text.mutedLight }}>
                  {readAt ? `Updated ${updatedFmt.format(readAt)} · checks every minute. ` : ""}
                  A freed spot opens the form to everyone, so contact the next person first.
                </span>
                {rows.length > 0 && (
                  <button type="button" onClick={downloadCsv} style={{ ...actionStyle, cursor: "pointer" }}>Download CSV</button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const rowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: spacing.md, flexWrap: "wrap",
  padding: `${spacing.sm}px ${spacing.md}px`,
  border: `1px solid ${colors.border.light}`, borderRadius: radii.lg, background: colors.bg.page,
};

const placeStyle: CSSProperties = {
  fontFamily: typography.display, fontSize: 18, fontWeight: 800, color: colors.state.warming,
  minWidth: 32, ...typography.tabular,
};

const actionStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minHeight: 40, padding: "0 14px", borderRadius: radii.md,
  border: `1px solid ${colors.border.lightStrong}`, background: colors.bg.card,
  color: colors.brand.primaryHover, fontSize: 13, fontWeight: 700, textDecoration: "none",
};
