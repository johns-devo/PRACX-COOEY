import assert from "node:assert/strict";
import test from "node:test";
import { DIAGNOSIS_CODE_SEEDS, uniqueDiagnosisCodeSeeds } from "../lib/diagnosis-code-seeds.ts";

test("diagnosis seed catalog is substantial and unique by code", () => {
  const unique = uniqueDiagnosisCodeSeeds();
  assert.ok(DIAGNOSIS_CODE_SEEDS.length >= 100);
  assert.ok(unique.length >= 100);
  assert.equal(unique.length, new Set(unique.map(([, code]) => code.toUpperCase())).size);
  assert.ok(unique.some(([, code]) => code === "I10"));
  assert.ok(unique.some(([, code]) => code === "J45.909"));
  assert.ok(unique.some(([, code]) => code === "N39.0"));
});
