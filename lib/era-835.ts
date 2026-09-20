import { moneyFixed, moneyNumber } from "./payment-posting";

export type EraClaimPayment = {
  claimControlNumber: string;
  claimStatusCode: string;
  chargeAmount: string;
  paidAmount: string;
  patientResponsibility: string;
  allowedAmount: string;
  adjustmentAmount: string;
  denialCodes: string[];
  patientLastName?: string;
  patientFirstName?: string;
};

export type EraParseResult = {
  ok: boolean;
  error?: string;
  paymentAmount: string;
  referenceNumber: string;
  paymentDate: string;
  payerName: string;
  offsetAmount: string;
  refundAmount: string;
  incentiveAmount: string;
  otherAdjustments: string;
  claims: EraClaimPayment[];
  warnings: string[];
};

function segmentize(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [] as string[];
  // Prefer X12 segment terminator ~ ; fall back to newlines for test pastes.
  if (normalized.includes("~")) {
    return normalized.split("~").map((part) => part.trim()).filter(Boolean);
  }
  return normalized.split("\n").map((part) => part.trim()).filter(Boolean);
}

function elements(segment: string) {
  return segment.split("*").map((part) => part.trim());
}

function yymmddToIso(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (digits.length === 6) {
    const year = Number(digits.slice(0, 2));
    const fullYear = year >= 70 ? `19${digits.slice(0, 2)}` : `20${digits.slice(0, 2)}`;
    return `${fullYear}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function sumCasAdjustments(parts: string[]) {
  // CAS*group*code*amount*quantity*code*amount...
  let total = 0;
  const codes: string[] = [];
  for (let index = 2; index < parts.length; index += 3) {
    const code = parts[index] || "";
    const amount = moneyNumber(parts[index + 1]);
    if (code) codes.push(code);
    if (amount > 0) total += amount;
  }
  return { amount: total, codes };
}

/** Parse X12 835 (or newline-delimited test ERA) into payment + claim lines. */
export function parseEra835(rawInput: string): EraParseResult {
  const warnings: string[] = [];
  const segments = segmentize(rawInput);
  if (!segments.length) {
    return {
      ok: false,
      error: "ERA file is empty.",
      paymentAmount: "0.00",
      referenceNumber: "",
      paymentDate: new Date().toISOString().slice(0, 10),
      payerName: "",
      offsetAmount: "0.00",
      refundAmount: "0.00",
      incentiveAmount: "0.00",
      otherAdjustments: "0.00",
      claims: [],
      warnings,
    };
  }

  let paymentAmount = 0;
  let referenceNumber = "";
  let paymentDate = new Date().toISOString().slice(0, 10);
  let payerName = "";
  let offsetAmount = 0;
  let refundAmount = 0;
  let incentiveAmount = 0;
  let otherAdjustments = 0;
  const claims: EraClaimPayment[] = [];
  let current: EraClaimPayment | null = null;

  const flushCurrent = () => {
    if (!current) return;
    if (!moneyNumber(current.allowedAmount)) {
      current.allowedAmount = moneyFixed(
        moneyNumber(current.paidAmount) + moneyNumber(current.adjustmentAmount) + moneyNumber(current.patientResponsibility),
      );
    }
    claims.push(current);
    current = null;
  };

  for (const segment of segments) {
    const parts = elements(segment);
    const tag = parts[0]?.toUpperCase() || "";

    if (tag === "BPR") {
      paymentAmount = moneyNumber(parts[2]);
      if (parts[16]) paymentDate = yymmddToIso(parts[16]);
      else if (parts[15] && /^\d{6,8}$/.test(parts[15])) paymentDate = yymmddToIso(parts[15]);
    } else if (tag === "TRN") {
      referenceNumber = parts[2] || referenceNumber;
    } else if (tag === "N1" && (parts[1] || "").toUpperCase() === "PR") {
      payerName = parts[2] || payerName;
    } else if (tag === "PLB") {
      // Provider-level balance / offsets: PLB*... reason*amount pairs after date.
      for (let index = 3; index < parts.length; index += 2) {
        const reason = (parts[index] || "").toUpperCase();
        const amount = moneyNumber(parts[index + 1]);
        if (!amount) continue;
        if (reason.includes("WO") || reason.includes("FB")) offsetAmount += amount;
        else if (reason.includes("72") || reason.includes("IR")) incentiveAmount += amount;
        else if (reason.includes("B2") || reason.includes("CS") || amount < 0) refundAmount += Math.abs(amount);
        else otherAdjustments += amount;
      }
    } else if (tag === "CLP") {
      flushCurrent();
      const charge = moneyNumber(parts[3]);
      const paid = moneyNumber(parts[4]);
      const patientResp = moneyNumber(parts[5]);
      current = {
        claimControlNumber: parts[1] || "",
        claimStatusCode: parts[2] || "",
        chargeAmount: moneyFixed(charge),
        paidAmount: moneyFixed(paid),
        patientResponsibility: moneyFixed(patientResp),
        allowedAmount: "0.00",
        adjustmentAmount: "0.00",
        denialCodes: [],
      };
      if (!current.claimControlNumber) warnings.push("CLP missing claim control number.");
    } else if (tag === "CAS" && current) {
      const { amount, codes } = sumCasAdjustments(parts);
      current.adjustmentAmount = moneyFixed(moneyNumber(current.adjustmentAmount) + amount);
      current.denialCodes = [...current.denialCodes, ...codes.map((code) => `${parts[1] || "OA"}-${code}`)];
    } else if (tag === "AMT" && current && (parts[1] || "").toUpperCase() === "B6") {
      current.allowedAmount = moneyFixed(parts[2]);
    } else if (tag === "NM1" && current && (parts[1] || "").toUpperCase() === "QC") {
      current.patientLastName = parts[3] || "";
      current.patientFirstName = parts[4] || "";
    }
  }
  flushCurrent();

  if (!paymentAmount && claims.length) {
    paymentAmount = claims.reduce((sum, row) => sum + moneyNumber(row.paidAmount), 0);
    warnings.push("BPR payment amount missing; derived from claim paid amounts.");
  }
  if (!referenceNumber) {
    referenceNumber = `ERA${Date.now().toString().slice(-8)}`;
    warnings.push("TRN reference missing; generated temporary reference.");
  }
  if (!claims.length) {
    return {
      ok: false,
      error: "No CLP claim payment segments found in ERA.",
      paymentAmount: moneyFixed(paymentAmount),
      referenceNumber,
      paymentDate,
      payerName,
      offsetAmount: moneyFixed(offsetAmount),
      refundAmount: moneyFixed(refundAmount),
      incentiveAmount: moneyFixed(incentiveAmount),
      otherAdjustments: moneyFixed(otherAdjustments),
      claims: [],
      warnings,
    };
  }

  return {
    ok: true,
    paymentAmount: moneyFixed(paymentAmount),
    referenceNumber,
    paymentDate,
    payerName,
    offsetAmount: moneyFixed(offsetAmount),
    refundAmount: moneyFixed(refundAmount),
    incentiveAmount: moneyFixed(incentiveAmount),
    otherAdjustments: moneyFixed(otherAdjustments),
    claims,
    warnings,
  };
}

export function remainingBalanceForClaim(claim: {
  totalCharge?: string | number | null;
  totalPaid?: string | number | null;
  totalAdjustment?: string | number | null;
}) {
  return Math.max(
    0,
    moneyNumber(claim.totalCharge) - moneyNumber(claim.totalPaid) - moneyNumber(claim.totalAdjustment),
  );
}

export function claimStatusAfterPayment(remaining: number, denialCodes?: string[] | null) {
  if (remaining <= 0.009) return "paid" as const;
  if (denialCodes && denialCodes.length && remaining > 0.009 && moneyNumber(remaining) > 0) {
    // Keep partially paid if any money applied; pure denial handled by caller when paid+adj=0.
  }
  return "partially_paid" as const;
}
