// The de-aliasing has to be tested on the specimen that motivated it, or it is
// a plausible-looking function nobody has pointed at the problem.
//
// The specimen: this repo's own run at 2026-08-29T02:18:22Z, with entries
// `23 7` and `23 19` twelve hours apart. Two readings fit every byte of the
// evidence and they disagree about whether a slot was dropped.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDailyCron, nominalSlot, stamp, render, ALIAS_PERIOD_MS } from "../tools/schedule-stamp.mjs";

const SPECIMEN = Date.parse("2026-08-29T02:18:22Z");

test("the specimen run reads as two different delays, which is the whole problem", () => {
  const evening = stamp("23 19 * * *", SPECIMEN);
  const morning = stamp("23 7 * * *", SPECIMEN);
  assert.equal(new Date(evening.slot).toISOString(), "2026-08-28T19:23:00.000Z");
  assert.equal(new Date(morning.slot).toISOString(), "2026-08-28T07:23:00.000Z");
  assert.equal(Math.round(evening.delayMs / 60000), 415, "6h55m under the evening entry");
  assert.equal(Math.round(morning.delayMs / 60000), 1135, "18h55m under the morning entry");
  assert.notEqual(evening.delayMs, morning.delayMs,
    "same run, same evidence, two answers — that gap is exactly what github.event.schedule closes");
});

test("a slot is never attributed to a time in the run's own future", () => {
  // 02:18 is before 07:23, so the 07:23 entry's slot must be YESTERDAY's.
  const slot = nominalSlot("23 7 * * *", SPECIMEN);
  assert.ok(slot <= SPECIMEN, "a run cannot be delivered before the slot that asked for it");
  assert.equal(new Date(slot).getUTCDate(), 28);
});

test("a full period of lateness is INDISTINGUISHABLE, and the tool says so instead of guarding", () => {
  // This test exists because the first version of this file had a guard here:
  // `if (delayMs >= ALIAS_PERIOD_MS) refuse`. This test proved it unreachable.
  // `nominalSlot()` picks the most recent occurrence at or before the run, so
  // the delay is under a day by construction and the branch could never run —
  // the decorative-assertion failure @Ember named in c28753, shipped twice.
  //
  // So the guard is deleted and the limit is asserted as the fact it is.
  const slot = Date.parse("2026-08-28T07:23:00Z");
  const dayLate = stamp("23 7 * * *", slot + ALIAS_PERIOD_MS);
  assert.equal(dayLate.attributable, true);
  assert.equal(dayLate.delayMs, 0,
    "a run a full day late is byte-identical to the next day's on-time run, and one run's evidence cannot separate them");
  assert.equal(new Date(dayLate.slot).toISOString(), "2026-08-29T07:23:00.000Z",
    "…because the slot it is attributed to has moved with it");

  // The renderer must not let a reader walk away believing otherwise.
  assert.match(render("23 7 * * *", slot + ALIAS_PERIOD_MS), /counting deliveries per entry per day/);

  // And no comparison against the period may come back: a threshold has to be
  // a value the instrument can actually produce.
  const source = readFileSync(new URL("../tools/schedule-stamp.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function parseDailyCron"));
  assert.doesNotMatch(body, /[<>]=?\s*ALIAS_PERIOD_MS/,
    "ALIAS_PERIOD_MS is documentation of a limit, not a branch anything takes");
});

test("an empty cron string is named as an empty cron string, not as an on-time run", () => {
  // github.event.schedule is empty on push, pull_request and workflow_dispatch.
  // A stamp that silently reported 0h00m late there would put a fabricated
  // on-time delivery into the record every time anyone opened a PR.
  const s = stamp("", Date.now());
  assert.equal(s.attributable, false);
  assert.match(s.why, /github\.event\.schedule is empty/);
  assert.equal(s.delayMs, undefined, "no delay field at all, rather than a zero that reads as punctual");
  assert.doesNotMatch(render("", SPECIMEN), /late/);
});

test("only fixed daily entries are reasoned about, and the rest say why not", () => {
  assert.equal(parseDailyCron("23 7 * * *").ok, true);
  for (const [cron, why] of [
    ["*/15 * * * *", /minute and hour must each be a single fixed number/],
    ["23 7 * * 1", /day-of-week is '1'/],
    ["23 7 1 * *", /day-of-month is .1./],
    ["23 7 * *", /a cron line has 5 fields, got 4/],
    ["99 7 * * *", /is not a time of day/],
  ]) {
    const p = parseDailyCron(cron);
    assert.equal(p.ok, false, `'${cron}' must not be accepted`);
    assert.match(p.why, why);
  }
});

test("the rendered stamp names the entry, so a log reader does not have to reconstruct it", () => {
  const out = render("23 19 * * *", SPECIMEN);
  assert.match(out, /entry '23 19 \* \* \*'/);
  assert.match(out, /nominal slot {2}2026-08-28T19:23:00Z/);
  assert.match(out, /run started {3}2026-08-29T02:18:22Z/);
  assert.match(out, /delivered {5}6h55m late/);
});
