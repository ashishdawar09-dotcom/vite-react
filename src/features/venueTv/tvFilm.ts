// The Shuttle Storm '26 film (rules, official shuttle, founders, sponsors).
// An admin switches it on from the TV tab before play starts or in a break;
// every TV then plays it full screen on a loop until it's switched off. It sits
// outside the 1920x1080 stage, so a design redraw never touches it, and the
// engine stops it at once for anything live: a court call, a match point or a
// full-screen desk post.

// ?v= changes with each new cut so TVs never replay a cached older film (images are cached for a day).
export const FILM_SRC = "/images/tv/shuttlestorm-tv-launch.mp4?v=founders";
const FADE_MS = 600;

export type TvFilm = {
  /** Loaded far enough to play straight through. */
  ready(): boolean;
  playing(): boolean;
  /** Starts the film on a loop; onDone runs once when it's stopped. False if it can't play now. */
  play(onDone: () => void): boolean;
  stop(): void;
  destroy(): void;
};

/** Every TV can play it when switched on, unless its link says ?film=0. */
export function filmAllowed(search: string): boolean {
  return new URLSearchParams(search).get("film") !== "0";
}

export function createTvFilm(host: HTMLElement, src: string, instant: () => boolean): TvFilm {
  const wrap = document.createElement("div");
  wrap.className = "tvs-film";
  wrap.setAttribute("aria-hidden", "true");
  const video = document.createElement("video");
  video.src = src;
  video.preload = "auto";
  video.playsInline = true;
  video.disablePictureInPicture = true;
  wrap.appendChild(video);
  host.appendChild(wrap);

  video.loop = true;
  let failed = false, on = false, done: (() => void) | null = null;
  video.addEventListener("error", () => { failed = true; if (on) stop(); });

  function finish() {
    const cb = done; done = null;
    if (cb) cb();
  }
  function stop() {
    if (!on) return;
    on = false;
    wrap.classList.remove("on");
    const end = () => { video.pause(); finish(); };
    if (instant()) end(); else window.setTimeout(end, FADE_MS);
  }

  return {
    ready: () => !failed && video.readyState >= 3,
    playing: () => on,
    play(onDone) {
      if (on || failed || video.readyState < 3) return false;
      on = true; done = onDone;
      video.currentTime = 0;
      video.muted = false;
      // Sound needs a click on the page first (the full screen click); without one, play muted.
      video.play().catch(() => { video.muted = true; return video.play(); }).catch(() => { failed = true; stop(); });
      wrap.classList.add("on");
      return true;
    },
    stop,
    destroy() {
      on = false; done = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      wrap.remove();
    },
  };
}
