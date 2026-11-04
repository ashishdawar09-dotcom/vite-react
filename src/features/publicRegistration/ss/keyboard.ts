// Phone keyboards and the registration form.
//
// While someone types on a touch screen, the bar pinned to the bottom of the
// screen steps aside: with the keyboard up, iOS and Android either lay it over
// the field being typed in or leave it behind the keyboard, where it jumps as
// the page scrolls. The step's buttons show under the form instead, and the
// field being typed in is kept clear of the keyboard.

import { useEffect, useState } from "react";

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "hidden", "color", "image"]);

export function isTextField(el: Element | null | EventTarget): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}

const touchScreen = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// True while a text field has focus on a touch screen, i.e. while the
// on-screen keyboard (or the select picker) is up or on its way.
export function useTypingOnTouch(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!touchScreen()) return;
    let timer: number | undefined;
    const onIn = (e: FocusEvent) => {
      if (!isTextField(e.target)) return;
      window.clearTimeout(timer);
      setTyping(true);
    };
    // Going from one field to the next blurs the first before focusing the
    // second: wait a beat so the bar doesn't flash back in between.
    const onOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTyping(isTextField(document.activeElement)), 150);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

// Keeps the focused field, with its label and message, in the part of the
// screen the keyboard leaves visible. Browsers bring a focused field into view
// themselves but often leave it pressed against the keyboard's edge.
export function useKeepFieldInView(): void {
  useEffect(() => {
    if (!touchScreen()) return;
    const vv = window.visualViewport;
    let timer: number | undefined;
    const adjust = () => {
      const el = document.activeElement;
      if (!isTextField(el) || el instanceof HTMLSelectElement) return;
      const box = (el.closest("[data-field]") as HTMLElement | null) ?? (el as HTMLElement);
      const r = box.getBoundingClientRect();
      // The visible part of the page, in the same coordinates as the rect.
      const top = vv ? vv.offsetTop : 0;
      const height = vv ? vv.height : window.innerHeight;
      if (r.top >= top + 48 && r.bottom <= top + height - 16) return;
      // Put the label in the upper part of what's visible.
      const delta = r.top - (top + Math.min(height * 0.22, 110));
      window.scrollBy({ top: delta, behavior: "smooth" });
    };
    const later = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(adjust, ms);
    };
    // After focus, once the keyboard has slid up; and whenever the visible
    // area changes size (keyboard opening, closing or changing height).
    const onFocus = (e: FocusEvent) => { if (isTextField(e.target)) later(320); };
    const onResize = () => later(90);
    document.addEventListener("focusin", onFocus);
    vv?.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocus);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);
}
