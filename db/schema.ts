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

export const practiceSettings = sqliteTable("practice_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  schedulerSlotMinutes: text("scheduler_slot_minutes").notNull().default("15"),
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
    responseDays: text("response_days").notNull().default("12"),
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
    coverageType: text("coverage_type").notNull().default("health"),
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
    propertyCasualtyClaimNumber: text("property_casualty_claim_number"),
    accidentDate: text("accident_date"),
    accidentState: text("accident_state"),
    adjusterName: text("adjuster_name"),
    adjusterPhone: text("adjuster_phone"),
    adjusterEmail: text("adjuster_email"),
    adjusterFax: text("adjuster_fax"),
    claimAddressLine1: text("claim_address_line_1"),
    claimCity: text("claim_city"),
    claimState: text("claim_state"),
    claimPostalCode: text("claim_postal_code"),
    coverageLimit: text("coverage_limit"),
    amountUsed: text("amount_used").notNull().default("0.00"),
    authorizationNumber: text("authorization_number"),
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

export const patientDocuments = sqliteTable(
  "patient_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    coverageId: text("coverage_id").references(() => patientCoverages.id),
    claimId: text("claim_id"),
    category: text("category").notNull(),
    documentSide: text("document_side").notNull().default("none"),
    title: text("title").notNull(),
    originalFileName: text("original_file_name").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: text("file_size").notNull(),
    serviceDate: text("service_date"),
    analysisStatus: text("analysis_status", { enum: ["not_analyzed", "completed", "failed"] }).notNull().default("not_analyzed"),
    analysisJson: text("analysis_json"),
    analysisModel: text("analysis_model"),
    analyzedAt: text("analyzed_at"),
    analyzedBy: text("analyzed_by"),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("patient_documents_patient_idx").on(table.patientId, table.createdAt),
    index("patient_documents_coverage_idx").on(table.coverageId),
  ],
);

