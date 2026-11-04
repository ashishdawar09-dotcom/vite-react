// The five steps of the registration form: You, Events, Partners, Waiver,
// Payment. Presentational: the page owns the state and moves between steps.

import { useState } from "react";
import type { Category, Tournament } from "../../types";
import { HEARD_FROM_OPTIONS } from "../../lib/attribution";
import { ageProblem } from "./ageEligibility";
import { computeFee, priceBasis } from "./computeFee";
import { safeHttpUrl } from "./formParts";
import {
  ageRequired, concessionsOf, entryFee, emptyPartner, isDoubles, isMinor, partnerAgeForBand, partnerAgeForPrice,
  partnerMode, partnerOf, playerOf, selectedCategories, splitOf, splitOffered, studentOffered, totalFee,
  type FlowContext, type FlowState, type PartnerDraft, type StepErrors,
} from "./multiEntry";
import { parseAge } from "./validate";
import { CheckRow, ChoiceCard, Field, Note, Panel, Segmented, StepTitle, TextInput } from "./ss/parts";
import { inputStyle, money, monoLabel, ss } from "./ss/theme";

export type StepProps = {
  flow: FlowState;
  set: <K extends keyof FlowState>(key: K, value: FlowState[K]) => void;
  ctx: FlowContext;
  tournament: Tournament;
  errors: StepErrors | null;
  headingRef: React.Ref<HTMLHeadingElement>;
};

const digits = (v: string, max = 15) => v.replace(/\D/g, "").slice(0, max);

