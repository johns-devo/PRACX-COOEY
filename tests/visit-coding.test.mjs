import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModifierToProcedures,
  assessmentCodingSignalsFromNote,
  bloodPressureQualityCodes,
  buildVisitCodingSuggestions,
  suggestMdmLevelFromAssessment,
  suggestOfficeVisitByAssessment,
  suggestOfficeVisitByTime,
} from "../lib/visit-coding.ts";

test("suggests established office visit codes from documented time", () => {
  assert.equal(suggestOfficeVisitByTime(12)?.code, "99212");
  assert.equal(suggestOfficeVisitByTime(25)?.code, "99213");
  assert.equal(suggestOfficeVisitByTime(35)?.code, "99214");
  assert.equal(suggestOfficeVisitByTime(45)?.code, "99215");
});

test("builds template, counseling, order and modifier suggestions for clinician confirm", () => {
  const rows = buildVisitCodingSuggestions({
    templateName: "WELCOME TO Medicare AWV (male)-1st mawv with ekg",
    templateCategory: "Medicare wellness",
    templateProcedureCodes: ["G0402", "G0403"],
    visitTimeMinutes: 30,
    counselingKeys: ["diet", "tobacco"],
    orderCodes: ["93000"],
  });
  const codes = rows.map((row) => row.code);
  assert.ok(codes.includes("G0402"));
  assert.ok(codes.includes("G0403"));
  assert.ok(codes.includes("Z71.3"));
  assert.ok(codes.includes("99407") || codes.includes("99406"));
  assert.ok(codes.includes("93000"));
  assert.ok(codes.includes("99214"));
  assert.ok(codes.includes("25"));
  assert.equal(rows.find((row) => row.code === "25")?.selected, false);
});

test("applies modifiers onto E/M and preventive procedure codes", () => {
  assert.deepEqual(applyModifierToProcedures(["99214", "G0402", "93000"], ["25"]), ["99214-25", "G0402-25", "93000"]);
});

test("maps blood pressure bands to Category II quality codes", () => {
  assert.deepEqual(
    bloodPressureQualityCodes(118, 72).map((row) => row.code),
    ["3074F", "3078F"],
  );
  assert.deepEqual(
    bloodPressureQualityCodes(135, 84).map((row) => row.code),
    ["3075F", "3079F"],
  );
  assert.deepEqual(
    bloodPressureQualityCodes(150, 92).map((row) => row.code),
    ["3077F", "3080F"],
  );
});

test("suggests Category II quality codes from vitals, meds, falls and incontinence", () => {
  const rows = buildVisitCodingSuggestions({
    counselingKeys: ["fall_risk"],
    qualityKeys: ["incontinence_assessed"],
    systolic: 122,
    diastolic: 76,
    medicationsReviewed: true,
    hasMedicationList: true,
  });
  const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
  assert.equal(byCode["0518F"]?.kind, "quality");
  assert.equal(byCode["0518F"]?.reason, "From fall plan of care");
  assert.equal(byCode["1090F"]?.kind, "quality");
  assert.equal(byCode["1090F"]?.reason, "From incontinence assessment");
  assert.equal(byCode["1159F"]?.kind, "quality");
  assert.equal(byCode["1160F"]?.kind, "quality");
  assert.equal(byCode["3074F"]?.kind, "quality");
  assert.equal(byCode["3078F"]?.kind, "quality");
  assert.ok(!rows.some((row) => row.code === "3077F"));
});

test("maps Assessment severity and differentials into MDM-ish office visit levels", () => {
  const mild = assessmentCodingSignalsFromNote({
    problems: [{ diagnosis: "Essential hypertension", code: "I10", severity: "mild", status: "stable" }],
  });
  assert.equal(suggestMdmLevelFromAssessment(mild), 2);
  assert.equal(suggestOfficeVisitByAssessment(mild)?.code, "99212");

  const moderateComplex = assessmentCodingSignalsFromNote({
    problems: [
      { diagnosis: "Type 2 diabetes", code: "E11.9", severity: "moderate", status: "worsening" },
      { diagnosis: "CKD stage 3", code: "N18.3", severity: "moderate", status: "stable" },
    ],
    differentials: [{ diagnosis: "Medication nonadherence" }],
  });
  assert.equal(suggestMdmLevelFromAssessment(moderateComplex), 4);
  assert.equal(suggestOfficeVisitByAssessment(moderateComplex)?.code, "99214");
});

test("prefers higher of time-based and Assessment-based E/M suggestions", () => {
  const signals = assessmentCodingSignalsFromNote({
    problems: [
      { diagnosis: "Acute chest pain", code: "R07.9", severity: "severe", status: "new" },
      { diagnosis: "Hypertension", code: "I10", severity: "moderate", status: "uncontrolled" },
    ],
    differentials: [{ diagnosis: "ACS" }, { diagnosis: "GERD" }, { diagnosis: "Anxiety" }],
    planJustification: "ER referral considered; ECG reviewed.",
    diagnosticNotes: "ECG nonspecific; troponin pending.",
  });
  const rows = buildVisitCodingSuggestions({
    visitTimeMinutes: 12,
    assessmentSignals: signals,
  });
  const em = rows.find((row) => ["99212", "99213", "99214", "99215"].includes(row.code));
  assert.ok(em);
  assert.ok(["99214", "99215"].includes(em.code));
  assert.match(em.reason, /Assessment complexity/i);
});
