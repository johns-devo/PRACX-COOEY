import assert from "node:assert/strict";
import test from "node:test";
import {
  billedCoverageFields,
  coverageCoversDos,
  coverageEpisodeLabel,
  defaultBilledCoverages,
  unpaidReason,
} from "../lib/claim-coverage.ts";

test("coverage dates decide whether a policy covers the DOS", () => {
  const coverage = { effectiveDate: "2025-01-01", terminationDate: "2025-12-31", status: "active" };
  assert.equal(coverageCoversDos(coverage, "2025-06-01"), true);
  assert.equal(coverageCoversDos(coverage, "2026-01-02"), false);
  assert.equal(coverageCoversDos({ ...coverage, status: "inactive" }, "2025-06-01"), false);
});

test("defaults billed primary to the claim coverage, then EHR primary that covers DOS and is eligible", () => {
  const coverages = [
    { id: "old-bcbs", patientId: "pat1", priority: "primary", memberId: "OLD", effectiveDate: "2020-01-01", terminationDate: "2024-12-31", status: "active" },
    { id: "medicare", patientId: "pat1", priority: "primary", memberId: "MCR", effectiveDate: "2025-01-01", status: "active" },
    { id: "aetna-sec", patientId: "pat1", priority: "secondary", memberId: "SEC", effectiveDate: "2025-01-01", status: "active" },
  ];
  assert.deepEqual(defaultBilledCoverages({
    coverages,
    patientId: "pat1",
    dos: "2026-08-24",
    claimCoverageId: "medicare",
  }), { primaryId: "medicare", secondaryId: "aetna-sec", tertiaryId: "" });

  assert.deepEqual(defaultBilledCoverages({
    coverages,
    eligibility: [{ patientId: "pat1", coverageId: "medicare", status: "eligible", dateOfService: "2026-08-24" }],
    patientId: "pat1",
    dos: "2026-08-24",
  }), { primaryId: "medicare", secondaryId: "aetna-sec", tertiaryId: "" });
});

test("keeps older policies listed in the label even when they do not cover DOS", () => {
  const label = coverageEpisodeLabel({
    coverage: { memberId: "OLD", priority: "primary", effectiveDate: "2020-01-01", terminationDate: "2024-12-31" },
    payerName: "BCBS",
    planName: "PPO",
    dos: "2026-08-24",
  });
  assert.match(label, /BCBS/);
  assert.match(label, /outside DOS/);
  assert.match(label, /OLD/);
});

test("copies subscriber fields onto the claim without rewriting patient history", () => {
  assert.deepEqual(billedCoverageFields({
    memberId: "MCR1",
    groupNumber: "",
    relationship: "self",
    subscriberFirstName: "Ada",
    subscriberLastName: "Smith",
    acceptAssignment: "yes",
  }).memberId, "MCR1");
});

test("unpaid reason prefers ERA denial codes, then follow-up denied, then scrub", () => {
  assert.equal(unpaidReason({ denialCodes: ["CO-16"] }), "Denial CO-16");
  assert.equal(unpaidReason({ followUpStatus: "denied" }), "Marked denied — no ERA code on file");
  assert.equal(unpaidReason({ scrubErrors: ["Box 21 is empty."] }), "Box 21 is empty.");
  assert.equal(unpaidReason({}), "No payment after response window");
});
