import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  dbaName: text("dba_name"),
  organizationNpi: text("organization_npi"),
  onboardingCompletedAt: text("onboarding_completed_at"),
  status: text("status", { enum: ["active", "inactive"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const facilities = sqliteTable(
  "facilities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    facilityType: text("facility_type").notNull(),
    npi: text("npi"),
    cliaNumber: text("clia_number"),
    phone: text("phone"),
    email: text("email"),
    timezone: text("timezone").notNull().default("America/New_York"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("facilities_org_code_unique").on(
      table.organizationId,
      table.code,
    ),
    index("facilities_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const serviceLocations = sqliteTable(
  "service_locations",
  {
    id: text("id").primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    placeOfServiceCode: text("place_of_service_code").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    isPrimary: text("is_primary", { enum: ["yes", "no"] })
      .notNull()
      .default("yes"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("service_locations_facility_idx").on(table.facilityId),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    role: text("role").notNull().default("administrator"),
    status: text("status", { enum: ["active", "inactive", "locked"] })
      .notNull()
      .default("active"),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.tokenHash),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    providerCode: text("provider_code").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    credentials: text("credentials"),
    npi: text("npi"),
    taxonomyCode: text("taxonomy_code"),
    specialty: text("specialty").notNull(),
    email: text("email"),
    phone: text("phone"),
    isBilling: text("is_billing", { enum: ["yes", "no"] }).notNull().default("no"),
    isRendering: text("is_rendering", { enum: ["yes", "no"] }).notNull().default("yes"),
    isSupervising: text("is_supervising", { enum: ["yes", "no"] }).notNull().default("no"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("providers_org_code_unique").on(table.organizationId, table.providerCode),
    uniqueIndex("providers_npi_unique").on(table.npi),
    index("providers_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const providerLicenses = sqliteTable(
  "provider_licenses",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull().references(() => providers.id),
    state: text("state").notNull(),
    licenseNumber: text("license_number").notNull(),
    expirationDate: text("expiration_date"),
    status: text("status", { enum: ["active", "expired", "pending"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("provider_license_unique").on(table.providerId, table.state, table.licenseNumber),
    index("provider_license_provider_idx").on(table.providerId),
  ],
);

export const providerFacilityAssignments = sqliteTable(
  "provider_facility_assignments",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull().references(() => providers.id),
    facilityId: text("facility_id").notNull().references(() => facilities.id),
    isPrimary: text("is_primary", { enum: ["yes", "no"] }).notNull().default("yes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("provider_facility_unique").on(table.providerId, table.facilityId),
    index("provider_facility_provider_idx").on(table.providerId),
  ],
);

export const referringProviders = sqliteTable(
  "referring_providers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    credentials: text("credentials"),
    npi: text("npi"),
    taxonomyCode: text("taxonomy_code"),
    specialty: text("specialty").notNull(),
    organizationName: text("organization_name"),
    email: text("email"),
    phone: text("phone"),
    fax: text("fax"),
    addressLine1: text("address_line_1"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("referring_providers_npi_unique").on(table.npi),
    index("referring_providers_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const payers = sqliteTable(
  "payers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    payerId: text("payer_id").notNull(),
    eligibilityPayerId: text("eligibility_payer_id"),
    claimFilingIndicator: text("claim_filing_indicator").notNull().default("CI"),
    payerType: text("payer_type").notNull().default("Commercial"),
    clearinghouseRoute: text("clearinghouse_route"),
    phone: text("phone"),
    fax: text("fax"),
    addressLine1: text("address_line_1"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payers_org_payer_id_unique").on(table.organizationId, table.payerId),
    index("payers_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insurancePlans = sqliteTable(
  "insurance_plans",
  {
    id: text("id").primaryKey(),
    payerId: text("payer_id").notNull().references(() => payers.id),
    name: text("name").notNull(),
    planType: text("plan_type").notNull().default("PPO"),
    defaultGroupNumber: text("default_group_number"),
    timelyFilingDays: text("timely_filing_days").notNull().default("90"),
    requiresReferral: text("requires_referral", { enum: ["yes", "no"] }).notNull().default("no"),
    requiresAuthorization: text("requires_authorization", { enum: ["yes", "no"] }).notNull().default("no"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("insurance_plans_payer_idx").on(table.payerId)],
);

export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    accountNumber: text("account_number").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    suffix: text("suffix"),
    dateOfBirth: text("date_of_birth").notNull(),
    sex: text("sex", { enum: ["male", "female", "unknown"] }).notNull().default("unknown"),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    phone: text("phone"),
    email: text("email"),
    maritalStatus: text("marital_status"),
    status: text("status", { enum: ["active", "inactive", "deceased"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("patients_org_account_unique").on(table.organizationId, table.accountNumber),
    index("patients_org_name_idx").on(table.organizationId, table.lastName, table.firstName),
  ],
);

export const patientCoverages = sqliteTable(
  "patient_coverages",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    planId: text("plan_id").notNull().references(() => insurancePlans.id),
    priority: text("priority").notNull().default("unassigned"),
    memberId: text("member_id").notNull(),
    groupNumber: text("group_number"),
    relationship: text("relationship").notNull().default("self"),
    subscriberFirstName: text("subscriber_first_name").notNull(),
    subscriberLastName: text("subscriber_last_name").notNull(),
    subscriberDateOfBirth: text("subscriber_date_of_birth"),
    subscriberSex: text("subscriber_sex"),
    subscriberAddressLine1: text("subscriber_address_line_1"),
    subscriberCity: text("subscriber_city"),
    subscriberState: text("subscriber_state"),
    subscriberPostalCode: text("subscriber_postal_code"),
    effectiveDate: text("effective_date"),
    terminationDate: text("termination_date"),
    acceptAssignment: text("accept_assignment", { enum: ["yes", "no"] }).notNull().default("yes"),
    releaseOfInformation: text("release_of_information", { enum: ["yes", "no"] }).notNull().default("yes"),
    assignmentOfBenefits: text("assignment_of_benefits", { enum: ["yes", "no"] }).notNull().default("yes"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("patient_coverages_patient_idx").on(table.patientId),
    uniqueIndex("patient_coverage_member_unique").on(table.patientId, table.planId, table.memberId),
  ],
);

export const billingResponsibilityProfiles = sqliteTable(
  "billing_responsibility_profiles",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    profileName: text("profile_name").notNull(),
    billingContext: text("billing_context").notNull().default("routine"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    guarantorType: text("guarantor_type").notNull().default("patient"),
    guarantorName: text("guarantor_name"),
    patientBillingHold: text("patient_billing_hold", { enum: ["yes", "no"] }).notNull().default("no"),
    reason: text("reason"),
    status: text("status", { enum: ["active", "superseded", "closed"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("responsibility_profile_patient_dos_idx").on(table.patientId, table.billingContext, table.effectiveFrom),
  ],
);

export const responsibilitySources = sqliteTable(
  "responsibility_sources",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull().references(() => billingResponsibilityProfiles.id),
    sequence: text("sequence").notNull(),
    role: text("role").notNull(),
    sourceType: text("source_type").notNull(),
    coverageId: text("coverage_id").references(() => patientCoverages.id),
    sourceName: text("source_name").notNull(),
    activationCondition: text("activation_condition"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("responsibility_source_sequence_unique").on(table.profileId, table.sequence),
    index("responsibility_source_profile_idx").on(table.profileId),
  ],
);

export const responsibilityProfileHistory = sqliteTable(
  "responsibility_profile_history",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull().references(() => billingResponsibilityProfiles.id),
    action: text("action").notNull(),
    snapshot: text("snapshot").notNull(),
    reason: text("reason"),
    changedBy: text("changed_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("responsibility_history_profile_idx").on(table.profileId)],
);

export const eligibilityChecks = sqliteTable(
  "eligibility_checks",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    coverageId: text("coverage_id").notNull().references(() => patientCoverages.id),
    dateOfService: text("date_of_service").notNull(),
    status: text("status", { enum: ["eligible", "inactive", "pending", "error"] }).notNull().default("pending"),
    copayAmount: text("copay_amount").notNull().default("0.00"),
    deductibleRemaining: text("deductible_remaining").notNull().default("0.00"),
    coinsurancePercent: text("coinsurance_percent").notNull().default("0"),
    referenceNumber: text("reference_number"),
    responseSummary: text("response_summary"),
    responseDetails: text("response_details"),
    checkedAt: text("checked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("eligibility_patient_dos_idx").on(table.patientId, table.dateOfService)],
);

export const eligibilityUpdateHistory = sqliteTable(
  "eligibility_update_history",
  {
    id: text("id").primaryKey(),
    eligibilityCheckId: text("eligibility_check_id").notNull().references(() => eligibilityChecks.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    coverageId: text("coverage_id").notNull().references(() => patientCoverages.id),
    addressChoice: text("address_choice").notNull(),
    beforeSnapshot: text("before_snapshot").notNull(),
    responseSnapshot: text("response_snapshot").notNull(),
    appliedSnapshot: text("applied_snapshot").notNull(),
    reason: text("reason").notNull(),
    changedBy: text("changed_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("eligibility_update_patient_idx").on(table.patientId, table.createdAt)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    providerId: text("provider_id").notNull().references(() => providers.id),
    facilityId: text("facility_id").notNull().references(() => facilities.id),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    appointmentType: text("appointment_type").notNull(),
    billingContext: text("billing_context").notNull().default("routine"),
    reason: text("reason"),
    status: text("status", { enum: ["scheduled", "confirmed", "checked_in", "in_room", "completed", "cancelled", "no_show"] }).notNull().default("scheduled"),
    eligibilityStatus: text("eligibility_status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("appointments_org_start_idx").on(table.organizationId, table.startAt),
    index("appointments_provider_start_idx").on(table.providerId, table.startAt),
  ],
);

export const encounters = sqliteTable(
  "encounters",
  {
    id: text("id").primaryKey(),
    appointmentId: text("appointment_id").references(() => appointments.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    providerId: text("provider_id").notNull().references(() => providers.id),
    facilityId: text("facility_id").notNull().references(() => facilities.id),
    referringProviderId: text("referring_provider_id").references(() => referringProviders.id),
    dateOfService: text("date_of_service").notNull(),
    billingContext: text("billing_context").notNull().default("routine"),
    chiefComplaint: text("chief_complaint"),
    clinicalNote: text("clinical_note"),
    diagnosisCodes: text("diagnosis_codes").notNull().default("[]"),
    procedureCodes: text("procedure_codes").notNull().default("[]"),
    status: text("status", { enum: ["draft", "signed", "ready_to_bill", "billed"] }).notNull().default("draft"),
    signedAt: text("signed_at"),
    readyToBillAt: text("ready_to_bill_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("encounters_patient_dos_idx").on(table.patientId, table.dateOfService)],
);

export const procedureCodes = sqliteTable(
  "procedure_codes",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    codeSet: text("code_set").notNull().default("CPT"),
    defaultCharge: text("default_charge").notNull().default("0.00"),
    defaultPlaceOfService: text("default_place_of_service").notNull().default("11"),
    requiresAuthorization: text("requires_authorization", { enum: ["yes", "no"] }).notNull().default("no"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("procedure_codes_code_unique").on(table.code)],
);

export const feeSchedules = sqliteTable(
  "fee_schedules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    payerId: text("payer_id").references(() => payers.id),
    name: text("name").notNull(),
    effectiveDate: text("effective_date").notNull(),
    terminationDate: text("termination_date"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("fee_schedules_org_idx").on(table.organizationId)],
);

export const feeScheduleItems = sqliteTable(
  "fee_schedule_items",
  {
    id: text("id").primaryKey(),
    feeScheduleId: text("fee_schedule_id").notNull().references(() => feeSchedules.id),
    procedureCodeId: text("procedure_code_id").notNull().references(() => procedureCodes.id),
    allowedAmount: text("allowed_amount").notNull(),
    modifier: text("modifier"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("fee_item_unique").on(table.feeScheduleId, table.procedureCodeId, table.modifier)],
);

export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    claimNumber: text("claim_number").notNull(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    encounterId: text("encounter_id").references(() => encounters.id),
    coverageId: text("coverage_id").references(() => patientCoverages.id),
    payerId: text("payer_id").references(() => payers.id),
    providerId: text("provider_id").notNull().references(() => providers.id),
    facilityId: text("facility_id").notNull().references(() => facilities.id),
    referringProviderId: text("referring_provider_id").references(() => referringProviders.id),
    insuranceTypeCode: text("insurance_type_code"),
    otherPlanIndicator: text("other_plan_indicator"),
    employmentRelated: text("employment_related"),
    autoAccidentRelated: text("auto_accident_related"),
    autoAccidentState: text("auto_accident_state"),
    otherAccidentRelated: text("other_accident_related"),
    claimConditionCodes: text("claim_condition_codes").notNull().default("[]"),
    otherClaimIdQualifier: text("other_claim_id_qualifier"),
    otherClaimId: text("other_claim_id"),
    conditionDateQualifier: text("condition_date_qualifier"),
    conditionDate: text("condition_date"),
    otherDateQualifier: text("other_date_qualifier"),
    otherDate: text("other_date"),
    referringProviderQualifier: text("referring_provider_qualifier"),
    referringOtherIdQualifier: text("referring_other_id_qualifier"),
    referringOtherId: text("referring_other_id"),
    additionalClaimInfoQualifier: text("additional_claim_info_qualifier"),
    additionalClaimInfo: text("additional_claim_info"),
    unableToWorkFrom: text("unable_to_work_from"),
    unableToWorkTo: text("unable_to_work_to"),
    hospitalizationFrom: text("hospitalization_from"),
    hospitalizationTo: text("hospitalization_to"),
    outsideLabIndicator: text("outside_lab_indicator"),
    outsideLabCharges: text("outside_lab_charges"),
    priorAuthorizationNumber: text("prior_authorization_number"),
    federalTaxIdType: text("federal_tax_id_type"),
    federalTaxIdNumber: text("federal_tax_id_number"),
    patientSignatureOnFile: text("patient_signature_on_file"),
    patientSignatureDate: text("patient_signature_date"),
    insuredSignatureOnFile: text("insured_signature_on_file"),
    providerSignatureOnFile: text("provider_signature_on_file"),
    providerSignatureDate: text("provider_signature_date"),
    serviceFacilityOtherIdQualifier: text("service_facility_other_id_qualifier"),
    serviceFacilityOtherId: text("service_facility_other_id"),
    billingProviderOtherIdQualifier: text("billing_provider_other_id_qualifier"),
    billingProviderOtherId: text("billing_provider_other_id"),
    icdIndicator: text("icd_indicator").notNull().default("0"),
    billFrequencyCode: text("bill_frequency_code"),
    originalReferenceNumber: text("original_reference_number"),
    dateOfService: text("date_of_service").notNull(),
    transactionDate: text("transaction_date").notNull(),
    paymentDate: text("payment_date"),
    postingDate: text("posting_date"),
    firstBilledDate: text("first_billed_date"),
    lastBilledDate: text("last_billed_date"),
    status: text("status", { enum: ["draft", "scrub_error", "ready", "submitted", "accepted", "rejected", "paid", "denied", "appealed"] }).notNull().default("draft"),
    scrubberStatus: text("scrubber_status").notNull().default("not_run"),
    scrubberMessages: text("scrubber_messages").notNull().default("[]"),
    totalCharge: text("total_charge").notNull().default("0.00"),
    totalPaid: text("total_paid").notNull().default("0.00"),
    totalAdjustment: text("total_adjustment").notNull().default("0.00"),
    patientResponsibility: text("patient_responsibility").notNull().default("0.00"),
    submissionMode: text("submission_mode").notNull().default("file"),
    clearinghouseTrace: text("clearinghouse_trace"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claims_org_number_unique").on(table.organizationId, table.claimNumber),
    index("claims_org_status_idx").on(table.organizationId, table.status),
    index("claims_dos_idx").on(table.dateOfService),
  ],
);

export const claimLines = sqliteTable(
  "claim_lines",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    lineNumber: text("line_number").notNull(),
    procedureCode: text("procedure_code").notNull(),
    modifiers: text("modifiers"),
    diagnosisPointers: text("diagnosis_pointers").notNull().default("A"),
    units: text("units").notNull().default("1"),
    chargeAmount: text("charge_amount").notNull(),
    placeOfService: text("place_of_service").notNull().default("11"),
    renderingNpi: text("rendering_npi"),
    emergencyIndicator: text("emergency_indicator"),
    renderingOtherIdQualifier: text("rendering_other_id_qualifier"),
    renderingOtherId: text("rendering_other_id"),
    epsdtReasonCode: text("epsdt_reason_code"),
    epsdtIndicator: text("epsdt_indicator"),
    familyPlanningIndicator: text("family_planning_indicator"),
    supplementalQualifier: text("supplemental_qualifier"),
    supplementalInformation: text("supplemental_information"),
    ndcCode: text("ndc_code"),
    ndcUnitQualifier: text("ndc_unit_qualifier"),
    ndcQuantity: text("ndc_quantity"),
    ndcUnitPrice: text("ndc_unit_price"),
    serviceDateFrom: text("service_date_from").notNull(),
    serviceDateTo: text("service_date_to").notNull(),
  },
  (table) => [uniqueIndex("claim_line_unique").on(table.claimId, table.lineNumber)],
);

export const claimConfigurationValues = sqliteTable(
  "claim_configuration_values",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    internalGuidance: text("internal_guidance"),
    source: text("source").notNull().default("NUCC 1500 v13.0 7/25"),
    isOfficial: text("is_official", { enum: ["yes", "no"] }).notNull().default("yes"),
    payerId: text("payer_id").references(() => payers.id),
    effectiveDate: text("effective_date"),
    terminationDate: text("termination_date"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claim_config_category_code_payer_unique").on(table.category, table.code, table.payerId),
    index("claim_config_category_status_idx").on(table.category, table.status),
  ],
);

export const claimConfigurationHistory = sqliteTable(
  "claim_configuration_history",
  {
    id: text("id").primaryKey(),
    configurationId: text("configuration_id").notNull().references(() => claimConfigurationValues.id),
    action: text("action").notNull(),
    beforeSnapshot: text("before_snapshot"),
    afterSnapshot: text("after_snapshot").notNull(),
    changedBy: text("changed_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("claim_config_history_config_idx").on(table.configurationId)],
);

export const claimResponsibilitySnapshots = sqliteTable(
  "claim_responsibility_snapshots",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    profileId: text("profile_id").references(() => billingResponsibilityProfiles.id),
    billingContext: text("billing_context").notNull(),
    profileSnapshot: text("profile_snapshot").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("claim_responsibility_snapshot_unique").on(table.claimId)],
);

export const remittances = sqliteTable(
  "remittances",
  {
    id: text("id").primaryKey(),
    payerId: text("payer_id").references(() => payers.id),
    traceNumber: text("trace_number").notNull(),
    paymentDate: text("payment_date").notNull(),
    amount: text("amount").notNull(),
    source: text("source").notNull().default("835_file"),
    status: text("status", { enum: ["received", "matched", "review", "posted"] }).notNull().default("received"),
    raw835: text("raw_835"),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    postedAt: text("posted_at"),
  },
  (table) => [uniqueIndex("remittances_trace_unique").on(table.traceNumber)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    remittanceId: text("remittance_id").references(() => remittances.id),
    paymentType: text("payment_type").notNull(),
    payerName: text("payer_name"),
    amount: text("amount").notNull().default("0.00"),
    adjustmentAmount: text("adjustment_amount").notNull().default("0.00"),
    adjustmentReason: text("adjustment_reason"),
    referenceNumber: text("reference_number"),
    transactionDate: text("transaction_date").notNull(),
    paymentDate: text("payment_date").notNull(),
    postingDate: text("posting_date").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("payments_claim_idx").on(table.claimId)],
);

export const ledgerTransactions = sqliteTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    claimId: text("claim_id").references(() => claims.id),
    transactionType: text("transaction_type").notNull(),
    source: text("source").notNull(),
    amount: text("amount").notNull(),
    description: text("description").notNull(),
    referenceNumber: text("reference_number"),
    dateOfService: text("date_of_service"),
    transactionDate: text("transaction_date").notNull(),
    paymentDate: text("payment_date"),
    postingDate: text("posting_date").notNull(),
    firstBilledDate: text("first_billed_date"),
    lastBilledDate: text("last_billed_date"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("ledger_org_posting_idx").on(table.organizationId, table.postingDate),
    index("ledger_claim_idx").on(table.claimId),
  ],
);

export const reconsiderations = sqliteTable(
  "reconsiderations",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    method: text("method", { enum: ["fax", "email", "portal", "mail"] }).notNull().default("fax"),
    destination: text("destination"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["draft", "ready", "sent", "failed"] }).notNull().default("draft"),
    attachmentName: text("attachment_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
  },
  (table) => [index("reconsiderations_claim_idx").on(table.claimId)],
);

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    integrationType: text("integration_type").notNull(),
    vendorName: text("vendor_name").notNull(),
    mode: text("mode", { enum: ["file", "test", "live"] }).notNull().default("file"),
    status: text("status", { enum: ["configured", "needs_credentials", "active", "inactive"] }).notNull().default("needs_credentials"),
    endpoint: text("endpoint"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("integration_org_type_unique").on(table.organizationId, table.integrationType)],
);
