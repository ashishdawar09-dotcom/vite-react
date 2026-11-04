// Building blocks for the registration form in the Shuttle Storm look:
// ink background, bone type, volt for what's selected or next, Archivo for
// words and JetBrains Mono for labels, as on shuttlestorm.adawar.org.

import { useEffect, useId, useMemo, useState } from "react";
import "./ss.css";
import { inputStyle, monoLabel, ss } from "./theme";

// ---------- page ---------------------------------------------------------

export function Shell({ children, bottomSpace = true }: { children: React.ReactNode; bottomSpace?: boolean }) {
  return (
    <div className="ss-root" style={{
      minHeight: "100dvh",
      backgroundImage:
        "radial-gradient(120% 60% at 50% -12%, rgba(236,238,242,.075), transparent 62%)," +
        "radial-gradient(60% 40% at 92% 8%, rgba(212,255,58,.045), transparent 70%)",
      backgroundRepeat: "no-repeat",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingLeft: "env(safe-area-inset-left, 0px)",
      paddingRight: "env(safe-area-inset-right, 0px)",
    }}>
      <div style={{
        maxWidth: 600, margin: "0 auto", padding: "0 20px",
        paddingBottom: bottomSpace ? "calc(150px + env(safe-area-inset-bottom, 0px))" : 48,
      }}>
        {children}
      </div>
    </div>
  );
}

// The Shuttle Storm mark (shuttlecock between two arcs), as on the site.
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ color: ss.volt, flex: "0 0 auto" }}>
      <path d="M16 78 A46 46 0 0 1 50 15" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".6" />
      <path d="M104 42 A46 46 0 0 1 70 105" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".6" />
      <g transform="rotate(32 60 60)">
        <path d="M33 24 L87 24 L71 82 L49 82 Z" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
        <path d="M66 28 L50 56 L60 56 L53 79 L72 48 L62 48 L70 28 Z" fill="currentColor" />
        <circle cx="60" cy="94" r="12" fill="currentColor" />
      </g>
    </svg>
  );
}

function diffLabel(ms: number): string | null {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function Countdown({ deadline }: { deadline: string }) {
  const end = useMemo(() => new Date(deadline).getTime(), [deadline]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), end - Date.now() < 3_600_000 ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [end]);
  const left = diffLabel(end - now);
  return (
    <span aria-live="polite" style={{
      ...monoLabel, fontSize: 10.5, color: left ? ss.bone : ss.danger,
      display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
      padding: "7px 12px", borderRadius: 999, border: `1px solid ${ss.line}`, background: "rgba(6,8,13,.6)",
    }}>
      {left && <span className="ss-pulse" style={{ width: 6, height: 6, borderRadius: 6, background: ss.volt }} />}
      {left
        ? <><span className="ss-countdown-long">Closes in {left}</span><span className="ss-countdown-short">{left} left</span></>
        : "Entries closed"}
    </span>
  );
}

export function TopBar({ deadline }: { deadline: string | null }) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 72 }}>
      <a href="https://shuttlestorm.adawar.org/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minWidth: 0 }}>
        <Mark size={28} />
        <span className="ss-brand-word" style={{
          fontFamily: ss.display, fontWeight: 600, fontStretch: "125%",
          textTransform: "uppercase", color: ss.bone, whiteSpace: "nowrap",
        }}>Shuttle Storm</span>
      </a>
      {deadline && <Countdown deadline={deadline} />}
    </header>
  );
}

export function Progress({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <div role="group" aria-label={`Step ${index + 1} of ${total}: ${label}`} style={{ margin: "6px 0 26px" }}>
      <div aria-hidden="true" style={{ display: "flex", gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} style={{
            flex: 1, height: 3, borderRadius: 3,
            background: i < index ? "rgba(212,255,58,.55)" : i === index ? ss.volt : ss.line,
            transition: "background .3s ease",
          }} />
        ))}
      </div>
      <div aria-hidden="true" style={{ ...monoLabel, display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        <span>Step {index + 1} / {total}</span>
        <span style={{ color: ss.bone }}>{label}</span>
      </div>
    </div>
  );
}

export function StepTitle({ title, sub, headingRef }: {
  title: string; sub?: React.ReactNode; headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 ref={headingRef} tabIndex={-1} style={{
        margin: 0, fontFamily: ss.display, fontWeight: 400, fontSize: 30, lineHeight: 1.1,
        letterSpacing: "-.01em", color: ss.bone, outline: "none",
      }}>{title}</h2>
      {sub && <p style={{ margin: "10px 0 0", color: ss.body, fontSize: 15.5, lineHeight: 1.55 }}>{sub}</p>}
    </div>
  );
}

