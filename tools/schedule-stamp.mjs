#!/usr/bin/env node
// WHICH CRON ENTRY FIRED, AND HOW LATE — stamped by the run, not inferred later.
//
// THE PROBLEM THIS EXISTS FOR
//
// GitHub does not record, in anything the Actions API serves, which `schedule:`
// entry produced a given scheduled run. `gh run list --json` gives you
// `event: "schedule"` and a start time and nothing else. So the only way to say
// how late a delivery was is to guess its slot from its start time, and that
// guess is only sound while deliveries are later than nothing and earlier than
// the gap between entries.
//
// This repo broke that condition on its fourth day. Two entries twelve hours
// apart (`23 7` and `23 19`), and the run that started 2026-08-29T02:18:22Z is
// EITHER the 2026-08-28T19:23Z slot 6h55m late, OR the 2026-08-28T07:23Z slot
// 18h55m late. Both readings fit every byte of evidence, and they disagree
// about whether a slot was dropped:
//
//   reading A   6 slots, 6 deliveries, none dropped, worst lateness 18h55m
//   reading B   6 slots, 5 delivered, ONE DROPPED, one slot delivered twice
//
// A watcher that cannot tell "late" from "dropped" is reporting the wrong
// reason, and somebody acts on the reason. This is the same aliasing @ballast
// named for me on a `*/15` schedule in c28402 — a delay aliased by its own
// interval is a rate of ARRIVAL, never of LATENESS — arriving again at twelve
// hours instead of fifteen minutes.
//
// THE FIX, AND WHY IT IS ONE LINE OF EVIDENCE RATHER THAN A MODEL
//
// `github.event.schedule` is available INSIDE the job and carries the cron
// string of the entry that fired. It is never written to the run object, so it
// has to be emitted by the run itself or it is lost when the job ends. This
// prints it, alongside the nominal slot computed from that entry and the
// delay — so a future reader has the attribution as a fact instead of a
// reconstruction.
//
// WHAT THIS STILL CANNOT DO, STATED BEFORE THE CODE RATHER THAN AFTER.
//
// It de-aliases WHICH ENTRY, which is the 12h ambiguity this repo actually hit.
// It does NOT de-alias a full-period drop, and it CANNOT: `nominalSlot()`
// returns the most recent occurrence at or before the run, so a delivery
// exactly 24h late is byte-identical to the next day's on-time delivery. Both
// print `0h00m late` and nothing in a single run's evidence separates them.
//
// I wrote a guard for that case first — `if (delayMs >= ALIAS_PERIOD_MS)
// refuse` — and its own test proved it unreachable, because the slot is chosen
// at-or-before and the delay is therefore always under a day by construction.
// That is the decorative-assertion failure @Ember named for me in c28753 and it
// is the second time I have shipped it, so the guard is deleted rather than
// weakened: a threshold has to be a value the instrument can actually produce.
//
// What detects a dropped slot is COUNTING deliveries per entry per day against
// the entries declared in the workflow. That needs state across runs, which a
// stamp does not have. This prints what one run knows, and says so.
//
// Usage:  node tools/schedule-stamp.mjs "<cron>" [<run-start-iso>]

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"];

/** Parse the subset of cron this is willing to reason about: fixed minute and hour, daily. */
export function parseDailyCron(cron) {
  const fields = String(cron ?? "").trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, why: `a cron line has 5 fields, got ${fields.length}` };
  const [minute, hour, dom, month, dow] = fields;
  for (const [i, f] of [dom, month, dow].entries())
    if (f !== "*") return { ok: false, why: `${FIELD_NAMES[i + 2]} is '${f}', not '*' — this only reasons about daily entries` };
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour))
    return { ok: false, why: `minute and hour must each be a single fixed number; got '${minute}' and '${hour}'` };
  const m = Number(minute), h = Number(hour);
  if (m > 59 || h > 23) return { ok: false, why: `'${hour}:${minute}' is not a time of day` };
  return { ok: true, minute: m, hour: h };
}

/**
 * The most recent occurrence of that daily slot at or before `atMs`.
 *
 * At-or-before, not nearest: a run cannot be delivered before the slot that
 * asked for it, so a nearest-match would happily attribute a run to a slot in
 * its own future.
 */
export function nominalSlot(cron, atMs) {
  const p = parseDailyCron(cron);
  if (!p.ok) return null;
  const d = new Date(atMs);
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), p.hour, p.minute, 0, 0);
  return slot <= atMs ? slot : slot - 86_400_000;
}

/**
 * The period a daily entry aliases at. Exported as documentation of the limit
 * above, NOT as a threshold anything compares against — see the header for why
 * the comparison was deleted.
 */
export const ALIAS_PERIOD_MS = 86_400_000;

export function stamp(cron, atMs) {
  const p = parseDailyCron(cron);
  if (!p.ok)
    return { attributable: false, why: cron ? `unattributable: ${p.why}` : "unattributable: no cron string was supplied — github.event.schedule is empty outside a scheduled run" };
  const slot = nominalSlot(cron, atMs);
  return { attributable: true, cron, slot, delayMs: atMs - slot };
}

const hm = (ms) => `${Math.floor(ms / 3_600_000)}h${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, "0")}m`;

export function render(cron, atMs) {
  const s = stamp(cron, atMs);
  const at = new Date(atMs).toISOString().replace(".000", "");
  if (!s.attributable) return [`schedule stamp: ${s.why}`, `  run started ${at}`].join("\n");
  return [
    `schedule stamp: entry '${s.cron}'`,
    `  nominal slot  ${new Date(s.slot).toISOString().replace(".000", "")}`,
    `  run started   ${at}`,
    `  delivered     ${hm(s.delayMs)} late`,
    `  note          this attributes the ENTRY. A delivery a full 24h late reads here as the next day's on-time run; only counting deliveries per entry per day tells a drop from a day-long delay.`,
  ].join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const cron = process.argv[2];
  const at = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
  console.log(render(cron, at));
}
