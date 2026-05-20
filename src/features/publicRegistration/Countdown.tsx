import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { colors, radii, spacing, typography } from "../../lib/theme";

const CYAN = "#00d4ff";

type Props = {
  deadline: string; // ISO timestamp
};

function diffParts(ms: number): { d: number; h: number; m: number; s: number; expired: boolean } {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true };
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { d, h, m, s, expired: false };
}

function format(parts: ReturnType<typeof diffParts>): string {
  if (parts.expired) return "Registration closed";
  if (parts.d > 0) return `Closes in ${parts.d}d ${parts.h}h`;
  if (parts.h > 0) return `Closes in ${parts.h}h ${parts.m}m`;
  if (parts.m > 0) return `Closes in ${parts.m}m ${parts.s}s`;
  return `Closes in ${parts.s}s`;
}

export function Countdown({ deadline }: Props) {
  const reduce = useReducedMotion();
  const deadlineMs = useMemo(() => new Date(deadline).getTime(), [deadline]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = reduce ? 60_000 : 1_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [reduce]);

  const parts = diffParts(deadlineMs - now);
  const label = format(parts);
  const expired = parts.expired;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.sm,
        padding: `${spacing.xs}px ${spacing.md}px`,
        borderRadius: radii.pill,
        background: expired ? colors.state.liveSubtle : "rgba(0, 212, 255, 0.12)",
        border: `1px solid ${expired ? colors.state.live : CYAN}`,
        color: expired ? colors.state.live : "#006d80",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 0.2,
        ...typography.tabular,
      }}
      aria-live="polite"
    >
      {!expired && (
        <motion.span
          animate={reduce ? undefined : { opacity: [1, 0.4, 1] }}
          transition={reduce ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: CYAN,
          }}
        />
      )}
      <span>{label}</span>
    </div>
  );
}
