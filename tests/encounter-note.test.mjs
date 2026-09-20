import assert from "node:assert/strict";
import test from "node:test";
import { buildEncounterNoteDraft, encounterNoteGaps } from "../lib/encounter-note.ts";

test("assembled note includes allergies, time, and flowing clinical language", () => {
  const note = buildEncounterNoteDraft({
    patientName: "Jane Doe",
    providerName: "Dr. Smith",
    dateOfService: "2026-08-04",
    chiefComplaint: "annual wellness visit",
    historyOfPresentIllness: "Patient reports feeling well overall with no acute complaints today.",
    treatmentPlan: "Continue current preventive care plan and age-appropriate screenings.",
    visitTimeMinutes: "25",
    allergiesReviewed: true,
    medicationsReviewed: false,
    systolic: "118",
    diastolic: "72",
    subjective: { source: "patient", interpreter: "no" },
    allergies: [{ id: "a1", patientId: "p1", allergyType: "environmental", substance: "dust", reaction: "sneezing", severity: "mild", status: "active" }],
    medications: [],
  });

  assert.match(note, /Allergies: dust \(environmental; reaction: sneezing; mild severity\)/);
  assert.match(note, /Total time spent on the date of the encounter was 25 minutes/);
  assert.match(note, /History of present illness:/);
  assert.match(note, /Vital signs today:.*blood pressure 118\/72 mm Hg/);
  assert.match(note, /Allergy list was reviewed and reconciled/);
  assert.doesNotMatch(note, /SAFETY REVIEW\nAllergy status is not documented/);
});

test("encounter note gaps ignore plan when time attestation is present", () => {
  const gaps = encounterNoteGaps({
    patientName: "Jane Doe",
    providerName: "Dr. Smith",
    dateOfService: "2026-08-04",
    chiefComplaint: "fatigue",
    historyOfPresentIllness: "Fatigue for two weeks.",
    assessment: "Fatigue, unspecified.",
    physicalExam: "No acute distress.",
    visitTimeMinutes: "25",
    subjective: {},
    allergies: [],
    medications: [],
  });
  assert.ok(!gaps.includes("Plan"));
});
