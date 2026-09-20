import assert from "node:assert/strict";
import test from "node:test";
import {
  applySpecialtyStarter,
  buildPhysicalExamText,
  findSubjectiveObjectiveIssues,
  groupExamFindingsBySystem,
  isObjectiveVerifiedForDos,
  OBJECTIVE_SPECIALTY_STARTERS,
  polishObjectiveLocally,
} from "../lib/objective-exam.ts";

test("builds system-based physical exam text with abnormals first", () => {
  const text = buildPhysicalExamText({
    examNormalSystems: ["cardiovascular", "skin"],
    examFindings: [
      { id: "1", system: "respiratory", finding: "Wheezing", status: "abnormal", detail: "bilateral" },
      { id: "2", system: "musculoskeletal", finding: "Knee flexion 90 degrees", status: "normal" },
      { id: "3", system: "respiratory", finding: "No crackles", status: "normal" },
    ],
    generalAppearance: "Alert and oriented ×3",
    clinicGlucose: "148",
    diagnosticNotes: "CBC WBC 11.2; CXR no infiltrate",
  });
  assert.match(text, /General appearance: Alert and oriented ×3\./);
  assert.match(text, /Respiratory: Wheezing — bilateral\. No crackles\./);
  assert.match(text, /Musculoskeletal: Knee flexion 90 degrees\./);
  assert.match(text, /Cardiovascular: Regular rate and rhythm/);
  assert.match(text, /Skin: No rash/);
  assert.doesNotMatch(text, /WNL|Normal examination/);
  assert.match(text, /Clinic glucose: 148 mg\/dL\./);
  assert.match(text, /Diagnostic \/ lab data reviewed today: CBC WBC 11\.2; CXR no infiltrate/);
  assert.ok(text.indexOf("Respiratory:") < text.indexOf("Cardiovascular:"));
});

test("objective DOS attestation requires matching date", () => {
  assert.equal(isObjectiveVerifiedForDos("2026-08-04", "2026-08-04"), true);
  assert.equal(isObjectiveVerifiedForDos("2026-08-03", "2026-08-04"), false);
  assert.equal(isObjectiveVerifiedForDos("", "2026-08-04"), false);
});

test("flags subjective wording in objective text", () => {
  const issues = findSubjectiveObjectiveIssues("Patient seems anxious. Lungs WNL. Looks better.");
  assert.ok(issues.length >= 2);
  assert.ok(issues.some((row) => /seems/i.test(row.tip)));
  assert.ok(issues.some((row) => /WNL/i.test(row.tip)));
});

test("polishObjectiveLocally shortens and strips opinion words", () => {
  const polished = polishObjectiveLocally("seems better. lungs WNL. gait steady");
  assert.doesNotMatch(polished, /\bseems\b|\bWNL\b/i);
  assert.match(polished, /Gait steady/i);
});

test("specialty starters replace exam instead of stacking systems", () => {
  const mental = OBJECTIVE_SPECIALTY_STARTERS.find((row) => row.id === "mental_health");
  const therapy = OBJECTIVE_SPECIALTY_STARTERS.find((row) => row.id === "physical_therapy");
  assert.ok(mental && therapy);
  const first = applySpecialtyStarter({ examNormalSystems: ["abdomen"], examFindings: [{ id: "old", system: "abdomen", finding: "Soft", status: "normal" }], diagnosticNotes: "", clinicianObservation: "" }, mental);
  assert.ok(first.examFindings.every((row) => row.system !== "abdomen"));
  const second = applySpecialtyStarter(first, therapy);
  assert.equal(second.examFindings.every((row) => row.system === "musculoskeletal"), true);
  assert.ok(second.examFindings.some((row) => /ROM left knee/i.test(row.finding)));
  assert.match(second.clinicianObservation, /Pain score/i);
});

test("groups multiple findings under one system", () => {
  const groups = groupExamFindingsBySystem([
    { id: "1", system: "psychiatric", finding: "Affect flat", status: "abnormal" },
    { id: "2", system: "psychiatric", finding: "Eye contact limited", status: "abnormal" },
    { id: "3", system: "abdomen", finding: "Soft, no tenderness", status: "normal" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].system, "psychiatric");
  assert.equal(groups[0].items.length, 2);
});
