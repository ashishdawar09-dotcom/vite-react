# Motion graphics (Remotion)

Short promo clips for Shuttle Storm, built with [Remotion](https://remotion.dev) and the
[Remotion motion-graphics skills](https://github.com/Liamrjohnston/remotion-motion-graphics-skill)
(MIT), which live in `../.claude/skills/` so Claude Code picks them up automatically in this repo.

## Clips

| Composition | Format | Length | What it shows |
| --- | --- | --- | --- |
| `ShuttleStormPromo` | 9:16, 1080×1920 | 9 s | Marketing: the camera travels down the real home page (date, "Eleven categories. Juniors to masters.", 11 / 8 / 50+ / $30–40), ending on the site film's lockup and "Entries close Nov 18". |
| `ShuttleStormSponsors` | 9:16, 1080×1920 | 9 s | Sponsors: the page's thank-you, ADW and the six supporters' real logo tiles converging into one wall, then the page's own "Back the storm." ask with the club phone number. |
| `ShuttleStormPlayers` | 9:16, 1080×1920 | 10 s | Players: feather shuttles and great prizes (organisers' claims) with the site's "16 feathers" fact, the register page's real five-step day, then 11 categories, ages 8 to 50+, entries close Nov 18. |
| `ShuttleStormWebsite` | 16:9, 1920×1080 | 15 s | Website film for the home page's "Watch the storm" slot: four real pages, each beside its fact, ending on the site film's end card. |
| `ShuttleStormRegister` | 9:16, 1080×1920 | 7 s | A tap on **Categories** in the site's real phone menu reveals the eleven categories as a wall, with "Entries close … November 18, 2026". Warm-light background. |

The four newer clips use the clean-dark background (the site's own colours). Shared pieces
(fonts, colours, camera, screenshot crops, underlines, lockup) are in `src/shuttle/shared.tsx`.

All surfaces are real screenshots of `../shuttlestorm-site/public` (taken at 430 px phone width, 3x)
in `public/research/`, and overlay positions are measured from those pages into
`public/research/measurements.json` by `npm run capture-site`. If the site's copy
changes, retake the screenshots before re-rendering so the video never shows stale dates or fees.

## Commands

```bash
npm ci
npm run dev       # Remotion Studio preview
npm run render    # writes out/shuttle-storm-register-9x16.mp4
npm run render:all  # renders every clip to out/<CompositionId>.mp4
npm run capture-site  # retakes the site screenshots and measurements
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
render 8/10 or better in every category before it is delivered. The research and review trail is kept in `.promptible/` (first clip) and `briefs/<clip>/.promptible/`.

Remotion is free for individuals and teams of up to 3; larger companies need a
[company license](https://www.remotion.pro/license).
