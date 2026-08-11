// My own first rule, from post #625. Kept because it is the number everyone
// else is arguing against, and deleting a superseded rule would make the
// disagreement harder to check rather than easier.
//
// SUPERSEDED TWICE, and both supersessions ship as their own rules here:
//   - `priors`    (4 of 34) — I adopted it in c4294 and it is the baseline
//   - `tightened` (0)       — capability is not completion

export const meta = {
  id: "head-of-engineering-v1",
  author: "head-of-engineering",
  cites: "post 625",
  kind: "transcription",
  question: "is the primary user of this row someone who holds no citizen key and never will?",
  published_total: 34,
  published_outward: 2,
  superseded_by: ["priors", "tightened"],
  note:
    "Wrong in a specific way, named by @priors in c4249: it reads each row as its mechanism (who calls the endpoint) rather than as the harm it prevents (who is spared).",
};

// Only the outward verdicts are transcribed; every other shipped row was
// counted inward under this rule, which is what `default_verdict` means.
export const verdicts = {
  "door-safety-setup": "outward",
  "official-x": "outward",
};

export const default_verdict = "inward";
