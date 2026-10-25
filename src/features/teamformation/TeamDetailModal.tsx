import { useState } from "react";
import { Av } from "../../components/ui";
import { Modal } from "../../components/ui/Modal";
import { colors, radii } from "../../lib/theme";
import type { Player } from "../../types";

const MIN_REASON = 3;
const MAX_REASON = 500;
const DANGER = "#dc2626";

/**
 * Admin pop-up for one team on the Teams tab. Deleting takes two steps:
 * open the card, press Delete, then give a reason and confirm. The reason
 * is stored with the deletion (delete_team RPC → team_deletions).
 */
export function TeamDetailModal({
  teamLabel,
  categoryName,
  p1,
  p2,
  onDelete,
  onClose,
}: {
  teamLabel: string;
  categoryName: string | null;
  p1: Player;
  p2: Player | null;
  onDelete: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonOk = reason.trim().length >= MIN_REASON;
  const names = p2 ? `${p1.name} & ${p2.name}` : p1.name;

  const confirmDelete = async () => {
    if (!reasonOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the team. Please try again.");
      setBusy(false);
    }
  };

  const button = (variant: "plain" | "outline" | "solid"): React.CSSProperties => ({
    flex: 1,
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: radii.md,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    border: variant === "plain" ? `1px solid ${colors.border.light}` : `2px solid ${DANGER}`,
    background: variant === "solid" ? DANGER : colors.bg.card,
    color: variant === "plain" ? colors.text.primaryLight : variant === "solid" ? "#fff" : DANGER,
  });

  const playerRow = (p: Player) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Av name={p.name} photo={p.photo_url} sz={40} color={p.color} />
      <span style={{ fontWeight: 700, fontSize: 16, color: colors.text.primaryLight }}>{p.name}</span>
    </div>
  );

  return (
    <Modal open onClose={busy ? undefined : onClose} size="md" surface="light" zIndex={1500} ariaLabel={`${teamLabel} details`}>
      {step === "details" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#3A86FF", textTransform: "uppercase", letterSpacing: 2 }}>{teamLabel}</h3>
            {categoryName && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{categoryName}</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {playerRow(p1)}
            {p2 ? (
              <>
                <div style={{ color: "#3A86FF", fontWeight: 900, fontSize: 14, letterSpacing: 2, paddingLeft: 14 }}>&amp;</div>
                {playerRow(p2)}
              </>
            ) : (
              <div style={{ fontSize: 13, color: colors.text.mutedLight }}>Looking for a partner</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={button("plain")}>Close</button>
            <button type="button" onClick={() => setStep("confirm")} style={button("outline")}>Delete team</button>
          </div>
        </>
      ) : (
        <>
          <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: colors.text.primaryLight }}>Delete {teamLabel}?</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.5, color: colors.text.mutedLight }}>
            This removes the team <strong style={{ color: colors.text.primaryLight }}>{names}</strong>
            {categoryName ? <> from {categoryName}</> : null}. The players themselves are not removed.
          </p>
          <label htmlFor="team-delete-reason" style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.text.primaryLight, marginBottom: 6 }}>
            Why are you deleting this team?
          </label>
          <textarea
            id="team-delete-reason"
            autoFocus
            value={reason}
            maxLength={MAX_REASON}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Partner withdrew, re-pairing with someone else"
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 16, fontFamily: "inherit",
              borderRadius: radii.md, border: `1px solid ${colors.border.light}`, resize: "vertical",
              color: colors.text.primaryLight, background: colors.bg.card,
            }}
          />
          <div style={{ minHeight: 18, margin: "4px 0 14px", fontSize: 12, color: error ? DANGER : colors.text.mutedLight }}>
            {error ?? (reasonOk ? "" : `At least ${MIN_REASON} characters.`)}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" disabled={busy} onClick={() => { setStep("details"); setError(null); }} style={button("plain")}>Cancel</button>
            <button
              type="button"
              disabled={!reasonOk || busy}
              onClick={() => void confirmDelete()}
              style={{ ...button("solid"), opacity: !reasonOk || busy ? 0.5 : 1, cursor: !reasonOk || busy ? "not-allowed" : "pointer" }}
            >
              {busy ? "Deleting…" : "Delete team"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
