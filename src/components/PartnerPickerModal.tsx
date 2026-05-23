import { Av } from "./ui";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { colors, radii } from "../lib/theme";
import type { Player } from "../types";

// Partner picker — admin chooses an unpaired teammate to pair with the
// "me" player. Used in the Register tab when forming doubles teams.
//
// Was an inline IIFE in App.tsx with its own backdrop + sheet plumbing;
// now built on the shared <Modal> with surface="light" since the admin
// register flow uses the bright frame.
export function PartnerPickerModal({
  open,
  me,
  choices,
  onPick,
  onClose,
}: {
  open: boolean;
  me: Player | null;
  choices: Player[];
  onPick: (partnerId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="lg" surface="light" zIndex={1500} ariaLabel="Choose partner">
      <h3
        style={{
          margin: "0 0 6px",
          fontSize: 20,
          fontWeight: 800,
          textAlign: "center",
          color: colors.text.primaryLight,
        }}
      >
        🤝 Choose Partner
      </h3>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13,
          color: colors.text.mutedLight,
          textAlign: "center",
        }}
      >
        Pair {me?.name ?? "this player"} with...
      </p>
      {choices.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: colors.text.subtleLight }}>
          No available players to pair with.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
          {choices.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: radii.md,
                border: `2px solid ${colors.border.light}`,
                background: colors.bg.card,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
                minHeight: 56,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.brand.primary;
                e.currentTarget.style.background = "#eff6ff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border.light;
                e.currentTarget.style.background = colors.bg.card;
              }}
            >
              <Av name={p.name} photo={p.photo_url} sz={36} color={p.color} />
              <span style={{ fontWeight: 700, fontSize: 14, color: colors.text.primaryLight }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <Button onClick={onClose} variant="secondary" fullWidth style={{ marginTop: 18 }}>
        Cancel
      </Button>
    </Modal>
  );
}
