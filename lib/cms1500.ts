export const CMS1500_STANDARD = {
  formVersion: "02/12",
  instructionVersion: "13.0 7/25",
  effectiveDate: "2025-07-01",
  source:
    "https://www.nucc.org/images/stories/PDF/1500_claim_form_instruction_manual_2025_07-v13.pdf",
} as const;

export type ClaimFieldHintData = {
  box: string;
  title: string;
  detail: string;
  type?: "paper" | "conditional" | "electronic" | "operational";
};

export const claimFieldHints = {
  insuranceType: {
    box: "1",
    title: "Insurance type",
    detail: "Identifies the program or type of coverage to which the professional claim is submitted.",
    type: "paper",
  },
  memberId: {
    box: "1a",
    title: "Insured ID number",
    detail: "The member or insured identifier shown on the payer identification card.",
    type: "paper",
  },
  patientName: {
    box: "2",
    title: "Patient name",
    detail: "Patient last name, first name and middle initial. Omitted when payer instructions treat the patient as the insured.",
    type: "paper",
  },
  patientBirthSex: {
    box: "3",
    title: "Patient birth date and sex",
    detail: "Reports the patient birth date and applicable sex selection.",
    type: "paper",
  },
  subscriberName: {
    box: "4",
    title: "Insured name",
    detail: "Reports the policyholder or subscriber name when different from the patient.",
    type: "paper",
  },
  patientAddress: {
    box: "5",
    title: "Patient address",
    detail: "Reports the patient permanent street address, city, state and ZIP code.",
    type: "paper",
  },
  relationship: {
    box: "6",
    title: "Relationship to insured",
    detail: "Indicates self, spouse, child or other relationship to the insured.",
    type: "paper",
  },
  subscriberAddress: {
    box: "7",
    title: "Insured address",
    detail: "Reports the insured permanent address when the insured differs from the patient.",
    type: "paper",
  },
  groupNumber: {
    box: "11",
    title: "Policy or group number",
    detail: "Reports the insured policy, group or FECA number.",
    type: "paper",
  },
  subscriberBirthSex: {
    box: "11a",
    title: "Insured birth date and sex",
    detail: "Reports the insured birth date and applicable sex when the insured differs from the patient.",
    type: "paper",
  },
  planName: {
    box: "11c / Carrier",
    title: "Insurance plan and payer",
    detail: "Plan/program name is reported in Box 11c; the payer name and address populate the carrier block.",
    type: "paper",
  },
  releaseInformation: {
    box: "12",
    title: "Release of information",
    detail: "Patient or authorized-person signature authorizing release of information.",
    type: "paper",
  },
  assignmentBenefits: {
    box: "13",
    title: "Assignment of benefits",
    detail: "Insured or authorized-person signature authorizing payment to the provider.",
    type: "paper",
  },
  otherClaimId: {
    box: "11b",
    title: "Other claim ID",
    detail: "For property and casualty claims, qualifier Y4 identifies the agency/property-casualty claim number. Required when known for workers’ compensation or property/casualty claims.",
    type: "conditional",
  },
  currentIllnessDate: {
    box: "14",
    title: "Current illness, injury or pregnancy date",
    detail: "Use qualifier 431 for onset of current symptoms or illness, or 484 for last menstrual period.",
    type: "conditional",
  },
  otherDate: {
    box: "15",
    title: "Other related date",
    detail: "Reports a treatment or condition date with qualifier 454, 304, 453, 439, 455, 471, 090, 091 or 444.",
    type: "conditional",
  },
  referringQualifier: {
    box: "17",
    title: "Referring provider role",
    detail: "Use DN for referring, DK for ordering or DQ for supervising provider. When multiple apply, NUCC prioritizes referring, then ordering, then supervising.",
    type: "conditional",
  },
  providerOtherId: {
    box: "17a / 19 / 24I / 32b / 33b",
    title: "Non-NPI identifier qualifier",
    detail: "Qualifier availability differs by box. Box 19 also supports additional-claim-information note qualifiers; PRACX limits each selector to the values allowed for that location.",
    type: "conditional",
  },
  icdIndicator: {
    box: "21",
    title: "ICD indicator",
    detail: "Use 0 for ICD-10-CM or 9 for ICD-9-CM. Current claims normally use ICD-10-CM unless a valid historical DOS requires ICD-9-CM.",
    type: "paper",
  },
  billFrequency: {
    box: "22",
    title: "Resubmission code and original reference",
    detail: "Use frequency 7 for replacement or 8 for void/cancel and include the payer’s original claim reference. Leave blank for an original claim.",
    type: "conditional",
  },
  epsdtReason: {
    box: "24H",
    title: "EPSDT reason",
    detail: "When required, use AV, S2, ST or NU. Family Planning is separately reported as Y in the unshaded portion.",
    type: "conditional",
  },
  supplementalInformation: {
    box: "24 shaded",
    title: "Service-line supplemental information",
    detail: "Supports ZZ narrative, N4 NDC, DI device identifier, CTR contract rate, JP tooth number or JO oral-cavity area. Formatting remains payer- and qualifier-specific.",
    type: "conditional",
  },
  encounterDiagnosis: {
    box: "21",
    title: "Diagnosis codes",
    detail: "Up to 12 ICD diagnosis codes are reported in Box 21 and linked to service lines through Box 24E.",
    type: "paper",
  },
  encounterProcedure: {
    box: "24D",
    title: "Procedure and modifiers",
    detail: "CPT or HCPCS procedure code and applicable modifiers are reported on each service line.",
    type: "paper",
  },
  dateOfService: {
    box: "24A",
    title: "Date of service",
    detail: "Service-line from and to dates are reported in Box 24A.",
    type: "paper",
  },
  chargeAmount: {
    box: "24F / 28",
    title: "Charges",
    detail: "Line charge is reported in Box 24F and claim total charge in Box 28.",
    type: "paper",
  },
  units: {
    box: "24G",
    title: "Units",
    detail: "Reports days or units for the service line.",
    type: "paper",
  },
  accountNumber: {
    box: "26",
    title: "Patient account number",
    detail: "Provider-assigned patient account identifier used for claim and remittance matching.",
    type: "paper",
  },
  acceptAssignment: {
    box: "27",
    title: "Accept assignment",
    detail: "Indicates whether the provider accepts assignment under the payer program.",
    type: "paper",
  },
  amountPaid: {
    box: "29",
    title: "Amount paid",
    detail: "Reports patient and/or other-payer payments on the covered services.",
    type: "paper",
  },
  providerName: {
    box: "31 / 33",
    title: "Provider name",
    detail:
      "Used in Box 31 for the accountable practitioner signature and Box 33 when this is the billing provider.",
    type: "conditional",
  },
  providerCode: {
    box: "Internal",
    title: "Provider code",
    detail: "PRACX operational identifier. It is not printed on the CMS-1500.",
    type: "operational",
  },
  providerNpi: {
    box: "24J / 33a",
    title: "Provider NPI",
    detail:
      "Box 24J when rendering; Box 33a when billing. Supervising provider NPI can be reported in Box 17b when applicable.",
    type: "conditional",
  },
  providerTaxonomy: {
    box: "33b / 837P",
    title: "Provider taxonomy",
    detail:
      "May be reported in Box 33b with qualifier ZZ for the billing provider when required; also maps to the 837P taxonomy data.",
    type: "conditional",
  },
  providerSpecialty: {
    box: "Scrubber",
    title: "Provider specialty",
    detail:
      "Not printed directly. Used to validate taxonomy, payer enrollment and procedure compatibility.",
    type: "operational",
  },
  providerCredentials: {
    box: "17 / 31",
    title: "Provider credentials",
    detail:
      "Included with the referring/ordering/supervising name in Box 17 or practitioner signature identity in Box 31.",
    type: "conditional",
  },
  providerLicense: {
    box: "17a / 33b",
    title: "Provider license",
    detail:
      "May be reported with qualifier 0B in Box 17a or 33b when payer instructions require a state license identifier.",
    type: "conditional",
  },
  licenseExpiration: {
    box: "Internal",
    title: "License expiration",
    detail: "Credentialing control only; it is not printed on the CMS-1500.",
    type: "operational",
  },
  facilityAssignment: {
    box: "24B / 32",
    title: "Primary service facility",
    detail:
      "Supplies the place of service for Box 24B and service-facility name/address for Box 32.",
    type: "paper",
  },
  providerRole: {
    box: "17 / 24J / 33",
    title: "Claim role",
    detail:
      "Determines whether the provider is emitted as referring/supervising in Box 17, rendering in Box 24J, or billing in Box 33.",
    type: "conditional",
  },
  email: {
    box: "Internal",
    title: "Email",
    detail: "Contact and workflow field; it is not printed on the CMS-1500.",
    type: "operational",
  },
  providerPhone: {
    box: "33",
    title: "Provider phone",
    detail:
      "Printed in Box 33 only when the selected provider or entity is the billing provider.",
    type: "conditional",
  },
  status: {
    box: "Internal",
    title: "Record status",
    detail: "Controls availability in PRACX and is not printed on the CMS-1500.",
    type: "operational",
  },
  referringName: {
    box: "17",
    title: "Referring provider name",
    detail:
      "Box 17 reports the referring, ordering or supervising provider name, credentials and applicable DN, DK or DQ qualifier.",
    type: "paper",
  },
  referringNpi: {
    box: "17b",
    title: "Referring provider NPI",
    detail: "Box 17b reports the 10-digit NPI for the provider identified in Box 17.",
    type: "paper",
  },
  referringTaxonomy: {
    box: "837P",
    title: "Referring provider taxonomy",
    detail:
      "Retained for electronic claim validation and payer rules; it is not a standard standalone CMS-1500 box for the referring provider.",
    type: "electronic",
  },
  referringContact: {
    box: "Internal",
    title: "Referral contact",
    detail:
      "Supports referral coordination and reconsideration workflows; it is not printed on the CMS-1500.",
    type: "operational",
  },
  facilityName: {
    box: "32 / 33",
    title: "Facility name",
    detail:
      "Box 32 when this is the service location; Box 33 when this entity is selected as the billing provider.",
    type: "conditional",
  },
  facilityCode: {
    box: "Internal",
    title: "Facility code",
    detail: "PRACX operational identifier. It is not printed on the CMS-1500.",
    type: "operational",
  },
  facilityType: {
    box: "24B",
    title: "Facility type",
    detail: "Supports selection and validation of the place-of-service code reported in Box 24B.",
    type: "conditional",
  },
  facilityNpi: {
    box: "32a / 33a",
    title: "Facility NPI",
    detail:
      "Box 32a for a service facility when different from the billing provider; Box 33a when this entity is the billing provider.",
    type: "conditional",
  },
  facilityPhone: {
    box: "33",
    title: "Facility phone",
    detail: "Printed in Box 33 only when this entity supplies the billing-provider information.",
    type: "conditional",
  },
  serviceLocation: {
    box: "32",
    title: "Service facility location",
    detail: "Supplies the service-facility name and address printed in Box 32.",
    type: "paper",
  },
  placeOfService: {
    box: "24B",
    title: "Place of service",
    detail: "The two-digit place-of-service code is printed on each service line in Box 24B.",
    type: "paper",
  },
} satisfies Record<string, ClaimFieldHintData>;
