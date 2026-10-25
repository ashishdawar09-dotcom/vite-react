import { useEffect, useRef, useState } from "react";

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
  // Saved on blur, not back from the server yet: { next, from: value at save time }.
  const [pending, setPending] = useState<{ next: number; from: number } | null>(null);
  // The server caught up, or the score changed some other way: stop holding.
  if (pending && value !== pending.from) setPending(null);
  const holding = pending && value === pending.from;
  // While focused, the typed text wins over snapshot polls / realtime pushes.
  const display = focused ? local : holding ? String(pending.next) : String(value);
  useEffect(() => { onShownChange?.(parseScore(display)); }, [display, onShownChange]);
  // Escape blurs too; its blur must not save the text it just discarded.
  const discarding = useRef(false);
  const commit = () => {
    if (discarding.current) { discarding.current = false; return; }
    const next = parseScore(local);
    if (next === value) { setPending(null); return; }
    if (holding && next === pending.next) return; // already saving this number
    setPending({ next, from: value });
    // A failed save stops holding the number, so the box shows the real score again.
    void Promise.resolve(onCommit(next)).catch(() => setPending(null));
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
        else if (e.key === "Escape") { discarding.current = true; onShownChange?.(holding ? pending.next : value); e.currentTarget.blur(); }
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