function fmtEventDate(t: Tournament): string | null {
  if (!t.event_date) return null;
  const d = new Date(`${t.event_date}T12:00:00`);
  const day = d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  if (!t.event_time) return day;
  const [hh, mm] = t.event_time.split(":").map(Number);
  if (Number.isNaN(hh)) return day;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} · ${h12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

// "Shuttle Storm Abbotsford 2026" → "Shuttle Storm" + " Abbotsford 2026", so
// the brand part can carry the accent.
function splitName(name: string): [string, string] {
  const m = /^(shuttle storm)(.*)$/i.exec(name.trim());
  return m ? [m[1], m[2]] : [name, ""];
}

// ---------- 1. You ---------------------------------------------------------

export type Highlight = { title: string; sub: string; href?: string };

export function Hero({ tournament, highlights, soloOffered }: { tournament: Tournament; highlights?: Highlight[]; soloOffered: boolean }) {
  const [brand, rest] = splitName(tournament.name);
  const when = fmtEventDate(tournament);
  return (
      <div style={{ padding: "18px 0 30px" }}>
        <div style={{ ...monoLabel, display: "flex", flexWrap: "wrap", gap: "6px 14px", color: ss.mute }}>
          {when && <span>{when}</span>}
          {tournament.venue_name && <span>{tournament.venue_name.split("–")[0].trim()}</span>}
        </div>
        <h1 style={{
          margin: "16px 0 0", fontFamily: ss.display, fontWeight: 200, fontStretch: "118%",
          fontSize: "clamp(38px, 10.5vw, 64px)", lineHeight: 0.95, letterSpacing: "-.01em",
          textTransform: "uppercase", color: ss.bone,
        }}>
          {brand}
          {rest && (
            <span style={{ display: "block", fontStyle: "italic", fontWeight: 300, fontStretch: "100%", textTransform: "none", color: ss.volt, fontSize: "0.62em", marginTop: 8, letterSpacing: 0 }}>
              {rest.trim()}
            </span>
          )}
        </h1>
        <p style={{ margin: "18px 0 0", color: ss.body, fontSize: 16.5, lineHeight: 1.55, maxWidth: 460 }}>
          Enter in about 5 minutes. Pick as many events as you like and pay once.
          {soloOffered && <> No partner? <span style={{ color: ss.bone }}>We'll find you one.</span></>}
        </p>
        {highlights && highlights.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "grid", gap: 0, borderTop: `1px solid ${ss.line}` }}>
            {highlights.map((h) => {
              const inner = (
                <>
                  <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 6, background: ss.volt, flex: "0 0 auto", marginTop: 8 }} />
                  <span>
                    <span style={{ color: ss.bone, fontSize: 15 }}>{h.title}</span>
                    <span style={{ color: ss.mute, fontSize: 13.5 }}> · {h.sub}</span>
                  </span>
                </>
              );
              return (
                <li key={h.title} style={{ borderBottom: `1px solid ${ss.line}` }}>
                  {h.href
                    ? <a href={h.href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", gap: 12, padding: "12px 0", textDecoration: "none" }}>{inner}</a>
                    : <div style={{ display: "flex", gap: 12, padding: "12px 0" }}>{inner}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
  );
}

export function WelcomeBack({ onStartOver }: { onStartOver: () => void }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Note tone="volt">
        Welcome back. We kept what you'd filled in on this device.{" "}
        <button type="button" onClick={onStartOver} className="ss-link" style={{ font: "inherit", color: ss.bone, background: "none", border: 0, padding: 0, cursor: "pointer" }}>
          Start over
        </button>
      </Note>
    </div>
  );
}

export function StepYou({ flow, set, errors, headingRef }: StepProps) {
  const e = errors?.fields ?? {};
  return (
    <>
      <StepTitle headingRef={headingRef} title="Your details" sub="Who's playing. We'll send your confirmation to this email." />
      <Field label="Full name" required error={e.player_name}>
        {(p) => <TextInput {...p} type="text" autoComplete="name" value={flow.player_name} onChange={(ev) => set("player_name", ev.target.value)} />}
      </Field>
      <Field label="Email" required error={e.player_email} hint="We'll email you here about your entry, and send one reminder if you don't finish.">
        {(p) => <TextInput {...p} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={flow.player_email} onChange={(ev) => set("player_email", ev.target.value)} />}
      </Field>
      <Field label="Mobile number" required error={e.player_phone} hint="For match-day updates. Numbers only, e.g. 6041234567.">
        {(p) => <TextInput {...p} type="tel" inputMode="numeric" autoComplete="tel" value={flow.player_phone} onChange={(ev) => set("player_phone", digits(ev.target.value))} />}
      </Field>
    </>
  );
}

// ---------- 2. Events ------------------------------------------------------

const BAND_SHORT: Record<string, string> = { kid: "Ages 8–12", teen: "Ages 13–17" };

function bandTag(c: Category): string | null {
  if (c.min_age != null) return `${c.min_age}+`;
  if (/50\s*\+/.test(c.name)) return "50+";
  return c.age_band ? BAND_SHORT[c.age_band] ?? null : null;
}

function shortReason(c: Category, age: number | null): string | null {
  if (age === null || !ageProblem(c, age)) return null;
  if (c.min_age != null) return `For players ${c.min_age} and over`;
  if (/50\s*\+/.test(c.name)) return "For players 50 and over";
  if (c.age_band === "teen") return "For players 13 to 17";
  if (c.age_band === "kid") return "For players 8 to 12";
  return "Not open at your age";
}

export function StepEvents({ flow, set, ctx, tournament, errors, headingRef }: StepProps) {
  const age = parseAge(flow.player_age);
  const needAge = ageRequired(ctx);
  const locked = needAge && age === null;
  const e = errors?.fields ?? {};
  const player = playerOf(flow, ctx);
  const concessions = concessionsOf(ctx);
  const picked = new Set(flow.category_ids);
  const offerStudent = ctx.categories.some((c) => studentOffered(c, ctx, age)) && age !== null && age >= 18;

  const toggle = (c: Category) => {
    const next = picked.has(c.id) ? flow.category_ids.filter((id) => id !== c.id) : [...flow.category_ids, c.id];
    set("category_ids", next);
  };

  const groups: [string, Category[]][] = [
    ["Doubles", ctx.categories.filter((c) => c.team_size === 2)],
    ["Singles", ctx.categories.filter((c) => c.team_size === 1)],
  ];

  return (
    <>
      <StepTitle headingRef={headingRef} title="Pick your events" sub="Choose as many as you like. You'll add partners next and pay once for everything." />
      {needAge && (
        <Field
          label={`Your age on ${tournament.event_date ? new Date(`${tournament.event_date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "tournament day"}`}
          required
          error={e.player_age}
          hint={isMinor(flow) ? "Under 19: a parent or guardian accepts the waiver for you." : "Shows the events you can play and any youth price."}
        >
          {(p) => (
            <TextInput {...p} type="text" inputMode="numeric" value={flow.player_age} placeholder="e.g. 34"
              onChange={(ev) => set("player_age", digits(ev.target.value, 3))} style={{ maxWidth: 160 }} />
          )}
        </Field>
      )}
      {offerStudent && (
        <div style={{ margin: "-4px 0 18px" }}>
          <CheckRow checked={flow.player_student} onChange={(v) => set("player_student", v)}>
            I'm a current {tournament.student_label ?? "student"}
            <span style={{ display: "block", fontSize: 13, color: ss.mute, marginTop: 2 }}>
              {money(Number(tournament.student_price))} per event. Bring your student ID to check-in.
            </span>
          </CheckRow>
        </div>
      )}

      {e.events && <div data-field-error="" style={{ marginBottom: 14 }}><Note tone="danger">{e.events}</Note></div>}
      {locked && <p style={{ ...monoLabel, margin: "4px 0 14px", color: ss.mute }}>Enter your age to choose events</p>}

      {groups.map(([label, list]) => list.length > 0 && (
        <div key={label} style={{ marginBottom: 22 }}>
          <div style={{ ...monoLabel, marginBottom: 10 }}>{label}</div>
          <div style={{ display: "grid", gap: 10 }}>
            {list.map((c) => {
              const reason = shortReason(c, age);
              const on = picked.has(c.id);
              const ownPrice = computeFee(c, "separate", player, undefined, concessions);
              const tag = bandTag(c);
              const problem = errors?.events[c.id];
              return (
                <div key={c.id} data-field-error={problem ? "" : undefined}>
                  <ChoiceCard checked={on} onToggle={() => toggle(c)} disabled={locked || (!!reason && !on)}>
                    <div style={{ fontSize: 17, color: ss.bone, lineHeight: 1.25 }}>{c.name}</div>
                    <div style={{ ...monoLabel, fontSize: 10.5, marginTop: 7, display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                      {tag && <span style={{ color: ss.body }}>{tag}</span>}
                      {ownPrice !== null && (
                        <span>{money(ownPrice)}{isDoubles(c) ? (priceBasis(c) === "per_team" ? " / team" : " / player") : ""}</span>
                      )}
                      {isDoubles(c) && c.allow_solo_signup && <span style={{ color: ss.volt }}>Solo OK</span>}
                    </div>
                    {reason && <div style={{ marginTop: 8, fontSize: 13.5, color: on ? ss.danger : ss.mute }}>{reason}</div>}
                  </ChoiceCard>
                  {problem && on && <div style={{ marginTop: 6, fontSize: 13, color: ss.danger }}>{problem} Untick it to continue.</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- 3. Partners ----------------------------------------------------

export function StepPartners({ flow, set, ctx, tournament, errors, headingRef }: StepProps) {
  const doubles = selectedCategories(flow, ctx).filter(isDoubles);
  const update = (c: Category, patch: Partial<PartnerDraft>) => {
    const cur = flow.partners[c.id] ?? emptyPartner();
    set("partners", { ...flow.partners, [c.id]: { ...cur, ...patch } });
  };
  return (
    <>
      <StepTitle
        headingRef={headingRef}
        title={doubles.length > 1 ? "Your partners" : "Your partner"}
        sub={doubles.some((c) => c.allow_solo_signup)
          ? "Enter who you're playing with, or let us pair you. Doubles players can enter solo."
          : "Enter who you're playing with."}
      />
      {doubles.map((c, i) => {
        const p = partnerOf(flow, c);
        const mode = partnerMode(flow, c);
        const pe = errors?.partners[c.id] ?? {};
        const sharing = ctx.payingShareFor === c.id;
        const split = splitOf(flow, c);
        const fullRequired = !c.allow_solo_signup || sharing || split === "full";
        const showAge = partnerAgeForBand(flow, c) || (partnerAgeForPrice(flow, c, ctx) && split === "full");
        const source = doubles.slice(0, i).find((o) => partnerMode(flow, o) === "named" && partnerOf(flow, o).name.trim());
        const own = entryFee({ ...flow, partners: { ...flow.partners, [c.id]: { ...p, split: "separate" } } }, c, ctx);
        const both = entryFee({ ...flow, partners: { ...flow.partners, [c.id]: { ...p, split: "full" } } }, c, ctx);
        const partnerAge = parseAge(p.age);
        return (
          <Panel key={c.id}>
            <div style={{ ...monoLabel, marginBottom: 6 }}>Event {i + 1} of {doubles.length}</div>
            <h3 style={{ margin: "0 0 16px", fontFamily: ss.display, fontWeight: 500, fontSize: 21, color: ss.bone }}>{c.name}</h3>
            {sharing && (
              <div style={{ marginBottom: 16 }}>
                <Note>Paying your share? Enter the partner who entered you, with the email address they registered with.</Note>
              </div>
            )}
            {c.allow_solo_signup && !sharing && (
              <div style={{ marginBottom: 18 }}>
                <Segmented
                  label={`Partner for ${c.name}`}
                  value={mode}
                  error={pe.mode}
                  options={[{ value: "named", label: "I have a partner" }, { value: "solo", label: "Find me a partner" }]}
                  onChange={(v) => update(c, v === "solo" ? { mode: "solo", split: "separate" } : { mode: "named" })}
                />
              </div>
            )}
            {mode === "solo" && (
              <div style={{ marginBottom: 18 }}>
                <Note tone="volt">We'll pair you with another player entering {c.name} on their own, and email you who it is before the day.</Note>
              </div>
            )}
            {(mode === "named" || sharing) && (
              <>
                {source && !p.name.trim() && (
                  <button
                    type="button" className="ss-btn ss-btn-ghost"
                    onClick={() => { const s = partnerOf(flow, source); update(c, { mode: "named", name: s.name, email: s.email, phone: s.phone, age: s.age }); }}
                    style={{
                      marginBottom: 16, minHeight: 40, padding: "0 14px", borderRadius: 999, cursor: "pointer",
                      border: `1px dashed ${ss.lineStrong}`, background: "transparent", color: ss.bone, fontFamily: ss.display, fontSize: 13.5,
                    }}
                  >
                    + Same partner as {source.name}
                  </button>
                )}
                <Field label="Partner's name" required error={pe.partner_name}>
                  {(f) => <TextInput {...f} type="text" autoComplete="off" value={p.name} onChange={(ev) => update(c, { name: ev.target.value })} />}
                </Field>
                <Field
                  label="Partner's email" required={fullRequired} optional={!fullRequired} error={pe.partner_email}
                  hint={fullRequired ? "We'll email them to confirm their place and sign the waiver." : "Links your two entries and sends them the waiver to sign."}
                >
                  {(f) => <TextInput {...f} type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="off" value={p.email} onChange={(ev) => update(c, { email: ev.target.value })} />}
                </Field>
                <Field label="Partner's mobile" required={fullRequired} optional={!fullRequired} error={pe.partner_phone}>
                  {(f) => <TextInput {...f} type="tel" inputMode="numeric" autoComplete="off" value={p.phone} onChange={(ev) => update(c, { phone: digits(ev.target.value) })} />}
                </Field>
                {showAge && (
                  <Field
                    label="Partner's age on tournament day" required error={pe.partner_age}
                    hint={c.min_age != null ? `Both partners must be ${c.min_age}+ on the day.` : "Sets the price of their share."}
                  >
                    {(f) => <TextInput {...f} type="text" inputMode="numeric" value={p.age} onChange={(ev) => update(c, { age: digits(ev.target.value, 3) })} style={{ maxWidth: 160 }} />}
                  </Field>
                )}
                {splitOffered(flow, c) && own !== null && (
                  <div style={{ margin: "4px 0 18px" }}>
                    <div style={{ ...monoLabel, marginBottom: 10 }}>Who pays for {p.name.trim().split(/\s+/)[0] || "your partner"}?</div>
                    <div role="radiogroup" style={{ display: "grid", gap: 10 }}>
                      <ChoiceCard role="radio" checked={split === "separate"} onToggle={() => update(c, { split: "separate" })}>
                        <div style={{ fontSize: 15.5, color: ss.bone }}>They pay their own share</div>
                        <div style={{ fontSize: 13.5, color: ss.mute, marginTop: 3 }}>You pay {money(own)} now. We'll email them how to pay theirs.</div>
                      </ChoiceCard>
                      <ChoiceCard role="radio" checked={split === "full"} onToggle={() => update(c, { split: "full" })}>
                        <div style={{ fontSize: 15.5, color: ss.bone }}>I'll pay for both of us</div>
                        <div style={{ fontSize: 13.5, color: ss.mute, marginTop: 3 }}>
                          {both !== null && (partnerAge !== null || !ageRequired(ctx)) ? `${money(both)} for the team.` : "Both shares; your partner's age sets theirs."}
                        </div>
                      </ChoiceCard>
                    </div>
                  </div>
                )}
                {split === "full" && partnerAge !== null && partnerAge >= 18 && studentOffered(c, ctx, partnerAge) && (
                  <div style={{ marginBottom: 12 }}>
                    <CheckRow checked={p.student} onChange={(v) => update(c, { student: v })}>
                      My partner is a current {tournament.student_label ?? "student"}
                    </CheckRow>
                  </div>
                )}
              </>
            )}
          </Panel>
        );
      })}
    </>
  );
}

// ---------- 4. Waiver ------------------------------------------------------

export function StepWaiver({ flow, set, tournament, errors, headingRef, ctx }: StepProps) {
  const e = errors?.fields ?? {};
  const minor = isMinor(flow);
  const rules = safeHttpUrl(tournament.rules_url);
  const waiverUrl = safeHttpUrl(tournament.waiver_url);
  const namedPartners = selectedCategories(flow, ctx).filter((c) => partnerMode(flow, c) === "named" && partnerOf(flow, c).email.trim());
  return (
    <>
      <StepTitle
        headingRef={headingRef}
        title="Rules and waiver"
        sub={minor
          ? "You're under 19, so a parent or guardian reads and accepts this for you. One acceptance covers all your events."
          : "Every player reads the regulations and accepts the waiver. One acceptance covers all your events."}
      />
      {(rules || waiverUrl) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", marginBottom: 14 }}>
          {rules && <a className="ss-link" href={rules} target="_blank" rel="noopener" style={{ color: ss.bone, fontSize: 15 }}>Competition regulations ↗</a>}
          {waiverUrl && <a className="ss-link" href={waiverUrl} target="_blank" rel="noopener" style={{ color: ss.bone, fontSize: 15 }}>Waiver in a new tab ↗</a>}
        </div>
      )}
      <div
        role="region" aria-label="Waiver text" tabIndex={0} className="ss-scroll"
        style={{
          maxHeight: 260, overflowY: "auto", padding: "16px 18px", borderRadius: 16,
          border: `1px solid ${ss.line}`, background: ss.ink2, color: ss.body,
          fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", marginBottom: 8,
        }}
      >
        {tournament.waiver_text}
      </div>
      <div style={{ marginBottom: 18 }}>
        <CheckRow checked={flow.accepted_rules} onChange={(v) => set("accepted_rules", v)} error={e.accepted_rules}>
          I have read the competition regulations.
        </CheckRow>
        <CheckRow checked={flow.accepted_waiver} onChange={(v) => set("accepted_waiver", v)} error={e.accepted_waiver}>
          I have read and understood the Acknowledgement of Risk and Release of Liability above, and I agree to it.
        </CheckRow>
        <CheckRow checked={flow.accepted_codes} onChange={(v) => set("accepted_codes", v)} error={e.accepted_codes}>
          I have read and will follow the Badminton BC codes of conduct (linked in the regulations).
        </CheckRow>
      </div>
      {minor && (
        <Field label="Parent or guardian's full name" required error={e.guardian_name}>
          {(f) => <TextInput {...f} type="text" autoComplete="off" value={flow.guardian_name} onChange={(ev) => set("guardian_name", ev.target.value)} />}
        </Field>
      )}
      <Field
        label={minor ? "Parent or guardian's signature" : "Your signature"} required error={e.signature}
        hint={minor ? "Type the parent or guardian's full name, as above." : `Type your full name: ${flow.player_name.trim() || "as on step 1"}.`}
      >
        {(f) => (
          <TextInput {...f} type="text" autoComplete="off" value={flow.signature} onChange={(ev) => set("signature", ev.target.value)}
            style={{ fontStyle: "italic", fontSize: 20, fontWeight: 300 }} />
        )}
      </Field>
      {namedPartners.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 14, color: ss.mute, lineHeight: 1.55 }}>
          Partners sign their own waiver: we'll email {namedPartners.length > 1 ? "each of them" : "them"} a link after you submit.
        </p>
      )}
    </>
  );
}

// ---------- 5. Payment -----------------------------------------------------

export function StepPay({ flow, set, ctx, tournament, errors, headingRef, cardAvailable, onCopy, copied, notice }: StepProps & {
  cardAvailable: boolean; onCopy: (key: string, value: string) => void; copied: string | null; notice: React.ReactNode;
}) {
  const e = errors?.fields ?? {};
  const cats = selectedCategories(flow, ctx);
  const total = totalFee(flow, ctx);
  const method = cardAvailable ? flow.payment_method : "etransfer";
  const [showNote, setShowNote] = useState(!!flow.comments);
  return (
    <>
      <StepTitle headingRef={headingRef} title="Review and pay" sub="One payment covers every event below." />

      <Panel style={{ padding: "8px 18px" }}>
        {cats.map((c) => {
          const fee = entryFee(flow, c, ctx);
          const mode = partnerMode(flow, c);
          const p = partnerOf(flow, c);
          const detail = !isDoubles(c)
            ? "Singles"
            : mode === "solo"
              ? "Doubles · we'll find your partner"
              : `With ${p.name.trim() || "your partner"}${splitOf(flow, c) === "full" ? " · you pay for both" : ""}`;
          return (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "14px 0", borderBottom: `1px solid ${ss.line}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: ss.bone, fontSize: 16 }}>{c.name}</div>
                <div style={{ color: ss.mute, fontSize: 13.5, marginTop: 3 }}>{detail}</div>
              </div>
              <div style={{ fontFamily: ss.mono, color: ss.bone, fontSize: 15, whiteSpace: "nowrap" }}>{fee === null ? "—" : money(fee)}</div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 0 10px" }}>
          <span style={monoLabel}>Total</span>
          <span style={{ fontFamily: ss.display, fontWeight: 300, fontStretch: "110%", fontSize: 40, color: ss.bone, letterSpacing: "-.01em" }}>
            {total === null ? "—" : money(total)}
          </span>
        </div>
      </Panel>

      {notice}

      {cardAvailable && (
        <div role="radiogroup" aria-label="How would you like to pay?" style={{ display: "grid", gap: 10, margin: "8px 0 18px" }}>
          <div style={{ ...monoLabel, marginBottom: 0 }}>How would you like to pay?</div>
          <ChoiceCard role="radio" checked={method === "etransfer"} onToggle={() => set("payment_method", "etransfer")}>
            <div style={{ fontSize: 16, color: ss.bone }}>Interac e-Transfer</div>
            <div style={{ fontSize: 13.5, color: ss.mute, marginTop: 3 }}>Send it from your bank, then paste the reference number.</div>
          </ChoiceCard>
          <ChoiceCard role="radio" checked={method === "card"} onToggle={() => set("payment_method", "card")}>
            <div style={{ fontSize: 16, color: ss.bone }}>Card, Apple Pay or Google Pay</div>
            <div style={{ fontSize: 13.5, color: ss.mute, marginTop: 3 }}>Same price. Pay on Stripe's secure page; shows as ADAWAR* SHUTTLE STORM.</div>
          </ChoiceCard>
        </div>
      )}

      {method === "etransfer" ? (
        <Panel>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li style={{ display: "flex", gap: 14, marginBottom: 18 }}>
              <StepDot n={1} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: ss.bone, fontSize: 15.5, lineHeight: 1.45 }}>
                  Send {total === null ? "the entry fee" : <strong style={{ fontWeight: 600 }}>{money(total)}</strong>} by Interac e-Transfer to
                </div>
                {tournament.e_transfer_email && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
                    <code style={{ fontFamily: ss.mono, fontSize: 14.5, color: ss.volt, padding: "8px 12px", borderRadius: 10, background: ss.ink2, border: `1px solid ${ss.line}`, wordBreak: "break-all" }}>
                      {tournament.e_transfer_email}
                    </code>
                    <button type="button" className="ss-btn ss-btn-ghost" onClick={() => onCopy("email", tournament.e_transfer_email!)}
                      style={{ minHeight: 38, padding: "0 14px", borderRadius: 999, border: `1px solid ${ss.lineStrong}`, background: "transparent", color: ss.bone, fontFamily: ss.mono, fontSize: 11.5, letterSpacing: ".12em", textTransform: "uppercase", cursor: "pointer" }}>
                      {copied === "email" ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </li>
            <li style={{ display: "flex", gap: 14 }}>
              <StepDot n={2} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Field label="e-Transfer reference number" required error={e.payment_reference} hint="It's in your bank's confirmation, e.g. CAxyzABC.">
                  {(f) => <TextInput {...f} mono type="text" autoCapitalize="characters" autoComplete="off" value={flow.payment_reference} onChange={(ev) => set("payment_reference", ev.target.value)} />}
                </Field>
              </div>
            </li>
          </ol>
        </Panel>
      ) : (
        <Note>You'll pay {total === null ? "" : money(total)} on Stripe's secure checkout next. Your entry goes to the directors once the payment completes, and Stripe emails your receipt.</Note>
      )}

      <div style={{ height: 18 }} />
      <Field label="How did you hear about us?" optional>
        {(f) => (
          <select {...f} className="ss-input" value={flow.heard_from} onChange={(ev) => set("heard_from", ev.target.value)} style={{ ...inputStyle }}>
            <option value="">Choose one</option>
            {HEARD_FROM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </Field>
      {showNote ? (
        <Field label="Note for the directors" optional error={e.comments} hint={`${flow.comments.length}/500`}>
          {(f) => (
            <textarea {...f} className="ss-input" rows={3} value={flow.comments} onChange={(ev) => set("comments", ev.target.value.slice(0, 500))}
              style={{ ...inputStyle, padding: "14px 16px", minHeight: 96, resize: "vertical", lineHeight: 1.5 }} />
          )}
        </Field>
      ) : (
        <button type="button" onClick={() => setShowNote(true)} className="ss-link"
          style={{ font: "inherit", fontSize: 15, color: ss.body, background: "none", border: 0, padding: "4px 0", cursor: "pointer", marginBottom: 18 }}>
          + Add a note for the directors
        </button>
      )}
      {tournament.terms_text && (
        <details style={{ marginTop: 6, borderTop: `1px solid ${ss.line}`, paddingTop: 14 }}>
          <summary style={{ ...monoLabel, cursor: "pointer", listStylePosition: "outside" }}>Entry terms</summary>
          <div style={{ marginTop: 12, color: ss.mute, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{tournament.terms_text}</div>
        </details>
      )}
    </>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span aria-hidden="true" style={{
      flex: "0 0 auto", width: 26, height: 26, borderRadius: 26, display: "grid", placeItems: "center",
      border: `1px solid ${ss.volt}`, color: ss.volt, fontFamily: ss.mono, fontSize: 12, marginTop: 1,
    }}>{n}</span>
  );
}

