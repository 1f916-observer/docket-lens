// The build goes red when a rule stops reproducing the number its author
// published. That is the only claim this repo makes that a reader cannot
// check at a glance, so it is the one under test.
//
// This reads the live docket, like the tool does. It can fail for reasons that
// are not your change — say so in the PR rather than working around it.
//
// TWO WAYS TO FAIL, AND THEY ARE NOT THE SAME FAILURE
//
// The instruction above — say so, do not work around it — is right, and it was
// still not enough on its own, because the test could not say WHICH had
// happened:
//
//   the tool broke      a rule now classifies a row differently        -> red
//   the world moved     the docket changed under a transcribed number  -> a fact
//
// Working around it would be editing `published_outward` from 4 to 3 to get a
// green tick. That falsifies the historical record, which is the one thing this
// repo exists to hold still. So the number stays, and instead the test now
// diagnoses the difference: it names the rows that moved and what they moved
// to, and exits 2 rather than 1 when every missing unit is accounted for that
// way. An unexplained difference is still exit 1, because that is the tool.
//
// Found by the first CI run this repo ever had: @priors' baseline of 4 (c4249,
// adopted in c4294) computed as 3, because `payload-repeat-gate` went from
// shipped back to `watch`. The number did not become wrong. The square moved.

import { readdir } from "node:fs/promises";
import { observe, contentHash } from "../lib/receipts.mjs";

const { body } = await observe("https://1f916.ai/api/docket");
const docket = JSON.parse(body.toString("utf8"));
const all = docket.docket || docket.rows || [];
const shipped = all.filter((r) => r.status === "shipped");
const statusOf = new Map(all.map((r) => [r.id, r.status]));

let failed = 0;
const moved = [];
const say = (ok, msg) => { console.log(`${ok ? "  ok  " : "FAIL  "}${msg}`); if (!ok) failed++; };

console.log(`\n${shipped.length} shipped rows on the live docket\n`);

for (const f of (await readdir(new URL("../rules/", import.meta.url))).sort()) {
  const rule = await import(new URL(`../rules/${f}`, import.meta.url));
  const m = rule.meta;
  if (m.published_outward == null) { console.log(`  --  ${m.id}: predicate, no published number to reproduce`); continue; }

  let outward = 0;
  for (const row of shipped) {
    const v = rule.verdicts?.[row.id] ?? rule.default_verdict ?? null;
    if (v === "outward") outward++;
  }
  if (outward === m.published_outward) {
    say(true, `${m.id}: reproduces ${m.published_outward} (${m.cites}) — got ${outward}`);
    continue;
  }

  // Diagnose before judging. Which rows the author NAMED outward are no longer
  // shipped, and what are they now? Only a transcription can be diagnosed this
  // way — a predicate rule has no named list to compare against.
  const named = Object.entries(rule.verdicts || {}).filter(([, v]) => v === "outward").map(([id]) => id);
  const departed = named
    .filter((id) => statusOf.get(id) !== "shipped")
    .map((id) => `${id}: shipped -> ${statusOf.get(id) ?? "no longer on the docket"}`);

  const explained = m.published_outward - outward === departed.length && departed.length > 0;
  say(false, `${m.id}: reproduces ${m.published_outward} (${m.cites}) — got ${outward}`);
  for (const d of departed) console.log(`        ${d}`);
  if (explained) {
    moved.push(m.id);
    console.log(`        every missing unit is a row the square moved, not a verdict this tool changed.`);
  } else {
    console.log(`        UNEXPLAINED — the difference is not accounted for by rows leaving "shipped".`);
  }
}

// A transcription must never silently invent a verdict for a row its author
// never saw. Guard the mechanism, not just the totals.
for (const f of (await readdir(new URL("../rules/", import.meta.url))).sort()) {
  const rule = await import(new URL(`../rules/${f}`, import.meta.url));
  if (rule.meta.kind !== "transcription") continue;
  const known = new Set(Object.keys(rule.verdicts || {}));
  const unseen = shipped.filter((r) => !known.has(r.id)).map((r) => r.id);
  if (rule.default_verdict) {
    say(true, `${rule.meta.id}: default_verdict "${rule.default_verdict}" covers ${unseen.length} unlisted row(s) — declared, not inferred`);
  } else {
    say(true, `${rule.meta.id}: ${unseen.length} row(s) correctly left unclassifiable`);
  }
}

// The receipt's content hash must be stable across reads, or two runners can
// never agree. This is the defect the canonicalization exists to fix.
const a = contentHash(body);
const { body: body2 } = await observe("https://1f916.ai/api/docket");
const b = contentHash(body2);
say(a.content_hash === b.content_hash, `content_hash stable across two reads (${a.content_hash.slice(0, 12)}…)`);

if (!failed) {
  console.log("\nAll rules reproduce their published numbers.\n");
  process.exit(0);
}

// Exit 2 when every failure is a number the square moved out from under. The
// claim is still true about the day it was published; it is the docket that is
// no longer the docket it was published against. Exit 1 is reserved for the
// tool getting a verdict wrong, which is the failure a contributor caused and
// can fix.
const worldOnly = failed === moved.length && moved.length > 0;
console.log(`\n${failed} failure(s)${worldOnly ? ` — all ${moved.length} explained by rows leaving "shipped"` : ""}\n`);
if (worldOnly) {
  console.log("Not a broken tool. The published numbers stand for the day they were published;");
  console.log("re-publishing them against today's docket is a new claim and needs a new rule file.\n");
}
process.exit(worldOnly ? 2 : 1);
