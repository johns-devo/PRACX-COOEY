import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_SECTIONS,
  DEFAULT_CARE_CHECKLIST,
  FLOWSHEET_METRICS,
  isChartSectionId,
} from "../lib/patient-chart.ts";

test("chart left-nav includes the full industry section set", () => {
  const labels = CHART_SECTIONS.map((row) => row.label);
  assert.deepEqual(labels, [
    "Facesheet",
    "History",
    "Problems",
    "Medications",
    "Immunizations",
    "Allergies",
    "Vitals",
    "Notes",
    "Labs/Studies",
    "Flowsheets",
    "Demographics",
    "Account",
    "Care Checklist",
    "Documents",
    "Recall",
  ]);
  assert.equal(CHART_SECTIONS.length, 15);
  assert.equal(isChartSectionId("facesheet"), true);
  assert.equal(isChartSectionId("billing"), false);
});

test("care checklist and flowsheet defaults are seeded for chart modules", () => {
  assert.ok(DEFAULT_CARE_CHECKLIST.length >= 8);
  assert.ok(DEFAULT_CARE_CHECKLIST.some((row) => row.itemKey === "allergies_reviewed"));
  assert.ok(FLOWSHEET_METRICS.some((row) => row.key === "a1c"));
  assert.ok(FLOWSHEET_METRICS.some((row) => row.key === "systolic"));
});