// ---------- fields --------------------------------------------------------



export function Field({ label, hint, error, required, optional, children, id }: {
  label: string; hint?: React.ReactNode; error?: string; required?: boolean; optional?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
  id?: string;
}) {
  const auto = useId();
  const controlId = id ?? auto;
  const msgId = `${controlId}-msg`;
  return (
    <div data-field="" data-field-error={error ? "" : undefined} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
      <label htmlFor={controlId} style={{ ...monoLabel, display: "flex", gap: 8, alignItems: "baseline" }}>
        <span>{label}</span>
        {required && <span aria-hidden="true" style={{ color: ss.volt }}>*</span>}
        {optional && <span style={{ color: "rgba(143,151,168,.7)", letterSpacing: ".1em" }}>Optional</span>}
      </label>
      {children({ id: controlId, "aria-describedby": error || hint ? msgId : undefined, "aria-invalid": error ? true : undefined })}
      {(error || hint) && (
        <div id={msgId} style={{ fontSize: 13, lineHeight: 1.45, color: error ? ss.danger : ss.mute }}>
          {error ? <ErrorText>{error}</ErrorText> : hint}
        </div>
      )}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "flex-start" }}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2 }}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5v4.2M8 11.2v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </span>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { mono, style, ...rest } = props;
  return (
    <input
      // The keyboard's action key moves to the next field; the page sets "go"
      // or "done" on a step's last field.
      enterKeyHint="next"
      {...rest}
      className="ss-input"
      style={{ ...inputStyle, ...(mono ? { fontFamily: ss.mono, fontSize: 16, letterSpacing: ".04em" } : {}), ...style }}
    />
  );
}

// ---------- buttons -------------------------------------------------------

