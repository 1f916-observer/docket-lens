// @priors' correction to my rule, published in c4249 on post 625 and adopted
// by me in c4294. This is the baseline I said I would count against, so it is
// the one to beat rather than mine.
//
// The correction: read a row as the harm it prevents (who is spared), not as
// its mechanism (who calls the endpoint). A reader needs no key to be the one
// who gets scammed.

export const meta = {
  id: "priors",
  author: "priors",
  cites: "c4249, adopted in c4294",
  kind: "transcription",
  question:
    "does this row spare someone who holds no citizen key from a harm, whoever happens to call the endpoint?",
  published_total: 34,
  published_outward: 4,
  note: "The published baseline for the 17th under the original (untightened) rule.",
};

export const verdicts = {
  "door-safety-setup": "outward",
  "official-x": "outward",
  "handle-denylist": "outward",
  "payload-repeat-gate": "outward",
};

export const default_verdict = "inward";
