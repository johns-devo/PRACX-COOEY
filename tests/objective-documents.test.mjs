import assert from "node:assert/strict";
import test from "node:test";
import {
  collectVisitAiDiagnosticSummaries,
  formatProviderHeadsUp,
  formatVisitAiSummariesForPlan,
  hasUrgentDocumentHeadsUp,
  isSameDayClinicalDocument,
  mergePlanRationaleWithAiSummary,
} from "../lib/objective-documents.ts";

test("same-day clinical documents match DOS by serviceDate or upload date", () => {
  assert.equal(isSameDayClinicalDocument({
    category: "lab_result",
    serviceDate: "2026-08-04",
    createdAt: "2026-08-01T10:00:00Z",
    status: "active",
  }, "2026-08-04"), true);

  assert.equal(isSameDayClinicalDocument({
    category: "imaging_report",
    serviceDate: "",
    createdAt: "2026-08-04T15:00:00Z",
    status: "active",
  }, "2026-08-04"), true);

  assert.equal(isSameDayClinicalDocument({
    category: "lab_result",
    serviceDate: "2026-08-01",
    createdAt: "2026-08-01T10:00:00Z",
    status: "active",
  }, "2026-08-04"), false);

  assert.equal(isSameDayClinicalDocument({
    category: "insurance_card",
    serviceDate: "2026-08-04",
    createdAt: "2026-08-04T10:00:00Z",
    status: "active",
  }, "2026-08-04"), false);
});

test("formats AI analysis as a provider heads-up with urgent items first", () => {
  const text = formatProviderHeadsUp(JSON.stringify({
    summary: "Fasting glucose elevated. TSH within printed reference range.",
    headsUp: "Review elevated fasting glucose today.",
    urgentFindings: ["Glucose 248 mg/dL (critical_high)"],
    notableValues: [
      { label: "Glucose", value: "248 mg/dL", flag: "critical_high", note: "" },
      { label: "TSH", value: "1.9", flag: "normal", note: "" },
    ],
    limitations: ["Handwritten area partially illegible"],
  }));
  assert.match(text, /HEADS-UP: Glucose 248/);
  assert.match(text, /Fasting glucose elevated/);
  assert.match(text, /Glucose: 248 mg\/dL \(critical_high\)/);
  assert.match(text, /Limitations:/);
  assert.equal(hasUrgentDocumentHeadsUp(JSON.stringify({ urgentFindings: ["x"], headsUp: "" })), true);
  assert.equal(hasUrgentDocumentHeadsUp(JSON.stringify({ summary: "ok" })), false);
});

test("collects same-day AI lab summaries for plan rationale", () => {
  const rows = collectVisitAiDiagnosticSummaries({
    patientId: "pat_1",
    dateOfService: "2026-08-04",
    documents: [
      {
        id: "doc_1",
        patientId: "pat_1",
        category: "lab_result",
        title: "CMP",
        serviceDate: "2026-08-04",
        status: "active",
        analysisJson: JSON.stringify({
          summary: "Creatinine mildly elevated.",
          headsUp: "Review renal function before contrast.",
          urgentFindings: [],
          notableValues: [{ label: "Creatinine", value: "1.5", flag: "high", note: "" }],
          limitations: [],
        }),
      },
      {
        id: "doc_old",
        patientId: "pat_1",
        category: "lab_result",
        title: "Old CBC",
        serviceDate: "2026-07-01",
        status: "active",
        analysisJson: JSON.stringify({ summary: "Ignore", headsUp: "x", urgentFindings: [], notableValues: [], limitations: [] }),
      },
    ],
    diagnosticNotes: "Clinic glucose 148 mg/dL.",
  });
  assert.equal(rows.length, 2);
  assert.match(rows[0].text, /Creatinine/);
  assert.match(rows[1].title, /Objective diagnostic notes/);
  const combined = formatVisitAiSummariesForPlan(rows);
  assert.match(combined, /Lab result: CMP/);
  const merged = mergePlanRationaleWithAiSummary("Start ACE inhibitor.", combined);
  assert.match(merged, /Start ACE inhibitor/);
  assert.match(merged, /Labs & reports \(AI draft — verify\)/);
  assert.equal(mergePlanRationaleWithAiSummary(merged, combined), merged);
});
