# Motion graphics (Remotion)

Short promo clips for Shuttle Storm, built with [Remotion](https://remotion.dev) and the
[Remotion motion-graphics skills](https://github.com/Liamrjohnston/remotion-motion-graphics-skill)
(MIT), which live in `../.claude/skills/` so Claude Code picks them up automatically in this repo.

## Clips

| Composition | Format | Length | What it shows |
| --- | --- | --- | --- |
| `ShuttleStormRegister` | 9:16, 1080×1920 | 7 s | A tap on **Categories** in the site's real phone menu opens the categories page; the eleven rows are marked, lift out into a grouped wall (Juniors, Youth, Adults, Masters), and the register page's "Entries close … November 18, 2026" line lands underneath. Warm-light background. |

All surfaces are real screenshots of `../shuttlestorm-site/public` (taken at 430 px phone width, 3x)
in `public/research/`, and overlay positions are measured from those pages. If the site's copy
changes, retake the screenshots before re-rendering so the video never shows stale dates or fees.

## Commands

```bash
npm ci
npm run dev       # Remotion Studio preview
npm run render    # writes out/shuttle-storm-register-9x16.mp4
npm run lint      # eslint + tsc
```

Fonts (Archivo, JetBrains Mono — the site's own typefaces, OFL) are bundled in `public/fonts/`,
so renders work offline.

## Making a new clip with Claude Code

Open Claude Code in this repo and ask, for example:

> Build a 6-second 9:16 clip for Shuttle Storm: the venue is UFV North Gym, Saturday Nov 21.
> Use the motion-graphics and cinematic-camera skills.

The `motion-graphics` skill asks for format (4:3 or 9:16) and background (warm light, clean dark,
light grid, dark grid) if you don't say, researches real assets, and runs its gate script
(`.claude/skills/motion-graphics/scripts/promptible-gate.mjs`). A separate critic must score the
render 8/10 or better in every category before it is delivered. The research and review trail for
each clip is kept in `.promptible/`.

Remotion is free for individuals and teams of up to 3; larger companies need a
[company license](https://www.remotion.pro/license).
