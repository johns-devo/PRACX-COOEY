export type ClaimConfigurationDefault = {
  category: string;
  code: string;
  displayName: string;
  guidance: string;
  effectiveDate?: string;
};

export const CLAIM_CONFIGURATION_SOURCE = "NUCC 1500 v13.0 7/25";

const entries = (
  category: string,
  values: [string, string, string][],
): ClaimConfigurationDefault[] => values.map(([code, displayName, guidance]) => ({
  category,
  code,
  displayName,
  guidance,
  effectiveDate: "2025-07-01",
}));

export const CLAIM_CONFIGURATION_CATEGORIES: Record<string, string> = {
  insurance_type: "Box 1 · Insurance types",
  other_claim_id: "Box 11b · Other claim ID",
  condition_date: "Box 14 · Condition-date qualifiers",
  other_date: "Box 15 · Other-date qualifiers",
  provider_role: "Box 17 · Provider roles",
  box17a_identifier: "Box 17a · Other-ID qualifiers",
  box19_information: "Box 19 · Additional information",
  icd_indicator: "Box 21 · ICD indicators",
  bill_frequency: "Box 22 · Bill frequency",
  epsdt_reason: "Box 24H · EPSDT reasons",
  rendering_identifier: "Box 24I · Rendering identifiers",
  supplemental: "Box 24 shaded · Supplemental information",
  facility_identifier: "Box 32b · Facility identifiers",
  billing_identifier: "Box 33b · Billing identifiers",
  ndc_unit: "NDC · Unit qualifiers",
};

export const CLAIM_CONFIGURATION_DEFAULTS: ClaimConfigurationDefault[] = [
  ...entries("insurance_type", [
    ["medicare", "Medicare", "Medicare coverage"],
    ["medicaid", "Medicaid", "Medicaid coverage"],
    ["tricare", "TRICARE", "TRICARE coverage"],
    ["champva", "CHAMPVA", "CHAMPVA coverage"],
    ["group", "Group health plan", "Group health plan coverage"],
    ["feca", "FECA", "Federal Employees’ Compensation Act"],
    ["black_lung", "Black Lung", "Federal Black Lung Program"],
    ["other", "Other", "Commercial, HMO, auto, liability or workers’ compensation"],
  ]),
  ...entries("other_claim_id", [
    ["Y4", "Agency / property casualty claim number", "Required when known for workers’ compensation or property/casualty claims"],
  ]),
  ...entries("condition_date", [
    ["431", "Onset of current symptoms or illness", "Box 14 onset date"],
    ["484", "Last menstrual period", "Box 14 LMP date"],
  ]),
  ...entries("other_date", [
    ["454", "Initial treatment", "Box 15"],
    ["304", "Latest visit or consultation", "Box 15"],
    ["453", "Acute manifestation of chronic condition", "Box 15"],
    ["439", "Accident", "Box 15"],
    ["455", "Last X-ray", "Box 15"],
    ["471", "Prescription", "Box 15"],
    ["090", "Report start / assumed care", "Box 15"],
    ["091", "Report end / relinquished care", "Box 15"],
    ["444", "First visit or consultation", "Box 15"],
  ]),
  ...entries("provider_role", [
    ["DN", "Referring provider", "First reporting priority"],
    ["DK", "Ordering provider", "Second reporting priority"],
    ["DQ", "Supervising provider", "Third reporting priority"],
  ]),
  ...entries("box17a_identifier", [
    ["0B", "State license number", "Box 17a"],
    ["1G", "Provider UPIN", "Box 17a"],
    ["G2", "Provider commercial number", "Box 17a"],
    ["LU", "Location number", "Supervising provider only"],
  ]),
  ...entries("box19_information", [
    ["0B", "State license number", "Box 19"],
    ["1G", "Provider UPIN", "Box 19"],
    ["G2", "Provider commercial number", "Box 19"],
    ["LU", "Location number", "Box 19"],
    ["N5", "Plan network ID", "Box 19"],
    ["X5", "State industrial accident ID", "Box 19"],
    ["ZZ", "Provider taxonomy", "Box 19"],
    ["ADD", "Additional information", "Box 19 note qualifier"],
    ["CER", "Certification narrative", "Box 19 note qualifier"],
    ["DCP", "Goals, rehabilitation potential or discharge plan", "Box 19 note qualifier"],
    ["DGN", "Diagnosis description", "Box 19 note qualifier"],
    ["TPO", "Third-party organization notes", "Box 19 note qualifier"],
  ]),
  ...entries("icd_indicator", [
    ["0", "ICD-10-CM", "Current diagnosis code set"],
    ["9", "ICD-9-CM", "Historical DOS only when valid"],
  ]),
  ...entries("bill_frequency", [
    ["7", "Replacement of prior claim", "Requires original payer reference"],
    ["8", "Void / cancel prior claim", "Requires original payer reference"],
  ]),
  ...entries("epsdt_reason", [
    ["AV", "Available, not used", "Patient refused referral"],
    ["S2", "Under treatment", "Patient is under treatment"],
    ["ST", "New service requested", "New diagnostic or corrective service requested"],
    ["NU", "Not used", "No EPSDT referral was given"],
  ]),
  ...entries("rendering_identifier", [
    ["0B", "State license number", "Box 24I"],
    ["1G", "Provider UPIN", "Box 24I"],
    ["G2", "Provider commercial number", "Box 24I"],
    ["LU", "Location number", "Box 24I"],
    ["ZZ", "Provider taxonomy", "Box 24I"],
  ]),
  ...entries("supplemental", [
    ["ZZ", "Narrative for unspecified code", "Box 24 shaded"],
    ["N4", "National Drug Code", "Box 24 shaded"],
    ["DI", "Device identifier", "Box 24 shaded"],
    ["CTR", "Contract rate", "Box 24 shaded"],
    ["JP", "Tooth number", "Box 24 shaded"],
    ["JO", "Oral-cavity area", "Box 24 shaded"],
  ]),
  ...entries("facility_identifier", [
    ["0B", "State license number", "Box 32b"],
    ["G2", "Provider commercial number", "Box 32b"],
    ["LU", "Location number", "Box 32b"],
  ]),
  ...entries("billing_identifier", [
    ["0B", "State license number", "Box 33b"],
    ["G2", "Provider commercial number", "Box 33b"],
    ["ZZ", "Provider taxonomy", "Box 33b"],
  ]),
  ...entries("ndc_unit", [
    ["F2", "International unit", "NDC unit/basis of measurement"],
    ["GR", "Gram", "NDC unit/basis of measurement"],
    ["ME", "Milligram", "NDC unit/basis of measurement"],
    ["ML", "Milliliter", "NDC unit/basis of measurement"],
    ["UN", "Unit", "NDC unit/basis of measurement"],
  ]),
];
