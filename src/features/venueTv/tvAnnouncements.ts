// The announcement line along the top of the venue TV. Most of the time it
// says who is being called and who is up next; the desk's own messages from
// the admin panel come round every third message until they end.

import type { TvMatch, TvMessage, TvModel } from "./tvModel";
import { catShort, shortStage, sideLabel, teamName } from "./tvNames";
import { hm } from "./tvTime";

export type AnnType = "call" | "mp" | "next" | "result" | "info" | "desk";
export type AnnItem = { type: AnnType; key: string; tag: string; main: string; sub: string };

/** Minutes a called team has to reach the court, from the tournament rules. */
export const CALL_WINDOW_MIN = 10;

export const evergreen = (siteUrl: string): AnnItem[] => [
  { type: "info", key: "e1", tag: "On your phone", main: `Every court and your next match: ${siteUrl}`, sub: "" },
  { type: "info", key: "e2", tag: "Reminder", main: `When you are called, be on court within ${CALL_WINDOW_MIN} minutes`, sub: "Then a 3 minute warm up" },
  { type: "info", key: "e3", tag: "Thank you", main: "Our sponsors make this tournament possible", sub: "Their names are on the sponsors board" },
];

export function deskItem(d: TvMessage): AnnItem {
  return { type: "desk", key: "k" + d.id, tag: "Announcement", main: d.text, sub: "" };
}

export function callItem(model: TvModel, m: TvMatch): AnnItem {
  return {
    type: "call",
    key: "c" + m.id,
    tag: "Now calling",
    main: `Court ${m.court}: ${sideLabel(model, m, "a", "fit", 22)} vs ${sideLabel(model, m, "b", "fit", 22)}`,
    sub: `${catShort(model, m)} · on court by ${hm((m.calledAt ?? model.now) + CALL_WINDOW_MIN * 60_000)}`,
  };
}

export function matchPointItem(model: TvModel, m: TvMatch): AnnItem {
  return {
    type: "mp",
    key: "p" + m.id,
    tag: "Match point",
    main: `Court ${m.court}: ${sideLabel(model, m, "a", "fit", 22)} vs ${sideLabel(model, m, "b", "fit", 22)}`,
    sub: shortStage(model, m),
  };
}

/**
 * The messages in the order they take turns. `ev` picks which evergreen
 * reminder is included this time round. Desk messages are put in front of
 * every second automatic message, so they show as every third message.
 */
export function annList(model: TvModel, ev: number, siteUrl: string): AnnItem[] {
  const base: AnnItem[] = [];
  model.courts.filter((m): m is TvMatch => !!m && m.status === "called").sort((x, y) => (x.court ?? 0) - (y.court ?? 0)).forEach(m => base.push(callItem(model, m)));
  model.queue.slice(0, 3).forEach((m, i) => base.push({
    type: "next",
    key: "n" + m.id,
    tag: i ? "Coming up" : "Up next",
    main: `${sideLabel(model, m, "a", "fit", 22)} vs ${sideLabel(model, m, "b", "fit", 22)}`,
    sub: m.eta != null ? `${shortStage(model, m)} · about ${hm(m.eta)}` : shortStage(model, m),
  }));
  const r = model.results[0];
  if (r && r.winner) {
    const wa = r.winner === r.a, sc = wa ? r.cur : [r.cur[1], r.cur[0]];
    const how = r.walkover ? " by walkover" : ` ${sc[0]}–${sc[1]}`;
    base.push({ type: "result", key: "r" + r.id, tag: "Final", main: `${teamName(model, wa ? r.a : r.b, "fit", 22)} beat ${teamName(model, wa ? r.b : r.a, "fit", 22)}${how}`, sub: shortStage(model, r) });
  }
  const eg = evergreen(siteUrl);
  base.push(eg[((ev % eg.length) + eg.length) % eg.length]);
  if (!model.messages.length) return base;
  const out: AnnItem[] = [];
  let d = 0;
  base.forEach((it, i) => {
    if (i % 2 === 0) out.push(deskItem(model.messages[d++ % model.messages.length]));
    out.push(it);
  });
  return out;
}
