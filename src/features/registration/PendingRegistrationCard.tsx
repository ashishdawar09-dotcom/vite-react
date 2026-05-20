import confetti from "canvas-confetti";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useToast } from "../../components/Toast";
import { approveRegistration, rejectRegistration } from "../../lib/db";
import { colors, easings, radii, shadows, spacing, typography } from "../../lib/theme";
import type { Category, PendingRegistration, TournamentFees } from "../../types";
import { computeFee } from "../publicRegistration/computeFee";

type Props = {
  reg: PendingRegistration;
  category: Category | null;
  fees: TournamentFees;
  onResolved: (id: string) => void;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function copy(text: string, onOk: () => void) {
  try { await navigator.clipboard.writeText(text); onOk(); } catch { /* ignore */ }
}

export function PendingRegistrationCard({ reg, category, fees, onResolved }: Props) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const ownFee = computeFee(fees, category, reg.player_is_member, reg.payment_paid_full_for_partner ? "full" : "separate");
  const partnerFee = reg.partner_email && reg.partner_is_member !== null && category
    ? computeFee(fees, category, reg.partner_is_member, "separate")
    : null;

  const handleApprove = async () => {
    setBusy("approve");
    try {
      await approveRegistration(reg.id);
      toast.success(`Approved — ${reg.player_name}${reg.partner_name ? " & " + reg.partner_name : ""} added`);
      if (!reduce) {
        confetti({ particleCount: 60, spread: 60, startVelocity: 30, origin: { y: 0.4 } });
      }
      onResolved(reg.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Approve failed: ${msg}`);
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error("Please add a short reason");
      return;
    }
    setBusy("reject");
    try {
      await rejectRegistration(reg.id, reason.trim());
      toast.success("Registration rejected");
      onResolved(reg.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Reject failed: ${msg}`);
      setBusy(null);
    }
  };

  const onCopy = (key: string, value: string) => {
    void copy(value, () => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    });
  };

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.25, ease: easings.standard }}
      style={{
        background: colors.bg.card,
        border: `1px solid ${colors.border.light}`,
        borderRadius: radii.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        boxShadow: shadows.sm,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: colors.text.primaryLight }}>
            {reg.player_name}
          </div>
          <Badge tone={reg.player_is_member ? "good" : "neutral"}>
            {reg.player_is_member ? "Member" : "Non-member"}
          </Badge>
          {category && (
            <Badge tone="info">{category.name}{category.age_band ? ` • ${category.age_band}` : ""}</Badge>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.text.subtleLight }}>
          {relativeTime(reg.submitted_at)}
        </div>
      </div>

      {/* Contact */}
      <div style={{ marginTop: spacing.sm, display: "flex", flexWrap: "wrap", gap: spacing.md, fontSize: 13, color: colors.text.mutedLight }}>
        <ContactLine label="Email" value={reg.player_email} copyKey={`pe-${reg.id}`} copiedKey={copiedKey} onCopy={onCopy} />
        {reg.player_phone && <ContactLine label="Phone" value={reg.player_phone} copyKey={`pp-${reg.id}`} copiedKey={copiedKey} onCopy={onCopy} />}
      </div>

      {/* Partner sub-card */}
      {(reg.partner_name || reg.partner_email) && (
        <div style={{
          marginTop: spacing.md, padding: spacing.sm,
          background: colors.bg.muted, borderRadius: radii.md,
          borderLeft: `3px solid ${colors.brand.primary}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: colors.text.mutedLight, marginBottom: 4 }}>
            Partner
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text.primaryLight }}>{reg.partner_name ?? "—"}</div>
            {reg.partner_is_member !== null && (
              <Badge tone={reg.partner_is_member ? "good" : "neutral"}>
                {reg.partner_is_member ? "Member" : "Non-member"}
              </Badge>
            )}
          </div>
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: spacing.md, fontSize: 12, color: colors.text.mutedLight }}>
            {reg.partner_email && <ContactLine label="Email" value={reg.partner_email} copyKey={`xe-${reg.id}`} copiedKey={copiedKey} onCopy={onCopy} />}
            {reg.partner_phone && <ContactLine label="Phone" value={reg.partner_phone} copyKey={`xp-${reg.id}`} copiedKey={copiedKey} onCopy={onCopy} />}
          </div>
        </div>
      )}

      {/* Payment + fee */}
      <div style={{ marginTop: spacing.md, display: "flex", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: colors.text.mutedLight }}>
          Payment ref
        </span>
        <code style={{
          padding: "4px 10px", background: colors.bg.muted, borderRadius: radii.sm,
          fontSize: 13, fontWeight: 700, color: colors.text.primaryLight, fontFamily: "Menlo, monospace",
          ...typography.tabular,
        }}>{reg.payment_reference}</code>
        <button type="button" onClick={() => onCopy(`pr-${reg.id}`, reg.payment_reference)}
          style={{
            padding: "4px 10px", border: `1px solid ${colors.border.lightStrong}`,
            borderRadius: radii.sm, background: colors.bg.card, fontSize: 12,
            fontWeight: 700, cursor: "pointer", color: colors.text.primaryLight,
          }}>
          {copiedKey === `pr-${reg.id}` ? "Copied!" : "Copy"}
        </button>
        {ownFee !== null && (
          <span style={{ marginLeft: "auto", fontSize: 13, color: colors.text.primaryLight, ...typography.tabular }}>
            Owes <strong>${ownFee}</strong>
            {partnerFee !== null && reg.payment_paid_full_for_partner === false &&
              <span style={{ color: colors.text.mutedLight }}> &nbsp;(partner pays ${partnerFee} separately)</span>}
          </span>
        )}
      </div>

      {/* Comments */}
      {reg.comments && (
        <div style={{
          marginTop: spacing.sm, padding: spacing.sm,
          background: "rgba(245, 158, 11, 0.06)", border: `1px dashed ${colors.state.warming}`,
          borderRadius: radii.sm, fontStyle: "italic", fontSize: 13,
          color: colors.text.primaryLight, lineHeight: 1.4,
        }}>
          "{reg.comments}"
        </div>
      )}

      {/* Actions */}
      {!rejectMode && (
        <div style={{ marginTop: spacing.md, display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
          <button type="button" disabled={busy !== null} onClick={() => void handleApprove()}
            style={primaryBtn(colors.state.completed, busy === "approve")}>
            ✓ {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => setRejectMode(true)}
            style={primaryBtn(colors.state.live, false)}>
            ✗ Reject
          </button>
        </div>
      )}

      {rejectMode && (
        <div style={{ marginTop: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm }}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="Reason (will be saved with the rejection)"
            rows={2}
            style={{
              width: "100%", padding: 10, fontSize: 14,
              border: `1px solid ${colors.border.lightStrong}`, borderRadius: radii.md,
              fontFamily: typography.body, boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: spacing.sm }}>
            <button type="button" disabled={busy !== null} onClick={() => void handleReject()}
              style={primaryBtn(colors.state.live, busy === "reject")}>
              {busy === "reject" ? "Rejecting…" : "Confirm reject"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => { setRejectMode(false); setReason(""); }}
              style={secondaryBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function primaryBtn(color: string, busy: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", borderRadius: radii.md, border: "none",
    background: color, color: "#fff", fontSize: 13, fontWeight: 700,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.7 : 1, minHeight: 36,
  };
}

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: radii.md,
  border: `1px solid ${colors.border.lightStrong}`, background: colors.bg.card,
  color: colors.text.primaryLight, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 36,
};

function Badge({ tone, children }: { tone: "good" | "neutral" | "info"; children: React.ReactNode }) {
  const map = {
    good: { bg: colors.state.completedSubtle, fg: colors.state.completed },
    neutral: { bg: colors.bg.muted, fg: colors.text.mutedLight },
    info: { bg: colors.brand.primarySubtle, fg: colors.brand.primary },
  } as const;
  const { bg, fg } = map[tone];
  return (
    <span style={{
      padding: "2px 8px", borderRadius: radii.pill,
      background: bg, color: fg,
      fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
    }}>{children}</span>
  );
}

type ContactProps = {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
};

function ContactLine({ label, value, copyKey, copiedKey, onCopy }: ContactProps) {
  return (
    <span>
      <span style={{ color: colors.text.subtleLight, fontWeight: 600 }}>{label}:</span>
      &nbsp;<span style={{ color: colors.text.primaryLight, fontWeight: 600 }}>{value}</span>
      &nbsp;
      <button type="button" onClick={() => onCopy(copyKey, value)}
        style={{
          padding: "1px 6px", fontSize: 11, fontWeight: 700,
          border: `1px solid ${colors.border.light}`, borderRadius: radii.sm,
          background: "transparent", color: colors.text.mutedLight, cursor: "pointer",
        }}>
        {copiedKey === copyKey ? "✓" : "copy"}
      </button>
    </span>
  );
}
