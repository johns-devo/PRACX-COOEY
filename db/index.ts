import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { CLAIM_CONFIGURATION_DEFAULTS } from "../lib/claim-configuration";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let coreSchemaReady = false;

export async function ensureCoreSchema() {
  if (coreSchemaReady) return;
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
      id text PRIMARY KEY NOT NULL,
      legal_name text NOT NULL,
      dba_name text,
      organization_npi text,
      onboarding_completed_at text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS facilities (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      code text NOT NULL,
      facility_type text NOT NULL,
      npi text,
      clia_number text,
      phone text,
      email text,
      timezone text DEFAULT 'America/New_York' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS service_locations (
      id text PRIMARY KEY NOT NULL,
      facility_id text NOT NULL,
      name text NOT NULL,
      place_of_service_code text NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text,
      city text NOT NULL,
      state text NOT NULL,
      postal_code text NOT NULL,
      is_primary text DEFAULT 'yes' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      full_name text NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      password_salt text NOT NULL,
      role text DEFAULT 'administrator' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      last_login_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      token_hash text NOT NULL,
      expires_at text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS providers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      provider_code text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      credentials text,
      npi text,
      taxonomy_code text,
      specialty text NOT NULL,
      email text,
      phone text,
      is_billing text DEFAULT 'no' NOT NULL,
      is_rendering text DEFAULT 'yes' NOT NULL,
      is_supervising text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_licenses (
      id text PRIMARY KEY NOT NULL,
      provider_id text NOT NULL,
      state text NOT NULL,
      license_number text NOT NULL,
      expiration_date text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_facility_assignments (
      id text PRIMARY KEY NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      is_primary text DEFAULT 'yes' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS referring_providers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      credentials text,
      npi text,
      taxonomy_code text,
      specialty text NOT NULL,
      organization_name text,
      email text,
      phone text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      payer_id text NOT NULL,
      eligibility_payer_id text,
      claim_filing_indicator text DEFAULT 'CI' NOT NULL,
      payer_type text DEFAULT 'Commercial' NOT NULL,
      clearinghouse_route text,
      phone text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS insurance_plans (
      id text PRIMARY KEY NOT NULL,
      payer_id text NOT NULL,
      name text NOT NULL,
      plan_type text DEFAULT 'PPO' NOT NULL,
      default_group_number text,
      timely_filing_days text DEFAULT '90' NOT NULL,
      requires_referral text DEFAULT 'no' NOT NULL,
      requires_authorization text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patients (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      account_number text NOT NULL,
      first_name text NOT NULL,
      middle_name text,
      last_name text NOT NULL,
      suffix text,
      date_of_birth text NOT NULL,
      sex text DEFAULT 'unknown' NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text,
      city text NOT NULL,
      state text NOT NULL,
      postal_code text NOT NULL,
      phone text,
      email text,
      marital_status text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_coverages (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      plan_id text NOT NULL,
      coverage_type text DEFAULT 'health' NOT NULL,
      priority text DEFAULT 'unassigned' NOT NULL,
      member_id text NOT NULL,
      group_number text,
      relationship text DEFAULT 'self' NOT NULL,
      subscriber_first_name text NOT NULL,
      subscriber_last_name text NOT NULL,
      subscriber_date_of_birth text,
      subscriber_sex text,
      subscriber_address_line_1 text,
      subscriber_city text,
      subscriber_state text,
      subscriber_postal_code text,
      effective_date text,
      termination_date text,
      property_casualty_claim_number text,
      accident_date text,
      accident_state text,
      adjuster_name text,
      adjuster_phone text,
      adjuster_email text,
      adjuster_fax text,
      claim_address_line_1 text,
      claim_city text,
      claim_state text,
      claim_postal_code text,
      coverage_limit text,
      amount_used text DEFAULT '0.00' NOT NULL,
      authorization_number text,
      accept_assignment text DEFAULT 'yes' NOT NULL,
      release_of_information text DEFAULT 'yes' NOT NULL,
      assignment_of_benefits text DEFAULT 'yes' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (plan_id) REFERENCES insurance_plans(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_legal_responsibilities (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      responsibility_type text NOT NULL,
      balance_role text DEFAULT 'final_balance' NOT NULL,
      organization_name text,
      attorney_name text,
      case_number text,
      lop_number text,
      signed_date text,
      received_date text,
      effective_date text,
      termination_date text,
      authorized_amount text,
      settlement_status text DEFAULT 'open' NOT NULL,
      lien_status text DEFAULT 'not_recorded' NOT NULL,
      phone text,
      email text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      notes text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS billing_responsibility_profiles (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      profile_name text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      effective_from text NOT NULL,
      effective_to text,
      verification_status text DEFAULT 'unverified' NOT NULL,
      guarantor_type text DEFAULT 'patient' NOT NULL,
      guarantor_name text,
      patient_billing_hold text DEFAULT 'no' NOT NULL,
      reason text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS responsibility_sources (
      id text PRIMARY KEY NOT NULL,
      profile_id text NOT NULL,
      sequence text NOT NULL,
      role text NOT NULL,
      source_type text NOT NULL,
      coverage_id text,
      source_name text NOT NULL,
      activation_condition text,
      status text DEFAULT 'pending' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS responsibility_profile_history (
      id text PRIMARY KEY NOT NULL,
      profile_id text NOT NULL,
      action text NOT NULL,
      snapshot text NOT NULL,
      reason text,
      changed_by text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eligibility_checks (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      coverage_id text NOT NULL,
      date_of_service text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      copay_amount text DEFAULT '0.00' NOT NULL,
      deductible_remaining text DEFAULT '0.00' NOT NULL,
      coinsurance_percent text DEFAULT '0' NOT NULL,
      reference_number text,
      response_summary text,
      response_details text,
      checked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eligibility_update_history (
      id text PRIMARY KEY NOT NULL,
      eligibility_check_id text NOT NULL,
      patient_id text NOT NULL,
      coverage_id text NOT NULL,
      address_choice text NOT NULL,
      before_snapshot text NOT NULL,
      response_snapshot text NOT NULL,
      applied_snapshot text NOT NULL,
      reason text NOT NULL,
      changed_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (eligibility_check_id) REFERENCES eligibility_checks(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS appointments (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      patient_id text NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      start_at text NOT NULL,
      end_at text NOT NULL,
      appointment_type text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      reason text,
      status text DEFAULT 'scheduled' NOT NULL,
      eligibility_status text DEFAULT 'pending' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS encounters (
      id text PRIMARY KEY NOT NULL,
      appointment_id text,
      patient_id text NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      referring_provider_id text,
      date_of_service text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      chief_complaint text,
      clinical_note text,
      diagnosis_codes text DEFAULT '[]' NOT NULL,
      procedure_codes text DEFAULT '[]' NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      signed_at text,
      ready_to_bill_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id),
      FOREIGN KEY (referring_provider_id) REFERENCES referring_providers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procedure_codes (
      id text PRIMARY KEY NOT NULL,
      code text NOT NULL,
      description text NOT NULL,
      code_set text DEFAULT 'CPT' NOT NULL,
      default_charge text DEFAULT '0.00' NOT NULL,
      default_place_of_service text DEFAULT '11' NOT NULL,
      requires_authorization text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fee_schedules (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      payer_id text,
      name text NOT NULL,
      effective_date text NOT NULL,
      termination_date text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fee_schedule_items (
      id text PRIMARY KEY NOT NULL,
      fee_schedule_id text NOT NULL,
      procedure_code_id text NOT NULL,
      allowed_amount text NOT NULL,
      modifier text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (fee_schedule_id) REFERENCES fee_schedules(id),
      FOREIGN KEY (procedure_code_id) REFERENCES procedure_codes(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      claim_number text NOT NULL,
      patient_id text NOT NULL,
      encounter_id text,
      coverage_id text,
      payer_id text,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      referring_provider_id text,
      insurance_type_code text,
      other_plan_indicator text,
      employment_related text,
      auto_accident_related text,
      auto_accident_state text,
      other_accident_related text,
      claim_condition_codes text DEFAULT '[]' NOT NULL,
      other_claim_id_qualifier text,
      other_claim_id text,
      condition_date_qualifier text,
      condition_date text,
      other_date_qualifier text,
      other_date text,
      referring_provider_qualifier text,
      referring_other_id_qualifier text,
      referring_other_id text,
      additional_claim_info_qualifier text,
      additional_claim_info text,
      unable_to_work_from text,
      unable_to_work_to text,
      hospitalization_from text,
      hospitalization_to text,
      outside_lab_indicator text,
      outside_lab_charges text,
      prior_authorization_number text,
      federal_tax_id_type text,
      federal_tax_id_number text,
      patient_signature_on_file text,
      patient_signature_date text,
      insured_signature_on_file text,
      provider_signature_on_file text,
      provider_signature_date text,
      service_facility_other_id_qualifier text,
      service_facility_other_id text,
      billing_provider_other_id_qualifier text,
      billing_provider_other_id text,
      icd_indicator text DEFAULT '0' NOT NULL,
      bill_frequency_code text,
      original_reference_number text,
      date_of_service text NOT NULL,
      transaction_date text NOT NULL,
      payment_date text,
      posting_date text,
      first_billed_date text,
      last_billed_date text,
      status text DEFAULT 'draft' NOT NULL,
      scrubber_status text DEFAULT 'not_run' NOT NULL,
      scrubber_messages text DEFAULT '[]' NOT NULL,
      total_charge text DEFAULT '0.00' NOT NULL,
      total_paid text DEFAULT '0.00' NOT NULL,
      total_adjustment text DEFAULT '0.00' NOT NULL,
      patient_responsibility text DEFAULT '0.00' NOT NULL,
      submission_mode text DEFAULT 'file' NOT NULL,
      clearinghouse_trace text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id),
      FOREIGN KEY (referring_provider_id) REFERENCES referring_providers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_lines (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      line_number text NOT NULL,
      procedure_code text NOT NULL,
      modifiers text,
      diagnosis_pointers text DEFAULT 'A' NOT NULL,
      units text DEFAULT '1' NOT NULL,
      charge_amount text NOT NULL,
      place_of_service text DEFAULT '11' NOT NULL,
      rendering_npi text,
      emergency_indicator text,
      rendering_other_id_qualifier text,
      rendering_other_id text,
      epsdt_reason_code text,
      epsdt_indicator text,
      family_planning_indicator text,
      supplemental_qualifier text,
      supplemental_information text,
      ndc_code text,
      ndc_unit_qualifier text,
      ndc_quantity text,
      ndc_unit_price text,
      service_date_from text NOT NULL,
      service_date_to text NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_configuration_values (
      id text PRIMARY KEY NOT NULL,
      category text NOT NULL,
      code text NOT NULL,
      display_name text NOT NULL,
      internal_guidance text,
      source text DEFAULT 'NUCC 1500 v13.0 7/25' NOT NULL,
      is_official text DEFAULT 'yes' NOT NULL,
      payer_id text,
      effective_date text,
      termination_date text,
      status text DEFAULT 'active' NOT NULL,
      created_by text,
      updated_by text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_configuration_history (
      id text PRIMARY KEY NOT NULL,
      configuration_id text NOT NULL,
      action text NOT NULL,
      before_snapshot text,
      after_snapshot text NOT NULL,
      changed_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (configuration_id) REFERENCES claim_configuration_values(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_responsibility_snapshots (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      profile_id text,
      billing_context text NOT NULL,
      profile_snapshot text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id),
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS remittances (
      id text PRIMARY KEY NOT NULL,
      payer_id text,
      trace_number text NOT NULL,
      payment_date text NOT NULL,
      amount text NOT NULL,
      source text DEFAULT '835_file' NOT NULL,
      status text DEFAULT 'received' NOT NULL,
      raw_835 text,
      received_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      posted_at text,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payments (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      remittance_id text,
      payment_type text NOT NULL,
      payer_name text,
      amount text DEFAULT '0.00' NOT NULL,
      adjustment_amount text DEFAULT '0.00' NOT NULL,
      adjustment_reason text,
      reference_number text,
      transaction_date text NOT NULL,
      payment_date text NOT NULL,
      posting_date text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id),
      FOREIGN KEY (remittance_id) REFERENCES remittances(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ledger_transactions (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      patient_id text NOT NULL,
      claim_id text,
      transaction_type text NOT NULL,
      source text NOT NULL,
      amount text NOT NULL,
      description text NOT NULL,
      reference_number text,
      date_of_service text,
      transaction_date text NOT NULL,
      payment_date text,
      posting_date text NOT NULL,
      first_billed_date text,
      last_billed_date text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reconsiderations (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      method text DEFAULT 'fax' NOT NULL,
      destination text,
      reason text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      attachment_name text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      sent_at text,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      integration_type text NOT NULL,
      vendor_name text NOT NULL,
      mode text DEFAULT 'file' NOT NULL,
      status text DEFAULT 'needs_credentials' NOT NULL,
      endpoint text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS facilities_org_code_unique ON facilities (organization_id, code)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS facilities_org_status_idx ON facilities (organization_id, status)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS service_locations_facility_idx ON service_locations (facility_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_unique ON auth_sessions (token_hash)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS providers_org_code_unique ON providers (organization_id, provider_code)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS providers_npi_unique ON providers (npi)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS providers_org_status_idx ON providers (organization_id, status)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS provider_license_unique ON provider_licenses (provider_id, state, license_number)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS provider_license_provider_idx ON provider_licenses (provider_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS provider_facility_unique ON provider_facility_assignments (provider_id, facility_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS provider_facility_provider_idx ON provider_facility_assignments (provider_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS referring_providers_npi_unique ON referring_providers (npi)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS referring_providers_org_status_idx ON referring_providers (organization_id, status)",
    ),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS payers_org_payer_id_unique ON payers (organization_id, payer_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS patients_org_account_unique ON patients (organization_id, account_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS procedure_codes_code_unique ON procedure_codes (code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claims_org_number_unique ON claims (organization_id, claim_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS remittances_trace_unique ON remittances (trace_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS claims_org_status_idx ON claims (organization_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ledger_org_posting_idx ON ledger_transactions (organization_id, posting_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_profile_patient_dos_idx ON billing_responsibility_profiles (patient_id, billing_context, effective_from)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS responsibility_source_sequence_unique ON responsibility_sources (profile_id, sequence)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_source_profile_idx ON responsibility_sources (profile_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_history_profile_idx ON responsibility_profile_history (profile_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_responsibility_snapshot_unique ON claim_responsibility_snapshots (claim_id)"),
  ]);

  try {
    await db
      .prepare("ALTER TABLE organizations ADD COLUMN onboarding_completed_at text")
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) throw error;
  }

  for (const statement of [
    "ALTER TABLE appointments ADD COLUMN billing_context text DEFAULT 'routine' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN billing_context text DEFAULT 'routine' NOT NULL",
    "ALTER TABLE claims ADD COLUMN insurance_type_code text",
    "ALTER TABLE claims ADD COLUMN other_plan_indicator text",
    "ALTER TABLE claims ADD COLUMN employment_related text",
    "ALTER TABLE claims ADD COLUMN auto_accident_related text",
    "ALTER TABLE claims ADD COLUMN auto_accident_state text",
    "ALTER TABLE claims ADD COLUMN other_accident_related text",
    "ALTER TABLE claims ADD COLUMN claim_condition_codes text DEFAULT '[]' NOT NULL",
    "ALTER TABLE claims ADD COLUMN other_claim_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN other_claim_id text",
    "ALTER TABLE claims ADD COLUMN condition_date_qualifier text",
    "ALTER TABLE claims ADD COLUMN condition_date text",
    "ALTER TABLE claims ADD COLUMN other_date_qualifier text",
    "ALTER TABLE claims ADD COLUMN other_date text",
    "ALTER TABLE claims ADD COLUMN referring_provider_qualifier text",
    "ALTER TABLE claims ADD COLUMN referring_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN referring_other_id text",
    "ALTER TABLE claims ADD COLUMN additional_claim_info_qualifier text",
    "ALTER TABLE claims ADD COLUMN additional_claim_info text",
    "ALTER TABLE claims ADD COLUMN unable_to_work_from text",
    "ALTER TABLE claims ADD COLUMN unable_to_work_to text",
    "ALTER TABLE claims ADD COLUMN hospitalization_from text",
    "ALTER TABLE claims ADD COLUMN hospitalization_to text",
    "ALTER TABLE claims ADD COLUMN outside_lab_indicator text",
    "ALTER TABLE claims ADD COLUMN outside_lab_charges text",
    "ALTER TABLE claims ADD COLUMN prior_authorization_number text",
    "ALTER TABLE claims ADD COLUMN federal_tax_id_type text",
    "ALTER TABLE claims ADD COLUMN federal_tax_id_number text",
    "ALTER TABLE claims ADD COLUMN patient_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN patient_signature_date text",
    "ALTER TABLE claims ADD COLUMN insured_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN provider_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN provider_signature_date text",
    "ALTER TABLE claims ADD COLUMN service_facility_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN service_facility_other_id text",
    "ALTER TABLE claims ADD COLUMN billing_provider_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN billing_provider_other_id text",
    "ALTER TABLE claims ADD COLUMN icd_indicator text DEFAULT '0' NOT NULL",
    "ALTER TABLE claims ADD COLUMN bill_frequency_code text",
    "ALTER TABLE claims ADD COLUMN original_reference_number text",
    "ALTER TABLE claim_lines ADD COLUMN rendering_other_id_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN rendering_other_id text",
    "ALTER TABLE claim_lines ADD COLUMN emergency_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN epsdt_reason_code text",
    "ALTER TABLE claim_lines ADD COLUMN epsdt_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN family_planning_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN supplemental_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN supplemental_information text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_code text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_unit_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_quantity text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_unit_price text",
  ]) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate column name")) throw error;
    }
  }

  await db
    .prepare("UPDATE billing_responsibility_profiles SET verification_status = 'unverified' WHERE verification_status = 'reported'")
    .run();

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizations
      (id, legal_name, dba_name, organization_npi, status)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(
        "org_pracx_health",
        "PRACX Health Network, PLLC",
        "PRACX Care",
        "1487926305",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO facilities
      (id, organization_id, name, code, facility_type, npi, phone, timezone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "fac_midtown",
        "org_pracx_health",
        "Midtown Medical Center",
        "MIDTOWN",
        "Medical office",
        "1487926313",
        "(212) 555-0184",
        "America/New_York",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO facilities
      (id, organization_id, name, code, facility_type, npi, phone, timezone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "fac_riverside",
        "org_pracx_health",
        "Riverside Specialty Clinic",
        "RIVER",
        "Independent clinic",
        "1487926321",
        "(201) 555-0132",
        "America/New_York",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO service_locations
      (id, facility_id, name, place_of_service_code, address_line_1, city, state, postal_code, is_primary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "loc_midtown_main",
        "fac_midtown",
        "Main service location",
        "11",
        "315 Madison Avenue",
        "New York",
        "NY",
        "10017",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO service_locations
      (id, facility_id, name, place_of_service_code, address_line_1, city, state, postal_code, is_primary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "loc_riverside_main",
        "fac_riverside",
        "Riverside service location",
        "49",
        "820 River Road",
        "Edgewater",
        "NJ",
        "07020",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO users
      (id, full_name, email, password_hash, password_salt, role, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "usr_local_admin",
        "PRACX Administrator",
        "admin@pracx.local",
        "21f5a05f501dae8cfecbde9a357ecd72007a51ffc8f6175a3b7232d1bd548eb6",
        "e854d6d680c1f397d8f0ea37b8c470f1",
        "administrator",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO providers
      (id, organization_id, provider_code, first_name, last_name, credentials, npi, taxonomy_code, specialty, email, phone, is_billing, is_rendering, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "prv_maya_chen",
        "org_pracx_health",
        "CHEN01",
        "Maya",
        "Chen",
        "MD",
        "1487926404",
        "207Q00000X",
        "Family Medicine",
        "maya.chen@pracx.local",
        "(212) 555-0148",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO provider_licenses
      (id, provider_id, state, license_number, expiration_date, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        "lic_maya_ny",
        "prv_maya_chen",
        "NY",
        "298541",
        "2027-08-31",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO provider_facility_assignments
      (id, provider_id, facility_id, is_primary)
      VALUES (?, ?, ?, ?)`)
      .bind("pfa_maya_midtown", "prv_maya_chen", "fac_midtown", "yes"),
    db.prepare(`INSERT OR IGNORE INTO referring_providers
      (id, organization_id, first_name, last_name, credentials, npi, taxonomy_code, specialty, organization_name, phone, fax, city, state, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "ref_adrian_cole",
        "org_pracx_health",
        "Adrian",
        "Cole",
        "MD",
        "1487926412",
        "207R00000X",
        "Internal Medicine",
        "Hudson Primary Care",
        "(201) 555-0120",
        "(201) 555-0121",
        "Hoboken",
        "NJ",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO payers
      (id, organization_id, name, payer_id, eligibility_payer_id, claim_filing_indicator, payer_type, clearinghouse_route, phone, fax, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pay_aetna",
        "org_pracx_health",
        "Aetna",
        "60054",
        "60054",
        "CI",
        "Commercial",
        "Office Ally",
        "(800) 624-0756",
        "(859) 455-8650",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO payers
      (id, organization_id, name, payer_id, eligibility_payer_id, claim_filing_indicator, payer_type, clearinghouse_route, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pay_medicare",
        "org_pracx_health",
        "Medicare",
        "00882",
        "00882",
        "MB",
        "Medicare",
        "Office Ally",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO insurance_plans
      (id, payer_id, name, plan_type, default_group_number, timely_filing_days, requires_referral, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("plan_aetna_choice", "pay_aetna", "Aetna Choice POS II", "POS", "GRP44591", "90", "no", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO insurance_plans
      (id, payer_id, name, plan_type, timely_filing_days, requires_referral, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("plan_medicare_partb", "pay_medicare", "Medicare Part B", "Federal", "365", "no", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO patients
      (id, organization_id, account_number, first_name, middle_name, last_name, date_of_birth, sex, address_line_1, city, state, postal_code, phone, email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pat_olivia_martin",
        "org_pracx_health",
        "PX100001",
        "Olivia",
        "R",
        "Martin",
        "1986-04-17",
        "female",
        "114 East 38th Street",
        "New York",
        "NY",
        "10016",
        "(917) 555-0162",
        "olivia.martin@example.test",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patients
      (id, organization_id, account_number, first_name, last_name, date_of_birth, sex, address_line_1, city, state, postal_code, phone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pat_noah_wilson",
        "org_pracx_health",
        "PX100002",
        "Noah",
        "Wilson",
        "1954-11-02",
        "male",
        "88 Riverside Drive",
        "New York",
        "NY",
        "10024",
        "(646) 555-0198",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patient_coverages
      (id, patient_id, plan_id, priority, member_id, group_number, relationship, subscriber_first_name, subscriber_last_name, subscriber_date_of_birth, subscriber_sex, effective_date, accept_assignment, release_of_information, assignment_of_benefits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "cov_olivia_aetna",
        "pat_olivia_martin",
        "plan_aetna_choice",
        "primary",
        "W245801144",
        "GRP44591",
        "self",
        "Olivia",
        "Martin",
        "1986-04-17",
        "female",
        "2026-01-01",
        "yes",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patient_coverages
      (id, patient_id, plan_id, priority, member_id, relationship, subscriber_first_name, subscriber_last_name, subscriber_date_of_birth, subscriber_sex, effective_date, accept_assignment, release_of_information, assignment_of_benefits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "cov_noah_medicare",
        "pat_noah_wilson",
        "plan_medicare_partb",
        "primary",
        "1EG4TE5MK73",
        "self",
        "Noah",
        "Wilson",
        "1954-11-02",
        "male",
        "2020-11-01",
        "yes",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO billing_responsibility_profiles
      (id, patient_id, profile_name, billing_context, effective_from, verification_status, guarantor_type, guarantor_name, patient_billing_hold, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsp_olivia_routine_2026",
        "pat_olivia_martin",
        "2026 routine medical",
        "routine",
        "2026-01-01",
        "verified",
        "patient",
        "Olivia Martin",
        "no",
        "Active commercial coverage confirmed for routine medical services.",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_sources
      (id, profile_id, sequence, role, source_type, coverage_id, source_name, activation_condition, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsrc_olivia_aetna",
        "rsp_olivia_routine_2026",
        "1",
        "primary",
        "insurance",
        "cov_olivia_aetna",
        "Aetna Choice POS II",
        "Bill first for routine services within the effective range.",
        "ready",
      ),
    db.prepare(`INSERT OR IGNORE INTO billing_responsibility_profiles
      (id, patient_id, profile_name, billing_context, effective_from, verification_status, guarantor_type, guarantor_name, patient_billing_hold, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsp_noah_routine_2026",
        "pat_noah_wilson",
        "Medicare routine medical",
        "routine",
        "2026-01-01",
        "unverified",
        "patient",
        "Noah Wilson",
        "no",
        "Current working order is unverified; COB confirmation remains due.",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_sources
      (id, profile_id, sequence, role, source_type, coverage_id, source_name, activation_condition, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsrc_noah_medicare",
        "rsp_noah_routine_2026",
        "1",
        "primary",
        "insurance",
        "cov_noah_medicare",
        "Medicare Part B",
        "Bill after confirming Medicare Secondary Payer status.",
        "pending",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_profile_history
      (id, profile_id, action, snapshot, reason, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        "rhist_olivia_created",
        "rsp_olivia_routine_2026",
        "created",
        '{"billingContext":"routine","effectiveFrom":"2026-01-01","primary":"Aetna Choice POS II","guarantor":"Olivia Martin"}',
        "Initial responsibility profile",
        "PRACX Administrator",
      ),
    db.prepare(`INSERT OR IGNORE INTO eligibility_checks
      (id, patient_id, coverage_id, date_of_service, status, copay_amount, deductible_remaining, coinsurance_percent, reference_number, response_summary, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "elig_olivia_0728",
        "pat_olivia_martin",
        "cov_olivia_aetna",
        "2026-07-28",
        "eligible",
        "30.00",
        "420.00",
        "20",
        "ELG7845221",
        "Active medical coverage; specialist copay $30.",
        "2026-07-28T08:15:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO appointments
      (id, organization_id, patient_id, provider_id, facility_id, start_at, end_at, appointment_type, reason, status, eligibility_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "apt_olivia_followup",
        "org_pracx_health",
        "pat_olivia_martin",
        "prv_maya_chen",
        "fac_midtown",
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:30:00.000Z",
        "Office follow-up",
        "Hypertension follow-up",
        "completed",
        "eligible",
      ),
    db.prepare(`INSERT OR IGNORE INTO appointments
      (id, organization_id, patient_id, provider_id, facility_id, start_at, end_at, appointment_type, reason, status, eligibility_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "apt_noah_awv",
        "org_pracx_health",
        "pat_noah_wilson",
        "prv_maya_chen",
        "fac_midtown",
        "2026-07-29T14:00:00.000Z",
        "2026-07-29T14:45:00.000Z",
        "Annual wellness",
        "Medicare annual wellness visit",
        "confirmed",
        "pending",
      ),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_99213", "99213", "Office/outpatient visit, established patient", "CPT", "145.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_93000", "93000", "Electrocardiogram with interpretation", "CPT", "85.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_g0439", "G0439", "Annual wellness visit, subsequent", "HCPCS", "225.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO fee_schedules
      (id, organization_id, payer_id, name, effective_date, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("fs_aetna_2026", "org_pracx_health", "pay_aetna", "Aetna 2026 Contract", "2026-01-01", "active"),
    db.prepare(`INSERT OR IGNORE INTO fee_schedule_items
      (id, fee_schedule_id, procedure_code_id, allowed_amount)
      VALUES (?, ?, ?, ?)`)
      .bind("fsi_aetna_99213", "fs_aetna_2026", "proc_99213", "112.50"),
    db.prepare(`INSERT OR IGNORE INTO fee_schedule_items
      (id, fee_schedule_id, procedure_code_id, allowed_amount)
      VALUES (?, ?, ?, ?)`)
      .bind("fsi_aetna_93000", "fs_aetna_2026", "proc_93000", "62.00"),
    db.prepare(`INSERT OR IGNORE INTO encounters
      (id, appointment_id, patient_id, provider_id, facility_id, referring_provider_id, date_of_service, chief_complaint, clinical_note, diagnosis_codes, procedure_codes, status, signed_at, ready_to_bill_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "enc_olivia_0728",
        "apt_olivia_followup",
        "pat_olivia_martin",
        "prv_maya_chen",
        "fac_midtown",
        "ref_adrian_cole",
        "2026-07-28",
        "Blood pressure follow-up",
        "Blood pressure improving. Continue medication and home monitoring.",
        '["I10"]',
        '["99213"]',
        "ready_to_bill",
        "2026-07-28T10:35:00.000Z",
        "2026-07-28T10:36:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO claims
      (id, organization_id, claim_number, patient_id, encounter_id, coverage_id, payer_id, provider_id, facility_id, referring_provider_id, date_of_service, transaction_date, posting_date, first_billed_date, last_billed_date, status, scrubber_status, scrubber_messages, total_charge, total_paid, total_adjustment, patient_responsibility, submission_mode, clearinghouse_trace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "clm_100001",
        "org_pracx_health",
        "CLM100001",
        "pat_olivia_martin",
        "enc_olivia_0728",
        "cov_olivia_aetna",
        "pay_aetna",
        "prv_maya_chen",
        "fac_midtown",
        "ref_adrian_cole",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "accepted",
        "clean",
        "[]",
        "145.00",
        "82.50",
        "32.50",
        "30.00",
        "test",
        "CH202607280001",
      ),
    db.prepare(`INSERT OR IGNORE INTO claim_responsibility_snapshots
      (id, claim_id, profile_id, billing_context, profile_snapshot)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(
        "crs_clm_100001",
        "clm_100001",
        "rsp_olivia_routine_2026",
        "routine",
        '{"profileName":"2026 routine medical","effectiveFrom":"2026-01-01","primary":"Aetna Choice POS II","guarantor":"Olivia Martin","patientBillingHold":"no"}',
      ),
    db.prepare(`INSERT OR IGNORE INTO claim_lines
      (id, claim_id, line_number, procedure_code, diagnosis_pointers, units, charge_amount, place_of_service, rendering_npi, service_date_from, service_date_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("cline_100001_1", "clm_100001", "1", "99213", "A", "1", "145.00", "11", "1487926404", "2026-07-28", "2026-07-28"),
    db.prepare(`INSERT OR IGNORE INTO remittances
      (id, payer_id, trace_number, payment_date, amount, source, status, raw_835, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "era_aetna_0728",
        "pay_aetna",
        "EFT78442026",
        "2026-07-28",
        "82.50",
        "835_test",
        "posted",
        "ISA*00*          *00*          *ZZ*AETNA          *ZZ*PRACX          *260728*1200*^*00501*000000001*0*T*:~",
        "2026-07-28T12:20:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO payments
      (id, claim_id, remittance_id, payment_type, payer_name, amount, adjustment_amount, adjustment_reason, reference_number, transaction_date, payment_date, posting_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pmt_clm100001",
        "clm_100001",
        "era_aetna_0728",
        "insurance",
        "Aetna",
        "82.50",
        "32.50",
        "CO-45 Contractual obligation",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_charge_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "charge",
        "EMR",
        "145.00",
        "99213 Office visit",
        "CLM100001",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, payment_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_payment_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "insurance_payment",
        "ERA 835",
        "-82.50",
        "Aetna insurance payment",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, payment_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_adjustment_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "adjustment",
        "ERA 835",
        "-32.50",
        "CO-45 Contractual adjustment",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_clearinghouse", "org_pracx_health", "clearinghouse", "Not selected", "file", "needs_credentials"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_eligibility", "org_pracx_health", "eligibility_270_271", "Test responder", "test", "configured"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_era", "org_pracx_health", "era_835", "File import", "file", "configured"),
  ]);

  await db.batch(CLAIM_CONFIGURATION_DEFAULTS.map((item) =>
    db.prepare(`INSERT OR IGNORE INTO claim_configuration_values
      (id, category, code, display_name, internal_guidance, source, is_official, effective_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `official:${item.category}:${item.code}`,
        item.category,
        item.code,
        item.displayName,
        item.guidance,
        "NUCC 1500 v13.0 7/25",
        "yes",
        item.effectiveDate || "2025-07-01",
        "active",
      )));

  coreSchemaReady = true;
}
