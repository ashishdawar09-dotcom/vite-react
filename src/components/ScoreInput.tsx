import { useEffect, useState } from "react";

/**
 * Score input that keeps a local string while the field is focused, so
 * snapshot polls / realtime pushes don't fight with the user's typing.
 * Persists on blur or Enter. Selects all on focus so a fresh number
 * cleanly replaces the previous one.
 */
export function ScoreInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [local, setLocal] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  // Sync from props ONLY when not focused — otherwise we'd clobber the
  // user's in-progress typing every time the data refreshes.
  useEffect(() => {
    if (!focused) setLocal(String(value));
  }, [value, focused]);
  const commit = () => {
    const n = parseInt(local, 10);
    const next = Math.max(0, isNaN(n) ? 0 : n);
    if (next !== value) onCommit(next);
    setLocal(String(next));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.currentTarget.blur(); }
        else if (e.key === "Escape") { setLocal(String(value)); e.currentTarget.blur(); }
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