export function Button({ variant = "primary", children, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      {...rest}
      className={`ss-btn ${primary ? "ss-btn-primary" : "ss-btn-ghost"}`}
      style={{
        minHeight: 56, padding: "0 24px", borderRadius: 999,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: ss.display, fontWeight: 600, fontSize: 14, letterSpacing: ".08em", textTransform: "uppercase",
        cursor: "pointer",
        border: primary ? "none" : `1px solid ${ss.lineStrong}`,
        background: primary ? (rest.disabled ? "rgba(236,238,242,.45)" : ss.bone) : "transparent",
        color: primary ? ss.ink : ss.bone,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export const Arrow = () => (
  <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
    <path d="M1 6h15M11.5 1.5L16 6l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Back (arrow) and the way on, side by side.
export function ActionButtons({ onBack, backLabel = "Back", children, keepFocus = false }: {
  onBack?: () => void; backLabel?: string; children: React.ReactNode;
  // Under the form while typing: tapping must not blur the field first (that
  // would close the keyboard and move the button out from under the finger).
  keepFocus?: boolean;
}) {
  const hold = keepFocus ? (e: React.PointerEvent | React.MouseEvent) => e.preventDefault() : undefined;
  return (
    <div style={{ display: "flex", gap: 10 }} onPointerDown={hold} onMouseDown={hold}>
      {onBack && (
        <Button variant="ghost" onClick={onBack} aria-label={backLabel} style={{ padding: "0 20px", flex: "0 0 auto" }}>
          <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
            <path d="M17 6H2M6.5 1.5L2 6l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      )}
      {children}
    </div>
  );
}

// The bar fixed to the bottom of the screen: running total and the way on.
// `hidden` slides it away while someone types on a phone (see keyboard.ts).
export function ActionBar({ summary, onBack, backLabel = "Back", children, hidden = false }: {
  summary?: React.ReactNode; onBack?: () => void; backLabel?: string; children: React.ReactNode; hidden?: boolean;
}) {
  return (
    <div
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20,
        background: "linear-gradient(to top, rgba(6,8,13,.98) 70%, rgba(6,8,13,.0))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        // Its own compositing layer, so scrolling never repaints it.
        transform: hidden ? "translate3d(0, calc(100% + 24px), 0)" : "translate3d(0, 0, 0)",
        opacity: hidden ? 0 : 1,
        transition: "transform .24s cubic-bezier(.2,.7,.2,1), opacity .18s ease",
        willChange: "transform",
        pointerEvents: hidden ? "none" : "auto",
      }}
    >
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "26px 20px 16px" }}>
        {summary && <div style={{ marginBottom: 12 }}>{summary}</div>}
        <ActionButtons onBack={onBack} backLabel={backLabel}>{children}</ActionButtons>
      </div>
    </div>
  );
}

// ---------- choices ------------------------------------------------------

export function CheckMark({ on, round = false }: { on: boolean; round?: boolean }) {
  return (
    <span aria-hidden="true" style={{
      flex: "0 0 auto", width: 24, height: 24, borderRadius: round ? 24 : 7,
      display: "grid", placeItems: "center",
      border: `1.5px solid ${on ? ss.volt : ss.lineStrong}`,
      background: on ? ss.volt : "transparent",
      transition: "background .16s ease, border-color .16s ease",
    }}>
      {on && (round
        ? <span style={{ width: 8, height: 8, borderRadius: 8, background: ss.ink }} />
        : (
          <svg width="13" height="10" viewBox="0 0 13 10">
            <path d="M1.5 5.2l3.4 3.3L11.5 1.5" fill="none" stroke={ss.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ))}
    </span>
  );
}

// A selectable card (checkbox or radio semantics).
export function ChoiceCard({ checked, onToggle, disabled, role = "checkbox", children, round }: {
  checked: boolean; onToggle: () => void; disabled?: boolean; role?: "checkbox" | "radio";
  children: React.ReactNode; round?: boolean;
}) {
  return (
    <div
      role={role}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className="ss-choice"
      onClick={() => { if (!disabled) onToggle(); }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); onToggle(); }
      }}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 16px 16px 18px", borderRadius: 16,
        border: `1px solid ${checked ? ss.volt : ss.line}`,
        background: checked ? ss.voltSoft : ss.ink2,
        boxShadow: checked ? "0 10px 30px -18px rgba(212,255,58,.55)" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        outlineOffset: 3,
        userSelect: "none",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <CheckMark on={checked} round={round ?? role === "radio"} />
    </div>
  );
}

// Two or three side-by-side options (e.g. "I have a partner" / "Find me one").
export function Segmented<T extends string>({ value, options, onChange, label, error }: {
  value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; error?: string;
}) {
  return (
    <div data-field-error={error ? "" : undefined}>
      <div role="radiogroup" aria-label={label} style={{
        display: "grid", gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))`, gap: 6,
        padding: 5, borderRadius: 16, border: `1px solid ${error ? ss.danger : ss.line}`, background: ss.ink2,
      }}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              className="ss-btn"
              onClick={() => onChange(o.value)}
              style={{
                minHeight: 48, padding: "0 10px", borderRadius: 12, border: "none", cursor: "pointer",
                fontFamily: ss.display, fontSize: 14.5, fontWeight: on ? 600 : 500, lineHeight: 1.2,
                background: on ? ss.bone : "transparent", color: on ? ss.ink : ss.body,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 13, color: ss.danger }}><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}

export function CheckRow({ checked, onChange, children, error }: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; error?: string;
}) {
  return (
    <label data-field-error={error ? "" : undefined} style={{
      display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", cursor: "pointer",
      borderTop: `1px solid ${ss.line}`,
    }}>
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        onFocus={(e) => e.currentTarget.parentElement?.style.setProperty("outline", `2px solid ${ss.volt}`)}
        onBlur={(e) => e.currentTarget.parentElement?.style.removeProperty("outline")}
      />
      <CheckMark on={checked} />
      <span style={{ fontSize: 15, lineHeight: 1.5, color: ss.body }}>
        {children}
        {error && <span style={{ display: "block", marginTop: 4, fontSize: 13, color: ss.danger }}><ErrorText>{error}</ErrorText></span>}
      </span>
    </label>
  );
}

// ---------- notes ---------------------------------------------------------

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "volt" | "danger" }) {
  const color = tone === "danger" ? ss.danger : tone === "volt" ? ss.volt : ss.lineStrong;
  return (
    <div role={tone === "danger" ? "alert" : undefined} style={{
      padding: "14px 16px", borderRadius: 14, fontSize: 14.5, lineHeight: 1.55,
      border: `1px solid ${tone === "info" ? ss.line : color}`,
      background: tone === "danger" ? ss.dangerSoft : tone === "volt" ? ss.voltSoft : ss.panel,
      color: tone === "danger" ? ss.danger : ss.body,
    }}>
      {children}
    </div>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{
      border: `1px solid ${ss.line}`, borderRadius: 20, padding: "20px 18px 6px",
      background: ss.panel, marginBottom: 16, ...style,
    }}>
      {children}
    </section>
  );
}
