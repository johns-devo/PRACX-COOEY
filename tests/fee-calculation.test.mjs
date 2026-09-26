import test from "node:test";
import assert from "node:assert/strict";
import { calculatePracticeCharge } from "../lib/fee-calculation.ts";

test("practice charge multiplier supports Medicare benchmark and expected cents", () => {
  assert.equal(calculatePracticeCharge(100, 150, "cent"), "150.00");
  assert.equal(calculatePracticeCharge(21.71, 200, "cent"), "43.42");
});

test("practice charge rounding applies after multiplier", () => {
  assert.equal(calculatePracticeCharge(101.24, 150, "dollar"), "152.00");
  assert.equal(calculatePracticeCharge(101.24, 150, "five"), "150.00");
  assert.equal(calculatePracticeCharge(101.24, 150, "ten"), "150.00");
});

test("invalid multipliers and negative rates are rejected", () => {
  assert.throws(() => calculatePracticeCharge(-1, 150, "cent"));
  assert.throws(() => calculatePracticeCharge(1, 0, "cent"));
});
