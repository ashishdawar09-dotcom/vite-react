import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { usePendingRegistrations } from "../../hooks/usePendingRegistrations";
import { colors, easings, radii, shadows, spacing, typography } from "../../lib/theme";
import type { Category, Tournament } from "../../types";
import { PendingRegistrationCard } from "./PendingRegistrationCard";

type Props = {
  tournament: Tournament | null;
  categories: Category[];
  isAdmin: boolean;
};

// Collapsible panel that shows pending registrations awaiting admin review.
// Mounts at the top of RegisterTab. Hidden entirely when there are zero rows
// — costs no vertical space when the queue is empty.
export function PendingRegistrationsPanel({ tournament, categories, isAdmin }: Props) {
  const reduce = useReducedMotion();
  const { pending, loading, error, removeLocal } = usePendingRegistrations(tournament?.id, isAdmin);
  const [open, setOpen] = useState(true);

  const catById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  if (!isAdmin || !tournament) return null;
  if (!loading && !error && pending.length === 0) return null;

  return (
    <div style={{
      marginBottom: spacing.lg,
      background: colors.bg.card,
      border: `1px solid ${colors.border.light}`,
      borderRadius: radii.xl,
      padding: spacing.md,
      boxShadow: shadows.md,
    }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", background: "transparent", border: "none", cursor: "pointer",
          padding: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: typography.display, fontSize: 16, fontWeight: 800,
            color: colors.text.primaryLight, letterSpacing: 0.3,
          }}>
            Pending Registrations
          </span>
          <span style={{
            padding: "2px 10px", borderRadius: radii.pill,
            background: pending.length > 0 ? colors.state.warmingSubtle : colors.bg.muted,
            color: pending.length > 0 ? colors.state.warming : colors.text.mutedLight,
            fontSize: 12, fontWeight: 800, ...typography.tabular,
          }}>
            {loading ? "…" : pending.length}
          </span>
          {error && (
            <span style={{ fontSize: 12, color: colors.state.live }}>
              {error}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 18, color: colors.text.mutedLight, transition: "transform 200ms",
          transform: open ? "rotate(0deg)" : "rotate(-90deg)", display: "inline-block",
        }}>▾</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: easings.standard }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ marginTop: spacing.md, display: "flex", flexDirection: "column" }}>
              <AnimatePresence initial={false}>
                {pending.map((reg) => (
                  <PendingRegistrationCard
                    key={reg.id}
                    reg={reg}
                    category={catById.get(reg.category_id) ?? null}
                    fees={tournament.fees}
                    onResolved={removeLocal}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
