// How many entries are left, drawn as the net from the Shuttle Storm graphics:
// one tick per entry along the tape. Taken entries hang dim; open ones are
// lit, so the gap that's left is something you can see shrink.

import { memo, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { type Capacity, spotsWord, urgencyLine } from "./capacity";
import { radius, space, type } from "./ss/scale";
import { ss } from "./ss/theme";

const DIM = "rgba(236, 238, 242, .26)";

// The net. `height` is the tick length for open entries; taken ones are shorter.
// `filled` lights every taken tick too: the full house. Memoized: the meter's
// number counts down every frame for a moment and the net needn't redraw.
export const Net = memo(function Net({ cap, taken, height = 28, animate = true, filled = false }: {
  cap: number; taken: number; height?: number; animate?: boolean; filled?: boolean;
}) {
  const reduce = useReducedMotion();
  const n = Math.max(1, cap);
  const used = Math.min(Math.max(taken, 0), n);
  const W = 1000;
  const step = W / n;
  const tick = Math.max(step * 0.45, 1.6);
  const openFrom = (used / n) * W;
  return (
    <svg viewBox={`0 0 ${W} ${height + 4}`} preserveAspectRatio="none" width="100%" height={height + 4} aria-hidden="true" style={{ display: "block" }}>
      {/* The tape along the top of the net: dim over the taken entries, lit over the open ones. */}
      <rect x="0" y="0" width={openFrom} height="2" fill={filled ? ss.volt : DIM} />
      {used < n && <rect x={openFrom} y="0" width={W - openFrom} height="2" fill={ss.volt} />}
      {Array.from({ length: n }, (_, i) => {
        const open = i >= used;
        return (
          <rect
            key={i}
            className={animate && !reduce ? "ss-tick" : undefined}
            x={i * step + (step - tick) / 2}
            y="4"
            width={tick}
            height={open || filled ? height : Math.round(height * 0.62)}
            fill={open || filled ? ss.volt : DIM}
            style={animate && !reduce ? { animationDelay: `${Math.round((i / n) * 600)}ms` } : undefined}
          />
        );
      })}
    </svg>
  );
});

// Counts from the cap down to what's left, once, when the meter first shows,
// and moves to any new count after that.
function useCountTo(target: number, from: number): number {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(from);
  const current = useRef(from);
  useEffect(() => {
    if (reduce) return;
    const start = current.current;
    if (start === target) return;
    const t0 = performance.now();
    const duration = 900;
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      const v = Math.round(start + (target - start) * eased);
      current.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return reduce ? target : shown;
}

function LiveDot() {
  return <span aria-hidden="true" className="ss-pulse" style={{ width: 8, height: 8, borderRadius: 8, background: ss.volt, flex: "0 0 auto" }} />;
}

// The full meter, at the top of the form: kept compact so the form's first
// field still shows on a phone's first screen.
export function SpotsMeter({ capacity }: { capacity: Capacity }) {
  const { cap, taken, remaining } = capacity;
  const shown = useCountTo(remaining, cap);
  const tight = remaining <= 10;
  return (
    <section
      aria-labelledby="ss-spots-title"
      style={{
        marginTop: space[200], padding: space[200], borderRadius: radius["3xl"],
        background: ss.panel, border: `1px solid ${tight ? "rgba(212, 255, 58, .5)" : ss.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space[200] }}>
        <h2 id="ss-spots-title" style={{ margin: 0, display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: space[100] }}>
          <span aria-hidden="true" style={{ ...type.count2, color: ss.volt }}>{shown}</span>
          <span aria-hidden="true" style={{ ...type.title2, color: ss.bone }}>{spotsWord(remaining)} left</span>
          <span className="ss-sr-only">{remaining} {spotsWord(remaining)} left of {cap}</span>
        </h2>
        <span style={{ ...type.countCaption, display: "inline-flex", alignItems: "center", gap: space[75], color: ss.mute, paddingTop: space[50], whiteSpace: "nowrap" }}>
          <LiveDot />
          {Math.min(taken, cap)}/{cap}
        </span>
      </div>
      <div style={{ marginTop: space[100] }}>
        <Net cap={cap} taken={taken} height={20} />
      </div>
      <p className="ss-pretty" style={{ ...type.body5, margin: `${space[75]}px 0 0`, color: ss.bone }}>
        {urgencyLine(capacity)}
      </p>
    </section>
  );
}

// One line for the later steps, above the progress bar.
export function SpotsStrip({ capacity }: { capacity: Capacity }) {
  const { cap, taken, remaining } = capacity;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex", alignItems: "center", gap: space[100], marginBottom: space[200],
        padding: `${space[75]}px ${space[100]}px`, borderRadius: radius.xl,
        background: ss.panel, border: `1px solid ${remaining <= 10 ? "rgba(212, 255, 58, .5)" : ss.line}`,
      }}
    >
      <LiveDot />
      <span style={{ ...type.body5, color: ss.bone, whiteSpace: "nowrap" }}>
        <span style={{ color: ss.volt, fontFamily: ss.mono, fontVariantNumeric: "tabular-nums" }}>{remaining}</span>{" "}
        {spotsWord(remaining)} left
      </span>
      <div style={{ flex: 1, minWidth: 40 }}>
        <Net cap={cap} taken={taken} height={12} animate={false} />
      </div>
      <span aria-hidden="true" style={{ ...type.countCaption, color: ss.mute, whiteSpace: "nowrap" }}>{Math.min(taken, cap)}/{cap}</span>
    </div>
  );
}
