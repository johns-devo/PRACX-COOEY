import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("upgrades legacy coverage and eligibility tables before saving new fields", async () => {
  const databaseBootstrap = await readFile(
    new URL("../db/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    databaseBootstrap,
    /ALTER TABLE patient_coverages ADD COLUMN coverage_type text DEFAULT 'health' NOT NULL/,
  );
  assert.match(
    databaseBootstrap,
    /ALTER TABLE patient_coverages ADD COLUMN property_casualty_claim_number text/,
  );
  assert.match(
    databaseBootstrap,
    /ALTER TABLE patient_coverages ADD COLUMN claim_address_line_1 text/,
  );
  assert.match(
    databaseBootstrap,
    /ALTER TABLE patient_coverages ADD COLUMN amount_used text DEFAULT '0\.00' NOT NULL/,
  );
  assert.match(
    databaseBootstrap,
    /ALTER TABLE patient_coverages ADD COLUMN authorization_number text/,
  );
  assert.match(
    databaseBootstrap,
    /ALTER TABLE eligibility_checks ADD COLUMN response_details text/,
  );
});

test("stores patient and insurance-card documents with durable metadata", async () => {
  const [workspace, documentApi, schema, migration, hosting] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/patient-documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0013_next_wolverine.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Patient documents/);
  assert.match(workspace, /Front of card/);
  assert.match(workspace, /Back of card/);
  assert.match(workspace, /capture="environment"/);
  assert.match(workspace, /patient-placeholder\.png/);
  assert.match(workspace, /patient-camera-button/);
  assert.match(workspace, /patient_photo/);
  assert.match(workspace, /HCFA \/ CMS-1500/);
  assert.match(workspace, /Primary EOB/);
  assert.match(workspace, /Insurance cards & coverage history/);
  assert.match(workspace, /Edit \/ end policy/);
  assert.match(workspace, /Insurance cards & coverage history/);
  assert.match(workspace, /insurance-card-viewer/);
  assert.match(workspace, /Capture insurance card/);
  assert.match(workspace, /uploadInsuranceCardSide/);
  assert.match(workspace, /documentReturnDraft/);
  assert.match(workspace, /Returned to the patient’s Insurance section/);
  assert.match(workspace, /Upload both sides/);
  assert.match(documentApi, /MAX_FILE_SIZE = 12 \* 1024 \* 1024/);
  assert.match(documentApi, /patientDocuments/);
  assert.match(documentApi, /Cache-Control": "private, no-store"/);
  assert.match(schema, /export const patientDocuments/);
  assert.match(migration, /CREATE TABLE `patient_documents`/);
  assert.match(hosting, /"r2": "DOCUMENTS"/);
});

test("provides a full scheduler command center and guarded appointment actions", async () => {
  const [workspace, operationsApi] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Front desk flow/);
  assert.doesNotMatch(workspace, /scheduler-hero/);
  assert.match(workspace, /All providers/);
  assert.match(workspace, /Day<\/button>/);
  assert.match(workspace, /Week<\/button>/);
  assert.match(workspace, /Reschedule/);
  assert.match(workspace, /Eligibility/);
  assert.match(workspace, /No show/);
  assert.match(workspace, /In room/);
  assert.match(workspace, /Conflict protection/);
  assert.match(workspace, /Patient not found\?/);
  assert.match(workspace, /Save patient & continue booking/);
  assert.match(workspace, /Save & schedule/);
  assert.match(workspace, /appointment-readiness/);
  assert.match(operationsApi, /rescheduleAppointment/);
  assert.match(operationsApi, /already has an appointment during the selected time/);
  assert.match(operationsApi, /allowedStatuses/);
  assert.match(operationsApi, /Possible duplicate patient/);
});

