/** Outstanding A/R worklist. Status stays on the claim lifecycle; this only filters open balances. */

import {
  deriveClaimLifecycle,
  isLifecycleOnClaimPrep,
  partyFromLifecycle,
  type ClaimLifecycleStatus,
  type ClaimParty,
} from "./claim-lifecycle.ts";

export const DEFAULT_RESPONSE_DAYS = 12;

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "91+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const INSURANCE_GAPS = [
  "no_primary",
  "coverage_inactive_dos",
  "missing_member_id",
  "eligibility_gap",
  "auth_missing",
  "timely_filing",
  "unused_secondary",
  "no_secondary",
  "denied_open",
  "patient_owed",
] as const;

export type InsuranceGapId = (typeof INSURANCE_GAPS)[number];

export const INSURANCE_GAP_LABELS: Record<InsuranceGapId, string> = {
  no_primary: "No primary coverage",
  coverage_inactive_dos: "Coverage not active on DOS",
  missing_member_id: "Missing member ID",
  eligibility_gap: "Eligibility not verified",
  auth_missing: "Authorization missing",
  timely_filing: "Timely filing risk",
  unused_secondary: "Secondary not billed",
  no_secondary: "No secondary on file",
  denied_open: "Denied, still open",
  patient_owed: "Patient balance",
};

export const PARTY_FILTERS = ["pri", "sec", "ter", "patient"] as const;

export type CollectionClaim = {
  id?: string | null;
  claimNumber?: string | null;
  patientId?: string | null;
  coverageId?: string | null;
  payerId?: string | null;
  payerName?: string | null;
  dateOfService?: string | null;
  firstBilledDate?: string | null;
  lastBilledDate?: string | null;
  remainingBalance?: string | number | null;
  lifecycleStatus?: string | null;
  workflowStatus?: string | null;
  status?: string | null;
  priorAuthorizationNumber?: string | null;
  followUpStatus?: string | null;
};

export type CollectionPayer = {
  id?: string | null;
  responseDays?: string | number | null;
};

export type CollectionCoverage = {
  id?: string | null;
  patientId?: string | null;
  planId?: string | null;
  priority?: string | null;
  memberId?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  authorizationNumber?: string | null;
  status?: string | null;
};

export type CollectionPlan = {
  id?: string | null;
  payerId?: string | null;
  timelyFilingDays?: string | number | null;
  requiresAuthorization?: string | null;
};

export type CollectionEligibility = {
  patientId?: string | null;
  coverageId?: string | null;
  dateOfService?: string | null;
  status?: string | null;
  checkedAt?: string | null;
};

export type CollectionFilters = {
  dosFrom?: string;
  dosTo?: string;
  aging?: AgingBucket | "";
  payerId?: string;
  party?: ClaimParty | "";
  gaps?: InsuranceGapId[];
};

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function asMoney(value: unknown) {
  return Number(value || 0);
}

