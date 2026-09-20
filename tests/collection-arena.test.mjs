import assert from "node:assert/strict";
import test from "node:test";
import {
  agingBucket,
  buildCollectionRows,
  claimAgeDays,
  detectInsuranceGaps,
  filterCollectionRows,
  isDueForCollectionArena,
  isOutstandingClaim,
  isSubmittedForFollowUp,
} from "../lib/collection-arena.ts";
import { lifecycleAfterFollowUpRebill, lifecycleAfterRebill } from "../lib/claim-lifecycle.ts";

const asOf = new Date("2026-09-10T00:00:00");

test("outstanding means open balance, not closed or voided", () => {
  assert.equal(isOutstandingClaim({ remainingBalance: "145", lifecycleStatus: "sent_to_pri" }), true);
  assert.equal(isOutstandingClaim({ remainingBalance: "0", lifecycleStatus: "sent_to_pri" }), false);
  assert.equal(isOutstandingClaim({ remainingBalance: "80", lifecycleStatus: "closed" }), false);
});

test("unsigned or unsent claims stay out of Collection Arena", () => {
  assert.equal(isSubmittedForFollowUp({ lifecycleStatus: "bill_to_pri", remainingBalance: "145" }), false);
  assert.equal(isSubmittedForFollowUp({ lifecycleStatus: "sent_to_pri", remainingBalance: "145" }), true);
  assert.equal(isDueForCollectionArena({
    remainingBalance: "145",
    lifecycleStatus: "sent_to_pri",
    lastBilledDate: "2026-09-05",
  }, 12, asOf), false);
  assert.equal(isDueForCollectionArena({
    remainingBalance: "145",
    lifecycleStatus: "sent_to_pri",
    lastBilledDate: "2026-08-24",
  }, 12, asOf), true);
});

test("aging uses last billed date, then first billed, then DOS", () => {
  assert.equal(claimAgeDays({ lastBilledDate: "2026-08-10", dateOfService: "2026-07-01" }, asOf), 31);
  assert.equal(agingBucket(12), "0-30");
  assert.equal(agingBucket(91), "91+");
});

test("detects unused secondary and eligibility gaps without changing lifecycle", () => {
  const gaps = detectInsuranceGaps({
    claim: {
      patientId: "pat1",
      dateOfService: "2026-08-24",
      remainingBalance: "230",
      lifecycleStatus: "sent_to_pri",
    },
    coverages: [
      { id: "cov1", patientId: "pat1", planId: "plan1", priority: "primary", memberId: "A1", status: "active" },
      { id: "cov2", patientId: "pat1", planId: "plan2", priority: "secondary", memberId: "B2", status: "active" },
    ],
    plans: [{ id: "plan1", timelyFilingDays: "90", requiresAuthorization: "no" }],
    eligibility: [],
    asOf,
  });
  assert.ok(gaps.includes("unused_secondary"));
  assert.ok(gaps.includes("eligibility_gap"));
});

test("arena only lists submitted claims past the payer response days", () => {
  const rows = buildCollectionRows({
    claims: [
      { id: "1", patientId: "pat1", payerId: "pay1", dateOfService: "2026-08-24", lastBilledDate: "2026-08-24", remainingBalance: "230", lifecycleStatus: "sent_to_pri" },
      { id: "2", patientId: "pat1", payerId: "pay1", dateOfService: "2026-09-08", lastBilledDate: "2026-09-08", remainingBalance: "145", lifecycleStatus: "sent_to_pri" },
      { id: "3", patientId: "pat1", payerId: "pay1", dateOfService: "2026-08-01", remainingBalance: "145", lifecycleStatus: "bill_to_pri" },
      { id: "4", patientId: "pat1", payerId: "pay1", dateOfService: "2026-08-01", remainingBalance: "0", lifecycleStatus: "closed" },
    ],
    coverages: [{ patientId: "pat1", planId: "plan1", priority: "primary", memberId: "A1", status: "active" }],
    plans: [{ id: "plan1", timelyFilingDays: "90", requiresAuthorization: "no" }],
    eligibility: [{ patientId: "pat1", dateOfService: "2026-08-24", status: "eligible", checkedAt: "2026-08-20" }],
    payers: [{ id: "pay1", responseDays: "12" }],
    asOf,
  });
  assert.deepEqual(rows.map((row) => row.claim.id), ["1"]);
  assert.equal(rows[0]?.responseDays, 12);
  assert.equal(filterCollectionRows(rows, { party: "pri" }).length, 1);
});

test("follow-up rebill is allowed from sent as well as denied", () => {
  assert.equal(lifecycleAfterRebill("sent_to_pri"), null);
  assert.equal(lifecycleAfterFollowUpRebill("sent_to_pri"), "rebill_to_pri");
  assert.equal(lifecycleAfterFollowUpRebill("denied_sec"), "rebill_to_sec");
});
