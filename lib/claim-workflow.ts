export const CLAIM_WORKFLOW_STATUSES = [
  "needs_scrub",
  "scrubbing",
  "error",
  "ready_to_bill",
  "generating",
  "generated",
  "submitted",
] as const;

export type ClaimWorkflowStatus = (typeof CLAIM_WORKFLOW_STATUSES)[number];

export const CLAIM_WORKFLOW_LABELS: Record<ClaimWorkflowStatus, string> = {
  needs_scrub: "Received",
  scrubbing: "Scrubbing",
  error: "Errors",
  ready_to_bill: "Clean",
  generating: "Generating",
  generated: "Generated",
  submitted: "Submitted",
};

export type ClaimQueueBucket = "received" | "error" | "clean" | "batched" | "submitted";

/** One claim lives in exactly one Claim prep tab. Status is the only source of truth. */
export function claimQueueBucket(claim: {
  workflowStatus?: string | null;
  status?: string | null;
  scrubberStatus?: string | null;
  batchId?: string | null;
}): ClaimQueueBucket {
  const workflow = deriveWorkflowStatus(claim);
  if (workflow === "submitted") return "submitted";
  if (String(claim.batchId || "").trim()) return "batched";
  if (workflow === "error") return "error";
  if (workflow === "ready_to_bill" || workflow === "scrubbing" || workflow === "generated" || workflow === "generating") {
    return "clean";
  }
  return "received";
}

export type ScrubIssue = {
  severity: "error" | "warning";
  field: string;
  box: string;
  message: string;
  suggestion: string;
  code: string;
  category: string;
  blocking: boolean;
  identifiedAt: string;
  diagnosis?: string;
};

const CATEGORY_BY_FIELD: Array<[RegExp, string]> = [
  [/patient|dob|demograph/i, "Patient"],
  [/member|insurance|coverage|subscriber|plan|payer/i, "Insurance"],
  [/authoriz/i, "Authorization"],
  [/eligib/i, "Eligibility"],
  [/provider|npi|referring|rendering|supervising/i, "Provider"],
  [/tax|ein|ssn/i, "Tax ID"],
  [/date of service|service date|dos/i, "Date of Service"],
  [/place of service|pos/i, "Place of Service"],
  [/procedure|cpt|hcpcs|service line/i, "CPT/HCPCS"],
  [/diagnos|icd/i, "ICD-10"],
  [/modifier/i, "Modifiers"],
  [/unit/i, "Units"],
  [/charge/i, "Charges"],
  [/duplicate/i, "Duplicate claims"],
  [/filing|timely/i, "Filing limit"],
  [/facility/i, "Facility"],
  [/clinical|encounter|documentation|assessment|treatment plan|medical necessity|hpi/i, "Clinical documentation"],
  [/signature/i, "Required fields"],
];

export function scrubCategoryForField(field: string): string {
  for (const [pattern, category] of CATEGORY_BY_FIELD) {
    if (pattern.test(field)) return category;
  }
  return "Required fields";
}