function startOfDay(isoDate: string) {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00`);
}

function daysBetween(from: string, asOf: Date) {
  const start = startOfDay(from);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / 86_400_000));
}

export function isOutstandingClaim(claim: CollectionClaim): boolean {
  const lifecycle = deriveClaimLifecycle(claim);
  if (lifecycle === "closed" || lifecycle === "voided") return false;
  return asMoney(claim.remainingBalance) > 0.009;
}

export function payerResponseDays(payer?: CollectionPayer | null): number {
  const days = Number(payer?.responseDays);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_RESPONSE_DAYS;
}

/** Unsigned notes and unsent claims stay in Bridge / Claim prep. */
export function isSubmittedForFollowUp(claim: CollectionClaim): boolean {
  const lifecycle = deriveClaimLifecycle(claim);
  if (lifecycle === "closed" || lifecycle === "voided" || lifecycle === "new") return false;
  if (isLifecycleOnClaimPrep(lifecycle)) return false;
  return lifecycle.startsWith("sent_") || lifecycle.startsWith("rebilled_") || lifecycle.startsWith("denied_") || lifecycle.startsWith("paid_");
}

export function isDueForCollectionArena(claim: CollectionClaim, responseDays: number, asOf = new Date()): boolean {
  if (!isOutstandingClaim(claim) || !isSubmittedForFollowUp(claim)) return false;
  // A denied claim is actionable immediately; it should not wait for the
  // ordinary payer response-day aging threshold before entering Denials.
  if (deriveClaimLifecycle(claim).startsWith("denied_")) return true;
  return claimAgeDays(claim, asOf) >= responseDays;
}

export function claimAgeDays(claim: CollectionClaim, asOf = new Date()): number {
  const anchor = asText(claim.lastBilledDate) || asText(claim.firstBilledDate) || asText(claim.dateOfService);
  return anchor ? daysBetween(anchor, asOf) : 0;
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "91+";
}

function coverageCoversDos(coverage: CollectionCoverage, dos: string) {
  if (!dos) return asText(coverage.status) !== "inactive";
  const start = asText(coverage.effectiveDate);
  const end = asText(coverage.terminationDate);
  if (start && dos < start) return false;
  if (end && dos > end) return false;
  return asText(coverage.status) !== "inactive";
}

function latestEligibility(
  checks: CollectionEligibility[],
  patientId: string,
  coverageId: string,
  dos: string,
) {
  const ranked = checks
    .filter((row) => asText(row.patientId) === patientId)
    .sort((left, right) => asText(right.checkedAt).localeCompare(asText(left.checkedAt)));
  return ranked.find((row) => asText(row.coverageId) === coverageId && asText(row.dateOfService) === dos)
    || ranked.find((row) => asText(row.dateOfService) === dos)
    || ranked[0];
}

export function detectInsuranceGaps(input: {
  claim: CollectionClaim;
  coverages: CollectionCoverage[];
  plans: CollectionPlan[];
  eligibility: CollectionEligibility[];
  asOf?: Date;
}): InsuranceGapId[] {
  const claim = input.claim;
  const dos = asText(claim.dateOfService);
  const patientId = asText(claim.patientId);
  const lifecycle = deriveClaimLifecycle(claim);
  const party = partyFromLifecycle(lifecycle);
  const patientCoverages = input.coverages.filter((row) => asText(row.patientId) === patientId);
  const primary = patientCoverages.find((row) => asText(row.priority) === "primary" && coverageCoversDos(row, dos))
    || patientCoverages.find((row) => asText(row.priority) === "primary");
  const secondary = patientCoverages.find((row) => asText(row.priority) === "secondary" && coverageCoversDos(row, dos));
  const plan = input.plans.find((row) => asText(row.id) === asText(primary?.planId));
  const eligibility = latestEligibility(input.eligibility, patientId, asText(primary?.id || claim.coverageId), dos);
  const gaps: InsuranceGapId[] = [];

  if (!primary) gaps.push("no_primary");
  if (primary && !coverageCoversDos(primary, dos)) gaps.push("coverage_inactive_dos");
  if (primary && !asText(primary.memberId).trim()) gaps.push("missing_member_id");
  if (!eligibility || asText(eligibility.status) !== "eligible") gaps.push("eligibility_gap");
  if (asText(plan?.requiresAuthorization) === "yes" && !asText(claim.priorAuthorizationNumber) && !asText(primary?.authorizationNumber)) {
    gaps.push("auth_missing");
  }
  const timelyDays = Number(plan?.timelyFilingDays || 90);
  const dosAge = dos ? daysBetween(dos, input.asOf || new Date()) : 0;
  if (dosAge >= timelyDays && !asText(claim.lastBilledDate) && !asText(claim.firstBilledDate)) {
    gaps.push("timely_filing");
  }
  if (secondary && party === "pri" && asMoney(claim.remainingBalance) > 0.009) gaps.push("unused_secondary");
  if (!secondary && party === "pri" && asMoney(claim.remainingBalance) > 0.009 && (lifecycle.startsWith("sent_") || lifecycle.startsWith("paid_") || lifecycle.startsWith("denied_") || lifecycle.startsWith("rebilled_"))) {
    gaps.push("no_secondary");
  }
  if (lifecycle.startsWith("denied_")) gaps.push("denied_open");
  if (party === "patient") gaps.push("patient_owed");
  return gaps;
}

export const FOLLOW_UP_LABELS: Record<string, string> = {
  in_process: "In process to pay",
  denied: "Denied",
  resubmitted: "Resubmitted",
};

export type CollectionRow = {
  claim: CollectionClaim;
  lifecycle: ClaimLifecycleStatus;
  party: ClaimParty | null;
  ageDays: number;
  aging: AgingBucket;
  responseDays: number;
  gaps: InsuranceGapId[];
  followUpStatus: string;
};

export function buildCollectionRows(input: {
  claims: CollectionClaim[];
  coverages: CollectionCoverage[];
  plans: CollectionPlan[];
  eligibility: CollectionEligibility[];
  payers?: CollectionPayer[];
  asOf?: Date;
}): CollectionRow[] {
  const asOf = input.asOf || new Date();
  const payers = input.payers || [];
  return input.claims.filter((claim) => {
    const payer = payers.find((row) => asText(row.id) === asText(claim.payerId));
    return isDueForCollectionArena(claim, payerResponseDays(payer), asOf);
  }).map((claim) => {
    const lifecycle = deriveClaimLifecycle(claim);
    const ageDays = claimAgeDays(claim, asOf);
    const payer = payers.find((row) => asText(row.id) === asText(claim.payerId));
    return {
      claim,
      lifecycle,
      party: partyFromLifecycle(lifecycle),
      ageDays,
      aging: agingBucket(ageDays),
      responseDays: payerResponseDays(payer),
      followUpStatus: asText(claim.followUpStatus),
      gaps: detectInsuranceGaps({
        claim,
        coverages: input.coverages,
        plans: input.plans,
        eligibility: input.eligibility,
        asOf,
      }),
    };
  }).sort((left, right) => right.ageDays - left.ageDays || asMoney(right.claim.remainingBalance) - asMoney(left.claim.remainingBalance));
}

export function filterCollectionRows(rows: CollectionRow[], filters: CollectionFilters): CollectionRow[] {
  const gaps = filters.gaps || [];
  return rows.filter((row) => {
    const dos = asText(row.claim.dateOfService);
    if (filters.dosFrom && dos && dos < filters.dosFrom) return false;
    if (filters.dosTo && dos && dos > filters.dosTo) return false;
    if (filters.aging && row.aging !== filters.aging) return false;
    if (filters.payerId && asText(row.claim.payerId) !== filters.payerId) return false;
    if (filters.party && row.party !== filters.party) return false;
    if (gaps.length && !gaps.some((gap) => row.gaps.includes(gap))) return false;
    return true;
  });
}
