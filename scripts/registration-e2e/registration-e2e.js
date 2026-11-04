// End-to-end run of the registration form, phone and desktop.
//
// Run it with the Playwright MCP before every merge that touches the form:
//   browser_run_code_unsafe { filename: "registration-redesign/e2e/registration-e2e.js" }
// against the local app pointed at the scratch Supabase project
// (launch config "registration-scratch", http://localhost:5195). It creates
// test entries on scratch only, with unique @example.com addresses, and
// returns a pass/fail list; check the rows on scratch afterwards
// (pending_registrations where player_email like 'e2e-%@example.com').
async (page) => {
  const BASE = "http://localhost:5195/register/150c4fb7-5c02-4da5-8489-420938c0d394";
  const run = Date.now().toString(36);
  const email = (k) => `e2e-${run}-${k}@example.com`;
  const results = [];
  const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  const cdp = await page.context().newCDPSession(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  const phone = async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  };
  const fresh = async (query = "") => {
    await page.goto(BASE + query);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(BASE + query);
    await page.waitForSelector("input[autocomplete=name]");
  };
  const bar = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).position === "fixed" && d.querySelector("button"));
    return b ? { hidden: b.getAttribute("aria-hidden") === "true", inert: b.hasAttribute("inert") } : null;
  });
  const h2 = () => page.evaluate(() => document.querySelector("h2")?.innerText ?? "");
  const stepLabel = () => page.evaluate(() => (document.body.innerText.match(/STEP \d \/ \d/) || [""])[0]);
  const errors = () => page.evaluate(() => [...document.querySelectorAll("[data-field-error]")].map((e) => (e.querySelector("label")?.innerText || "").replace(/\s+/g, " ").trim()));
  // The button a person would tap: the one under the form while typing on a
  // phone (the bottom bar is hidden and can't be tapped then), else the bar's.
  const tap = async (label) => {
    await page.waitForTimeout(200);
    await page.locator(`form ~ div:not([aria-hidden='true']) button:has-text('${label}')`).first().click();
  };
  const cont = async () => { await tap("Continue"); await page.waitForTimeout(650); };
  const youStep = async (name, mail, tel) => {
    await page.fill("input[autocomplete=name]", name);
    await page.fill("input[type=email]", mail);
    await page.fill("input[type=tel]", tel);
    await cont();
  };
  const waiverStep = async (signature) => {
    await page.waitForSelector("text=Rules and waiver");
    // Tick only what isn't ticked (coming back to this step keeps the ticks).
    for (const text of ["I have read the competition regulations", "Acknowledgement of Risk", "codes of conduct"]) {
      const label = page.locator(`label:has-text('${text}')`);
      if (!(await label.locator("input[type=checkbox]").isChecked())) await label.click();
    }
    await page.fill("label:has-text('Your signature') ~ input", signature);
    await cont();
  };

  try {
    // ---------- phone ----------
    await phone();
    await fresh();
    check("phone: coarse pointer emulated", await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
    check("no 'Same partner as' shortcut anywhere on step 1", !(await page.evaluate(() => /Same partner as/.test(document.body.innerText))));

    // 1. Validation on an empty step
    await cont();
    const e1 = await errors();
    check("empty step 1 shows 3 errors", e1.length === 3, e1.join(", "));

    // 2. Keyboard: bar steps aside, buttons under the form, Next/Go keys
    await page.focus("input[autocomplete=name]");
    await page.waitForTimeout(250);
    const b1 = await bar();
    check("typing on a phone hides the bottom bar", !!b1?.hidden && !!b1?.inert);
    check("typing shows Continue under the form", (await page.locator("form ~ div button:has-text('Continue')").count()) >= 2);
    check("Next key on the name field", (await page.evaluate(() => document.activeElement.enterKeyHint)) === "next");
    await page.keyboard.type("Multi Tester");
    await page.keyboard.press("Enter");
    check("Enter on name moves to email", (await page.evaluate(() => document.activeElement?.getAttribute("type"))) === "email");
    await page.keyboard.type(email("multi"));
    await page.keyboard.press("Enter");
    check("Go key on the last field", (await page.evaluate(() => document.activeElement.enterKeyHint)) === "go");
    await page.keyboard.type("6045551111");
    await page.keyboard.press("Enter");
    await page.waitForSelector("input[placeholder='e.g. 34']", { timeout: 5000 });
    await page.waitForTimeout(400);
    check("Go on the last field moves to Events at the top", (await h2()) === "Pick your events" && (await page.evaluate(() => scrollY)) === 0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(300);
    check("bar comes back after typing", (await bar())?.hidden === false);

    // 3. Events: age gate, eligibility, total
    await page.fill("input[placeholder='e.g. 34']", "40");
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator("[role=checkbox]").nth(1).click(); // Men's Doubles 35+
    await page.locator("[role=checkbox]").nth(5).click(); // Mixed Doubles 35+
    await page.locator("[role=checkbox]:has-text(\"Men's Singles\")").click();
    const locked = await page.evaluate(() => [...document.querySelectorAll("[role=checkbox][aria-disabled=true]")].map((e) => e.innerText.split("\n")[0]));
    check("youth and 50+ events locked at 40", locked.some((n) => /Youth/.test(n)) && locked.some((n) => /50\+/.test(n)), locked.join(", "));
    check("3 events, $120 in the bar", /3 EVENTS\s*\$120/.test(await page.evaluate(() => document.body.innerText)));
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(250);
    const scrolled = await page.evaluate(() => scrollY);
    await cont();
    check("next step opens at the top", (await page.evaluate(() => scrollY)) === 0 && scrolled > 200, `was at ${scrolled}`);

    // 4. Partners: named + pay for both (35+ needs age), and solo
    check("partners step", (await h2()) === "Your partners");
    await cont();
    const e4a = await errors();
    check("each doubles event asks: partner or find me one", e4a.length === 2, `${e4a.length} choices flagged`);
    await page.locator("[role=radio]:has-text('Find me a partner')").nth(1).click();
    await page.locator("[role=radio]:has-text('I have a partner')").first().click();
    await page.fill("label:has-text(\"Partner's name\") ~ input", "Raj Test");
    await page.locator("[role=radio]:has-text('pay for both')").click();
    await cont();
    const e4 = await errors();
    check("paying for both needs email, mobile, age", e4.length === 3, e4.join(", "));
    await page.fill("label:has-text(\"Partner's email\") ~ input", email("partner"));
    await page.fill("label:has-text(\"Partner's mobile\") ~ input", "6045550000");
    await page.fill("label:has-text(\"Partner's age\") ~ input", "44");
    check("no 'Same partner as' shortcut on partners", !(await page.evaluate(() => /Same partner as/.test(document.body.innerText))));
    check("$160 with pay-for-both", /3 EVENTS\s*\$160/.test(await page.evaluate(() => document.body.innerText)));
    await cont();

    // 5. Waiver: in the page, no inner scroller; expands
    const w = await page.evaluate(() => { const r = document.querySelector("[aria-label='Waiver text']"); return { overflow: getComputedStyle(r).overflowY, h: r.clientHeight }; });
    check("waiver shows its start without an inner scroll box", w.overflow === "hidden" && w.h <= 240, JSON.stringify(w));
    await page.click("button:has-text('Read the full waiver')");
    const w2 = await page.evaluate(() => { const r = document.querySelector("[aria-label='Waiver text']"); return r.scrollHeight <= r.clientHeight; });
    check("Read the full waiver shows all of it", w2);
    await waiverStep("Multi Tester");

    // 6. Resume after a refresh, and the phone's back button
    check("payment step", (await h2()) === "Review and pay");
    await page.reload();
    await page.waitForSelector("h2");
    await page.waitForTimeout(500);
    // Waiver ticks aren't kept on the device, so a refresh resumes at the waiver.
    check("refresh resumes where they were (waiver re-confirmed)", ["Rules and waiver", "Review and pay"].includes(await h2()) && /Welcome back/.test(await page.evaluate(() => document.body.innerText)), await h2());
    if ((await h2()) === "Rules and waiver") await waiverStep("Multi Tester");
    await page.goBack();
    await page.waitForTimeout(700);
    check("back button goes back one step", (await h2()) === "Rules and waiver", await h2());
    await waiverStep("Multi Tester");

    // 7. Pay: reference required, then submit
    await tap("Submit entry");
    await page.waitForTimeout(300);
    check("e-Transfer reference required", (await errors()).some((l) => /REFERENCE/i.test(l)));
    await page.fill("label:has-text('e-Transfer reference number') ~ input", "E2EREF1");
    await tap("Submit entry");
    await page.waitForSelector("text=Entry received", { timeout: 30000 });
    const listed = await page.evaluate(() => document.body.innerText);
    check("success lists all 3 events", ["Men's Singles", "Men's Doubles 35+", "Mixed Doubles 35+"].every((n) => listed.includes(n)));
    check("success says one partner was emailed", /emailed your partner what/.test(listed));

    // 8. Enter another event keeps the player
    await page.click("button:has-text('Enter another event')");
    await page.waitForTimeout(500);
    check("Enter another event opens Events with the age kept", (await h2()) === "Pick your events" && (await page.inputValue("input[placeholder='e.g. 34']")) === "40");

    // 9. Singles only: no partner step, student rate, submits
    await fresh();
    await youStep("Single Tester", email("single"), "6045552222");
    await page.fill("input[placeholder='e.g. 34']", "22");
    await page.evaluate(() => document.activeElement?.blur());
    await page.click("label:has-text(\"I'm a current\")");
    await page.locator("[role=checkbox]:has-text(\"Men's Singles\")").click();
    check("singles only: 4 steps, student $30", (await stepLabel()) === "STEP 2 / 4" && /1 EVENT\s*\$30/.test(await page.evaluate(() => document.body.innerText)));
    await cont();
    await waiverStep("Single Tester");
    await page.fill("label:has-text('e-Transfer reference number') ~ input", "E2EREF2");
    await tap("Submit entry");
    await page.waitForSelector("text=Entry received", { timeout: 30000 });
    check("singles entry submitted", true);

    // 10. Partner's "Pay your share" link
    await fresh("?category=e9e0bf23-8a4e-4f6c-ba2f-938e918c6993&share=1");
    await youStep("Share Tester", email("share"), "6045553333");
    await page.fill("input[placeholder='e.g. 34']", "41");
    await page.evaluate(() => document.activeElement?.blur());
    check("share link preselects the event", (await page.evaluate(() => [...document.querySelectorAll("[role=checkbox][aria-checked=true]")].length)) === 1);
    await cont();
    await cont();
    const e10 = await errors();
    check("share link requires the partner who entered them", e10.length === 3 && /Paying your share/.test(await page.evaluate(() => document.body.innerText)), e10.join(", "));

    // ---------- desktop (a fresh tab: no phone emulation left over) ----------
    const d = await page.context().newPage();
    try {
      await d.setViewportSize({ width: 1280, height: 860 });
      await d.goto(BASE);
      await d.evaluate(() => { localStorage.clear(); });
      await d.reload();
      await d.waitForSelector("input[autocomplete=name]");
      await d.focus("input[autocomplete=name]");
      await d.waitForTimeout(300);
      const dState = await d.evaluate(() => {
        const b = [...document.querySelectorAll("div")].find((x) => getComputedStyle(x).position === "fixed" && x.querySelector("button"));
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          barHidden: b?.getAttribute("aria-hidden") === "true",
          extraButtons: document.querySelectorAll("form ~ div:not([aria-hidden='true']) button").length,
          padding: getComputedStyle(document.documentElement).scrollPaddingBottom,
        };
      });
      check("desktop: bar stays while typing, no extra buttons", !dState.coarse && !dState.barHidden && dState.extraButtons === 1, JSON.stringify(dState));
      check("desktop: fields scroll clear of the bar", dState.padding === "190px");
      await d.keyboard.type("Desk Top");
      await d.keyboard.press("Enter");
      check("desktop: Enter moves to the next field", (await d.evaluate(() => document.activeElement?.getAttribute("type"))) === "email");
    } finally {
      await d.close();
    }
  } catch (err) {
    results.push(`FAIL  run stopped: ${err && err.message ? err.message.split("\n")[0] : String(err)}`);
  }
  // Leave the tab as we found it for whatever runs next.
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
  await cdp.detach().catch(() => {});
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  return { run, passed: results.length - failed, failed, results };
}
