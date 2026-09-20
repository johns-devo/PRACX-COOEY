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

test("stores patient documents and defers medical-document AI", async () => {
  const [workspace, documentApi, futureAiRequirement, archivedPrototype, schema, migration, hosting] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/patient-documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../requirements/future/medical-document-ai/README.md", import.meta.url), "utf8"),
    readFile(new URL("../requirements/future/medical-document-ai/prototype/patient-lab-analysis.route.ts", import.meta.url), "utf8"),
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
  assert.match(workspace, /Returned to the patient’s/);
  assert.match(workspace, /Upload both sides/);
  assert.match(workspace, /Previous medical documents/);
  assert.match(workspace, /Upload multiple files/);
  assert.match(workspace, /Complete document history/);
  assert.match(workspace, /All existing and future uploads appear in this single list automatically/);
  assert.match(workspace, /document-row-number/);
  assert.match(workspace, /Document date/);
  assert.match(workspace, /Uploaded date/);
  assert.match(workspace, /Not recorded/);
  assert.doesNotMatch(workspace, /Blood report analysis/);
  assert.doesNotMatch(workspace, /Generate clinical heads-up/);
  assert.match(documentApi, /formData\.getAll\("documents"\)/);
  assert.match(documentApi, /MAX_FILE_SIZE = 12 \* 1024 \* 1024/);
  assert.match(documentApi, /could not be verified in secure storage/);
  assert.match(documentApi, /patientDocuments/);
  assert.match(documentApi, /Cache-Control": "private, no-store"/);
  assert.match(futureAiRequirement, /Deferred — do not enable/);
  assert.match(futureAiRequirement, /No OpenAI API key is required/);
  assert.match(archivedPrototype, /ARCHIVED PROTOTYPE/);
  assert.match(archivedPrototype, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(schema, /export const patientDocuments/);
  assert.match(schema, /analysisJson: text\("analysis_json"\)/);
  assert.match(migration, /CREATE TABLE `patient_documents`/);
  assert.match(hosting, /"r2": "DOCUMENTS"/);
});

test("provides a full scheduler command center and guarded appointment actions", async () => {
  const [workspace, operationsApi, patientSearchApi, practiceSettingsApi, visitTemplateSearchApi, schema, visitFlowMigration, clinicalMigration, clinicalOrdersMigration, smartClinicalMigration, visitTemplateMigration, databaseBootstrap] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/patient-search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/practice-settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/visit-note-templates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0015_patient_visit_flow.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0016_structured_clinical_encounters.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0017_clinical_orders_and_code_master.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0019_smart_clinical_composer.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0020_visit_note_template_master.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Today’s patient flow/);
  assert.doesNotMatch(workspace, /scheduler-hero/);
  assert.ok(workspace.indexOf('className="scheduler-toolbar"') < workspace.indexOf('className="scheduler-metric-grid"'));
  assert.match(workspace, /Schedule summary for current filters/);
  assert.match(workspace, /All providers/);
  assert.match(workspace, /Day<\/button>/);
  assert.match(workspace, /Week<\/button>/);
  assert.match(workspace, /Reschedule/);
  assert.match(workspace, /Eligibility/);
  assert.match(workspace, /No show/);
  assert.match(workspace, /Roomed/);
  assert.match(workspace, /Conflict protection/);
  assert.match(workspace, /Patient not found\?/);
  assert.match(workspace, /Type 3 letters, account, phone or DOB/);
  assert.match(workspace, /\/api\/patient-search\?q=/);
  assert.match(workspace, /Searching patient master/);
  assert.match(workspace, /schedulerSlotMinutes/);
  assert.match(workspace, /min intervals/);
  assert.match(workspace, /slotsPerHour/);
  assert.match(workspace, /scheduler-appointment-primary/);
  assert.match(workspace, /accessibleDetails/);
  assert.match(workspace, /Today’s patient flow/);
  assert.match(workspace, /visit-flow-summary/);
  assert.match(workspace, /Start consultation/);
  assert.match(workspace, /End consultation/);
  assert.match(workspace, /Room patient/);
  assert.match(workspace, /Check out/);
  assert.match(workspace, /visit-flow-progress/);
  assert.match(workspace, /Open encounter/);
  assert.match(workspace, /Today’s care flow/);
  assert.match(workspace, /Move each patient from intake to a signed note/);
  assert.match(workspace, /Expected today/);
  assert.match(workspace, /Waiting to be seen/);
  assert.match(workspace, /Next patient/);
  assert.match(workspace, /Check patients in from Scheduler/);
  assert.match(workspace, /Vitals pending/);
  assert.match(workspace, /Start SOAP/);
  assert.match(workspace, /BMI health guide/);
  assert.match(workspace, /Body mass index assessment/);
  assert.match(workspace, /BMI is a screening measure/);
  assert.match(workspace, /weight \* 0\.45359237/);
  assert.match(workspace, /Numeric pain rating reference/);
  assert.match(workspace, /Pain reference/);
  assert.match(workspace, /worst pain imaginable/);
  assert.match(workspace, /Height \(cm\)/);
  assert.match(workspace, /Needs signature/);
  assert.match(workspace, /History of present illness/);
  assert.match(workspace, /Ready to bill/);
  assert.match(workspace, /\["received", "Received"/);
  assert.match(workspace, /\["clean", "Clean"/);
  assert.match(workspace, /ClaimsInquiryWorkspace/);
  assert.match(workspace, /claim_inquiry/);
  assert.match(operationsApi, /rebillClaim/);
  const workspaceNav = await readFile(new URL("../lib/workspace-nav.ts", import.meta.url), "utf8");
  assert.match(workspaceNav, /claim-inquiry/);
  assert.match(workspace, /PlanFollowUpBooking/);
  assert.match(operationsApi, /createFollowUpAppointments/);
  const planFollowUp = await readFile(new URL("../app/PlanFollowUpBooking.tsx", import.meta.url), "utf8");
  assert.match(planFollowUp, /Book follow-up/);
  assert.match(planFollowUp, /Recurring/);
  assert.match(planFollowUp, /createFollowUpAppointments/);
  assert.match(workspace, /billingDiagnosisCodesFromForm|Diagnoses \(ICD-10\) from Assessment/);
  assert.match(workspace, /codesFromAssessmentSubjectiveJson/);
  assert.match(operationsApi, /codesFromAssessmentSubjectiveJson/);
  assert.match(workspace, /Assembled encounter note/);
  assert.match(workspace, /Mark reviewed/);
  assert.match(workspace, /visit-completion-panel/);
  assert.doesNotMatch(workspace, /Common specialty workflows/);
  assert.doesNotMatch(workspace, /Live encounter note/);
  assert.doesNotMatch(workspace, /Open preview/);
  assert.doesNotMatch(workspace, /Sign & ready for billing/);
  assert.doesNotMatch(workspace, /Sign note/);
  assert.match(workspace, /AssessmentWorkspace/);
  assert.match(workspace, /Type code or description/);
  assert.match(workspace, /SOAP visit note/);
  assert.match(workspace, /SOAP note sections/);
  assert.match(workspace, /clinical-focus-workspace/);
  assert.match(workspace, /physician-command-center/);
  assert.match(workspace, /visit-chart-main/);
  assert.match(workspace, /Physician encounter tools/);
  assert.match(workspace, /Orders & referrals/);
  assert.match(workspace, /Results to review/);
  assert.match(workspace, /Full chart/);
  assert.match(workspace, /Close encounter and return/);
  assert.match(workspace, /You can continue documenting/);
  assert.match(workspace, /Subjective/);
  assert.match(workspace, /Objective/);
  assert.match(workspace, /Assessment/);
  assert.match(workspace, /Plan/);
  assert.match(workspace, /visit-order-type-tabs/);
  assert.match(workspace, /Referral specialty/);
  assert.match(workspace, /Clinical orders/);
  assert.match(workspace, /Add performed services/);
  assert.match(workspace, /smart phrases/);
  assert.doesNotMatch(workspace, /This is a completeness check—not an E\/M level recommendation/);
  assert.match(workspace, /Record only work and findings actually performed/);
  assert.match(workspace, /Search templates/);
  assert.match(workspace, /\/api\/visit-note-templates\?q=/);
  assert.doesNotMatch(workspace, /Selecting a result populates the current note/);
  assert.doesNotMatch(workspace, /Type at least 3 characters/);
  assert.match(workspace, /visit-coding-assistant/);
  assert.match(workspace, /Coding suggestions/);
  assert.match(workspace, /Counseling provided/);
  assert.match(workspace, /Quality reporting/);
  assert.match(workspace, /QUALITY_OPTIONS/);
  assert.match(workspace, /Cat II/);
  assert.match(workspace, /HpiNarrativeField/);
  assert.match(workspace, /visit-time-spent/);
  assert.match(workspace, /Visit time spent in minutes/);
  assert.match(workspace, /subjective-visit-toolbar/);
  assert.match(workspace, /From Subjective · Visit & HPI|Enter minutes in Subjective/);
  const hpiAssist = await readFile(new URL("../app/HpiNarrativeField.tsx", import.meta.url), "utf8");
  assert.match(hpiAssist, /Dictate HPI/);
  assert.match(hpiAssist, /hpi-mic-button/);
  assert.match(hpiAssist, /\/api\/hpi-assist/);
  assert.match(hpiAssist, /SpeechRecognition|webkitSpeechRecognition/);
  const hpiApi = await readFile(new URL("../app/api/hpi-assist/route.ts", import.meta.url), "utf8");
  assert.match(hpiApi, /polishHpiLocally/);
  assert.match(hpiApi, /OPENAI_API_KEY/);
  assert.match(workspace, /buildEncounterNoteDraft/);
  assert.match(workspace, /onPatientAllergiesChange/);
  assert.match(workspace, /allergy-alert/);
  assert.match(workspace, /Confirm \d+ selected|Mark what applies/);
  assert.match(workspace, /SOAP updated\. Review coding suggestions/);
  const visitCoding = await readFile(new URL("../lib/visit-coding.ts", import.meta.url), "utf8");
  assert.match(visitCoding, /Urinary incontinence assessed/);
  assert.match(visitCoding, /0518F/);
  assert.match(visitCoding, /1090F/);
  assert.match(visitCoding, /1160F/);
  assert.match(visitCoding, /3074F/);
  const encounterNote = await readFile(new URL("../lib/encounter-note.ts", import.meta.url), "utf8");
  assert.match(encounterNote, /Total time spent on the date of the encounter was/);
  assert.match(encounterNote, /Allergies:/);
  assert.doesNotMatch(workspace, /All note sections and template code suggestions were populated/);
  assert.doesNotMatch(workspace, /<Select label="Find existing patient"/);
  assert.match(workspace, /Save patient & continue booking/);
  assert.match(workspace, /Save & schedule/);
  assert.match(workspace, /appointment-readiness/);
  assert.match(operationsApi, /rescheduleAppointment/);
  assert.match(operationsApi, /already has an appointment during the selected time/);
  assert.match(operationsApi, /allowedStatuses/);
  assert.match(operationsApi, /VISIT_FLOW_TRANSITIONS/);
  assert.match(operationsApi, /updateVisitFlow/);
  assert.match(operationsApi, /Assign a room before rooming the patient/);
  assert.match(operationsApi, /visitFlowEvents/);
  assert.match(operationsApi, /startEncounter/);
  assert.match(operationsApi, /recordVisitIntake/);
  assert.match(operationsApi, /Record at least one vital sign before marking the patient ready/);
  assert.match(operationsApi, /saveEncounter/);
  assert.match(operationsApi, /clinicalOrders/);
  assert.match(operationsApi, /diagnosisCodeMaster/);
  assert.match(operationsApi, /clinicalContentItems/);
  assert.match(operationsApi, /practiceServices/);
  assert.match(operationsApi, /Complete or replace all bracketed template prompts before signing the note/);
  assert.match(visitTemplateSearchApi, /query\.length < 3/);
  assert.match(visitTemplateSearchApi, /\.limit\(50\)/);
  assert.match(visitTemplateSearchApi, /visitNoteTemplates\.keywords/);
  assert.match(operationsApi, /Signing requires the chief complaint, assessment, plan, diagnosis and procedure codes/);
  assert.match(operationsApi, /Possible duplicate patient/);
  assert.match(patientSearchApi, /query\.length < 3/);
  assert.match(patientSearchApi, /\.limit\(12\)/);
  assert.match(patientSearchApi, /patients\.accountNumber/);
  assert.match(practiceSettingsApi, /Administrator access is required/);
  assert.match(practiceSettingsApi, /10, 15, 20, 30, 60/);
  assert.match(schema, /flowStatus: text\("flow_status"/);
  assert.match(schema, /consultationStartedAt/);
  assert.match(schema, /export const visitFlowEvents/);
  assert.match(schema, /export const encounterEvents/);
  assert.match(schema, /historyOfPresentIllness/);
  assert.match(workspace, /Save orders/);
  assert.match(workspace, /Add order to list/);
  assert.match(workspace, /Search laboratory catalog/);
  assert.match(workspace, /Search imaging catalog/);
  assert.match(workspace, /clinicalOrderCatalog/);
  assert.match(operationsApi, /clinicalOrderCatalog/);
  assert.match(schema, /export const clinicalOrders/);
  assert.match(schema, /export const diagnosisCodeMaster/);
  assert.match(schema, /export const clinicalOrderCatalog/);
  assert.match(schema, /export const clinicalContentItems/);
  assert.match(schema, /export const practiceServices/);
  assert.match(schema, /export const visitNoteTemplates/);
  assert.match(visitFlowMigration, /CREATE TABLE `visit_flow_events`/);
  assert.match(clinicalMigration, /CREATE TABLE `encounter_events`/);
  assert.match(clinicalOrdersMigration, /CREATE TABLE `clinical_orders`/);
  assert.match(clinicalOrdersMigration, /CREATE TABLE `diagnosis_code_master`/);
  assert.match(smartClinicalMigration, /CREATE TABLE `clinical_content_items`/);
  assert.match(smartClinicalMigration, /CREATE TABLE `practice_services`/);
  assert.match(visitTemplateMigration, /CREATE TABLE `visit_note_templates`/);
  assert.match(databaseBootstrap, /CLINICAL_ORDER_CATALOG_SEEDS/);
  assert.match(databaseBootstrap, /CBC with differential/);
  assert.match(databaseBootstrap, /MRI lumbar spine without contrast/);
  assert.match(databaseBootstrap, /CREATE TABLE IF NOT EXISTS clinical_order_catalog/);
  assert.match(databaseBootstrap, /\*E Cystitis/);
  assert.match(databaseBootstrap, /Medicare AWV \(Female\)/);
  assert.match(databaseBootstrap, /TELEHEALTH NOTE/);
  assert.match(databaseBootstrap, /WWE women with pelvic exam\/PAP/);
  assert.doesNotMatch(databaseBootstrap, /const demoClinicalPatients/);
  assert.doesNotMatch(databaseBootstrap, /const demoClinicalAppointments/);
  assert.match(databaseBootstrap, /UPDATE patients SET status = 'inactive' WHERE id LIKE 'pat_demo_%'/);
  assert.match(databaseBootstrap, /UPDATE appointments SET status = 'cancelled', flow_status = 'not_arrived' WHERE id LIKE 'apt_demo_%'/);
});

test("tracks clinical results, medication reconciliation and refill decisions locally", async () => {
  const [workspace, operationsApi, schema, migration, databaseBootstrap] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0018_results_medications_refills.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Clinical results/);
  assert.match(workspace, /Mark reviewed/);
  assert.match(workspace, /Active medications and refills/);
  assert.match(workspace, /Request refill/);
  assert.match(workspace, /Refill review queue/);
  assert.match(workspace, /No external prescription was transmitted/);
  assert.match(workspace, /laboratory_results/);
  assert.match(workspace, /e_prescribing/);
  assert.match(operationsApi, /saveOrderResult/);
  assert.match(operationsApi, /reviewOrderResult/);
  assert.match(operationsApi, /createPatientMedication/);
  assert.match(operationsApi, /requestRefill/);
  assert.match(operationsApi, /decideRefill/);
  assert.match(schema, /export const clinicalOrderResults/);
  assert.match(schema, /export const patientMedications/);
  assert.match(schema, /export const refillRequests/);
  assert.match(migration, /CREATE TABLE `clinical_order_results`/);
  assert.match(migration, /CREATE TABLE `patient_medications`/);
  assert.match(migration, /CREATE TABLE `refill_requests`/);
  assert.match(databaseBootstrap, /Local medication workflow/);
  assert.match(databaseBootstrap, /needs_credentials/);
});

test("persists comprehensive subjective history and allergy reconciliation", async () => {
  const [workspace, operationsApi, schema, migration, databaseBootstrap] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0023_patient_allergy_master.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Safety review/);
  assert.match(workspace, /Self-treatment effectiveness/);
  assert.match(workspace, /Previous similar episodes/);
  assert.match(workspace, /Psychiatric history/);
  assert.match(workspace, /Social history/);
  assert.match(workspace, /HistorySmartPicker/);
  assert.match(workspace, /Tobacco use/);
  assert.match(workspace, /Alcohol use/);
  assert.match(workspace, /Recreational drug use/);
  assert.match(workspace, /Living situation/);
  assert.match(workspace, /Physical activity/);
  assert.match(workspace, /historySelections/);
  assert.match(operationsApi, /psychiatric_history/);
  assert.match(databaseBootstrap, /investigation_history/);
  assert.match(databaseBootstrap, /treatment_history/);
  assert.match(workspace, /Mark NKDA/);
  assert.match(workspace, /Allergies reconciled for this encounter/);
  assert.match(workspace, /buildEncounterNoteDraft/);
  const encounterNoteLib = await readFile(new URL("../lib/encounter-note.ts", import.meta.url), "utf8");
  assert.match(encounterNoteLib, /SAFETY REVIEW/);
  assert.match(operationsApi, /createPatientAllergy/);
  assert.match(operationsApi, /reviewPatientAllergies/);
  assert.match(operationsApi, /entered_in_error/);
  assert.match(schema, /export const patientAllergies/);
  assert.match(migration, /CREATE TABLE `patient_allergies`/);
  assert.match(databaseBootstrap, /CREATE TABLE IF NOT EXISTS patient_allergies/);
});

test("provides a connected longitudinal patient chart workspace", async () => {
  const [chart, chartPage, operationsWorkspace, styles] = await Promise.all([
    readFile(new URL("../app/PatientChartWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/chart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(chartPage, /PatientChartWorkspace/);
  assert.match(chartPage, /SESSION_COOKIE/);
  assert.match(chart, /Patient chart/);
  assert.match(chart, /Chart home/);
  assert.match(chart, /What needs attention/);
  assert.match(chart, /Patient timeline/);
  assert.match(chart, /Allergies & safety/);
  assert.match(chart, /Problem list/);
  assert.match(chart, /Visit readiness/);
  assert.match(chart, /Search this patient chart/);
  assert.match(chart, /reviewOrderResult/);
  assert.match(chart, /decideRefill/);
  assert.match(chart, /no prescription transmitted/);
  assert.match(chart, /returnTo=/);
  assert.match(chart, /clinicalEditorHref/);
  assert.match(operationsWorkspace, /\/chart\?patientId=/);
  assert.match(operationsWorkspace, />Open chart</);
  assert.match(operationsWorkspace, /clinicalReturnTo/);
  assert.match(operationsWorkspace, /function closeModal\(\)/);
  assert.match(operationsWorkspace, /window\.location\.assign\(clinicalReturnTo\)/);
  assert.match(styles, /Compact, device-consistent patient EMR/);
  assert.match(styles, /font-family: var\(--font-geist-sans\), Arial, sans-serif/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /position: fixed/);
  assert.match(styles, /padding-bottom: 67px/);
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
  assert.match(workspace, /Appointment time interval/);
  assert.match(workspace, /Save scheduler setting/);
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

test("supports multi-complaint subjective notes, personal templates and NPI provider lookup", async () => {
  const [workspace, operationsApi, npiApi, providerApi, schema, migration, databaseBootstrap] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/npi-registry/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/referring-providers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0021_subjective_library_and_npi.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Search or type a new complaint/);
  assert.match(workspace, /Add HPI wording to selected complaint/);
  assert.match(workspace, /Save as my template/);
  assert.match(workspace, /personal draft\. It is not published practice-wide/);
  assert.match(workspace, /Search the official NPI Registry/);
  assert.match(workspace, /does not verify licensure or credentialing/);
  assert.match(workspace, /Patient’s words/);
  assert.match(workspace, /structuredSubjective/);
  assert.match(workspace, /update\("subjectiveItemsJson", JSON\.stringify\(structuredSubjective\)\)/);
  assert.match(workspace, /Guided HPI & progress/);
  assert.match(workspace, /Functional impact/);
  assert.match(workspace, /Patient’s main concern/);
  assert.match(workspace, /Patient’s goal for today/);
  assert.match(workspace, /Review possible inconsistency/);
  assert.match(workspace, /Clinician observations \(measurable\)/);
  assert.match(workspace, /Raw chart narrative was not copied/);
  assert.match(workspace, /An administrator must approve practice-wide publication/);
  assert.match(workspace, /does not determine an E\/M level/);
  assert.match(workspace, /Patient medical history/);
  assert.match(workspace, /Family history/);
  assert.match(workspace, /Review of systems/);
  assert.match(workspace, /Mark each reviewed system normal/);
  assert.match(workspace, /Add ROS symptom/);
  assert.match(workspace, /Comment \/ clinical context/);
  assert.match(workspace, /ClinicalEncounterHeaderContext/);
  assert.match(workspace, /clinical-encounter-header-context/);
  assert.match(workspace, /Person \/ source/);
  assert.match(workspace, /Subjective documentation sections/);
  assert.match(workspace, /Visit & HPI/);
  assert.match(workspace, /DOCUMENTATION_FLOW_STEPS/);
  assert.match(workspace, /VisitStoryStrip/);
  assert.match(workspace, /visit-story-strip/);
  assert.match(workspace, /visit-workspace-scroll/);
  assert.match(workspace, /Pinned visit story/);
  assert.match(workspace, /ObjectiveWorkspace/);
  assert.match(workspace, /AssessmentWorkspace/);
  assert.match(workspace, /ObjectiveVisitDocuments/);
  assert.match(workspace, /read & write/);
  assert.match(workspace, /Head-to-toe/);
  assert.match(workspace, /objective-exam-systems/);
  assert.match(workspace, /Verify for today’s DOS/);
  assert.match(workspace, /DictateMicField/);
  assert.match(workspace, /Diagnostic & lab data/);
  assert.match(workspace, /buildPhysicalExamText/);
  assert.match(workspace, /buildAssessmentText|assessmentSummary|Working diagnoses/);
  const assessmentUi = await readFile(new URL("../app/AssessmentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(assessmentUi, /Differential diagnoses/);
  assert.match(assessmentUi, /Plan rationale/);
  assert.match(assessmentUi, /ICD-10-CM diagnoses/);
  assert.match(assessmentUi, /DiagnosisCodeSearch|Search ICD-10|AddDiagnosisComposer|Add diagnosis/);
  assert.match(assessmentUi, /add one at a time|ICD codes|None yet/);
  assert.match(assessmentUi, /assessment-problem-stack|Add working diagnosis/);
  assert.match(assessmentUi, /Labs & reports \(AI\)|Insert into plan rationale/);
  assert.match(assessmentUi, /collectVisitAiDiagnosticSummaries|patientDocuments/);
  const diagnosisSeeds = await readFile(new URL("../lib/diagnosis-code-seeds.ts", import.meta.url), "utf8");
  assert.match(diagnosisSeeds, /DIAGNOSIS_CODE_SEEDS/);
  assert.match(diagnosisSeeds, /J45\.909/);
  assert.match(diagnosisSeeds, /N39\.0/);
  const assessmentLib = await readFile(new URL("../lib/assessment-note.ts", import.meta.url), "utf8");
  assert.match(assessmentLib, /findAssessmentQualityIssues/);
  assert.match(assessmentLib, /Differential considerations/);
  const objectiveDocs = await readFile(new URL("../app/ObjectiveVisitDocuments.tsx", import.meta.url), "utf8");
  assert.match(objectiveDocs, /Same-day documents/);
  assert.match(objectiveDocs, /AI heads-up/);
  assert.match(objectiveDocs, /Get AI heads-up/);
  assert.match(objectiveDocs, /document-interpret/);
  assert.match(objectiveDocs, /View document/);
  const interpretApi = await readFile(new URL("../app/api/document-interpret/route.ts", import.meta.url), "utf8");
  assert.match(interpretApi, /buildDocumentInterpretInstructions/);
  assert.match(interpretApi, /provider HEADS-UP|heads-up/i);
  assert.match(workspace, /onAutosaveDraft/);
  assert.match(workspace, /autosaveEncounterDraft/);
  assert.match(workspace, /Draft saved/);
  assert.match(workspace, /Saving draft/);
  assert.match(workspace, /Next: \$\{next\.label\}/);
  assert.match(workspace, /onVisitStepChange/);
  assert.match(workspace, /openSoapSection/);
  assert.match(workspace, /EncounterNotePreview/);
  assert.doesNotMatch(workspace, /function VisitFlowDock/);
  assert.match(workspace, /Live structured draft/);
  assert.match(workspace, /Automatically generated encounter note preview/);
  assert.match(workspace, /Check-in time is missing/);
  assert.match(workspace, /does not invent findings or determine coding/);
  assert.match(operationsApi, /saveClinicalOption/);
  assert.match(operationsApi, /saveSubjectiveLibraryItem/);
  assert.match(operationsApi, /subjectiveItemsJson/);
  assert.match(npiApi, /npiregistry\.cms\.hhs\.gov\/api/);
  assert.match(npiApi, /version: "2\.1"/);
  assert.match(providerApi, /provider:/);
  assert.match(schema, /export const subjectiveLibraryItems/);
  assert.match(schema, /export const clinicalOptionMaster/);
  assert.match(schema, /subjectiveItemsJson/);
  assert.match(migration, /CREATE TABLE `subjective_library_items`/);
  assert.match(migration, /ADD `subjective_items_json`/);
  assert.match(databaseBootstrap, /Hypertension follow-up/);
  assert.match(databaseBootstrap, /Medication follow-up/);
});

test("Collection Arena opens the CMS-1500 follow-up editor with billed coverage slots", async () => {
  const [workspace, arena, operationsApi] = await Promise.all([
    readFile(new URL("../app/OperationsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CollectionArenaWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(arena, /onOpenClaim/);
  assert.match(arena, /collection-arena-claim/);
  assert.match(workspace, /mode="followup"/);
  assert.match(workspace, /Billed coverage for this DOS/);
  assert.match(workspace, /Add insurance/);
  assert.match(workspace, /followUpSave/);
  assert.match(operationsApi, /followUpSave/);
  assert.match(operationsApi, /Follow-up Corrected/);
  assert.match(operationsApi, /secondaryCoverageId/);
});
