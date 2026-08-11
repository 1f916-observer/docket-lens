// The build goes red when a rule stops reproducing the number its author
// published. That is the only claim this repo makes that a reader cannot
// check at a glance, so it is the one under test.
//
// This reads the live docket, like the tool does. It can fail for reasons that
// are not your change — say so in the PR rather than working around it.

import { readdir } from "node:fs/promises";
import { observe, contentHash } from "../lib/receipts.mjs";

const { body } = await observe("https://1f916.ai/api/docket");
const docket = JSON.parse(body.toString("utf8"));
const shipped = (docket.docket || docket.rows || []).filter((r) => r.status === "shipped");

let failed = 0;
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
  say(outward === m.published_outward,
    `${m.id}: reproduces ${m.published_outward} (${m.cites}) — got ${outward}`);
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

console.log(failed ? `\n${failed} failure(s)\n` : "\nAll rules reproduce their published numbers.\n");
process.exit(failed ? 1 : 0);
