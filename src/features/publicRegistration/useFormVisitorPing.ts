import { useEffect, useRef, useState } from "react";
import { formTopic, HEARTBEAT_MS, type FormSpot } from "../../lib/liveVisitors";
import { sendVisitorBye, sendVisitorPing } from "../../lib/sendVisitorPing";

// An id for this page load only: never stored, so it can't follow anyone.
function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Not a secure context: fall through.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Counts this open form in the admins' live "on the registration form right
 * now" (see src/lib/liveVisitors.ts): says where it is when it opens, when the
 * step changes, every 30 s while in front, when it goes to the background, and
 * "bye" when it closes. Nothing personal is sent, and it never affects the form.
 */
export function useFormVisitorPing(tournamentId: string | undefined, at: FormSpot | null): void {
  const [id] = useState(randomId);
  const [since] = useState(() => Date.now());
  // Message number: rises with every message, so a late one is ignored.
  const n = useRef(0);
  const atRef = useRef(at);
  const pingNow = useRef<() => void>(() => {});
  const active = !!tournamentId && at !== null;

  // A new step (or page) is sent as soon as it shows.
  useEffect(() => {
    atRef.current = at;
    pingNow.current();
  }, [at]);

  useEffect(() => {
    if (!active || !tournamentId) return;
    const topic = formTopic(tournamentId);
    const inFront = () => document.visibilityState !== "hidden";
    let timer: number | undefined;
    let stopped = false;

    const here = () => {
      const where = atRef.current;
      if (stopped || !where) return;
      n.current += 1;
      sendVisitorPing(topic, { id, n: n.current, at: where, visible: inFront(), since });
    };
    const bye = () => {
      n.current += 1;
      sendVisitorBye(topic, id, n.current);
    };
    // Heartbeats only while in front; a page in the background says so once.
    const schedule = () => {
      window.clearInterval(timer);
      timer = inFront() ? window.setInterval(here, HEARTBEAT_MS) : undefined;
    };
    const onVisibility = () => {
      here();
      schedule();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      here();
      schedule();
    };

    pingNow.current = here;
    here();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", bye);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopped = true;
      pingNow.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", bye);
      window.removeEventListener("pageshow", onPageShow);
      bye();
    };
  }, [active, tournamentId, id, since]);
}
