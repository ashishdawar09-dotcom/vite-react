// Shown instead of the form once every entry is taken: a thank you, the
// waitlist (name, mobile number, email, the event they'd like) and how to
// reach the organizers.
// One primary action, the waitlist; everything else supports it.
//
// Once a director closes the waitlist (capacity.waitlistOpen is false) the
// page says sorry, fully booked: no waitlist form, buttons or steps, and
// nothing that promises a spot.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { joinRegistrationWaitlist } from "../../lib/db";
import { PRIVACY_URL, isTestEmail, trackEvent } from "../../lib/analytics";
import { captureError } from "../../lib/sentry";
import { formatClubNumber, waLink } from "../../lib/whatsapp";
import type { Category, Tournament } from "../../types";
import { type Capacity } from "./capacity";
import { eventWhen, parseContacts, phoneHref, taglineText, waitlistErrors, type WaitlistErrors, type WaitlistForm } from "./atCapacity";
import { Net } from "./SpotsMeter";
import { Button, Field, Note, TextInput } from "./ss/parts";
import { IconArrowRight, IconChat, IconCheck, IconEnvelope, IconFacebook, IconInstagram, IconMapPin, IconPhone } from "./ss/icons";
import { ease, radius, space, type } from "./ss/scale";
import { inputStyle, ss } from "./ss/theme";

export type Socials = { instagram?: string; facebook?: string };

const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 15);

// Sections below the first screen rise into place once as they scroll in.
function Reveal({ children, id, labelledBy }: { children: React.ReactNode; id?: string; labelledBy?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      id={id}
      aria-labelledby={labelledBy}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: space[400] }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.7, ease }}
      style={{ marginTop: space[700], scrollMarginTop: space[400] }}
    >
      {children}
    </motion.section>
  );
}

// The big line: each word lights up in turn as it scrolls past the middle of
// the screen. One scroll listener, throttled to animation frames.
function TaglineReveal({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const words = useMemo(() => text.split(/\s+/), [text]);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.8 - r.top) / (r.height + vh * 0.3)));
      setLit(Math.ceil(p * words.length));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduce, words.length]);
  return (
    <section aria-label="Thank you" style={{ marginTop: space[800] }}>
      <p ref={ref} className="ss-h-tagline ss-balance" style={{ margin: 0, maxWidth: 680, color: ss.bone }}>
        {words.map((w, i) => (
          <span key={i} style={{
            opacity: reduce || i < lit ? 1 : 0.3,
            transition: "opacity .5s cubic-bezier(.22, 1, .36, 1)",
          }}>{w}{i < words.length - 1 ? " " : ""}</span>
        ))}
      </p>
    </section>
  );
}

function Picture({ name, alt, width, height, eager = false }: { name: string; alt: string; width: number; height: number; eager?: boolean }) {
  return (
    <picture>
      <source type="image/webp" srcSet={`/shuttlestorm/${name}.webp`} />
      <img
        src={`/shuttlestorm/${name}.gif`} alt={alt} width={width} height={height}
        loading={eager ? "eager" : "lazy"} decoding="async"
        style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${width} / ${height}` }}
      />
    </picture>
  );
}

function WaitlistDone({ name, email, already, onEdit }: { name: string; email: string; already: boolean; onEdit: () => void }) {
  const first = name.trim().split(/\s+/)[0];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: false }); }, []);
  return (
    <div ref={ref} tabIndex={-1} role="status" style={{
      outline: "none", padding: space[300], borderRadius: radius["3xl"], background: ss.panel,
      border: `1px solid rgba(212, 255, 58, .5)`,
    }}>
      <span aria-hidden="true" style={{
        width: 48, height: 48, borderRadius: 48, display: "grid", placeItems: "center", background: ss.volt, color: ss.ink,
      }}>
        <IconCheck size={24} />
      </span>
      <h3 className="ss-balance" style={{ ...type.heading5, margin: `${space[200]}px 0 0`, color: ss.bone }}>
        {already ? "You're already on the waitlist" : `You're on the waitlist${first ? `, ${first}` : ""}`}
      </h3>
      <p className="ss-pretty" style={{ ...type.body3, margin: `${space[75]}px 0 0`, color: ss.body }}>
        {already
          ? "We've updated your details. If a spot opens up, the organizers will contact you."
          : "The organizers have your name, number, email and event. If a spot opens up, they'll contact you."}
        {" "}We'll use <span style={{ color: ss.bone }}>{email}</span>.
      </p>
      <button type="button" onClick={onEdit} className="ss-quiet-link" style={{
        ...type.body5, marginTop: space[200], padding: 0, minHeight: 44, background: "none", border: 0, cursor: "pointer",
      }}>
        Change my details
      </button>
    </div>
  );
}

