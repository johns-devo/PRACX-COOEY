import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssessmentText,
  codesFromAssessmentProblems,
  codesFromAssessmentSubjectiveJson,
  findAssessmentQualityIssues,
  polishAssessmentLocally,
} from "../lib/assessment-note.ts";

test("builds assessment narrative with summary, problems, differentials, and plan rationale", () => {
  const text = buildAssessmentText({
    summary: "45-year-old with 3 days of worsening dyspnea, most likely uncontrolled asthma",
    problems: [
      {
        id: "1",
        diagnosis: "Unspecified asthma with (acute) exacerbation",
        code: "J45.901",
        severity: "moderate",
        status: "worsening",
        reasoning: "Wheeze history and response to albuterol support asthma over pneumonia",
        response: "Partial relief with rescue inhaler",
      },
    ],
    differentials: [
      { id: "d1", diagnosis: "Pneumonia", whyLessLikely: "no fever or productive cough" },
      { id: "d2", diagnosis: "Cardiac ischemia", whyLessLikely: "" },
    ],
    planJustification: "Start controller therapy and obtain peak flows",
  });
  assert.match(text, /most likely uncontrolled asthma/i);
  assert.match(text, /1\. J45\.901 — Unspecified asthma with \(acute\) exacerbation \(moderate, worsening\)/);
  assert.match(text, /response to albuterol/i);
  assert.match(text, /Treatment response: Partial relief with rescue inhaler/);
  assert.match(text, /Differential considerations: Pneumonia \(less likely: no fever or productive cough\); Cardiac ischemia/);
  assert.match(text, /Plan rationale: Start controller therapy and obtain peak flows/);
});

test("skips empty diagnoses when assembling assessment text", () => {
  const text = buildAssessmentText({
    problems: [{ id: "1", diagnosis: "  ", code: "I10", severity: "mild", status: "new", reasoning: "x", response: "" }],
    differentials: [{ id: "d1", diagnosis: "", whyLessLikely: "n/a" }],
  });
  assert.equal(text, "");
});

test("flags vague and objective-leak assessments", () => {
  const short = findAssessmentQualityIssues("Diagnosis: sore throat.");
  assert.ok(short.some((row) => /too short|reasoning/i.test(row.tip)));

  const leak = findAssessmentQualityIssues(
    "Acute bronchitis is likely. Lungs clear bilaterally and BP 128/82 today support a non-severe course.",
  );
  assert.ok(leak.some((row) => /Interpret exam findings|clear lungs/i.test(row.tip)));
  assert.ok(leak.some((row) => /Vitals belong in Objective/i.test(row.tip)));
});

test("extracts ICD codes from assessment problems for billing", () => {
  assert.deepEqual(codesFromAssessmentProblems([
    { id: "1", diagnosis: "Anxiety", code: "F41.1", severity: "", status: "", reasoning: "", response: "" },
    { id: "2", diagnosis: "Free text only", code: "", severity: "", status: "", reasoning: "", response: "" },
    { id: "3", diagnosis: "HTN", code: "i10", severity: "", status: "", reasoning: "", response: "" },
  ]), ["F41.1", "I10"]);
  assert.deepEqual(codesFromAssessmentSubjectiveJson(JSON.stringify({
    items: [],
    assessmentProblems: [{ id: "1", diagnosis: "URI", code: "J06.9", severity: "", status: "", reasoning: "", response: "" }],
  })), ["J06.9"]);
  assert.deepEqual(codesFromAssessmentSubjectiveJson("[]"), []);
});

test("polishAssessmentLocally capitalizes and punctuates", () => {
  const polished = polishAssessmentLocally("acute pharyngitis, likely viral. symptoms consistent with viral etiology");
  assert.match(polished, /^Acute pharyngitis/);
  assert.match(polished, /etiology\./);
});
