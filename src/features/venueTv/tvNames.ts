// How names appear on the venue TV. Long doubles names shorten in steps so
// nothing is ever cut off: full names, then initials, then surnames.

import type { TvMatch, TvModel } from "./tvModel";

export type NameMode = "full" | "fit" | "last";

const surname = (n: string) => n.slice(n.lastIndexOf(" ") + 1);

/** "Gurmeet Singh Ghera" → "G. Ghera": a person's name where the full one doesn't fit its box. */
export function shortPersonName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  const i = n.lastIndexOf(" ");
  return i < 0 ? n : `${[...n][0]}. ${n.slice(i + 1)}`;
}

export function teamName(model: TvModel, id: string | null, mode: NameMode, max = 99): string {
  if (!id) return "To be decided";
  const t = model.teams[id];
  if (!t) return "To be decided";
  const p = t.names;
  if (p.length === 1) {
    if (mode === "last") return surname(p[0]);
    if (mode === "fit" && p[0].length > max) {
      const ini = shortPersonName(p[0]);
      return ini.length <= max ? ini : surname(p[0]);
    }
    return p[0];
  }
  if (mode === "last") return `${surname(p[0])} & ${surname(p[1])}`;
  const full = `${p[0]} & ${p[1]}`;
  if (mode === "full" || full.length <= max) return full;
  // A one-word name stays as it is ("R. Sachdeva & Nilesh", never "N. Nilesh").
  const ini = `${shortPersonName(p[0])} & ${shortPersonName(p[1])}`;
  return ini.length <= max ? ini : `${surname(p[0])} & ${surname(p[1])}`;
}

/** A pair's short form, "R. Sachdeva & Nilesh", for a box where the full one doesn't fit. */
export function shortTeamName(model: TvModel, id: string | null): string {
  const t = id ? model.teams[id] : null;
  if (!t) return "To be decided";
  return t.names.map(shortPersonName).join(" & ");
}

export function sideLabel(model: TvModel, m: TvMatch, s: "a" | "b", mode: NameMode, max?: number): string {
  return teamName(model, m[s], mode, max);
}

/** The players of one side, one per line (or "To be decided"). */
export function sideNames(model: TvModel, m: TvMatch, s: "a" | "b", lastOnly = false): string[] {
  const id = m[s];
  const t = id ? model.teams[id] : null;
  if (!t) return ["To be decided"];
  return lastOnly ? t.names.map(surname) : t.names;
}

export const catName = (model: TvModel, m: TvMatch) => model.catById[m.cat]?.name ?? "";
export const catShort = (model: TvModel, m: TvMatch) => model.catById[m.cat]?.short ?? "";
/** "Men's Doubles 35+ · Group A" */
export const catStage = (model: TvModel, m: TvMatch) => `${catName(model, m)} · ${m.label}`;
/** "Men's 35+ · Group A" */
export const shortStage = (model: TvModel, m: TvMatch) => `${catShort(model, m)} · ${m.label}`;
