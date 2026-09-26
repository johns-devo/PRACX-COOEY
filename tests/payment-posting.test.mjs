import assert from "node:assert/strict";
import test from "node:test";
import { eraMappingError, validatePaymentTotals } from "../lib/payment-posting.ts";
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethod, paymentMethodDetails } from "../lib/payment-posting.ts";

test("payment methods round trip without becoming checks", () => {
  for (const method of PAYMENT_METHOD_OPTIONS) assert.equal(normalizePaymentMethod(method), method);
});

test("card details require a valid brand and accept only last four digits", () => {
  assert.throws(() => paymentMethodDetails("Credit Card", { cardBrand: "Visa", cardLast4: "1234567890123456" }), /four digits/);
  assert.throws(() => paymentMethodDetails("Debit Card", { cardBrand: "invalid" }), /brand/);
  const result = paymentMethodDetails("Credit Card", { cardBrand: "Visa", cardLast4: "1234", cvv: "123", cardNumber: "1234567890123456" });
  assert.equal(result.cardLast4, "1234");
  assert.equal(result.cvv, undefined);
  assert.equal(result.cardNumber, undefined);
});

test("switching to cash does not retain card metadata", () => {
  assert.deepEqual(paymentMethodDetails("Cash", { cardBrand: "Visa", cardLast4: "1234" }), {});
});

test("zero-dollar unmatched denials still block ERA posting", () => {
  assert.match(eraMappingError('[{"paidAmount":"0.00"}]'), /1 unmatched/);
});

test("invalid mapping records fail closed", () => {
  for (const value of ["broken", "null", "{}", "false"]) {
    assert.match(eraMappingError(value), /invalid/);
  }
  assert.equal(eraMappingError("[]"), null);
});

test("ERA reconciliation compares cash with the effective check amount", () => {
  const result = validatePaymentTotals({ paymentMethod: "ERA", paymentAmount: "100", claimPayments: [{ paidAmount: "100", adjustmentAmount: "50" }] });
  assert.equal(result.matched, true);
});

test("a one-cent discrepancy blocks posting", () => {
  assert.equal(validatePaymentTotals({ paymentMethod: "ERA", paymentAmount: "100", claimPayments: [{ paidAmount: "99.99" }] }).matched, false);
});

test("a documented offset can reconcile a zero check", () => {
  assert.equal(validatePaymentTotals({ paymentMethod: "ERA", paymentAmount: "0", offsetAmount: "100", claimPayments: [{ paidAmount: "100" }] }).matched, true);
});
