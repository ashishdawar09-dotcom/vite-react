import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "framer-motion";
import { useVoiceAgent } from "@cloudflare/voice/react";
import { colors, radii, shadows, spacing, typography } from "../../lib/theme";
import { useResolvedTournamentId } from "./useResolvedTournament";
import { useVoicePlayerId } from "./useVoiceIdentity";

// Deployed Cloudflare voice agent host (no protocol), e.g.
// "badminton-voice-agent.<subdomain>.workers.dev". Feature is inert until set.
const WORKER_HOST = ((import.meta.env.VITE_VOICE_WORKER_URL as string | undefined) ?? "")
  .trim()
  .replace(/^wss?:\/\//i, "")
  .replace(/^https?:\/\//i, "")
  .replace(/\/+$/, "");

const AGENT = "BadmintonVoiceAgent";
const Z = 2500;

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function MicIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" fill="currentColor" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// Inner component: mounted only while the panel is open, so the WebSocket +
// microphone are not initialized until the user actually opens the assistant.
function VoiceCall({ tournamentId, playerId, onClose }: {
  tournamentId: string | null;
  playerId: string | null;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const {
    status, transcript, interimTranscript, connected, error,
    startCall, endCall, toggleMute, isMuted,
  } = useVoiceAgent({
    agent: AGENT,
    host: WORKER_HOST,
    query: {
      tournamentId: tournamentId ?? undefined,
      playerId: playerId ?? undefined,
    },
  });

  // Do NOT auto-start the mic: iOS Safari only grants microphone access when
  // getUserMedia is called directly inside a user gesture. Starting it from an
  // effect after the async WebSocket connect loses that gesture and the mic is
  // blocked ("failed to start"). Instead, the user taps "Start listening",
  // which calls startCall() synchronously within the tap.
  const hangUp = () => { endCall(); onClose(); };

  const label = STATUS_LABEL[status] ?? status;
  const listening = status === "listening";
  const inCall = status !== "idle";

  return createPortal(
    <div
      role="dialog"
      aria-label="Tournament voice assistant"
      style={{
        position: "fixed",
        right: `max(${spacing.xl}px, env(safe-area-inset-right))`,
        bottom: `calc(96px + env(safe-area-inset-bottom))`,
        width: "min(340px, calc(100vw - 32px))",
        background: colors.bg.elevated,
        color: colors.text.primaryDark,
        border: `1px solid ${colors.brand.cyanBorder}`,
        borderRadius: radii.xl,
        boxShadow: shadows.glow,
        zIndex: Z,
        overflow: "hidden",
        fontFamily: typography.body,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, padding: `${spacing.md}px ${spacing.lg}px`, background: colors.gradient.headerSurface }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: radii.pill,
            background: listening ? colors.brand.cyan : colors.text.mutedDark,
            boxShadow: listening ? `0 0 0 4px ${colors.brand.cyanSubtle}` : "none",
            animation: listening && !reduce ? "glow 1.4s ease-in-out infinite" : "none",
          }}
        />
        <strong style={{ fontSize: typography.scale.md, fontWeight: typography.weight.bold, flex: 1 }}>
          Voice Assistant
        </strong>
        <span style={{ fontSize: typography.scale.xs, color: colors.text.mutedDark }}>{connected ? label : "Connecting…"}</span>
        <button
          onClick={hangUp}
          aria-label="Close voice assistant"
          style={{ background: "transparent", border: "none", color: colors.text.mutedDark, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4 }}
        >
          ×
        </button>
      </div>

      {/* Transcript */}
      <div style={{ maxHeight: 260, overflowY: "auto", padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {transcript.length === 0 && !interimTranscript && (
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text.mutedDark, lineHeight: 1.5 }}>
            Ask me things like “who’s leading Group A?”, “when’s my next match?”, or “what are the rules?”
          </p>
        )}
        {transcript.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radii.lg,
              fontSize: typography.scale.sm,
              lineHeight: 1.45,
              background: m.role === "user" ? colors.brand.primarySubtle : colors.bg.surface,
              color: colors.text.primaryDark,
              border: `1px solid ${colors.border.dark}`,
            }}
          >
            {m.text}
          </div>
        ))}
        {interimTranscript && (
          <div style={{ alignSelf: "flex-end", maxWidth: "85%", fontSize: typography.scale.sm, color: colors.text.mutedDark, fontStyle: "italic" }}>
            {interimTranscript}
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: `${spacing.xs}px ${spacing.lg}px`, fontSize: typography.scale.xs, color: colors.state.warming }}>
          {error}
        </div>
      )}

      {/* Controls. When idle, a single "Start listening" button requests the
          mic INSIDE the tap (required by iOS Safari). Once in a call, show
          Mute + End. */}
      <div style={{ display: "flex", gap: spacing.sm, padding: spacing.md, borderTop: `1px solid ${colors.border.dark}` }}>
        {!inCall ? (
          <button
            onClick={() => { void startCall(); }}
            disabled={!connected}
            style={ctrlStyle("primary")}
          >
            {connected ? "🎤 Start listening" : "Connecting…"}
          </button>
        ) : (
          <>
            <button onClick={toggleMute} style={ctrlStyle("neutral")}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button onClick={hangUp} style={ctrlStyle("danger")}>
              End
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ctrlStyle(kind: "primary" | "neutral" | "danger"): CSSProperties {
  const base: CSSProperties = {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    fontWeight: typography.weight.bold,
    fontSize: typography.scale.sm,
    cursor: "pointer",
    fontFamily: typography.body,
  };
  if (kind === "primary") return { ...base, border: "none", background: colors.gradient.brandCta, color: "#fff", boxShadow: "0 4px 16px rgba(0,184,255,0.32)" };
  if (kind === "danger") return { ...base, border: `1px solid ${colors.state.live}`, background: colors.state.liveSubtle, color: colors.state.live };
  return { ...base, border: `1px solid ${colors.border.darkStrong}`, background: "transparent", color: colors.text.primaryDark };
}

export default function VoiceWidget() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const tournamentId = useResolvedTournamentId();
  const playerId = useVoicePlayerId(tournamentId);

  // Feature disabled until the Worker URL is configured.
  if (!WORKER_HOST) return null;

  return (
    <>
      {open && (
        <VoiceCall tournamentId={tournamentId} playerId={playerId} onClose={() => setOpen(false)} />
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close voice assistant" : "Open voice assistant"}
        aria-pressed={open}
        style={{
          position: "fixed",
          right: `max(${spacing.xl}px, env(safe-area-inset-right))`,
          bottom: `max(${spacing.xl}px, env(safe-area-inset-bottom))`,
          width: 60,
          height: 60,
          borderRadius: radii.pill,
          border: "none",
          background: colors.gradient.brandCta,
          color: "#fff",
          boxShadow: "0 6px 20px rgba(0,184,255,0.42)",
          cursor: "pointer",
          zIndex: Z + 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: reduce ? undefined : "transform 0.15s ease, box-shadow 0.15s ease",
          animation: open && !reduce ? "glow 1.6s ease-in-out infinite" : "none",
        }}
        onMouseEnter={(e) => { if (!reduce) e.currentTarget.style.transform = "scale(1.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <MicIcon size={26} />
      </button>
    </>
  );
}
