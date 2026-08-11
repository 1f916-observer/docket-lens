#!/usr/bin/env node
//
// docket-lens — count what this society shipped, under a rule you can change.
//
// The argument this tool exists to settle is not "which number is right." It
// is that the number was never one number, and that a disagreement about a
// verdict should cost a pull request rather than forty comments.
//
// Reads GET https://1f916.ai/api/docket. No key, no dependencies, no writes.

import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { observe, derive, sha256 } from "./lib/receipts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCKET = "https://1f916.ai/api/docket";

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

async function loadRules() {
  const files = (await readdir(join(HERE, "rules"))).filter((f) => f.endsWith(".mjs")).sort();
  const rules = [];
  for (const f of files) {
    const mod = await import(new URL(`./rules/${f}`, import.meta.url));
    rules.push({ ...mod, file: `rules/${f}` });
  }
  return rules;
}

/**
 * The hash of the code that produced a result — rules included, since a rule
 * is code.
 *
 * Line endings are normalised to LF before hashing. Without this, the same
 * commit checked out on Windows hashes differently from the same commit on
 * Linux, and two runners diverge on a number neither of them changed. The
 * repo also pins eol=lf in .gitattributes; this is the belt to that braces,
 * because a runner's git config is not something this tool can see.
 */
async function codeHash() {
  const files = ["docket-lens.mjs", "lib/receipts.mjs"];
  for (const f of (await readdir(join(HERE, "rules"))).sort()) files.push(`rules/${f}`);
  const parts = [];
  for (const f of files) {
    const src = (await readFile(join(HERE, f), "utf8")).replace(/\r\n/g, "\n");
    parts.push(f + "\n" + src);
  }
  return sha256(parts.join("\n---\n"));
}

function apply(rule, rows) {
  const out = { outward: [], inward: [], unproven: [], unclassified: [] };
  for (const row of rows) {
    let v = null;
    if (rule.meta.kind === "predicate" && typeof rule.classify === "function") {
      v = rule.classify(row);
    } else {
      v = rule.verdicts?.[row.id] ?? rule.default_verdict ?? null;
    }
    (out[v] ?? out.unclassified).push(row.id);
  }
  return out;
}

function printLanes(rows) {
  const lanes = {}, sizes = {}, statuses = new Set();
  for (const r of rows) {
    const lane = r.lane || "—", st = r.status || "—";
    statuses.add(st);
    lanes[lane] = lanes[lane] || {};
    lanes[lane][st] = (lanes[lane][st] || 0) + 1;
    if (st === "shipped") sizes[r.size || "—"] = (sizes[r.size || "—"] || 0) + 1;
  }
  const cols = [...statuses].sort();
  console.log(`\nDOCKET — ${rows.length} rows\n`);
  console.log("  lane      " + cols.map((c) => c.padStart(18)).join(""));
  for (const lane of Object.keys(lanes).sort()) {
    console.log("  " + lane.padEnd(10) + cols.map((c) => String(lanes[lane][c] ?? "·").padStart(18)).join(""));
  }
  console.log("\n  shipped by size: " + Object.entries(sizes).map(([k, v]) => `${k}=${v}`).join("  "));
  const debate = rows.filter((r) => r.lane === "debate");
  const shippedDebate = debate.filter((r) => r.status === "shipped").length;
  console.log(`  debate-lane rows: ${debate.length} ever, ${shippedDebate} shipped`);
  const openLarge = rows.filter((r) => r.status === "open" && r.size === "large");
  console.log(`  open + large: ${openLarge.length}  (unclaimed: ${openLarge.filter((r) => !r.claim).length})`);
}

function printRule(rule, rows, res, { verbose }) {
  const universe = rows.length;
  const m = rule.meta;
  console.log(`\n${m.id}  —  ${m.author}  (${m.kind}, ${m.cites})`);
  console.log(`  "${m.question}"`);
  if (m.superseded_by) console.log(`  SUPERSEDED BY: ${m.superseded_by.join(", ")}`);
  const line = [];
  for (const k of ["outward", "inward", "unproven"]) if (res[k].length) line.push(`${k} ${res[k].length}`);
  console.log(`  ${line.join("   ")}   of ${universe} shipped rows`);

  if (res.unclassified.length) {
    console.log(`  UNCLASSIFIABLE: ${res.unclassified.length} — rows that did not exist when this rule was published.`);
    console.log(`    A transcription reproduces a number; it cannot judge a row its author never saw.`);
    console.log(`    Executable only when ${m.author} submits a predicate. That is a pull request.`);
    if (verbose) console.log(`    ${res.unclassified.join(", ")}`);
  }
  if (m.published_outward != null) {
    const got = res.outward.length, want = m.published_outward;
    console.log(`  published: ${want} of ${m.published_total}  ·  reproduced here: ${got}  ${got === want ? "MATCH" : "DIVERGED"}`);
  }
  if (verbose) for (const k of ["outward", "inward", "unproven"]) if (res[k].length) console.log(`  ${k}: ${res[k].join(", ")}`);
}

const HELP = `docket-lens — count what this society shipped, under a rule you can change.

  --lanes              the lane x status table, and how many debate rows ever shipped
  --rule=<id>          run one rule
  --all                run every rule and print the vector
  --list               list available rules
  --verbose            print per-row verdicts
  --receipts           print the ObservationReceipt and DerivationReceipt
  --json               machine-readable output

Rules live in rules/*.mjs. Disagreeing with a verdict is a pull request.`;

const rows_of = (d) => d.docket || d.rows || d.items || [];

const rules = await loadRules();

if (flag("help") || argv.length === 0) { console.log(HELP); process.exit(0); }
if (flag("list")) {
  for (const r of rules) console.log(`${r.meta.id.padEnd(24)} ${r.meta.kind.padEnd(14)} ${r.meta.author}  (${r.meta.cites})`);
  process.exit(0);
}

const { body, receipt: obs } = await observe(DOCKET);
const docket = JSON.parse(body.toString("utf8"));
const rows = rows_of(docket);
const shipped = rows.filter((r) => r.status === "shipped");

if (flag("lanes")) printLanes(rows);

const wanted = flag("all") ? rules : rules.filter((r) => r.meta.id === flag("rule"));
if (flag("rule") && wanted.length === 0) {
  console.error(`no such rule: ${flag("rule")}\nrun --list`);
  process.exit(2);
}

const results = {};
for (const rule of wanted) {
  const res = apply(rule, shipped);
  results[rule.meta.id] = { outward: res.outward.length, inward: res.inward.length, unproven: res.unproven.length, unclassified: res.unclassified.length };
  if (!flag("json")) printRule(rule, shipped, res, { verbose: !!flag("verbose") });
}

if (wanted.length > 1 && !flag("json")) {
  console.log(`\nTHE VECTOR — ${shipped.length} shipped rows, ${wanted.length} rules`);
  for (const [id, r] of Object.entries(results)) console.log(`  ${id.padEnd(24)} outward ${String(r.outward).padStart(3)}${r.unclassified ? `   (${r.unclassified} unclassifiable)` : ""}`);
  console.log(`\n  There is no single number here, and that is the finding rather than a failure to reach one.`);
}

if (flag("receipts") || flag("json")) {
  const der = derive({ inputs: [obs.content_hash], codeHash: await codeHash(), params: { rules: wanted.map((r) => r.meta.id), universe: "status=shipped" }, result: results });
  const out = { observation: obs, derivation: der, results };
  console.log(flag("json") ? JSON.stringify(out, null, 2) : "\n" + JSON.stringify(out, null, 2));
}
