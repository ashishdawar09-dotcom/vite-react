import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ageProblem } from "./ages.ts";

const boys = { name: "Boys' Singles", age_band: "kid" };
const youth = { name: "Youth Boys' Singles", age_band: "teen" };
const mens = { name: "Men's Singles", age_band: "adult" };
const masters = { name: "Super Doubles 50+", age_band: "adult" };

Deno.test("junior events are 8 to 12", () => {
  assertEquals(ageProblem(boys, 8), null);
  assertEquals(ageProblem(boys, 12), null);
  assertMatch(ageProblem(boys, 15)!, /ages 8–12.*At 15, please choose a youth category/);
  assertMatch(ageProblem(boys, 7)!, /ages 8–12/);
});

Deno.test("youth events are for under-18s; younger players may play up", () => {
  assertEquals(ageProblem(youth, 15), null);
  assertEquals(ageProblem(youth, 11), null);
  assertMatch(ageProblem(youth, 18)!, /please choose an adult category/);
});

Deno.test("adult events have no upper limit; 50+ needs 50", () => {
  assertEquals(ageProblem(mens, 15), null);
  assertEquals(ageProblem(mens, 70), null);
  assertEquals(ageProblem(masters, 50), null);
  assertMatch(ageProblem(masters, 49)!, /50 and over/);
});

Deno.test("unknown age or category passes", () => {
  assertEquals(ageProblem(boys, null), null);
  assertEquals(ageProblem(null, 15), null);
});
