/** Coverage episodes billed on a single claim. Changing slots updates that claim, not patient history. */

export type CoverageEpisode = {
  id?: string | null;
  patientId?: string | null;
  planId?: string | null;
  priority?: string | null;
  memberId?: string | null;
  groupNumber?: string | null;
  relationship?: string | null;
  subscriberFirstName?: string | null;
  subscriberLastName?: string | null;
  subscriberDateOfBirth?: string | null;
  subscriberSex?: string | null;
  subscriberAddressLine1?: string | null;
  subscriberCity?: string | null;
  subscriberState?: string | null;
  subscriberPostalCode?: string | null;
  acceptAssignment?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  status?: string | null;
};

export type EligibilityRow = {
  coverageId?: string | null;
  patientId?: string | null;
  status?: string | null;
  dateOfService?: string | null;
  checkedAt?: string | null;
};

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

type CoverageLike = CoverageEpisode | Record<string, unknown>;
type EligibilityLike = EligibilityRow | Record<string, unknown>;

export function coverageCoversDos(coverage: CoverageLike, dos: string): boolean {
  if (asText(coverage.status) === "inactive") return false;
  if (!dos) return true;
  const start = asText(coverage.effectiveDate);
  const end = asText(coverage.terminationDate);
  if (start && dos < start) return false;
  if (end && dos > end) return false;
  return true;
}

export function coverageEpisodeLabel(input: {
  coverage: CoverageLike;
  payerName?: string;
  planName?: string;
  dos?: string;
}): string {
  const coverage = input.coverage;
  const payer = asText(input.payerName) || "Payer";
  const plan = asText(input.planName);
  const member = asText(coverage.memberId) || "no member ID";
  const start = asText(coverage.effectiveDate) || "open";
  const end = asText(coverage.terminationDate) || "open";
  const onDos = input.dos ? (coverageCoversDos(coverage, input.dos) ? "covers DOS" : "outside DOS") : "";
  const priority = asText(coverage.priority).replaceAll("_", " ") || "unassigned";
  return [payer, plan, member, priority, `${start} → ${end}`, onDos].filter(Boolean).join(" · ");
}

function eligibleCoverageIds(rows: EligibilityLike[], patientId: string, dos: string) {
  return new Set(
    rows
      .filter((row) => asText(row.patientId) === patientId && asText(row.status) === "eligible")
      .filter((row) => !dos || !asText(row.dateOfService) || asText(row.dateOfService) === dos)
      .map((row) => asText(row.coverageId))
      .filter(Boolean),
  );
}

function pickCoverageForSlot(input: {
  coverages: CoverageLike[];
  eligibleIds: Set<string>;
  dos: string;
  priority: string;
  claimedId?: string | null;
  usedIds: Set<string>;
}): string {
  const claimed = asText(input.claimedId);
  if (claimed && input.coverages.some((row) => asText(row.id) === claimed) && !input.usedIds.has(claimed)) {
    return claimed;
  }
  const ranked = input.coverages
    .filter((row) => asText(row.priority) === input.priority && asText(row.id) && !input.usedIds.has(asText(row.id)))
    .sort((left, right) => {
      const leftDos = coverageCoversDos(left, input.dos) ? 0 : 1;
      const rightDos = coverageCoversDos(right, input.dos) ? 0 : 1;
      if (leftDos !== rightDos) return leftDos - rightDos;
      const leftEligible = input.eligibleIds.has(asText(left.id)) ? 0 : 1;
      const rightEligible = input.eligibleIds.has(asText(right.id)) ? 0 : 1;
      return leftEligible - rightEligible;
    });
  return asText(ranked[0]?.id);
}

export function defaultBilledCoverages(input: {
  coverages: CoverageLike[];
  eligibility?: EligibilityLike[];
  patientId?: string | null;
  dos: string;
  claimCoverageId?: string | null;
  snapshotSecondaryId?: string | null;
  snapshotTertiaryId?: string | null;
}): { primaryId: string; secondaryId: string; tertiaryId: string } {
  const patientId = asText(input.patientId);
  const coverages = input.coverages.filter((row) => !patientId || asText(row.patientId) === patientId);
  const eligibleIds = eligibleCoverageIds(input.eligibility || [], patientId, input.dos);
  const usedIds = new Set<string>();
  const primaryId = pickCoverageForSlot({
    coverages,
    eligibleIds,
    dos: input.dos,
    priority: "primary",
    claimedId: input.claimCoverageId,
    usedIds,
  });
  if (primaryId) usedIds.add(primaryId);
  const secondaryId = pickCoverageForSlot({
    coverages,
    eligibleIds,
    dos: input.dos,
    priority: "secondary",
    claimedId: input.snapshotSecondaryId,
    usedIds,
  });
  if (secondaryId) usedIds.add(secondaryId);
  const tertiaryId = pickCoverageForSlot({
    coverages,
    eligibleIds,
    dos: input.dos,
    priority: "tertiary",
    claimedId: input.snapshotTertiaryId,
    usedIds,
  });
  return { primaryId, secondaryId, tertiaryId };
}

export function billedCoverageFields(coverage?: CoverageLike | null): Record<string, string> {
  if (!coverage) return {};
  return {
    memberId: asText(coverage.memberId),
    groupNumber: asText(coverage.groupNumber),
    relationship: asText(coverage.relationship) || "self",
    subscriberFirstName: asText(coverage.subscriberFirstName),
    subscriberLastName: asText(coverage.subscriberLastName),
    subscriberDateOfBirth: asText(coverage.subscriberDateOfBirth),
    subscriberSex: asText(coverage.subscriberSex),
    subscriberAddressLine1: asText(coverage.subscriberAddressLine1),
    subscriberCity: asText(coverage.subscriberCity),
    subscriberState: asText(coverage.subscriberState),
    subscriberPostalCode: asText(coverage.subscriberPostalCode),
    acceptAssignment: asText(coverage.acceptAssignment) === "no" ? "N" : "Y",
  };
}

export function unpaidReason(input: {
  followUpStatus?: string | null;
  lifecycleStatus?: string | null;
  denialCodes?: string[];
  scrubErrors?: string[];
}): string {
  const denials = (input.denialCodes || []).map((code) => asText(code).trim()).filter(Boolean);
  if (denials.length) return `Denial ${denials.join(", ")}`;
  if (asText(input.followUpStatus) === "denied" || asText(input.lifecycleStatus).startsWith("denied_")) {
    return "Marked denied — no ERA code on file";
  }
  const scrub = (input.scrubErrors || []).map((message) => asText(message).trim()).filter(Boolean);
  if (scrub.length) return scrub[0];
  if (asText(input.followUpStatus) === "in_process") return "In process to pay";
  return "No payment after response window";
}
