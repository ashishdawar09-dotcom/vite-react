import { useEffect, useRef, useState } from "react";
import { commitScore, holdAfterProp, holdAfterWrite, type ScoreHold } from "../lib/scoreHold";

const parseScore = (s: string) => {
  const n = parseInt(s, 10);
  return Math.max(0, isNaN(n) ? 0 : n);
};

/**
 * Score input that keeps a local string while the field is focused, so
 * snapshot polls / realtime pushes don't fight with the user's typing.
 * Persists on blur or Enter. Selects all on focus so a fresh number
 * cleanly replaces the previous one.
 *
 * After a save it keeps showing the saved number until the new value comes
 * back (it used to flick back to the old score meanwhile), and reports what
 * it shows through `onShownChange`, so Confirm can use the number on screen
 * rather than a save that may still be in flight.
 */
export function ScoreInput({ value, onCommit, onShownChange }: {
  value: number;
  onCommit: (next: number) => void | Promise<void>;
  onShownChange?: (shown: number) => void;
}) {
  // Text being typed; only used while the box has focus.
  const [local, setLocal] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  // A saved number held on screen until the server reports it (src/lib/scoreHold.ts).
  const [hold, setHold] = useState<ScoreHold | null>(null);
  const kept = holdAfterProp(hold, value);
  if (kept !== hold) setHold(kept);
  // While focused, the typed text wins over snapshot polls / realtime pushes.
  const display = focused ? local : kept ? String(kept.next) : String(value);
  useEffect(() => { onShownChange?.(parseScore(display)); }, [display, onShownChange]);
  // Escape blurs too; its blur must not save the text it just discarded.
  const discarding = useRef(false);
  const commit = () => {
    if (discarding.current) { discarding.current = false; return; }
    const c = commitScore(kept, value, parseScore(local));
    if (!c.write) return;
    setHold(c.hold);
    // Retyping the old score while a save is in flight writes it too, so the last number typed wins.
    Promise.resolve(onCommit(c.hold!.next)).then(
      () => setHold(h => holdAfterWrite(h, c.seq, true)),
      () => setHold(h => holdAfterWrite(h, c.seq, false)),
    );
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={display}
      onChange={(e) => {
        const s = e.target.value.replace(/[^0-9]/g, "");
        setLocal(s);
        onShownChange?.(parseScore(s)); // now, not after the next render: Confirm may be the next tap
      }}
      onFocus={(e) => { setLocal(display); setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.currentTarget.blur(); }
        else if (e.key === "Escape") { discarding.current = true; onShownChange?.(kept ? kept.next : value); e.currentTarget.blur(); }
      }}
      style={{
        width: 72,
        height: 56,
        textAlign: "center",
        fontSize: 30,
        fontWeight: 900,
        borderRadius: 14,
        border: "2px solid #3A86FF",
        outline: "none",
        color: "#1a1a2e",
        background: "#eff6ff",
        padding: 0,
        MozAppearance: "textfield" as const,
      }}
      aria-label="Score"
    />
  );
}
