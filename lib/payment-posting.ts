export type PaymentMethod = "Cash" | "Credit Card" | "Debit Card" | "HSA/FSA Card" | "Virtual Card" | "Digital Wallet" | "Check" | "Cashier's Check" | "Money Order" | "EFT" | "ACH" | "Wire Transfer" | "Online Payment" | "Other" | "ERA" | "Paper EOB";
export type PaymentEntryStatus = "pending" | "partially_posted" | "fully_posted" | "error";
export type ClaimPaymentPostingStatus = "pending" | "posted" | "error";
export type PaymentLogAction = "Create" | "Populate" | "AutoPost" | "ManualPost" | "Error" | "Correction";

export const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = ["Cash", "Credit Card", "Debit Card", "HSA/FSA Card", "Virtual Card", "Digital Wallet", "Check", "Cashier's Check", "Money Order", "EFT", "ACH", "Wire Transfer", "Online Payment", "Other", "ERA", "Paper EOB"];
export const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Discover", "JCB", "UnionPay", "Diners Club", "Other", "Unknown"];
export const CARD_METHODS = ["Credit Card", "Debit Card", "HSA/FSA Card", "Virtual Card"];

export function paymentMethodDetails(method: PaymentMethod, input: Record<string, unknown>) {
  const text = (key: string) => String(input[key] || "").trim().slice(0, 120);
  const details: Record<string, string> = {};
  if (CARD_METHODS.includes(method)) {
    if (!CARD_BRANDS.includes(text("cardBrand"))) throw new Error("Select the card brand, or Unknown.");
    if (text("cardLast4") && !/^\d{4}$/.test(text("cardLast4"))) throw new Error("Card last four must contain exactly four digits.");
    details.cardBrand = text("cardBrand");
    details.cardLast4 = text("cardLast4");
    details.authorizationCode = text("authorizationCode");
    details.processor = text("processor");
  }
  if (method === "Digital Wallet") details.walletProvider = text("walletProvider");
  if (["Check", "Cashier's Check", "Money Order", "EFT", "ACH", "Wire Transfer"].includes(method)) details.bankName = text("bankName");
  if (method === "Online Payment") details.processor = text("processor");
  if (method === "Other") {
    if (!text("otherMethod")) throw new Error("Describe the other payment method.");
    details.otherMethod = text("otherMethod");
  }
  return details;
}

/** Fail closed when a saved ERA mapping cannot be verified. */
export function eraMappingError(unmatchedJson: string | null | undefined): string | null {
  try {
    const rows = JSON.parse(unmatchedJson || "[]");
    if (!Array.isArray(rows)) return "ERA mapping data is invalid. Review the ERA before posting.";
    return rows.length ? `${rows.length} unmatched ERA claim(s). Map every claim before posting.` : null;
  } catch {
    return "ERA mapping data is invalid. Review the ERA before posting.";
  }
}

export const PAYMENT_ENTRY_STATUS_LABELS: Record<PaymentEntryStatus, string> = {
  pending: "Pending Posting",
  partially_posted: "Partially Posted",
  fully_posted: "Fully Posted",
  error: "Error",
};

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  const raw = String(value || "").trim();
  const exact = PAYMENT_METHOD_OPTIONS.find((method) => method.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes("check")) return "Check";
  if (lower.includes("eft") || lower.includes("ach")) return "EFT";
  if (lower.includes("era") || lower.includes("835")) return "ERA";
  if (lower.includes("eob") || lower.includes("paper")) return "Paper EOB";
  return "Check";
}

export function isManualPaperEob(method: PaymentMethod) {
  return method === "Paper EOB";
}