export const patientLegalResponsibilities = sqliteTable(
  "patient_legal_responsibilities",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    responsibilityType: text("responsibility_type").notNull(),
    balanceRole: text("balance_role").notNull().default("final_balance"),
    organizationName: text("organization_name"),
    attorneyName: text("attorney_name"),
    caseNumber: text("case_number"),
    lopNumber: text("lop_number"),
    signedDate: text("signed_date"),
    receivedDate: text("received_date"),
    effectiveDate: text("effective_date"),
    terminationDate: text("termination_date"),
    authorizedAmount: text("authorized_amount"),
    settlementStatus: text("settlement_status").notNull().default("open"),
    lienStatus: text("lien_status").notNull().default("not_recorded"),
    phone: text("phone"),
    email: text("email"),
    fax: text("fax"),
    addressLine1: text("address_line_1"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    notes: text("notes"),
    status: text("status", { enum: ["active", "inactive", "closed"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("patient_legal_responsibility_patient_idx").on(table.patientId, table.status),
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
    status: text("status", { enum: ["scheduled", "confirmed", "arrived", "checked_in", "in_room", "completed", "cancelled", "no_show"] }).notNull().default("scheduled"),
    eligibilityStatus: text("eligibility_status").notNull().default("pending"),
    flowStatus: text("flow_status", { enum: ["not_arrived", "arrived", "checked_in", "waiting", "roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"] }).notNull().default("not_arrived"),
    roomName: text("room_name"),
    flowStatusAt: text("flow_status_at"),
    arrivedAt: text("arrived_at"),
    checkedInAt: text("checked_in_at"),
    waitingAt: text("waiting_at"),
    roomedAt: text("roomed_at"),
    readyForProviderAt: text("ready_for_provider_at"),
    consultationStartedAt: text("consultation_started_at"),
    consultationEndedAt: text("consultation_ended_at"),
    checkedOutAt: text("checked_out_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("appointments_org_start_idx").on(table.organizationId, table.startAt),
    index("appointments_provider_start_idx").on(table.providerId, table.startAt),
  ],
);

export const visitFlowEvents = sqliteTable(
  "visit_flow_events",
  {
    id: text("id").primaryKey(),
    appointmentId: text("appointment_id").notNull().references(() => appointments.id),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    roomName: text("room_name"),
    note: text("note"),
    changedByUserId: text("changed_by_user_id").references(() => users.id),
    changedByName: text("changed_by_name").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [index("visit_flow_appointment_time_idx").on(table.appointmentId, table.occurredAt)],
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
    templateKey: text("template_key").notNull().default("general_soap"),
    subjectiveItemsJson: text("subjective_items_json").notNull().default("[]"),
    chiefComplaint: text("chief_complaint"),
    historyOfPresentIllness: text("history_of_present_illness"),
    reviewOfSystems: text("review_of_systems"),
    physicalExam: text("physical_exam"),
    assessment: text("assessment"),
    treatmentPlan: text("treatment_plan"),
    followUpInstructions: text("follow_up_instructions"),
    vitals: text("vitals").notNull().default("{}"),
    allergiesReviewed: text("allergies_reviewed", { enum: ["yes", "no"] }).notNull().default("no"),
    medicationsReviewed: text("medications_reviewed", { enum: ["yes", "no"] }).notNull().default("no"),
    clinicalNote: text("clinical_note"),
    codingAssistJson: text("coding_assist_json").notNull().default("{}"),
    diagnosisCodes: text("diagnosis_codes").notNull().default("[]"),
    procedureCodes: text("procedure_codes").notNull().default("[]"),
    status: text("status", { enum: ["draft", "signed", "ready_to_bill", "billed"] }).notNull().default("draft"),
    signedAt: text("signed_at"),
    signedByUserId: text("signed_by_user_id").references(() => users.id),
    signedByName: text("signed_by_name"),
    readyToBillAt: text("ready_to_bill_at"),
    lastSavedAt: text("last_saved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("encounters_patient_dos_idx").on(table.patientId, table.dateOfService)],
);

export const encounterEvents = sqliteTable(
  "encounter_events",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull().references(() => encounters.id),
    action: text("action", { enum: ["created", "saved", "signed", "ready_to_bill", "reopened"] }).notNull(),
    statusFrom: text("status_from"),
    statusTo: text("status_to").notNull(),
    changedByUserId: text("changed_by_user_id").references(() => users.id),
    changedByName: text("changed_by_name").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [index("encounter_events_encounter_time_idx").on(table.encounterId, table.occurredAt)],
);

export const diagnosisCodeMaster = sqliteTable(
  "diagnosis_code_master",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    codeSet: text("code_set").notNull().default("ICD-10-CM"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("diagnosis_code_master_code_unique").on(table.code)],
);

export const clinicalOrderCatalog = sqliteTable(
  "clinical_order_catalog",
  {
    id: text("id").primaryKey(),
    orderType: text("order_type", { enum: ["lab", "imaging"] }).notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("General"),
    keywords: text("keywords").notNull().default(""),
    specimenOrModality: text("specimen_or_modality").notNull().default(""),
    sortOrder: text("sort_order").notNull().default("100"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("clinical_order_catalog_type_code_unique").on(table.orderType, table.code),
    index("clinical_order_catalog_type_status_idx").on(table.orderType, table.status),
  ],
);

export const clinicalContentItems = sqliteTable(
  "clinical_content_items",
  {
    id: text("id").primaryKey(),
    section: text("section", { enum: ["hpi", "ros", "exam", "assessment", "plan", "follow_up", "additional_note"] }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    keywords: text("keywords").notNull().default(""),
    specialty: text("specialty").notNull().default("All specialties"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    sortOrder: text("sort_order").notNull().default("100"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("clinical_content_section_status_idx").on(table.section, table.status)],
);

export const subjectiveLibraryItems = sqliteTable(
  "subjective_library_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    itemType: text("item_type", { enum: ["complaint", "hpi", "template"] }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    keywords: text("keywords").notNull().default(""),
    specialty: text("specialty").notNull().default("All specialties"),
    associatedComplaints: text("associated_complaints").notNull().default("[]"),
    scope: text("scope", { enum: ["personal", "practice"] }).notNull().default("personal"),
    approvalStatus: text("approval_status", { enum: ["draft", "published"] }).notNull().default("draft"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdByName: text("created_by_name").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("subjective_library_org_type_status_idx").on(table.organizationId, table.itemType, table.status),
    index("subjective_library_creator_status_idx").on(table.createdByUserId, table.status),
  ],
);

export const clinicalOptionMaster = sqliteTable(
  "clinical_option_master",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    optionGroup: text("option_group").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    parentCode: text("parent_code"),
    keywords: text("keywords").notNull().default(""),
    specialty: text("specialty").notNull().default("All specialties"),
    source: text("source").notNull().default("PRACX curated"),
    version: text("version").notNull().default("2026.1"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    sortOrder: text("sort_order").notNull().default("100"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("clinical_option_org_group_code_unique").on(table.organizationId, table.optionGroup, table.code),
    index("clinical_option_group_status_idx").on(table.optionGroup, table.status),
  ],
);

export const practiceServices = sqliteTable(
  "practice_services",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    specialty: text("specialty").notNull().default("All specialties"),
    procedureCode: text("procedure_code"),
    suggestedDiagnosisCodes: text("suggested_diagnosis_codes").notNull().default("[]"),
    documentationPrompts: text("documentation_prompts").notNull().default("[]"),
    keywords: text("keywords").notNull().default(""),
    effectiveDate: text("effective_date").notNull(),
    terminationDate: text("termination_date"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("practice_services_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("practice_services_org_name_unique").on(table.organizationId, table.name),
  ],
);

export const visitNoteTemplates = sqliteTable(
  "visit_note_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    specialty: text("specialty").notNull().default("Primary Care"),
    templateJson: text("template_json").notNull().default("{}"),
    suggestedDiagnosisCodes: text("suggested_diagnosis_codes").notNull().default("[]"),
    suggestedProcedureCodes: text("suggested_procedure_codes").notNull().default("[]"),
    keywords: text("keywords").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("visit_note_templates_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("visit_note_templates_org_name_unique").on(table.organizationId, table.name),
  ],
);

export const clinicalOrders = sqliteTable(
  "clinical_orders",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull().references(() => encounters.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    providerId: text("provider_id").notNull().references(() => providers.id),
    orderType: text("order_type", { enum: ["medication", "lab", "imaging", "referral"] }).notNull(),
    code: text("code"),
    name: text("name").notNull(),
    instructions: text("instructions"),
    priority: text("priority", { enum: ["routine", "urgent", "stat"] }).notNull().default("routine"),
    status: text("status", { enum: ["draft", "ordered", "completed", "cancelled"] }).notNull().default("draft"),
    orderedByUserId: text("ordered_by_user_id").references(() => users.id),
    orderedByName: text("ordered_by_name").notNull(),
    orderedAt: text("ordered_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("clinical_orders_encounter_idx").on(table.encounterId, table.orderType)],
);

export const clinicalOrderResults = sqliteTable(
  "clinical_order_results",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => clinicalOrders.id),
    encounterId: text("encounter_id").notNull().references(() => encounters.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    resultType: text("result_type", { enum: ["lab", "imaging", "referral"] }).notNull(),
    resultStatus: text("result_status", { enum: ["preliminary", "final", "corrected"] }).notNull().default("final"),
    summary: text("summary").notNull(),
    resultData: text("result_data"),
    abnormalFlag: text("abnormal_flag", { enum: ["normal", "abnormal", "critical", "unknown"] }).notNull().default("unknown"),
    reviewStatus: text("review_status", { enum: ["pending", "reviewed"] }).notNull().default("pending"),
    resultedAt: text("resulted_at").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdByName: text("created_by_name").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    reviewedByName: text("reviewed_by_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("clinical_order_results_order_time_idx").on(table.orderId, table.resultedAt)],
);

export const patientMedications = sqliteTable(
  "patient_medications",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    encounterId: text("encounter_id").references(() => encounters.id),
    sourceOrderId: text("source_order_id").references(() => clinicalOrders.id),
    medicationName: text("medication_name").notNull(),
    rxNormCode: text("rx_norm_code"),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    instructions: text("instructions"),
    status: text("status", { enum: ["active", "inactive", "completed", "discontinued"] }).notNull().default("active"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    prescribedByUserId: text("prescribed_by_user_id").references(() => users.id),
    prescribedByName: text("prescribed_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("patient_medications_patient_status_idx").on(table.patientId, table.status),
    uniqueIndex("patient_medications_source_order_unique").on(table.sourceOrderId),
  ],
);

export const patientAllergies = sqliteTable(
  "patient_allergies",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    encounterId: text("encounter_id").references(() => encounters.id),
    allergyType: text("allergy_type", { enum: ["drug", "food", "environmental", "other", "nkda"] }).notNull().default("drug"),
    substance: text("substance").notNull(),
    reaction: text("reaction"),
    severity: text("severity", { enum: ["mild", "moderate", "severe", "unknown"] }).notNull().default("unknown"),
    status: text("status", { enum: ["active", "inactive", "entered_in_error"] }).notNull().default("active"),
    onsetDate: text("onset_date"),
    source: text("source"),
    notes: text("notes"),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id),
    recordedByName: text("recorded_by_name").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    reviewedByName: text("reviewed_by_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("patient_allergies_patient_status_idx").on(table.patientId, table.status)],
);

export const patientProblems = sqliteTable(
  "patient_problems",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    code: text("code"),
    description: text("description").notNull(),
    status: text("status", { enum: ["active", "resolved", "inactive"] }).notNull().default("active"),
    onsetDate: text("onset_date"),
    resolvedDate: text("resolved_date"),
    severity: text("severity", { enum: ["", "mild", "moderate", "severe"] }).notNull().default(""),
    notes: text("notes"),
    recordedByName: text("recorded_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("patient_problems_patient_status_idx").on(table.patientId, table.status)],
);

export const patientHistoryItems = sqliteTable(
  "patient_history_items",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    historyType: text("history_type", { enum: ["medical", "surgical", "family", "social", "hospitalization"] }).notNull(),
    title: text("title").notNull(),
    details: text("details"),
    onsetYear: text("onset_year"),
    status: text("status", { enum: ["active", "resolved", "inactive"] }).notNull().default("active"),
    recordedByName: text("recorded_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("patient_history_patient_type_idx").on(table.patientId, table.historyType)],
);

export const patientImmunizations = sqliteTable(
  "patient_immunizations",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    vaccineName: text("vaccine_name").notNull(),
    cvxCode: text("cvx_code"),
    administeredOn: text("administered_on").notNull(),
    doseNumber: text("dose_number"),
    site: text("site"),
    route: text("route"),
    lotNumber: text("lot_number"),
    manufacturer: text("manufacturer"),
    status: text("status", { enum: ["completed", "refused", "deferred"] }).notNull().default("completed"),
    notes: text("notes"),
    administeredByName: text("administered_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("patient_immunizations_patient_date_idx").on(table.patientId, table.administeredOn)],
);

export const patientFlowsheetEntries = sqliteTable(
  "patient_flowsheet_entries",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    encounterId: text("encounter_id").references(() => encounters.id),
    metricKey: text("metric_key").notNull(),
    metricLabel: text("metric_label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    recordedAt: text("recorded_at").notNull(),
    notes: text("notes"),
    recordedByName: text("recorded_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("patient_flowsheet_patient_metric_idx").on(table.patientId, table.metricKey, table.recordedAt)],
);

export const patientCareChecklistItems = sqliteTable(
  "patient_care_checklist_items",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    itemKey: text("item_key").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull().default("preventive"),
    status: text("status", { enum: ["pending", "done", "deferred", "not_applicable"] }).notNull().default("pending"),
    dueDate: text("due_date"),
    completedAt: text("completed_at"),
    notes: text("notes"),
    updatedByName: text("updated_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("patient_care_checklist_patient_key_unique").on(table.patientId, table.itemKey),
    index("patient_care_checklist_patient_status_idx").on(table.patientId, table.status),
  ],
);

export const patientRecalls = sqliteTable(
  "patient_recalls",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    reason: text("reason").notNull(),
    dueDate: text("due_date").notNull(),
    priority: text("priority", { enum: ["routine", "soon", "urgent"] }).notNull().default("routine"),
    status: text("status", { enum: ["open", "completed", "cancelled"] }).notNull().default("open"),
    notes: text("notes"),
    createdByName: text("created_by_name").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("patient_recalls_patient_status_due_idx").on(table.patientId, table.status, table.dueDate)],
);

export const refillRequests = sqliteTable(
  "refill_requests",
  {
    id: text("id").primaryKey(),
    medicationId: text("medication_id").notNull().references(() => patientMedications.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    status: text("status", { enum: ["pending", "approved", "denied", "cancelled"] }).notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
    notes: text("notes"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id),
    decidedByName: text("decided_by_name"),
    decidedAt: text("decided_at"),
    decisionNotes: text("decision_notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("refill_requests_patient_status_idx").on(table.patientId, table.status)],
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
    diagnosisCodes: text("diagnosis_codes").notNull().default("[]"),
    claimDataSnapshot: text("claim_data_snapshot").notNull().default("{}"),
    billFrequencyCode: text("bill_frequency_code"),
    originalReferenceNumber: text("original_reference_number"),
    dateOfService: text("date_of_service").notNull(),
    transactionDate: text("transaction_date").notNull(),
    paymentDate: text("payment_date"),
    postingDate: text("posting_date"),
    firstBilledDate: text("first_billed_date"),
    lastBilledDate: text("last_billed_date"),
    status: text("status", { enum: ["draft", "scrub_error", "ready", "submitted", "accepted", "rejected", "paid", "partially_paid", "denied", "appealed"] }).notNull().default("draft"),
    lifecycleStatus: text("lifecycle_status").notNull().default("new"),
    workflowStatus: text("workflow_status", {
      enum: ["needs_scrub", "scrubbing", "error", "ready_to_bill", "generating", "generated", "submitted"],
    }).notNull().default("needs_scrub"),
    scrubberStatus: text("scrubber_status").notNull().default("not_run"),
    scrubberMessages: text("scrubber_messages").notNull().default("[]"),
    lastScrubbedAt: text("last_scrubbed_at"),
    scrubResult: text("scrub_result"),
    scrubRulesChecked: text("scrub_rules_checked").notNull().default("[]"),
    scrubErrorCount: text("scrub_error_count").notNull().default("0"),
    scrubbedByUserId: text("scrubbed_by_user_id"),
    scrubbedByName: text("scrubbed_by_name"),
    totalCharge: text("total_charge").notNull().default("0.00"),
    totalPaid: text("total_paid").notNull().default("0.00"),
    totalAdjustment: text("total_adjustment").notNull().default("0.00"),
    patientResponsibility: text("patient_responsibility").notNull().default("0.00"),
    remainingBalance: text("remaining_balance").notNull().default("0.00"),
    followUpStatus: text("follow_up_status").notNull().default(""),
    submissionMode: text("submission_mode").notNull().default("file"),
    submissionMethod: text("submission_method", { enum: ["unassigned", "electronic", "paper", "hold"] }).notNull().default("unassigned"),
    routedAt: text("routed_at"),
    printedAt: text("printed_at"),
    mailedAt: text("mailed_at"),
    mailedByName: text("mailed_by_name"),
    mailMethod: text("mail_method"),
    mailTrackingNumber: text("mail_tracking_number"),
    clearinghouseTrace: text("clearinghouse_trace"),
    generationId: text("generation_id"),
    generatedAt: text("generated_at"),
    generatedByUserId: text("generated_by_user_id"),
    generatedByName: text("generated_by_name"),
    claimFormat: text("claim_format"),
    generationResult: text("generation_result"),
    generatedTransactionRef: text("generated_transaction_ref"),
    batchId: text("batch_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claims_org_number_unique").on(table.organizationId, table.claimNumber),
    index("claims_org_status_idx").on(table.organizationId, table.status),
    index("claims_workflow_status_idx").on(table.organizationId, table.workflowStatus),
    index("claims_lifecycle_status_idx").on(table.organizationId, table.lifecycleStatus),
    index("claims_batch_idx").on(table.batchId),
    index("claims_submission_queue_idx").on(table.organizationId, table.submissionMethod, table.status),
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

export const claimCorrectionHistory = sqliteTable(
  "claim_correction_history",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    action: text("action", { enum: ["save", "replacement", "void"] }).notNull().default("save"),
    changeScope: text("change_scope", { enum: ["claim_only", "claim_and_master"] }).notNull().default("claim_only"),
    reason: text("reason"),
    beforeSnapshot: text("before_snapshot").notNull(),
    afterSnapshot: text("after_snapshot").notNull(),
    changedByUserId: text("changed_by_user_id").notNull(),
    changedByName: text("changed_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("claim_correction_history_claim_idx").on(table.claimId, table.createdAt)],
);

export const claimWorkflowEvents = sqliteTable(
  "claim_workflow_events",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull().references(() => claims.id),
    previousStatus: text("previous_status"),
    newStatus: text("new_status").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    errorInformation: text("error_information"),
    actorUserId: text("actor_user_id"),
    actorName: text("actor_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("claim_workflow_events_claim_idx").on(table.claimId, table.createdAt)],
);

export const claimBatches = sqliteTable(
  "claim_batches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    batchNumber: text("batch_number").notNull(),
    payerId: text("payer_id").references(() => payers.id),
    batchType: text("batch_type", { enum: ["edi", "paper"] }).notNull().default("edi"),
    status: text("status", { enum: ["pending", "generated", "sent", "failed", "accepted"] }).notNull().default("pending"),
    claimCount: text("claim_count").notNull().default("0"),
    totalCharge: text("total_charge").notNull().default("0.00"),
    ediFileName: text("edi_file_name"),
    ediFilePath: text("edi_file_path"),
    ediContent: text("edi_content"),
    proofFileName: text("proof_file_name"),
    proofFilePath: text("proof_file_path"),
    proofContent: text("proof_content"),
    clearinghouseResponse: text("clearinghouse_response"),
    transmittedAt: text("transmitted_at"),
    transmittedByName: text("transmitted_by_name"),
    createdByUserId: text("created_by_user_id"),
    createdByName: text("created_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claim_batches_org_number_unique").on(table.organizationId, table.batchNumber),
    index("claim_batches_status_idx").on(table.organizationId, table.status, table.batchType),
  ],
);

export const claimBatchMembers = sqliteTable(
  "claim_batch_members",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => claimBatches.id),
    claimId: text("claim_id").notNull().references(() => claims.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claim_batch_member_unique").on(table.batchId, table.claimId),
    index("claim_batch_members_claim_idx").on(table.claimId),
  ],
);

export const claimTransmissionLogs = sqliteTable(
  "claim_transmission_logs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => claimBatches.id),
    transmissionTime: text("transmission_time").notNull(),
    clearinghouseResponse: text("clearinghouse_response"),
    status: text("status", { enum: ["sent", "failed", "accepted", "rejected"] }).notNull().default("sent"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("claim_transmission_logs_batch_idx").on(table.batchId, table.transmissionTime)],
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

export const paymentEntries = sqliteTable(
  "payment_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    paymentNumber: text("payment_number").notNull(),
    payerId: text("payer_id").references(() => payers.id),
    remittanceId: text("remittance_id"),
    paymentAmount: text("payment_amount").notNull().default("0.00"),
    offsetAmount: text("offset_amount").notNull().default("0.00"),
    refundAmount: text("refund_amount").notNull().default("0.00"),
    incentiveAmount: text("incentive_amount").notNull().default("0.00"),
    otherAdjustments: text("other_adjustments").notNull().default("0.00"),
    paymentTotalEffective: text("payment_total_effective").notNull().default("0.00"),
    paymentMethod: text("payment_method", { enum: ["Check", "EFT", "ERA", "Paper EOB"] }).notNull().default("Check"),
    referenceNumber: text("reference_number"),
    paymentDate: text("payment_date").notNull(),
    notes: text("notes"),
    paymentStatus: text("payment_status", { enum: ["pending", "partially_posted", "fully_posted", "error"] }).notNull().default("pending"),
    claimCount: text("claim_count").notNull().default("0"),
    postedClaimCount: text("posted_claim_count").notNull().default("0"),
    claimPaidTotal: text("claim_paid_total").notNull().default("0.00"),
    autoPostResult: text("auto_post_result"),
    errorMessage: text("error_message"),
    reconciliationStatus: text("reconciliation_status", { enum: ["balanced", "unbalanced", "pending"] }).notNull().default("pending"),
    createdByUserId: text("created_by_user_id"),
    createdByName: text("created_by_name").notNull(),
    postedAt: text("posted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_entries_org_number_unique").on(table.organizationId, table.paymentNumber),
    index("payment_entries_status_idx").on(table.organizationId, table.paymentStatus),
    index("payment_entries_payer_idx").on(table.payerId, table.paymentDate),
  ],
);

export const claimPayments = sqliteTable(
  "claim_payments",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => paymentEntries.id),
    claimId: text("claim_id").notNull().references(() => claims.id),
    allowedAmount: text("allowed_amount").notNull().default("0.00"),
    paidAmount: text("paid_amount").notNull().default("0.00"),
    adjustmentAmount: text("adjustment_amount").notNull().default("0.00"),
    patientResponsibility: text("patient_responsibility").notNull().default("0.00"),
    denialCode: text("denial_code"),
    postingStatus: text("posting_status", { enum: ["pending", "posted", "error"] }).notNull().default("pending"),
    errorMessage: text("error_message"),
    postedAt: text("posted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claim_payments_payment_claim_unique").on(table.paymentId, table.claimId),
    index("claim_payments_claim_idx").on(table.claimId),
    index("claim_payments_status_idx").on(table.paymentId, table.postingStatus),
  ],
);

export const paymentLogs = sqliteTable(
  "payment_logs",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => paymentEntries.id),
    claimId: text("claim_id").references(() => claims.id),
    actionType: text("action_type").notNull(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("payment_logs_payment_idx").on(table.paymentId, table.createdAt)],
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
    processedStatus: text("processed_status", { enum: ["pending", "processed", "error"] }).notNull().default("pending"),
    fileName: text("file_name"),
    filePath: text("file_path"),
    paymentEntryId: text("payment_entry_id"),
    unmatchedJson: text("unmatched_json").notNull().default("[]"),
    parseWarningsJson: text("parse_warnings_json").notNull().default("[]"),
    errorMessage: text("error_message"),
    raw835: text("raw_835"),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    postedAt: text("posted_at"),
    processedAt: text("processed_at"),
  },
  (table) => [uniqueIndex("remittances_trace_unique").on(table.traceNumber)],
);

export const reconciliationLogs = sqliteTable(
  "reconciliation_logs",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => paymentEntries.id),
    previousTotalEffective: text("previous_total_effective").notNull().default("0.00"),
    previousTotalPosted: text("previous_total_posted").notNull().default("0.00"),
    previousDifference: text("previous_difference").notNull().default("0.00"),
    newTotalEffective: text("new_total_effective").notNull().default("0.00"),
    newTotalPosted: text("new_total_posted").notNull().default("0.00"),
    newDifference: text("new_difference").notNull().default("0.00"),
    correctedByUserId: text("corrected_by_user_id"),
    correctedByName: text("corrected_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("reconciliation_logs_payment_idx").on(table.paymentId, table.createdAt)],
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
    /** Value inbound bundles carry in `sourceSystem` / `Bundle.meta.source` to route here. */
    sourceSystem: text("source_system"),
    mode: text("mode", { enum: ["file", "test", "live"] }).notNull().default("file"),
    status: text("status", { enum: ["configured", "needs_credentials", "active", "inactive"] }).notNull().default("needs_credentials"),
    endpoint: text("endpoint"),
    lastTestedAt: text("last_tested_at"),
    lastTestStatus: text("last_test_status"),
    lastTestMessage: text("last_test_message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("integration_org_type_unique").on(table.organizationId, table.integrationType)],
);

/**
 * Per-integration credentials. Secrets are AES-GCM encrypted with the
 * `INTEGRATION_CREDENTIAL_KEY` binding and are never returned to a client;
 * non-secret settings (endpoints, client IDs) stay readable in `plain_value`.
 */
export const integrationCredentials = sqliteTable(
  "integration_credentials",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id").notNull().references(() => integrations.id),
    fieldKey: text("field_key").notNull(),
    isSecret: text("is_secret", { enum: ["yes", "no"] }).notNull().default("yes"),
    plainValue: text("plain_value"),
    cipherText: text("cipher_text"),
    iv: text("iv"),
    lastFour: text("last_four"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("integration_credential_unique").on(table.integrationId, table.fieldKey)],
);

/** Maps external EHR/clearinghouse IDs to PRACX internal entity IDs. */
export const integrationEntityLinks = sqliteTable(
  "integration_entity_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    sourceSystem: text("source_system").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    internalId: text("internal_id").notNull(),
    label: text("label"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("integration_entity_link_unique").on(
      table.organizationId,
      table.sourceSystem,
      table.entityType,
      table.externalId,
    ),
    index("integration_entity_link_internal_idx").on(table.entityType, table.internalId),
  ],
);

/** Inbound EHR / clearinghouse payloads waiting to be accepted into PRACX. */
export const integrationInboundEvents = sqliteTable(
  "integration_inbound_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    integrationId: text("integration_id").references(() => integrations.id),
    sourceSystem: text("source_system").notNull(),
    sourceLabel: text("source_label").notNull(),
    eventType: text("event_type").notNull(),
    externalId: text("external_id"),
    patientNameExternal: text("patient_name_external"),
    patientDobExternal: text("patient_dob_external"),
    matchedPatientId: text("matched_patient_id").references(() => patients.id),
    status: text("status", {
      enum: ["accepted", "pending", "rejected", "unmatched", "held", "missing_integration"],
    }).notNull().default("pending"),
    reasonCode: text("reason_code"),
    reasonDetail: text("reason_detail"),
    payloadSummary: text("payload_summary"),
    payloadJson: text("payload_json"),
    validationJson: text("validation_json"),
    appliedPatientId: text("applied_patient_id").references(() => patients.id),
    appliedCoverageId: text("applied_coverage_id").references(() => patientCoverages.id),
    appliedAppointmentId: text("applied_appointment_id").references(() => appointments.id),
    appliedEncounterId: text("applied_encounter_id").references(() => encounters.id),
    appliedAt: text("applied_at"),
    receivedAt: text("received_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByName: text("resolved_by_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inbound_events_org_status_idx").on(table.organizationId, table.status, table.receivedAt),
    index("inbound_events_source_idx").on(table.organizationId, table.sourceSystem),
  ],
);

/** Two-way claim lifecycle sync across Elation ↔ PRACX ↔ Stedi. */
export const integrationSyncEvents = sqliteTable(
  "integration_sync_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    direction: text("direction", {
      enum: ["elation_to_pracx", "pracx_to_stedi", "stedi_to_pracx", "pracx_to_elation"],
    }).notNull(),
    eventType: text("event_type").notNull(),
    claimId: text("claim_id").references(() => claims.id),
    claimNumber: text("claim_number"),
    externalRef: text("external_ref"),
    status: text("status", { enum: ["success", "pending", "error"] }).notNull().default("pending"),
    summary: text("summary").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sync_events_org_direction_idx").on(table.organizationId, table.direction, table.occurredAt),
    index("sync_events_claim_idx").on(table.claimId),
  ],
);
