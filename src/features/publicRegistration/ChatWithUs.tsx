// "Chat with us" on the screen after an entry is in: a round WhatsApp button
// in the corner opens a small card, and the card opens WhatsApp with a
// question to the club number started. A director answers from the club's
// WhatsApp (whatsapp-inbound leaves ordinary messages for a person); nothing
// is sent from this page. Same look and behaviour as /chat.js on
// shuttlestorm.adawar.org.

import { useEffect, useId, useRef, useState } from "react";
import { trackEvent } from "../../lib/analytics";
import { chatMessage, formatClubNumber, waLink } from "../../lib/whatsapp";
import { Mark } from "./ss/parts";

const WA_GLYPH =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z";

function WhatsAppGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={WA_GLYPH} />
    </svg>
  );
}

const PAGE = "registration_success";

export function ChatWithUs({ clubNumber, tournamentName, events }: {
  clubNumber: string | null;
  tournamentName: string;
  events: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const id = useId();
  const link = waLink(clubNumber, chatMessage(tournamentName, events));

  useEffect(() => {
    if (!open) return;
    const focus = window.setTimeout(() => ctaRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      launchRef.current?.focus({ preventScroll: true });
    };
    // composedPath is fixed when the tap happens, so it still holds the card
    // even if what was tapped has changed since.
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !e.composedPath().includes(rootRef.current)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(focus);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  if (!link || !clubNumber) return null;

  const toggle = () => {
    if (!open) trackEvent("whatsapp_chat", { action: "open", page: PAGE });
    setOpen(!open);
  };
  // Counted in Google Analytics only: the privacy page limits the Meta Pixel
  // to page visits and registration counts.
  const start = () => {
    trackEvent("whatsapp_chat", { action: "start", page: PAGE });
    window.setTimeout(() => setOpen(false), 300);
  };

  return (
    <div ref={rootRef} className="ss-chat">
      <div id={`${id}-panel`} className="ss-chat-panel" role="dialog" aria-modal="false" aria-labelledby={`${id}-name`} hidden={!open}>
        <div className="ss-chat-head">
          <span className="ss-chat-mark"><Mark size={28} /></span>
          <div>
            <div id={`${id}-name`} className="ss-chat-name">{tournamentName}</div>
            <div className="ss-chat-status"><i aria-hidden="true" />Usually replies same day</div>
          </div>
        </div>
        <div className="ss-chat-body">
          <div className="ss-chat-bubble">
            You're in! 👋 Questions about your entry, your partner or the day itself? <strong>Message the directors</strong> on WhatsApp.
          </div>
          <a ref={ctaRef} className="ss-chat-cta" href={link} target="_blank" rel="noopener noreferrer" onClick={start}>
            <WhatsAppGlyph size={20} />
            Chat on WhatsApp
          </a>
          <div className="ss-chat-foot">Opens WhatsApp with {formatClubNumber(clubNumber)}</div>
        </div>
      </div>
      <button
        ref={launchRef}
        type="button"
        className="ss-chat-launch"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={open ? "Close chat" : `Chat with ${tournamentName} on WhatsApp`}
        onClick={toggle}
      >
        {open ? <span className="ss-chat-x" aria-hidden="true">×</span> : <WhatsAppGlyph size={30} />}
      </button>
    </div>
  );
}