export function scrubCodeFor(field: string, box: string): string {
  const slug = `${field}-${box}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `ERR_${slug || "CLAIM"}`;
}

/** Biller-facing label. Keep ERR_* codes for audit, not as the headline. */
export function scrubFindingLabel(issue: { box?: unknown; field?: unknown }): string {
  const box = String(issue.box || "").trim();
  if (box) return `Box ${box}`;
  return String(issue.field || "Claim").trim() || "Claim";
}

/** CMS-1500 Box 22 is blank on originals. 837 CLM05-3 uses 1 for the same meaning. */
export function isOriginalBillFrequency(code: string | null | undefined): boolean {
  const value = String(code || "").trim();
  return !value || value === "1";
}

export function storedBillFrequencyCode(code: string | null | undefined): string | null {
  const value = String(code || "").trim();
  if (!value || value === "1") return null;
  return value;
}

export function box22ScrubIssues(
  frequency: string | null | undefined,
  originalRef: string | null | undefined,
): Array<{ severity: "error"; field: string; box: string; message: string; suggestion: string }> {
  const code = String(frequency || "").trim();
  const ref = String(originalRef || "").trim();
  if (isOriginalBillFrequency(code)) {
    if (!ref) return [];
    return [{
      severity: "error",
      field: "Resubmission reference",
      box: "22",
      message: "Original claims must leave Box 22 blank.",
      suggestion: "Clear the original reference number, or choose replacement (7) or void (8).",
    }];
  }
  const issues: Array<{ severity: "error"; field: string; box: string; message: string; suggestion: string }> = [];
  if (!["7", "8"].includes(code)) {
    issues.push({
      severity: "error",
      field: "Bill frequency",
      box: "22",
      message: "Unsupported bill frequency code.",
      suggestion: "Use 7 for replacement, 8 for void/cancel, or leave blank for an original claim.",
    });
  }
  if (!ref) {
    issues.push({
      severity: "error",
      field: "Resubmission reference",
      box: "22",
      message: "Box 22 requires the payer’s original claim number with replacement or void.",
      suggestion: "Enter the original reference number, or clear the bill frequency for an original claim.",
    });
  }
  return issues;
}

export function enrichScrubIssue(
  issue: {
    severity: "error" | "warning";
    field: string;
    box: string;
    message: string;
    suggestion: string;
    diagnosis?: string;
  },
  identifiedAt: string,
): ScrubIssue {
  return {
    ...issue,
    code: scrubCodeFor(issue.field, issue.box),
    category: scrubCategoryForField(issue.field),
    blocking: issue.severity === "error",
    identifiedAt,
  };
}

/** Rules the scrubber evaluates on every pass (for audit metadata). */
export const SCRUB_RULES_CHECKED = [
  "patient_information",
  "insurance_member_id",
  "provider_npi",
  "facility_npi",
  "qualifier_value_pairs",
  "bill_frequency",
  "auto_accident_state",
  "pip_requirements",
  "date_ranges",
  "outside_lab",
  "federal_tax_id",
  "provider_signature",
  "diagnosis_codes",
  "service_lines",
  "place_of_service",
  "modifiers",
  "diagnosis_pointers",
  "units",
  "charges",
  "epsdt",
  "ndc",
  "authorization",
  "payer_configuration_and_routing",
  "encounter_signature",
  "clinical_documentation",
  "diagnosis_master_directory",
  "procedure_master_directory",
  "diagnosis_pointer_linkage",
] as const;

export function deriveWorkflowStatus(input: {
  workflowStatus?: string | null;
  status?: string | null;
  scrubberStatus?: string | null;
}): ClaimWorkflowStatus {
  const explicit = String(input.workflowStatus || "").toLowerCase();
  if ((CLAIM_WORKFLOW_STATUSES as readonly string[]).includes(explicit)) {
    return explicit as ClaimWorkflowStatus;
  }
  const status = String(input.status || "").toLowerCase();
  const scrub = String(input.scrubberStatus || "").toLowerCase();
  if (["submitted", "accepted", "rejected", "paid", "denied", "appealed"].includes(status)) return "submitted";
  if (status === "scrub_error" || scrub === "errors") return "error";
  if (scrub === "clean" && (status === "ready" || status === "draft")) return "ready_to_bill";
  if (status === "ready" && scrub === "clean") return "ready_to_bill";
  return "needs_scrub";
}

export function legacyStatusForWorkflow(workflow: ClaimWorkflowStatus): "draft" | "scrub_error" | "ready" | "submitted" {
  if (workflow === "error") return "scrub_error";
  if (workflow === "ready_to_bill" || workflow === "generating" || workflow === "generated") return "ready";
  if (workflow === "submitted") return "submitted";
  return "draft";
}

export function scrubberStatusForWorkflow(workflow: ClaimWorkflowStatus): "not_run" | "errors" | "clean" {
  if (workflow === "error") return "errors";
  if (workflow === "ready_to_bill" || workflow === "generating" || workflow === "generated" || workflow === "submitted") return "clean";
  return "not_run";
}

export type ClaimDeliveryChannel = "electronic" | "paper";

/** Electronic when the payer has a clearinghouse route; otherwise paper (incl. self-pay). */
export function deliveryChannelFromPayer(payer?: {
  clearinghouseRoute?: string | null;
} | null): ClaimDeliveryChannel {
  return String(payer?.clearinghouseRoute || "").trim() ? "electronic" : "paper";
}

export function claimFormatForChannel(channel: ClaimDeliveryChannel): "837P" | "CMS-1500" {
  return channel === "electronic" ? "837P" : "CMS-1500";
}

/** Claim prep only lists drafts that originated from an EHR/clinical encounter. */
export function isEhrSourcedClaim(claim: {
  id?: string | null;
  encounterId?: string | null;
}): boolean {
  const id = String(claim.id || "");
  if (!id || id.startsWith("sample_claim_")) return false;
  return Boolean(claim.encounterId);
}

export function workflowBucket(claim: {
  workflowStatus?: string | null;
  status?: string | null;
  scrubberStatus?: string | null;
}): ClaimWorkflowStatus | "all" {
  return deriveWorkflowStatus(claim);
}
