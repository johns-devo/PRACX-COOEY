import assert from "node:assert/strict";
import test from "node:test";
import {
  box22ScrubIssues,
  scrubFindingLabel,
  storedBillFrequencyCode,
} from "../lib/claim-workflow.ts";

test("treats 837 frequency 1 as an original CMS-1500 claim", () => {
  assert.equal(storedBillFrequencyCode("1"), null);
  assert.equal(storedBillFrequencyCode(""), null);
  assert.equal(storedBillFrequencyCode("7"), "7");
  assert.deepEqual(box22ScrubIssues("1", null), []);
  assert.deepEqual(box22ScrubIssues("", ""), []);
  assert.equal(box22ScrubIssues("7", "").length, 1);
  assert.equal(box22ScrubIssues("9", "").some((issue) => issue.message.includes("Unsupported")), true);
});

test("shows Box numbers instead of ERR codes to billers", () => {
  assert.equal(scrubFindingLabel({ box: "22", field: "resubmission reference" }), "Box 22");
  assert.equal(scrubFindingLabel({ box: "", field: "Member ID" }), "Member ID");
});
