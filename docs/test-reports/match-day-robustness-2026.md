# Match-day robustness test: Shuttle Storm '26

Tested 2026-10-25 against `origin/main` at `c3fc542` (PR #49 merged), running locally on the **scratch** Supabase project `aabsbcvzknsdbirrmlfr`. Nothing was written to production.

## How it was run

- **Tournament:** "Robustness Cup" (slug `robustness`), seeded with `scripts/robustness/seed.sql`.
  - The 10 real categories, 4 courts, 73 synthetic players, 29 doubles teams.
  - Team counts per category: Men's Singles 9 (3 groups of 3, so a bye), Men's Doubles 18–34 5 (odd), Men's Doubles 35+ 4, Women's Doubles 18–34 3, Women's Doubles 35+ 2, Mixed Doubles 18–34 8 (bronze on), Mixed Doubles 35+ 4 (top 2 → final), Super Doubles 50+ 3, Youth Boys' Singles 5, Youth Girls' Singles 3.
  - Two players are in two categories each, to trigger player-conflict warnings.
  - Men's Doubles 35+ and Youth Boys' Singles use a 1-minute clock, so time-over actions could be reached.
  - A later 11th category, "Edge Cat" (4 teams), was used for the network-failure tests.
- **How the UI was driven:** everything ran through the real admin UI (`npm run dev`, `badminton-rehearsal`-style launch entry on port 5186).
  - Browsers: two in-app browser tabs (admin A and admin B, same account) and a Playwright browser for long runs and network faults (offline, 3 s latency, dropped requests).
  - Button clicks were scripted in the page with `scripts/robustness/ui-helpers.js`, so they call the app's own handlers. `window.confirm` was stubbed so every prompt's text could be logged.
  - The bug on line 4 of the table was reproduced with real keystrokes and mouse clicks.
- **Coverage:** every category except Women's Doubles 35+ (see blocker 5) went from group stage to a champion.
  - Both the category view and the "All" view were used, and both the Groups/Knockout match cards and the Matches tab.
  - The results were checked in the DB and on `/t/robustness/results`.
- **Cleanup:** duplicate rows created by the bugs below were deleted from the scratch DB by hand so testing could continue. The two match results wiped by blocker 3 were restored from `match_audit_log`.

## Summary

| # | Issue | Severity |
|---|---|---|
| 1 | Start Group Stage can create a second full round robin | **Blocks race day** |
| 2 | Two admins tapping Start Knockout create two brackets | **Blocks race day** |
| 3 | "+ Select Team" silently wipes confirmed results, including the Final | **Blocks race day** |
| 4 | Typing a score and tapping Confirm records the wrong winner | **Blocks race day** |
| 5 | A category with exactly 2 teams can't be started | **Blocks race day** (if any category has 2 entries) |
| 6 | One failed refresh blanks every match on the admin screen | **Blocks race day** |
| 7 | Same court can be given to two matches | Workaround exists |
| 8 | Matches-tab player-conflict warning disappears in under 0.2 s | Workaround exists |
| 9 | Fast +/− taps lose points | Workaround exists |
| 10 | Typed score lost when the card refreshes | Workaround exists |
| 11 | Edit Score → Cancel leaves the scores changed and the winner unchanged | Workaround exists |
| 12 | Reschedule leaves a court-less "warming up" match; Begin Scoring puts it live on "Court ?" | Workaround exists |
| 13 | Public standings merge all categories into one "Group A" | Workaround exists |
| 14 | Admin actions fail silently when offline | Workaround exists |
| 15 | Network drop during Start Knockout leaves the category stuck in "group" | Workaround exists |
| 16 | 3 qualifiers + bronze on: bronze match can never be played | Workaround exists |
| 17 | "All" view Knockout tab shows one category's champion for the whole event | Workaround exists |
| 18 | Cancelled match shows "W/O" and counts as a loss on the Scoreboard | Workaround exists |
| 19 | Upcoming/Next lists only show the first categories | Workaround exists |
| 20–27 | Cosmetic items (see the end) | Cosmetic |

---

## Blocks race day

### 1. Start Group Stage can create a second full round robin
**Steps:**
- **(a) Repeated taps:** Teams tab, Men's Doubles 18–34 (5 teams), tap **📊 Start Group Stage** three times, 100 ms apart.
- **(b) Connection drop:** Edge Cat, the network drops on the `categories` PATCH that sets `phase` (Playwright aborted it). Then tap Start again.

**Result:**
- (a) 20 group matches instead of 10: two complete round robins with different shuffles, inserted 180 ms apart (`created_at` 14:59:56.797 and 14:59:56.979).
- (b) The first tap inserted 6 matches, but phase stayed `none`. There was no error toast, and the Start button was still shown. The second tap made 12 matches.

**Why:** the `startingGroupStage` ref guard is released in `finally` before the phase change reaches the screen. `startGroupStage` never checks whether the category already has group matches; `startKnockout` does. There is no server-side check.

**Evidence:** DB rows for (a) in the scratch DB before cleanup (10 + 10, same pairs). For (b), the `Edge Cat` `gm` count went 6 → 12.

**Fix:**
- Refuse when `matches.some(m => m.category_id === cat && m.stage === "group")`, as Start Knockout does.
- Better: move "insert matches + set phase" into one RPC that locks the category row and fails if matches exist.
- Show a toast when either write fails.

### 2. Two admins tapping Start Knockout at the same time create two brackets
**Steps:** Men's Doubles 35+, groups done. Admin A and admin B both have Groups → Men's Doubles 35+ open and tap **⚔️ Start Knockout** at the same moment.

**Result:**
- Six knockout rows (2 semis + final, twice; `created_at` 15:11:40.440 and .567).
- The Knockout tab shows four semi-finals and two finals, under the banner "8 OF 4 QUALIFIERS PLACED".
- There's no UI to delete a bracket.

**Why:** PR #49's guard is per-browser (a ref, plus a check of that browser's own `matches`).

**Fix:**
- Same RPC approach as #1 (lock the category, check there are no knockout rows, insert, set phase, all in one transaction).
- Or a partial unique index on `matches (category_id, round_idx, slot_idx, is_bronze) where stage = 'knockout'`.

**Interim:** agree that only one named person presses Start Group Stage / Start Knockout.

### 3. "+ Select Team" silently wipes confirmed results, including the Final
**Steps:** Knockout → Men's Singles. The Final (MS P5a 3–1 MS P3a) and the semi (MS P2a 15–21 MS P3a) are confirmed. On the empty side of the 3rd-place card, tap **+ SELECT TEAM** and choose **MS P3a** (the beaten finalist).

**Result:**
- The only prompt was "This team has been eliminated. Place them anyway?". After OK, the confirmed semi-final and the confirmed **Final** were both reset to pending with no scores and P3a removed. The champion vanished.
- Audit log rows 1112 and 1113 show both matches going from `confirmed: true` (15–21, 3–1) to `confirmed: false`.

**Why:** the `PromoteTeamPicker` `onSelect` handler in `App.tsx` clears the chosen team from every other knockout match and resets those matches. It doesn't check whether they are confirmed and doesn't list them in the prompt.

**Fix:**
- Never touch confirmed matches from this picker. Refuse, or list the matches it would reset and ask, the same way `confirmKnockoutPlan` does.
- Clear `started_at`/court fields on anything it does reset (see `RESET_MATCH`).

### 4. Typing a score and tapping Confirm straight away records the wrong winner
**Steps:**
- Groups → Youth Boys' Singles. A live match stands at 15–0, already saved.
- With real keystrokes, select side B's score box, type **21**, then click **✓ Confirm** without pressing Enter.

**Result:** the DB holds `score_a 15, score_b 21, winner YB P3a`. The winner is the side that lost 15–21. There was no warning, and the standings gave P3a the 3 points.

**Why:** the score box saves on blur, without waiting. `confirmInline` works out the winner from the scores already on screen (15–0) and saves only `winner_id`, not the scores it used.

**Fix:**
- Confirm should read the visible box values, and write `score_a`, `score_b` and `winner_id` in one update, ideally through an RPC that checks score ⇒ winner.
- Or disable Confirm while a score box has unsaved text.

**Interim:** tell scorers to press Enter (or tap outside the box) and see the number settle before tapping Confirm. Use Edit Score → Save to fix a wrong winner; that path recalculates the winner correctly (tested).

### 5. A category with exactly 2 teams can't be started
**Steps:** Teams → Women's Doubles 35+ (2 teams). The format card says "✓ RECOMMENDED · Final only · 1 match". Tap **Start Group Stage**.

**Result:** the toast "Too few teams to start a tournament. Add more teams first." appears. `defaultFormat(2)` has `groupsCount: 0`, and `startGroupStage` refuses `groupsCount === 0`. There's no other way in the UI to create the final.

**Fix:** when the plan is "Final only", skip the group stage and insert one knockout match, setting phase to `knockout`.

**Before the day:** check production for categories with 2 entries (I couldn't run the read-only production query from this session). The race-day notes say 14 teams across 10 categories, so this is likely.

### 6. One failed refresh blanks every match on the admin screen
**Steps:**
- Admin on the Matches tab (89 matches; Edge Cat live on Court 1).
- Make the next `GET /rest/v1/matches` fail once (Playwright returned a 400), then change any match so realtime triggers a refetch.

**Result:**
- The Matches tab went from 89 rows to **0**, and Court 1 showed **FREE** while the match was live. There was no message.
- It stays like that until the next change or a reload.
- Knock-on effect: in that state **Sit Out** on EC P1a, who was playing, said "Teams removed (no matches played yet): EC T1", set the player inactive mid-match, and tried to delete the team. Only the server-side `delete_team` refused, with the toast "EC T1: error".

**Why:** `loadMatches`, `loadTeams` and `loadCategories` in `useTournamentData.ts` do `setX(data ?? [])` and ignore `error`.

**Fix:** on error keep the previous data and show a small "Couldn't refresh, retrying" pill, then retry. The same applies to the initial load.

---

## Workaround exists

### 7. The same court can be given to two matches
**Steps:** admins A and B each open the court picker on the Matches tab, for different matches (Mixed Doubles 18–34 XD T4 v T3, and Youth Boys' Singles YB P3a v P1a), and both tap **2**.

**Result:**
- Both rows have `court_number 2` and are warming up.
- The Court Status card shows only the Youth Boys' Singles match on Court 2, so the double booking is invisible.
- Both teams would get "Court 2" notifications.

**Fix:** an `allocate_court` RPC that locks and rejects when another unconfirmed match holds the court. The unused `start_match_on_court` RPC is half of this. Optionally return player conflicts from the same RPC.

### 8. The Matches-tab player-conflict warning disappears in under 0.2 s
**Steps:** MS P1a is warming up on Court 1. Start the Men's Doubles match that includes MS P1a and tap Court 2.

**Result:**
- At +30 ms the picker showed "⚠️ Player conflict: MS P1a is warming up on Court 1. Click "Pick Court" again to override."
- At +230 ms the warning was gone. The next tap allocates anyway, and there's no "Pick Court" button.

**Why:** `MatchesTab.allocateCourt` calls `setTimeout(() => setConflictWarning("confirmed"), 50)`.

**Fix:** keep the warning and require a second tap on the same court, or use `confirm()` like the card picker does.

### 9. Fast +/− taps lose points
**Steps:** a live Men's Singles match on the Matches tab; tap **+** five times at the same pace each time.

**Result (localhost, fast network):**

| Taps | Gap between taps | Points added |
|---|---|---|
| 10 | 30 ms | 1 |
| 5 | 250 ms | 2 |
| 5 | 500 ms | 4 |
| 5 | 1 s | 5 |

Two people scoring the same match will overwrite each other the same way.

**Fix:** an `increment_score(match_id, side, delta)` RPC, plus an optimistic local count.

### 10. A typed score is lost when the card refreshes
**Steps:** Groups tab, live match. Click side B's score box, type **10**, and don't press Enter. Wait about 15 s.

**Result:** focus is gone, the box shows 0 again, and the DB is unchanged. Every element ref on the Groups/Knockout tabs went stale within about a second, so the cards are being remounted. This also made my own scripted entries fail occasionally: one match was confirmed with side A blank and saved as `null–18`.

**Why:** `const MatchCard = (...) => <ExtractedMatchCard …/>` is declared inside `App`'s render, so every App render creates a new component type.

**Fix:** hoist the wrapper out of `App` (or pass a stable render function) so cards keep their state.

### 11. Edit Score → Cancel leaves the scores changed and the winner unchanged
**Steps:**
- **Group stage:** Youth Boys' Singles (15–21, P1a won). **✏️ Edit Score**, tap **+** on P3a 7 times (22–21), then **Cancel**.
- **Knockout:** Mixed Doubles 18–34 SF2 (XD T3 1–2 XD T2, T2 in the Final). Edit Score, **+** twice on T3 (3–2), Save. Answer **Cancel** to "This changes who goes through… • Final (result) • Bronze match (result)".

**Result:**
- Group stage: the DB says 22–21, confirmed, winner still P1a. The standings show P1a "1-0, −1, 3 pts".
- Knockout: the semi shows **3–2 for T3 while T2 stays in the Final**.

**Why:** in edit mode, +/− and the score box write to the DB immediately (the known quirk).

**Fix:** keep edit-mode scores in local draft state, and write scores + winner together on Save.

**Note:** answering **OK** worked correctly (Final and Bronze reset with the right teams, replayable), and a same-winner edit didn't prompt or touch the Final.

### 12. Reschedule leaves a court-less "warming up" match, and Begin Scoring puts it live on "Court ?"
**Steps:** Men's Doubles 35+, time over, **RESCHEDULE**. Then tap **Begin Scoring** on the row that appears.

**Result:**
- After Reschedule the row shows "🟡 WARMING UP" with no court, because `rescheduleMatch` clears `court_number` but not `court_allocated_at`. Court Status shows all courts FREE.
- After Begin Scoring the match is live with `court_number` null. The ticker reads "🔴 LIVE · COURT ?", every court still shows FREE, and the court conflict checks can't see it.

**Fix:** add `court_allocated_at: null` to `db.rescheduleMatch`, or reuse `RESET_MATCH`.

**Workaround:** tap ↩ Cancel Allocation, then Start again.

### 13. Public standings merge all categories into one "Group A"
**Where:** `/t/robustness` (and the `/p/:id` player page).

**Result:**
- "GROUP A · TOP 4 → SF · 34 TEAMS" mixes Youth Boys' Singles, Men's Doubles 35+, Men's Singles, Mixed Doubles, Super Doubles and Women's Doubles teams. It is labelled "YOUTH BOYS' SINGLES · 1 group · top 4 → SF".
- "Group B" mixes Men's Singles and Mixed Doubles 18–34.
- The player page's "Group Standings" is the same merged table.

**Why:** `publicDerive.ts` groups by `group_idx` only.

**Fix:** key groups by `(category_id, group_idx)` and render a header per category. The admin "All" view Groups tab has the same merge.

### 14. Admin actions fail silently when offline
**Steps:** a live Edge Cat match; put the browser offline and tap **✓ Confirm**. Wait 50 s, then go back online.

**Result:**
- No toast and no spinner. The card stayed LIVE, so it didn't falsely show as confirmed.
- After reconnecting nothing retried, and nothing told the admin the confirm hadn't happened.
- The same applies to +/−, Begin Scoring, Extend, Reschedule, Cancel and Walkover, none of which catch errors.

**Fix:** a shared `run(action)` wrapper with a busy state on the button and an error toast. Confirm also showed no busy state on a 3 s-latency network (it still saved once, correctly).

### 15. A network drop during Start Knockout leaves the category stuck in "group"
**Steps:** Edge Cat, groups done. Drop the phase PATCH, then tap **Start Knockout**.

**Result:**
- The bracket was inserted, but phase stayed `group`, with no toast, so the **Knockout tab never appears** for that category.
- Tapping again correctly says "This category already has a knockout bracket." (no duplicate).
- The semis can be played only from the Matches tab. Edit Score and + Select Team are unreachable.

**Fix:** the same transactional RPC as #1/#2, or set the phase before inserting and roll it back on failure.

### 16. With 3 qualifiers and bronze on, the bronze match can never be played
**Steps:** Men's Singles, Ultra Compact format (3 groups of 3, top 1 each), "3rd-place playoff" on, then Start Knockout.

**Result:**
- One semi is a bye, so the 3rd-place match gets only one team ("TBD vs MS P2a").
- It sits in UP NEXT on the Matches tab (labelled **FINAL**) and as "Upcoming" on MS P2a's player page indefinitely.

**Fix:** only create the bronze match when there are two real semi-finals (`qualifiers ≥ 4`), or drop it when a semi is a bye.

### 17. The "All" view Knockout tab shows one category's champion for the whole event
**Result:**
- The banner reads "🏆 CHAMPIONS · MV P2a & MV P2b" (Men's Doubles 35+) above every category's bracket.
- The brackets are merged into round columns with no category labels: five "🏆 FINAL" cards, and the Mixed Doubles 35+ final appears under "SEMI-FINAL".
- Every card is still clickable and propagates to the right category (PR #49's fix holds). It's just confusing.

**Fix:** require a category on the Knockout tab, or group the brackets per category with a header. Compute `champion` per category.

### 18. A cancelled match shows "W/O" and counts as a loss on the Scoreboard
**Steps:** Men's Doubles 35+, time over, **CANCEL**.

**Result:**
- The row shows a "W/O" badge (`cancelMatch` sets `is_walkover: true`).
- The Scoreboard gives MV T1 a loss (0W 1L) and still ranks them #1.
- Recent results show it as "0–0", and the PLAYED counters include it.

**Fix:**
- Store a real cancelled state (or `winner_id null` and `is_walkover false`) and skip it in the Scoreboard.
- In Scoreboard, only count a loser when `winner_id` is set.

### 19. Upcoming / Next lists only show the first categories
**Result:** with 10 categories in group stage, `/t` "Upcoming" listed 5 matches, all Men's Singles or Men's Doubles 18–34, all at the same projected time.

**Fix:** this is the shared-court scheduler issue (plan U-items). Stopgap: show the queue in order without clock times.

---

## Cosmetic

20. **Teams tab "All" view:** the format cards count all 29 teams ("8 groups…"), and **Start Group Stage** does nothing (no toast). The same goes for **Start Knockout** on the Groups tab in the All view.
21. **Walkover and Select Winner keep the partial live score.** The Men's Doubles 35+ semi reads "5–3" won by the 3 side. The Results page shows "5 – 3 · winner MV P3a" with no W/O mark.
22. **The Matches-tab WALKOVER has no confirm prompt.** The card's walkover does.
23. **The TV page after everything finished** shows "PLAYED 82/81" and "PROJECTED END · ~12 min remaining".
24. **Round-robin-only categories (3 teams).** After the round robin there's no champion, and the Scoreboard says "Group Stage". **Start Knockout** is still offered and creates a Final between the top 2. Decide which format is intended and label it.
25. **Group result edited after the knockout has started:** the standings change, with no warning and no reseed. It's harmless in 1-group categories but matters in 2-group ones.
26. **The Sit Out toast** says "Record walkovers in: Men's Singles, Mixed Doubles 18–34" even when those categories are finished.
27. **Minor display issues:**
    - The Groups tab highlights the top 2 rows green whatever `top_n_advance` is.
    - A bye shows as a confirmed "0 – TBD 0" card.
    - Knockout rows on the player page are labelled "RD 1/RD 2" instead of Semi/Final.
    - The bracket-update error toast ends in a generic "error".

## What passed

- **Start Group Stage, one admin, taps within 150 ms:** one set of matches; singles entrants got exactly one solo team each.
- **Second admin's screen:** Admin B's Start button disappeared through realtime when admin A started the category.
- **Court flow on both screens:** allocate → warming up → Begin Scoring → live → Confirm. Cancel Allocation frees the court.
- **Card court picker:** offering a court that's warming up is rejected with a toast. The card picker's player-conflict `confirm()` works.
- **Edit Score → Save on a confirmed group match** recalculates the winner and standings.
- **Time-over actions:** Walkover (Matches tab and card, with confirm on the card) and Select Winner (Matches tab) record the right winner. In the knockout they advance the right team. +5 min is available.
- **Knockout propagation:**
  - Correct from the category view and from the All view (Men's Doubles 18–34, Youth Boys' Singles, Mixed Doubles 35+), from match cards and from the Matches tab. PR #49's category scoping holds.
  - Bronze routing works from both the Knockout card and the Matches tab (Mixed Doubles 18–34).
  - Flipping a semi after the Final and Bronze were played prompts with the right list. OK resets both with the corrected teams, and the reset matches can be replayed.
  - A same-winner edit doesn't prompt and leaves the Final alone.
- **Bracket-update failure** (dropped PATCH): the toast "Result saved, but the bracket didn't update…" appears, and Edit Score → Save repairs it.
- **Byes:** a 3-qualifier bracket advances the top seed to the final correctly.
- **Start Knockout (PR #49):** one admin, one browser, no duplicate; the bronze NULL insert bug didn't recur. A re-tap after the bracket has arrived is refused.
- **Sit Out / Activate:**
  - An unstarted-category player is removed with a prompt and a `team_deletions` row ("WV P1a marked as sitting out").
  - Teams that have played are kept.
  - A player in a live match is refused (with fresh data).
  - Activate works.
- **Reload mid-tournament** (with matches live and warming up): state comes back intact.
- **Results page:** champions and runners-up are correct for all 9 playable categories, and the Mixed Doubles 18–34 3rd place is listed.
- **Public data:** anonymous users can't read `players`, `match_audit_log`, `tournament_admins`, `pending_registrations`, `waiver_consents`, `push_subscriptions` or `team_deletions`, or PATCH `matches`. `live_snapshot` still includes `e_transfer_email`, `reply_to_email`, `created_by` and `players.note`; this is already known from the plan, and nothing writes `note`.

## Not covered

- **Court-allocated emails/push.** The `notify-court-allocated` function isn't deployed on scratch (CORS failure, logged as a warning, allocation unaffected).
- **Real phones**, the iOS PWA, deploy-time reloads, real gym Wi-Fi.
- **Load**, which is the snapshot-cache session's job.
- **Realtime reconnect:** Playwright "offline" probably didn't drop the open websocket (the screen caught up within 5 s), so this is inconclusive. See plan U-items.
- **Two people scoring one match:** not run separately. It follows from #9.

## Suggested order before the Nov 19 freeze

1. #4 (Confirm uses the visible scores) and #3 (+ Select Team never touches confirmed matches). Both are small and stop wrong results.
2. #1/#2/#15: one `start_stage` RPC per category (lock, check, insert, set phase).
3. #6: keep the last good data on a failed refetch.
4. #5: the "Final only" path for 2-team categories, after checking production counts.
5. #12 (one line), #8, #16, #18.
6. #7 and #9 (RPCs), if time allows. Otherwise run it operationally: one person allocates courts, and one scorer per match.

## Reproducing

Run `scripts/robustness/seed.sql` against the scratch project only (SQL editor or the supabase-lcs MCP). Load `scripts/robustness/ui-helpers.js` into the page (DevTools snippet or Playwright `addInitScript`). Then, for example, `await play('MV P1a','MV P3a',21,15)` drives Start Match → court → Begin Scoring → scores → Confirm on a match card.