export function moneyNumber(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function moneyFixed(value: unknown) {
  return moneyNumber(value).toFixed(2);
}

export function amountsMatch(left: unknown, right: unknown, tolerance = 0.009) {
  return Math.abs(moneyNumber(left) - moneyNumber(right)) <= tolerance;
}

export function claimOutstandingBalance(claim: {
  totalCharge?: string | number | null;
  totalPaid?: string | number | null;
  totalAdjustment?: string | number | null;
}) {
  return Math.max(
    0,
    moneyNumber(claim.totalCharge) - moneyNumber(claim.totalPaid) - moneyNumber(claim.totalAdjustment),
  );
}

export function calculatePaymentTotalEffective(input: {
  paymentAmount?: string | number | null;
  offsetAmount?: string | number | null;
  refundAmount?: string | number | null;
  incentiveAmount?: string | number | null;
  otherAdjustments?: string | number | null;
}) {
  return Number((
    moneyNumber(input.paymentAmount)
    + moneyNumber(input.offsetAmount)
    + moneyNumber(input.refundAmount)
    + moneyNumber(input.incentiveAmount)
    + moneyNumber(input.otherAdjustments)
  ).toFixed(2));
}

export function sumClaimPostedAmounts(rows: Array<{
  paidAmount?: string | number | null;
  adjustmentAmount?: string | number | null;
}>) {
  return Number(rows.reduce((sum, row) => (
    sum + moneyNumber(row.paidAmount) + moneyNumber(row.adjustmentAmount)
  ), 0).toFixed(2));
}

/** ERA check amounts are cash-only; CAS adjustments are adjudication, not money
 * drawn from the EFT/check and must not be compared to the ERA BPR amount. */
export function sumClaimCashAmounts(rows: Array<{ paidAmount?: string | number | null }>) {
  return Number(rows.reduce((sum, row) => sum + moneyNumber(row.paidAmount), 0).toFixed(2));
}

/** @deprecated use sumClaimPostedAmounts */
export function sumClaimPaidAmounts(rows: Array<{ paidAmount?: string | number | null }>) {
  return rows.reduce((sum, row) => sum + moneyNumber(row.paidAmount), 0);
}

export function validatePaymentTotals(input: {
  paymentAmount?: string | number | null;
  offsetAmount?: string | number | null;
  refundAmount?: string | number | null;
  incentiveAmount?: string | number | null;
  otherAdjustments?: string | number | null;
  paymentTotalEffective?: string | number | null;
  paymentMethod?: string | null;
  claimPayments: Array<{
    id?: string;
    claimId?: string;
    claimNumber?: string;
    paidAmount?: string | number | null;
    adjustmentAmount?: string | number | null;
    postingStatus?: string | null;
  }>;
}) {
  const paymentTotalEffective = input.paymentTotalEffective != null && input.paymentTotalEffective !== ""
    ? moneyNumber(input.paymentTotalEffective)
    : calculatePaymentTotalEffective(input);
  const totalClaimsPosted = input.paymentMethod === "ERA"
    ? sumClaimCashAmounts(input.claimPayments)
    : sumClaimPostedAmounts(input.claimPayments);
  const matched = amountsMatch(paymentTotalEffective, totalClaimsPosted);
  const mismatchMessage = matched
    ? null
    : `Payment total does not match posted amounts. Effective ${paymentTotalEffective.toFixed(2)} vs posted ${totalClaimsPosted.toFixed(2)} (difference ${(paymentTotalEffective - totalClaimsPosted).toFixed(2)}).`;
  return {
    matched,
    balanced: matched,
    reconciliationStatus: matched ? "balanced" : "unbalanced",
    paymentTotalEffective,
    totalClaimsPosted,
    claimSum: totalClaimsPosted,
    paymentAmount: paymentTotalEffective,
    difference: Number((paymentTotalEffective - totalClaimsPosted).toFixed(2)),
    mismatchMessage,
  };
}

export function buildReconciliationSnapshot(input: Parameters<typeof validatePaymentTotals>[0]) {
  const result = validatePaymentTotals(input);
  return {
    paymentTotalEffective: result.paymentTotalEffective.toFixed(2),
    totalClaimsPosted: result.totalClaimsPosted.toFixed(2),
    difference: result.difference.toFixed(2),
    reconciliationStatus: result.reconciliationStatus,
    balanced: result.balanced,
    mismatchMessage: result.mismatchMessage,
  };
}

export function suggestClaimPaymentSeed(input: {
  method: PaymentMethod;
  claim: {
    totalCharge?: string | number | null;
    totalPaid?: string | number | null;
    totalAdjustment?: string | number | null;
    patientResponsibility?: string | number | null;
  };
}) {
  if (isManualPaperEob(input.method)) {
    return {
      allowedAmount: "0.00",
      paidAmount: "0.00",
      adjustmentAmount: "0.00",
      patientResponsibility: "0.00",
      denialCode: null as string | null,
    };
  }
  const outstanding = claimOutstandingBalance(input.claim);
  return {
    allowedAmount: moneyFixed(outstanding),
    paidAmount: moneyFixed(outstanding),
    adjustmentAmount: "0.00",
    patientResponsibility: moneyFixed(input.claim.patientResponsibility || 0),
    denialCode: null as string | null,
  };
}

export function derivePaymentEntryStatus(input: {
  claimPayments: Array<{ postingStatus?: string | null }>;
  hasMismatchError?: boolean;
}): PaymentEntryStatus {
  if (input.hasMismatchError) return "error";
  if (!input.claimPayments.length) return "pending";
  const posted = input.claimPayments.filter((row) => row.postingStatus === "posted").length;
  if (posted === 0) return "pending";
  if (posted === input.claimPayments.length) return "fully_posted";
  return "partially_posted";
}
