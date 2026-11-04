# Registration form: end-to-end run

`registration-e2e.js` walks the public form on a phone (touch, coarse pointer, 390×844) and a desktop and returns a PASS/FAIL list (34 checks as of Nov 4, 2026): validation, keyboard behaviour (bottom bar steps aside while typing, Next/Go keys), events and prices, partners (named, pay for both, solo), the waiver, resume after a refresh, the back button, e-Transfer submit, singles at the student rate, the partner "pay your share" link, and desktop behaviour.

Run it before merging any change to the form:
1. Start the app against the scratch Supabase project (Code Claude launch config `registration-scratch`, http://localhost:5195; tournament "Shuttle Storm Rehearsal 2026").
2. With the Playwright MCP: `browser_run_code_unsafe { filename: "<path to this file>" }` (the MCP only reads files under its allowed roots; a copy lives in `Code Claude/registration-redesign/e2e/`).
3. Check the rows it made on scratch: `pending_registrations where player_email like 'e2e-<run>-%@example.com'`.

It only touches scratch, with unique `@example.com` addresses per run.
