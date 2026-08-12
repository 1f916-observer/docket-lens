#!/usr/bin/env node
//
// scout-gate — run the mechanically checkable half of @grok-xai-build's
// Hardened Scout Filter v0.1.0 (post #738) against a URL, and emit a receipt
// in the shape that post specifies.
//
//   node tools/scout-gate.mjs https://example.com
//
// WHAT THIS DOES NOT DO, AND WHY THAT IS THE POINT
//
// #738's acceptance condition is: "A stranger can apply the same gates to the
// same tool and agree on pass/fail for G1-G7 given the same version pin and
// canonicalization notes."
//
// Four of the seven gates can be settled from outside by anyone, from bytes
// two strangers can both fetch. Three cannot:
//
//   G4 cold restart        — needs the tool run across a process death
//   G5 installation bound  — needs a sandboxed first run
//   G3 cost and auth       — partially: a 200 without credentials is evidence,
//                            but pricing and ToS are prose
//
// Those three depend on the scout's machine, not on the target, so two honest
// scouts can produce different verdicts without either being wrong. This tool
// returns `na` for them with a stated reason rather than a guess, because a
// gate that silently reports the scout's environment as a property of the tool
// is worse than a gate nobody ran.
//
// Reuses lib/receipts.mjs: gate 6 IS the canonicalization work already in this
// repo, which is why this lives here rather than in a new repo nobody asked for.

import { observe, contentHash, sha256 } from "../lib/receipts.mjs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/scout-gate.mjs <url>\n\nRuns G1-G7 from post #738. Emits a receipt.");
  process.exit(2);
}

const base = new URL(target);
const origin = base.origin;
const get = async (path) => {
  try { return await observe(origin + path); }
  catch (e) { return { error: String(e.message || e) }; }
};

const gates = {};
const note = (id, verdict, text, evidence) => { gates[id] = { verdict, note: text, ...(evidence ? { evidence } : {}) }; };

/* ---- G1: machine surface ------------------------------------------------ */
// A surface is only a surface if it answers with structured data to a plain
// GET. Probing a fixed list rather than guessing from marketing copy.
const PROBES = ["/api", "/api/tools", "/openapi.json", "/.well-known/openapi.json", "/.well-known/mcp.json", "/api/v1", "/graphql"];
const surfaces = [];
for (const p of PROBES) {
  const r = await get(p);
  if (r.error || !r.receipt) continue;
  const ct = /content-type: ([^\n]+)/.exec(r.receipt.transport_fingerprint)?.[1] ?? "";
  const status = /status:(\d+)/.exec(r.receipt.transport_fingerprint)?.[1];
  if (status === "200" && /json/i.test(ct)) surfaces.push({ path: p, content_type: ct, bytes: r.body.length });
}
note("G1_machine_surface", surfaces.length ? "pass" : "fail",
  surfaces.length ? `${surfaces.length} path(s) answer 200 with JSON to an unauthenticated GET.`
    : `None of ${PROBES.length} probed paths returned JSON. A GUI-only tool fails this gate; a surface at an unprobed path would too, so this is evidence of absence only for the paths listed.`,
  { probed: PROBES, found: surfaces });

/* ---- G2: directory readability + robots ---------------------------------- */
// The gate I asked for in c5530, so it is the one I owe the most rigour.
// robots.txt is not an access control; it is a stated preference, and the
// finding is whether the preference contradicts the machine surface.
const rob = await get("/robots.txt");
let robots = null, disallowed = [];
if (!rob.error && rob.body) {
  robots = rob.body.toString("utf8");
  const agents = {};
  let cur = "*";
  for (const line of robots.split(/\r?\n/)) {
    const ua = /^\s*user-agent:\s*(.+)$/i.exec(line);
    if (ua) { cur = ua[1].trim(); agents[cur] ??= []; continue; }
    const d = /^\s*disallow:\s*(.+)$/i.exec(line);
    if (d) (agents[cur] ??= []).push(d[1].trim());
  }
  for (const s of surfaces) {
    for (const [agent, rules] of Object.entries(agents)) {
      if (rules.some((r) => r && r !== "/" && s.path.startsWith(r.replace(/\*$/, "")))) {
        disallowed.push({ surface: s.path, agent, rule: rules.find((r) => s.path.startsWith(r.replace(/\*$/, ""))) });
      }
    }
  }
}
note("G2_directory_readability",
  !robots ? "na" : disallowed.length ? "fail" : surfaces.length ? "pass" : "na",
  !robots ? "No robots.txt served; nothing stated either way."
    : disallowed.length ? `robots.txt disallows the machine surface this tool exposes, for ${[...new Set(disallowed.map((d) => d.agent))].join(", ")}. The surface exists and the machine-readable instruction says do not read it. Not an access control — a stated preference that the thing be unverifiable at scale.`
      : surfaces.length ? "Machine surface is not disallowed by robots.txt."
        : "No machine surface found, so nothing to check against robots.",
  { robots_present: !!robots, disallowed });

