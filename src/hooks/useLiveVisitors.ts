import { useEffect, useState } from "react";
import * as Sentry from "@sentry/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { closeChannel, openChannel } from "../lib/realtimeChannels";
import {
  applyPing,
  formRank,
  formTopic,
  HEARTBEAT_MS,
  isFormSpot,
  isSitePath,
  listVisitors,
  newBook,
  pruneBook,
  siteRank,
  TOURNAMENT_SITE,
  VISITOR_EVENT,
  type VisitorBook,
  type VisitorList,
} from "../lib/liveVisitors";

export type LiveStatus = "connecting" | "live" | "offline";

export type LiveVisitors = {
  status: LiveStatus;
  form: VisitorList;
  /** null when the tournament has no website. */
  site: VisitorList | null;
  /**
   * Pages already open when the admin started listening show up with their
   * next heartbeat, so for the first 30 s a low count may still be filling in.
   */
  filling: boolean;
};

const NONE: VisitorList = { total: 0, away: 0, visitors: [] };

// Admin-only: who has this tournament's registration form, and its website,
// open right now (see src/lib/liveVisitors.ts). Listens only. Key the
// component by tournament id so a switch starts from zero.
export function useLiveVisitors(tournamentId: string | null | undefined, enabled: boolean): LiveVisitors {
  const site = tournamentId ? TOURNAMENT_SITE[tournamentId] ?? null : null;
  const [state, setState] = useState<LiveVisitors>({ status: "connecting", form: NONE, site: site ? NONE : null, filling: true });
  const siteTopic = site?.topic ?? null;

  useEffect(() => {
    if (!tournamentId || !enabled) return;
    const stop = new AbortController();
    const opened: { name: string; channel: RealtimeChannel }[] = [];
    const joined = new Set<string>();
    const book: { form: VisitorBook; site: VisitorBook } = { form: newBook(), site: newBook() };
    let fillUntil = 0;

    const publish = (status?: LiveStatus) => {
      if (stop.signal.aborted) return;
      const now = Date.now();
      setState((prev) => ({
        status: status ?? prev.status,
        form: listVisitors(book.form, formRank),
        site: siteTopic ? listVisitors(book.site, siteRank) : null,
        filling: fillUntil === 0 || now < fillUntil,
      }));
    };

    const listen = async (name: string, which: "form" | "site", isPlace: (at: string) => boolean) => {
      const ch = await openChannel(name, { config: { broadcast: { self: false } } }, stop.signal);
      if (!ch) return;
      opened.push({ name, channel: ch });
      ch.on("broadcast", { event: VISITOR_EVENT }, ({ payload }) => {
        if (applyPing(book[which], payload, isPlace, Date.now())) publish();
      });
      ch.subscribe((s, err) => {
        if (stop.signal.aborted) return;
        if (s === "SUBSCRIBED") joined.add(name);
        else joined.delete(name);
        const all = joined.size === (siteTopic ? 2 : 1);
        if (all && fillUntil === 0) fillUntil = Date.now() + HEARTBEAT_MS + 3_000;
        // After an error or a timeout the client rejoins by itself.
        publish(all ? "live" : s === "CLOSED" ? "offline" : "connecting");
        if (err) {
          Sentry.addBreadcrumb({ category: "realtime", level: "warning", message: "live visitors channel", data: { name, status: s, error: String(err) } });
        }
      });
    };

    void (async () => {
      try {
        await listen(formTopic(tournamentId), "form", isFormSpot);
        if (siteTopic) await listen(siteTopic, "site", isSitePath);
      } catch (err) {
        publish("offline");
        Sentry.addBreadcrumb({ category: "realtime", level: "warning", message: "live visitors subscribe failed", data: { tournamentId, error: String(err) } });
      }
    })();

    // Drop pages that went quiet, and end the filling-in period on time.
    const tick = window.setInterval(() => {
      const now = Date.now();
      const formDropped = pruneBook(book.form, now);
      const siteDropped = siteTopic ? pruneBook(book.site, now) : false;
      if (formDropped || siteDropped || (fillUntil > 0 && now >= fillUntil && now < fillUntil + 5_000)) publish();
    }, 5_000);

    return () => {
      stop.abort();
      window.clearInterval(tick);
      for (const { name, channel } of opened) closeChannel(name, channel);
    };
  }, [tournamentId, enabled, siteTopic]);

  return state;
}