test("defines onboarding, analytics, CMS-1500 guidance, provider setup and local authentication", async () => {
  const [workspace, providerWorkspace, operationsWorkspace, operationsApi, claimHint, cms1500, providerApi, referringApi, dashboard, login, auth, onboarding, layout, schema, migration, providerMigration, operationsMigration, responsibilityMigration, cmsQualifierMigration, box19Migration, responsibilityStatusMigration, currentClaimMigration, claimConfigWorkspace, claimConfigApi, claimConfigDefaults, claimConfigPage, claimConfigMigration, eligibilityUpdateMigration, coverageResponsibilityMigration] = await Promise.all([
    readFile(new URL("../app/FacilityWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProviderWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ClaimFieldHint.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cms1500.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/providers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/referring-providers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalyticsDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/onboarding.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0000_eager_iron_man.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0003_blue_meteorite.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0004_busy_bug.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0005_gigantic_guardian.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0006_amusing_nebula.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0007_sleepy_warbird.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0008_nasty_madripoor.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0009_living_ronan.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/ClaimConfigurationWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/claim-configuration/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/claim-configuration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/setup/claim-configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_tricky_malcolm_colcord.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0011_milky_centennial.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_bizarre_payback.sql", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /PRACX Care Operations/);
  assert.match(workspace, /Organization & facilities/);
  assert.match(workspace, /Add facility/);
  assert.match(workspace, /Search facilities/);
  assert.match(workspace, /NPI/);
  assert.match(workspace, /Sign out/);
  assert.match(workspace, /Finish initial setup/);
  assert.match(dashboard, /Account analytics/);
  assert.match(dashboard, /RCM work queues/);
  assert.match(dashboard, /A\/R aging/);
  assert.match(dashboard, /Transaction report/);
  assert.match(dashboard, /Posting date/);
  assert.match(dashboard, /Local operational data/);
  assert.match(dashboard, /currentTransactions/);
  assert.match(dashboard, /liveAging/);
  assert.match(login, /Secure practice access/);
  assert.match(login, /Local development access/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(schema, /serviceLocations/);
  assert.match(schema, /authSessions/);
  assert.match(schema, /users_email_unique/);
  assert.match(schema, /onboardingCompletedAt/);
  assert.match(onboarding, /completeOnboarding/);
  assert.match(onboarding, /facilityCount/);
  assert.match(schema, /facilities_org_code_unique/);
  assert.match(schema, /providerFacilityAssignments/);
  assert.match(schema, /providerLicenses/);
  assert.match(schema, /referringProviders/);
  assert.match(schema, /patientCoverages/);
  assert.match(schema, /eligibilityChecks/);
  assert.match(schema, /eligibilityUpdateHistory/);
  assert.match(schema, /responseDetails/);
  assert.match(schema, /patientLegalResponsibilities/);
  assert.match(schema, /propertyCasualtyClaimNumber/);
  assert.match(schema, /ledgerTransactions/);
  assert.match(schema, /reconsiderations/);
  assert.match(schema, /integrations/);
  assert.match(migration, /CREATE TABLE `facilities`/);
  assert.match(providerMigration, /CREATE TABLE `providers`/);
  assert.match(providerMigration, /CREATE TABLE `provider_licenses`/);
  assert.match(providerMigration, /CREATE TABLE `referring_providers`/);
  assert.match(operationsMigration, /CREATE TABLE `patients`/);
  assert.match(operationsMigration, /CREATE TABLE `claims`/);
  assert.match(operationsMigration, /CREATE TABLE `remittances`/);
  assert.match(operationsMigration, /CREATE TABLE `ledger_transactions`/);
  assert.match(providerWorkspace, /Claim roles/);
  assert.match(providerWorkspace, /Rendering provider/);
  assert.match(providerWorkspace, /Referring providers/);
  assert.match(providerWorkspace, /Search name, NPI or specialty/);
  assert.match(providerWorkspace, /ClaimFieldHint/);
  assert.match(workspace, /claimFieldHints\.placeOfService/);
  assert.match(claimHint, /CMS-1500/);
  assert.match(claimHint, /if \(!hint\) return null/);
  assert.match(claimHint, /data-tooltip/);
  assert.match(claimHint, />\s*\?\s*</);
  assert.match(cms1500, /formVersion: "02\/12"/);
  assert.match(cms1500, /instructionVersion: "13\.0 7\/25"/);
  assert.match(cms1500, /24J \/ 33a/);
  assert.match(cms1500, /17b/);
  assert.match(cms1500, /32a \/ 33a/);
  assert.match(providerApi, /NPI must contain exactly 10 digits/);
  assert.match(providerApi, /providerFacilityAssignments/);
  assert.match(referringApi, /A referring provider with this NPI already exists/);
  assert.match(operationsWorkspace, /A complete ledger powering financial and operational reporting/);
  assert.match(operationsWorkspace, /Date of service/);
  assert.match(operationsWorkspace, /Transaction date/);
  assert.match(operationsWorkspace, /Payment date/);
  assert.match(operationsWorkspace, /Posting date/);
  assert.match(operationsWorkspace, /First billed/);
  assert.match(operationsWorkspace, /Last billed/);
  assert.match(operationsWorkspace, /Import ERA 835/);
  assert.match(operationsWorkspace, /Match & post/);
  assert.match(operationsWorkspace, /ERA 835 downloaded/);
  assert.match(operationsWorkspace, /837P file generated and downloaded/);
  assert.match(operationsWorkspace, /AI-assisted scrubbing/);
  assert.match(operationsWorkspace, /Eligibility 270\/271/);
  assert.match(operationsWorkspace, /Dashboard[\s\S]*Patients[\s\S]*Scheduler[\s\S]*Eligibility/);
  assert.match(operationsWorkspace, /Verify eligibility immediately after saving/);
  assert.match(operationsWorkspace, /Check eligibility/);
  assert.match(operationsWorkspace, /Edit patient/);
  assert.match(operationsWorkspace, /Save changes/);
  assert.match(operationsWorkspace, /Termination date/);
  assert.doesNotMatch(operationsWorkspace, /insuredAddress/);
  assert.match(operationsWorkspace, /patient-form-tabs/);
  assert.match(operationsWorkspace, /patient-name-grid/);
  assert.match(operationsWorkspace, /Verify with USPS/);
  assert.match(operationsWorkspace, /ZIP\+4/);
  assert.match(operationsWorkspace, /Use standardized address/);
  assert.match(operationsWorkspace, /formatPhone/);
  assert.match(operationsWorkspace, /USPS address verification/);
  assert.doesNotMatch(operationsWorkspace, /Billing responsibility timeline/);
  assert.match(operationsWorkspace, /Add DOS responsibility profile/);
  assert.match(operationsWorkspace, /Add patient coverage/);
  assert.match(operationsWorkspace, /Add a policy/);
  assert.doesNotMatch(operationsWorkspace, /responsibility-intro/);
  assert.match(operationsWorkspace, /Remaining balance destination/);
  assert.match(operationsWorkspace, /Hold patient statements until responsibility is finalized/);
  assert.match(operationsWorkspace, /Close responsibility period/);
  assert.match(operationsWorkspace, /Billing context/);
  assert.match(operationsWorkspace, /Section \{activeTabIndex \+ 1\}/);
  assert.match(operationsWorkspace, /Payer \/ plan/);
  assert.match(operationsWorkspace, /Member \/ group/);
  assert.match(operationsWorkspace, /Box 11b qualifier/);
  assert.match(operationsWorkspace, /Y4 · Agency/);
  assert.match(operationsWorkspace, /Box 14 date qualifier/);
  assert.match(operationsWorkspace, /431 · Onset/);
  assert.match(operationsWorkspace, /Box 15 other-date qualifier/);
  assert.match(operationsWorkspace, /DN · Referring provider/);
  assert.match(operationsWorkspace, /Box 19 information qualifier/);
  assert.match(operationsWorkspace, /DCP · Goals/);
  assert.match(operationsWorkspace, /0 · ICD-10-CM/);
  assert.match(operationsWorkspace, /7 · Replacement of prior claim/);
  assert.match(operationsWorkspace, /AV · Available, not used/);
  assert.match(operationsWorkspace, /DI · Device identifier/);
  assert.match(operationsWorkspace, /N4 · National Drug Code/);
  assert.match(operationsWorkspace, /Coverage and condition — Boxes 1, 10 and 11d/);
  assert.match(operationsWorkspace, /Box 16 unable to work from/);
  assert.match(operationsWorkspace, /Box 18 hospitalization from/);
  assert.match(operationsWorkspace, /Box 20 outside lab/);
  assert.match(operationsWorkspace, /Box 23 authorization \/ referral \/ CLIA/);
  assert.match(operationsWorkspace, /Box 25 federal tax ID/);
  assert.match(operationsWorkspace, /Box 24C emergency/);
  assert.match(operationsWorkspace, /NDC 11-digit code/);
  assert.match(operationsWorkspace, /Signatures — Boxes 12, 13 and 31/);
  assert.match(operationsWorkspace, /Billing position/);
  assert.match(operationsWorkspace, /Primary responsibility/);
  assert.match(operationsWorkspace, /Guarantor/);
  assert.match(operationsWorkspace, /Remaining \/ final balance/);
  assert.match(operationsWorkspace, /CoverageTypeSelector/);
  assert.match(operationsWorkspace, /autoComplete="off"/);
  assert.doesNotMatch(operationsWorkspace, /CMS-1500 Boxes 10b, 11b \(Y4\), 14\/15 and 23/);
  assert.match(cms1500, /accidentRelated/);
  assert.match(cms1500, /legalResponsibility/);
  assert.doesNotMatch(operationsWorkspace, />Add coverage</);
  assert.doesNotMatch(operationsWorkspace, />Default order</);
  assert.doesNotMatch(operationsWorkspace, />DOS order</);
  assert.doesNotMatch(operationsWorkspace, /Date of birth<\/th><th>Contact/);
  assert.doesNotMatch(operationsWorkspace, /<th>Contact<\/th><th>Coverages/);
  assert.match(operationsWorkspace, /Open Edit to view demographics, contact and insurance details/);
  assert.match(operationsWorkspace, /coverage-order/);
  assert.match(operationsWorkspace, /Save & add another/);
  assert.match(operationsWorkspace, /Coverage & responsibility/);
  assert.match(operationsWorkspace, /Auto PIP \/ no-fault/);
  assert.match(operationsWorkspace, /Letter of Protection \(LOP\)/);
  assert.match(operationsWorkspace, /Not transmitted as an 837P insurance payer/);
  assert.match(operationsWorkspace, /Subscriber is the same as the patient/);
  assert.match(operationsWorkspace, /Check this policy’s eligibility/);
  assert.match(operationsWorkspace, /Review eligibility updates/);
  assert.match(operationsWorkspace, /Confirm & apply selected updates/);
  assert.match(operationsWorkspace, /SelectedPatientInsurance/);
  assert.match(operationsWorkspace, /continueWithNextCoverage/);
  assert.match(operationsWorkspace, /submitIntent/);
  assert.doesNotMatch(operationsWorkspace, /Reported order|Reported primary|Reported secondary|Reported tertiary/);
  assert.match(operationsApi, /ISA\*00/);
  assert.match(operationsApi, /claim837/);
  assert.match(operationsApi, /checkEligibility/);
  assert.match(operationsApi, /performEligibilityCheck/);
  assert.match(operationsApi, /confirmEligibilityUpdate/);
  assert.match(operationsApi, /eligibilityUpdateHistory/);
  assert.match(operationsApi, /responseDetails/);
  assert.match(operationsApi, /createLegalResponsibility/);
  assert.match(operationsApi, /REF\*Y4/);
  assert.match(operationsApi, /DTP\*439/);
  assert.match(operationsApi, /updatePatient/);
  assert.match(operationsApi, /lookupZip/);
  assert.match(operationsApi, /verifyAddress/);
  assert.match(operationsApi, /LOCAL_ZIP_DIRECTORY/);
  assert.match(operationsApi, /createResponsibilityProfile/);
  assert.match(operationsApi, /createPatientCoverage/);
  assert.match(operationsApi, /updateCoverageOrder/);
  assert.match(operationsApi, /The same insurance policy cannot be primary, secondary and tertiary/);
  assert.match(operationsApi, /when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3/);
  assert.match(operationsApi, /This DOS range overlaps/);
  assert.match(operationsApi, /claimResponsibilitySnapshots/);
  assert.match(operationsApi, /Box 11b qualifier and claim ID/);
  assert.match(operationsApi, /Box 19 qualifier and information/);
  assert.match(operationsApi, /LU is only valid for a supervising provider/);
  assert.match(operationsApi, /unsupported oral-cavity area/);
  assert.match(operationsApi, /requires a two-letter accident state/);
  assert.match(operationsApi, /claims with more than 50 service lines to be split/);
  assert.match(operationsApi, /NDC reporting requires an 11-digit code/);
  assert.match(schema, /billingResponsibilityProfiles/);
  assert.match(schema, /responsibilityProfileHistory/);
  assert.match(schema, /otherClaimIdQualifier/);
  assert.match(schema, /additionalClaimInfoQualifier/);
  assert.match(schema, /supplementalQualifier/);
  assert.match(responsibilityMigration, /billing_responsibility_profiles/);
  assert.match(responsibilityMigration, /claim_responsibility_snapshots/);
  assert.match(cmsQualifierMigration, /other_claim_id_qualifier/);
  assert.match(cmsQualifierMigration, /supplemental_qualifier/);
  assert.match(box19Migration, /additional_claim_info_qualifier/);
  assert.match(responsibilityStatusMigration, /verification_status` = 'unverified'/);
  assert.match(currentClaimMigration, /insurance_type_code/);
  assert.match(currentClaimMigration, /emergency_indicator/);
  assert.match(currentClaimMigration, /ndc_unit_qualifier/);
  assert.match(claimConfigWorkspace, /Administrator controls/);
  assert.match(claimConfigWorkspace, /Official code/);
  assert.match(claimConfigWorkspace, /Save audited change/);
  assert.match(claimConfigApi, /Administrator access is required/);
  assert.match(claimConfigApi, /updated_official_controls/);
  assert.match(claimConfigDefaults, /NUCC 1500 v13\.0 7\/25/);
  assert.match(claimConfigDefaults, /other_claim_id/);
  assert.match(claimConfigPage, /user\.role\.toLowerCase\(\) !== "administrator"/);
  assert.match(claimConfigMigration, /CREATE TABLE `claim_configuration_values`/);
  assert.match(claimConfigMigration, /CREATE TABLE `claim_configuration_history`/);
  assert.match(eligibilityUpdateMigration, /CREATE TABLE `eligibility_update_history`/);
  assert.match(eligibilityUpdateMigration, /ADD `response_details` text/);
  assert.match(coverageResponsibilityMigration, /CREATE TABLE `patient_legal_responsibilities`/);
  assert.match(coverageResponsibilityMigration, /ADD `coverage_type` text/);
  assert.match(coverageResponsibilityMigration, /ADD `property_casualty_claim_number` text/);
  assert.match(operationsWorkspace, /Claim configuration/);
  assert.match(operationsWorkspace, /claimConfigurationValues/);
  assert.match(operationsApi, /exact ZIP\+4/);
  assert.match(operationsApi, /Insurance plan and member ID must be entered together/);
  assert.match(operationsApi, /live eligibility adapter still requires credentials/);
  assert.match(operationsApi, /defaultGroupNumber/);
  assert.match(operationsApi, /importEra/);
  assert.match(operationsApi, /createReconsideration/);
  assert.match(operationsApi, /exceed the remaining claim balance/);
  assert.match(operationsApi, /existingCharge/);
  assert.match(operationsApi, /deliveryIntegration\?\.status === "active"/);
  assert.doesNotMatch(workspace, /codex-preview|SkeletonPreview/);
});
