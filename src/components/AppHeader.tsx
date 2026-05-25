import { colors } from "../lib/theme";
import { ShuttleSVG } from "./ui";
import { NumberTicker } from "./ui/number-ticker";
import { TournamentPicker } from "./TournamentPicker";
import { CategoryPicker } from "./CategoryPicker";
import type { Category, Match, Tournament } from "../types";

// Header / hero band that sits at the top of the admin + spectator shell.
//
// Visual structure:
//   1. Background — gradient + athlete photo cutout + cyan glow accents
//   2. Top bar — brand mark + admin chip / login CTA
//   3. Hero — tournament name, date pill, picker dropdowns, pace pill, stats
//
// All admin gating is at the prop level (isAdmin). The component never
// imports useAuth or any state hooks — it is purely presentational so it
// can be screenshot-tested without booting Supabase.
//
// Safe-area padding lives here (not on the wrapping div) so the gradient
// extends edge-to-edge under the iOS Dynamic Island.
export function AppHeader({
  // Auth identity
  isAdmin,
  email,
  onSignOut,
  onOpenAdminManager,
  onOpenLogin,
  // Tournament + category selectors
  tournaments,
  current,
  onSelectTournament,
  onTournamentsChanged,
  categories,
  currentCategoryId,
  onSelectCategory,
  // Hero stats
  matches,
  tournamentDeltaMin,
  tournamentDeltaLabel,
  activeCount,
  teamsCount,
  unpairedCount,
}: {
  isAdmin: boolean;
  email: string | null;
  onSignOut: () => void | Promise<void>;
  onOpenAdminManager: () => void;
  onOpenLogin: () => void;
  tournaments: Tournament[];
  current: Tournament | null;
  onSelectTournament: (id: string | null) => void;
  onTournamentsChanged: () => void | Promise<void>;
  categories: Category[];
  currentCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  matches: Match[];
  tournamentDeltaMin: number;
  tournamentDeltaLabel: string;
  activeCount: number;
  teamsCount: number;
  unpairedCount: number;
}) {
  return (
    <header style={{
      background: colors.gradient.headerSurface,
      color: "#fff",
      padding: 0,
      position: "relative",
      overflow: "hidden",
      borderBottom: "1px solid #1a3050",
      // iOS PWA: push tappable content below the Dynamic Island / notch.
      // viewport-fit=cover (index.html) puts content under the OS status bar
      // in standalone mode; without this padding the Admin Sign In button
      // would render inside the OS-reserved zone and taps would be consumed
      // by the Dynamic Island rather than reaching the web view.
      paddingTop: "env(safe-area-inset-top, 0px)",
      // Side insets matter in landscape on notched devices.
      paddingLeft: "env(safe-area-inset-left, 0px)",
      paddingRight: "env(safe-area-inset-right, 0px)",
    }}>
      {/* Athlete photo on the right with diagonal cutout */}
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "55%", clipPath: "polygon(20% 0, 100% 0, 100% 100%, 0 100%)", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B6.jpg)", backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.95 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #050d1a 0%, rgba(5,13,26,0.85) 22%, rgba(5,13,26,0.4) 50%, rgba(5,13,26,0.05) 100%)" }} />
      </div>

      {/* Cyan glow accent + bottom-edge gradient lines */}
      <div style={{ position: "absolute", top: "-30%", left: "-10%", width: 500, height: 500, background: "radial-gradient(circle, rgba(0,184,255,0.18) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, #00b8ff 20%, #00d4ff 50%, #00b8ff 80%, transparent)", zIndex: 1 }} />
      <div style={{ position: "absolute", bottom: 3, left: 0, right: 0, height: 1, background: "rgba(0,184,255,0.3)", zIndex: 1 }} />

      {/* Top bar: brand + admin chip / login CTA */}
      <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: "1px solid rgba(0,184,255,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: colors.gradient.brandCta, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,184,255,0.4)" }}>
            <ShuttleSVG sz={22} color="#fff" opacity={1} />
          </div>
          <div>
            <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, color: "#fff", lineHeight: 1 }}>
              BADMINTON<span style={{ color: colors.brand.cyanHover }}>LIVE</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>
              Tournament Center
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isAdmin ? (
            <>
              <span style={{
                fontSize: 11,
                color: colors.brand.cyan,
                background: colors.brand.cyanSubtle,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${colors.brand.cyanBorder}`,
                fontWeight: 600,
                letterSpacing: 0.5,
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
              }}>● {email}</span>
              <button
                onClick={onOpenAdminManager}
                title="Manage admins"
                style={{
                  padding: "10px 14px",
                  minHeight: 44,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}>👥 ADMINS</button>
              <button
                onClick={() => void onSignOut()}
                style={{
                  padding: "10px 16px",
                  minHeight: 44,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}>SIGN OUT</button>
            </>
          ) : (
            <button
              onClick={onOpenLogin}
              style={{
                padding: "12px 22px",
                minHeight: 44,
                borderRadius: 8,
                border: "none",
                background: colors.gradient.brandCta,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
                boxShadow: "0 2px 12px rgba(0,184,255,0.4)",
              }}>Admin Sign In</button>
          )}
        </div>
      </div>

      {/* Main hero content */}
      <div className="hero-pad" style={{ position: "relative", zIndex: 2, padding: "44px 28px 36px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 4, background: "rgba(0,184,255,0.12)", border: "1px solid rgba(0,184,255,0.3)", marginBottom: 18 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 8px #00d4ff" }} />
          <span className="font-display" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: "#00d4ff" }}>
            Doubles Tournament
          </span>
        </div>

        <h1 className="font-display hero-title" style={{ margin: "0 0 10px", fontSize: 64, fontWeight: 700, letterSpacing: -1, color: "#fff", lineHeight: 0.95, textTransform: "uppercase", maxWidth: "65%" }}>
          {current?.name ?? "Badminton Championship"}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
          {current?.event_date && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <span style={{ color: "#00d4ff", fontSize: 13 }}>▸</span>
              <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", letterSpacing: 1 }}>
                {/* event_date is a DATE column (no time / timezone). `new Date('YYYY-MM-DD')` parses as
                    UTC midnight, which becomes the previous day in any timezone west of UTC. Appending
                    T12:00:00 (noon, local) avoids that off-by-one without timezone gymnastics. */}
                {new Date(current.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
              </span>
            </div>
          )}
          <TournamentPicker tournaments={tournaments} current={current} onSelect={onSelectTournament} isAdmin={isAdmin} onChange={onTournamentsChanged} />
          <CategoryPicker categories={categories} currentId={currentCategoryId} onSelect={onSelectCategory} />
          {/* Tournament-wide pace pill — only shown once at least one match has confirmed scores */}
          {matches.some(m => m.confirmed) && (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 4,
              background: tournamentDeltaMin > 1 ? "rgba(239,68,68,0.12)"
                        : tournamentDeltaMin < -1 ? "rgba(34,197,94,0.12)"
                        : "rgba(0,184,255,0.12)",
              border: `1px solid ${tournamentDeltaMin > 1 ? "rgba(239,68,68,0.4)" : tournamentDeltaMin < -1 ? "rgba(34,197,94,0.4)" : "rgba(0,184,255,0.4)"}`,
            }}>
              <span style={{ fontSize: 11 }}>{tournamentDeltaMin > 1 ? "▲" : tournamentDeltaMin < -1 ? "▼" : "●"}</span>
              <span className="font-display" style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: tournamentDeltaMin > 1 ? "#fca5a5"
                     : tournamentDeltaMin < -1 ? "#86efac"
                     : "#7dd3fc",
              }}>{tournamentDeltaLabel}</span>
            </div>
          )}
        </div>

        {/* Quick stats — broadcast style */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: "65%" }}>
          {([[activeCount, "Active Players", "#00d4ff"], [teamsCount, "Teams", "#22c55e"], [unpairedCount, "Unpaired", "#f59e0b"]] as const).map(([v, l, c]) => (
            <div key={l} style={{
              flex: "1 1 140px",
              background: "rgba(15,30,55,0.65)",
              backdropFilter: "blur(8px)",
              borderRadius: 6,
              padding: "12px 16px",
              border: "1px solid rgba(255,255,255,0.08)",
              borderLeft: `3px solid ${c}`,
              minWidth: 110,
            }}>
              <NumberTicker value={v} padLength={2} className="font-display" style={{ fontSize: 32, fontWeight: 700, color: c, lineHeight: 1, fontVariantNumeric: "tabular-nums", display: "block" }} />
              <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4, fontWeight: 600 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
