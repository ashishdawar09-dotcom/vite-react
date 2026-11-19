import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { useReducedMotion } from "framer-motion";
import type { TeamWithPlayers } from "../../types";
import { useWinnerPhoto } from "./useWinnerPhoto";
import { firstTime, initialsOf, safePhotoUrl } from "./winnerPhoto";
import "./championCard.css";

/**
 * The champions of an event: both winners' profile pictures in a spotlight
 * card, and underneath it the winners photo a desk volunteer uploaded (when
 * there is one). Shown wherever the app declares a champion.
 *
 * Display only: it reads the champion it is given and one public photo
 * address, and changes nothing. Tapping a picture enlarges it.
 */
export function ChampionCard({ champion, categoryName }: { champion: TeamWithPlayers; categoryName: string }) {
  const reduceMotion = useReducedMotion();
  const winnersPhoto = useWinnerPhoto(champion.category_id);
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  const [brokenWinnersPhoto, setBrokenWinnersPhoto] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const players = champion.p2 ? [champion.p1, champion.p2] : [champion.p1];

  // One burst of confetti the first time this champion is seen in this tab.
  useEffect(() => {
    if (reduceMotion || typeof document === "undefined" || document.hidden) return;
    if (!firstTime(`champion-seen:${champion.id}`)) return;
    const rect = cardRef.current?.getBoundingClientRect();
    const y = rect ? Math.min(0.9, Math.max(0.1, (rect.top + 120) / window.innerHeight)) : 0.35;
    try {
      void confetti({ particleCount: 90, spread: 75, startVelocity: 34, origin: { y }, colors: ["#d4ff3a", "#ffffff", "#829c28", "#4cc2ff"], disableForReducedMotion: true });
    } catch {
      // Confetti is decoration: never let it break the card.
    }
  }, [champion.id, reduceMotion]);

  const shownWinnersPhoto = winnersPhoto && winnersPhoto !== brokenWinnersPhoto ? winnersPhoto : null;

  return (
    <section ref={cardRef} className={`chc${reduceMotion ? " chc-still" : ""}`} aria-label={`Champions: ${categoryName}`} data-testid="champion-card">
      <div className={`chc-stage${players.length === 1 ? " chc-solo" : ""}`}>
        {players.map((p) => (
          <Portrait key={p.id} name={p.name} color={p.color} photo={safePhotoUrl(p.photo_url)} onZoom={setZoom} />
        ))}
        <div className="chc-bolt" aria-hidden="true">⚡</div>
        <div className="chc-fade" aria-hidden="true" />
      </div>
      <div className="chc-text">
        {categoryName && <div className="chc-kicker">{categoryName}</div>}
        <div className="chc-title font-display">Champ<span>{players.length === 1 ? "ion" : "ions"}</span></div>
        <div className={`chc-names font-display${players.length === 1 ? " chc-solo" : ""}`}>
          {players.map((p) => <div key={p.id}>{p.name}</div>)}
        </div>
      </div>
      {shownWinnersPhoto && (
        <button type="button" className="chc-photo" onClick={() => setZoom({ src: shownWinnersPhoto, caption: `Winners: ${categoryName}` })} aria-label="Winners photo, enlarge" data-testid="champion-winners-photo">
          <img src={shownWinnersPhoto} alt={`The winners of ${categoryName} with their prizes`} loading="lazy" onError={() => setBrokenWinnersPhoto(shownWinnersPhoto)} />
          <span className="chc-tag">Winners photo</span>
          <em>Tap to enlarge</em>
        </button>
      )}
      {zoom && <Lightbox src={zoom.src} caption={zoom.caption} onClose={() => setZoom(null)} />}
    </section>
  );
}

function Portrait({ name, color, photo, onZoom }: { name: string; color: string; photo: string | null; onZoom: (z: { src: string; caption: string }) => void }) {
  const [broken, setBroken] = useState(false);
  if (!photo || broken) {
    return (
      <div className="chc-por chc-ini" style={{ background: `linear-gradient(160deg, ${color || "#457B9D"} 0%, #0b1220 85%)` }} role="img" aria-label={name}>
        <span className="font-display">{initialsOf(name)}</span>
      </div>
    );
  }
  return (
    <button type="button" className="chc-por" onClick={() => onZoom({ src: photo, caption: name })} aria-label={`${name}, enlarge photo`}>
      <img src={photo} alt={name} onError={() => setBroken(true)} />
    </button>
  );
}

/** A picture, full screen. Rendered on <body> so no animated parent can clip it. */
function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="chc-lightbox" role="dialog" aria-modal="true" aria-label={caption} onClick={onClose} data-testid="champion-lightbox">
      <img src={src} alt={caption} />
      <p>{caption}</p>
      <button ref={closeRef} type="button" className="chc-close" onClick={onClose}>Close</button>
    </div>,
    document.body,
  );
}