export function FullHouse({ tournament, capacity, categories, prefill, socials }: {
  tournament: Tournament;
  capacity: Capacity;
  // Every event, for the waitlist's "which event" dropdown.
  categories: Category[];
  // Details already typed into the form on this device, if any.
  prefill?: Partial<WaitlistForm>;
  socials?: Socials;
}) {
  const reduce = useReducedMotion();
  const nameId = useId();
  const [form, setForm] = useState<WaitlistForm>({
    name: prefill?.name ?? "", phone: digitsOnly(prefill?.phone ?? ""), email: prefill?.email ?? "",
    category_id: prefill?.category_id && categories.some((c) => c.id === prefill.category_id) ? prefill.category_id : "",
  });
  const events = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order), [categories]);
  const [errors, setErrors] = useState<WaitlistErrors>({});
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done" | "already">("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  // Honeypot: hidden from people; bots that fill it are dropped server-side.
  const [website, setWebsite] = useState("");

  const waitlistOpen = capacity.waitlistOpen;
  const { heading: contactHeading, people } = parseContacts(tournament.contact_info);
  const chat = tournament.whatsapp_number
    ? waLink(tournament.whatsapp_number, waitlistOpen
      ? `Hi Shuttle Storm! Entries for ${tournament.name} are full. I'd like a spot if one opens up.`
      : `Hi Shuttle Storm! I have a question about ${tournament.name}.`)
    : null;
  const when = eventWhen(tournament);
  const venue = tournament.venue_name?.replace(/\s*–\s*/, " ").trim() ?? null;
  const joined = state === "done" || state === "already";

  const set = (k: keyof WaitlistForm, v: string) => {
    const next = { ...form, [k]: v };
    setForm(next);
    if (shown) setErrors(waitlistErrors(next));
    setServerError(null);
  };

  const goToCheer = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("cheer")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const focusWaitlist = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("waitlist")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => document.getElementById(nameId)?.focus({ preventScroll: true }), reduce ? 0 : 500);
  };

  const submit = async () => {
    if (state === "sending") return;
    const errs = waitlistErrors(form);
    setShown(true);
    setErrors(errs);
    if (Object.keys(errs).length) {
      // After React has marked the fields invalid, so the first one is found.
      window.setTimeout(() => document.querySelector<HTMLElement>("#waitlist [aria-invalid='true']")?.focus(), 0);
      return;
    }
    setState("sending");
    setServerError(null);
    const res = await joinRegistrationWaitlist({
      tournament_id: tournament.id, name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone,
      category_id: form.category_id, website,
    });
    if (res.success) {
      setState(res.already ? "already" : "done");
      if (!isTestEmail(form.email)) trackEvent("waitlist_join", { tournament_id: tournament.id });
      return;
    }
    setState("idle");
    setServerError(
      res.status === 429
        ? "Too many tries from this network. Wait a few minutes and try again, or call the organizers below."
        : res.status === 400 && res.error
          ? res.error
          : "We couldn't add you to the waitlist. Check your connection and try again, or call the organizers below.",
    );
    if (res.status === undefined || res.status >= 500) {
      captureError(new Error(`Waitlist join failed: ${res.status ?? "no response"}`), { status: res.status ?? null });
    }
  };

  return (
    <main>
      {/* ---------- First screen: the graphic, the thank you, the action ---------- */}
      <section aria-labelledby="ss-full-title" style={{ paddingTop: space[100] }}>
        <motion.figure
          initial={reduce ? false : { opacity: 0, y: space[300] }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          style={{
            position: "relative", margin: 0, borderRadius: radius["3xl"], overflow: "hidden",
            border: `1px solid ${ss.line}`, background: ss.panel,
          }}
        >
          <Picture name="hero" width={600} height={400} eager
            alt={`${tournament.name}: the court under the lights, with a shuttle dropping onto the net.`} />
          {/* The stamp: entries are full. */}
          <motion.div
            aria-hidden="true"
            initial={reduce ? false : { opacity: 0, scale: 1.25, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            transition={{ duration: 0.5, ease, delay: reduce ? 0 : 0.6 }}
            style={{
              position: "absolute", right: space[200], bottom: space[600], display: "flex", alignItems: "baseline", gap: space[75],
              padding: `${space[75]}px ${space[100]}px`, borderRadius: radius.md, background: ss.volt, color: ss.ink,
              boxShadow: "0 12px 24px -12px rgba(0, 0, 0, .8)",
            }}
          >
            <span style={{ ...type.buttonSm }}>Full house</span>
            <span style={{ ...type.countCaption, fontWeight: 500 }}>{capacity.cap}/{capacity.cap}</span>
          </motion.div>
        </motion.figure>

        <h1 id="ss-full-title" className="ss-h-hero ss-h-hero-long ss-hero-text ss-balance" style={{ margin: `${space[400]}px 0 0`, maxWidth: 680, fontFamily: ss.display }}>
          {waitlistOpen ? <>Thank you.<br />We're at full capacity.</> : <>We're really sorry.<br />We're fully booked.</>}
        </h1>
        {waitlistOpen ? (
          <p className="ss-pretty" style={{ ...type.body3, margin: `${space[200]}px 0 0`, maxWidth: 680, color: ss.body }}>
            All {capacity.cap} entries for {tournament.name} are taken, so the entry form is now closed.
            Join the waitlist and we'll contact you if a spot opens up.
          </p>
        ) : (
          <p data-testid="waitlist-closed" className="ss-pretty" style={{ ...type.body3, margin: `${space[200]}px 0 0`, maxWidth: 680, color: ss.body }}>
            Every entry for {tournament.name} is taken, and the waitlist is now closed.
            We can't take any more players for this tournament. Thank you for wanting to play.
          </p>
        )}

        {waitlistOpen && !joined && (
          <a href="#waitlist" onClick={focusWaitlist} className="ss-action ss-action-primary" style={{ ...type.buttonMd, marginTop: space[300], width: "100%" }}>
            Join the waitlist <IconArrowRight size={20} />
          </a>
        )}
        {!waitlistOpen && (
          <a href="#cheer" onClick={goToCheer} className="ss-action" style={{ ...type.buttonMd, marginTop: space[300], width: "100%" }}>
            Come and cheer on the day <IconArrowRight size={20} />
          </a>
        )}

        <div style={{ marginTop: space[300] }}>
          <Net cap={capacity.cap} taken={capacity.cap} height={20} filled />
          <p style={{ ...type.countCaption, margin: `${space[75]}px 0 0`, color: ss.mute }}>
            {capacity.cap} of {capacity.cap} entries taken
          </p>
        </div>
      </section>

      {/* ---------- The waitlist ---------- */}
      {waitlistOpen && <Reveal id="waitlist" labelledBy="ss-waitlist-title">
        <h2 id="ss-waitlist-title" className="ss-h-section ss-balance" style={{ margin: 0, color: ss.bone }}>Join the waitlist</h2>
        <p className="ss-pretty" style={{ ...type.body3, margin: `${space[75]}px 0 ${space[300]}px`, color: ss.body, maxWidth: 680 }}>
          Players sometimes withdraw before tournament day. Leave your details and the organizers will contact you if a spot opens up.
        </p>

        {joined ? (
          <WaitlistDone name={form.name} email={form.email.trim().toLowerCase()} already={state === "already"} onEdit={() => setState("idle")} />
        ) : (
          <form
            noValidate
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            style={{ padding: space[300], borderRadius: radius["3xl"], background: ss.panel, border: `1px solid ${ss.line}` }}
          >
            <div aria-hidden="true" style={{ position: "absolute", left: -10000, top: "auto", width: 1, height: 1, overflow: "hidden" }}>
              <label>
                Website (leave blank)
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            <Field label="Full name" required error={errors.name} id={nameId}>
              {(p) => <TextInput {...p} type="text" autoComplete="name" enterKeyHint="next" value={form.name} onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="Mobile number" required error={errors.phone} hint="Numbers only, for example 6041234567.">
              {(p) => <TextInput {...p} type="tel" inputMode="numeric" autoComplete="tel" enterKeyHint="next" value={form.phone} onChange={(e) => set("phone", digitsOnly(e.target.value))} />}
            </Field>
            <Field label="Email" required error={errors.email}>
              {(p) => <TextInput {...p} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} enterKeyHint="next" value={form.email} onChange={(e) => set("email", e.target.value)} />}
            </Field>
            <Field label="Which event would you like to play?" required error={errors.category_id}
              hint="Pick the one you'd most like. Tell the organizers about any others when they contact you.">
              {(p) => (
                <select {...p} name="category" className="ss-input" value={form.category_id} onChange={(e) => set("category_id", e.target.value)} style={{ ...inputStyle }}>
                  <option value="">Choose an event</option>
                  {events.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Field>
            {serverError && <div style={{ marginBottom: space[200] }}><Note tone="danger">{serverError}</Note></div>}
            <Button type="submit" disabled={state === "sending"} style={{ width: "100%" }}>
              {state === "sending" ? "Adding you to the waitlist…" : <>Join the waitlist <IconArrowRight size={20} /></>}
            </Button>
            <p className="ss-pretty" style={{ ...type.caption5, margin: `${space[200]}px 0 0`, color: ss.mute }}>
              We only use these details to contact you about a spot.{" "}
              <a className="ss-quiet-link" href={PRIVACY_URL} target="_blank" rel="noopener">Privacy policy</a>
            </p>
          </form>
        )}

        <ol style={{ listStyle: "none", padding: 0, margin: `${space[400]}px 0 0`, display: "grid", gap: space[300] }}>
          {[
            ["You join the waitlist", "Your name, number, email and event go straight to the tournament directors."],
            ["A spot opens up", "When a player withdraws, their spot in that event comes free."],
            ["We contact you", "By phone, text or email, using the details you leave here."],
          ].map(([title, body], i) => (
            <li key={title} style={{ display: "flex", gap: space[200], alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{
                ...type.countBody, width: 32, height: 32, borderRadius: radius.lg, flex: "0 0 auto",
                display: "grid", placeItems: "center", background: ss.ink2, color: ss.volt, border: `1px solid ${ss.line}`,
              }}>{i + 1}</span>
              <span>
                <span style={{ ...type.title3, display: "block", color: ss.bone }}>{title}</span>
                <span className="ss-pretty" style={{ ...type.body6, display: "block", marginTop: space[25], color: ss.mute }}>{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Reveal>}

      <TaglineReveal text={taglineText(tournament, capacity.cap, categories.length)} />

      {/* ---------- The organizers ---------- */}
      {(people.length > 0 || chat) && (
        <Reveal id="organizers" labelledBy="ss-organizers-title">
          <h2 id="ss-organizers-title" className="ss-h-section ss-balance" style={{ margin: 0, color: ss.bone }}>Talk to the organizers</h2>
          <p className="ss-pretty" style={{ ...type.body3, margin: `${space[75]}px 0 ${space[300]}px`, color: ss.body, maxWidth: 680 }}>
            {waitlistOpen
              ? "Questions about the waitlist or your entry, or a partner who has already entered? Call, text or email us."
              : "A question about your entry, or a partner who has already entered and is waiting for you? Call, text or email us."}
          </p>
          <div style={{ display: "grid", gap: space[200] }}>
            {people.map((p) => (
              <div key={p.name} style={{ padding: space[300], borderRadius: radius["3xl"], background: ss.panel, border: `1px solid ${ss.line}` }}>
                <div style={{ ...type.title2, color: ss.bone }}>{p.name}</div>
                {contactHeading && <div style={{ ...type.caption5, color: ss.mute, marginTop: space[25] }}>{contactHeading.replace(/s$/i, "")}</div>}
                {p.phone && <div style={{ ...type.countBody, color: ss.body, marginTop: space[100] }}>{p.phone}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: space[75], marginTop: space[200] }}>
                  {p.phone && <a className="ss-action" href={phoneHref("tel", p.phone)}><IconPhone size={18} /> Call</a>}
                  {p.phone && <a className="ss-action" href={phoneHref("sms", p.phone)}><IconChat size={18} /> Text</a>}
                  {p.email && <a className="ss-action" href={`mailto:${p.email}?subject=${encodeURIComponent(waitlistOpen ? `${tournament.name} waitlist` : tournament.name)}`}><IconEnvelope size={18} /> Email</a>}
                </div>
              </div>
            ))}
            {chat && tournament.whatsapp_number && (
              <a className="ss-action" href={chat} target="_blank" rel="noopener noreferrer" style={{ justifyContent: "flex-start", padding: space[200], minHeight: 64 }}
                onClick={() => trackEvent("whatsapp_chat", { action: "start", where: "full_house" })}>
                <IconChat size={20} />
                <span>
                  <span style={{ display: "block" }}>Message us on WhatsApp</span>
                  <span style={{ ...type.caption5, display: "block", color: ss.mute, fontWeight: 400 }}>{formatClubNumber(tournament.whatsapp_number)}</span>
                </span>
              </a>
            )}
          </div>
        </Reveal>
      )}

      {/* ---------- Questions ---------- */}
      <Reveal labelledBy="ss-faq-title">
        <h2 id="ss-faq-title" className="ss-h-section ss-balance" style={{ margin: 0, color: ss.bone }}>Questions</h2>
        <dl style={{ margin: `${space[300]}px 0 0`, display: "grid", gap: space[300] }}>
          {(waitlistOpen ? [
            ["My partner already entered and is waiting for me. Can I still play?",
              "Yes. Your spot was counted when your partner entered. Call or message the organizers and they'll add you."],
            ["Does joining the waitlist cost anything?",
              "No. You only pay if a spot opens up and you take it."],
            ["Can I choose my events?",
              "Yes. Pick the event you'd most like on the waitlist form, and tell the organizers about any others when they contact you."],
            ["How will I hear if a spot opens up?",
              "The organizers will call, text or email you, using the details you leave on the waitlist."],
          ] : [
            ["Can I still get a spot?",
              "We're sorry, no. Every entry is taken and the waitlist is closed, so we can't add more players to this tournament."],
            ["My partner already entered and is waiting for me. Can I still play?",
              "Yes. Your spot was counted when your partner entered. Call or message the organizers and they'll add you."],
          ]).map(([q, a]) => (
            <div key={q}>
              <dt className="ss-balance" style={{ ...type.title3, color: ss.bone }}>{q}</dt>
              <dd className="ss-pretty" style={{ ...type.body6, margin: `${space[50]}px 0 0`, color: ss.mute }}>{a}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {/* ---------- Come and cheer ---------- */}
      <Reveal id="cheer" labelledBy="ss-cheer-title">
        <div style={{ borderRadius: radius["3xl"], overflow: "hidden", border: `1px solid ${ss.line}`, background: ss.panel }}>
          <Picture name="podium" width={536} height={268} alt="A trophy on a lit podium, with shuttles falling like confetti." />
          <div style={{ padding: space[300] }}>
            <h2 id="ss-cheer-title" className="ss-h-section ss-balance" style={{ margin: 0, color: ss.bone }}>Come and cheer</h2>
            <p className="ss-pretty" style={{ ...type.body3, margin: `${space[75]}px 0 0`, color: ss.body }}>
              {when && venue ? <>{when} at {venue}. </> : null}
              Follow Shuttle Storm for the draw and the results.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: space[75], marginTop: space[200] }}>
              {tournament.venue_map_url && (
                <a className="ss-action" href={tournament.venue_map_url} target="_blank" rel="noopener noreferrer"><IconMapPin size={18} /> Directions</a>
              )}
              {socials?.instagram && <a className="ss-action" href={socials.instagram} target="_blank" rel="noopener noreferrer"><IconInstagram size={18} /> Instagram</a>}
              {socials?.facebook && <a className="ss-action" href={socials.facebook} target="_blank" rel="noopener noreferrer"><IconFacebook size={18} /> Facebook</a>}
            </div>
          </div>
        </div>
        {waitlistOpen && !joined && (
          <a href="#waitlist" onClick={focusWaitlist} className="ss-action ss-action-primary" style={{ ...type.buttonMd, marginTop: space[300], width: "100%" }}>
            Join the waitlist <IconArrowRight size={20} />
          </a>
        )}
      </Reveal>

      <footer style={{ marginTop: space[700], display: "flex", flexWrap: "wrap", gap: `${space[100]}px ${space[300]}px`, ...type.caption2, color: ss.mute }}>
        <a className="ss-quiet-link" href="https://shuttlestorm.adawar.org/">Back to shuttlestorm.adawar.org</a>
        <a className="ss-quiet-link" href={PRIVACY_URL} target="_blank" rel="noopener">Privacy policy</a>
        {tournament.rules_url && <a className="ss-quiet-link" href={tournament.rules_url} target="_blank" rel="noopener">Rules</a>}
      </footer>
    </main>
  );
}