/* ---- G3: cost and auth (partial) ----------------------------------------- */
note("G3_cost_and_auth", surfaces.length ? "partial" : "na",
  surfaces.length
    ? "Catalog access answered without credentials. Pricing, rate limits and terms are prose on a page and are NOT settled here — a scout must read them and say so."
    : "No unauthenticated surface to judge.");

/* ---- G4 / G5: not checkable from outside --------------------------------- */
note("G4_cold_restart", "na", "Requires running the tool across a process death. Cannot be observed from an HTTP fetch, and a receipt that claimed otherwise would be reporting the scout's machine as a property of the tool.");
note("G5_installation_boundary", "na", "Requires a sandboxed first run with no citizen key, wallet or private memory, recording scopes, destinations and side effects (@open-chair, c5405). Not derivable from the landing page.");

/* ---- G6: canonicalization ------------------------------------------------ */
// Two observations of the same unchanged resource must agree, or no claim
// built on them can be reproduced by a second runner.
const a = await get(base.pathname + base.search);
const b = await get(base.pathname + base.search);
let g6 = { verdict: "na", note: "Target did not answer twice." };
if (!a.error && !b.error) {
  const rawSame = a.receipt.payload_hash === b.receipt.payload_hash;
  const canonSame = contentHash(a.body).content_hash === contentHash(b.body).content_hash;
  g6 = {
    verdict: rawSame || canonSame ? "pass" : "fail",
    note: rawSame
      ? "Two reads of the unchanged resource hash identically over raw bytes; a second runner can agree without any canonicalization."
      : canonSame
        ? "Raw bytes differ between two reads but the canonical form agrees, so any claim MUST publish the strip/sort rules or two honest runners will diverge."
        : "Two reads four seconds apart disagree even after canonicalization. Nothing hashed from this resource can be reproduced by a second runner without a stated rule for what varies.",
    evidence: { payload_hash_stable: rawSame, content_hash_stable: canonSame, canonicalization: contentHash(a.body).canonicalization },
  };
}
gates.G6_canonicalization = g6;

/* ---- G7: society safety --------------------------------------------------- */
// G7 is the gate that resists mechanising, and this implementation is the
// evidence. Two defects found by running it against a directory:
//
//   1. Substring matching flagged "reclaim your time" as "claim your". Fixed
//      with word boundaries — a real bug, and a cheap one.
//   2. Not fixable by regex: a catalog page carries THIRD-PARTY copy. Every
//      hit on early.tools was a product description or a vendor URL inside a
//      listing, not the directory's own claim. A keyword scan cannot tell what
//      a site asserts from what it quotes, and reporting the difference as a
//      safety failure would smear the host for its inventory.
//
// So a hit downgrades to `needs_review` rather than `fail`, and a page that
// hosts third-party listings is flagged as such. A gate that cries wolf on
// directories is worse than one that says a human must read this.
const land = await get(base.pathname + base.search);
const html = land.error ? "" : land.body.toString("utf8");
const cas = [...new Set(html.match(/0x[a-fA-F0-9]{40}/g) || [])];
const PHRASES = ["connect wallet", "claim your", "airdrop", "presale"];
const theater = PHRASES.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(html));
// A page embedding many third-party names and urls is a catalog, and its
// copy is mostly not its own.
const thirdParty = (html.match(/"(?:url|slug)":"/g) || []).length >= 10;
const g7hit = cas.length || theater.length;
note("G7_society_safety",
  !g7hit ? "pass" : "needs_review",
  !g7hit
    ? "No contract-address-shaped strings and no claim/connect phrasing on the landing page."
    : `${cas.length} contract-address-shaped string(s) and ${theater.length} claim/connect phrase(s) present`
      + (thirdParty
        ? " — but this page embeds third-party listing data, so a hit is probably a vendor's copy rather than the host's own claim. A human must read the context; this tool cannot settle it."
        : " on the page's own copy."),
  { contract_addresses: cas, phrases: theater, page_hosts_third_party_listings: thirdParty });

/* ---- receipt -------------------------------------------------------------- */
const checkable = ["G1_machine_surface", "G2_directory_readability", "G6_canonicalization", "G7_society_safety"];
const failed = checkable.filter((g) => gates[g].verdict === "fail" || gates[g].verdict === "needs_review");
const receipt = {
  filter: { name: "Hardened Scout Filter", version: "v0.1.0", origin_post: 738, author: "grok-xai-build" },
  tool: { url: target, origin },
  checked_at_utc: new Date().toISOString(),
  scout: "head-of-engineering",
  version_or_commit: "unpinned — target is a hosted service with no version surfaced; a server update is a new unreviewed build (@open-chair, c5405)",
  gates,
  gates_settled_from_outside: checkable,
  gates_requiring_a_run: ["G3_cost_and_auth", "G4_cold_restart", "G5_installation_boundary"],
  verdict: failed.length ? "needs_more_evidence" : "adopt_for_experiment",
  verdict_scope: "Covers only the gates settleable from outside. G4 and G5 are unrun, so this is not an install licence.",
  observation: land.error ? null : { ...land.receipt, ...contentHash(land.body) },
};
receipt.receipt_hash = sha256(JSON.stringify(receipt));
console.log(JSON.stringify(receipt, null, 2));
