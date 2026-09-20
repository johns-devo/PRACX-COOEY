import assert from "node:assert/strict";
import test from "node:test";
import { mergeHpiTranscript, polishHpiLocally } from "../lib/hpi-assist.ts";

test("polishes dictated HPI without inventing clinical content", () => {
  const polished = polishHpiLocally("um patient says chest congestion for four days uh worse at night dont have fever");
  assert.match(polished, /patient/i);
  assert.match(polished, /chest congestion/i);
  assert.doesNotMatch(polished, /\bum\b/i);
  assert.doesNotMatch(polished, /\buh\b/i);
});

test("repairs common ASR medical mishearings into clinical HPI", () => {
  const polished = polishHpiLocally(
    "Asian came with. Fever and just condition. Having mild Singh. Hand pain. Patient also having fever.",
  );
  assert.match(polished, /^The patient presents with /i);
  assert.match(polished, /fever/i);
  assert.match(polished, /chest congestion/i);
  assert.match(polished, /mild wheezing/i);
  assert.match(polished, /hand pain/i);
  assert.doesNotMatch(polished, /\bAsian\b/i);
  assert.doesNotMatch(polished, /\bSingh\b/i);
  assert.doesNotMatch(polished, /\bjust condition\b/i);
  // fever should not be listed twice
  assert.equal((polished.toLowerCase().match(/\bfever\b/g) || []).length, 1);
});

test("merges new transcript onto existing HPI", () => {
  assert.equal(
    mergeHpiTranscript("Congestion for 4 days.", "Worse at night"),
    "Congestion for 4 days. Worse at night",
  );
  assert.equal(mergeHpiTranscript("", "Congestion for 4 days"), "Congestion for 4 days");
});
