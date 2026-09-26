"use client";

import Link from "next/link";
import { adjustmentDescription } from "../lib/era-835";

function AdjustmentExplanation({ row }: { row: Record<string, unknown> }) {
  let adjustments: Array<{ group: string; code: string; amount: string }> = [];
  try { adjustments = JSON.parse(String(row.adjustmentDetails || "{}")).adjustments || []; } catch { /* Legacy entries have no source breakdown. */ }
  const codes = String(row.denialCode || "").split(",").filter(Boolean);
  if (!adjustments.length && !codes.length) return null;
  return <details className="payment-code-explanation"><summary>Code details</summary><div>{adjustments.length ? <>{adjustments.map((item, index) => <p key={index}>{item.group}-{item.code}: {adjustmentDescription(`${item.group}-${item.code}`)} · {currency(item.amount)}</p>)}<small>Original ERA breakdown</small></> : codes.map((code) => <p key={code}>{adjustmentDescription(code)}</p>)}</div></details>;
}
import { Fragment, FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalUser } from "../lib/auth";
import { claimFieldHints } from "../lib/cms1500";
import { credentialFieldsFor } from "../lib/integration-credential-fields";
import { ClaimFieldHint } from "./ClaimFieldHint";
import { AssessmentWorkspace } from "./AssessmentWorkspace";
import { DictateMicField } from "./DictateMicField";
import { HpiNarrativeField } from "./HpiNarrativeField";
import { ObjectiveVisitDocuments } from "./ObjectiveVisitDocuments";
import { PlanFollowUpBooking } from "./PlanFollowUpBooking";
import { CHART_SECTIONS } from "../lib/patient-chart";
import {
  applyModifierToProcedures,
  assessmentCodingSignalsFromNote,
  buildVisitCodingSuggestions,
  COUNSELING_OPTIONS,
  QUALITY_OPTIONS,
  parseCodingAssistState,
  type CodingAssistState,
  type CodingSuggestion,
} from "../lib/visit-coding";
import { buildEncounterNoteDraft, encounterNoteGaps } from "../lib/encounter-note";
import { codesFromAssessmentSubjectiveJson } from "../lib/assessment-note";
import {
  CLAIM_WORKFLOW_LABELS,
  claimQueueBucket,
  deliveryChannelFromPayer,
  deriveWorkflowStatus,
  isEhrSourcedClaim,
  scrubFindingLabel,
  storedBillFrequencyCode,
  type ClaimDeliveryChannel,
  type ClaimQueueBucket,
  type ClaimWorkflowStatus,
} from "../lib/claim-workflow";
import { CLAIM_LIFECYCLE_LABELS, arenaFollowUpActions, deriveClaimLifecycle, type ClaimLifecycleStatus } from "../lib/claim-lifecycle";
import { FOLLOW_UP_LABELS, claimAgeDays, payerResponseDays } from "../lib/collection-arena";
import { billedCoverageFields, coverageCoversDos, coverageEpisodeLabel, defaultBilledCoverages, unpaidReason } from "../lib/claim-coverage";
import {
  PAYMENT_ENTRY_STATUS_LABELS,
  PAYMENT_METHOD_OPTIONS,
  CARD_BRANDS,
  CARD_METHODS,
  buildReconciliationSnapshot,
  calculatePaymentTotalEffective,
  eraMappingError,
  moneyNumber,
  type PaymentEntryStatus,
} from "../lib/payment-posting";
import { parseEra835 } from "../lib/era-835";
import {
  buildPhysicalExamText,
  computeBmiFromMetric,
  EXAM_SYSTEMS,
  examSystemLabel,
  findSubjectiveObjectiveIssues,
  isObjectiveVerifiedForDos,
  OBJECTIVE_PHRASE_BANK,
  polishObjectiveLocally,
} from "../lib/objective-exam";
import { PracxIntegrationDashboard } from "./PracxIntegrationDashboard";
import { ClaimsInquiryWorkspace } from "./ClaimsInquiryWorkspace";
import { PatientBillingHistory } from "./PatientBillingHistory";
import { RPM_CODE_MASTER, RPM_MEDICARE_REFERENCE } from "../lib/rpm-code-master";
import { CollectionArenaWorkspace } from "./CollectionArenaWorkspace";
import {
  type WorkspaceVariant,
  isBillingStyleWorkspace,
  workspaceBrand,
  workspaceConfigLinks,
  workspaceNavItems,
  workspaceBasePath,
  setupTabHref,
} from "../lib/workspace-nav";

export type OperationsModule =
  | "dashboard"
  | "patients"
  | "scheduler"
  | "eligibility"
  | "clinical"
  | "claim_inquiry"
  | "collections"
  | "claims"
  | "payments"
  | "reports"
  | "payers"
  | "fees"
  | "procedures"
  | "integrations";

type DataRow = Record<string, unknown>;
type WorkspaceData = {
  patients: DataRow[];
  coverages: DataRow[];
  payers: DataRow[];
  plans: DataRow[];
  providers: DataRow[];
  facilities: DataRow[];
  referringProviders: DataRow[];
  appointments: DataRow[];
  eligibility: DataRow[];
  encounters: DataRow[];
  procedureCodes: DataRow[];
  feeSchedules: DataRow[];
  feeScheduleItems: DataRow[];
  claims: DataRow[];
  claimLines: DataRow[];
  claimCorrections: DataRow[];
  claimWorkflowEvents: DataRow[];
  claimBatches: DataRow[];
  claimBatchMembers: DataRow[];
  claimTransmissionLogs: DataRow[];
  paymentEntries: DataRow[];
  claimPayments: DataRow[];
  claimPaymentServiceLines?: DataRow[];
  paymentLogs: DataRow[];
  remittances: DataRow[];
  payments: DataRow[];
  reconciliationLogs: DataRow[];
  transactions: DataRow[];
  reconsiderations: DataRow[];
  integrations: DataRow[];
  inboundEvents: DataRow[];
  syncEvents?: DataRow[];
  responsibilityProfiles: DataRow[];
  responsibilitySources: DataRow[];
  responsibilityHistory: DataRow[];
  claimResponsibilitySnapshots: DataRow[];
  claimConfigurationValues: DataRow[];
  eligibilityUpdateHistory: DataRow[];
  legalResponsibilities: DataRow[];
  patientDocuments: DataRow[];
  practiceSettings: DataRow;
  visitFlowEvents: DataRow[];
  encounterEvents: DataRow[];
  clinicalOrders: DataRow[];
  diagnosisCodes: DataRow[];
  clinicalOrderCatalog: DataRow[];
  clinicalOrderResults: DataRow[];
  patientMedications: DataRow[];
  patientAllergies: DataRow[];
  refillRequests: DataRow[];
  clinicalContentItems: DataRow[];
  clinicalOptions: DataRow[];
  subjectiveLibraryItems: DataRow[];
  practiceServices: DataRow[];
  error?: string;
};

const moduleMeta: Record<OperationsModule, { title: string; eyebrow: string; description: string; action: string }> = {
  dashboard: { title: "Dashboard", eyebrow: "Elation ↔ PRACX ↔ Stedi", description: "Two-way claim lifecycle: Elation pull, Stedi EDI submit/ack/ERA, and status push back to Elation.", action: "Refresh intake" },
  patients: { title: "Patients", eyebrow: "Patient administration", description: "Demographics, coverage, legal responsibility and claim-ready registration.", action: "Add patient" },
  scheduler: { title: "Scheduler", eyebrow: "Care delivery", description: "Provider schedules, appointment flow and pre-visit readiness.", action: "New appointment" },
  eligibility: { title: "Eligibility", eyebrow: "270 / 271 verification", description: "Automated and on-demand coverage verification before service.", action: "Run verification" },
  clinical: { title: "Clinical & EMR", eyebrow: "Encounter documentation", description: "Signed notes, diagnoses, procedures and billing readiness.", action: "New encounter" },
  claim_inquiry: { title: "Claims", eyebrow: "Patient claim inquiry", description: "Search a patient, open a PRACX claim number, and follow Bill → Sent → Paid/Denied through Pri, Sec, Ter and Patient until the claim is closed.", action: "Open work queue" },
  collections: { title: "Collection Arena", eyebrow: "Outstanding A/R follow-up", description: "Submitted claims that still have a balance after the payer’s response days. Unsigned notes and missing records stay in the Bridge. Follow up here, then rebill to Pri or bill Sec after corrections.", action: "Open Claims" },
  claims: { title: "Claim preparation", eyebrow: "From EMR to billable claim", description: "Received claims scrub into Clean or Errors. Fix errors, then batch Clean claims for EDI or paper.", action: "Queue from EHR" },
  payments: { title: "Payment posting", eyebrow: "Checks, EFT, ERA & paper EOB", description: "Create payment entries, allocate across claims, auto-post when totals match. Submitted shows payment-level history only.", action: "New payment entry" },
  reports: { title: "Transaction report", eyebrow: "Reporting center", description: "A complete ledger powering financial and operational reporting.", action: "Export CSV" },
  payers: { title: "Payers & plans", eyebrow: "Practice setup", description: "Payer routing, plan rules and filing requirements.", action: "Add payer" },
  fees: { title: "Fee schedules", eyebrow: "Practice setup", description: "Contracted allowed amounts by payer, code and effective date.", action: "Add schedule" },
  procedures: { title: "Procedure codes", eyebrow: "Practice setup", description: "CPT/HCPCS charge master and authorization rules.", action: "Add procedure" },
  integrations: { title: "Integrations", eyebrow: "Connectivity", description: "Elation EHR and Stedi EDI connectors, plus eligibility / ERA / delivery adapters.", action: "Configure" },
};

const VISIT_FLOW_STEPS = ["not_arrived", "arrived", "checked_in", "waiting", "roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"] as const;
const VISIT_FLOW_LABELS: Record<string, string> = {
  not_arrived: "Not arrived",
  arrived: "Arrived",
  checked_in: "Checked in",
  waiting: "Waiting room",
  roomed: "Roomed",
  ready_for_provider: "Ready for provider",
  consultation_started: "With provider",
  consultation_ended: "Consultation ended",
  checked_out: "Checked out",
};
const VISIT_ROOM_OPTIONS = ["Room 1", "Room 2", "Room 3", "Procedure room", "Telehealth"];

function value(row: DataRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function list(valueToParse: unknown) {
  try {
    return Array.isArray(valueToParse) ? valueToParse.map(String) : JSON.parse(String(valueToParse || "[]")) as string[];
  } catch {
    return [];
  }
}

function isActionableClaimIssue(issue: DataRow) {
  return !(value(issue, "field") === "Coding review" && value(issue, "message").startsWith("AI interpretation:"));
}

function currency(input: unknown) {
  const amount = Number(input || 0);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(input: unknown, includeTime = false) {
  if (!input) return "—";
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function splitPostalCode(input: unknown) {
  const match = String(input || "").match(/^(\d{5})(?:-(\d{4}))?$/);
  return { zip5: match?.[1] || String(input || "").slice(0, 5), zipPlus4: match?.[2] || "" };
}

function formatPhone(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toLocalDateTimeValue(input: unknown) {
  const date = new Date(String(input || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function blankForm(module: OperationsModule): Record<string, string | boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (module === "patients") return { sex: "unknown", coverageType: "health", relationship: "self", priority: "primary", subscriberSameAsPatient: true, acceptAssignment: true, releaseOfInformation: true, assignmentOfBenefits: true, verifyEligibility: true, balanceRole: "final_balance", settlementStatus: "open", lienStatus: "not_recorded" };
  if (module === "scheduler") return { duration: "30", appointmentType: "Office visit", billingContext: "routine", startAt: `${today}T09:00` };
  if (module === "eligibility") return { dateOfService: today };
  if (module === "clinical") return { dateOfService: today, billingContext: "routine", subjectiveItemsJson: "[]", allergiesReviewed: false, medicationsReviewed: false, intent: "draft" };
  if (module === "claims") return {
    icdIndicator: "0",
    referringProviderQualifier: "DN",
    insuranceTypeCode: "other",
    employmentRelated: "N",
    autoAccidentRelated: "N",
    otherAccidentRelated: "N",
    otherPlanIndicator: "N",
    outsideLabIndicator: "N",
    patientSignatureOnFile: "Y",
    insuredSignatureOnFile: "Y",
    providerSignatureOnFile: "Y",
    lineUnits: "1",
    lineDiagnosisPointers: "A",
    familyPlanningIndicator: false,
  };
  if (module === "payments") return { paymentMethod: "Check", paymentDate: today, postingDate: today, paymentAmount: "0.00", offsetAmount: "0.00", refundAmount: "0.00", incentiveAmount: "0.00", otherAdjustments: "0.00", referenceNumber: "", notes: "" };
  if (module === "payers") return { payerType: "Commercial", claimFilingIndicator: "CI", responseDays: "12" };
  if (module === "fees") return { effectiveDate: today, allowedAmount: "0.00" };
  if (module === "procedures") return { codeSet: "CPT", defaultCharge: "0.00", defaultPlaceOfService: "11" };
  if (module === "integrations") return { integrationType: "ehr_elation", mode: "test", vendorName: "Elation" };
  return {};
}

function encounterFormValue(encounter: DataRow, appointment?: DataRow, orders: DataRow[] = []): Record<string, string | boolean> {
  let vitals: Record<string, unknown> = {};
  try { vitals = JSON.parse(value(encounter, "vitals") || "{}"); } catch { vitals = {}; }
  const vital = (key: string) => String(vitals[key] || "");
  const legacyComplaint = value(encounter, "chiefComplaint") || value(appointment || {}, "reason");
  const legacyHpi = value(encounter, "historyOfPresentIllness");
  const storedSubjective = value(encounter, "subjectiveItemsJson");
  const subjectiveItemsJson = storedSubjective && storedSubjective !== "[]" ? storedSubjective : (legacyComplaint || legacyHpi ? JSON.stringify([{ id: "legacy-subjective", complaint: legacyComplaint, hpi: legacyHpi }]) : "[]");
  return {
    id: value(encounter, "id"),
    appointmentId: value(encounter, "appointmentId") || value(appointment || {}, "id"),
    patientId: value(encounter, "patientId") || value(appointment || {}, "patientId"),
    providerId: value(encounter, "providerId") || value(appointment || {}, "providerId"),
    facilityId: value(encounter, "facilityId") || value(appointment || {}, "facilityId"),
    referringProviderId: value(encounter, "referringProviderId"),
    dateOfService: value(encounter, "dateOfService") || value(appointment || {}, "startAt").slice(0, 10),
    billingContext: value(encounter, "billingContext") || value(appointment || {}, "billingContext") || "routine",
    templateKey: value(encounter, "templateKey") || "general_soap",
    patientName: value(encounter, "patientName") || value(appointment || {}, "patientName"),
    providerName: value(encounter, "providerName") || value(appointment || {}, "providerName"),
    checkedInAt: value(appointment || {}, "checkedInAt"),
    roomName: value(appointment || {}, "roomName"),
    status: value(encounter, "status") || "draft",
    subjectiveItemsJson,
    chiefComplaint: legacyComplaint,
    historyOfPresentIllness: value(encounter, "historyOfPresentIllness"),
    reviewOfSystems: value(encounter, "reviewOfSystems"),
    physicalExam: value(encounter, "physicalExam"),
    assessment: value(encounter, "assessment"),
    treatmentPlan: value(encounter, "treatmentPlan"),
    followUpInstructions: value(encounter, "followUpInstructions"),
    clinicalNote: value(encounter, "clinicalNote"),
    codingAssistJson: value(encounter, "codingAssistJson") || "{}",
    diagnosisCodes: list(encounter.diagnosisCodes).join(", "),
    procedureCodes: list(encounter.procedureCodes).join(", "),
    allergiesReviewed: value(encounter, "allergiesReviewed") === "yes",
    medicationsReviewed: value(encounter, "medicationsReviewed") === "yes",
    height: vital("height"), weight: vital("weight"), temperature: vital("temperature"), pulse: vital("pulse"),
    respirations: vital("respirations"), systolic: vital("systolic"), diastolic: vital("diastolic"),
    oxygenSaturation: vital("oxygenSaturation"), painScore: vital("painScore"), intent: "draft",
    ordersJson: JSON.stringify(orders.map((order) => ({ id: value(order, "id"), orderType: value(order, "orderType"), code: value(order, "code"), name: value(order, "name"), instructions: value(order, "instructions"), priority: value(order, "priority") || "routine", status: value(order, "status") || "draft" }))),
  };
}

export function OperationsWorkspace({
  currentUser,
  module,
  variant = "operations",
}: {
  currentUser: LocalUser;
  module: OperationsModule;
  variant?: WorkspaceVariant;
}) {
  const meta = moduleMeta[module];
  const navItems = workspaceNavItems(variant);
  const brand = workspaceBrand(variant);
  const configLinks = workspaceConfigLinks(variant, currentUser.role.toLowerCase() === "administrator");
  const isBilling = isBillingStyleWorkspace(variant);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [search, setSearch] = useState("");
  const [isModalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState("");
  const [form, setForm] = useState<Record<string, string | boolean>>(blankForm(module));
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [claimIssues, setClaimIssues] = useState<Record<string, DataRow[]>>({});
  const [arenaEditorClaimId, setArenaEditorClaimId] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [eligibilityReview, setEligibilityReview] = useState<DataRow | null>(null);
  const [schedulerDate, setSchedulerDate] = useState(new Date().toISOString().slice(0, 10));
  const [appointmentDraft, setAppointmentDraft] = useState<Record<string, string | boolean> | null>(null);
  const [documentReturnDraft, setDocumentReturnDraft] = useState<Record<string, string | boolean> | null>(null);
  const [patientInitialTab, setPatientInitialTab] = useState<"demographics" | "contact" | "insurance" | "subscriber" | "documents">("demographics");
  const [clinicalQueryHandled, setClinicalQueryHandled] = useState(false);
  const [clinicalReturnTo, setClinicalReturnTo] = useState("");
  const [documentationNav, setDocumentationNav] = useState<{ label: string; onNext: () => void } | null>(null);
  const [completionNav, setCompletionNav] = useState<{
    reviewed: boolean;
    signed: boolean;
    readyToBill: boolean;
    markReviewed: () => void;
  } | null>(null);
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const formRef = useRef(form);
  formRef.current = form;
  const formModeRef = useRef(formMode);
  formModeRef.current = formMode;
  const autosaveInFlight = useRef<Promise<boolean> | null>(null);

  const loadData = useCallback(async () => {
    const response = await fetch("/api/operations");
    const body = (await response.json()) as WorkspaceData;
    if (!response.ok) throw new Error(body.error || "Unable to load workspace.");
    setData(body);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadData().catch((reason: Error) => setError(reason.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (module !== "scheduler" || !data) return;
    const query = new URLSearchParams(window.location.search);
    const patientId = query.get("patientId");
    if (!patientId || !data.patients.some((patient) => value(patient, "id") === patientId)) return;
    const startAt = query.get("startAt") || `${schedulerDate}T09:00`;
    window.history.replaceState({}, "", window.location.pathname);
    const timer = window.setTimeout(() => {
      setFormMode("");
      setForm({ ...blankForm("scheduler"), patientId, startAt });
      setError("");
      setNotice("Patient saved. Choose the visit details to finish booking.");
      setModalOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, module, schedulerDate]);

  useEffect(() => {
    if (module !== "patients" || !data) return;
    const patientId = new URLSearchParams(window.location.search).get("patientId");
    if (!patientId || !data.patients.some((patient) => value(patient, "id") === patientId)) return;
    setSelectedPatientId(patientId);
    window.history.replaceState({}, "", window.location.pathname);
  }, [data, module]);

  function updateField(name: string, next: string | boolean) {
    setForm((current) => ({ ...current, [name]: next }));
  }

  function continueWithNextCoverage(savedPatientId: string, savedForm: Record<string, string | boolean>) {
    const assigned = new Set(
      (data?.coverages || [])
        .filter((coverage) => value(coverage, "patientId") === savedPatientId && value(coverage, "status") === "active")
        .map((coverage) => value(coverage, "priority")),
    );
    if (!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(savedForm.coverageType || ""))) {
      assigned.add(String(savedForm.priority || "unassigned"));
    }
    const nextOrder = ["primary", "secondary", "tertiary"].find((order) => !assigned.has(order)) || "unassigned";
    const firstName = String(savedForm.patientFirstName || savedForm.firstName || "");
    const lastName = String(savedForm.patientLastName || savedForm.lastName || "");
    const dateOfBirth = String(savedForm.patientDateOfBirth || savedForm.dateOfBirth || "");
    const sex = String(savedForm.patientSex || savedForm.sex || "unknown");
    setFormMode("coverage");
    setForm({
      patientId: savedPatientId,
      patientName: String(savedForm.patientName || `${firstName} ${lastName}`).trim(),
      patientFirstName: firstName,
      patientLastName: lastName,
      patientDateOfBirth: dateOfBirth,
      patientSex: sex,
      planId: "",
      memberId: "",
      groupNumber: "",
      coverageType: "health",
      priority: nextOrder,
      balanceRole: "final_balance",
      relationship: "self",
      subscriberFirstName: firstName,
      subscriberLastName: lastName,
      subscriberDateOfBirth: dateOfBirth,
      subscriberSex: sex,
      subscriberSameAsPatient: true,
      effectiveDate: "",
      terminationDate: "",
      verifyEligibility: true,
    });
    setNotice(`Coverage or responsibility saved. Add the ${nextOrder === "unassigned" ? "next" : nextOrder} source.`);
    setError("");
    setModalOpen(true);
  }

  function openForm(mode = "") {
    setFormMode(mode);
    setForm(blankForm(module));
    if (module === "patients") setPatientInitialTab("demographics");
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function openIntegration(row: DataRow) {
    const credentials = (row.credentials || []) as DataRow[];
    const prefilled: Record<string, string> = {};
    for (const field of credentials) {
      // Secrets are never sent to the browser, so only non-secret values prefill.
      if (field.secret !== true) prefilled[`cred_${value(field, "key")}`] = value(field, "value");
    }
    setFormMode("edit");
    setForm({
      id: value(row, "id"),
      integrationType: value(row, "integrationType"),
      vendorName: value(row, "vendorName"),
      sourceSystem: value(row, "sourceSystem"),
      mode: value(row, "mode") || "file",
      endpoint: value(row, "endpoint"),
      ...prefilled,
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function testIntegrationConnection(id: string) {
    const result = await action("testIntegrationConnection", { id });
    if (!result) return;
    const status = String(result.status || "");
    setNotice(
      status === "passed"
        ? `Connection test passed. ${String(result.message || "")}`
        : status === "unsupported"
          ? String(result.message || "No automated test for this adapter.")
          : `Connection test failed. ${String(result.message || "")}`,
    );
    await loadData();
  }

  function openNewEncounter() {
    setFormMode("encounter-pick");
    setForm(blankForm("clinical"));
    setDocumentationNav(null);
    setCompletionNav(null);
    setClinicalReturnTo("");
    setError("");
    setNotice("");
    setAutosaveState("idle");
    setModalOpen(true);
  }

  async function startEncounterForPatient(patientId: string) {
    if (!data) return;
    const patient = data.patients.find((row) => value(row, "id") === patientId);
    if (!patient) {
      setError("Patient not found.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const todaysAppointment = data.appointments.find((row) =>
      value(row, "patientId") === patientId
      && value(row, "startAt").slice(0, 10) === today
      && !["cancelled", "no_show"].includes(value(row, "status")),
    );
    if (todaysAppointment) {
      await openSoapVisit(todaysAppointment);
      return;
    }
    const existingDraft = data.encounters.find((row) =>
      value(row, "patientId") === patientId
      && value(row, "status") === "draft"
      && value(row, "dateOfService") === today,
    );
    if (existingDraft) {
      openClinicalEncounter(existingDraft);
      setNotice("Opened today’s draft visit for this patient.");
      return;
    }
    const providerId = value(data.providers[0] || {}, "id");
    const facilityId = value(data.facilities[0] || {}, "id");
    if (!providerId || !facilityId) {
      setError("Add a provider and facility in Practice setup before starting a visit.");
      return;
    }
    const result = await action("createDraftEncounter", {
      patientId,
      providerId,
      facilityId,
      dateOfService: today,
      billingContext: "routine",
    });
    if (!result) return;
    const created = (result.encounter || {}) as DataRow;
    openClinicalEncounter({
      ...created,
      patientName: `${value(patient, "firstName")} ${value(patient, "lastName")}`.trim(),
      providerName: value(created, "providerName") || `${value(data.providers[0], "firstName")} ${value(data.providers[0], "lastName")}`.trim(),
    });
    setNotice("Visit opened. Continue documenting — drafts autosave.");
  }

  function openAppointment(startAt = `${schedulerDate}T09:00`, patientId = "") {
    setFormMode("");
    setForm({ ...blankForm("scheduler"), startAt, patientId });
    setAppointmentDraft(null);
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function addPatientFromAppointment() {
    setAppointmentDraft({ ...form });
    setFormMode("quick-patient");
    setForm({ ...blankForm("patients"), verifyEligibility: false });
    setError("");
    setNotice("");
  }

  function rescheduleAppointment(appointment: DataRow) {
    const start = new Date(value(appointment, "startAt"));
    const end = new Date(value(appointment, "endAt"));
    const duration = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000));
    setFormMode("reschedule");
    setForm({
      id: value(appointment, "id"),
      patientId: value(appointment, "patientId"),
      patientName: value(appointment, "patientName"),
      providerId: value(appointment, "providerId"),
      facilityId: value(appointment, "facilityId"),
      startAt: toLocalDateTimeValue(value(appointment, "startAt")),
      duration: String(duration),
      appointmentType: value(appointment, "appointmentType"),
      billingContext: value(appointment, "billingContext") || "routine",
      reason: value(appointment, "reason"),
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function openDocuments(patientId: string, coverageId = "", returnTab?: "insurance" | "documents") {
    const patient = data?.patients.find((item) => value(item, "id") === patientId);
    setDocumentReturnDraft(returnTab ? { ...form } : null);
    if (returnTab) setPatientInitialTab(returnTab);
    setFormMode("documents");
    setForm({
      patientId,
      patientName: patient ? `${value(patient, "firstName")} ${value(patient, "lastName")}` : "Patient",
      coverageId,
      category: coverageId ? "insurance_card" : "medical_record",
      title: "",
      serviceDate: "",
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function uploadPatientPhoto(patientId: string, file: File) {
    if (!patientId || !file) return;
    const upload = new FormData();
    upload.set("patientId", patientId);
    upload.set("category", "patient_photo");
    upload.set("title", "Patient profile photo");
    upload.set("document", file);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/patient-documents", { method: "POST", body: upload });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body.error || "Unable to save patient photo."));
      await loadData();
      setNotice("Patient photo saved to the chart and document history.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save patient photo.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadInsuranceCardSide(patientId: string, coverageId: string, side: "front" | "back", file: File) {
    if (!patientId || !coverageId || !file) return;
    const upload = new FormData();
    upload.set("patientId", patientId);
    upload.set("coverageId", coverageId);
    upload.set("category", "insurance_card");
    upload.set("title", `Insurance card ${side}`);
    upload.set(side, file);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/patient-documents", { method: "POST", body: upload });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body.error || `Unable to save ${side} insurance card image.`));
      await loadData();
      setNotice(`${side === "front" ? "Front" : "Back"} insurance card image saved. You are still in this patient’s Insurance section.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to save ${side} insurance card image.`);
    } finally {
      setSaving(false);
    }
  }

  async function action(actionName: string, payload: Record<string, unknown> = {}) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName, ...payload }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        await loadData().catch(() => undefined);
        throw new Error(String(body.error || "Unable to complete action."));
      }
      await loadData();
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete action.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function autosaveEncounterDraft(snapshot?: Record<string, string | boolean>) {
    const current = snapshot || formRef.current;
    if (formModeRef.current !== "encounter") return false;
    if (!current.id) return false;
    if (["signed", "ready_to_bill", "billed"].includes(String(current.status || ""))) return false;
    if (autosaveInFlight.current) return autosaveInFlight.current;

    const run = (async () => {
      setAutosaveState("saving");
      try {
        const response = await fetch("/api/operations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "saveEncounter", ...current, intent: "draft" }),
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to autosave draft.");
        setAutosaveState("saved");
        return true;
      } catch {
        setAutosaveState("error");
        return false;
      } finally {
        autosaveInFlight.current = null;
      }
    })();
    autosaveInFlight.current = run;
    return run;
  }

  function openClinicalEncounter(encounter: DataRow, appointment?: DataRow) {
    setFormMode("encounter");
    setForm(encounterFormValue(encounter, appointment, (data?.clinicalOrders || []).filter((order) => value(order, "encounterId") === value(encounter, "id"))));
    setError("");
    setNotice("");
    setAutosaveState("idle");
    setModalOpen(true);
  }

  function openVitalsIntake(appointment: DataRow) {
    const encounter = data?.encounters.find((item) => value(item, "appointmentId") === value(appointment, "id"));
    const intake = encounterFormValue(encounter || {}, appointment);
    setFormMode("vitals");
    setForm({ ...intake, appointmentId: value(appointment, "id"), patientName: value(appointment, "patientName"), providerName: value(appointment, "providerName"), roomName: value(appointment, "roomName") || "Room 1" });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function openSoapVisit(appointment: DataRow) {
    const flowStatus = value(appointment, "flowStatus");
    if (flowStatus === "ready_for_provider") {
      const moved = await action("updateVisitFlow", { id: value(appointment, "id"), flowStatus: "consultation_started", roomName: value(appointment, "roomName") || "Room 1" });
      if (!moved) return;
    }
    const existing = data?.encounters.find((item) => value(item, "appointmentId") === value(appointment, "id"));
    if (existing) {
      openClinicalEncounter(existing, appointment);
      return;
    }
    const result = await action("startEncounter", { appointmentId: value(appointment, "id") });
    if (!result) return;
    const created = (result.encounter || {}) as DataRow;
    openClinicalEncounter({ ...created, patientName: value(appointment, "patientName"), providerName: value(appointment, "providerName") }, appointment);
  }

  async function closeModal() {
    if (module === "clinical" && formMode === "encounter") {
      await autosaveEncounterDraft();
      if (clinicalReturnTo) {
        window.location.assign(clinicalReturnTo);
        return;
      }
    }
    setDocumentationNav(null);
    setCompletionNav(null);
    setModalOpen(false);
  }

  function openOrderResult(order: DataRow) {
    const encounter = data?.encounters.find((item) => value(item, "id") === value(order, "encounterId"));
    setFormMode("order-result");
    setForm({ orderId: value(order, "id"), orderName: value(order, "name"), patientName: value(encounter || {}, "patientName"), resultStatus: "final", abnormalFlag: "unknown", resultedAt: toLocalDateTimeValue(new Date().toISOString()) });
    setError(""); setNotice(""); setModalOpen(true);
  }

  function openMedicationForm() {
    setFormMode("medication");
    setForm({ patientId: data?.patients[0] ? value(data.patients[0], "id") : "", startDate: new Date().toISOString().slice(0, 10), status: "active" });
    setError(""); setNotice(""); setModalOpen(true);
  }

  async function reviewResult(id: string) { if (await action("reviewOrderResult", { id })) setNotice("Result reviewed and attributed to the signed-in clinician."); }
  async function changeOrderStatus(id: string, status: string) { if (await action("updateClinicalOrderStatus", { id, status })) setNotice(`Order marked ${status}.`); }
  async function requestMedicationRefill(medication: DataRow) { if (await action("requestRefill", { medicationId: value(medication, "id"), requestedBy: currentUser.fullName })) setNotice("Refill request added to the provider review queue."); }
  async function discontinueMedication(id: string) { if (await action("updateMedicationStatus", { id, status: "discontinued" })) setNotice("Medication discontinued with its history retained."); }
  async function decideRefill(id: string, decision: "approved" | "denied") { if (await action("decideRefill", { id, decision })) setNotice(`Refill ${decision} by ${currentUser.fullName}. No prescription was transmitted externally.`); }

  useEffect(() => {
    if (module !== "clinical" || !data || clinicalQueryHandled) return;
    const clinicalQuery = new URLSearchParams(window.location.search);
    const appointmentId = clinicalQuery.get("appointmentId");
    if (!appointmentId) return;
    const requestedReturn = clinicalQuery.get("returnTo") || "";
    setClinicalReturnTo(requestedReturn === "/chart" || requestedReturn.startsWith("/chart?") ? requestedReturn.slice(0, 500) : "");
    setClinicalQueryHandled(true);
    window.history.replaceState({}, "", window.location.pathname);
    const appointment = data.appointments.find((item) => value(item, "id") === appointmentId);
    const existing = data.encounters.find((item) => value(item, "appointmentId") === appointmentId);
    if (existing) {
      openClinicalEncounter(existing, appointment);
      return;
    }
    action("startEncounter", { appointmentId }).then((result) => {
      if (!result) return;
      const created = (result.encounter || {}) as DataRow;
      openClinicalEncounter({ ...created, patientName: value(appointment || {}, "patientName"), providerName: value(appointment || {}, "providerName") }, appointment);
    });
  }, [clinicalQueryHandled, data, module]);

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saveAndApply = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-payment-intent") === "apply";
    if (module === "payments" && form.savedPaymentNumber) return;
    if (module === "clinical" && formMode === "encounter-pick") return;
    if (module === "patients" && formMode === "documents") {
      const upload = new FormData(event.currentTarget);
      upload.set("patientId", String(form.patientId || ""));
      upload.set("coverageId", String(form.coverageId || ""));
      upload.set("category", String(form.category || ""));
      upload.set("title", String(form.title || ""));
      upload.set("serviceDate", String(form.serviceDate || ""));
      setSaving(true);
      setError("");
      try {
        const response = await fetch("/api/patient-documents", { method: "POST", body: upload });
        const body = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(body.error || "Unable to upload patient document."));
        await loadData();
        const savedMessage = `${String(body.count || 1)} patient document${Number(body.count || 1) === 1 ? "" : "s"} saved securely.`;
        if (documentReturnDraft) {
          setFormMode("edit-patient");
          setForm(documentReturnDraft);
          setDocumentReturnDraft(null);
          setModalOpen(true);
          setNotice(`${savedMessage} Returned to the patient’s ${patientInitialTab === "documents" ? "Documents" : "Insurance"} section.`);
        } else {
          setModalOpen(false);
          setNotice(savedMessage);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to upload patient document.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitIntent = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const submittedMode = formMode;
    const submittedForm = { ...form };
    if (module === "clinical" && formMode === "encounter" && !form.id && ["sign", "ready_to_bill"].includes(submitIntent)) {
      setError("Save draft once to create the visit, then Sign or Ready to bill.");
      return;
    }
    const actionName =
      module === "patients" ? formMode === "eligibility-review" ? "confirmEligibilityUpdate" : formMode === "responsibility" ? "createResponsibilityProfile" : formMode === "close-responsibility" ? "closeResponsibilityProfile" : formMode === "coverage-order" ? "updateCoverageOrder" : formMode === "coverage" ? ["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) ? "createLegalResponsibility" : "createPatientCoverage" : formMode === "edit-patient" ? "updatePatient" : "createPatient"
      : module === "scheduler" ? formMode === "quick-patient" ? "createPatient" : formMode === "reschedule" ? "rescheduleAppointment" : "createAppointment"
      : module === "eligibility" ? "checkEligibility"
      : module === "clinical" ? formMode === "encounter" ? (form.id ? "saveEncounter" : "createDraftEncounter") : formMode === "vitals" ? "recordVisitIntake" : formMode === "order-result" ? "saveOrderResult" : formMode === "medication" ? "createPatientMedication" : "createEncounter"
      : module === "claims" ? "createClaim"
      : module === "payments" ? formMode === "era" ? "importEra" : "createPaymentEntry"
      : module === "payers" ? formMode === "plan" ? "createPlan" : form.id ? "updatePayer" : "createPayer"
      : module === "fees" ? "createFeeSchedule"
      : module === "procedures" ? formMode === "edit-procedure" ? "updateProcedure" : "createProcedure"
      : module === "integrations" ? "updateIntegration"
      : "";
    if (!actionName) return;
    let submitPayload: Record<string, unknown> = form;
    if (module === "clinical" && formMode === "encounter") {
      submitPayload = { ...form, intent: submitIntent || "draft" };
    } else if (module === "integrations") {
      const credentials: Record<string, string> = {};
      const rest: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(form)) {
        if (key.startsWith("cred_")) credentials[key.slice(5)] = String(entry ?? "");
        else rest[key] = entry;
      }
      submitPayload = { ...rest, credentials };
    }
    const result = await action(actionName, submitPayload);
    if (result) {
      if (module === "scheduler" && submittedMode === "quick-patient") {
        setFormMode("");
        setForm({ ...(appointmentDraft || blankForm("scheduler")), patientId: String(result.id || "") });
        setAppointmentDraft(null);
        setNotice("Patient created and selected. Complete the appointment details.");
        setError("");
        setModalOpen(true);
        return;
      }
      if (module === "patients" && submitIntent === "schedule" && ["", "edit-patient"].includes(submittedMode)) {
        const patientId = String(result.id || submittedForm.id || "");
        window.location.assign(`/scheduler?patientId=${encodeURIComponent(patientId)}`);
        return;
      }
      if (module === "patients" && submitIntent === "add-coverage" && ["", "edit-patient", "coverage"].includes(submittedMode)) {
        const savedPatientId = submittedMode === "coverage" ? String(submittedForm.patientId || "") : String(result.id || submittedForm.id || "");
        continueWithNextCoverage(savedPatientId, submittedForm);
        return;
      }
      if (module === "clinical" && submittedMode === "encounter" && (submitIntent || "draft") === "draft") {
        const createdId = String(result.id || "");
        const createdEncounter = (result.encounter || {}) as DataRow;
        if (createdId && !submittedForm.id) {
          setForm((current) => ({
            ...current,
            ...encounterFormValue(
              {
                ...createdEncounter,
                ...current,
                id: createdId,
                status: "draft",
                patientName: value(createdEncounter, "patientName") || String(current.patientName || ""),
                providerName: value(createdEncounter, "providerName") || String(current.providerName || ""),
              },
              undefined,
              [],
            ),
            id: createdId,
            status: "draft",
          }));
        } else {
          setForm((current) => ({ ...current, status: "draft" }));
        }
        setAutosaveState("saved");
        setNotice(createdId && !submittedForm.id
          ? "Visit opened. Continue documenting — drafts autosave."
          : "Encounter draft saved with an audit record. You can continue documenting.");
        setError("");
        setModalOpen(true);
        return;
      }
      if (module === "clinical" && submittedMode === "encounter" && clinicalReturnTo) {
        window.location.assign(clinicalReturnTo);
        return;
      }
      if (module === "payments" && submittedMode !== "era") {
        if (saveAndApply && result.id) {
          window.location.assign(`/payments?paymentId=${encodeURIComponent(String(result.id))}`);
          return;
        }
        setForm((current) => ({ ...current, savedPaymentNumber: String(result.paymentNumber || ""), savedPaymentId: String(result.id || "") }));
        setNotice(`Payment ${String(result.paymentNumber || "")} created.`);
        return;
      }
      setModalOpen(false);
      setNotice(
        module === "patients" ? formMode === "responsibility" ? "DOS responsibility profile saved with an audit record."
          : formMode === "eligibility-review" ? "Eligibility details reviewed and applied with an audit log."
          : formMode === "close-responsibility" ? "Responsibility period closed without changing historical claims."
          : formMode === "coverage-order" ? "Default primary, secondary and tertiary insurance order updated. Existing DOS profiles and claims were not changed."
          : formMode === "coverage" ? "Coverage or responsibility source saved."
          : result.eligibility
          ? `Patient ${formMode === "edit-patient" ? "updated" : "saved"} and eligibility verified: ${String((result.eligibility as DataRow).status)} coverage.`
          : result.eligibilityError ? `Patient ${formMode === "edit-patient" ? "updated" : "saved"}. Eligibility requires attention: ${String(result.eligibilityError)}`
          : formMode === "edit-patient" ? "Patient and coverage updated." : "Patient and coverage saved."
        : module === "scheduler" ? formMode === "reschedule" ? "Appointment rescheduled. Its status returned to scheduled." : "Appointment scheduled."
        : module === "eligibility" ? "Eligibility verification completed."
        : module === "clinical" ? formMode === "encounter" ? submitIntent === "ready_to_bill" ? (result.queuedClaim ? `Ready to bill and queued as ${String((result.queuedClaim as DataRow).claimNumber || "")}. Open Claim prep to scrub.` : "Encounter signed and marked ready for billing.") : submitIntent === "sign" ? "Encounter signed by the provider." : "Encounter draft saved with an audit record." : formMode === "vitals" ? "Vitals and intake saved. Patient moved to Ready for provider." : formMode === "order-result" ? "Clinical result recorded and queued for review." : formMode === "medication" ? "Medication added to the active chart list. No external prescription was transmitted." : "Encounter signed and routed."
        : module === "claims" ? "Claim draft prepared from encounter."
        : module === "payments" ? formMode === "era" ? "ERA received for matching and review." : "Payment entry created (Pending Posting)."
        : module === "integrations" ? "Integration configuration saved in safe mode."
        : module === "procedures" ? formMode === "edit-procedure" ? "Procedure master and practice charge updated." : "Procedure code added to the charge master."
        : "Configuration saved.",
      );
    }
  }

  async function scrubClaim(id: string) {
    const result = await action("scrubClaim", { id });
    if (result) {
      setClaimIssues((current) => ({ ...current, [id]: ((result.issues || []) as DataRow[]).filter(isActionableClaimIssue) }));
      setNotice(result.status === "clean"
        ? "Claim is clean and moved to Clean."
        : "Claim moved to Errors. Open Fix claim to correct blocking issues.");
    }
    return result;
  }

  async function scrubClaimsBatch(ids: string[]) {
    if (!ids.length) {
      setNotice("No claims in this bucket to scrub.");
      return;
    }
    setSaving(true);
    const nextIssues: Record<string, DataRow[]> = {};
    let cleanCount = 0;
    let errorCount = 0;
    try {
      for (const id of ids) {
        const response = await fetch("/api/operations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "scrubClaim", id }),
        });
        const body = await response.json() as { error?: string; status?: string; issues?: DataRow[] };
        if (!response.ok) throw new Error(body.error || "Unable to scrub claim.");
        nextIssues[id] = (body.issues || []).filter(isActionableClaimIssue);
        if (body.status === "clean") cleanCount += 1;
        else errorCount += 1;
      }
      await loadData();
      setClaimIssues((current) => ({ ...current, ...nextIssues }));
      setNotice(`Scrubbed ${ids.length} claim${ids.length === 1 ? "" : "s"}: ${cleanCount} moved to Clean, ${errorCount} moved to Errors.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to scrub claims.");
    } finally {
      setSaving(false);
    }
  }

  async function queueReadyClaims() {
    const result = await action("queueReadyClaims", {});
    if (!result) return;
    setNotice(`Received updated: ${Number(result.created || 0)} new claim${Number(result.created || 0) === 1 ? "" : "s"} queued from signed visits.`);
  }

  async function seedDemoWorkspaceSamples() {
    const result = await action("seedDemoWorkspace", {});
    if (!result) return;
    setSchedulerDate(String(result.today || new Date().toISOString().slice(0, 10)));
    setNotice(`Sample data loaded: ${Number(result.patients || 0)} patients, ${Number(result.appointments || 0)} appointments, ${Number(result.claims || 0)} claims, ${Number(result.batches || 0)} batches, ${Number(result.payments || 0)} payment.`);
  }

  async function resolveInboundEvent(id: string, status: "accepted" | "rejected" | "held") {
    const result = await action("resolveInboundEvent", { id, status });
    if (!result) return;
    if (status === "accepted" && (result.applied || result.issues)) {
      const applied = (result.applied || {}) as DataRow;
      const scrub = (result.scrub || {}) as DataRow;
      const claimNumber = String(applied.claimNumber || "");
      const scrubStatus = String(scrub.status || "");
      const queueNote = claimNumber
        ? scrubStatus === "clean"
          ? ` Claim ${claimNumber} is clean and in Clean.`
          : scrubStatus === "errors"
            ? ` Claim ${claimNumber} landed in Errors.`
            : ` Claim ${claimNumber} queued in Received.`
        : "";
      setNotice(`Inbound accepted → patient ${String(applied.patientId || "")} · encounter ${String(applied.encounterId || "")}.${queueNote}`);
      await loadData();
      return;
    }
    setNotice(`Inbound event marked ${status}.`);
    await loadData();
  }

  async function ingestInboundBundle(bundle: unknown, format: "pracx" | "fhir") {
    const result = await action(format === "fhir" ? "ingestFhirBundle" : "ingestInboundBundle", { bundle });
    if (!result) return;
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const errors = issues.filter((issue) => (issue as DataRow).severity === "error").length;
    setNotice(
      result.duplicate
        ? `Duplicate bundle recognized. Existing intake ${String(result.id || "")} was not created again.`
        : errors
          ? `Bundle queued as ${String(result.status || "held")} with ${errors} blocking issue${errors === 1 ? "" : "s"}.`
          : `Bundle validated and queued (${String(result.status || "pending")}).`,
    );
    await loadData();
  }

  async function verifyPatientEligibility(patientId: string, coverageId?: string) {
    const result = await action("checkEligibility", {
      patientId,
      coverageId: coverageId || "",
      dateOfService: new Date().toISOString().slice(0, 10),
    });
    if (!result) return;
    const details = (result.details || {}) as DataRow;
    setSelectedPatientId(patientId);
    setEligibilityReview({ ...result, details });
    setFormMode("eligibility-review");
    setForm({
      eligibilityCheckId: String(result.id || ""),
      patientId,
      addressChoice: "keep_current",
      reason: `Eligibility review ${String(result.referenceNumber || "")}`.trim(),
    });
    setModalOpen(true);
  }

  function editPatient(patient: DataRow, coverage?: DataRow) {
    const patientZip = splitPostalCode(value(patient, "postalCode"));
    setPatientInitialTab("demographics");
    setFormMode("edit-patient");
    setForm({
      id: value(patient, "id"),
      firstName: value(patient, "firstName"),
      middleName: value(patient, "middleName"),
      lastName: value(patient, "lastName"),
      suffix: value(patient, "suffix"),
      dateOfBirth: value(patient, "dateOfBirth"),
      sex: value(patient, "sex") || "unknown",
      maritalStatus: value(patient, "maritalStatus"),
      addressLine1: value(patient, "addressLine1"),
      addressLine2: value(patient, "addressLine2"),
      city: value(patient, "city"),
      state: value(patient, "state"),
      postalCode: patientZip.zip5,
      zipPlus4: patientZip.zipPlus4,
      phone: formatPhone(value(patient, "phone")),
      email: value(patient, "email"),
      coverageId: value(coverage || {}, "id"),
      coverageType: value(coverage || {}, "coverageType") || "health",
      planId: value(coverage || {}, "planId"),
      memberId: value(coverage || {}, "memberId"),
      groupNumber: value(coverage || {}, "groupNumber"),
      priority: value(coverage || {}, "priority") || "primary",
      relationship: value(coverage || {}, "relationship") || "self",
      subscriberFirstName: value(coverage || {}, "subscriberFirstName"),
      subscriberLastName: value(coverage || {}, "subscriberLastName"),
      subscriberDateOfBirth: value(coverage || {}, "subscriberDateOfBirth"),
      subscriberSex: value(coverage || {}, "subscriberSex"),
      subscriberAddressLine1: value(coverage || {}, "subscriberAddressLine1"),
      subscriberCity: value(coverage || {}, "subscriberCity"),
      subscriberState: value(coverage || {}, "subscriberState"),
      subscriberPostalCode: value(coverage || {}, "subscriberPostalCode"),
      subscriberSameAsPatient: !coverage || (
        value(coverage, "relationship") === "self"
        && value(coverage, "subscriberFirstName") === value(patient, "firstName")
        && value(coverage, "subscriberLastName") === value(patient, "lastName")
      ),
      effectiveDate: value(coverage || {}, "effectiveDate"),
      terminationDate: value(coverage || {}, "terminationDate"),
      propertyCasualtyClaimNumber: value(coverage || {}, "propertyCasualtyClaimNumber"),
      accidentDate: value(coverage || {}, "accidentDate"),
      accidentState: value(coverage || {}, "accidentState"),
      adjusterName: value(coverage || {}, "adjusterName"),
      adjusterPhone: formatPhone(value(coverage || {}, "adjusterPhone")),
      adjusterEmail: value(coverage || {}, "adjusterEmail"),
      adjusterFax: formatPhone(value(coverage || {}, "adjusterFax")),
      claimAddressLine1: value(coverage || {}, "claimAddressLine1"),
      claimCity: value(coverage || {}, "claimCity"),
      claimState: value(coverage || {}, "claimState"),
      claimPostalCode: value(coverage || {}, "claimPostalCode"),
      coverageLimit: value(coverage || {}, "coverageLimit"),
      amountUsed: value(coverage || {}, "amountUsed"),
      authorizationNumber: value(coverage || {}, "authorizationNumber"),
      acceptAssignment: value(coverage || {}, "acceptAssignment") !== "no",
      releaseOfInformation: value(coverage || {}, "releaseOfInformation") !== "no",
      assignmentOfBenefits: value(coverage || {}, "assignmentOfBenefits") !== "no",
      verifyEligibility: true,
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function createPayerBatches(ids: string[]) {
    const result = await action("createPayerBatches", ids.length ? { ids } : {});
    if (result) {
      setNotice(`Created ${Number(result.created || 0)} payer batch${Number(result.created) === 1 ? "" : "es"} (${Number(result.ediBatches || 0)} EDI, ${Number(result.paperBatches || 0)} paper). Claims are locked.`);
    }
  }

  async function transmitClaimBatch(id: string) {
    const result = await action("transmitClaimBatch", { id });
    if (result) setNotice(`Batch transmitted. Clearinghouse response recorded.`);
  }

  async function markPaperBatchMailed(id: string) {
    const result = await action("markPaperBatchMailed", { id, mailMethod: "usps_first_class" });
    if (result) setNotice("Paper batch marked mailed and moved to Submitted.");
  }

  async function downloadBatchFile(id: string, kind: "edi" | "proof" | "ackTxt" | "ackPdf") {
    const result = await action("downloadBatchFile", { id, kind });
    if (!result) return;
    const filename = String(result.filename || `${kind}.txt`);
    const blob = kind === "ackPdf"
      ? new Blob([Uint8Array.from(atob(String(result.base64 || "")), (character) => character.charCodeAt(0))], { type: "application/pdf" })
      : new Blob([String(result.content || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${filename}.`);
  }

  async function populatePaymentClaims(paymentId: string, claimIds?: string[]) {
    const result = await action("populatePaymentClaims", claimIds?.length ? { id: paymentId, claimIds } : { id: paymentId });
    if (result) setNotice(`Populated ${Number(result.added || 0)} claim payment line(s).`);
    return Boolean(result);
  }

  async function fixPaymentClaims(paymentId: string, lines: Array<Record<string, unknown>>, header?: Record<string, unknown>) {
    const result = await action("fixPaymentClaims", { id: paymentId, lines, ...(header || {}) });
    if (result) setNotice(`Updated payment entry${Number(result.updated || 0) ? ` and ${Number(result.updated)} claim line(s)` : ""}.`);
    return Boolean(result);
  }

  async function autoPostPayment(paymentId: string) {
    const result = await action("autoPostPayment", { id: paymentId });
    if (result) setNotice(`Auto-posted ${Number(result.posted || 0)} claim(s). Status: ${String(result.paymentStatus || "")}.`);
    return Boolean(result);
  }

  async function manualPostClaimPayment(payload: Record<string, unknown>) {
    const result = await action("manualPostClaimPayment", payload);
    if (result) setNotice(`Manually posted claim. Payment status: ${String(result.paymentStatus || "")}.`);
    return Boolean(result);
  }

  async function processEra(id: string) {
    const result = await action("processEra", { id });
    if (result) {
      setNotice(`ERA processed into ${String(result.paymentNumber || "payment")} · ${Number(result.matched || 0)} matched, ${Number(result.autoPosted || 0)} auto-posted, ${Number(result.unmatched || 0)} unmatched${result.autoPostError ? ` · ${String(result.autoPostError)}` : ""}.`);
    }
    return Boolean(result);
  }

  async function startEra(id: string) {
    const result = await action("processEra", { id, autoPost: false });
    if (result) {
      setNotice(`ERA started in editable mode · ${Number(result.matched || 0)} matched, ${Number(result.unmatched || 0)} unmatched. Review CPT allocations, then Process ERA.`);
    }
    return Boolean(result);
  }

  async function seedEraClaims(id: string) {
    const result = await action("seedEraClaims", { id });
    if (result) setNotice(`Demo patient setup complete · ${Number(result.created || 0)} new claim(s) created. Addresses and mixed responsibility coverage are ready for testing.`);
    return Boolean(result);
  }

  async function createEraDenialVariant(id: string) {
    const result = await action("createEraTestVariant", { id, variant: "denial" });
    if (result) setNotice(`Created ${String(result.fileName || "denial-test.835")} with fresh denied claim numbers and zero payments. Open it, click Ensure demo patients & coverage, then Post ERA. The original ERA was not changed.`);
    return Boolean(result);
  }

  async function createEraZeroCheckVariant(id: string) {
    const result = await action("createEraTestVariant", { id, variant: "zero_check" });
    if (result) setNotice(`Created ${String(result.fileName || "zero-check-test.835")} with a zero check and the original CPT payments. The original ERA was not changed.`);
    return Boolean(result);
  }

  async function recalculatePayment(paymentId: string, header?: Record<string, unknown>) {
    const result = await action("recalculatePayment", { id: paymentId, ...(header || {}) });
    if (result) {
      setNotice(result.balanced ? "Totals balanced. Auto Post is available." : `Unbalanced by ${currency(String(result.difference || "0"))}. Correct amounts and recalculate.`);
    }
    return Boolean(result);
  }

  async function generateClaims(ids: string[]) {
    if (!ids.length) {
      setNotice("Select Clean claims to generate.");
      return;
    }
    const result = await action("generateClaims", { ids });
    if (result) {
      setNotice(`Generated ${Number(result.generated || 0)} claim${Number(result.generated) === 1 ? "" : "s"} using each payer’s electronic/paper route${Number(result.failed) ? `; ${result.failed} failed final validation` : ""}.`);
    }
  }

  async function submitClaim(id: string) {
    const result = await action("submitClaim", { id, mode: "test" });
    if (result) setNotice(`Claim submitted in test mode. Trace ${result.trace}.`);
  }

  async function routeClaim(id: string, method: "electronic" | "paper" | "hold") {
    const result = await action("routeClaim", { id, method });
    if (result) setNotice(method === "electronic" ? "Claim moved to the electronic submission queue." : method === "paper" ? "Claim moved to the paper claim queue." : "Claim placed on hold.");
  }

  async function submitClaimsBatch(ids: string[]) {
    if (!ids.length) return;
    setSaving(true);
    setError("");
    let submitted = 0;
    try {
      for (const id of ids) {
        const response = await fetch("/api/operations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "submitClaim", id, mode: "test" }),
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to submit claim batch.");
        submitted += 1;
      }
      await loadData();
      setNotice(`${submitted} electronic claim${submitted === 1 ? "" : "s"} submitted to the clearinghouse test connection.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit claim batch.");
    } finally {
      setSaving(false);
    }
  }

  async function markClaimPrinted(id: string) {
    const result = await action("markClaimPrinted", { id });
    if (!result) return false;
    setNotice("CMS-1500 marked printed. Use the browser print dialog to complete printing.");
    return true;
  }

  async function markClaimMailed(id: string, mailMethod: string, trackingNumber: string) {
    const result = await action("markClaimMailed", { id, mailMethod, trackingNumber });
    if (result) setNotice("Paper claim marked mailed and moved to submission history.");
    return Boolean(result);
  }

  async function saveClaimCorrections(payload: Record<string, unknown>, rescrub: boolean) {
    const result = await action("saveClaimCorrections", payload);
    if (!result) return null;
    if (payload.followUpSave) {
      if (rescrub) {
        const scrubbed = await scrubClaim(String(payload.id || ""));
        if (!scrubbed) return null;
        setNotice(scrubbed.status === "clean"
          ? "Corrections saved and re-checked. Rebill to send the claim to Claim prep — this does not auto-submit."
          : "Corrections saved. Re-check still found blocking issues.");
        return scrubbed;
      }
      setNotice("Corrections saved on this claim. Rebill to send it to Claim prep. This does not auto-submit.");
      return result;
    }
    if (rescrub) {
      const scrubbed = await scrubClaim(String(payload.id || ""));
      if (!scrubbed) return null;
      setNotice(scrubbed.status === "clean"
        ? "Corrections saved. Claim is clean and moved to Clean."
        : "Corrections saved. Re-scrub still found blocking issues — claim stays in Errors.");
      return scrubbed;
    }
    setNotice("Claim corrections saved. Re-scrub before the claim can move to Clean.");
    return result;
  }

  async function download837(id: string) {
    const result = await action("generate837", { id });
    if (!result) return;
    const blob = new Blob([String(result.content || "")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = String(result.filename || "claim.837");
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("837P file generated and downloaded.");
  }

  function exportTransactions() {
    const rows = data?.transactions || [];
    const headers = ["Patient", "Claim", "Type", "Source", "Amount", "Date of Service", "Transaction Date", "Payment Date", "Posting Date", "First Billed Date", "Last Billed Date", "Reference"];
    const csv = [
      headers.join(","),
      ...rows.map((row) => [
        value(row, "patientName"), value(row, "claimNumber"), value(row, "transactionType"),
        value(row, "source"), value(row, "amount"), value(row, "dateOfService"),
        value(row, "transactionDate"), value(row, "paymentDate"), value(row, "postingDate"),
        value(row, "firstBilledDate"), value(row, "lastBilledDate"), value(row, "referenceNumber"),
      ].map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pracx-transaction-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Transaction report exported.");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  const initials = currentUser.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const query = search.trim().toLowerCase();
  const filteredPatients = useMemo(() => (data?.patients || []).filter((row) => `${value(row, "firstName")} ${value(row, "lastName")} ${value(row, "accountNumber")}`.toLowerCase().includes(query)), [data, query]);
  const filteredClaims = useMemo(() => (data?.claims || []).filter((row) => `${value(row, "claimNumber")} ${value(row, "patientName")} ${value(row, "payerName")}`.toLowerCase().includes(query)), [data, query]);

  function primaryAction() {
    if (module === "dashboard") return void loadData().then(() => setNotice("Inbound integration summary refreshed."));
    if (module === "reports") return exportTransactions();
    if (module === "scheduler") return openAppointment();
    if (module === "clinical") return openNewEncounter();
    if (module === "claim_inquiry") {
      const base = workspaceBasePath(variant);
      window.location.assign(`${base}/claims`.replace(/\/{2,}/g, "/") || "/claims");
      return;
    }
    if (module === "collections") {
      const base = workspaceBasePath(variant);
      window.location.assign(`${base}/claim-inquiry`.replace(/\/{2,}/g, "/") || "/claim-inquiry");
      return;
    }
    if (module === "claims") return void queueReadyClaims();
    openForm();
  }

  const setupModule = ["payers", "fees", "procedures"].includes(module);
  const activeConfigKey = setupModule
    ? "setup"
    : module === "integrations"
      ? "integrations"
      : "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">PX</span><div><strong>{brand.title}</strong><small>{brand.subtitle}</small></div></div>
        <nav aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <Fragment key={item.key}>
              {(index === 0 || item.section !== navItems[index - 1]?.section) && <p className="nav-label">{item.section || "Workspace"}</p>}
              <Link className={`nav-item ${item.key === module || (item.key === "claim_inquiry" && module === "claims") ? "active" : ""}`} href={item.href}>
                <span className="nav-dot" aria-hidden="true" />{item.label}
              </Link>
            </Fragment>
          ))}
          <p className="nav-label setup-label">Configuration</p>
          {configLinks.map((item) => (
            <Link
              className={`nav-item ${activeConfigKey === item.key || (item.key === "setup" && setupModule) ? "active" : ""}`}
              href={item.href}
              key={item.key}
            >
              <span className="nav-dot" aria-hidden="true" />{item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="avatar">{initials}</span><div className="sidebar-user"><strong>{currentUser.fullName}</strong><small>{currentUser.role}</small></div><button aria-label="Sign out" className="signout-button" onClick={signOut} type="button">↗</button></div>
      </aside>

      <main className="main">
        <header className="topbar operations-topbar">
          <div><span className="eyebrow">{isBilling && module === "patients" ? (variant === "pracx" ? "PRACX · Patient administration" : "Billing · Patient administration") : meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className="top-actions">
            {module === "payers" && <button className="secondary-button" onClick={() => openForm("plan")} type="button">Add plan</button>}
            <button className="primary-button" onClick={primaryAction} type="button"><span aria-hidden="true">{module === "reports" ? "↓" : "＋"}</span>{meta.action}</button>
          </div>
        </header>

        <section className="operations-content">
          {(module === "claim_inquiry" || module === "claims") && (
            <nav className="claim-workspace-switch" aria-label="Claims workspace views">
              <Link className={module === "claim_inquiry" ? "selected" : ""} href={`${workspaceBasePath(variant)}/claim-inquiry`.replace(/\/{2,}/g, "/") || "/claim-inquiry"}>Patient &amp; claim history</Link>
              <Link className={module === "claims" ? "selected" : ""} href={`${workspaceBasePath(variant)}/claims`.replace(/\/{2,}/g, "/") || "/claims"}>Work queue · prepare &amp; submit</Link>
            </nav>
          )}
          {setupModule && (
            <div className="section-tabs" role="tablist" aria-label="Practice setup sections">
              <Link href={setupTabHref(variant, "/setup")} role="tab">Facilities</Link>
              <Link href={setupTabHref(variant, "/setup/providers")} role="tab">Providers</Link>
              <Link href={setupTabHref(variant, "/setup/referring-providers")} role="tab">Referring providers</Link>
              <Link className={module === "payers" ? "selected" : ""} href={setupTabHref(variant, "/setup/payers")} role="tab">Payers & plans</Link>
              <Link className={module === "fees" ? "selected" : ""} href={setupTabHref(variant, "/setup/fee-schedules")} role="tab">Payer fee schedules</Link>
              <Link href={setupTabHref(variant, "/setup/fee-setup")} role="tab">Fee setup</Link>
              <Link className={module === "procedures" ? "selected" : ""} href={setupTabHref(variant, "/setup/procedure-codes")} role="tab">Procedure codes</Link>
              {currentUser.role.toLowerCase() === "administrator" && (
                <Link href={setupTabHref(variant, "/setup/claim-configuration")} role="tab">Claim configuration</Link>
              )}
            </div>
          )}
          {notice && <div className="notice success">{notice}</div>}
          {!isModalOpen && error && <div className="notice error">{error}</div>}
          {!data && !error && <div className="loading-state">Loading PRACX workspace…</div>}

          {data && module === "dashboard" && (
            <PracxIntegrationDashboard
              data={{
                integrations: data.integrations,
                inboundEvents: data.inboundEvents || [],
                syncEvents: data.syncEvents || [],
              }}
              isSaving={isSaving}
              onOpenIntegrations={() => {
                const base = workspaceBasePath(variant);
                window.location.assign(base ? `${base}/integrations` : "/integrations");
              }}
              onResolve={(id, status) => void resolveInboundEvent(id, status)}
              onIngest={(bundle, format) => void ingestInboundBundle(bundle, format)}
              variant={variant}
            />
          )}

          {data && module === "patients" && (
            <>
              <SummaryCards cards={[
                ["Active patients", String(data.patients.length), "Registered in this organization"],
                ["Active coverages", String(data.coverages.length), "Primary and secondary policies"],
                ["DOS profiles", String(data.responsibilityProfiles.filter((row) => value(row, "status") === "active").length), "Date-specific responsibility"],
                ["Coverage conflicts", String(data.responsibilityProfiles.filter((row) => ["disputed", "under_investigation"].includes(value(row, "verificationStatus"))).length), "Need billing review"],
              ]} />
              <TablePanel title="Patient directory" description="A concise patient index. Open Edit to view demographics, contact and insurance details." search={search} setSearch={setSearch}>
                <table><thead><tr><th>Patient</th><th>Account</th><th>Date of birth</th><th>Eligibility</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>{filteredPatients.map((patient) => {
                    const patientCoverages = data.coverages.filter((item) => value(item, "patientId") === value(patient, "id") && value(item, "status") === "active");
                    const orderRank: Record<string, number> = { primary: 1, secondary: 2, tertiary: 3, unassigned: 4 };
                    const coverage = patientCoverages.sort((left, right) => (orderRank[value(left, "priority")] || 4) - (orderRank[value(right, "priority")] || 4))[0];
                    const latestEligibility = data.eligibility.find((item) => value(item, "patientId") === value(patient, "id"));
                    return <tr className={selectedPatientId === value(patient, "id") ? "selected-patient-row" : ""} key={value(patient, "id")}><td><button className="patient-select-button" onClick={() => setSelectedPatientId(value(patient, "id"))} type="button"><PersonCell row={patient} /></button></td><td className="mono">{value(patient, "accountNumber")}</td><td>{shortDate(value(patient, "dateOfBirth"))}</td><td><Status value={value(latestEligibility || {}, "status") || "not checked"} /></td><td><Status value={value(patient, "status")} /></td><td><div className="row-actions">{!isBilling && <Link href={`/chart?patientId=${encodeURIComponent(value(patient, "id"))}`}>Open chart</Link>}<button onClick={() => editPatient(patient, coverage)} type="button">Edit</button><button disabled={!coverage || isSaving} onClick={() => verifyPatientEligibility(value(patient, "id"))} type="button">Check eligibility</button></div></td></tr>;
                  })}</tbody></table>
              </TablePanel>
              <SelectedPatientInsurance data={data} patientId={selectedPatientId} isSaving={isSaving} onCheck={verifyPatientEligibility} onDocuments={openDocuments} onEdit={editPatient} />
              {selectedPatientId && <PatientBillingHistory basePath={workspaceBasePath(variant)} data={{ claims: data.claims, claimWorkflowEvents: data.claimWorkflowEvents, payments: data.payments, paymentEntries: data.paymentEntries, claimPayments: data.claimPayments, claimPaymentServiceLines: data.claimPaymentServiceLines || [], remittances: data.remittances, encounters: data.encounters, claimBatchMembers: data.claimBatchMembers, claimBatches: data.claimBatches, claimTransmissionLogs: data.claimTransmissionLogs, paymentLogs: data.paymentLogs, reconciliationLogs: data.reconciliationLogs }} patientId={selectedPatientId} />}
            </>
          )}

          {data && module === "scheduler" && (
            <SchedulerWorkspace
              action={action}
              data={data}
              isSaving={isSaving}
              onNew={openAppointment}
              onReschedule={rescheduleAppointment}
              onSeedSamples={() => void seedDemoWorkspaceSamples()}
              selectedDate={schedulerDate}
              setNotice={setNotice}
              setSelectedDate={setSchedulerDate}
            />
          )}

          {data && module === "eligibility" && (
            <>
              <SummaryCards cards={[
                ["Verified", String(data.eligibility.filter((row) => value(row, "status") === "eligible").length), "Active coverage responses"],
                ["Pending", String(data.appointments.filter((row) => value(row, "eligibilityStatus") === "pending").length), "Appointments awaiting verification"],
                ["Average copay", currency(data.eligibility[0]?.copayAmount || 0), "From latest responses"],
                ["Connection", "Test mode", "270/271 adapter configured"],
              ]} />
              <TablePanel title="Eligibility verification queue" description="Coverage results for scheduled and on-demand dates of service.">
                <table><thead><tr><th>Patient</th><th>Payer / plan</th><th>Member / group</th><th>Coverage dates</th><th>Date of service</th><th>Status</th><th>Copay</th><th>Deductible remaining</th><th>Coinsurance</th><th>Reference</th></tr></thead>
                  <tbody>{data.eligibility.map((row) => <tr key={value(row, "id")}><td><strong>{value(row, "patientName")}</strong></td><td><strong className="location-name">{value(row, "payerName")}</strong><small className="address">{value(row, "planName")} · {value(row, "planType")}</small></td><td><strong className="location-name">{value(row, "memberId")}</strong><small className="address">Group {value(row, "groupNumber") || "—"}</small></td><td><strong className="location-name">{shortDate(value(row, "effectiveDate"))}</strong><small className="address">Through {shortDate(value(row, "terminationDate"))}</small></td><td>{shortDate(value(row, "dateOfService"))}</td><td><Status value={value(row, "status")} /></td><td>{currency(value(row, "copayAmount"))}</td><td>{currency(value(row, "deductibleRemaining"))}</td><td>{value(row, "coinsurancePercent")}%</td><td><strong className="mono">{value(row, "referenceNumber")}</strong><small className="address">{value(row, "responseMode")} response</small></td></tr>)}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "clinical" && <ClinicalCommandCenter data={data} isSaving={isSaving} onSoap={openSoapVisit} onVitals={openVitalsIntake} />}

          {false && data && module === "clinical" && (
            <>
              <SummaryCards cards={[
                ["Encounters", String(data.encounters.length), "Current clinical records"],
                ["Ready to bill", String(data.encounters.filter((row) => value(row, "status") === "ready_to_bill").length), "Signed with charges"],
                ["Draft notes", String(data.encounters.filter((row) => value(row, "status") === "draft").length), "Require provider completion"],
                ["Results to review", String(data.clinicalOrderResults.filter((row) => value(row, "reviewStatus") === "pending").length), "Lab, imaging and referral findings"],
              ]} />
              <section className="clinical-visit-queue">
                <header><div><span className="eyebrow">Care team queue</span><h2>Patients in today’s clinical flow</h2><p>Open the chart directly from the scheduled visit. One appointment creates one connected encounter.</p></div></header>
                <div>{data.appointments.filter((appointment) => ["roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"].includes(value(appointment, "flowStatus"))).map((appointment) => {
                  const encounter = data.encounters.find((item) => value(item, "appointmentId") === value(appointment, "id"));
                  return <article key={value(appointment, "id")}><div><strong>{value(appointment, "patientName")}</strong><span>{shortDate(value(appointment, "startAt"), true)} · {value(appointment, "roomName") || "Room not assigned"}</span></div><Status value={value(appointment, "flowStatus")} /><Link className="clinical-open-button" href={encounter ? `/chart?patientId=${encodeURIComponent(value(appointment, "patientId"))}` : `/clinical?appointmentId=${encodeURIComponent(value(appointment, "id"))}`}>{encounter ? "Open chart" : "Start encounter"}</Link></article>;
                })}</div>
              </section>
              <TablePanel title="Encounter workspace" description="Structured clinical documentation, provider signoff and billing-ready charge capture.">
                <table><thead><tr><th>Date</th><th>Patient</th><th>Provider</th><th>Chief complaint</th><th>Diagnoses</th><th>Procedures</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
                  <tbody>{data.encounters.map((row) => <tr key={value(row, "id")}><td>{shortDate(value(row, "dateOfService"))}</td><td><strong>{value(row, "patientName")}</strong></td><td>{value(row, "providerName")}</td><td>{value(row, "chiefComplaint") || "—"}</td><td><CodeList codes={list(row.diagnosisCodes)} /></td><td><CodeList codes={list(row.procedureCodes)} /></td><td><Status value={value(row, "status")} /></td><td>{shortDate(value(row, "lastSavedAt") || value(row, "signedAt"), true)}</td><td><button className="table-action-button" onClick={() => openClinicalEncounter(row, data.appointments.find((item) => value(item, "id") === value(row, "appointmentId")))} type="button">{value(row, "status") === "draft" ? "Continue" : "Review"}</button></td></tr>)}</tbody></table>
              </TablePanel>
              <TablePanel title="Clinical orders" description="Track signed medication, laboratory, imaging and referral orders through completion.">
                <table><thead><tr><th>Ordered</th><th>Patient</th><th>Type</th><th>Order</th><th>Priority</th><th>Status</th><th>Ordered by</th><th>Actions</th></tr></thead><tbody>{data.clinicalOrders.length ? data.clinicalOrders.map((order) => { const encounter = data.encounters.find((item) => value(item, "id") === value(order, "encounterId")); const hasResult = data.clinicalOrderResults.some((result) => value(result, "orderId") === value(order, "id")); return <tr key={value(order, "id")}><td>{shortDate(value(order, "orderedAt"), true)}</td><td><strong>{value(encounter || {}, "patientName")}</strong></td><td>{value(order, "orderType")}</td><td><strong className="location-name">{value(order, "name")}</strong><small className="address">{value(order, "code") || "No code"} · {value(order, "instructions") || "No instructions"}</small></td><td>{value(order, "priority")}</td><td><Status value={value(order, "status")} /></td><td>{value(order, "orderedByName")}</td><td><div className="row-actions">{["lab", "imaging", "referral"].includes(value(order, "orderType")) && value(order, "status") !== "cancelled" && <button onClick={() => openOrderResult(order)} type="button">{hasResult ? "Add correction" : "Record result"}</button>}{value(order, "status") === "ordered" && <button onClick={() => changeOrderStatus(value(order, "id"), "cancelled")} type="button">Cancel</button>}</div></td></tr>; }) : <tr><td colSpan={8}>No clinical orders have been entered.</td></tr>}</tbody></table>
              </TablePanel>
              <TablePanel title="Clinical results" description="Final and preliminary findings remain pending until a clinician reviews them.">
                <table><thead><tr><th>Resulted</th><th>Patient / order</th><th>Result</th><th>Flag</th><th>Review</th><th>Reviewer</th><th>Action</th></tr></thead><tbody>{data.clinicalOrderResults.length ? data.clinicalOrderResults.map((result) => { const order = data.clinicalOrders.find((item) => value(item, "id") === value(result, "orderId")); const encounter = data.encounters.find((item) => value(item, "id") === value(result, "encounterId")); return <tr key={value(result, "id")}><td>{shortDate(value(result, "resultedAt"), true)}</td><td><strong className="location-name">{value(encounter || {}, "patientName")}</strong><small className="address">{value(order || {}, "name")}</small></td><td><strong className="location-name">{value(result, "summary")}</strong><small className="address">{value(result, "resultStatus")} · {value(result, "resultData") || "No detailed values"}</small></td><td><Status value={value(result, "abnormalFlag")} /></td><td><Status value={value(result, "reviewStatus")} /></td><td>{value(result, "reviewedByName") || "—"}</td><td>{value(result, "reviewStatus") === "pending" && <button className="table-action-button" onClick={() => reviewResult(value(result, "id"))} type="button">Mark reviewed</button>}</td></tr>; }) : <tr><td colSpan={7}>No clinical results have been received or entered.</td></tr>}</tbody></table>
              </TablePanel>
              <div className="clinical-section-toolbar"><div><span className="eyebrow">Medication reconciliation</span><h2>Active medications and refills</h2><p>Local chart workflow only until an approved e-prescribing adapter is activated.</p></div><button className="secondary-button" onClick={openMedicationForm} type="button">+ Add medication</button></div>
              <TablePanel title="Patient medications" description="Longitudinal medication list with source, status and refill controls.">
                <table><thead><tr><th>Patient</th><th>Medication</th><th>Dose / route</th><th>Frequency</th><th>Started</th><th>Status</th><th>Prescriber</th><th>Actions</th></tr></thead><tbody>{data.patientMedications.length ? data.patientMedications.map((medication) => { const patient = data.patients.find((item) => value(item, "id") === value(medication, "patientId")); return <tr key={value(medication, "id")}><td><strong>{value(patient || {}, "firstName")} {value(patient || {}, "lastName")}</strong></td><td><strong className="location-name">{value(medication, "medicationName")}</strong><small className="address">{value(medication, "rxNormCode") || "No RxNorm code"} · {value(medication, "instructions") || "No instructions"}</small></td><td>{[value(medication, "dose"), value(medication, "route")].filter(Boolean).join(" · ") || "—"}</td><td>{value(medication, "frequency") || "—"}</td><td>{shortDate(value(medication, "startDate"))}</td><td><Status value={value(medication, "status")} /></td><td>{value(medication, "prescribedByName")}</td><td><div className="row-actions">{value(medication, "status") === "active" && <><button onClick={() => requestMedicationRefill(medication)} type="button">Request refill</button><button onClick={() => discontinueMedication(value(medication, "id"))} type="button">Discontinue</button></>}</div></td></tr>; }) : <tr><td colSpan={8}>No medications have been reconciled.</td></tr>}</tbody></table>
              </TablePanel>
              <TablePanel title="Refill review queue" description="Provider decisions are audited; approval does not transmit a prescription while the adapter is in test mode.">
                <table><thead><tr><th>Requested</th><th>Patient</th><th>Medication</th><th>Requested by</th><th>Status</th><th>Decision by</th><th>Actions</th></tr></thead><tbody>{data.refillRequests.length ? data.refillRequests.map((refill) => { const medication = data.patientMedications.find((item) => value(item, "id") === value(refill, "medicationId")); const patient = data.patients.find((item) => value(item, "id") === value(refill, "patientId")); return <tr key={value(refill, "id")}><td>{shortDate(value(refill, "requestedAt"), true)}</td><td><strong>{value(patient || {}, "firstName")} {value(patient || {}, "lastName")}</strong></td><td>{value(medication || {}, "medicationName")}</td><td>{value(refill, "requestedBy")}</td><td><Status value={value(refill, "status")} /></td><td>{value(refill, "decidedByName") || "—"}</td><td>{value(refill, "status") === "pending" && <div className="row-actions"><button onClick={() => decideRefill(value(refill, "id"), "approved")} type="button">Approve</button><button onClick={() => decideRefill(value(refill, "id"), "denied")} type="button">Deny</button></div>}</td></tr>; }) : <tr><td colSpan={7}>No refill requests are waiting.</td></tr>}</tbody></table>
              </TablePanel>
              <section className="clinical-adapter-strip">{data.integrations.filter((row) => ["laboratory_results", "imaging_results", "e_prescribing"].includes(value(row, "integrationType"))).map((row) => <article key={value(row, "id")}><div><strong>{value(row, "integrationType").replaceAll("_", " ")}</strong><span>{value(row, "vendorName")}</span></div><Status value={value(row, "status")} /><small>{value(row, "mode")} mode · no external transmission</small></article>)}</section>
            </>
          )}

          {data && module === "collections" && (
            <>
            <CollectionArenaWorkspace
              data={data}
              isSaving={isSaving}
              onOpenClaim={(claimId) => setArenaEditorClaimId(claimId)}
              onAction={async (name, payload) => {
                const result = await action(name, payload);
                if (!result) return null;
                if (name === "seedCollectionFixtures") setNotice("Collection test claims loaded: aged open, denied, secondary and patient balances are ready.");
                if (name === "setClaimFollowUp") setNotice(String(payload.followUpStatus) === "in_process" ? "Marked in process to pay." : "Marked denied. Rebill or bill the next party.");
                if (name === "rebillClaim") setNotice("Claim moved to Rebill and returned to Claim prep.");
                if (name === "billClaimParty") {
                  const party = String(payload.party || "");
                  setNotice(party === "patient" ? "Claim moved to Bill to Patient and returned to Claim prep." : party === "ter" ? "Claim moved to Bill to Ter and returned to Claim prep." : "Claim moved to Bill to Sec and returned to Claim prep.");
                }
                return result;
              }}
            />
            {arenaEditorClaimId && (() => {
              const selectedClaim = data.claims.find((row) => value(row, "id") === arenaEditorClaimId);
              if (!selectedClaim) return null;
              const selectedIssues = (claimIssues[arenaEditorClaimId] || (() => {
                try { return JSON.parse(value(selectedClaim, "scrubberMessages") || "[]") as DataRow[]; } catch { return []; }
              })()).filter(isActionableClaimIssue);
              const inquiryBase = `${workspaceBasePath(variant)}/claim-inquiry`.replace(/\/{2,}/g, "/") || "/claim-inquiry";
              const inquiryJoin = inquiryBase.includes("?") ? "&" : "?";
              return <ClaimCorrectionEditor
                claim={selectedClaim}
                data={data}
                inquiryHref={`${inquiryBase}${inquiryJoin}patient=${encodeURIComponent(value(selectedClaim, "patientId"))}&claim=${encodeURIComponent(arenaEditorClaimId)}`}
                isSaving={isSaving}
                issues={selectedIssues}
                initialBox=""
                mode="followup"
                workflowEvents={(data.claimWorkflowEvents || []).filter((row) => value(row, "claimId") === arenaEditorClaimId)}
                onCaptureCard={uploadInsuranceCardSide}
                onClose={() => setArenaEditorClaimId("")}
                onCreateCoverage={async (payload) => action("createPatientCoverage", payload)}
                onDownload={() => download837(arenaEditorClaimId)}
                onFollowUpAction={async (name, payload) => {
                  const result = await action(name, payload);
                  if (!result) return null;
                  if (name === "setClaimFollowUp") setNotice(String(payload.followUpStatus) === "in_process" ? "Marked in process to pay." : "Marked denied. Rebill or bill the next party.");
                  if (name === "rebillClaim") {
                    setNotice("Claim moved to Rebill and returned to Claim prep.");
                    setArenaEditorClaimId("");
                  }
                  if (name === "billClaimParty") {
                    const party = String(payload.party || "");
                    setNotice(party === "patient" ? "Claim moved to Bill to Patient and returned to Claim prep." : party === "ter" ? "Claim moved to Bill to Ter and returned to Claim prep." : "Claim moved to Bill to Sec and returned to Claim prep.");
                    setArenaEditorClaimId("");
                  }
                  return result;
                }}
                onPrint={async () => {
                  const printed = await markClaimPrinted(arenaEditorClaimId);
                  if (printed) window.setTimeout(() => window.print(), 80);
                }}
                onSave={async (payload, rescrub) => saveClaimCorrections({ ...payload, followUpSave: true }, rescrub)}
                onSubmit={() => submitClaim(arenaEditorClaimId)}
              />;
            })()}
            </>
          )}

          {data && module === "claim_inquiry" && (
            <ClaimsInquiryWorkspace
              claimPrepHref={`${workspaceBasePath(variant)}/claims`.replace(/\/{2,}/g, "/") || "/claims"}
              data={data}
              isSaving={isSaving}
              onAction={async (name, payload) => {
                const result = await action(name, payload);
                if (!result) return null;
                if (name === "rebillClaim") setNotice("Claim moved to Rebill and returned to Claim prep.");
                if (name === "billClaimParty") {
                  const party = String(payload.party || "");
                  setNotice(party === "patient" ? "Claim moved to Bill to Patient and returned to Claim prep." : party === "ter" ? "Claim moved to Bill to Ter and returned to Claim prep." : "Claim moved to Bill to Sec and returned to Claim prep.");
                }
                if (name === "voidClaim") setNotice("Claim voided.");
                if (name === "addClaimNote") setNotice("Note saved.");
                return result;
              }}
            />
          )}

          {data && module === "claims" && (
            <ClaimsWorkbench
              claimIssues={claimIssues}
              data={data}
              isSaving={isSaving}
              onCreateBatches={(ids) => void createPayerBatches(ids)}
              onDownload837={download837}
              onDownloadBatchFile={(id, kind) => void downloadBatchFile(id, kind)}
              onGenerate={(ids) => void generateClaims(ids)}
              onMarkMailed={markClaimMailed}
              onMarkPaperBatchMailed={(id) => void markPaperBatchMailed(id)}
              onMarkPrinted={markClaimPrinted}
              onSaveCorrections={saveClaimCorrections}
              onOpenClaim={(encounterId) => {
                const encounter = data.encounters.find((row) => value(row, "id") === encounterId);
                if (encounter) openClinicalEncounter(encounter, data.appointments.find((item) => value(item, "id") === value(encounter, "appointmentId")));
              }}
              onQueueReady={() => void queueReadyClaims()}
              onSeedSamples={() => void seedDemoWorkspaceSamples()}
              onScrub={(id) => void scrubClaim(id)}
              onScrubAll={(ids) => void scrubClaimsBatch(ids)}
              onSubmit={submitClaim}
              onSubmitBatch={submitClaimsBatch}
              onTransmitBatch={(id) => void transmitClaimBatch(id)}
              search={search}
              setSearch={setSearch}
            />
          )}

          {data && module === "payments" && (
            <PaymentPostingWorkbench
              data={data}
              isSaving={isSaving}
              onAutoPost={(id) => void autoPostPayment(id)}
              onCreateEntry={(remittance) => {
                if (!remittance) {
                  openForm();
                  return;
                }
                setFormMode("");
                setForm({
                  ...blankForm("payments"),
                  payerId: value(remittance, "payerId"),
                  remittanceId: value(remittance, "id"),
                  paymentMethod: "ERA",
                  paymentAmount: value(remittance, "amount") || "0.00",
                  referenceNumber: value(remittance, "traceNumber"),
                  paymentDate: value(remittance, "paymentDate") || new Date().toISOString().slice(0, 10),
                });
                setError("");
                setNotice("");
                setModalOpen(true);
              }}
              onFixLines={(id, lines, header) => fixPaymentClaims(id, lines, header)}
              onImportEra={() => openForm("era")}
              onManualPost={(payload) => manualPostClaimPayment(payload)}
              onPopulate={(id, claimIds) => populatePaymentClaims(id, claimIds)}
              onStartEra={(id) => startEra(id)}
              onSeedEraClaims={(id) => seedEraClaims(id)}
              onCreateEraDenialVariant={(id) => createEraDenialVariant(id)}
              onCreateEraZeroCheckVariant={(id) => createEraZeroCheckVariant(id)}
              onProcessEra={(id) => processEra(id)}
              onRecalculate={(id, header) => recalculatePayment(id, header)}
              search={search}
              setSearch={setSearch}
            />
          )}

          {data && module === "reports" && (
            <>
              <SummaryCards cards={[
                ["Gross charges", currency(data.transactions.filter((row) => value(row, "transactionType") === "charge").reduce((sum, row) => sum + Number(value(row, "amount")), 0)), "Ledger charge transactions"],
                ["Payments", currency(Math.abs(data.transactions.filter((row) => value(row, "transactionType").includes("payment")).reduce((sum, row) => sum + Number(value(row, "amount")), 0))), "Insurance and patient"],
                ["Adjustments", currency(Math.abs(data.transactions.filter((row) => value(row, "transactionType") === "adjustment").reduce((sum, row) => sum + Number(value(row, "amount")), 0))), "Contractual and other"],
                ["Ledger entries", String(data.transactions.length), "Auditable source records"],
              ]} />
              <div className="report-date-guide">{["Date of service", "Transaction date", "Payment date", "Posting date", "First billed date", "Last billed date"].map((item) => <span key={item}>{item}</span>)}</div>
              <TablePanel title="Complete transaction ledger" description="Every charge, payment, adjustment, refund and transfer with all reporting dates.">
                <table><thead><tr><th>Patient / claim</th><th>Transaction</th><th>Payment ID</th><th>Source</th><th>Amount</th><th>DOS</th><th>Transaction</th><th>Payment</th><th>Posting</th><th>First billed</th><th>Last billed</th></tr></thead><tbody>{data.transactions.map((row) => <tr key={value(row, "id")}><td><strong className="location-name">{value(row, "patientName")}</strong><small className="address">{value(row, "claimNumber") || "No claim"}</small></td><td><strong className="location-name">{value(row, "transactionType").replaceAll("_", " ")}</strong><small className="address">{value(row, "description")}</small></td><td>{value(row, "paymentEntryId") ? <Link href={`${workspaceBasePath(variant)}/payments?paymentId=${encodeURIComponent(value(row, "paymentEntryId"))}`}>{value(row, "paymentNumber") || value(row, "paymentEntryId")}</Link> : "—"}</td><td>{value(row, "source")}</td><td className={Number(value(row, "amount")) < 0 ? "amount-credit" : "amount-charge"}>{currency(value(row, "amount"))}</td><td>{shortDate(value(row, "dateOfService"))}</td><td>{shortDate(value(row, "transactionDate"))}</td><td>{shortDate(value(row, "paymentDate"))}</td><td>{shortDate(value(row, "postingDate"))}</td><td>{shortDate(value(row, "firstBilledDate"))}</td><td>{shortDate(value(row, "lastBilledDate"))}</td></tr>)}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "payers" && (
            <>
              <SummaryCards cards={[["Payers", String(data.payers.length), "Electronic and paper destinations"], ["Plans", String(data.plans.length), "Configured benefit products"], ["Eligibility routes", String(data.payers.filter((row) => value(row, "eligibilityPayerId")).length), "270/271 identifiers"], ["Clearinghouse routes", String(data.payers.filter((row) => value(row, "clearinghouseRoute")).length), "837/835 connections"]]} />
              <TablePanel title="Payers" description="Carrier routing and how long to wait for a remittance before follow-up."><table><thead><tr><th>Payer</th><th>Claim payer ID</th><th>Response days</th><th>Eligibility ID</th><th>Filing indicator</th><th>Clearinghouse</th><th>Status</th><th></th></tr></thead><tbody>{data.payers.map((row) => <tr key={value(row, "id")}><td><strong>{value(row, "name")}</strong></td><td className="mono">{value(row, "payerId")}</td><td>{value(row, "responseDays") || "12"} days</td><td className="mono">{value(row, "eligibilityPayerId")}</td><td>{value(row, "claimFilingIndicator")}</td><td>{value(row, "clearinghouseRoute") || "File mode"}</td><td><Status value={value(row, "status")} /></td><td><button onClick={() => { setFormMode(""); setForm({ id: value(row, "id"), name: value(row, "name"), payerId: value(row, "payerId"), eligibilityPayerId: value(row, "eligibilityPayerId"), claimFilingIndicator: value(row, "claimFilingIndicator"), payerType: value(row, "payerType"), clearinghouseRoute: value(row, "clearinghouseRoute"), phone: value(row, "phone"), fax: value(row, "fax"), responseDays: value(row, "responseDays") || "12" }); setError(""); setNotice(""); setModalOpen(true); }} type="button">Edit</button></td></tr>)}</tbody></table></TablePanel>
              <TablePanel title="Insurance plans" description="Coverage rules and timely filing."><table><thead><tr><th>Plan</th><th>Payer</th><th>Type</th><th>Group</th><th>Timely filing</th><th>Referral</th><th>Authorization</th></tr></thead><tbody>{data.plans.map((row) => { const payer = data.payers.find((item) => value(item, "id") === value(row, "payerId")); return <tr key={value(row, "id")}><td><strong>{value(row, "name")}</strong></td><td>{value(payer || {}, "name")}</td><td>{value(row, "planType")}</td><td>{value(row, "defaultGroupNumber") || "Varies"}</td><td>{value(row, "timelyFilingDays")} days</td><td><Status value={value(row, "requiresReferral")} /></td><td><Status value={value(row, "requiresAuthorization")} /></td></tr>; })}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "fees" && (
            <>
              <SummaryCards cards={[["Fee schedules", String(data.feeSchedules.length), "Active contract tables"], ["Contracted codes", String(data.feeScheduleItems.length), "Allowed amount entries"], ["Payers represented", String(new Set(data.feeSchedules.map((row) => value(row, "payerId"))).size), "Contract coverage"], ["Effective controls", "Enabled", "Date-based fee selection"]]} />
              <TablePanel title="Contracted fee schedules" description="Payer allowed amounts used by payment variance analysis."><table><thead><tr><th>Schedule</th><th>Payer</th><th>Effective</th><th>Procedure</th><th>Allowed</th><th>Status</th></tr></thead><tbody>{data.feeSchedules.flatMap((row) => {
                const payer = data.payers.find((item) => value(item, "id") === value(row, "payerId"));
                const items = data.feeScheduleItems.filter((entry) => value(entry, "feeScheduleId") === value(row, "id"));
                return (items.length ? items : [{} as DataRow]).map((item) => {
                  const procedure = data.procedureCodes.find((entry) => value(entry, "id") === value(item, "procedureCodeId"));
                  return <tr key={`${value(row, "id")}-${value(item, "id") || "empty"}`}><td><strong>{value(row, "name")}</strong></td><td>{value(payer || {}, "name") || "Standard"}</td><td>{shortDate(value(row, "effectiveDate"))}</td><td><CodeList codes={procedure ? [value(procedure, "code")] : []} /></td><td>{currency(value(item, "allowedAmount"))}</td><td><Status value={value(row, "status")} /></td></tr>;
                });
              })}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "procedures" && (
            <>
              <SummaryCards cards={[["Active codes", String(data.procedureCodes.length), "CPT and HCPCS"], ["RPM master codes", String(RPM_CODE_MASTER.length), "2026 Medicare reference set"], ["Custom practice charges", String(data.procedureCodes.filter((row) => RPM_CODE_MASTER.some((rpm) => rpm.code === value(row, "code")) && Number(value(row, "defaultCharge")) > 0).length), "RPM charge amounts configured"], ["Claim mapping", "24D", "CMS-1500 / 837P service lines"]]} />
              <div className="rpm-fee-notice"><strong>Medicare reference ≠ practice charge.</strong> The Medicare column is a 2026 national-average non-facility reference from the linked source. Actual MPFS reimbursement varies by locality and other factors; each practice charge is separate and must be set by your billing administrator. <a href={RPM_MEDICARE_REFERENCE.source} rel="noreferrer" target="_blank">Source</a></div>
              <TablePanel title="Procedure & RPM charge master" description="RPM codes are seeded into the service-code master and can be used on claim lines. Edit each practice charge; payer allowed amounts remain in fee schedules."><table><thead><tr><th>Code</th><th>Description</th><th>Set</th><th>Medicare reference allowed</th><th>Practice charge</th><th>POS</th><th>Authorization</th><th>Status</th><th /></tr></thead><tbody>{data.procedureCodes.map((row) => { const rpm = RPM_CODE_MASTER.find((item) => item.code === value(row, "code")); const masterItem = data.feeScheduleItems.find((item) => value(item, "feeScheduleId") === RPM_MEDICARE_REFERENCE.scheduleId && value(item, "procedureCodeId") === value(row, "id")); return <tr key={value(row, "id")}><td><CodeList codes={[value(row, "code")]} />{rpm && <small className="rpm-code-badge">RPM</small>}</td><td>{value(row, "description")}</td><td>{value(row, "codeSet")}</td><td>{rpm ? currency(value(masterItem || {}, "allowedAmount") || rpm.medicareReferenceFee) : "—"}</td><td>{currency(value(row, "defaultCharge"))}{rpm && Number(value(row, "defaultCharge")) <= 0 && <small className="address">Set practice charge</small>}</td><td>{value(row, "defaultPlaceOfService")}</td><td><Status value={value(row, "requiresAuthorization")} /></td><td><Status value={value(row, "status")} /></td><td><button className="table-button" onClick={() => { setFormMode("edit-procedure"); setForm({ id: value(row, "id"), code: value(row, "code"), description: value(row, "description"), codeSet: value(row, "codeSet"), defaultCharge: value(row, "defaultCharge"), defaultPlaceOfService: value(row, "defaultPlaceOfService"), requiresAuthorization: value(row, "requiresAuthorization") === "yes" }); setError(""); setNotice(""); setModalOpen(true); }} type="button">Edit</button></td></tr>; })}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "integrations" && (
            <>
              <div className="integration-warning"><strong>Safe local mode</strong><p>No PHI is transmitted externally. Switch to live only after credentials, BAAs, endpoint testing and production approval.</p></div>
              <section className="integration-grid">{data.integrations.map((row) => <article key={value(row, "id")}><div className="integration-icon">{value(row, "integrationType").includes("era") ? "835" : value(row, "integrationType").includes("eligibility") ? "271" : "837"}</div><div><span className="eyebrow">{value(row, "integrationType").replaceAll("_", " ")}</span><h2>{value(row, "vendorName")}</h2><p>Mode: {value(row, "mode")} · Endpoint: {value(row, "endpoint") || "Not configured"}</p><p>Inbound source: {value(row, "sourceSystem") || "Not routed"}</p>{((row.missingCredentials || []) as string[]).length > 0 && <p className="integration-missing">Missing for live: {((row.missingCredentials || []) as string[]).join(", ")}</p>}{value(row, "lastTestStatus") && <p className={`integration-test ${value(row, "lastTestStatus")}`}>Last test: {value(row, "lastTestStatus")} · {value(row, "lastTestMessage")}</p>}</div><Status value={value(row, "status")} /><div className="integration-actions"><button className="secondary-button" onClick={() => openIntegration(row)} type="button">Configure</button><button className="secondary-button" disabled={isSaving} onClick={() => void testIntegrationConnection(value(row, "id"))} type="button">Test connection</button></div></article>)}</section>
              <section className="integration-grid secondary-integrations"><article><div className="integration-icon">FAX</div><div><span className="eyebrow">Document delivery</span><h2>Fax adapter</h2><p>Credential required for live delivery; PDF packages are generated locally.</p></div><Status value="needs_credentials" /></article><article><div className="integration-icon">@</div><div><span className="eyebrow">Secure email</span><h2>Email adapter</h2><p>Credential and secure-delivery policy required before activation.</p></div><Status value="needs_credentials" /></article></section>
            </>
          )}
        </section>
      </main>

      {isModalOpen && data && (
        <div className={`modal-backdrop ${module === "clinical" && formMode === "encounter" ? "clinical-focus-backdrop" : ""}`} role="presentation">
          <section aria-labelledby="operations-modal-title" aria-modal="true" className={`modal provider-modal ${module === "patients" || formMode === "quick-patient" ? "patient-modal" : ""} ${module === "payments" ? "payment-modal" : ""} ${module === "clinical" && ["encounter", "vitals"].includes(formMode) ? "clinical-modal" : ""} ${module === "clinical" && formMode === "encounter" ? "clinical-focus-workspace" : ""}`} role="dialog">
            <div className={`modal-header ${module === "clinical" && formMode === "encounter" ? "clinical-encounter-header" : ""}`}><div className="modal-title-block"><span className="eyebrow">{meta.eyebrow}</span><h2 id="operations-modal-title">{modalTitle(module, formMode)}</h2>{module === "clinical" && formMode === "encounter-pick" ? <p>Search the patient chart, then open today’s visit workspace.</p> : !(module === "clinical" && formMode === "encounter") && module !== "payments" && <p>Required fields are marked. Claim-related fields include CMS-1500 guidance.</p>}{module === "payments" && <p>Compact entry for check, EFT, ERA, or paper EOB.</p>}</div>{module === "clinical" && formMode === "encounter" && <ClinicalEncounterHeaderContext data={data} form={form} update={updateField} />}<button aria-label={module === "clinical" && formMode === "encounter" ? "Close encounter and return" : "Close dialog"} className="close-button" onClick={() => void closeModal()} title={module === "clinical" && formMode === "encounter" ? "Close encounter and return" : undefined} type="button">×</button></div>
            <form onSubmit={submitForm}>
              {module === "patients" && (formMode === "documents" ? <PatientDocumentsForm data={data} form={form} update={updateField} /> : formMode === "eligibility-review" ? <EligibilityReviewForm review={eligibilityReview} form={form} update={updateField} /> : formMode === "responsibility" ? <ResponsibilityForm data={data} form={form} update={updateField} /> : formMode === "close-responsibility" ? <CloseResponsibilityForm form={form} update={updateField} /> : formMode === "coverage-order" ? <CoverageOrderForm data={data} form={form} update={updateField} /> : formMode === "coverage" ? <CoverageForm data={data} form={form} update={updateField} /> : <PatientForm cardSaving={isSaving} data={data} form={form} initialTab={patientInitialTab} onCardCapture={uploadInsuranceCardSide} onCardUpload={(patientId, coverageId) => openDocuments(patientId, coverageId, "insurance")} onDocumentUpload={(patientId) => openDocuments(patientId, "", "documents")} onPhotoUpload={uploadPatientPhoto} photoSaving={isSaving} update={updateField} />)}
              {module === "scheduler" && (formMode === "quick-patient" ? <PatientForm data={data} form={form} onPhotoUpload={uploadPatientPhoto} photoSaving={isSaving} update={updateField} /> : <AppointmentForm data={data} form={form} onAddPatient={addPatientFromAppointment} update={updateField} reschedule={formMode === "reschedule"} />)}
              {module === "eligibility" && <EligibilityForm data={data} form={form} update={updateField} />}
              {module === "clinical" && (formMode === "encounter-pick" ? <NewEncounterPatientPicker data={data} isSaving={isSaving} onPick={(patientId) => void startEncounterForPatient(patientId)} /> : formMode === "vitals" ? <VitalsIntakeForm form={form} update={updateField} /> : formMode === "order-result" ? <ClinicalResultForm form={form} update={updateField} /> : formMode === "medication" ? <MedicationForm data={data} form={form} update={updateField} /> : <EncounterForm data={data} form={form} isSaving={isSaving} onAutosaveDraft={autosaveEncounterDraft} onCompletionNavChange={setCompletionNav} onDocumentationNavChange={setDocumentationNav} onRefresh={loadData} onPatientAllergiesChange={(patientId, allergies) => {
                setData((current) => current ? {
                  ...current,
                  patientAllergies: [
                    ...current.patientAllergies.filter((row) => value(row, "patientId") !== patientId),
                    ...allergies,
                  ],
                } : current);
              }} onReadyToBill={async () => {
                const result = await action("saveEncounter", { ...form, intent: "ready_to_bill" });
                if (!result) return;
                if (clinicalReturnTo) {
                  window.location.assign(clinicalReturnTo);
                  return;
                }
                setDocumentationNav(null);
                setCompletionNav(null);
                setModalOpen(false);
                setNotice(result.queuedClaim
                  ? `Encounter ready to bill and queued as ${(result.queuedClaim as DataRow).claimNumber || ""}. Open Claim prep to scrub.`.trim()
                  : "Encounter signed and marked ready for billing.");
                setError("");
              }} onSaveOrders={async () => {
                const result = await action("saveEncounter", { ...form, intent: "draft" });
                if (result) {
                  setForm((current) => ({ ...current, status: "draft" }));
                  setNotice("Orders and referrals saved to this visit.");
                  setError("");
                }
              }} onSign={async () => {
                const result = await action("saveEncounter", { ...form, intent: "sign" });
                if (result) {
                  setForm((current) => ({ ...current, status: "signed" }));
                  setNotice("Encounter signed. Confirm charges, then mark ready to bill.");
                  setError("");
                }
              }} saveNotice={notice} update={updateField} />)}
              {module === "claims" && <ClaimForm data={data} form={form} update={updateField} />}
              {module === "payments" && (formMode === "era" ? <EraForm data={data} form={form} update={updateField} /> : <PaymentEntryForm data={data} form={form} update={updateField} />)}
              {module === "payers" && (formMode === "plan" ? <PlanForm data={data} form={form} update={updateField} /> : <PayerForm form={form} update={updateField} />)}
              {module === "fees" && <FeeForm data={data} form={form} update={updateField} />}
              {module === "procedures" && <ProcedureForm form={form} update={updateField} editing={formMode === "edit-procedure"} />}
              {module === "integrations" && <IntegrationForm data={data} form={form} update={updateField} />}
              {error && <div className="notice error form-error">{error}</div>}
              <div className="modal-footer">
                {module === "clinical" && formMode === "encounter" && (autosaveState !== "idle" || notice) && (
                  <span aria-live="polite" className={`encounter-save-state ${autosaveState === "error" ? "is-error" : ""}`}>
                    {autosaveState === "saving" ? "Saving draft…" : autosaveState === "saved" ? "✓ Draft saved" : autosaveState === "error" ? "Autosave failed — tap Save draft" : `✓ ${notice}`}
                  </span>
                )}
                {module === "clinical" && formMode === "encounter" && documentationNav && (
                  <button className="primary-button documentation-next-button" onClick={documentationNav.onNext} type="button">
                    {documentationNav.label}
                  </button>
                )}
                <button className="secondary-button" onClick={() => void closeModal()} type="button">{module === "clinical" && formMode === "encounter" ? "Close encounter" : module === "payments" && form.savedPaymentNumber ? "Done" : "Cancel"}</button>
                {module === "payments" && formMode !== "era" && !form.savedPaymentNumber && <button className="secondary-button" type="submit" data-payment-intent="apply" disabled={isSaving}>Save &amp; Apply</button>}
                {module === "payments" && form.savedPaymentId && <a className="primary-button" href={`/payments?paymentId=${encodeURIComponent(String(form.savedPaymentId))}`}>Apply to claims</a>}
                {module === "patients" && ["", "edit-patient"].includes(formMode) && <button className="secondary-button schedule-after-save" disabled={isSaving} name="submitIntent" type="submit" value="schedule">Save & schedule</button>}
                {module === "clinical" && formMode === "encounter-pick" ? null : module === "clinical" && formMode === "encounter" ? <>
                  <button className="secondary-button" disabled={isSaving} name="submitIntent" type="submit" value="draft">Save draft</button>
                  {completionNav && (
                    <button className={`secondary-button ${completionNav.reviewed ? "is-complete" : ""}`} disabled={completionNav.reviewed} onClick={completionNav.markReviewed} type="button">
                      {completionNav.reviewed ? "Reviewed ✓" : "Mark reviewed"}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={isSaving || (completionNav ? (!completionNav.reviewed || completionNav.signed) : false)}
                    name="submitIntent"
                    type="submit"
                    value="sign"
                  >
                    {isSaving ? "Signing…" : completionNav?.signed ? "Signed ✓" : "Sign"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={isSaving || (completionNav ? (!completionNav.signed || completionNav.readyToBill) : false)}
                    name="submitIntent"
                    type="submit"
                    value="ready_to_bill"
                  >
                    {isSaving ? "Saving…" : completionNav?.readyToBill ? "Ready to bill ✓" : "Ready to bill"}
                  </button>
                </> : formMode !== "encounter-pick" ? <button className="primary-button" disabled={isSaving || (module === "payments" && Boolean(form.savedPaymentNumber))} type="submit">{module === "payments" && form.savedPaymentNumber ? "Payment saved" : isSaving ? (formMode === "documents" ? "Uploading…" : "Saving…") : formMode === "vitals" ? "Save vitals & mark ready" : formMode === "order-result" ? "Save result" : formMode === "medication" ? "Add medication" : formMode === "quick-patient" ? "Save patient & continue booking" : formMode === "documents" ? "Upload documents" : formMode === "reschedule" ? "Save new time" : formMode === "eligibility-review" ? "Confirm & apply selected updates" : formMode === "responsibility" ? "Save DOS profile" : formMode === "close-responsibility" ? "Close responsibility period" : formMode === "coverage-order" ? "Save default order" : formMode === "coverage" ? "Save coverage" : formMode === "edit-patient" ? "Save changes" : module === "payments" ? "Save" : "Save and continue"}</button> : null}
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function ClaimsWorkbench({
  data, search, setSearch, claimIssues, isSaving,
  onScrub, onScrubAll, onSubmit, onDownload837, onQueueReady, onOpenClaim,
  onSaveCorrections, onSubmitBatch, onMarkPrinted, onMarkMailed, onGenerate,
  onCreateBatches, onTransmitBatch, onDownloadBatchFile, onMarkPaperBatchMailed,
  onSeedSamples,
}: {
  data: WorkspaceData;
  search: string;
  setSearch: (value: string) => void;
  claimIssues: Record<string, DataRow[]>;
  isSaving: boolean;
  onScrub: (id: string) => void;
  onScrubAll: (ids: string[]) => void;
  onSubmit: (id: string) => void;
  onSubmitBatch: (ids: string[]) => void;
  onDownload837: (id: string) => void;
  onGenerate: (ids: string[]) => void;
  onCreateBatches: (ids: string[]) => void;
  onTransmitBatch: (id: string) => void;
  onDownloadBatchFile: (id: string, kind: "edi" | "proof" | "ackTxt" | "ackPdf") => void;
  onMarkPaperBatchMailed: (id: string) => void;
  onMarkPrinted: (id: string) => Promise<boolean>;
  onMarkMailed: (id: string, mailMethod: string, trackingNumber: string) => Promise<boolean>;
  onSaveCorrections: (payload: Record<string, unknown>, rescrub: boolean) => Promise<Record<string, unknown> | null>;
  onQueueReady: () => void;
  onSeedSamples: () => void;
  onOpenClaim: (encounterId: string) => void;
}) {
  type ClaimBucket = "received" | "error" | "clean" | "edi_batches" | "paper_claims" | "submitted";
  const [bucket, setBucket] = useState<ClaimBucket>("received");
  const [editorClaimId, setEditorClaimId] = useState("");
  const [editorFocusBox, setEditorFocusBox] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mailClaimId, setMailClaimId] = useState("");
  const [mailMethod, setMailMethod] = useState("usps_first_class");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [claimTypeFilter, setClaimTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<"dos" | "charge" | "claim">("dos");
  const query = search.trim().toLowerCase();
  const ehrClaims = data.claims.filter((row) => isEhrSourcedClaim({ id: value(row, "id"), encounterId: value(row, "encounterId") }));
  const batches = data.claimBatches || [];
  const claimedEncounterIds = new Set(ehrClaims.map((row) => value(row, "encounterId")).filter(Boolean));
  const missingReadyEncounters = data.encounters.filter((row) => value(row, "status") === "ready_to_bill" && !claimedEncounterIds.has(value(row, "id")));
  const workflowEvents = data.claimWorkflowEvents || [];

  const deliveryFor = (row: DataRow): ClaimDeliveryChannel => {
    if (value(row, "submissionMethod") === "paper" || value(row, "claimFormat") === "CMS-1500") return "paper";
    if (value(row, "submissionMethod") === "electronic" || value(row, "claimFormat") === "837P") return "electronic";
    return deliveryChannelFromPayer({ clearinghouseRoute: value(row, "payerClearinghouseRoute") });
  };

  const claimBucketFor = (row: DataRow): ClaimQueueBucket => claimQueueBucket({
    workflowStatus: value(row, "workflowStatus"),
    status: value(row, "status"),
    scrubberStatus: value(row, "scrubberStatus"),
    batchId: value(row, "batchId"),
  });

  const matchesFilters = (row: DataRow) => {
    if (payerFilter && value(row, "payerId") !== payerFilter) return false;
    if (providerFilter && value(row, "providerId") !== providerFilter) return false;
    if (facilityFilter && value(row, "facilityId") !== facilityFilter) return false;
    if (claimTypeFilter && deliveryFor(row) !== claimTypeFilter) return false;
    const dos = value(row, "dateOfService");
    if (dateFrom && dos < dateFrom) return false;
    if (dateTo && dos > dateTo) return false;
    if (!query) return true;
    return `${value(row, "claimNumber")} ${value(row, "patientName")} ${value(row, "payerName")} ${value(row, "payerClaimPayerId")}`.toLowerCase().includes(query);
  };

  const claimRows = ehrClaims
    .filter((row) => {
      const claimBucket = claimBucketFor(row);
      if (bucket === "received") return claimBucket === "received" && matchesFilters(row);
      if (bucket === "error") return claimBucket === "error" && matchesFilters(row);
      if (bucket === "clean") return claimBucket === "clean" && !value(row, "batchId") && matchesFilters(row);
      return false;
    })
    .sort((left, right) => {
      if (sortKey === "charge") return Number(value(right, "totalCharge")) - Number(value(left, "totalCharge"));
      if (sortKey === "claim") return value(left, "claimNumber").localeCompare(value(right, "claimNumber"));
      return value(right, "dateOfService").localeCompare(value(left, "dateOfService"));
    });

  const batchMatches = (row: DataRow) => {
    if (payerFilter && value(row, "payerId") !== payerFilter) return false;
    if (!query) return true;
    return `${value(row, "batchNumber")} ${value(row, "payerName")} ${value(row, "payerClaimPayerId")} ${value(row, "ediFileName")}`.toLowerCase().includes(query);
  };
  const ediBatches = batches.filter((row) => value(row, "batchType") === "edi" && ["pending", "generated", "failed"].includes(value(row, "status")) && batchMatches(row));
  const paperBatches = batches.filter((row) => value(row, "batchType") === "paper" && ["pending", "generated", "failed"].includes(value(row, "status")) && batchMatches(row));
  const submittedBatches = batches.filter((row) => ["sent", "accepted"].includes(value(row, "status")) && batchMatches(row));

  const counts = {
    received: ehrClaims.filter((row) => claimBucketFor(row) === "received").length,
    error: ehrClaims.filter((row) => claimBucketFor(row) === "error").length,
    clean: ehrClaims.filter((row) => claimBucketFor(row) === "clean" && !value(row, "batchId")).length,
    edi_batches: batches.filter((row) => value(row, "batchType") === "edi" && ["pending", "generated", "failed"].includes(value(row, "status"))).length,
    paper_claims: batches.filter((row) => value(row, "batchType") === "paper" && ["pending", "generated", "failed"].includes(value(row, "status"))).length,
    submitted: batches.filter((row) => ["sent", "accepted"].includes(value(row, "status"))).length,
  };
  const scrubIds = claimRows.filter((row) => ["received", "error"].includes(claimBucketFor(row))).map((row) => value(row, "id"));
  const readyIds = claimRows.map((row) => value(row, "id"));
  const selectedReadyIds = readyIds.filter((id) => selectedIds.has(id));
  const batchPreviewRows = claimRows.filter((row) => !selectedReadyIds.length || selectedIds.has(value(row, "id")));
  const batchPreviewGroups = Array.from(batchPreviewRows.reduce((groups, row) => {
    const payerId = value(row, "payerClaimPayerId") || "SELF_PAY";
    const delivery = deliveryFor(row);
    const key = `${payerId}::${delivery}`;
    const current = groups.get(key) || {
      payerId,
      payerName: value(row, "payerName") || "Self pay",
      delivery,
      count: 0,
      charge: 0,
    };
    current.count += 1;
    current.charge += Number(value(row, "totalCharge")) || 0;
    groups.set(key, current);
    return groups;
  }, new Map<string, { payerId: string; payerName: string; delivery: ClaimDeliveryChannel; count: number; charge: number }>() ).values());
  const showClaimTable = bucket === "received" || bucket === "error" || bucket === "clean";
  const showCheckbox = bucket === "clean";
  const openEditor = (claimId: string, box = "") => {
    setEditorFocusBox(box);
    setEditorClaimId(claimId);
  };
  const toggleSelected = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderBatchTable = (rows: DataRow[], mode: "edi" | "paper" | "submitted") => (
    <TablePanel
      description={mode === "submitted"
        ? "Batch-level transmission history only. Individual claim lines are not shown here."
        : mode === "edi"
          ? "Payer EDI batches with 837 files and proof text ready for clearinghouse transmission."
          : "Paper payer batches with CMS-1500 proof files. Print and mark mailed when sent."}
      search={search}
      setSearch={setSearch}
      title={mode === "submitted" ? "Submitted batches" : mode === "edi" ? "EDI batches" : "Paper claim batches"}
    >
      <table>
        <thead>
          <tr>
            <th>Batch ID</th><th>Payer</th><th>Claims</th><th>Charge</th><th>Status</th>
            <th>{mode === "paper" ? "Proof file" : "EDI file"}</th>
            <th>Proof</th>
            {mode === "submitted" && <th>Acknowledgment</th>}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => {
            const batchId = value(row, "id");
            return (
              <tr key={batchId}>
                <td><strong className="mono">{value(row, "batchNumber")}</strong><small className="address">{shortDate(value(row, "createdAt"), true)} · {value(row, "createdByName")}</small></td>
                <td><strong>{value(row, "payerName") || "Self pay"}</strong><small className="address">ID {value(row, "payerClaimPayerId") || "—"}</small></td>
                <td>{value(row, "claimCount")}</td>
                <td>{currency(value(row, "totalCharge"))}</td>
                <td><Status value={value(row, "status")} /></td>
                <td className="mono">{mode === "paper" ? (value(row, "proofFileName") || "—") : (value(row, "ediFileName") || "—")}</td>
                <td className="mono">{value(row, "proofFileName") || "—"}</td>
                {mode === "submitted" && <td><strong className="mono">ACK-{value(row, "batchNumber")}</strong><small className="address">{value(row, "clearinghouseResponse") || "—"}</small></td>}
                <td>
                  <div className="row-actions">
                    {mode === "edi" && value(row, "ediFileName") && <button onClick={() => onDownloadBatchFile(batchId, "edi")} type="button">Download EDI</button>}
                    {value(row, "proofFileName") && <button onClick={() => onDownloadBatchFile(batchId, "proof")} type="button">Download proof</button>}
                    {mode === "submitted" && value(row, "clearinghouseResponse") && <><button onClick={() => onDownloadBatchFile(batchId, "ackTxt")} type="button">Ack TXT</button><button onClick={() => onDownloadBatchFile(batchId, "ackPdf")} type="button">Ack PDF</button></>}
                    {mode === "edi" && <button className="primary-button" disabled={isSaving} onClick={() => onTransmitBatch(batchId)} type="button">Transmit</button>}
                    {mode === "paper" && <button className="primary-button" disabled={isSaving} onClick={() => onMarkPaperBatchMailed(batchId)} type="button">Mark mailed</button>}
                  </div>
                </td>
              </tr>
            );
          }) : <tr><td colSpan={mode === "submitted" ? 9 : 8}>No batches in this view.</td></tr>}
        </tbody>
      </table>
    </TablePanel>
  );

  return (
    <>
      <SummaryCards cards={[
        ["Received", String(counts.received), "Arrived, not yet scrubbed"],
        ["Errors", String(counts.error), "Fix then re-scrub"],
        ["Clean", String(counts.clean), "Passed scrub — ready to batch"],
        ["EDI batches", String(counts.edi_batches), "Transmit 837 files"],
        ["Paper claims", String(counts.paper_claims), "Print CMS-1500 batches"],
        ["Submitted", String(counts.submitted), "Batch history only"],
      ]} />
      <section className="claims-bucket-toolbar">
        <nav aria-label="Claim preparation workflow" className="claims-bucket-tabs">
          {([
            ["received", "Received", counts.received],
            ["error", "Errors", counts.error],
            ["clean", "Clean", counts.clean],
            ["edi_batches", "EDI batches", counts.edi_batches],
            ["paper_claims", "Paper claims", counts.paper_claims],
            ["submitted", "Submitted", counts.submitted],
          ] as const).map(([key, label, count]) => (
            <button aria-pressed={bucket === key} className={bucket === key ? "active" : ""} key={key} onClick={() => { setBucket(key); setSelectedIds(new Set()); }} type="button">
              <strong>{label}</strong><b>{count}</b>
            </button>
          ))}
        </nav>
        <div className="claims-bucket-actions">
          <button className="secondary-button" disabled={isSaving} onClick={onSeedSamples} type="button">Load sample data</button>
          <button className="secondary-button" disabled={isSaving} onClick={onQueueReady} type="button">Queue from EHR</button>
          {(bucket === "received" || bucket === "error") && (
            <button className="primary-button" disabled={isSaving || !scrubIds.length} onClick={() => onScrubAll(scrubIds)} type="button">
              {isSaving ? "Scrubbing…" : `Scrub all ${scrubIds.length || ""}`.trim()}
            </button>
          )}
          {bucket === "clean" && (
            <button
              className="primary-button"
              disabled={isSaving || !readyIds.length}
              onClick={() => onCreateBatches(selectedReadyIds.length ? selectedReadyIds : readyIds)}
              type="button"
            >
              {selectedReadyIds.length
                ? `Create payer batches (${selectedReadyIds.length})`
                : `Create payer batches (${readyIds.length})`}
            </button>
          )}
        </div>
      </section>

      <section className="claims-filter-bar">
        <label><span>Payer</span><select onChange={(event) => setPayerFilter(event.target.value)} value={payerFilter}><option value="">All payers</option>{data.payers.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")} · {value(row, "payerId")}</option>)}</select></label>
        {showClaimTable && <>
          <label><span>Provider</span><select onChange={(event) => setProviderFilter(event.target.value)} value={providerFilter}><option value="">All providers</option>{data.providers.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "firstName")} {value(row, "lastName")}</option>)}</select></label>
          <label><span>Facility</span><select onChange={(event) => setFacilityFilter(event.target.value)} value={facilityFilter}><option value="">All facilities</option>{data.facilities.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label>
          <label><span>Delivery</span><select onChange={(event) => setClaimTypeFilter(event.target.value)} value={claimTypeFilter}><option value="">Electronic & paper</option><option value="electronic">Electronic</option><option value="paper">Paper</option></select></label>
          <label><span>DOS from</span><input onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label>
          <label><span>DOS to</span><input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label>
          <label><span>Sort</span><select onChange={(event) => setSortKey(event.target.value as "dos" | "charge" | "claim")} value={sortKey}><option value="dos">Date of service</option><option value="charge">Charge</option><option value="claim">Claim ID</option></select></label>
        </>}
      </section>

      {bucket === "received" && missingReadyEncounters.length > 0 && (
        <TablePanel title="Signed visits waiting to queue" description="These encounters are not claims yet. Queue from EHR to create a Received claim.">
          <table>
            <thead><tr><th>Patient</th><th>DOS</th><th>Provider</th><th>DX / CPT</th><th>Actions</th></tr></thead>
            <tbody>
              {missingReadyEncounters.map((row) => (
                <tr key={value(row, "id")}>
                  <td><strong>{value(row, "patientName")}</strong></td>
                  <td>{shortDate(value(row, "dateOfService"))}</td>
                  <td>{value(row, "providerName")}</td>
                  <td><CodeList codes={list(row.diagnosisCodes)} /> · <CodeList codes={list(row.procedureCodes)} /></td>
                  <td><div className="row-actions"><button disabled={isSaving} onClick={onQueueReady} type="button">Queue claim</button><button onClick={() => onOpenClaim(value(row, "id"))} type="button">Review note</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablePanel>
      )}

      {showClaimTable && (
        <>
        {bucket === "clean" && batchPreviewGroups.length > 0 && (
          <section className="batch-preview-panel">
            <div>
              <span className="eyebrow">Batch review</span>
              <h3>{selectedReadyIds.length ? "Selected claims will create these batches" : "Clean claims will create these payer batches"}</h3>
              <p>Claims are grouped by the payer ID and delivery channel. Creating a batch locks its claims for transmission review.</p>
            </div>
            <div className="batch-preview-grid">
              {batchPreviewGroups.map((group) => (
                <article key={`${group.payerId}-${group.delivery}`}>
                  <strong>{group.payerName}</strong>
                  <span className="mono">Payer ID {group.payerId}</span>
                  <span>{group.delivery === "electronic" ? "Electronic · 837P" : "Paper · CMS-1500"}</span>
                  <b>{group.count} claim{group.count === 1 ? "" : "s"} · {currency(group.charge.toFixed(2))}</b>
                </article>
              ))}
            </div>
          </section>
        )}
        <TablePanel
          description={bucket === "clean"
            ? "Passed scrub. Create payer batches to generate EDI or CMS-1500 files."
            : bucket === "error"
              ? "Blocking errors. Fix claim, then Save & re-scrub. A passing re-scrub moves the claim to Clean."
              : "Claims that reached PRACX and have not been scrubbed yet."}
          search={search}
          setSearch={setSearch}
          title={bucket === "clean" ? "Clean" : bucket === "error" ? "Errors" : "Received"}
        >
          <table>
            <thead>
              <tr>
                {showCheckbox && <th><input aria-label="Select all" checked={readyIds.length > 0 && selectedReadyIds.length === readyIds.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(readyIds) : new Set())} type="checkbox" /></th>}
                <th>Claim / patient</th><th>DOS</th><th>Payer ID</th><th>Delivery</th><th>Provider</th><th>Charge</th><th>Scrub</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claimRows.length ? claimRows.map((row) => {
                const claimId = value(row, "id");
                const delivery = deliveryFor(row);
                const issues = (claimIssues[claimId] || (() => {
                  try { return JSON.parse(value(row, "scrubberMessages") || "[]") as DataRow[]; } catch { return []; }
                })()).filter(isActionableClaimIssue);
                return (
                  <tr key={claimId}>
                    {showCheckbox && <td><input aria-label={`Select ${value(row, "claimNumber")}`} checked={selectedIds.has(claimId)} onChange={() => toggleSelected(claimId)} type="checkbox" /></td>}
                    <td><strong className="location-name">{value(row, "claimNumber")}</strong><small className="address">{value(row, "patientName")}</small></td>
                    <td>{shortDate(value(row, "dateOfService"))}</td>
                    <td><strong className="mono">{value(row, "payerClaimPayerId") || "—"}</strong><small className="address">{value(row, "payerName") || "Self pay"}</small></td>
                    <td><Status value={delivery} /><small className="claim-delivery-detail">{delivery === "electronic" ? (value(row, "payerClearinghouseRoute") || "Clearinghouse") : "CMS-1500 paper"}</small></td>
                    <td>{value(row, "providerName")}</td>
                    <td>{currency(value(row, "totalCharge"))}</td>
                    <td><Status value={value(row, "scrubResult") || value(row, "scrubberStatus")} /></td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => openEditor(claimId)} type="button">{bucket === "error" ? "Fix claim" : "Open claim"}</button>
                        {(bucket === "received" || bucket === "error") && <button disabled={isSaving} onClick={() => onScrub(claimId)} type="button">Scrub</button>}
                        {bucket === "clean" && <button disabled={isSaving} onClick={() => onCreateBatches([claimId])} type="button">Batch</button>}
                        {value(row, "encounterId") && <button onClick={() => onOpenClaim(value(row, "encounterId"))} type="button">Note</button>}
                      </div>
                      {issues.length > 0 && bucket === "error" && (
                        <div className="claim-inline-issues">
                          {issues.filter((issue) => value(issue, "severity") === "error" || value(issue, "blocking") === "true").slice(0, 3).map((issue, index) => (
                            <button className="claim-error-link" key={`${claimId}-e-${index}`} onClick={() => openEditor(claimId, value(issue, "box"))} type="button">
                              <strong>{scrubFindingLabel(issue)}</strong> {value(issue, "message")}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={showCheckbox ? 9 : 8}>No claims in this view.</td></tr>}
            </tbody>
          </table>
        </TablePanel>
        </>
      )}

      {bucket === "edi_batches" && renderBatchTable(ediBatches, "edi")}
      {bucket === "paper_claims" && renderBatchTable(paperBatches, "paper")}
      {bucket === "submitted" && renderBatchTable(submittedBatches, "submitted")}

      {bucket === "error" && Object.entries(claimIssues).filter(([claimId]) => claimRows.some((row) => value(row, "id") === claimId)).map(([claimId, rawIssues]) => {
        const issues = rawIssues.filter(isActionableClaimIssue);
        const claim = ehrClaims.find((row) => value(row, "id") === claimId) || {};
        return (
          <section className="scrubber-panel" key={claimId}>
            <div><span className="eyebrow">Scrub findings</span><h3>{value(claim, "claimNumber") || claimId}</h3></div>
            {issues.length ? issues.map((issue, index) => (
              <button className="scrubber-finding-button" key={`${claimId}-${index}`} onClick={() => openEditor(claimId, value(issue, "box"))} type="button">
                <Status value={value(issue, "blocking") === "false" ? "warning" : "error"} />
                <div>
                  <strong>{scrubFindingLabel(issue)} · {value(issue, "field")}</strong>
                  <p>{value(issue, "message")} {value(issue, "suggestion")}</p>
                </div>
              </button>
            )) : <p>No blocking issues found.</p>}
          </section>
        );
      })}

      {editorClaimId && (() => {
        const selectedClaim = ehrClaims.find((row) => value(row, "id") === editorClaimId) || data.claims.find((row) => value(row, "id") === editorClaimId);
        if (!selectedClaim) return null;
        const selectedIssues = (claimIssues[editorClaimId] || (() => {
          try { return JSON.parse(value(selectedClaim, "scrubberMessages") || "[]") as DataRow[]; } catch { return []; }
        })()).filter(isActionableClaimIssue);
        return <ClaimCorrectionEditor
          claim={selectedClaim}
          data={data}
          isSaving={isSaving}
          issues={selectedIssues}
          initialBox={editorFocusBox}
          workflowEvents={workflowEvents.filter((row) => value(row, "claimId") === editorClaimId)}
          onClose={() => { setEditorClaimId(""); setEditorFocusBox(""); }}
          onDownload={() => onDownload837(editorClaimId)}
          onPrint={async () => {
            const printed = await onMarkPrinted(editorClaimId);
            if (printed) window.setTimeout(() => window.print(), 80);
          }}
          onSave={async (payload, rescrub) => {
            const result = await onSaveCorrections(payload, rescrub);
            if (result && rescrub && result.status === "clean") {
              setEditorClaimId("");
              setEditorFocusBox("");
            }
            return result;
          }}
          onSubmit={() => onSubmit(editorClaimId)}
        />;
      })()}
      {mailClaimId && createPortal(<div className="claim-mail-backdrop" role="presentation"><form className="claim-mail-dialog" onSubmit={async (event) => { event.preventDefault(); if (await onMarkMailed(mailClaimId, mailMethod, trackingNumber)) setMailClaimId(""); }}><header><div><span className="eyebrow">Paper delivery</span><h3>Mark CMS-1500 mailed</h3></div><button aria-label="Close mailing dialog" onClick={() => setMailClaimId("")} type="button">×</button></header><label><span>Mail method</span><select onChange={(event) => setMailMethod(event.target.value)} value={mailMethod}><option value="usps_first_class">USPS First-Class</option><option value="usps_certified">USPS Certified Mail</option><option value="courier">Courier</option><option value="other">Other</option></select></label><label><span>Tracking number (optional)</span><input onChange={(event) => setTrackingNumber(event.target.value)} value={trackingNumber} /></label><footer><button className="secondary-button" onClick={() => setMailClaimId("")} type="button">Cancel</button><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving…" : "Confirm mailed"}</button></footer></form></div>, document.body)}
    </>
  );
}

function PaymentPostingWorkbench({
  data,
  isSaving,
  search,
  setSearch,
  onCreateEntry,
  onImportEra,
  onPopulate,
  onFixLines,
  onAutoPost,
  onManualPost,
  onStartEra,
  onSeedEraClaims,
  onCreateEraDenialVariant,
  onCreateEraZeroCheckVariant,
  onProcessEra,
  onRecalculate,
}: {
  data: WorkspaceData;
  isSaving: boolean;
  search: string;
  setSearch: (value: string) => void;
  onCreateEntry: (remittance?: DataRow) => void;
  onImportEra: () => void;
  onPopulate: (paymentId: string, claimIds?: string[]) => Promise<boolean>;
  onFixLines: (paymentId: string, lines: Array<Record<string, unknown>>, header?: Record<string, unknown>) => Promise<boolean>;
  onAutoPost: (paymentId: string) => void;
  onManualPost: (payload: Record<string, unknown>) => Promise<boolean>;
  onStartEra: (id: string) => Promise<boolean>;
  onSeedEraClaims: (id: string) => Promise<boolean>;
  onCreateEraDenialVariant: (id: string) => Promise<boolean>;
  onCreateEraZeroCheckVariant: (id: string) => Promise<boolean>;
  onProcessEra: (id: string) => Promise<boolean>;
  onRecalculate: (paymentId: string, header?: Record<string, unknown>) => Promise<boolean>;
}) {
  type Bucket = "pending" | "errors" | "submitted" | "era";
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [paymentLookup, setPaymentLookup] = useState("");
  const [paymentSort, setPaymentSort] = useState({ key: "createdAt", direction: "desc" as "asc" | "desc" });
  const [paymentLookupNotice, setPaymentLookupNotice] = useState("");
  const [paymentLinkHandled, setPaymentLinkHandled] = useState(false);
  const [selectedEraId, setSelectedEraId] = useState("");
  const [selectedEraClaimPaymentId, setSelectedEraClaimPaymentId] = useState("");
  const [eraExceptionFilter, setEraExceptionFilter] = useState<"all" | "unmatched" | "errors" | "denials">("all");
  const [selectedPaymentClaimId, setSelectedPaymentClaimId] = useState("");
  const [postingMonth, setPostingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [claimSearch, setClaimSearch] = useState("");
  const [claimDosFrom, setClaimDosFrom] = useState("");
  const [claimDosTo, setClaimDosTo] = useState("");
  const [lineDrafts, setLineDrafts] = useState<Record<string, Record<string, string>>>({});
  const [serviceLineDrafts, setServiceLineDrafts] = useState<Record<string, Record<string, string>>>({});
  const [eraClaimDrafts, setEraClaimDrafts] = useState<Record<string, string>>({});
  const [eraServiceDrafts, setEraServiceDrafts] = useState<Record<string, Record<string, string>>>({});
  const [headerDraft, setHeaderDraft] = useState<Record<string, string>>({});
  const query = search.trim().toLowerCase();
  const entries = data.paymentEntries || [];
  const claimPayments = data.claimPayments || [];
  const logs = data.paymentLogs || [];

  const matchesEntry = (row: DataRow) => {
    if (!query) return true;
    return `${value(row, "paymentNumber")} ${value(row, "payerName")} ${value(row, "referenceNumber")} ${value(row, "paymentMethod")}`.toLowerCase().includes(query);
  };

  const inPostingMonth = (row: DataRow) => !postingMonth || [value(row, "paymentDate"), value(row, "postingDate"), value(row, "receivedAt")].some((date) => date.startsWith(postingMonth));
  const pendingEntries = entries.filter((row) => inPostingMonth(row) && ["pending", "partially_posted"].includes(value(row, "paymentStatus")) && matchesEntry(row));
  const errorEntries = entries.filter((row) => inPostingMonth(row) && value(row, "paymentStatus") === "error" && matchesEntry(row));
  const submittedEntries = entries.filter((row) => inPostingMonth(row) && value(row, "paymentStatus") === "fully_posted" && matchesEntry(row));
  const counts = {
    pending: entries.filter((row) => inPostingMonth(row) && ["pending", "partially_posted"].includes(value(row, "paymentStatus"))).length,
    errors: entries.filter((row) => inPostingMonth(row) && value(row, "paymentStatus") === "error").length,
    submitted: entries.filter((row) => inPostingMonth(row) && value(row, "paymentStatus") === "fully_posted").length,
    era: data.remittances.filter((row) => inPostingMonth(row) && value(row, "status") !== "posted").length,
  };

  const selectedPayment = entries.find((row) => value(row, "id") === selectedPaymentId) || null;
  const isSelectedEraPayment = value(selectedPayment || {}, "paymentMethod").toUpperCase() === "ERA";
  const selectedEra = data.remittances.find((row) => value(row, "id") === selectedEraId) || null;
  const selectedEraPaymentId = selectedEra ? value(selectedEra, "paymentEntryId") : "";
  const allSelectedEraClaims = selectedEraPaymentId
    ? claimPayments.filter((row) => value(row, "paymentId") === selectedEraPaymentId)
    : [];
  const selectedEraClaims = allSelectedEraClaims;
  const selectedEraClaimPaymentIds = new Set(allSelectedEraClaims.map((row) => value(row, "id")));
  const selectedEraServiceLines = (data.claimPaymentServiceLines || []).filter((row) => selectedEraClaimPaymentIds.has(value(row, "claimPaymentId")));
  const selectedEraClaim = selectedEraClaims.find((row) => value(row, "id") === selectedEraClaimPaymentId) || null;
  const selectedEraClaimLines = selectedEraClaim ? selectedEraServiceLines.filter((row) => value(row, "claimPaymentId") === selectedEraClaimPaymentId) : [];
  const eraClaimValue = (field: string) => eraClaimDrafts[field] ?? value(selectedEraClaim || {}, field);
  const eraServiceValue = (row: DataRow, field: string) => eraServiceDrafts[value(row, "id")]?.[field] ?? value(row, field);
  const saveEraClaim = async () => {
    if (!selectedEraPaymentId || !selectedEraClaim) return;
    const line = { id: value(selectedEraClaim, "id"), allowedAmount: eraClaimValue("allowedAmount"), paidAmount: eraClaimValue("paidAmount"), adjustmentAmount: eraClaimValue("adjustmentAmount"), patientResponsibility: eraClaimValue("patientResponsibility"), denialCode: eraClaimValue("denialCode") };
    const serviceLines = selectedEraClaimLines.filter((row) => value(row, "postingStatus") !== "posted").map((row) => ({ id: value(row, "id"), allowedAmount: eraServiceValue(row, "allowedAmount"), paidAmount: eraServiceValue(row, "paidAmount"), adjustmentAmount: eraServiceValue(row, "adjustmentAmount"), patientResponsibility: eraServiceValue(row, "patientResponsibility"), denialCode: eraServiceValue(row, "denialCode"), eobPage: eraServiceValue(row, "eobPage"), nextAction: eraServiceValue(row, "nextAction") }));
    const mismatch = serviceLines.find((row) => Math.abs(moneyNumber(value(selectedEraClaimLines.find((source) => value(source, "id") === row.id) || {}, "chargeAmount")) - moneyNumber(row.paidAmount) - moneyNumber(row.adjustmentAmount) - moneyNumber(row.patientResponsibility)) > 0.01);
    if (mismatch) { setNotice(`CPT ${value(selectedEraClaimLines.find((source) => value(source, "id") === mismatch.id) || {}, "procedureCode")} is unbalanced: charge must equal paid + adjustment + responsibility.`); return; }
    if (await onFixLines(selectedEraPaymentId, [line], { serviceLines })) {
      setEraClaimDrafts({});
      setEraServiceDrafts({});
    }
  };
  const selectedEraUnmatched = useMemo(() => {
    try { return JSON.parse(value(selectedEra || {}, "unmatchedJson") || "[]") as Array<Record<string, unknown>>; } catch { return []; }
  }, [selectedEra]);
  const selectedEraPostedCount = allSelectedEraClaims.filter((row) => value(row, "postingStatus") === "posted").length;
  const selectedEraAllocatedPaid = allSelectedEraClaims.reduce((sum, row) => sum + moneyNumber(value(row, "paidAmount")), 0);
  const selectedEraExceptionRows = useMemo(() => {
    const unmatchedRows = selectedEraUnmatched.map((claim) => ({
      kind: "unmatched",
      claimNumber: String(claim.claimControlNumber || "—"),
      patientName: [claim.patientFirstName, claim.patientLastName].filter(Boolean).join(" ") || "—",
      dateOfService: String(claim.dateOfService || ""),
      paidAmount: String(claim.paidAmount || "0"),
      reason: String(claim.reason || "Claim not matched"),
      claimPaymentId: "",
    }));
    const claimRows = selectedEraClaims.flatMap((claim) => {
      const lines = selectedEraServiceLines.filter((line) => value(line, "claimPaymentId") === value(claim, "id"));
      const hasError = value(claim, "postingStatus") === "error" || value(claim, "errorMessage") || lines.some((line) => value(line, "postingStatus") === "error" || value(line, "errorMessage"));
      const hasDenial = Boolean(value(claim, "denialCode") || lines.some((line) => value(line, "denialCode")));
      if (!hasError && !hasDenial) return [];
      const kind = hasError ? "errors" : "denials";
      return [{ kind, claimNumber: value(claim, "claimNumber"), patientName: value(claim, "patientName") || "—", dateOfService: value(claim, "dateOfService"), paidAmount: value(claim, "paidAmount"), reason: value(claim, "errorMessage") || (hasDenial ? `Denial ${value(claim, "denialCode") || lines.find((line) => value(line, "denialCode"))?.denialCode}` : "Posting exception"), claimPaymentId: value(claim, "id") }];
    });
    return [...unmatchedRows, ...claimRows].filter((row) => eraExceptionFilter === "all" || row.kind === eraExceptionFilter);
  }, [eraExceptionFilter, selectedEraClaims, selectedEraServiceLines, selectedEraUnmatched]);
  const selectedEraBlockingRows = claimPayments.filter((row) => value(row, "paymentId") === selectedEraPaymentId && (
    value(row, "postingStatus") === "error" || value(row, "errorMessage") ||
    (data.claimPaymentServiceLines || []).some((line) => value(line, "claimPaymentId") === value(row, "id") && (value(line, "postingStatus") === "error" || value(line, "errorMessage")))
  ));
  const eraPayment = entries.find((row) => value(row, "id") === selectedEraPaymentId);
  const selectedEraAmountMatches = buildReconciliationSnapshot({ ...(eraPayment || {}), paymentMethod: "ERA", claimPayments: allSelectedEraClaims }).balanced;
  const selectedEraHasUnsavedChanges = Object.keys(eraClaimDrafts).length > 0 || Object.keys(eraServiceDrafts).length > 0;
  const selectedEraReadyToPost = Boolean(eraPayment) && allSelectedEraClaims.length > 0 && !selectedEraHasUnsavedChanges && !eraMappingError(value(selectedEra || {}, "unmatchedJson")) && selectedEraUnmatched.length === 0 && selectedEraBlockingRows.length === 0 && selectedEraAmountMatches;
  const selectedLines = claimPayments.filter((row) => value(row, "paymentId") === selectedPaymentId);
  const selectedServiceLines = (data.claimPaymentServiceLines || []).filter((row) => value(row, "paymentId") === selectedPaymentId);
  const selectedPaymentClaim = selectedLines.find((row) => value(row, "id") === selectedPaymentClaimId) || null;
  const selectedPaymentClaimLines = selectedPaymentClaim ? selectedServiceLines.filter((row) => value(row, "claimPaymentId") === value(selectedPaymentClaim, "id")) : [];
  const selectedLogs = logs.filter((row) => value(row, "paymentId") === selectedPaymentId).slice(0, 40);
  const headerValue = (field: string) => headerDraft[field] ?? value(selectedPayment || {}, field);
  const effectiveTotal = calculatePaymentTotalEffective({
    paymentAmount: headerValue("paymentAmount"),
    offsetAmount: headerValue("offsetAmount"),
    refundAmount: headerValue("refundAmount"),
    incentiveAmount: headerValue("incentiveAmount"),
    otherAdjustments: headerValue("otherAdjustments"),
  });
  const totalClaimsPosted = selectedLines.reduce((sum, row) => {
    const draft = lineDrafts[value(row, "id")];
    return sum
      + moneyNumber(draft?.paidAmount ?? value(row, "paidAmount"))
      + (value(selectedPayment || {}, "paymentMethod") === "ERA" ? 0 : moneyNumber(draft?.adjustmentAmount ?? value(row, "adjustmentAmount")));
  }, 0);
  const reconciliation = buildReconciliationSnapshot({
    paymentAmount: headerValue("paymentAmount"),
    offsetAmount: headerValue("offsetAmount"),
    refundAmount: headerValue("refundAmount"),
    incentiveAmount: headerValue("incentiveAmount"),
    otherAdjustments: headerValue("otherAdjustments"),
    paymentMethod: value(selectedPayment || {}, "paymentMethod"),
    claimPayments: selectedLines.map((row) => {
      const draft = lineDrafts[value(row, "id")];
      return {
        paidAmount: draft?.paidAmount ?? value(row, "paidAmount"),
        adjustmentAmount: draft?.adjustmentAmount ?? value(row, "adjustmentAmount"),
      };
    }),
  });
  const totalsMatch = reconciliation.balanced;
  const canEditHeader = selectedPayment && value(selectedPayment, "paymentStatus") !== "fully_posted";
  const selectedReconLogs = (data.reconciliationLogs || []).filter((row) => value(row, "paymentId") === selectedPaymentId).slice(0, 20);

  const openPayment = (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setSelectedPaymentClaimId("");
    setSelectedClaimIds(new Set());
    setClaimSearch("");
    setClaimDosFrom("");
    setClaimDosTo("");
    setLineDrafts({});
    setServiceLineDrafts({});
    setHeaderDraft({});
    setBucket(value(entries.find((row) => value(row, "id") === paymentId) || {}, "paymentStatus") === "fully_posted" ? "submitted" : value(entries.find((row) => value(row, "id") === paymentId) || {}, "paymentStatus") === "error" ? "errors" : "pending");
  };

  useEffect(() => {
    if (paymentLinkHandled) return;
    const requested = new URLSearchParams(window.location.search).get("paymentId");
    if (!requested) { setPaymentLinkHandled(true); return; }
    const entry = entries.find((row) => value(row, "id") === requested || value(row, "paymentNumber") === requested);
    if (!entry) return;
    setSelectedPaymentId(value(entry, "id"));
    setPostingMonth("");
    setBucket(value(entry, "paymentStatus") === "fully_posted" ? "submitted" : value(entry, "paymentStatus") === "error" ? "errors" : "pending");
    setPaymentLookup(value(entry, "paymentNumber"));
    setPaymentLinkHandled(true);
  }, [entries, paymentLinkHandled]);

  const findPaymentById = () => {
    const lookup = paymentLookup.trim().toLowerCase();
    const entry = entries.find((row) => value(row, "paymentNumber").toLowerCase() === lookup || value(row, "id").toLowerCase() === lookup);
    if (!entry) { setPaymentLookupNotice("No payment found with that Payment ID."); return; }
    setPaymentLookupNotice("");
    setPostingMonth("");
    setSearch("");
    openPayment(value(entry, "id"));
  };

  const payerClaims = selectedPayment
    ? data.claims.filter((row) => {
      if (value(selectedPayment, "payerType") === "patient" ? value(row, "patientId") !== value(selectedPayment, "patientId") : value(row, "payerId") !== value(selectedPayment, "payerId")) return false;
      const outstanding = Math.max(0, moneyNumber(value(row, "totalCharge")) - moneyNumber(value(row, "totalPaid")) - moneyNumber(value(row, "totalAdjustment")));
      if (outstanding <= 0.009) return false;
      const already = selectedLines.some((line) => value(line, "claimId") === value(row, "id"));
      const searchText = claimSearch.trim().toLowerCase();
      if (searchText && !`${value(row, "id")} ${value(row, "claimNumber")} ${value(row, "patientName")} ${value(row, "dateOfService")}`.toLowerCase().includes(searchText)) return false;
      const dos = value(row, "dateOfService").slice(0, 10);
      if (claimDosFrom && dos < claimDosFrom) return false;
      if (claimDosTo && dos > claimDosTo) return false;
      return !already;
    })
    : [];

  const updateLineDraft = (lineId: string, field: string, next: string) => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] || {}),
        [field]: next,
      },
    }));
  };

  const lineValue = (row: DataRow, field: string) => {
    const draft = lineDrafts[value(row, "id")];
    return draft?.[field] ?? value(row, field);
  };
  const serviceLineValue = (row: DataRow, field: string) => serviceLineDrafts[value(row, "id")]?.[field] ?? value(row, field);

  const saveCorrections = async () => {
    if (!selectedPaymentId) return;
    const lines = selectedLines
      .filter((row) => value(row, "postingStatus") !== "posted")
      .map((row) => ({
        id: value(row, "id"),
        allowedAmount: lineValue(row, "allowedAmount"),
        paidAmount: lineValue(row, "paidAmount"),
        adjustmentAmount: lineValue(row, "adjustmentAmount"),
        patientResponsibility: lineValue(row, "patientResponsibility"),
        denialCode: lineValue(row, "denialCode"),
      }));
    const header = canEditHeader ? {
      paymentAmount: headerValue("paymentAmount"),
      paymentDate: headerValue("paymentDate"),
      postingDate: headerValue("postingDate"),
      offsetAmount: headerValue("offsetAmount"),
      refundAmount: headerValue("refundAmount"),
      incentiveAmount: headerValue("incentiveAmount"),
      otherAdjustments: headerValue("otherAdjustments"),
    } : undefined;
    const serviceLines = selectedServiceLines.filter((row) => value(row, "postingStatus") !== "posted").map((row) => ({
      id: value(row, "id"),
      allowedAmount: serviceLineValue(row, "allowedAmount"),
      paidAmount: serviceLineValue(row, "paidAmount"),
      adjustmentAmount: serviceLineValue(row, "adjustmentAmount"),
      patientResponsibility: serviceLineValue(row, "patientResponsibility"),
      denialCode: serviceLineValue(row, "denialCode"),
      eobPage: serviceLineValue(row, "eobPage"),
      nextAction: serviceLineValue(row, "nextAction"),
    }));
    if (await onFixLines(selectedPaymentId, lines, { ...(header || {}), serviceLines })) {
      setLineDrafts({});
      setServiceLineDrafts({});
      setHeaderDraft({});
    }
  };

  const paymentSortValue = (row: DataRow, key: string): string | number => {
    const effective = moneyNumber(value(row, "paymentTotalEffective") || value(row, "paymentAmount"));
    if (key === "source") return value(row, "paymentMethod").toUpperCase() === "ERA" ? "ERA" : "Manual";
    if (key === "party") return value(row, "payerType") === "patient" ? value(row, "patientName") : value(row, "payerName");
    if (key === "difference") return effective - moneyNumber(value(row, "claimPaidTotal"));
    if (key === "paymentTotalEffective") return effective;
    if (key === "error") return value(row, "errorMessage") || value(row, "autoPostResult");
    if (["paymentAmount", "claimPaidTotal", "claimCount", "offsetAmount", "refundAmount", "incentiveAmount", "otherAdjustments"].includes(key)) return moneyNumber(value(row, key));
    return value(row, key);
  };
  const sortedPayments = (rows: DataRow[]) => [...rows].sort((a, b) => {
    const left = paymentSortValue(a, paymentSort.key);
    const right = paymentSortValue(b, paymentSort.key);
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return (paymentSort.direction === "asc" ? order : -order) || value(a, "id").localeCompare(value(b, "id"));
  });
  const paymentSortHeader = (label: string, key: string) => <th aria-sort={paymentSort.key === key ? paymentSort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="payment-sort-header" type="button" onClick={() => setPaymentSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }))}>{label}<span aria-hidden="true">{paymentSort.key === key ? paymentSort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;

  const renderPaymentTable = (rows: DataRow[], mode: "pending" | "errors" | "submitted") => (
    <TablePanel
      description={mode === "submitted"
        ? "Fully posted payments only. Open a payment to see claim allocations and logs."
        : mode === "errors"
          ? "Posted amounts do not match payment total. Correct the CPT lines or offsets, then retry posting."
          : "Pending payments awaiting review and posting. Source identifies ERA and manual entries."}
      search={search}
      setSearch={setSearch}
      title={mode === "submitted" ? "Submitted payments" : mode === "errors" ? "Payment errors" : "Pending payments"}
    >
      <table>
        <thead>
          <tr>
            {paymentSortHeader("Payment ID", "paymentNumber")}{paymentSortHeader("Date", "paymentDate")}{paymentSortHeader("Source", "source")}{paymentSortHeader("Payer", "party")}{paymentSortHeader("Payment", "paymentAmount")}
            {mode === "submitted" && <>{paymentSortHeader("Offset", "offsetAmount")}{paymentSortHeader("Refund", "refundAmount")}{paymentSortHeader("Incentive", "incentiveAmount")}{paymentSortHeader("Other", "otherAdjustments")}</>}
            {paymentSortHeader("Effective", "paymentTotalEffective")}{paymentSortHeader("Posted", "claimPaidTotal")}{paymentSortHeader("Diff", "difference")}{paymentSortHeader("Claims", "claimCount")}{paymentSortHeader("Method", "paymentMethod")}{paymentSortHeader("Status", "paymentStatus")}{paymentSortHeader("Recon", "reconciliationStatus")}
            {mode !== "pending" && paymentSortHeader("Auto-post / error", "error")}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? sortedPayments(rows).map((row) => {
            const id = value(row, "id");
            const recon = value(row, "reconciliationStatus") || (mode === "submitted" ? "balanced" : "pending");
            return (
              <tr className={selectedPaymentId === id ? "is-selected" : undefined} key={id}>
                <td><span className="mono">{value(row, "paymentNumber")}</span><small className="address">{value(row, "referenceNumber") || "No ref"}</small></td>
                <td>{shortDate(value(row, "paymentDate"))}</td>
                <td><Status value={value(row, "paymentMethod").toUpperCase() === "ERA" ? "ERA" : "Manual"} /></td>
                <td>{value(row, "payerType") === "patient" ? value(row, "patientName") || "Patient" : value(row, "payerName") || "—"}<small className="address">{value(row, "payerType") === "patient" ? `${value(row, "paymentPurpose") || "Patient payment"}${value(row, "serviceDate") ? ` · DOS ${shortDate(value(row, "serviceDate"))}` : " · No visit linked"}` : "Insurance payer"}</small></td>
                <td>{currency(value(row, "paymentAmount"))}</td>
                {mode === "submitted" && <>
                  <td>{currency(value(row, "offsetAmount") || "0.00")}</td>
                  <td>{currency(value(row, "refundAmount") || "0.00")}</td>
                  <td>{currency(value(row, "incentiveAmount") || "0.00")}</td>
                  <td>{currency(value(row, "otherAdjustments") || "0.00")}</td>
                </>}
                <td>{currency(value(row, "paymentTotalEffective") || value(row, "paymentAmount"))}</td>
                <td>{currency(value(row, "claimPaidTotal") || "0.00")}</td>
                <td>{currency(String((moneyNumber(value(row, "paymentTotalEffective") || value(row, "paymentAmount")) - moneyNumber(value(row, "claimPaidTotal"))).toFixed(2)))}</td>
                <td>{value(row, "postedClaimCount")}/{value(row, "claimCount")}</td>
                <td>{value(row, "paymentMethod")}</td>
                <td><Status value={value(row, "paymentStatus")} /></td>
                <td><Status value={recon} /></td>
                {mode !== "pending" && <td><small>{value(row, "errorMessage") || value(row, "autoPostResult") || "—"}</small></td>}
                <td><div className="row-actions"><button onClick={() => openPayment(id)} type="button">Open</button></div></td>
              </tr>
            );
          }) : <tr><td colSpan={mode === "submitted" ? 19 : mode === "pending" ? 14 : 15}>No payments in this view.</td></tr>}
        </tbody>
      </table>
    </TablePanel>
  );

  return (
    <div className="payment-posting-workbench">
      <form className="claims-bucket-actions payment-detail-actions" onSubmit={(event) => { event.preventDefault(); findPaymentById(); }}>
        <label className="field"><span>Find payment by Payment ID · all dates</span><input placeholder="Enter Payment ID" value={paymentLookup} onChange={(event) => setPaymentLookup(event.target.value)} /></label>
        <button className="secondary-button" disabled={!paymentLookup.trim()} type="submit">Open payment</button>
        {paymentLookupNotice && <span role="status">{paymentLookupNotice}</span>}
      </form>
      <div className="payment-posting-toolbar"><div><span className="eyebrow">Payment posting workspace</span><h2>ERA &amp; manual payments</h2><p>Review, correct, and post payer payments by claim and CPT line.</p></div><label className="field"><span>Posting month</span><input onChange={(event) => setPostingMonth(event.target.value)} type="month" value={postingMonth} /></label></div>
      <section className="claims-bucket-toolbar payment-bucket-toolbar">
        <nav aria-label="Payment posting workflow" className="claims-bucket-tabs payment-bucket-tabs">
          {([
            ["pending", "Pending", counts.pending],
            ["errors", "Errors", counts.errors],
            ["submitted", "Submitted", counts.submitted],
            ["era", "ERA", counts.era],
          ] as const).map(([key, label, count]) => (
            <button aria-pressed={bucket === key} className={bucket === key ? "active" : ""} key={key} onClick={() => { setBucket(key); if (key !== "pending" && key !== "errors" && key !== "submitted") setSelectedPaymentId(""); }} type="button">
              <span>{label}</span><b>{count}</b>
            </button>
          ))}
        </nav>
      </section>

      {bucket === "pending" && renderPaymentTable(pendingEntries, "pending")}
      {bucket === "errors" && renderPaymentTable(errorEntries, "errors")}
      {bucket === "submitted" && renderPaymentTable(submittedEntries, "submitted")}
      {bucket === "era" && (() => {
        const openEras = data.remittances.filter((row) => {
          if (value(row, "status") === "posted") return false;
          if (!inPostingMonth(row)) return false;
          if (!query) return true;
          return `${value(row, "traceNumber")} ${value(row, "payerName")} ${value(row, "fileName")}`.toLowerCase().includes(query);
        });
        return (
          <TablePanel title="ERA 835 inbox" description="Upload/import an 835, then Process to create a payment entry and claim lines." search={search} setSearch={setSearch}>
            <div className="claims-bucket-actions payment-detail-actions">
              <button className="secondary-button" onClick={onImportEra} type="button">Upload ERA</button>
              {(() => { const source = data.remittances.find((row) => value(row, "fileName").toLowerCase().includes("oscar")) || data.remittances.find((row) => value(row, "id")); return source ? <><button className="secondary-button" disabled={isSaving} onClick={() => void onCreateEraDenialVariant(value(source, "id"))} type="button">Create denial test ERA</button><button className="secondary-button" disabled={isSaving} onClick={() => void onCreateEraZeroCheckVariant(value(source, "id"))} type="button">Create zero-check ERA</button></> : null; })()}
            </div>
            <table>
              <thead><tr><th>File / Trace</th><th>Payer</th><th>Received</th><th>Amount</th><th>Process</th><th>Actions</th></tr></thead>
              <tbody>
                {openEras.length ? openEras.map((row) => {
                  const processed = value(row, "processedStatus");
                  return (
                    <tr key={value(row, "id")}>
                      <td><span className="mono">{value(row, "fileName") || value(row, "traceNumber")}</span><small className="address">{value(row, "traceNumber")}</small></td>
                      <td>{value(row, "payerName") || "Unmatched payer"}</td>
                      <td>{shortDate(value(row, "receivedAt") || value(row, "paymentDate"), true)}</td>
                      <td>{currency(value(row, "amount"))}</td>
                      <td><Status value={processed || "pending"} /></td>
                      <td>
                        <div className="row-actions">
                          <button className="primary-button" disabled={isSaving} onClick={async () => {
                            setSelectedEraId(value(row, "id"));
                            setEraExceptionFilter("all");
                            setSelectedEraClaimPaymentId("");
                            setEraClaimDrafts({});
                            setEraServiceDrafts({});
                            if (!value(row, "paymentEntryId")) await onStartEra(value(row, "id"));
                          }} type="button">Post</button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan={6}>No unprocessed ERA files. Upload an 835 to begin.</td></tr>}
              </tbody>
            </table>
            {selectedEra && (
              <section className="payment-detail-panel">
                <TablePanel title={`ERA ${value(selectedEra, "traceNumber")}`} description={`${value(selectedEra, "payerName") || "Unmatched payer"} · ${currency(value(selectedEra, "amount"))} · ${value(selectedEra, "status")}`}>
                  <div className="payment-compact-grid payment-header-amounts">
                    <label className="field"><span>Payer</span><input disabled readOnly value={value(selectedEra, "payerName") || "Unmatched payer"} /></label>
                    <label className="field"><span>Trace</span><input disabled readOnly value={value(selectedEra, "traceNumber")} /></label>
                    <label className="field"><span>ERA/check date</span><input disabled readOnly value={value(selectedEra, "paymentDate")} /></label>
                    <label className="field"><span>Posting date</span><input disabled readOnly value={value(selectedEra, "postingDate")} /></label>
                    <label className="field"><span>Amount</span><input disabled readOnly value={value(selectedEra, "amount")} /></label>
                  </div>
                  {selectedEraPaymentId && <>
                    <SummaryCards cards={[
                      ["ERA claims", String(selectedEraClaims.length), "Matched claim allocations"],
                      ["Posted", String(selectedEraPostedCount), "Successfully posted"],
                      ["Exceptions", String(selectedEraExceptionRows.length), "Need review or correction"],
                      ["Allocated paid", currency(selectedEraAllocatedPaid.toFixed(2)), `ERA total ${currency(value(selectedEra, "amount"))}`],
                    ]} />
                    <div className={`era-readiness-panel ${selectedEraReadyToPost ? "is-ready" : "has-errors"}`}>
                      <div className="era-readiness-header"><strong>{selectedEraReadyToPost ? "Ready to post" : "Review required before posting"}</strong><span aria-label={selectedEraReadyToPost ? "All checks passed" : "One or more checks failed"} className="era-readiness-icon">{selectedEraReadyToPost ? "✓" : "!"}</span></div>
                      <div className="era-readiness-checks">
                        <span className={selectedEraUnmatched.length === 0 ? "check-pass" : "check-fail"}><b>{selectedEraUnmatched.length === 0 ? "✓" : "!"}</b> Claims matched{selectedEraUnmatched.length ? ` · ${selectedEraUnmatched.length} unmatched` : ""}</span>
                        <span className={selectedEraBlockingRows.length === 0 ? "check-pass" : "check-fail"}><b>{selectedEraBlockingRows.length === 0 ? "✓" : "!"}</b> No blocking errors{selectedEraBlockingRows.length ? ` · ${selectedEraBlockingRows.length} to fix` : ""}</span>
                        <span className={selectedEraAmountMatches ? "check-pass" : "check-fail"}><b>{selectedEraAmountMatches ? "✓" : "!"}</b> Amounts match{!selectedEraAmountMatches ? ` · allocated ${currency(selectedEraAllocatedPaid.toFixed(2))} of ${currency(value(selectedEra, "amount"))}` : ""}</span>
                      </div>
                    </div>
                    <div className="claims-bucket-actions payment-detail-actions">
                      <strong>Exception queue</strong>
                      {([['all', 'All'], ['unmatched', 'Unmatched'], ['errors', 'Posting errors'], ['denials', 'Denials']] as const).map(([filter, label]) => <button className={eraExceptionFilter === filter ? "active" : "secondary-button"} key={filter} onClick={() => setEraExceptionFilter(filter)} type="button">{label}</button>)}
                    </div>
                    {selectedEraExceptionRows.length > 0 && <table className="era-exception-table"><thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Paid</th><th>Exception</th><th>Action</th></tr></thead><tbody>{selectedEraExceptionRows.map((row, index) => <tr key={`${row.claimNumber}-${index}`}><td className="mono">{row.claimNumber}</td><td>{row.patientName}</td><td>{shortDate(row.dateOfService)}</td><td>{currency(row.paidAmount)}</td><td><Status value={row.kind} /><small className="address">{row.reason}</small></td><td>{row.claimPaymentId ? <button className="link-button" onClick={() => { setSelectedEraClaimPaymentId(row.claimPaymentId); setEraClaimDrafts({}); setEraServiceDrafts({}); }} type="button">Review claim</button> : <span className="form-guidance">Map claim below</span>}</td></tr>)}</tbody></table>}
                  </>}
                  {!selectedEraPaymentId ? <p className="form-guidance">Start this ERA to create editable claim allocations. After starting, all associated CPT lines will appear here for review.</p> : <>
                    {selectedEraUnmatched.length > 0 && <><h3>Unmatched ERA claims</h3><p className="form-guidance">These claims came from the uploaded 835 but did not match a local claim. They are shown for review and will not be replaced with unrelated payer claims.</p><table><thead><tr><th>ERA claim</th><th>Patient</th><th>DOS</th><th>Paid</th><th>Service lines</th><th>Reason</th></tr></thead><tbody>{selectedEraUnmatched.map((claim) => <tr key={String(claim.claimControlNumber)}><td className="mono">{String(claim.claimControlNumber || "—")}</td><td>{[claim.patientFirstName, claim.patientLastName].filter(Boolean).join(" ") || "—"}</td><td>{shortDate(String(claim.dateOfService || ""))}</td><td>{currency(String(claim.paidAmount || "0"))}</td><td>{Array.isArray(claim.serviceLines) ? claim.serviceLines.map((line) => String((line as Record<string, unknown>).procedureCode || "")).filter(Boolean).join(", ") || "—" : "—"}</td><td>{String(claim.reason || "Review")}</td></tr>)}</tbody></table></>}
                    <div className="claims-bucket-actions payment-detail-actions"><button className="secondary-button" disabled={isSaving} onClick={() => void onSeedEraClaims(value(selectedEra, "id"))} type="button">Ensure demo patients &amp; coverage</button><button className="secondary-button" disabled={isSaving} onClick={() => void onCreateEraDenialVariant(value(selectedEra, "id"))} type="button">Create denial test copy</button><button className="secondary-button" disabled={isSaving} onClick={() => void onCreateEraZeroCheckVariant(value(selectedEra, "id"))} type="button">Create zero-check copy</button><span className="form-guidance">Testing only: adds demo addresses/coverage or creates separate denial/zero-check ERA files. The original file is preserved.</span></div>
                    <table><thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>CPT lines</th><th>Paid</th><th>Balance</th><th>Next action</th><th>Status</th></tr></thead><tbody>{selectedEraClaims.map((claim) => { const claimLines = selectedEraServiceLines.filter((line) => value(line, "claimPaymentId") === value(claim, "id")); const currentPaid = moneyNumber(value(claim, "paidAmount")); const currentAdjustment = moneyNumber(value(claim, "adjustmentAmount")); const claimBalance = moneyNumber(value(claim, "remainingBalance")) || moneyNumber(value(claim, "totalCharge")); const posted = value(claim, "postingStatus") === "posted"; const balance = Math.max(0, posted ? claimBalance : claimBalance - currentPaid - currentAdjustment); const action = value(claimLines[0] || {}, "nextAction") || (balance <= 0.009 ? "claim_closed" : "review"); return <tr key={value(claim, "id")}><td className="mono"><button className="link-button" onClick={() => { setSelectedEraClaimPaymentId(value(claim, "id")); setEraClaimDrafts({}); setEraServiceDrafts({}); }} type="button">{value(claim, "claimNumber")}</button></td><td>{value(claim, "patientName")}</td><td>{shortDate(value(claim, "dateOfService"))}</td><td>{claimLines.length || "—"}</td><td>{currency(value(claim, "paidAmount"))}</td><td className={balance > 0.009 ? "is-negative" : undefined}>{currency(balance.toFixed(2))}</td><td><Status value={action} /></td><td><Status value={balance <= 0.009 && !value(claim, "denialCode") ? "claim_closed" : value(claim, "postingStatus")} /></td></tr>; })}</tbody></table>
                    {selectedEraClaim && <section className="payment-service-line-panel"><div className="claims-bucket-actions payment-detail-actions"><h3>Claim {value(selectedEraClaim, "claimNumber")} detail</h3><button className="secondary-button" onClick={() => setSelectedEraClaimPaymentId("")} type="button">Close claim</button></div><div className="payment-compact-grid"><label className="field"><span>Allowed</span><input onChange={(event) => setEraClaimDrafts((current) => ({ ...current, allowedAmount: event.target.value }))} value={eraClaimValue("allowedAmount")} /></label><label className="field"><span>Paid</span><input onChange={(event) => setEraClaimDrafts((current) => ({ ...current, paidAmount: event.target.value }))} value={eraClaimValue("paidAmount")} /></label><label className="field"><span>Adjustment</span><input onChange={(event) => setEraClaimDrafts((current) => ({ ...current, adjustmentAmount: event.target.value }))} value={eraClaimValue("adjustmentAmount")} /></label><label className="field"><span>Patient responsibility</span><input onChange={(event) => setEraClaimDrafts((current) => ({ ...current, patientResponsibility: event.target.value }))} value={eraClaimValue("patientResponsibility")} /></label><label className="field"><span>Adjustment / reason codes</span><input onChange={(event) => setEraClaimDrafts((current) => ({ ...current, denialCode: event.target.value }))} value={eraClaimValue("denialCode")} /><AdjustmentExplanation row={selectedEraClaim} /></label></div><table><thead><tr><th>CPT/HCPCS</th><th>DOS</th><th>Units</th><th>Charge</th><th>Allowed</th><th>Paid</th><th>Adjustment</th><th>Responsibility</th><th>Reason codes</th><th>EOB page</th><th>Next action</th></tr></thead><tbody>{selectedEraClaimLines.map((line) => <tr key={value(line, "id")}><td className="mono">{value(line, "procedureCode")}</td><td>{shortDate(value(line, "serviceDate"))}</td><td>{value(line, "units")}</td><td>{currency(value(line, "chargeAmount"))}</td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), allowedAmount: event.target.value } }))} value={eraServiceValue(line, "allowedAmount")} /></td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), paidAmount: event.target.value } }))} value={eraServiceValue(line, "paidAmount")} /></td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), adjustmentAmount: event.target.value } }))} value={eraServiceValue(line, "adjustmentAmount")} /></td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), patientResponsibility: event.target.value } }))} value={eraServiceValue(line, "patientResponsibility")} /></td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), denialCode: event.target.value } }))} value={eraServiceValue(line, "denialCode")} /><AdjustmentExplanation row={line} /></td><td><input onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), eobPage: event.target.value } }))} value={eraServiceValue(line, "eobPage")} /></td><td><select onChange={(event) => setEraServiceDrafts((current) => ({ ...current, [value(line, "id")]: { ...(current[value(line, "id")] || {}), nextAction: event.target.value } }))} value={eraServiceValue(line, "nextAction")}><option value="">Select</option><option value="paid_close">Paid close</option><option value="bill_to_patient">Bill patient</option><option value="bill_to_secondary">Bill secondary</option><option value="bill_to_tertiary">Bill tertiary</option><option value="bill_to_guarantor">Bill guarantor</option><option value="write_off">Write off</option><option value="rebill">Rebill</option></select></td></tr>)}</tbody></table><button className="primary-button" disabled={isSaving} onClick={() => void saveEraClaim()} type="button">Save claim corrections</button></section>}
                    {value(selectedEra, "status") !== "posted" && <div className="claims-bucket-actions payment-detail-actions"><button className="primary-button" disabled={isSaving || !selectedEraReadyToPost} onClick={() => void onProcessEra(value(selectedEra, "id"))} type="button">Post</button></div>}
                  </>}
                  <button className="secondary-button" onClick={() => setSelectedEraId("")} type="button">Close ERA</button>
                </TablePanel>
              </section>
            )}
          </TablePanel>
        );
      })()}

      {selectedPayment && bucket !== "era" && (
        <section className="payment-detail-panel">
          <TablePanel
            title={`Payment ${value(selectedPayment, "paymentNumber")}`}
            description={`${value(selectedPayment, "payerType") === "patient" ? `Patient: ${value(selectedPayment, "patientName")}${value(selectedPayment, "serviceDate") ? ` · ${shortDate(value(selectedPayment, "serviceDate"))} · ${value(selectedPayment, "paymentPurpose")}` : ` · ${value(selectedPayment, "paymentPurpose") || "Unapplied"}`}` : `Insurance payer: ${value(selectedPayment, "payerName") || "Payer"}`} · ${isSelectedEraPayment ? "ERA allocation from the uploaded 835" : "Manual payment — claims are added only when selected"} · Effective ${currency(String(effectiveTotal.toFixed(2)))} · Posted ${currency(String(totalClaimsPosted.toFixed(2)))} ${totalsMatch ? "· matched" : "· mismatch"}`}
          >
            <div className="payment-method-banner">
              <strong>{isSelectedEraPayment ? "ERA payment" : "Manual payment"}</strong>
              <span>{isSelectedEraPayment ? "Claims below came from the ERA matching step. Do not allocate unrelated open claims here." : selectedLines.length ? "Only claims selected for this batch are shown below." : "No claims selected yet. Search for a claim above and add it before posting."}</span>
            </div>
            <div className="payment-compact-grid payment-header-amounts">
              <label className="field"><span>Payment method</span><input readOnly value={value(selectedPayment, "paymentMethod")} /></label>
              {(() => {
                let details: Record<string, string> = {};
                try { details = JSON.parse(value(selectedPayment, "methodDetails") || "{}"); } catch { /* Legacy entry without method details. */ }
                const labels: Record<string, string> = { cardBrand: "Card brand", cardLast4: "Card last 4", authorizationCode: "Authorization", processor: "Processor / terminal", walletProvider: "Wallet", bankName: "Bank / issuer", otherMethod: "Other method" };
                return Object.entries(labels).filter(([key]) => details[key]).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input readOnly value={key === "cardLast4" ? `•••• ${details[key]}` : details[key]} /></label>);
              })()}
              <label className="field"><span>Amount</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, paymentAmount: event.target.value }))} type="number" value={headerValue("paymentAmount")} /></label>
              <label className="field"><span>Check / ERA date</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, paymentDate: event.target.value }))} type="date" value={headerValue("paymentDate")} /></label>
              <label className="field"><span>Posting date</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, postingDate: event.target.value }))} type="date" value={headerValue("postingDate")} /></label>
              <label className="field"><span>Offset</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, offsetAmount: event.target.value }))} type="number" value={headerValue("offsetAmount") || "0.00"} /></label>
              <label className="field"><span>Refund</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, refundAmount: event.target.value }))} type="number" value={headerValue("refundAmount") || "0.00"} /></label>
              <label className="field"><span>Incentive</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, incentiveAmount: event.target.value }))} type="number" value={headerValue("incentiveAmount") || "0.00"} /></label>
              <label className="field"><span>Other</span><input disabled={!canEditHeader || isSaving} onChange={(event) => setHeaderDraft((current) => ({ ...current, otherAdjustments: event.target.value }))} type="number" value={headerValue("otherAdjustments") || "0.00"} /></label>
              <label className="field"><span>Effective</span><input disabled readOnly value={effectiveTotal.toFixed(2)} /></label>
              <label className="field"><span>Claims posted</span><input disabled readOnly value={totalClaimsPosted.toFixed(2)} /></label>
              <label className="field"><span>Difference</span><input disabled readOnly value={reconciliation.difference} /></label>
            </div>
            <div className={`payment-recon-banner ${totalsMatch ? "is-balanced" : "is-unbalanced"}`}>
              <Status value={reconciliation.reconciliationStatus} />
              <span>{totalsMatch ? `${isSelectedEraPayment ? "ERA" : "Payment"} totals match. Posting is available.` : "Payment total does not match posted amounts. Correct CPT lines or offsets, then Recalculate."}</span>
            </div>
            <div className="claims-bucket-actions payment-detail-actions">
              {!isSelectedEraPayment && payerClaims.length > 0 && (
                <button
                  className="secondary-button"
                  disabled={isSaving || !selectedClaimIds.size}
                  onClick={() => void onPopulate(selectedPaymentId, Array.from(selectedClaimIds))}
                  type="button"
                >
                  Add selected ({selectedClaimIds.size})
                </button>
              )}
              <button className="secondary-button" disabled={isSaving || !selectedLines.length} onClick={() => void saveCorrections()} type="button">
                Save
              </button>
              <button
                className="secondary-button"
                disabled={isSaving}
                onClick={() => void onRecalculate(selectedPaymentId, canEditHeader ? {
                  paymentAmount: headerValue("paymentAmount"),
                  offsetAmount: headerValue("offsetAmount"),
                  refundAmount: headerValue("refundAmount"),
                  incentiveAmount: headerValue("incentiveAmount"),
                  otherAdjustments: headerValue("otherAdjustments"),
                } : undefined)}
                type="button"
              >
                Recalculate
              </button>
              <button className="primary-button" disabled={isSaving || !selectedLines.length || !totalsMatch} onClick={() => onAutoPost(selectedPaymentId)} type="button">
                {isSelectedEraPayment ? "Post entire ERA" : "Post payment"}
              </button>
              <button className="secondary-button" onClick={() => setSelectedPaymentId("")} type="button">Close</button>
            </div>
            {value(selectedPayment, "errorMessage") && (
              <p className="form-guidance" style={{ color: "var(--danger, #b42318)" }}>{value(selectedPayment, "errorMessage")}</p>
            )}
            {!isSelectedEraPayment && value(selectedPayment, "paymentStatus") !== "fully_posted" && (
              <>
                <div className="payment-claim-search">
                  <label className="field"><span>Claim ID / patient name</span><input onChange={(event) => setClaimSearch(event.target.value)} placeholder="Search claim number or patient" value={claimSearch} /></label>
                  <label className="field"><span>DOS from</span><input type="date" value={claimDosFrom} onChange={(event) => setClaimDosFrom(event.target.value)} /></label>
                  <label className="field"><span>DOS to</span><input type="date" min={claimDosFrom || undefined} value={claimDosTo} onChange={(event) => setClaimDosTo(event.target.value)} /></label>
                  <button className="secondary-button" type="button" onClick={() => { setClaimSearch(""); setClaimDosFrom(""); setClaimDosTo(""); }}>Clear filters</button>
                </div>
                <p className="form-guidance">{value(selectedPayment, "payerType") === "patient" ? "Only this patient's open claims are shown. Select a claim and review its CPT lines before applying the payment." : "Select an open claim for this payer, then review its CPT lines."}</p>
              <table style={{ marginBottom: 16 }}>
                <thead><tr><th /><th>Open claim</th><th>DOS</th><th>Charge</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {payerClaims.slice(0, 100).map((row) => {
                    const id = value(row, "id");
                    const outstanding = Math.max(0, moneyNumber(value(row, "totalCharge")) - moneyNumber(value(row, "totalPaid")) - moneyNumber(value(row, "totalAdjustment")));
                    return (
                      <tr key={id}>
                        <td><input aria-label={`Select ${value(row, "claimNumber")}`} checked={selectedClaimIds.has(id)} onChange={() => setSelectedClaimIds((current) => {
                          const next = new Set(current);
                          if (next.has(id)) next.delete(id); else next.add(id);
                          return next;
                        })} type="checkbox" /></td>
                        <td><span className="mono">{value(row, "claimNumber")}</span><small className="address">{value(row, "patientName")}</small></td>
                        <td>{shortDate(value(row, "dateOfService"))}</td>
                        <td>{currency(value(row, "totalCharge"))}</td>
                        <td>{currency(String(outstanding.toFixed(2)))}</td>
                      </tr>
                    );
                  })}
                  {!payerClaims.length && <tr><td colSpan={5}>No unallocated open claims match. Clear the filters or check the selected patient and DOS.</td></tr>}
                </tbody>
              </table></>
            )}
            <table>
              <thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Charge</th><th>Paid</th><th>Balance</th><th>Next action</th><th>Status</th></tr></thead>
              <tbody>{selectedLines.length ? selectedLines.map((row) => {
                const lineId = value(row, "id");
                const balance = Math.max(0, moneyNumber(value(row, "remainingBalance")) || moneyNumber(value(row, "allowedAmount")) - moneyNumber(value(row, "paidAmount")) - moneyNumber(value(row, "adjustmentAmount")));
                const claimLines = selectedServiceLines.filter((line) => value(line, "claimPaymentId") === lineId);
                const action = value(claimLines[0] || {}, "nextAction") || (balance <= 0.009 ? "paid_close" : "review");
                const hasError = value(row, "postingStatus") === "error" || claimLines.some((line) => value(line, "postingStatus") === "error" || value(line, "errorMessage"));
                return <tr className={hasError ? "is-selected" : undefined} key={lineId}><td><button className="link-button mono" onClick={() => { setSelectedPaymentClaimId(lineId); setLineDrafts({}); setServiceLineDrafts({}); }} type="button">{value(row, "claimNumber")}</button></td><td>{value(row, "patientName") || "—"}</td><td>{shortDate(value(row, "dateOfService"))}</td><td>{currency(value(row, "allowedAmount") || value(row, "totalCharge"))}</td><td>{currency(value(row, "paidAmount"))}</td><td className={balance > 0.009 ? "is-negative" : undefined}>{currency(balance.toFixed(2))}</td><td><Status value={action} /></td><td><Status value={hasError ? "error" : value(row, "postingStatus")} /></td></tr>;
              }) : <tr><td colSpan={8}>No claim lines yet. Search and add a claim to begin posting.</td></tr>}</tbody>
            </table>
            {selectedPaymentClaim && (
              <div className="payment-service-line-panel">
                <div className="claims-bucket-actions payment-detail-actions"><h3>Claim {value(selectedPaymentClaim, "claimNumber")} CPT details</h3><button className="secondary-button" onClick={() => setSelectedPaymentClaimId("")} type="button">Close claim</button></div>
                <p className="form-guidance">Edit payment and EOB fields at CPT level. The claim total is recalculated from these lines.</p>
                <table>
                  <thead><tr><th>CPT/HCPCS</th><th>DOS</th><th>Units</th><th>Charge</th><th>Allowed</th><th>Paid</th><th>Adjustment</th><th>Patient responsibility</th><th>CARC/RARC</th><th>EOB page</th><th>Next action</th><th>Status</th></tr></thead>
                  <tbody>{selectedPaymentClaimLines.map((row) => (
                    <tr key={value(row, "id")}>
                      <td className="mono">{value(row, "procedureCode")}</td><td>{shortDate(value(row, "serviceDate"))}</td><td>{value(row, "units")}</td><td>{currency(value(row, "chargeAmount"))}</td><td>{value(row, "postingStatus") === "posted" ? currency(value(row, "allowedAmount")) : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), allowedAmount: event.target.value } }))} type="number" value={serviceLineValue(row, "allowedAmount")} />}</td><td>{value(row, "postingStatus") === "posted" ? currency(value(row, "paidAmount")) : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), paidAmount: event.target.value } }))} type="number" value={serviceLineValue(row, "paidAmount")} />}</td><td>{value(row, "postingStatus") === "posted" ? currency(value(row, "adjustmentAmount")) : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), adjustmentAmount: event.target.value } }))} type="number" value={serviceLineValue(row, "adjustmentAmount")} />}</td><td>{value(row, "postingStatus") === "posted" ? currency(value(row, "patientResponsibility")) : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), patientResponsibility: event.target.value } }))} type="number" value={serviceLineValue(row, "patientResponsibility")} />}</td><td>{value(row, "postingStatus") === "posted" ? (value(row, "denialCode") || "—") : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), denialCode: event.target.value } }))} value={serviceLineValue(row, "denialCode")} />}<AdjustmentExplanation row={row} /></td><td>{value(row, "postingStatus") === "posted" ? (value(row, "eobPage") || "—") : <input disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), eobPage: event.target.value } }))} placeholder="e.g. 1-2" value={serviceLineValue(row, "eobPage")} />}</td><td>{value(row, "postingStatus") === "posted" ? (value(row, "nextAction") || "—") : <select disabled={isSaving} onChange={(event) => setServiceLineDrafts((current) => ({ ...current, [value(row, "id")]: { ...(current[value(row, "id")] || {}), nextAction: event.target.value } }))} value={serviceLineValue(row, "nextAction")}><option value="">Select</option><option value="paid_close">Paid close</option><option value="bill_to_patient">Bill patient</option><option value="bill_to_secondary">Bill secondary</option><option value="bill_to_tertiary">Bill tertiary</option><option value="bill_to_guarantor">Bill guarantor</option><option value="write_off">Write off</option><option value="rebill">Rebill</option></select>}</td><td><Status value={value(row, "postingStatus")} /></td>
                    </tr>
                  ))}</tbody>
                </table>
                {selectedPaymentClaimLines.length === 0 && <p className="form-guidance">No CPT lines are linked to this claim yet.</p>}
              </div>
            )}
            {selectedLogs.length > 0 && (
              <div className="payment-logs">
                <span>Posting logs</span>
                <ul className="address">
                  {selectedLogs.map((row) => (
                    <li key={value(row, "id")}><span className="mono">{shortDate(value(row, "createdAt"), true)}</span> · {value(row, "actionType")} — {value(row, "message")}</li>
                  ))}
                </ul>
              </div>
            )}
            {selectedReconLogs.length > 0 && (
              <div className="payment-logs">
                <span>Reconciliation logs</span>
                <ul className="address">
                  {selectedReconLogs.map((row) => (
                    <li key={value(row, "id")}>
                      <span className="mono">{shortDate(value(row, "createdAt"), true)}</span>
                      {" · "}
                      {value(row, "correctedByName")}
                      {" · eff "}
                      {value(row, "previousTotalEffective")}→{value(row, "newTotalEffective")}
                      {" · posted "}
                      {value(row, "previousTotalPosted")}→{value(row, "newTotalPosted")}
                      {" · diff "}
                      {value(row, "newDifference")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TablePanel>
        </section>
      )}
    </div>
  );
}

type ClaimEditorLine = Record<string, string>;

function ClaimFollowUpInsurancePanel({
  data, patientId, dos, draft, isSaving, onApply, onCreateCoverage, onCaptureCard,
}: {
  data: WorkspaceData;
  patientId: string;
  dos: string;
  draft: Record<string, string>;
  isSaving: boolean;
  onApply: (slot: "primary" | "secondary" | "tertiary", coverageId: string, extra?: Record<string, string>) => void;
  onCreateCoverage?: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  onCaptureCard?: (patientId: string, coverageId: string, side: "front" | "back", file: File) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [addSlot, setAddSlot] = useState<"primary" | "secondary" | "tertiary">("primary");
  const [addForm, setAddForm] = useState({ planId: "", memberId: "", groupNumber: "", effectiveDate: dos, terminationDate: "" });
  const coverages = data.coverages.filter((row) => value(row, "patientId") === patientId);
  const options = coverages.map((coverage) => {
    const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
    const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
    return {
      id: value(coverage, "id"),
      label: coverageEpisodeLabel({
        coverage,
        payerName: value(payer || {}, "name"),
        planName: value(plan || {}, "name"),
        dos,
      }),
      coversDos: coverageCoversDos(coverage, dos),
    };
  }).sort((left, right) => Number(right.coversDos) - Number(left.coversDos) || left.label.localeCompare(right.label));

  function slotCapture(coverageId: string) {
    if (!onCaptureCard || !coverageId) return null;
    return <div className="claim-coverage-capture">{(["front", "back"] as const).map((side) => (
      <label aria-label={`Capture insurance card ${side}`} className={isSaving ? "disabled" : ""} key={side} title={`Photo or upload the ${side} of this card`}>
        <span aria-hidden="true">📷</span>{side === "front" ? "Front" : "Back"}
        <input accept="image/jpeg,image/png,image/webp" capture="environment" disabled={isSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onCaptureCard(patientId, coverageId, side, file); event.currentTarget.value = ""; }} type="file" />
      </label>
    ))}</div>;
  }

  async function saveNewCoverage() {
    if (!onCreateCoverage || !addForm.planId || !addForm.memberId) return;
    const created = await onCreateCoverage({
      patientId,
      planId: addForm.planId,
      memberId: addForm.memberId,
      groupNumber: addForm.groupNumber,
      effectiveDate: addForm.effectiveDate,
      terminationDate: addForm.terminationDate,
      priority: "unassigned",
      subscriberSameAsPatient: true,
    });
    if (!created?.id) return;
    onApply(addSlot, String(created.id), { memberId: addForm.memberId, groupNumber: addForm.groupNumber });
    setAdding(false);
    setAddForm({ planId: "", memberId: "", groupNumber: "", effectiveDate: dos, terminationDate: "" });
  }

  return (
    <section className="claim-billed-coverage">
      <header>
        <div>
          <strong>Billed coverage for this DOS</strong>
          <p>Primary, secondary and tertiary here apply to this claim only. Patient coverage history is not rewritten unless you choose Claim + patient/insurance master.</p>
        </div>
        {onCreateCoverage && <button className="secondary-button" onClick={() => setAdding((open) => !open)} type="button">{adding ? "Cancel" : "Add insurance"}</button>}
      </header>
      <div className="claim-billed-coverage-grid">
        {([["primary", "Primary", draft.coverageId], ["secondary", "Secondary", draft.secondaryCoverageId], ["tertiary", "Tertiary", draft.tertiaryCoverageId]] as const).map(([slot, label, selected]) => (
          <label key={slot}>
            <span>{label}{selected && coverageCoversDos(coverages.find((row) => value(row, "id") === selected) || {}, dos) ? "" : selected ? " · outside DOS" : ""}</span>
            <select onChange={(event) => onApply(slot, event.target.value)} value={selected || ""}>
              <option value="">{label === "Primary" ? "Select coverage" : "None"}</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {slotCapture(selected || "")}
          </label>
        ))}
      </div>
      {adding && (
        <div className="claim-add-coverage">
          <strong>Add a coverage episode</strong>
          <p>Saved to the patient as history. It is then billed on this claim in the slot you choose.</p>
          <div className="claim-add-coverage-grid">
            <label>Use on this claim
              <select onChange={(event) => setAddSlot(event.target.value as "primary" | "secondary" | "tertiary")} value={addSlot}>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="tertiary">Tertiary</option>
              </select>
            </label>
            <label>Insurance plan
              <select onChange={(event) => setAddForm((current) => ({ ...current, planId: event.target.value }))} value={addForm.planId}>
                <option value="">Select</option>
                {data.plans.map((plan) => {
                  const payer = data.payers.find((item) => value(item, "id") === value(plan, "payerId"));
                  return <option key={value(plan, "id")} value={value(plan, "id")}>{value(payer || {}, "name")} · {value(plan, "name")}</option>;
                })}
              </select>
            </label>
            <label>Member ID<input onChange={(event) => setAddForm((current) => ({ ...current, memberId: event.target.value }))} value={addForm.memberId} /></label>
            <label>Group<input onChange={(event) => setAddForm((current) => ({ ...current, groupNumber: event.target.value }))} value={addForm.groupNumber} /></label>
            <label>Effective<input onChange={(event) => setAddForm((current) => ({ ...current, effectiveDate: event.target.value }))} type="date" value={addForm.effectiveDate} /></label>
            <label>Terminates<input onChange={(event) => setAddForm((current) => ({ ...current, terminationDate: event.target.value }))} type="date" value={addForm.terminationDate} /></label>
          </div>
          <button className="primary-button" disabled={isSaving || !addForm.planId || !addForm.memberId} onClick={() => void saveNewCoverage()} type="button">{isSaving ? "Saving…" : "Save insurance on this claim"}</button>
        </div>
      )}
    </section>
  );
}

function ClaimCorrectionEditor({
  claim, data, issues, isSaving, initialBox, workflowEvents = [], onClose, onSave, onSubmit, onDownload, onPrint,
  mode = "prep", inquiryHref, onCreateCoverage, onCaptureCard, onFollowUpAction,
}: {
  claim: DataRow;
  data: WorkspaceData;
  issues: DataRow[];
  isSaving: boolean;
  initialBox: string;
  workflowEvents?: DataRow[];
  mode?: "prep" | "followup";
  inquiryHref?: string;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, rescrub: boolean) => Promise<Record<string, unknown> | null>;
  onSubmit: () => void;
  onDownload: () => void;
  onPrint: () => void;
  onCreateCoverage?: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  onCaptureCard?: (patientId: string, coverageId: string, side: "front" | "back", file: File) => Promise<void>;
  onFollowUpAction?: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const claimId = value(claim, "id");
  const patient = data.patients.find((row) => value(row, "id") === value(claim, "patientId")) || {};
  let claimSnapshot: Record<string, string> = {};
  try { claimSnapshot = JSON.parse(value(claim, "claimDataSnapshot") || "{}") as Record<string, string>; } catch { claimSnapshot = {}; }
  const billed = defaultBilledCoverages({
    coverages: data.coverages,
    eligibility: data.eligibility,
    patientId: value(claim, "patientId"),
    dos: value(claim, "dateOfService"),
    claimCoverageId: value(claim, "coverageId"),
    snapshotSecondaryId: claimSnapshot.secondaryCoverageId,
    snapshotTertiaryId: claimSnapshot.tertiaryCoverageId,
  });
  const coverage = data.coverages.find((row) => value(row, "id") === (billed.primaryId || value(claim, "coverageId"))) || {};
  const previouslySubmitted = Boolean(value(claim, "firstBilledDate") || value(claim, "clearinghouseTrace") || ["submitted", "accepted", "rejected", "denied"].includes(value(claim, "status")));
  const lifecycle = deriveClaimLifecycle(claim);
  const payer = data.payers.find((row) => value(row, "id") === value(claim, "payerId"));
  const plan = data.plans.find((row) => value(row, "id") === value(coverage, "planId"));
  const responseDays = payerResponseDays(payer);
  const ageDays = claimAgeDays(claim);
  const denialCodes = (data.claimPayments || [])
    .filter((row) => value(row, "claimId") === claimId && value(row, "denialCode"))
    .map((row) => value(row, "denialCode"));
  const followUpReason = unpaidReason({
    followUpStatus: value(claim, "followUpStatus"),
    lifecycleStatus: lifecycle,
    denialCodes,
    scrubErrors: issues.filter((issue) => value(issue, "severity") === "error").map((issue) => value(issue, "message")),
  });
  const followUpActions = arenaFollowUpActions({
    status: lifecycle,
    remaining: Number(value(claim, "remainingBalance") || 0),
    hasSecondary: data.coverages.some((row) => value(row, "patientId") === value(claim, "patientId") && value(row, "priority") === "secondary"),
    hasTertiary: data.coverages.some((row) => value(row, "patientId") === value(claim, "patientId") && value(row, "priority") === "tertiary"),
    followUpStatus: value(claim, "followUpStatus"),
  });
  const [section, setSection] = useState("form");
  const [noteDraft, setNoteDraft] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    id: claimId,
    coverageId: billed.primaryId || value(claim, "coverageId"),
    secondaryCoverageId: billed.secondaryId,
    tertiaryCoverageId: billed.tertiaryId,
    patientFirstName: claimSnapshot.patientFirstName || value(patient, "firstName"),
    patientMiddleName: claimSnapshot.patientMiddleName || value(patient, "middleName"),
    patientLastName: claimSnapshot.patientLastName || value(patient, "lastName"),
    patientSex: claimSnapshot.patientSex || value(patient, "sex"),
    patientDateOfBirth: claimSnapshot.patientDateOfBirth || value(patient, "dateOfBirth"),
    patientAddressLine1: claimSnapshot.patientAddressLine1 || value(patient, "addressLine1"),
    patientCity: claimSnapshot.patientCity || value(patient, "city"),
    patientState: claimSnapshot.patientState || value(patient, "state"),
    patientPostalCode: claimSnapshot.patientPostalCode || value(patient, "postalCode"),
    memberId: claimSnapshot.memberId || value(coverage, "memberId"),
    groupNumber: claimSnapshot.groupNumber || value(coverage, "groupNumber"),
    relationship: claimSnapshot.relationship || value(coverage, "relationship"),
    subscriberFirstName: claimSnapshot.subscriberFirstName || value(coverage, "subscriberFirstName"),
    subscriberLastName: claimSnapshot.subscriberLastName || value(coverage, "subscriberLastName"),
    subscriberDateOfBirth: claimSnapshot.subscriberDateOfBirth || value(coverage, "subscriberDateOfBirth"),
    subscriberSex: claimSnapshot.subscriberSex || value(coverage, "subscriberSex"),
    subscriberAddressLine1: claimSnapshot.subscriberAddressLine1 || value(coverage, "subscriberAddressLine1"),
    subscriberCity: claimSnapshot.subscriberCity || value(coverage, "subscriberCity"),
    subscriberState: claimSnapshot.subscriberState || value(coverage, "subscriberState"),
    subscriberPostalCode: claimSnapshot.subscriberPostalCode || value(coverage, "subscriberPostalCode"),
    dateOfService: value(claim, "dateOfService"),
    insuranceTypeCode: value(claim, "insuranceTypeCode"),
    otherPlanIndicator: billed.secondaryId || value(claim, "otherPlanIndicator") === "Y" ? "Y" : "N",
    employmentRelated: value(claim, "employmentRelated") || "N",
    autoAccidentRelated: value(claim, "autoAccidentRelated") || "N",
    autoAccidentState: value(claim, "autoAccidentState"),
    otherAccidentRelated: value(claim, "otherAccidentRelated") || "N",
    claimConditionCodes: list(claim.claimConditionCodes).join(", "),
    otherClaimIdQualifier: value(claim, "otherClaimIdQualifier"),
    otherClaimId: value(claim, "otherClaimId"),
    conditionDateQualifier: value(claim, "conditionDateQualifier"),
    conditionDate: value(claim, "conditionDate"),
    otherDateQualifier: value(claim, "otherDateQualifier"),
    otherDate: value(claim, "otherDate"),
    referringProviderQualifier: value(claim, "referringProviderQualifier"),
    referringOtherIdQualifier: value(claim, "referringOtherIdQualifier"),
    referringOtherId: value(claim, "referringOtherId"),
    additionalClaimInfoQualifier: value(claim, "additionalClaimInfoQualifier"),
    additionalClaimInfo: value(claim, "additionalClaimInfo"),
    unableToWorkFrom: value(claim, "unableToWorkFrom"),
    unableToWorkTo: value(claim, "unableToWorkTo"),
    hospitalizationFrom: value(claim, "hospitalizationFrom"),
    hospitalizationTo: value(claim, "hospitalizationTo"),
    outsideLabIndicator: value(claim, "outsideLabIndicator") || "N",
    outsideLabCharges: value(claim, "outsideLabCharges"),
    priorAuthorizationNumber: value(claim, "priorAuthorizationNumber"),
    federalTaxIdType: value(claim, "federalTaxIdType"),
    federalTaxIdNumber: value(claim, "federalTaxIdNumber"),
    patientSignatureOnFile: value(claim, "patientSignatureOnFile") || "Y",
    patientSignatureDate: value(claim, "patientSignatureDate"),
    insuredSignatureOnFile: value(claim, "insuredSignatureOnFile") || "Y",
    providerSignatureOnFile: value(claim, "providerSignatureOnFile") || "Y",
    providerSignatureDate: value(claim, "providerSignatureDate"),
    acceptAssignment: value(coverage, "acceptAssignment") === "no" ? "N" : "Y",
    serviceFacilityOtherIdQualifier: value(claim, "serviceFacilityOtherIdQualifier"),
    serviceFacilityOtherId: value(claim, "serviceFacilityOtherId"),
    billingProviderOtherIdQualifier: value(claim, "billingProviderOtherIdQualifier"),
    billingProviderOtherId: value(claim, "billingProviderOtherId"),
    icdIndicator: value(claim, "icdIndicator") || "0",
    diagnosisCodes: list(claim.diagnosisCodes).join(", "),
    billFrequencyCode: storedBillFrequencyCode(value(claim, "billFrequencyCode")) || "",
    originalReferenceNumber: value(claim, "originalReferenceNumber") || value(claim, "clearinghouseTrace"),
    correctionAction: previouslySubmitted && value(claim, "status") !== "rejected" ? "replacement" : "save",
    changeScope: "claim_only",
    reason: "",
  }));
  const [lines, setLines] = useState<ClaimEditorLine[]>(() => data.claimLines
    .filter((row) => value(row, "claimId") === claimId)
    .map((row) => {
      const line = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, item === null || item === undefined ? "" : String(item)]));
      if (!line.renderingOtherId && line.renderingOtherIdQualifier === "ZZ") line.renderingOtherId = value(provider, "taxonomyCode");
      return line;
    }));
  const correctionHistory = data.claimCorrections.filter((row) => value(row, "claimId") === claimId);
  const blocking = issues.filter((issue) => value(issue, "severity") === "error");
  const update = (name: string, next: string) => setDraft((current) => ({ ...current, [name]: next }));
  const applyBilledCoverage = (slot: "primary" | "secondary" | "tertiary", coverageId: string, extra?: Record<string, string>) => {
    const selected = data.coverages.find((row) => value(row, "id") === coverageId);
    setDraft((current) => ({
      ...current,
      ...(slot === "primary" ? { coverageId, ...billedCoverageFields(selected), ...(extra || {}) } : {}),
      ...(slot === "secondary" ? { secondaryCoverageId: coverageId, otherPlanIndicator: coverageId ? "Y" : "N" } : {}),
      ...(slot === "tertiary" ? { tertiaryCoverageId: coverageId } : {}),
    }));
  };
  const runFollowUp = async (id: string) => {
    if (!onFollowUpAction) return;
    if (id === "in_process") await onFollowUpAction("setClaimFollowUp", { id: claimId, followUpStatus: "in_process" });
    if (id === "mark_denied") await onFollowUpAction("setClaimFollowUp", { id: claimId, followUpStatus: "denied" });
    if (id === "rebill") await onFollowUpAction("rebillClaim", { id: claimId });
    if (id === "bill_sec") await onFollowUpAction("billClaimParty", { id: claimId, party: "sec" });
    if (id === "bill_ter") await onFollowUpAction("billClaimParty", { id: claimId, party: "ter" });
    if (id === "bill_patient") await onFollowUpAction("billClaimParty", { id: claimId, party: "patient" });
  };
  const save = async (rescrub: boolean) => {
    const result = await onSave({ ...draft, id: claimId, lines, followUpSave: mode === "followup" }, rescrub);
    if (result && rescrub && result.status === "clean") setSection("review");
  };
  const saveClaimNote = async () => {
    if (!onFollowUpAction || !noteDraft.trim()) return;
    const result = await onFollowUpAction("addClaimNote", { id: claimId, note: noteDraft.trim() });
    if (result) setNoteDraft("");
  };
  const claimPaymentsForEditor = (data.claimPayments || []).filter((row) => value(row, "claimId") === claimId);
  const denialLineActivity = (data.claimPaymentServiceLines || []).filter((row) => claimPaymentsForEditor.some((payment) => value(payment, "id") === value(row, "claimPaymentId")) && value(row, "denialCode"));
  const focusCmsBox = (rawBox: string) => {
    setSection(mode === "followup" ? "edit" : "form");
    window.setTimeout(() => {
      const normalized = rawBox.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const numeric = rawBox.match(/^\d+/)?.[0] || rawBox.match(/\d+/)?.[0] || "";
      const target = document.getElementById(`cms-box-${normalized}`) || (numeric ? document.getElementById(`cms-box-${numeric}`) : null);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      target.classList.add("claim-box-focus");
      window.setTimeout(() => target.classList.remove("claim-box-focus"), 1800);
    }, 60);
  };
  useEffect(() => {
    if (initialBox) focusCmsBox(initialBox);
  // The box is intentionally the only trigger; the editor owns the current claim instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBox]);

  return createPortal(
    <div className="claim-editor-backdrop" role="presentation">
      <section aria-labelledby="claim-editor-title" aria-modal="true" className={`claim-editor ${mode === "followup" ? "collection-claim-editor" : ""}`} role="dialog">
        <header className="claim-editor-header">
          <div className="claim-editor-heading-copy"><span className="eyebrow">{mode === "followup" ? "Collection Arena · claim follow-up" : "CMS-1500 correction workspace"}</span><h2 id="claim-editor-title">{value(claim, "claimNumber")} <span>· {value(claim, "patientName")}</span></h2><p>DOS {shortDate(draft.dateOfService)} · {value(claim, "payerName") || "Self pay"} · Charge {currency(value(claim, "totalCharge"))}{mode === "followup" ? ` · ${CLAIM_LIFECYCLE_LABELS[lifecycle]}` : ""}</p></div>
          <div className="claim-editor-header-status"><Status value={value(claim, "workflowStatus") || deriveWorkflowStatus(claim)} /><Status value={value(claim, "scrubResult") || value(claim, "scrubberStatus")} /><button aria-label="Close claim editor" onClick={onClose} type="button">×</button></div>
        </header>
        <div className="claim-editor-layout">
          <aside className="claim-editor-rail">
            <nav aria-label="Claim form sections">
              {[["form", mode === "followup" ? "Claim details" : "CMS-1500 claim form"], ["review", "Review & history"], ...(mode === "followup" ? [["notes", "Notes"], ["activity", "Activity"]] : [])].map(([key, label]) => <button className={section === key ? "active" : ""} key={key} onClick={() => setSection(key)} type="button"><span>{label}</span>{key === "review" && blocking.length ? <b>{blocking.length}</b> : null}{key === "activity" && denialLineActivity.length ? <b>{denialLineActivity.length}</b> : null}</button>)}
              {mode === "followup" && <button className={section === "edit" ? "active" : ""} onClick={() => setSection("edit")} type="button"><span>Edit claim</span></button>}
            </nav>
            <div className="claim-editor-findings"><strong>{blocking.length ? `${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"}` : "No blocking findings"}</strong>{issues.slice(0, 8).map((issue, index) => <button className={value(issue, "severity") === "error" ? "is-error" : "is-warning"} key={`${value(issue, "box")}-${index}`} onClick={() => focusCmsBox(value(issue, "box"))} type="button"><span>{scrubFindingLabel(issue)}</span>{value(issue, "message")}</button>)}</div>
          </aside>
          <main className="claim-editor-main">
            {section === "form" && mode === "followup" && <ClaimArenaClaimOverview data={data} claim={claim} patient={patient} payer={payer || {}} plan={plan || {}} coverage={coverage} lines={lines} payments={claimPaymentsForEditor} followUpStatus={value(claim, "followUpStatus")} followUpReason={followUpReason} nextAction={followUpActions[0]?.label || "Claim closed"} ageDays={ageDays} responseDays={responseDays} onEdit={() => setSection("edit")} />}
            {((section === "form" && mode !== "followup") || (section === "edit" && mode === "followup")) && <>
              {mode === "followup" && <button className="arena-back-button" onClick={() => setSection("form")} type="button">← Claim details</button>}
              {mode === "followup" && <ClaimFollowUpInsurancePanel
                data={data}
                dos={draft.dateOfService || value(claim, "dateOfService")}
                draft={draft}
                isSaving={isSaving}
                onApply={applyBilledCoverage}
                onCaptureCard={onCaptureCard}
                onCreateCoverage={onCreateCoverage}
                patientId={value(claim, "patientId")}
              />}
              <Cms1500DiagnosisServiceForm claim={claim} data={data} draft={draft} lines={lines} previouslySubmitted={previouslySubmitted} setLines={setLines} update={update} />
            </>}
            {section === "review" && <ClaimEditorSection description="Save & re-scrub is the only way a claim leaves Errors. A passing re-scrub moves it to Clean." title="Review, audit & submission">
              <div className="claim-review-summary"><article><span>Charge total</span><strong>{currency(lines.reduce((total, line) => total + Number(line.chargeAmount || 0), 0))}</strong></article><article><span>Service lines</span><strong>{lines.length}</strong></article><article><span>Corrections recorded</span><strong>{correctionHistory.length}</strong></article><article><span>Blocking findings</span><strong>{blocking.length}</strong></article></div>
              {previouslySubmitted && <div className="claim-resubmission"><strong>Previously submitted claim</strong><p>Box 22 is set to {draft.correctionAction === "void" ? "void / cancel (8)" : draft.correctionAction === "replacement" ? "replacement (7)" : "clearinghouse correction"}{draft.originalReferenceNumber ? ` · Original reference ${draft.originalReferenceNumber}` : ""}. Return to the CMS-1500 form to change it.</p></div>}
              <label className="claim-editor-diagnoses"><span>Correction reason / internal note</span><textarea onChange={(event) => update("reason", event.target.value)} placeholder="Why this claim was changed" value={draft.reason} /></label>
              <div className="claim-review-findings">{issues.length ? issues.map((issue, index) => <article key={index}><Status value={value(issue, "severity")} /><div><strong>{scrubFindingLabel(issue)} · {value(issue, "category") || "Required fields"} · {value(issue, "field")}</strong><p>{value(issue, "message")} {value(issue, "suggestion")}</p><small>{value(issue, "blocking") === "false" ? "Non-blocking" : "Blocking"}{value(issue, "identifiedAt") ? ` · ${shortDate(value(issue, "identifiedAt"), true)}` : ""}</small></div></article>) : <p>Run Save & re-scrub to validate the corrected claim.</p>}</div>
              <div className="claim-workflow-history">
                <strong>Claim workflow history</strong>
                {workflowEvents.length ? (
                  <ol>
                    {workflowEvents.map((event) => (
                      <li key={value(event, "id")}>
                        <span>{shortDate(value(event, "createdAt"), true)}</span>
                        <strong>{value(event, "action")}</strong>
                        <em>{value(event, "previousStatus") || "—"} → {value(event, "newStatus")}</em>
                        <small>{value(event, "actorName")}{value(event, "reason") ? ` · ${value(event, "reason")}` : ""}</small>
                      </li>
                    ))}
                  </ol>
                ) : <p>No workflow events recorded yet.</p>}
              </div>
            </ClaimEditorSection>}
            {section === "notes" && mode === "followup" && <ClaimEditorSection description="Internal notes stay with this claim and are recorded in the audit trail." title="Claim notes">
              <label className="claim-editor-diagnoses"><span>Add a note</span><textarea onChange={(event) => setNoteDraft(event.target.value)} placeholder="Document payer calls, patient contact, correction details, or next steps" value={noteDraft} /></label>
              <button className="primary-button" disabled={isSaving || !noteDraft.trim()} onClick={() => void saveClaimNote()} type="button">Save note</button>
              <div className="claim-workflow-history">
                <strong>Saved notes</strong>
                {workflowEvents.filter((event) => value(event, "action") === "NOTE").length ? <ol>{workflowEvents.filter((event) => value(event, "action") === "NOTE").map((event) => <li key={value(event, "id")}><span>{shortDate(value(event, "createdAt"), true)}</span><strong>Note</strong><small>{value(event, "actorName")}{value(event, "reason") ? ` · ${value(event, "reason")}` : ""}</small></li>)}</ol> : <p>No notes recorded yet.</p>}
              </div>
            </ClaimEditorSection>}
            {section === "activity" && mode === "followup" && <ClaimEditorSection description="CPT-level denial and payment activity explains what remains unpaid and what should happen next." title="Denial & claim activity">
              <div className="claim-review-summary"><article><span>Denial lines</span><strong>{denialLineActivity.length}</strong></article><article><span>Payment records</span><strong>{claimPaymentsForEditor.length}</strong></article><article><span>Claim balance</span><strong>{currency(value(claim, "remainingBalance"))}</strong></article><article><span>Next action</span><strong>{followUpActions[0]?.label || "Claim closed"}</strong></article></div>
              {denialLineActivity.length ? <div className="claim-activity-table"><table><thead><tr><th>CPT</th><th>DOS</th><th>Denial</th><th>Charge</th><th>Paid</th><th>Adjustment</th><th>Next action</th></tr></thead><tbody>{denialLineActivity.map((line, index) => <tr key={value(line, "id") || index}><td>{value(line, "procedureCode") || value(line, "cptCode") || "—"}</td><td>{shortDate(value(line, "serviceDate") || value(line, "dateOfService") || value(claim, "dateOfService"))}</td><td><strong className="claim-denial-code">{value(line, "denialCode")}</strong></td><td>{currency(value(line, "chargeAmount"))}</td><td>{currency(value(line, "paidAmount"))}</td><td>{currency(value(line, "adjustmentAmount"))}</td><td>{value(line, "nextAction") || followUpActions[0]?.label || "Review"}</td></tr>)}</tbody></table></div> : <p className="claim-empty-state">No CPT-level denial lines are linked to this claim.</p>}
              <div className="claim-workflow-history"><strong>Recent activity</strong>{workflowEvents.length ? <ol>{workflowEvents.map((event) => <li key={value(event, "id")}><span>{shortDate(value(event, "createdAt"), true)}</span><strong>{value(event, "action")}</strong><em>{value(event, "previousStatus") || "—"} → {value(event, "newStatus") || "—"}</em><small>{value(event, "actorName")}{value(event, "reason") ? ` · ${value(event, "reason")}` : ""}</small></li>)}</ol> : <p>No activity recorded yet.</p>}</div>
            </ClaimEditorSection>}
          </main>
        </div>
        <footer className="claim-editor-footer">
          {mode === "followup" ? (
            <>
              <div>
                <button className="primary-button" disabled={isSaving} onClick={() => void save(false)} type="button">{isSaving ? "Saving…" : "Save"}</button>
                {followUpActions.map((item) => <button disabled={isSaving} key={item.id} onClick={() => void runFollowUp(item.id)} type="button">{item.label}</button>)}
              </div>
              <div>
                {inquiryHref && <a className="secondary-button" href={inquiryHref}>Account</a>}
              </div>
            </>
          ) : (
            <>
              <div><button className="secondary-button" disabled={isSaving} onClick={() => void save(false)} type="button">Save draft</button><button className="primary-button" disabled={isSaving} onClick={() => void save(true)} type="button">{isSaving ? "Saving…" : "Save & re-scrub"}</button></div>
              <div>{value(claim, "submissionMethod") === "paper" && <button disabled={isSaving || value(claim, "scrubberStatus") !== "clean"} onClick={onPrint} type="button">Print CMS-1500</button>}{value(claim, "submissionMethod") === "electronic" && <><button disabled={value(claim, "scrubberStatus") !== "clean"} onClick={onDownload} type="button">Download 837</button><button className="primary-button" disabled={isSaving || value(claim, "scrubberStatus") !== "clean"} onClick={onSubmit} type="button">{previouslySubmitted ? "Submit corrected claim" : "Submit claim"}</button></>}</div>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const CMS_DIAGNOSIS_LETTERS = "ABCDEFGHIJKL".split("");

function Cms1500DiagnosisServiceForm({
  claim, data, draft, lines, previouslySubmitted, setLines, update,
}: {
  claim: DataRow;
  data: WorkspaceData;
  draft: Record<string, string>;
  lines: ClaimEditorLine[];
  previouslySubmitted: boolean;
  setLines: (next: ClaimEditorLine[] | ((current: ClaimEditorLine[]) => ClaimEditorLine[])) => void;
  update: (name: string, value: string) => void;
}) {
  const provider = data.providers.find((row) => value(row, "id") === value(claim, "providerId")) || {};
  const facility = data.facilities.find((row) => value(row, "id") === value(claim, "facilityId")) || {};
  const referringProvider = data.referringProviders.find((row) => value(row, "id") === value(claim, "referringProviderId")) || {};
  const providerName = [value(provider, "firstName"), value(provider, "lastName"), value(provider, "credentials")].filter(Boolean).join(" ");
  const referringName = [value(referringProvider, "firstName"), value(referringProvider, "lastName"), value(referringProvider, "credentials")].filter(Boolean).join(" ");
  const configured = (category: string, fallback: [string, string][]) => {
    const options = data.claimConfigurationValues
      .filter((row) => value(row, "category") === category && value(row, "status") === "active")
      .map((row) => [value(row, "code"), `${value(row, "code")} · ${value(row, "displayName")}`] as [string, string]);
    return options.length ? options : fallback;
  };
  const insuranceTypes = configured("insurance_type", [["medicare", "Medicare"], ["medicaid", "Medicaid"], ["tricare", "TRICARE"], ["champva", "CHAMPVA"], ["group", "Group health plan"], ["feca", "FECA"], ["black_lung", "Black Lung"], ["other", "Other"]]);
  const otherClaimQualifiers = configured("other_claim_id", [["Y4", "Y4 · Property/casualty claim number"]]);
  const conditionDateQualifiers = configured("condition_date", [["431", "431 · Onset"], ["484", "484 · LMP"]]);
  const otherDateQualifiers = configured("other_date", [["454", "454 · Initial treatment"], ["304", "304 · Latest visit"], ["453", "453 · Acute manifestation"], ["439", "439 · Accident"], ["455", "455 · Last X-ray"], ["471", "471 · Prescription"], ["090", "090 · Report start"], ["091", "091 · Report end"], ["444", "444 · First visit"]]);
  const providerIdQualifiers = configured("box17a_identifier", [["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial"], ["N5", "N5 · Plan network ID"], ["SY", "SY · SSN"], ["X5", "X5 · Industrial accident"], ["ZZ", "ZZ · Taxonomy"]]);
  const epsdtReasons = configured("epsdt_reason", [["AV", "AV · Available, not used"], ["S2", "S2 · Under treatment"], ["ST", "ST · New service requested"], ["NU", "NU · Not used"]]);
  const renderingIdQualifiers = configured("rendering_identifier", [["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial"], ["N5", "N5 · Plan network ID"], ["SY", "SY · SSN"], ["X5", "X5 · Industrial accident"], ["ZZ", "ZZ · Taxonomy"]]);
  const facilityIdQualifiers = configured("facility_identifier", [["0B", "0B · State license"], ["G2", "G2 · Commercial"], ["LU", "LU · Location"]]);
  const billingIdQualifiers = configured("billing_identifier", [["0B", "0B · State license"], ["G2", "G2 · Commercial"], ["ZZ", "ZZ · Taxonomy"]]);
  const diagnoses = draft.diagnosisCodes.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean).slice(0, 12);
  const updateDiagnosis = (index: number, next: string) => {
    const normalized = next.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 10);
    if (!normalized && index < diagnoses.length - 1) return;
    if (!normalized && lines.some((line) => (line.diagnosisPointers || "").includes(CMS_DIAGNOSIS_LETTERS[index]))) return;
    const updated = [...diagnoses];
    updated[index] = normalized;
    update("diagnosisCodes", updated.filter(Boolean).join(", "));
  };
  const updateLine = (index: number, name: string, next: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [name]: next } : line));
  const addLine = () => setLines((current) => [...current, {
    id: "",
    claimId: draft.id,
    lineNumber: String(current.length + 1),
    procedureCode: "",
    modifiers: "",
    diagnosisPointers: diagnoses.length ? "A" : "",
    units: "1",
    chargeAmount: "0.00",
    placeOfService: "11",
    renderingNpi: "",
    renderingOtherIdQualifier: "",
    renderingOtherId: "",
    emergencyIndicator: "",
    epsdtReasonCode: "",
    serviceDateFrom: draft.dateOfService,
    serviceDateTo: draft.dateOfService,
  }]);
  const togglePointer = (lineIndex: number, letter: string) => {
    const current = (lines[lineIndex]?.diagnosisPointers || "").replace(/[^A-L]/g, "").split("");
    const next = current.includes(letter) ? current.filter((item) => item !== letter) : [...current, letter];
    updateLine(lineIndex, "diagnosisPointers", next.sort((left, right) => CMS_DIAGNOSIS_LETTERS.indexOf(left) - CMS_DIAGNOSIS_LETTERS.indexOf(right)).slice(0, 4).join(""));
  };
  const paperRows = Array.from({ length: Math.max(6, lines.length) }, (_, index) => lines[index] || null);

  const totalCharge = lines.reduce((total, line) => total + Number(line.chargeAmount || 0), 0);

  return <section className="cms1500-workspace" aria-label="Editable CMS-1500 claim form">
    <header className="cms1500-workspace-heading">
      <div><span>Health Insurance Claim Form</span><h3>CMS-1500 · Editable Boxes 1–33</h3><p>Correct the claim directly where the value appears on the paper form. Diagnosis pointers remain connected to each service line.</p></div>
      <label><span>Apply patient / insurance edits</span><select onChange={(event) => update("changeScope", event.target.value)} value={draft.changeScope}><option value="claim_only">This claim only</option><option value="claim_and_master">Claim + patient/insurance master</option></select></label>
    </header>
    <p className="cms1500-scope-note">All changes are audited. Updating the master is explicit and never rewrites the signed clinical note.</p>
    <div className="cms1500-paper-scroll">
      <div className="cms1500-paper">
        <section className="cms1500-upper-form" aria-label="CMS-1500 patient and claim information">
          <div className="cms1500-form-row cms1500-row-1">
            <Cms1500PaperBox box="1" label="TYPE OF HEALTH INSURANCE"><select aria-label="Insurance type" onChange={(event) => update("insuranceTypeCode", event.target.value)} value={draft.insuranceTypeCode}>{insuranceTypes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Cms1500PaperBox>
            <Cms1500PaperBox box="1a" label="INSURED'S I.D. NUMBER"><input aria-label="Member ID" onChange={(event) => update("memberId", event.target.value)} value={draft.memberId} /></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-2">
            <Cms1500PaperBox box="2" label="PATIENT'S NAME (Last, First, Middle)"><div className="cms1500-inline-fields three"><input aria-label="Patient last name" onChange={(event) => update("patientLastName", event.target.value)} placeholder="Last" value={draft.patientLastName} /><input aria-label="Patient first name" onChange={(event) => update("patientFirstName", event.target.value)} placeholder="First" value={draft.patientFirstName} /><input aria-label="Patient middle name" onChange={(event) => update("patientMiddleName", event.target.value)} placeholder="Middle" value={draft.patientMiddleName} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="3" label="PATIENT'S BIRTH DATE / SEX"><div className="cms1500-inline-fields"><input aria-label="Patient birth date" onChange={(event) => update("patientDateOfBirth", event.target.value)} type="date" value={draft.patientDateOfBirth} /><select aria-label="Patient sex" onChange={(event) => update("patientSex", event.target.value)} value={draft.patientSex}><option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option></select></div></Cms1500PaperBox>
            <Cms1500PaperBox box="4" label="INSURED'S NAME (Last, First)"><div className="cms1500-inline-fields"><input aria-label="Subscriber last name" onChange={(event) => update("subscriberLastName", event.target.value)} placeholder="Last" value={draft.subscriberLastName} /><input aria-label="Subscriber first name" onChange={(event) => update("subscriberFirstName", event.target.value)} placeholder="First" value={draft.subscriberFirstName} /></div></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-3">
            <Cms1500PaperBox box="5" label="PATIENT'S ADDRESS"><input aria-label="Patient street address" onChange={(event) => update("patientAddressLine1", event.target.value)} placeholder="Street" value={draft.patientAddressLine1} /><div className="cms1500-inline-fields address"><input aria-label="Patient city" onChange={(event) => update("patientCity", event.target.value)} placeholder="City" value={draft.patientCity} /><input aria-label="Patient state" maxLength={2} onChange={(event) => update("patientState", event.target.value.toUpperCase())} placeholder="State" value={draft.patientState} /><input aria-label="Patient ZIP" onChange={(event) => update("patientPostalCode", event.target.value)} placeholder="ZIP" value={draft.patientPostalCode} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="6" label="PATIENT RELATIONSHIP TO INSURED"><select aria-label="Relationship to insured" onChange={(event) => update("relationship", event.target.value)} value={draft.relationship}><option value="self">Self</option><option value="spouse">Spouse</option><option value="child">Child</option><option value="other">Other</option></select></Cms1500PaperBox>
            <Cms1500PaperBox box="7" label="INSURED'S ADDRESS"><input aria-label="Subscriber street address" onChange={(event) => update("subscriberAddressLine1", event.target.value)} placeholder="Street" value={draft.subscriberAddressLine1} /><div className="cms1500-inline-fields address"><input aria-label="Subscriber city" onChange={(event) => update("subscriberCity", event.target.value)} placeholder="City" value={draft.subscriberCity} /><input aria-label="Subscriber state" maxLength={2} onChange={(event) => update("subscriberState", event.target.value.toUpperCase())} placeholder="State" value={draft.subscriberState} /><input aria-label="Subscriber ZIP" onChange={(event) => update("subscriberPostalCode", event.target.value)} placeholder="ZIP" value={draft.subscriberPostalCode} /></div></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-4">
            <Cms1500PaperBox box="9" label="OTHER HEALTH BENEFIT PLAN"><select aria-label="Other health benefit plan" onChange={(event) => update("otherPlanIndicator", event.target.value)} value={draft.otherPlanIndicator}><option value="N">No</option><option value="Y">Yes</option></select></Cms1500PaperBox>
            <Cms1500PaperBox box="10" label="IS PATIENT'S CONDITION RELATED TO"><div className="cms1500-condition-grid"><label>10a Employment<select onChange={(event) => update("employmentRelated", event.target.value)} value={draft.employmentRelated}><option value="N">No</option><option value="Y">Yes</option></select></label><label>10b Auto accident<select onChange={(event) => update("autoAccidentRelated", event.target.value)} value={draft.autoAccidentRelated}><option value="N">No</option><option value="Y">Yes</option></select></label><label>State<input aria-label="Auto accident state" maxLength={2} onChange={(event) => update("autoAccidentState", event.target.value.toUpperCase())} value={draft.autoAccidentState} /></label><label>10c Other accident<select onChange={(event) => update("otherAccidentRelated", event.target.value)} value={draft.otherAccidentRelated}><option value="N">No</option><option value="Y">Yes</option></select></label></div><input aria-label="NUCC condition codes" onChange={(event) => update("claimConditionCodes", event.target.value.toUpperCase())} placeholder="10d · NUCC condition codes, comma separated" value={draft.claimConditionCodes} /></Cms1500PaperBox>
            <Cms1500PaperBox box="11" label="INSURED'S POLICY GROUP / FECA NUMBER"><input aria-label="Group number" onChange={(event) => update("groupNumber", event.target.value)} value={draft.groupNumber} /><div className="cms1500-inline-fields"><input aria-label="Subscriber birth date" onChange={(event) => update("subscriberDateOfBirth", event.target.value)} type="date" value={draft.subscriberDateOfBirth} /><select aria-label="Subscriber sex" onChange={(event) => update("subscriberSex", event.target.value)} value={draft.subscriberSex}><option value="">Sex</option><option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option></select></div><div className="cms1500-inline-fields qualifier"><select aria-label="Other claim ID qualifier" onChange={(event) => update("otherClaimIdQualifier", event.target.value)} value={draft.otherClaimIdQualifier}><option value="">11b qualifier</option>{otherClaimQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Other claim ID" onChange={(event) => update("otherClaimId", event.target.value)} placeholder="Other claim ID" value={draft.otherClaimId} /></div></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-5">
            <Cms1500PaperBox box="12" label="PATIENT'S OR AUTHORIZED PERSON'S SIGNATURE"><div className="cms1500-inline-fields"><select aria-label="Patient signature on file" onChange={(event) => update("patientSignatureOnFile", event.target.value)} value={draft.patientSignatureOnFile}><option value="Y">Signature on file</option><option value="N">No signature</option></select><input aria-label="Patient signature date" onChange={(event) => update("patientSignatureDate", event.target.value)} type="date" value={draft.patientSignatureDate} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="13" label="INSURED'S OR AUTHORIZED PERSON'S SIGNATURE"><select aria-label="Insured signature on file" onChange={(event) => update("insuredSignatureOnFile", event.target.value)} value={draft.insuredSignatureOnFile}><option value="Y">Signature on file</option><option value="N">No signature</option></select></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-6">
            <Cms1500PaperBox box="14" label="DATE OF CURRENT ILLNESS, INJURY, OR PREGNANCY"><div className="cms1500-inline-fields qualifier"><select aria-label="Condition date qualifier" onChange={(event) => update("conditionDateQualifier", event.target.value)} value={draft.conditionDateQualifier}><option value="">Qualifier</option>{conditionDateQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Condition date" onChange={(event) => update("conditionDate", event.target.value)} type="date" value={draft.conditionDate} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="15" label="OTHER DATE"><div className="cms1500-inline-fields qualifier"><select aria-label="Other date qualifier" onChange={(event) => update("otherDateQualifier", event.target.value)} value={draft.otherDateQualifier}><option value="">Qualifier</option>{otherDateQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Other date" onChange={(event) => update("otherDate", event.target.value)} type="date" value={draft.otherDate} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="16" label="DATES PATIENT UNABLE TO WORK"><div className="cms1500-inline-fields"><input aria-label="Unable to work from" onChange={(event) => update("unableToWorkFrom", event.target.value)} type="date" value={draft.unableToWorkFrom} /><input aria-label="Unable to work to" onChange={(event) => update("unableToWorkTo", event.target.value)} type="date" value={draft.unableToWorkTo} /></div></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-7">
            <Cms1500PaperBox box="17" label="NAME OF REFERRING / ORDERING / SUPERVISING PROVIDER"><div className="cms1500-inline-fields provider"><select aria-label="Referring provider qualifier" onChange={(event) => update("referringProviderQualifier", event.target.value)} value={draft.referringProviderQualifier}><option value="">Qualifier</option><option value="DN">DN · Referring</option><option value="DK">DK · Ordering</option><option value="DQ">DQ · Supervising</option></select><input aria-label="Referring provider name" readOnly value={referringName} /></div><div className="cms1500-inline-fields qualifier"><select aria-label="Referring other ID qualifier" onChange={(event) => update("referringOtherIdQualifier", event.target.value)} value={draft.referringOtherIdQualifier}><option value="">17a qual</option>{providerIdQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Referring other ID" onChange={(event) => update("referringOtherId", event.target.value)} placeholder="17a other ID" value={draft.referringOtherId} /><input aria-label="Referring provider NPI" readOnly value={value(referringProvider, "npi")} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="18" label="HOSPITALIZATION DATES RELATED TO CURRENT SERVICES"><div className="cms1500-inline-fields"><input aria-label="Hospitalization from" onChange={(event) => update("hospitalizationFrom", event.target.value)} type="date" value={draft.hospitalizationFrom} /><input aria-label="Hospitalization to" onChange={(event) => update("hospitalizationTo", event.target.value)} type="date" value={draft.hospitalizationTo} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="19" label="ADDITIONAL CLAIM INFORMATION"><div className="cms1500-inline-fields qualifier"><input aria-label="Additional claim information qualifier" onChange={(event) => update("additionalClaimInfoQualifier", event.target.value.toUpperCase())} placeholder="Qualifier" value={draft.additionalClaimInfoQualifier} /><input aria-label="Additional claim information" onChange={(event) => update("additionalClaimInfo", event.target.value)} value={draft.additionalClaimInfo} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="20" label="OUTSIDE LAB?"><div className="cms1500-inline-fields"><select aria-label="Outside lab indicator" onChange={(event) => update("outsideLabIndicator", event.target.value)} value={draft.outsideLabIndicator}><option value="N">No</option><option value="Y">Yes</option></select><input aria-label="Outside lab charges" min="0" onChange={(event) => update("outsideLabCharges", event.target.value)} placeholder="$ Charges" step="0.01" type="number" value={draft.outsideLabCharges} /></div></Cms1500PaperBox>
          </div>
        </section>
        <section className="cms1500-box cms1500-box-21" id="cms-box-21">
          <header><strong>21.</strong><span>DIAGNOSIS OR NATURE OF ILLNESS OR INJURY</span><small>Relate A–L to service line below (24E)</small></header>
          <div className="cms1500-diagnosis-grid">
            {CMS_DIAGNOSIS_LETTERS.map((letter, index) => <label className={index > diagnoses.length ? "locked" : ""} key={letter}><b>{letter}.</b><input aria-label={`Diagnosis ${letter}`} disabled={index > diagnoses.length} onChange={(event) => updateDiagnosis(index, event.target.value)} placeholder={index === diagnoses.length ? "Add diagnosis" : "ICD code"} value={diagnoses[index] || ""} /></label>)}
          </div>
        </section>
        <div className="cms1500-right-stack">
          <section className="cms1500-box cms1500-box-22" id="cms-box-22"><header><strong>22.</strong><span>RESUBMISSION CODE / ORIGINAL REF. NO.</span></header><div><select aria-label="Resubmission action" disabled={!previouslySubmitted} onChange={(event) => update("correctionAction", event.target.value)} value={draft.correctionAction}><option value="save">Original / clearinghouse correction</option><option value="replacement">7 · Replacement</option><option value="void">8 · Void / cancel</option></select><input aria-label="Original reference number" disabled={!previouslySubmitted} onChange={(event) => update("originalReferenceNumber", event.target.value)} placeholder="Original reference number" value={draft.originalReferenceNumber} /></div></section>
          <section className="cms1500-box cms1500-box-23" id="cms-box-23"><header><strong>23.</strong><span>PRIOR AUTHORIZATION NUMBER</span></header><input aria-label="Prior authorization number" onChange={(event) => update("priorAuthorizationNumber", event.target.value)} value={draft.priorAuthorizationNumber} /></section>
        </div>
        <section className="cms1500-box cms1500-box-24" id="cms-box-24">
          <div className="cms1500-service-header">
            <span className="line">24.</span><span className="dates">A. DATE(S) OF SERVICE<small>From / To</small></span><span>B. PLACE<br />OF SERVICE</span><span>C.<br />EMG</span><span className="procedure">D. PROCEDURES, SERVICES, OR SUPPLIES<small>CPT/HCPCS · MODIFIERS</small></span><span>E. DIAGNOSIS<br />POINTER</span><span>F. $ CHARGES</span><span>G. DAYS<br />OR UNITS</span><span>H.<br />EPSDT</span><span>I.<br />ID QUAL</span><span>J. RENDERING<br />PROVIDER NPI / OTHER ID</span><span />
          </div>
          {paperRows.map((line, index) => line ? <div className="cms1500-service-row" key={line.id || `paper-${index}`}>
            <b className="line-number">{index + 1}</b>
            <div className="cms1500-date-pair"><input aria-label={`Line ${index + 1} service from date`} onChange={(event) => updateLine(index, "serviceDateFrom", event.target.value)} type="date" value={line.serviceDateFrom || draft.dateOfService} /><input aria-label={`Line ${index + 1} service to date`} onChange={(event) => updateLine(index, "serviceDateTo", event.target.value)} type="date" value={line.serviceDateTo || line.serviceDateFrom || draft.dateOfService} /></div>
            <input aria-label={`Line ${index + 1} place of service`} maxLength={2} onChange={(event) => updateLine(index, "placeOfService", event.target.value.replace(/\D/g, "").slice(0, 2))} value={line.placeOfService || "11"} />
            <select aria-label={`Line ${index + 1} emergency indicator`} onChange={(event) => updateLine(index, "emergencyIndicator", event.target.value)} value={line.emergencyIndicator || ""}><option value="">—</option><option value="Y">Y</option></select>
            <div className="cms1500-procedure-entry"><input aria-label={`Line ${index + 1} procedure code`} maxLength={7} onChange={(event) => updateLine(index, "procedureCode", event.target.value.toUpperCase())} placeholder="CPT/HCPCS" value={line.procedureCode || ""} /><input aria-label={`Line ${index + 1} modifiers`} onChange={(event) => updateLine(index, "modifiers", event.target.value.toUpperCase())} placeholder="Modifiers: 25, 59" value={line.modifiers || ""} /></div>
            <div className="cms1500-pointer-cell"><output aria-label={`Line ${index + 1} diagnosis pointer`}>{line.diagnosisPointers || "—"}</output><div>{diagnoses.map((code, diagnosisIndex) => { const letter = CMS_DIAGNOSIS_LETTERS[diagnosisIndex]; const active = (line.diagnosisPointers || "").includes(letter); return <button aria-pressed={active} className={active ? "active" : ""} key={letter} onClick={() => togglePointer(index, letter)} title={`${letter} · ${code}`} type="button">{letter}</button>; })}</div></div>
            <input aria-label={`Line ${index + 1} charge`} min="0" onChange={(event) => updateLine(index, "chargeAmount", event.target.value)} step="0.01" type="number" value={line.chargeAmount || "0.00"} />
            <input aria-label={`Line ${index + 1} units`} min="0" onChange={(event) => updateLine(index, "units", event.target.value)} type="number" value={line.units || "1"} />
            <select aria-label={`Line ${index + 1} EPSDT reason`} onChange={(event) => updateLine(index, "epsdtReasonCode", event.target.value)} title={epsdtReasons.find(([code]) => code === line.epsdtReasonCode)?.[1] || "EPSDT reason"} value={line.epsdtReasonCode || ""}><option value="">—</option>{epsdtReasons.map(([code]) => <option key={code} value={code}>{code}</option>)}</select>
            <select aria-label={`Line ${index + 1} rendering identifier qualifier`} onChange={(event) => updateLine(index, "renderingOtherIdQualifier", event.target.value)} title={renderingIdQualifiers.find(([code]) => code === line.renderingOtherIdQualifier)?.[1] || "Rendering identifier qualifier"} value={line.renderingOtherIdQualifier || ""}><option value="">—</option>{renderingIdQualifiers.map(([code]) => <option key={code} value={code}>{code}</option>)}</select>
            <div className="cms1500-rendering-id"><input aria-label={`Line ${index + 1} rendering NPI`} maxLength={10} onChange={(event) => updateLine(index, "renderingNpi", event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="NPI" value={line.renderingNpi || ""} /><input aria-label={`Line ${index + 1} rendering other ID or taxonomy`} maxLength={20} onChange={(event) => updateLine(index, "renderingOtherId", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder={line.renderingOtherIdQualifier === "ZZ" ? "Taxonomy" : "Other ID"} value={line.renderingOtherId || (line.renderingOtherIdQualifier === "ZZ" ? value(provider, "taxonomyCode") : "")} /></div>
            <button aria-label={`Remove service line ${index + 1}`} className="cms1500-remove-line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} type="button">×</button>
          </div> : <button className="cms1500-empty-row" key={`empty-${index}`} onClick={addLine} type="button"><b>{index + 1}</b><span>+ Add service line</span></button>)}
        </section>
        <section className="cms1500-bottom-form" aria-label="CMS-1500 provider and totals information">
          <div className="cms1500-form-row cms1500-row-8">
            <Cms1500PaperBox box="25" label="FEDERAL TAX I.D. NUMBER"><div className="cms1500-inline-fields qualifier"><select aria-label="Federal tax ID type" onChange={(event) => update("federalTaxIdType", event.target.value)} value={draft.federalTaxIdType}><option value="">Type</option><option value="EIN">EIN</option><option value="SSN">SSN</option></select><input aria-label="Federal tax ID" onChange={(event) => update("federalTaxIdNumber", event.target.value.replace(/\D/g, ""))} value={draft.federalTaxIdNumber} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="26" label="PATIENT'S ACCOUNT NO."><input aria-label="Patient account number" readOnly value={value(claim, "claimNumber")} /></Cms1500PaperBox>
            <Cms1500PaperBox box="27" label="ACCEPT ASSIGNMENT?"><select aria-label="Accept assignment" onChange={(event) => update("acceptAssignment", event.target.value)} value={draft.acceptAssignment}><option value="Y">Yes</option><option value="N">No</option></select></Cms1500PaperBox>
            <Cms1500PaperBox box="28" label="TOTAL CHARGE"><output>{currency(totalCharge)}</output></Cms1500PaperBox>
            <Cms1500PaperBox box="29" label="AMOUNT PAID"><output>{currency(value(claim, "totalPaid"))}</output></Cms1500PaperBox>
            <Cms1500PaperBox box="30" label="RESERVED FOR NUCC USE"><output>—</output></Cms1500PaperBox>
          </div>
          <div className="cms1500-form-row cms1500-row-9">
            <Cms1500PaperBox box="31" label="SIGNATURE OF PHYSICIAN OR SUPPLIER"><div className="cms1500-inline-fields"><select aria-label="Provider signature on file" onChange={(event) => update("providerSignatureOnFile", event.target.value)} value={draft.providerSignatureOnFile}><option value="Y">Signature on file</option><option value="N">No signature</option></select><input aria-label="Provider signature date" onChange={(event) => update("providerSignatureDate", event.target.value)} type="date" value={draft.providerSignatureDate} /></div><small>{providerName || "Rendering provider"}</small></Cms1500PaperBox>
            <Cms1500PaperBox box="32" label="SERVICE FACILITY LOCATION INFORMATION"><div className="cms1500-readonly-line">{value(facility, "name") || "Service facility"}<span>NPI {value(facility, "npi") || "—"}</span></div><div className="cms1500-inline-fields qualifier"><select aria-label="Facility other ID qualifier" onChange={(event) => update("serviceFacilityOtherIdQualifier", event.target.value)} value={draft.serviceFacilityOtherIdQualifier}><option value="">32b qual</option>{facilityIdQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Facility other ID" onChange={(event) => update("serviceFacilityOtherId", event.target.value)} placeholder="32b other ID" value={draft.serviceFacilityOtherId} /></div></Cms1500PaperBox>
            <Cms1500PaperBox box="33" label="BILLING PROVIDER INFO & PH #"><div className="cms1500-readonly-line">{providerName || "Billing provider"}<span>NPI {value(provider, "npi") || "—"}</span></div><div className="cms1500-inline-fields qualifier"><select aria-label="Billing provider other ID qualifier" onChange={(event) => update("billingProviderOtherIdQualifier", event.target.value)} value={draft.billingProviderOtherIdQualifier}><option value="">33b qual</option>{billingIdQualifiers.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><input aria-label="Billing provider other ID" onChange={(event) => update("billingProviderOtherId", event.target.value)} placeholder="33b other ID" value={draft.billingProviderOtherId} /></div></Cms1500PaperBox>
          </div>
        </section>
      </div>
    </div>
    <footer className="cms1500-mapping-key"><strong>Diagnosis mapping</strong>{diagnoses.length ? diagnoses.map((code, index) => <span key={code}>{CMS_DIAGNOSIS_LETTERS[index]} = {code}</span>) : <span>Add at least one diagnosis in Box 21.</span>}<small>Box 24E stores letters only—not diagnosis codes or commas.</small></footer>
  </section>;
}

function Cms1500PaperBox({ box, label, children }: { box: string; label: string; children: ReactNode }) {
  const normalizedBox = box.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <section className={`cms1500-paper-field cms1500-paper-field-${box.replace(/[^a-z0-9]/gi, "-")}`} id={`cms-box-${normalizedBox}`}><header><strong>{box}.</strong><span>{label}</span></header><div className="cms1500-paper-field-body">{children}</div></section>;
}

function ClaimArenaClaimOverview({
  data, claim, patient, payer, plan, coverage, lines, payments, followUpStatus, followUpReason, nextAction, ageDays, responseDays, onEdit,
}: {
  data: WorkspaceData;
  claim: DataRow;
  patient: DataRow;
  payer: DataRow;
  plan: DataRow;
  coverage: DataRow;
  lines: ClaimEditorLine[];
  payments: DataRow[];
  followUpStatus: string;
  followUpReason: string;
  nextAction: string;
  ageDays: number;
  responseDays: number;
  onEdit: () => void;
}) {
  const paid = payments.filter((payment) => value(payment, "postingStatus") === "posted").reduce((sum, payment) => sum + Number(value(payment, "paidAmount")), 0);
  const provider = data.providers.find((item) => value(item, "id") === value(claim, "providerId")) || {};
  return <ClaimEditorSection description="Review the account at a glance. Use Edit claim only when you need to make a correction." title="Claim overview">
    <div className="arena-claim-metrics">
      <article><span>Open balance</span><strong>{currency(value(claim, "remainingBalance"))}</strong></article>
      <article><span>Total charge</span><strong>{currency(value(claim, "totalCharge"))}</strong></article>
      <article><span>Payments posted</span><strong>{currency(paid)}</strong></article>
      <article><span>Response window</span><strong>{ageDays}d <small>/ {responseDays}d</small></strong></article>
    </div>
    <div className="arena-claim-overview-grid">
      <section><span className="eyebrow">Patient</span><h4>{[value(patient, "firstName"), value(patient, "middleName"), value(patient, "lastName")].filter(Boolean).join(" ") || value(claim, "patientName")}</h4><p>Patient ID · {value(patient, "accountNumber") || value(patient, "id") || "—"}</p><p>Date of birth · {shortDate(value(patient, "dateOfBirth"))}</p></section>
      <section><span className="eyebrow">Billed insurance</span><h4>{value(payer, "name") || "Self pay"}</h4><p>{value(plan, "name") || "Plan not listed"}</p><p>Member ID · {value(coverage, "memberId") || "—"}</p></section>
      <section><span className="eyebrow">Follow-up status</span><h4>{FOLLOW_UP_LABELS[followUpStatus] || "Due"}</h4><p>{followUpReason}</p><p>Suggested next action · {nextAction}</p></section>
    </div>
    <section className="arena-service-lines">
      <div className="arena-section-heading"><div><span className="eyebrow">Billed services</span><h4>Claim lines</h4></div><button className="secondary-button" onClick={onEdit} type="button">Edit claim</button></div>
      <div className="table-wrap"><table><thead><tr><th>CPT / HCPCS</th><th>Service date</th><th>Units</th><th>Charge</th><th>Rendering provider</th></tr></thead><tbody>
        {lines.length ? lines.map((line, index) => {
          const procedure = data.procedureCodes.find((item) => value(item, "code") === String(line.procedureCode || ""));
          return <tr key={String(line.id || index)}><td><strong>{String(line.procedureCode || "—")}</strong><small className="address">{value(procedure || {}, "description")}</small></td><td>{shortDate(line.serviceDateFrom || value(claim, "dateOfService"))}</td><td>{String(line.units || "1")}</td><td>{currency(line.chargeAmount)}</td><td>{[value(provider, "firstName"), value(provider, "lastName")].filter(Boolean).join(" ") || "—"}</td></tr>;
        }) : <tr><td colSpan={5}>No service lines on this claim.</td></tr>}
      </tbody></table></div>
    </section>
  </ClaimEditorSection>;
}

function ClaimEditorSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="claim-editor-section"><header><div><h3>{title}</h3><p>{description}</p></div></header>{children}</section>;
}

function NewEncounterPatientPicker({ data, isSaving, onPick }: { data: WorkspaceData; isSaving: boolean; onPick: (patientId: string) => void }) {
  const [query, setQuery] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const normalized = query.trim().toLowerCase();
  const matches = data.patients.filter((row) => {
    if (!normalized) return true;
    const haystack = `${value(row, "firstName")} ${value(row, "lastName")} ${value(row, "accountNumber")} ${value(row, "dateOfBirth")} ${value(row, "phone")}`.toLowerCase();
    return haystack.includes(normalized);
  }).slice(0, 40);

  return (
    <div className="new-encounter-picker">
      <section className="new-encounter-picker-hero">
        <span className="eyebrow">New encounter</span>
        <h3>Search a patient to open the visit</h3>
        <p>Today’s appointment opens that visit. Otherwise a draft visit starts with the default provider and facility.</p>
        <label className="new-encounter-search">
          <span>⌕</span>
          <input
            autoFocus
            aria-label="Search patients"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, MRN, DOB or phone"
            value={query}
          />
        </label>
      </section>
      <div className="new-encounter-results">
        {matches.length ? matches.map((patient) => {
          const patientId = value(patient, "id");
          const appointment = data.appointments.find((row) =>
            value(row, "patientId") === patientId
            && value(row, "startAt").slice(0, 10) === today
            && !["cancelled", "no_show"].includes(value(row, "status")),
          );
          const draft = data.encounters.find((row) =>
            value(row, "patientId") === patientId
            && value(row, "status") === "draft"
            && value(row, "dateOfService") === today,
          );
          const hint = appointment
            ? `Today’s appointment · ${shortDate(value(appointment, "startAt"), true)}`
            : draft
              ? "Open today’s draft visit"
              : "Start new draft visit";
          return (
            <button disabled={isSaving} key={patientId} onClick={() => onPick(patientId)} type="button">
              <span className="clinical-patient-avatar">{`${value(patient, "firstName").slice(0, 1)}${value(patient, "lastName").slice(0, 1)}` || "PT"}</span>
              <span>
                <strong>{value(patient, "firstName")} {value(patient, "lastName")}</strong>
                <small>MRN {value(patient, "accountNumber")} · DOB {shortDate(value(patient, "dateOfBirth"))} · {value(patient, "sex")}</small>
              </span>
              <em>{hint}</em>
            </button>
          );
        }) : <div className="clinical-worklist-empty"><strong>No patients match</strong><span>Try another name, MRN or date of birth.</span></div>}
      </div>
    </div>
  );
}

function ClinicalCommandCenter({ data, isSaving, onVitals, onSoap }: { data: WorkspaceData; isSaving: boolean; onVitals: (appointment: DataRow) => void; onSoap: (appointment: DataRow) => void }) {
  const [activeStage, setActiveStage] = useState("checked_in");
  const currentDate = new Date();
  const today = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
  const todaysAppointments = data.appointments.filter((appointment) => value(appointment, "startAt").slice(0, 10) === today && !["cancelled", "no_show"].includes(value(appointment, "status")));
  const encounterFor = (appointment: DataRow) => data.encounters.find((encounter) => value(encounter, "appointmentId") === value(appointment, "id"));
  const stageFor = (appointment: DataRow) => {
    const encounter = encounterFor(appointment);
    const flow = value(appointment, "flowStatus") || "not_arrived";
    if (flow === "checked_out" || ["signed", "ready_to_bill", "billed"].includes(value(encounter || {}, "status"))) return "completed";
    if (flow === "consultation_ended") return "signature";
    if (flow === "consultation_started") return "soap";
    if (flow === "ready_for_provider") return "ready";
    if (["checked_in", "waiting", "roomed"].includes(flow)) return "checked_in";
    return "scheduled";
  };
  const stages = [
    { key: "scheduled", label: "Expected", helper: "Scheduled / arrived" },
    { key: "checked_in", label: "Checked in", helper: "Vitals pending" },
    { key: "ready", label: "Ready", helper: "Provider can begin" },
    { key: "soap", label: "In SOAP", helper: "Consultation active" },
    { key: "signature", label: "Needs signature", helper: "Provider completion" },
    { key: "completed", label: "Completed", helper: "Signed or checked out" },
  ];
  const counts = Object.fromEntries(stages.map((stage) => [stage.key, todaysAppointments.filter((appointment) => stageFor(appointment) === stage.key).length]));
  const visible = todaysAppointments.filter((appointment) => stageFor(appointment) === activeStage);
  const waitingPatients = todaysAppointments
    .filter((appointment) => ["checked_in", "ready"].includes(stageFor(appointment)))
    .sort((left, right) => {
      const readinessDifference = Number(stageFor(right) === "ready") - Number(stageFor(left) === "ready");
      if (readinessDifference) return readinessDifference;
      return (value(left, "arrivedAt") || value(left, "startAt")).localeCompare(value(right, "arrivedAt") || value(right, "startAt"));
    });
  const nextPatient = waitingPatients[0];
  const waitingSince = nextPatient ? value(nextPatient, "arrivedAt") || value(nextPatient, "checkedInAt") || value(nextPatient, "startAt") : "";
  const primaryAction = (appointment: DataRow) => {
    const stage = stageFor(appointment);
    if (stage === "scheduled") return { label: "Open scheduler", run: null };
    if (stage === "checked_in") return { label: "Record vitals", run: () => onVitals(appointment) };
    if (stage === "ready") return { label: "Start SOAP", run: () => onSoap(appointment) };
    if (stage === "soap") return { label: "Continue SOAP", run: () => onSoap(appointment) };
    if (stage === "signature") return { label: "Review & sign", run: () => onSoap(appointment) };
    return { label: "Review note", run: () => onSoap(appointment) };
  };

  return <div className="clinical-command-center">
    <section className="clinical-flow-overview"><div><span className="eyebrow">Today’s care flow</span><h2>Move each patient from intake to a signed note</h2><p>One connected workflow for front desk, clinical staff and providers.</p></div><div className="clinical-flow-path">{["Checked in", "Vitals", "Ready", "SOAP", "Sign", "Billing"].map((step, index) => <span key={step}><b>{index + 1}</b>{step}</span>)}</div></section>
    <section className="clinical-now-summary">
      <article><span>Expected today</span><strong>{counts.scheduled || 0}</strong><small>Not checked in yet</small></article>
      <article><span>Waiting to be seen</span><strong>{waitingPatients.length}</strong><small>Checked in or ready</small></article>
      <article className="clinical-next-patient"><span>Next patient</span>{nextPatient ? <><strong>{value(nextPatient, "patientName")}</strong><small>{stageFor(nextPatient) === "ready" ? "Ready for provider" : "Vitals pending"}{waitingSince ? ` · since ${shortDate(waitingSince, true)}` : ""}</small></> : <><strong>Queue clear</strong><small>No patient is currently waiting</small></>}</article>
      <article><span>With provider</span><strong>{counts.soap || 0}</strong><small>SOAP in progress</small></article>
    </section>
    <nav aria-label="Clinical patient stages" className="clinical-stage-tabs">{stages.map((stage) => <button aria-pressed={activeStage === stage.key} className={activeStage === stage.key ? "active" : ""} key={stage.key} onClick={() => setActiveStage(stage.key)} type="button"><span><strong>{stage.label}</strong><small>{stage.helper}</small></span><b>{counts[stage.key] || 0}</b></button>)}</nav>
    <section className="clinical-patient-worklist"><header><div><span className="eyebrow">{stages.find((stage) => stage.key === activeStage)?.label}</span><h2>{visible.length} patient{visible.length === 1 ? "" : "s"}</h2></div><small>{activeStage === "scheduled" ? "Check patients in from Scheduler" : today}</small></header>{visible.length ? <div>{visible.map((appointment) => { const encounter = encounterFor(appointment); const action = primaryAction(appointment); const patient = data.patients.find((item) => value(item, "id") === value(appointment, "patientId")); const initials = `${value(patient || {}, "firstName").slice(0, 1)}${value(patient || {}, "lastName").slice(0, 1)}` || "PT"; return <article key={value(appointment, "id")}><span className="clinical-patient-avatar">{initials}</span><div className="clinical-patient-identity"><strong>{value(appointment, "patientName")}</strong><small>{shortDate(value(appointment, "startAt"), true)} · {value(appointment, "providerName")}</small></div><div className="clinical-patient-context"><span>{value(appointment, "roomName") || (activeStage === "scheduled" ? "Not checked in" : "Room pending")}</span><small>{value(appointment, "reason") || value(appointment, "appointmentType")}</small></div><Status value={value(appointment, "flowStatus")} />{action.run ? <button className="clinical-worklist-action" disabled={isSaving} onClick={action.run} type="button">{action.label} →</button> : <Link className="clinical-worklist-action" href="/scheduler">{action.label} →</Link>}{encounter && <Link href={`/chart?patientId=${encodeURIComponent(value(appointment, "patientId"))}`}>Chart</Link>}</article>; })}</div> : <div className="clinical-worklist-empty"><strong>No patients in this stage</strong><span>{activeStage === "scheduled" ? "All expected patients have been checked in or completed." : "Patients move here automatically as staff complete each preceding step."}</span></div>}</section>
  </div>;
}

function SummaryCards({ cards }: { cards: string[][] }) {
  return <section className="stats-grid">{cards.map(([label, metric, description]) => <article key={label}><span>{label}</span><strong className={metric === "Ready" || metric === "Connected" || metric === "Enabled" ? "health-value" : ""}>{metric}</strong><small>{description}</small></article>)}</section>;
}

function TablePanel({ title, description, search, setSearch, children }: { title: string; description: string; search?: string; setSearch?: (value: string) => void; children: React.ReactNode }) {
  return <section className="table-card operations-table"><div className="table-header"><div><h2>{title}</h2><p>{description}</p></div>{setSearch && <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label={`Search ${title}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" value={search} /></label>}</div><div className="table-wrap">{children}</div></section>;
}

function SchedulerWorkspace({ data, selectedDate, setSelectedDate, onNew, onReschedule, onSeedSamples, action, setNotice, isSaving }: {
  data: WorkspaceData;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onNew: (startAt?: string) => void;
  onReschedule: (appointment: DataRow) => void;
  onSeedSamples: () => void;
  action: (name: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  setNotice: (notice: string) => void;
  isSaving: boolean;
}) {
  const [view, setView] = useState<"day" | "week">("day");
  const [providerFilter, setProviderFilter] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [roomDrafts, setRoomDrafts] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const selected = new Date(`${selectedDate}T12:00:00`);
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
  const dateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const appointmentDate = (appointment: DataRow) => dateKey(new Date(value(appointment, "startAt")));
  const moveDate = (days: number) => {
    const next = new Date(selected);
    next.setDate(selected.getDate() + days);
    setSelectedDate(dateKey(next));
  };
  const filteredAppointments = data.appointments.filter((appointment) => {
    const matchesProvider = !providerFilter || value(appointment, "providerId") === providerFilter;
    const matchesFacility = !facilityFilter || value(appointment, "facilityId") === facilityFilter;
    const needle = `${value(appointment, "patientName")} ${value(appointment, "providerName")} ${value(appointment, "appointmentType")} ${value(appointment, "reason")}`.toLowerCase();
    return matchesProvider && matchesFacility && needle.includes(appointmentSearch.trim().toLowerCase());
  });
  const visibleDates = view === "day" ? [selected] : weekDays;
  const visibleDateKeys = new Set(visibleDates.map(dateKey));
  const visibleAppointments = filteredAppointments.filter((appointment) => visibleDateKeys.has(appointmentDate(appointment)));
  const selectedAppointments = filteredAppointments
    .filter((appointment) => appointmentDate(appointment) === selectedDate)
    .sort((left, right) => value(left, "startAt").localeCompare(value(right, "startAt")));
  const providers = data.providers.filter((provider) => !providerFilter || value(provider, "id") === providerFilter);
  const columns = view === "day"
    ? providers.map((provider) => ({ id: value(provider, "id"), label: `${value(provider, "firstName")} ${value(provider, "lastName")}`, sublabel: value(provider, "specialty"), date: selectedDate }))
    : visibleDates.map((date) => ({ id: dateKey(date), label: date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), sublabel: date.toLocaleDateString("en-US", { month: "short" }), date: dateKey(date) }));
  const startHour = 8;
  const endHour = 18;
  const hourHeight = 68;
  const schedulerSlotMinutes = [10, 15, 20, 30, 60].includes(Number(value(data.practiceSettings, "schedulerSlotMinutes"))) ? Number(value(data.practiceSettings, "schedulerSlotMinutes")) : 15;
  const slotsPerHour = 60 / schedulerSlotMinutes;
  const slotHeight = hourHeight / slotsPerHour;
  const scheduledMinutes = visibleAppointments
    .filter((appointment) => !["cancelled", "no_show"].includes(value(appointment, "status")))
    .reduce((total, appointment) => total + Math.max(0, (new Date(value(appointment, "endAt")).getTime() - new Date(value(appointment, "startAt")).getTime()) / 60_000), 0);
  const capacityHours = Math.max(0, columns.length * (endHour - startHour) - scheduledMinutes / 60);
  const eligibilityReady = visibleAppointments.filter((appointment) => value(appointment, "eligibilityStatus") === "eligible").length;
  const activeAppointments = visibleAppointments.filter((appointment) => !["cancelled", "no_show"].includes(value(appointment, "status")));

  const flowStatus = (appointment: DataRow) => value(appointment, "flowStatus") || (value(appointment, "status") === "completed" ? "checked_out" : "not_arrived");
  const elapsedLabel = (appointment: DataRow) => {
    const status = flowStatus(appointment);
    const currentStartedAt = value(appointment, "flowStatusAt");
    if (status === "checked_out") {
      const arrived = new Date(value(appointment, "arrivedAt")).getTime();
      const checkedOut = new Date(value(appointment, "checkedOutAt")).getTime();
      return Number.isFinite(arrived) && Number.isFinite(checkedOut) ? `${Math.max(0, Math.round((checkedOut - arrived) / 60_000))} min total visit` : "Visit complete";
    }
    const started = new Date(currentStartedAt).getTime();
    return Number.isFinite(started) ? `${Math.max(0, Math.floor((clock - started) / 60_000))} min in ${VISIT_FLOW_LABELS[status]?.toLowerCase() || "current step"}` : "Awaiting visit activity";
  };
  const flowCounts = VISIT_FLOW_STEPS.reduce<Record<string, number>>((counts, status) => {
    counts[status] = selectedAppointments.filter((appointment) => flowStatus(appointment) === status && !["cancelled", "no_show"].includes(value(appointment, "status"))).length;
    return counts;
  }, {});

  async function changeStatus(appointment: DataRow, status: string) {
    const result = await action("updateAppointmentStatus", { id: value(appointment, "id"), status });
    if (result) setNotice(`${value(appointment, "patientName")} marked ${status.replaceAll("_", " ")}.`);
  }

  async function changeFlow(appointment: DataRow, nextStatus: string) {
    const id = value(appointment, "id");
    const result = await action("updateVisitFlow", {
      id,
      flowStatus: nextStatus,
      roomName: roomDrafts[id] || value(appointment, "roomName"),
    });
    if (result) setNotice(`${value(appointment, "patientName")} moved to ${VISIT_FLOW_LABELS[nextStatus]?.toLowerCase() || nextStatus.replaceAll("_", " ")}.`);
  }

  async function checkAppointmentEligibility(appointment: DataRow) {
    const result = await action("checkEligibility", {
      patientId: value(appointment, "patientId"),
      dateOfService: appointmentDate(appointment),
    });
    if (result) setNotice(`Eligibility checked for ${value(appointment, "patientName")}.`);
  }

  function appointmentBlock(appointment: DataRow, columnIndex: number) {
    const start = new Date(value(appointment, "startAt"));
    const end = new Date(value(appointment, "endAt"));
    const top = ((start.getHours() + start.getMinutes() / 60) - startHour) * hourHeight;
    const naturalHeight = ((end.getTime() - start.getTime()) / 3_600_000) * hourHeight;
    const height = Math.max(42, naturalHeight);
    const timeLabel = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const patientName = value(appointment, "patientName") || "Patient";
    const currentFlow = flowStatus(appointment);
    const visitDetails = currentFlow !== "not_arrived"
      ? [VISIT_FLOW_LABELS[currentFlow], value(appointment, "roomName")].filter(Boolean).join(" · ")
      : [value(appointment, "appointmentType"), value(appointment, "providerName")].filter(Boolean).join(" · ");
    const accessibleDetails = [timeLabel, patientName, visitDetails].filter(Boolean).join(", ");
    return <button aria-label={accessibleDetails} className={`scheduler-appointment ${naturalHeight < 60 ? "compact" : ""} tone-${columnIndex % 5} status-${value(appointment, "status")}`} key={value(appointment, "id")} onClick={() => onReschedule(appointment)} style={{ height: `${height}px`, top: `${Math.max(0, top)}px` }} title={accessibleDetails} type="button"><span className="scheduler-appointment-primary"><span>{timeLabel}</span><strong>{patientName}</strong></span><small>{visitDetails || value(appointment, "status").replaceAll("_", " ")}</small></button>;
  }

  const rangeLabel = view === "day"
    ? selected.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return <div className="scheduler-workspace">
    <section className="scheduler-toolbar">
      <div className="scheduler-date-controls">
        <strong>{rangeLabel}</strong>
        <button onClick={() => setSelectedDate(dateKey(new Date()))} type="button">Today</button>
        <div><button aria-label="Previous period" onClick={() => moveDate(view === "day" ? -1 : -7)} type="button">←</button><input aria-label="Selected schedule date" onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} /><button aria-label="Next period" onClick={() => moveDate(view === "day" ? 1 : 7)} type="button">→</button></div>
      </div>
      <div className="scheduler-view-switch" role="tablist" aria-label="Schedule view"><button aria-selected={view === "day"} className={view === "day" ? "active" : ""} onClick={() => setView("day")} role="tab" type="button">Day</button><button aria-selected={view === "week"} className={view === "week" ? "active" : ""} onClick={() => setView("week")} role="tab" type="button">Week</button></div>
      <label className="scheduler-search"><span>⌕</span><input onChange={(event) => setAppointmentSearch(event.target.value)} placeholder="Search patient or visit" value={appointmentSearch} /></label>
      <select aria-label="Filter by provider" onChange={(event) => setProviderFilter(event.target.value)} value={providerFilter}><option value="">All providers</option>{data.providers.map((provider) => <option key={value(provider, "id")} value={value(provider, "id")}>{value(provider, "firstName")} {value(provider, "lastName")}</option>)}</select>
      <select aria-label="Filter by facility" onChange={(event) => setFacilityFilter(event.target.value)} value={facilityFilter}><option value="">All facilities</option>{data.facilities.map((facility) => <option key={value(facility, "id")} value={value(facility, "id")}>{value(facility, "name")}</option>)}</select>
      <span className="scheduler-interval-badge">{schedulerSlotMinutes} min intervals</span>
      <button className="secondary-button" disabled={isSaving} onClick={onSeedSamples} type="button">Load sample data</button>
    </section>

    <section aria-label="Schedule summary for current filters" className="scheduler-metric-grid">
      <article><span className="scheduler-metric-icon mint">PX</span><div><small>Appointments</small><strong>{activeAppointments.length}</strong><p>{visibleAppointments.filter((appointment) => value(appointment, "status") === "completed").length} completed</p></div></article>
      <article><span className="scheduler-metric-icon blue">✓</span><div><small>Eligibility ready</small><strong>{eligibilityReady}</strong><p>{visibleAppointments.length - eligibilityReady} need review</p></div></article>
      <article><span className="scheduler-metric-icon amber">◷</span><div><small>Open capacity</small><strong>{capacityHours.toFixed(1)}h</strong><p>Across visible columns</p></div></article>
      <article><span className="scheduler-metric-icon rose">!</span><div><small>No-show / cancelled</small><strong>{visibleAppointments.filter((appointment) => ["cancelled", "no_show"].includes(value(appointment, "status"))).length}</strong><p>Excluded from capacity</p></div></article>
    </section>

    <section aria-label="Patient flow summary" className="visit-flow-summary">
      <div><span className="eyebrow">Selected DOS flow</span><strong>{selectedAppointments.length} scheduled</strong></div>
      <span><b>{flowCounts.not_arrived || 0}</b> Not arrived</span>
      <span><b>{(flowCounts.arrived || 0) + (flowCounts.checked_in || 0)}</b> Check-in</span>
      <span><b>{flowCounts.waiting || 0}</b> Waiting</span>
      <span><b>{(flowCounts.roomed || 0) + (flowCounts.ready_for_provider || 0)}</b> Roomed / ready</span>
      <span><b>{flowCounts.consultation_started || 0}</b> With provider</span>
      <span><b>{(flowCounts.consultation_ended || 0) + (flowCounts.checked_out || 0)}</b> Visit ended</span>
    </section>

    <div className="scheduler-main-grid">
      <section className="scheduler-calendar-card">
        <div className="scheduler-week-strip">{weekDays.map((day) => <button className={dateKey(day) === selectedDate ? "active" : ""} key={dateKey(day)} onClick={() => setSelectedDate(dateKey(day))} type="button"><span>{day.toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{day.getDate()}</strong></button>)}</div>
        <div className="scheduler-calendar-scroll">
          <div className="scheduler-calendar" style={{ gridTemplateColumns: `72px repeat(${Math.max(1, columns.length)}, minmax(170px, 1fr))` }}>
            <div className="scheduler-corner">GMT</div>
            {columns.map((column, index) => <div className="scheduler-column-heading" key={column.id}><span className={`provider-dot tone-${index % 5}`} /> <div><strong>{column.label}</strong><small>{column.sublabel}</small></div></div>)}
            <div className="scheduler-time-rail" style={{ height: `${(endHour - startHour) * hourHeight}px` }}>{Array.from({ length: endHour - startHour + 1 }, (_, index) => <span key={index} style={{ top: `${index * hourHeight}px` }}>{new Date(2026, 0, 1, startHour + index).toLocaleTimeString("en-US", { hour: "numeric" })}</span>)}</div>
            {columns.map((column, columnIndex) => <div className="scheduler-day-column" key={column.id} style={{ height: `${(endHour - startHour) * hourHeight}px` }}>
              {Array.from({ length: (endHour - startHour) * slotsPerHour }, (_, index) => { const totalMinutes = startHour * 60 + index * schedulerSlotMinutes; const hour = Math.floor(totalMinutes / 60); const minute = totalMinutes % 60; const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; const displayTime = new Date(2026, 0, 1, hour, minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); return <button aria-label={`Create appointment at ${displayTime}`} className="scheduler-hour-slot" key={index} onClick={() => onNew(`${column.date}T${time}`)} style={{ borderTop: index % slotsPerHour === 0 ? "1px solid #e3eae7" : "1px solid #f0f4f2", height: `${slotHeight}px`, top: `${index * slotHeight}px` }} type="button" />; })}
              {visibleAppointments.filter((appointment) => view === "day" ? value(appointment, "providerId") === column.id : appointmentDate(appointment) === column.date).map((appointment) => appointmentBlock(appointment, columnIndex))}
            </div>)}
          </div>
        </div>
      </section>

      <aside className="scheduler-agenda">
        <header><div><span className="eyebrow">Today’s patient flow</span><h3>{selected.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</h3></div><span>{selectedAppointments.length}</span></header>
        <div className="scheduler-agenda-list">{selectedAppointments.length ? selectedAppointments.map((appointment) => {
          const status = value(appointment, "status");
          const currentFlow = flowStatus(appointment);
          const appointmentId = value(appointment, "id");
          const currentRoom = roomDrafts[appointmentId] ?? value(appointment, "roomName");
          const roomRequired = ["checked_in", "waiting", "roomed", "ready_for_provider", "consultation_started", "consultation_ended"].includes(currentFlow);
          const latestEvent = data.visitFlowEvents.find((event) => value(event, "appointmentId") === appointmentId);
          const start = new Date(value(appointment, "startAt"));
          return <article className={`visit-flow-card flow-${currentFlow}`} key={appointmentId}>
            <div className="agenda-time"><strong>{start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</strong><small>{Math.max(5, Math.round((new Date(value(appointment, "endAt")).getTime() - start.getTime()) / 60_000))} min</small></div>
            <div className="agenda-detail">
              <div><strong>{value(appointment, "patientName")}</strong><Status value={currentFlow} /></div>
              <p>{value(appointment, "appointmentType")} · {value(appointment, "providerName")}</p>
              <div className="visit-flow-context"><Status value={value(appointment, "eligibilityStatus")} /><span>{value(appointment, "facilityName")}</span><b>{elapsedLabel(appointment)}</b></div>
              <div aria-label={`Visit progress for ${value(appointment, "patientName")}`} className="visit-flow-progress">{VISIT_FLOW_STEPS.slice(1).map((step) => <i className={VISIT_FLOW_STEPS.indexOf(step) < VISIT_FLOW_STEPS.indexOf(currentFlow as typeof VISIT_FLOW_STEPS[number]) ? "complete" : step === currentFlow ? "current" : ""} key={step} title={VISIT_FLOW_LABELS[step]} />)}</div>
              {roomRequired && currentFlow !== "checked_out" && <label className="visit-room-picker">Room<select aria-label={`Room for ${value(appointment, "patientName")}`} onChange={(event) => setRoomDrafts((rooms) => ({ ...rooms, [appointmentId]: event.target.value }))} value={currentRoom}><option value="">Select room</option>{VISIT_ROOM_OPTIONS.map((room) => <option key={room} value={room}>{room}</option>)}</select></label>}
              {latestEvent && <small className="visit-flow-audit">Updated {shortDate(value(latestEvent, "occurredAt"), true)} by {value(latestEvent, "changedByName")}</small>}
              <div className="agenda-actions visit-flow-actions">
                {currentFlow === "not_arrived" && <><button disabled={isSaving} onClick={() => changeFlow(appointment, "arrived")} type="button">Mark arrived</button>{status === "scheduled" && <button onClick={() => changeStatus(appointment, "confirmed")} type="button">Confirm</button>}<button onClick={() => onReschedule(appointment)} type="button">Reschedule</button></>}
                {currentFlow === "arrived" && <button disabled={isSaving} onClick={() => changeFlow(appointment, "checked_in")} type="button">Check in</button>}
                {currentFlow === "checked_in" && <><button disabled={isSaving} onClick={() => changeFlow(appointment, "waiting")} type="button">Send to waiting</button><button disabled={isSaving || !currentRoom} onClick={() => changeFlow(appointment, "roomed")} type="button">Room patient</button></>}
                {currentFlow === "waiting" && <button disabled={isSaving || !currentRoom} onClick={() => changeFlow(appointment, "roomed")} type="button">Room patient</button>}
                {currentFlow === "roomed" && <><button disabled={isSaving || !currentRoom} onClick={() => changeFlow(appointment, "ready_for_provider")} type="button">Ready for provider</button><button disabled={isSaving} onClick={() => changeFlow(appointment, "waiting")} type="button">Return to waiting</button></>}
                {currentFlow === "ready_for_provider" && <><button disabled={isSaving} onClick={() => changeFlow(appointment, "consultation_started")} type="button">Start consultation</button><button disabled={isSaving} onClick={() => changeFlow(appointment, "roomed")} type="button">Not ready</button></>}
                {currentFlow === "consultation_started" && <button disabled={isSaving} onClick={() => changeFlow(appointment, "consultation_ended")} type="button">End consultation</button>}
                {currentFlow === "consultation_ended" && <><button disabled={isSaving} onClick={() => changeFlow(appointment, "checked_out")} type="button">Check out</button><button disabled={isSaving} onClick={() => changeFlow(appointment, "consultation_started")} type="button">Resume consultation</button></>}
                {["roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"].includes(currentFlow) && <Link className="encounter-link-button" href={`/clinical?appointmentId=${encodeURIComponent(appointmentId)}`}>Open encounter</Link>}
                {["roomed", "ready_for_provider", "consultation_started", "consultation_ended"].includes(currentFlow) && currentRoom !== value(appointment, "roomName") && <button disabled={isSaving || !currentRoom} onClick={() => changeFlow(appointment, currentFlow)} type="button">Update room</button>}
                {value(appointment, "eligibilityStatus") !== "eligible" && currentFlow === "not_arrived" && <button disabled={isSaving} onClick={() => checkAppointmentEligibility(appointment)} type="button">Eligibility</button>}
                {currentFlow === "not_arrived" && !["cancelled", "no_show"].includes(status) && <><button className="quiet-danger" onClick={() => changeStatus(appointment, "no_show")} type="button">No show</button><button className="quiet-danger" onClick={() => changeStatus(appointment, "cancelled")} type="button">Cancel</button></>}
              </div>
            </div>
          </article>;
        }) : <div className="scheduler-empty"><strong>No appointments</strong><p>Click any open time slot to schedule this day.</p></div>}</div>
      </aside>
    </div>
  </div>;
}

const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  patient_photo: "Patient photo",
  insurance_card: "Insurance card",
  hcfa_form: "HCFA / CMS-1500",
  medical_record: "Medical record",
  accident_letter: "Accident letter",
  primary_eob: "Primary EOB",
  secondary_eob: "Secondary EOB",
  referral: "Referral",
  authorization: "Authorization",
  lab_result: "Lab result",
  medication_list: "Medication list",
  imaging_report: "Imaging report",
  operative_report: "Operative report",
  discharge_summary: "Hospital discharge summary",
  specialist_note: "Specialist note",
  pathology_report: "Pathology report",
  immunization_record: "Immunization record",
  other: "Other document",
};

function coveragePeriodState(coverage: DataRow) {
  const today = new Date().toISOString().slice(0, 10);
  const effective = value(coverage, "effectiveDate");
  const termination = value(coverage, "terminationDate");
  if (value(coverage, "status") === "inactive" || (termination && termination < today)) return "history";
  if (effective && effective > today) return "future";
  return "current";
}

function SelectedPatientInsurance({ data, patientId, isSaving, onCheck, onDocuments, onEdit }: { data: WorkspaceData; patientId: string; isSaving: boolean; onCheck: (patientId: string, coverageId?: string) => void; onDocuments: (patientId: string, coverageId?: string) => void; onEdit: (patient: DataRow, coverage?: DataRow) => void }) {
  const patient = data.patients.find((item) => value(item, "id") === patientId);
  if (!patient) return <section className="selected-insurance-panel empty"><strong>Select a patient</strong><span>Click a patient name to view insurance policies and coverage details.</span></section>;
  const rank: Record<string, number> = { primary: 1, secondary: 2, tertiary: 3, guarantor: 4, final_balance: 5, unassigned: 6 };
  const periodRank: Record<string, number> = { current: 1, future: 2, history: 3 };
  const coverages = data.coverages
    .filter((item) => value(item, "patientId") === patientId)
    .sort((left, right) => (periodRank[coveragePeriodState(left)] - periodRank[coveragePeriodState(right)]) || ((rank[value(left, "priority")] || 6) - (rank[value(right, "priority")] || 6)));
  const legalResponsibilities = data.legalResponsibilities.filter((item) => value(item, "patientId") === patientId);
  const history = data.eligibilityUpdateHistory.filter((item) => value(item, "patientId") === patientId).slice(0, 4);
  const documents = data.patientDocuments
    .filter((item) => value(item, "patientId") === patientId && value(item, "status") === "active")
    .sort((left, right) => (value(right, "serviceDate") || value(right, "createdAt")).localeCompare(value(left, "serviceDate") || value(left, "createdAt")));
  return <section className="selected-insurance-panel">
    <header><div><span className="eyebrow">Coverage, history & documents</span><h2>{value(patient, "firstName")} {value(patient, "lastName")}</h2><p>{coverages.filter((coverage) => coveragePeriodState(coverage) === "current").length} current · {coverages.filter((coverage) => coveragePeriodState(coverage) === "future").length} future · {coverages.filter((coverage) => coveragePeriodState(coverage) === "history").length} historical · {documents.length} documents</p></div><div className="selected-patient-actions"><span className="mono">{value(patient, "accountNumber")}</span><button className="secondary-button" onClick={() => onDocuments(patientId)} type="button">＋ Add document</button></div></header>
    {coverages.length ? <div className="coverage-detail-grid">{coverages.map((coverage) => {
      const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
      const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
      const latest = data.eligibility.find((item) => value(item, "coverageId") === value(coverage, "id"));
      const coverageDocuments = documents.filter((item) => value(item, "coverageId") === value(coverage, "id"));
      const periodState = coveragePeriodState(coverage);
      return <article className={`coverage-period-${periodState}`} key={value(coverage, "id")}><div className="coverage-detail-heading"><span>{value(coverage, "priority")} · {periodState}</span><Status value={value(latest || {}, "status") || "not checked"} /></div><h3>{value(payer || {}, "name")} · {value(plan || {}, "name")}</h3><small className="coverage-kind">{(value(coverage, "coverageType") || "health").replaceAll("_", " ")}</small><dl><div><dt>Member ID</dt><dd>{value(coverage, "memberId")}</dd></div><div><dt>Group</dt><dd>{value(coverage, "groupNumber") || "—"}</dd></div><div><dt>Effective</dt><dd>{shortDate(value(coverage, "effectiveDate"))}</dd></div><div><dt>Terminates</dt><dd>{value(coverage, "terminationDate") ? shortDate(value(coverage, "terminationDate")) : "Open"}</dd></div><div><dt>Subscriber</dt><dd>{value(coverage, "subscriberFirstName")} {value(coverage, "subscriberLastName")}</dd></div><div><dt>Card images</dt><dd>{coverageDocuments.filter((item) => value(item, "category") === "insurance_card").length}/2 saved</dd></div>{["auto_pip", "workers_comp", "liability"].includes(value(coverage, "coverageType")) && <><div><dt>Claim number</dt><dd>{value(coverage, "propertyCasualtyClaimNumber") || "—"}</dd></div><div><dt>Accident date</dt><dd>{shortDate(value(coverage, "accidentDate"))}</dd></div><div><dt>Coverage remaining</dt><dd>{value(coverage, "coverageLimit") ? currency(Number(value(coverage, "coverageLimit")) - Number(value(coverage, "amountUsed"))) : "Not limited"}</dd></div><div><dt>Adjuster</dt><dd>{value(coverage, "adjusterName") || "—"}</dd></div></>}</dl>{latest && <small>Last checked {shortDate(value(latest, "checkedAt"), true)} · {value(latest, "referenceNumber")}</small>}<div className="coverage-card-actions"><button onClick={() => onEdit(patient, coverage)} type="button">Edit / end policy</button><button onClick={() => onDocuments(patientId, value(coverage, "id"))} type="button">Add card images</button>{periodState === "current" && <button disabled={isSaving} onClick={() => onCheck(patientId, value(coverage, "id"))} type="button">Check this policy’s eligibility</button>}</div></article>;
    })}</div> : <p className="no-coverage-message">No insurance policy is recorded for this patient.</p>}
    {legalResponsibilities.length > 0 && <div className="coverage-detail-grid legal-responsibility-grid">{legalResponsibilities.map((record) => <article key={value(record, "id")}><div className="coverage-detail-heading"><span>{value(record, "balanceRole").replaceAll("_", " ")}</span><Status value={value(record, "status")} /></div><h3>{value(record, "responsibilityType").replaceAll("_", " ").toUpperCase()} · {value(record, "organizationName") || "Patient responsibility"}</h3><small className="coverage-kind">Legal / non-insurance responsibility</small><dl><div><dt>Attorney</dt><dd>{value(record, "attorneyName") || "—"}</dd></div><div><dt>Case</dt><dd>{value(record, "caseNumber") || "—"}</dd></div><div><dt>LOP number</dt><dd>{value(record, "lopNumber") || "—"}</dd></div><div><dt>Signed</dt><dd>{shortDate(value(record, "signedDate"))}</dd></div><div><dt>Authorized</dt><dd>{value(record, "authorizedAmount") ? currency(value(record, "authorizedAmount")) : "—"}</dd></div><div><dt>Settlement</dt><dd>{value(record, "settlementStatus").replaceAll("_", " ")}</dd></div></dl><small>Not transmitted as an 837P insurance payer</small></article>)}</div>}
    <div className="patient-document-library"><div className="patient-document-heading"><div><span className="eyebrow">Patient documents · {documents.length} saved</span><h3>Complete document history</h3><p>All existing and future uploads appear in this single list automatically, with the newest records first.</p></div><button onClick={() => onDocuments(patientId)} type="button">＋ Upload</button></div>{documents.length ? <div className="patient-document-table-wrap"><table className="patient-document-table"><thead><tr><th>No.</th><th>Document</th><th>Type</th><th>Document date</th><th>Uploaded date</th><th>Action</th></tr></thead><tbody>{documents.map((document, index) => { const categoryLabel = DOCUMENT_CATEGORY_LABELS[value(document, "category")] || value(document, "category").replaceAll("_", " "); const fileLabel = value(document, "contentType") === "application/pdf" ? "PDF" : value(document, "documentSide") === "front" ? "Front image" : value(document, "documentSide") === "back" ? "Back image" : "Image"; return <tr key={value(document, "id")}><td className="document-row-number">{index + 1}</td><td><strong>{value(document, "title")}</strong><small>{fileLabel} · {value(document, "originalFileName")}</small></td><td>{categoryLabel}</td><td>{value(document, "serviceDate") ? shortDate(value(document, "serviceDate")) : <span className="document-date-missing">Not recorded</span>}</td><td>{shortDate(value(document, "createdAt"), true)}</td><td><a aria-label={`Open ${value(document, "title")}`} href={`/api/patient-documents?id=${encodeURIComponent(value(document, "id"))}`} rel="noreferrer" target="_blank">Open ↗</a></td></tr>; })}</tbody></table></div> : <p>No documents have been uploaded for this patient.</p>}</div>
    {history.length > 0 && <div className="eligibility-audit"><strong>Recent eligibility-applied changes</strong>{history.map((item) => <span key={value(item, "id")}>{shortDate(value(item, "createdAt"), true)} · {value(item, "reason")} · {value(item, "changedBy")}</span>)}</div>}
  </section>;
}

function PersonCell({ row }: { row: DataRow }) {
  const first = value(row, "firstName");
  const last = value(row, "lastName");
  return <div className="facility-name"><span>{first[0]}{last[0]}</span><div><strong>{first} {value(row, "middleName")} {last}</strong></div></div>;
}

function Status({ value: status }: { value: string }) {
  const lifecycleLabel = CLAIM_LIFECYCLE_LABELS[status as ClaimLifecycleStatus];
  const tone = ["active", "eligible", "clean", "ready", "ready_to_bill", "generated", "paid", "posted", "fully_posted", "balanced", "accepted", "configured", "confirmed", "arrived", "checked_in", "waiting", "roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out", "in_room", "completed", "yes", "sent", "pass", "submitted", "electronic", "processed", "closed"].includes(status) || status.startsWith("paid_") ? "active" : ["error", "errors", "rejected", "denied", "failed", "inactive", "cancelled", "no_show", "unbalanced", "voided"].includes(status) || status.startsWith("denied_") ? "danger" : status === "warning" || status === "generating" || status === "scrubbing" || status === "paper" || status === "pending" || status === "partially_posted" || status === "partially_paid" || status === "matched" || status === "review" || status === "received" || status === "needs_scrub" || status.startsWith("bill_to_") || status.startsWith("rebill_to_") || status.startsWith("sent_") || status.startsWith("rebilled_") || status === "new" ? "warning" : "inactive";
  const label = lifecycleLabel
    || CLAIM_WORKFLOW_LABELS[status as ClaimWorkflowStatus]
    || PAYMENT_ENTRY_STATUS_LABELS[status as PaymentEntryStatus]
    || ({ electronic: "Electronic", paper: "Paper", pending: "Pending", generated: "Generated", sent: "Sent", accepted: "Accepted", failed: "Failed", posted: "Posted", balanced: "Balanced", unbalanced: "Unbalanced", processed: "Processed", partially_paid: "Partially Paid", matched: "Matched", review: "Review", received: "Received" } as Record<string, string>)[status]
    || VISIT_FLOW_LABELS[status]
    || status.replaceAll("_", " ")
    || "—";
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function CodeList({ codes }: { codes: string[] }) {
  return <div className="code-list">{codes.length ? codes.map((code) => <span key={code}>{code}</span>) : "—"}</div>;
}

type FormProps = {
  data: WorkspaceData;
  form: Record<string, string | boolean>;
  update: (name: string, value: string | boolean) => void;
  onPatientAllergiesChange?: (patientId: string, allergies: DataRow[]) => void;
};
type SimpleFormProps = Omit<FormProps, "data">;

function Input({ label, name, form, update, required, type = "text", hint, placeholder, disabled }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; required?: boolean; type?: string; hint?: keyof typeof claimFieldHints; placeholder?: string; disabled?: boolean }) {
  return <label className="field">{label} <span>{required && <b>*</b>}{hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</span><input autoComplete="off" disabled={disabled} name={`pracx-${name}`} type={type} required={required} placeholder={placeholder} value={String(form[name] || "")} onChange={(event) => update(name, event.target.value)} /></label>;
}

function TextArea({ label, name, form, update, required, placeholder, rows = 4 }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; required?: boolean; placeholder?: string; rows?: number }) {
  return <label className="field textarea-field">{label} <span>{required && <b>*</b>}</span><textarea autoComplete="off" name={`pracx-${name}`} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} required={required} rows={rows} value={String(form[name] || "")} /></label>;
}

function Select({ label, name, form, update, options, required, hint }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; options: [string, string][]; required?: boolean; hint?: keyof typeof claimFieldHints }) {
  return <label className="field">{label} <span>{required && <b>*</b>}{hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</span><select autoComplete="off" name={`pracx-${name}`} required={required} value={String(form[name] || "")} onChange={(event) => update(name, event.target.value)}><option value="">Select</option>{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}

function Check({ label, name, form, update, hint }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; hint?: keyof typeof claimFieldHints }) {
  return <label className="check-card"><input checked={Boolean(form[name])} onChange={(event) => update(name, event.target.checked)} type="checkbox" /><span><strong>{label} {hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</strong><small>Enabled for this record</small></span></label>;
}

function SubscriberFields({ form, update }: SimpleFormProps) {
  const same = Boolean(form.subscriberSameAsPatient);
  const patientValue = (patientKey: string, regularKey: string) => String(form[patientKey] || form[regularKey] || "");
  function toggleSame(checked: boolean) {
    update("subscriberSameAsPatient", checked);
    if (checked) {
      update("relationship", "self");
      update("subscriberFirstName", patientValue("patientFirstName", "firstName"));
      update("subscriberLastName", patientValue("patientLastName", "lastName"));
      update("subscriberDateOfBirth", patientValue("patientDateOfBirth", "dateOfBirth"));
      update("subscriberSex", patientValue("patientSex", "sex") || "unknown");
      update("subscriberAddressLine1", String(form.addressLine1 || ""));
      update("subscriberCity", String(form.city || ""));
      update("subscriberState", String(form.state || ""));
      update("subscriberPostalCode", String(form.postalCode || ""));
    } else if (form.relationship === "self") {
      update("relationship", "other");
    }
  }
  return <>
    <label className="subscriber-same-control"><input checked={same} onChange={(event) => toggleSame(event.target.checked)} type="checkbox" /><span><strong>Subscriber is the same as the patient</strong><small>Use the patient’s name, birth date, sex and address for this policy.</small></span></label>
    {same
      ? <div className="subscriber-auto-summary"><strong>{patientValue("patientFirstName", "firstName")} {patientValue("patientLastName", "lastName")}</strong><span>Subscriber details will be copied automatically when saved.</span></div>
      : <div className="patient-subscriber-grid">
        <Input label="Subscriber first name" name="subscriberFirstName" form={form} update={update} required hint="subscriberName" />
        <Input label="Subscriber last name" name="subscriberLastName" form={form} update={update} required hint="subscriberName" />
        <Input label="Subscriber DOB" name="subscriberDateOfBirth" form={form} update={update} required type="date" hint="subscriberBirthSex" />
        <Select label="Subscriber sex" name="subscriberSex" form={form} update={update} required hint="subscriberBirthSex" options={[["male", "Male"], ["female", "Female"], ["unknown", "Unknown"]]} />
        <div className="wide"><Input label="Subscriber address" name="subscriberAddressLine1" form={form} update={update} required hint="subscriberAddress" /></div>
        <Input label="City" name="subscriberCity" form={form} update={update} required hint="subscriberAddress" />
        <Input label="State" name="subscriberState" form={form} update={update} required hint="subscriberAddress" />
        <Input label="ZIP" name="subscriberPostalCode" form={form} update={update} required hint="subscriberAddress" />
      </div>}
  </>;
}

function ResponsibilityForm({ data, form, update }: FormProps) {
  const patientId = String(form.patientId || "");
  const orderRank: Record<string, number> = { primary: 1, secondary: 2, tertiary: 3, unassigned: 4 };
  const patientCoverages = data.coverages
    .filter((coverage) => value(coverage, "patientId") === patientId && value(coverage, "status") === "active")
    .sort((left, right) => (orderRank[value(left, "priority")] || 4) - (orderRank[value(right, "priority")] || 4));
  const sourceOptions: [string, string][] = [
    ...patientCoverages.map((coverage) => {
      const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
      const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
      return [`coverage:${value(coverage, "id")}`, `${value(payer || {}, "name")} · ${value(plan || {}, "name")} · ${value(coverage, "memberId")}`] as [string, string];
    }),
    ...data.legalResponsibilities.filter((record) => value(record, "patientId") === patientId && value(record, "status") === "active").map((record) => [
      `legal:${value(record, "id")}`,
      `${value(record, "responsibilityType").replaceAll("_", " ")} · ${value(record, "organizationName") || value(record, "attorneyName") || "Patient"}`,
    ] as [string, string]),
    ["special:pip", "PIP / no-fault carrier"],
    ["special:workers_comp", "Workers’ compensation"],
    ["special:lop", "LOP / legal receivable"],
    ["special:attorney", "Attorney / law firm"],
    ["special:patient", "Patient / self pay"],
    ["special:other", "Other responsible source"],
  ];
  const existingProfiles = data.responsibilityProfiles.filter((profile) => value(profile, "patientId") === patientId);

  return <div className="responsibility-editor">
    {existingProfiles.length > 0 && <div className="responsibility-existing">{existingProfiles.slice(0, 3).map((profile) => <article key={value(profile, "id")}><span>{value(profile, "billingContext").replaceAll("_", " ")}</span><strong>{value(profile, "profileName")}</strong><small>{shortDate(value(profile, "effectiveFrom"))} → {value(profile, "effectiveTo") ? shortDate(value(profile, "effectiveTo")) : "Open"}</small></article>)}</div>}
    <fieldset><legend>Profile and date-of-service range</legend><p className="form-guidance">For {String(form.patientName || "this patient")}, change responsibility for this DOS range without altering the policy master or existing claims.</p><div className="form-grid responsibility-profile-grid">
      <Input label="Profile name" name="profileName" form={form} update={update} required placeholder="2026 routine medical" />
      <Select label="Billing context" name="billingContext" form={form} update={update} required options={[["routine", "Routine medical"], ["auto_pip", "Auto accident / PIP"], ["workers_comp", "Workers’ compensation"], ["liability", "Liability case"], ["lop_legal", "LOP / legal"], ["other", "Other"]]} />
      <Input label="Effective from" name="effectiveFrom" form={form} update={update} required type="date" />
      <Input label="Effective through" name="effectiveTo" form={form} update={update} type="date" placeholder="Leave open if ongoing" />
    </div></fieldset>
    <fieldset><legend>Responsibility chain</legend><p className="form-guidance">Order can later change after COB denial or adjudication. This profile records the current working order without erasing history.</p><div className="form-grid">
      <Select label="Primary responsibility" name="primarySource" form={form} update={update} required options={sourceOptions} />
      <Select label="Secondary responsibility" name="secondarySource" form={form} update={update} options={sourceOptions} />
      <Select label="Tertiary responsibility" name="tertiarySource" form={form} update={update} options={sourceOptions} />
      <Select label="Remaining balance destination" name="finalBalanceSource" form={form} update={update} options={sourceOptions} />
      <div className="span-2"><Input label="PIP, attorney, law firm or custom source name" name="legalSourceName" form={form} update={update} placeholder="Smith Legal Group / ABC Auto Insurance" /></div>
    </div></fieldset>
    <fieldset><legend>Guarantor and confirmation</legend><div className="form-grid">
      <Select label="Guarantor type" name="guarantorType" form={form} update={update} required options={[["patient", "Patient"], ["subscriber", "Policy subscriber"], ["parent_guardian", "Parent / guardian"], ["attorney", "Attorney"], ["law_firm", "Law firm"], ["other", "Other"]]} />
      <Input label="Guarantor / responsible party name" name="guarantorName" form={form} update={update} required />
      <Select label="Verification status" name="verificationStatus" form={form} update={update} required options={[["unverified", "Unverified — not confirmed"], ["verified", "Eligibility verified"], ["cob_confirmed", "COB confirmed"], ["disputed", "Disputed"], ["under_investigation", "Under investigation"]]} />
      <Input label="Reason / supporting reference" name="reason" form={form} update={update} required placeholder="COB call reference, EOB, LOP or staff determination" />
    </div><div className="responsibility-hold"><Check label="Hold patient statements until responsibility is finalized" name="patientBillingHold" form={form} update={update} /></div></fieldset>
    <div className="responsibility-rule-note"><strong>Conflict protection</strong><span>PRACX blocks overlapping DOS ranges within the same billing context and records every saved assignment in the audit history.</span></div>
  </div>;
}

function CoverageOrderForm({ data, form, update }: FormProps) {
  const activeCoverages = data.coverages.filter((coverage) =>
    value(coverage, "patientId") === String(form.patientId || "") && value(coverage, "status") === "active");
  const options: [string, string][] = activeCoverages.map((coverage) => {
    const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
    const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
    return [value(coverage, "id"), `${value(payer || {}, "name")} · ${value(plan || {}, "name")} · ${value(coverage, "memberId")}`];
  });
  return <div className="responsibility-editor coverage-editor">
    <fieldset><legend>Primary, secondary and tertiary defaults</legend><p className="form-guidance">Set the normal sequence for {String(form.patientName || "this patient")} when no DOS-specific profile applies. {activeCoverages.length} active coverage source{activeCoverages.length === 1 ? "" : "s"} available.</p><div className="form-grid">
      <Select label="Primary insurance" name="primaryCoverageId" form={form} update={update} options={options} />
      <Select label="Secondary insurance" name="secondaryCoverageId" form={form} update={update} options={options} />
      <Select label="Tertiary insurance" name="tertiaryCoverageId" form={form} update={update} options={options} />
    </div></fieldset>
    <div className="responsibility-rule-note"><strong>DOS protection</strong><span>Use DOS Order when this sequence changes for a date-of-service range. Saving these defaults does not rewrite existing DOS profiles or claims.</span></div>
  </div>;
}

const coverageTypeOptions: [string, string][] = [
  ["health", "Health insurance"],
  ["medicare_medicaid", "Medicare / Medicaid"],
  ["auto_pip", "Auto PIP / no-fault"],
  ["workers_comp", "Workers’ compensation"],
  ["liability", "Liability insurance"],
  ["lop", "Letter of Protection (LOP)"],
  ["attorney", "Attorney / legal case"],
  ["self_pay", "Patient / self-pay"],
  ["other_insurance", "Other insurance"],
  ["other_responsibility", "Other responsibility"],
];

const responsibilityPositionOptions: [string, string][] = [
  ["primary", "Primary responsibility"],
  ["secondary", "Secondary responsibility"],
  ["tertiary", "Tertiary responsibility"],
  ["guarantor", "Guarantor"],
  ["final_balance", "Remaining / final balance"],
  ["unassigned", "Determine by DOS"],
];

function CoverageTypeSelector({ form, update }: SimpleFormProps) {
  function changeType(nextType: string) {
    [
      "planId", "memberId", "groupNumber", "propertyCasualtyClaimNumber", "accidentDate", "accidentState",
      "authorizationNumber", "adjusterName", "adjusterPhone", "adjusterEmail", "adjusterFax", "coverageLimit",
      "amountUsed", "claimAddressLine1", "claimCity", "claimState", "claimPostalCode", "organizationName",
      "attorneyName", "caseNumber", "lopNumber", "signedDate", "receivedDate", "authorizedAmount",
      "responsibilityPhone", "responsibilityEmail", "responsibilityFax", "responsibilityAddressLine1",
      "responsibilityCity", "responsibilityState", "responsibilityPostalCode", "responsibilityNotes",
    ].forEach((field) => update(field, ""));
    update("coverageType", nextType);
    update("verifyEligibility", !["lop", "attorney", "self_pay", "other_responsibility"].includes(nextType));
  }
  return <label className="field">Coverage / responsibility type <span><b>*</b><ClaimFieldHint hint={claimFieldHints.insuranceType} /></span><select autoComplete="off" name="pracx-coverage-type" required value={String(form.coverageType || "")} onChange={(event) => changeType(event.target.value)}><option value="">Select</option>{coverageTypeOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}

function ResponsibilityPositionField({ form, update }: SimpleFormProps) {
  const isLegal = ["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || ""));
  return <Select label="Billing position" name={isLegal ? "balanceRole" : "priority"} form={form} update={update} required hint="billingPosition" options={responsibilityPositionOptions} />;
}

function CoverageTypeFields({ form, update }: SimpleFormProps) {
  const type = String(form.coverageType || "health");
  const isInsurance = !["lop", "attorney", "self_pay", "other_responsibility"].includes(type);
  const isPropertyCasualty = ["auto_pip", "workers_comp", "liability"].includes(type);
  if (!isInsurance) return <section className="coverage-type-section"><h3>{type === "lop" ? "LOP and legal responsibility" : "Responsible party"} <ClaimFieldHint hint={claimFieldHints.legalResponsibility} /></h3><p className="form-guidance">This record controls balance responsibility and legal follow-up. It is not transmitted as an insurance payer on the 837P.</p><div className="form-grid">
    {type !== "self_pay" && <Input label="Law firm / organization" name="organizationName" form={form} update={update} required={type === "lop" || type === "attorney"} />}
    {type !== "self_pay" && <Input label="Attorney / contact name" name="attorneyName" form={form} update={update} required={type === "lop" || type === "attorney"} />}
    {type !== "self_pay" && <Input label="Case number" name="caseNumber" form={form} update={update} required={type === "attorney"} />}
    {type === "lop" && <Input label="LOP number" name="lopNumber" form={form} update={update} required />}
    {type === "lop" && <Input label="LOP signed date" name="signedDate" form={form} update={update} required type="date" />}
    {type === "lop" && <Input label="LOP received date" name="receivedDate" form={form} update={update} type="date" />}
    <Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" />
    <Input label="Termination date" name="terminationDate" form={form} update={update} type="date" />
    <Input label="Authorized / protected amount" name="authorizedAmount" form={form} update={update} type="number" />
    <Select label="Settlement status" name="settlementStatus" form={form} update={update} options={[["open", "Open"], ["negotiating", "Negotiating"], ["settled", "Settled"], ["closed", "Closed"]]} />
    <Select label="Lien status" name="lienStatus" form={form} update={update} options={[["not_recorded", "Not recorded"], ["active", "Active lien"], ["reduction_requested", "Reduction requested"], ["resolved", "Resolved"]]} />
    <Input label="Phone" name="responsibilityPhone" form={form} update={update} />
    <Input label="Email" name="responsibilityEmail" form={form} update={update} type="email" />
    <Input label="Fax" name="responsibilityFax" form={form} update={update} />
    <div className="span-2"><Input label="Mailing address" name="responsibilityAddressLine1" form={form} update={update} /></div>
    <Input label="City" name="responsibilityCity" form={form} update={update} />
    <Input label="State" name="responsibilityState" form={form} update={update} />
    <Input label="ZIP" name="responsibilityPostalCode" form={form} update={update} />
    <div className="span-2"><Input label="Notes and payment instructions" name="responsibilityNotes" form={form} update={update} /></div>
  </div></section>;
  if (!isPropertyCasualty) return null;
  return <section className="coverage-type-section"><h3>{type === "auto_pip" ? "PIP / auto claim details" : type === "workers_comp" ? "Workers’ compensation details" : "Liability claim details"}</h3><p className="form-guidance">PRACX uses these values for CMS-1500 accident fields and the applicable 837P property-casualty segments. Adjuster and limit information remains available for follow-up.</p><div className="form-grid">
    <Input label="Property-casualty claim number" name="propertyCasualtyClaimNumber" form={form} update={update} required={type === "auto_pip" || type === "workers_comp"} hint="otherClaimId" />
    <Input label="Accident / injury date" name="accidentDate" form={form} update={update} required={type === "auto_pip"} type="date" hint="otherDate" />
    <Input label="Accident state" name="accidentState" form={form} update={update} required={type === "auto_pip"} placeholder="FL" hint="accidentRelated" />
    <Input label="Authorization number" name="authorizationNumber" form={form} update={update} hint="priorAuthorization" />
    <Input label="Adjuster name" name="adjusterName" form={form} update={update} />
    <Input label="Adjuster phone" name="adjusterPhone" form={form} update={update} />
    <Input label="Adjuster email" name="adjusterEmail" form={form} update={update} type="email" />
    <Input label="Adjuster fax" name="adjusterFax" form={form} update={update} />
    <Input label="Coverage limit" name="coverageLimit" form={form} update={update} type="number" hint="coverageFinancials" />
    <Input label="Amount used" name="amountUsed" form={form} update={update} type="number" hint="coverageFinancials" />
    <div className="span-2"><Input label="Property-casualty claim mailing address" name="claimAddressLine1" form={form} update={update} hint="payerClaimAddress" /></div>
    <Input label="City" name="claimCity" form={form} update={update} />
    <Input label="State" name="claimState" form={form} update={update} />
    <Input label="ZIP" name="claimPostalCode" form={form} update={update} />
  </div></section>;
}

function CoverageForm({ data, form, update }: FormProps) {
  function updatePlan(planId: string) {
    update("planId", planId);
    const selectedPlan = data.plans.find((plan) => value(plan, "id") === planId);
    if (selectedPlan && !form.groupNumber) update("groupNumber", value(selectedPlan, "defaultGroupNumber"));
  }
  const existingCoverages = data.coverages.filter((coverage) => value(coverage, "patientId") === String(form.patientId || ""));
  return <div className="responsibility-editor coverage-editor">
    {existingCoverages.length > 0 && <div className="responsibility-existing">{existingCoverages.map((coverage) => {
      const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
      const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
      return <article key={value(coverage, "id")}><span>{value(coverage, "priority").replaceAll("_", " ")} default</span><strong>{value(payer || {}, "name")} · {value(plan || {}, "name")}</strong><small>{value(coverage, "memberId")} · {value(coverage, "status")}</small></article>;
    })}</div>}
    <fieldset><legend>Coverage or responsibility type</legend><p className="form-guidance">Add a policy for {String(form.patientName || "this patient")} without replacing the existing insurance history.</p><div className="form-grid"><CoverageTypeSelector form={form} update={update} /><ResponsibilityPositionField form={form} update={update} /></div></fieldset>
    {!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <><fieldset><legend>Policy information</legend><div className="form-grid">
      <label className="field">Insurance plan <span><b>*</b><ClaimFieldHint hint={claimFieldHints.planName} /></span><select autoComplete="off" name="pracx-insurance-plan" required value={String(form.planId || "")} onChange={(event) => updatePlan(event.target.value)}><option value="">Select</option>{data.plans.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label>
      <Input label="Member ID" name="memberId" form={form} update={update} required hint="memberId" />
      <Input label="Group number" name="groupNumber" form={form} update={update} hint="groupNumber" />
      <Select label="Relationship" name="relationship" form={form} update={update} required hint="relationship" options={[["self", "Self"], ["spouse", "Spouse"], ["child", "Child"], ["other", "Other"]]} />
      <Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" />
      <Input label="Termination date" name="terminationDate" form={form} update={update} type="date" />
    </div></fieldset>
    <CoverageTypeFields form={form} update={update} />
    <fieldset><legend>Subscriber</legend><SubscriberFields form={form} update={update} /><div className="responsibility-hold"><Check label="Verify this coverage immediately after saving" name="verifyEligibility" form={form} update={update} /></div></fieldset>
    </>}
    {["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <CoverageTypeFields form={form} update={update} />}
    <div className="insurance-save-actions"><div><strong>Need another coverage source?</strong><span>Save this record and continue with another insurance or responsibility source.</span></div><button disabled={!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && (!form.planId || !form.memberId)} name="submitIntent" type="submit" value="add-coverage">Save & add another →</button></div>
  </div>;
}

function EligibilityReviewForm({ review, form, update }: { review: DataRow | null; form: Record<string, string | boolean>; update: FormProps["update"] }) {
  const details = (review?.details || {}) as DataRow;
  const currentAddress = (details.currentPatientAddress || {}) as DataRow;
  const returnedAddress = (details.returnedAddress || {}) as DataRow;
  const addressText = (address: DataRow) => `${value(address, "addressLine1")} ${value(address, "addressLine2")}, ${value(address, "city")}, ${value(address, "state")} ${value(address, "postalCode")}`.replace(/\s+/g, " ").replace(" ,", ",").trim();
  return <div className="eligibility-review">
    <div className="eligibility-benefit-summary"><span>Member <strong>{value(details, "memberId")}</strong></span><span>Group <strong>{value(details, "groupNumber") || "—"}</strong></span><span>Effective <strong>{shortDate(value(details, "effectiveDate"))}</strong></span><span>Termination <strong>{value(details, "terminationDate") ? shortDate(value(details, "terminationDate")) : "Open"}</strong></span><span>Copay <strong>{currency(value(details, "copayAmount"))}</strong></span></div>
    <fieldset><legend>Patient address decision</legend><p className="form-guidance">{value(details, "payerName")} · {value(details, "planName")} · {value(review || {}, "status")}. Nothing is overwritten until you confirm.</p><div className="address-choice-grid">
      <label className={form.addressChoice === "keep_current" ? "selected" : ""}><input checked={form.addressChoice === "keep_current"} name="address-review-choice" onChange={() => update("addressChoice", "keep_current")} type="radio" /><span><strong>Keep current patient address</strong><small>{addressText(currentAddress) || "No current address"}</small></span></label>
      <label className={form.addressChoice === "use_eligibility" ? "selected" : ""}><input checked={form.addressChoice === "use_eligibility"} name="address-review-choice" onChange={() => update("addressChoice", "use_eligibility")} type="radio" /><span><strong>Use address returned by eligibility</strong><small>{addressText(returnedAddress) || "No address returned"}</small></span></label>
    </div></fieldset>
    <Input label="Reason for applying or retaining information" name="reason" form={form} update={update} required placeholder="271 response reviewed; address confirmed with patient" />
    <div className="responsibility-rule-note"><strong>Audit protection</strong><span>PRACX records the previous values, eligibility response, selected address, reason, user and time.</span></div>
  </div>;
}

function CloseResponsibilityForm({ form, update }: SimpleFormProps) {
  return <div className="responsibility-editor">
    <fieldset><legend>Closing information</legend><p className="form-guidance">{String(form.patientName || "Patient")} · {String(form.profileName || "Responsibility profile")} · Started {shortDate(String(form.effectiveFrom || ""))}. Existing claims keep their saved responsibility snapshot.</p><div className="form-grid">
      <Input label="Effective through" name="effectiveTo" form={form} update={update} required type="date" />
      <Input label="Reason for closing or reordering" name="reason" form={form} update={update} required placeholder="Coverage ended, COB changed, PIP exhausted…" />
    </div></fieldset>
    <div className="responsibility-rule-note"><strong>Historical protection</strong><span>Closing this period prevents it from being selected for future DOS dates. It does not rewrite previously created claims.</span></div>
  </div>;
}

function CoverageHistoryStrip({ data, patientId, onUploadCards, onCaptureCard, cardSaving = false }: { data: WorkspaceData; patientId: string; onUploadCards?: (patientId: string, coverageId: string) => void; onCaptureCard?: (patientId: string, coverageId: string, side: "front" | "back", file: File) => Promise<void>; cardSaving?: boolean }) {
  const [viewer, setViewer] = useState<{ coverageId: string; side: "front" | "back" } | null>(null);
  if (!patientId) return null;
  const coverages = data.coverages.filter((coverage) => value(coverage, "patientId") === patientId);
  if (!coverages.length) return <div className="existing-coverage-strip empty"><strong>No existing insurance history</strong><span>This will be the patient’s first coverage episode.</span></div>;
  const selectedCoverage = viewer ? coverages.find((coverage) => value(coverage, "id") === viewer.coverageId) : undefined;
  const selectedDocuments = selectedCoverage ? data.patientDocuments.filter((document) => value(document, "coverageId") === value(selectedCoverage, "id") && value(document, "category") === "insurance_card" && value(document, "status") === "active") : [];
  const selectedDocument = selectedDocuments.filter((document) => value(document, "documentSide") === viewer?.side).sort((left, right) => value(right, "createdAt").localeCompare(value(left, "createdAt")))[0];
  const selectedPlan = selectedCoverage ? data.plans.find((item) => value(item, "id") === value(selectedCoverage, "planId")) : undefined;
  const selectedPayer = selectedPlan ? data.payers.find((item) => value(item, "id") === value(selectedPlan, "payerId")) : undefined;
  const selectedUrl = selectedDocument ? `/api/patient-documents?id=${encodeURIComponent(value(selectedDocument, "id"))}` : "";
  return <><section className="existing-coverage-strip"><div><strong>Insurance cards & coverage history</strong><span>Click a card image to view its front and back. Policy dates and order remain attached to each coverage episode.</span></div><div className="existing-coverage-cards">{coverages.map((coverage) => {
    const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
    const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
    const cardDocuments = data.patientDocuments.filter((document) => value(document, "coverageId") === value(coverage, "id") && value(document, "category") === "insurance_card" && value(document, "status") === "active");
    const front = cardDocuments.filter((document) => value(document, "documentSide") === "front").sort((left, right) => value(right, "createdAt").localeCompare(value(left, "createdAt")))[0];
    const back = cardDocuments.filter((document) => value(document, "documentSide") === "back").sort((left, right) => value(right, "createdAt").localeCompare(value(left, "createdAt")))[0];
    const preview = front || back;
    const previewUrl = preview ? `/api/patient-documents?id=${encodeURIComponent(value(preview, "id"))}` : "";
    const previewIsImage = Boolean(preview && value(preview, "contentType").startsWith("image/"));
    return <article className="insurance-card-tile" key={value(coverage, "id")}>
      <button aria-label={`View ${value(payer || {}, "name")} insurance card`} className={`insurance-card-preview ${preview ? "has-scan" : "missing-scan"}`} onClick={() => setViewer({ coverageId: value(coverage, "id"), side: front ? "front" : back ? "back" : "front" })} style={previewIsImage ? { backgroundImage: `url(${previewUrl})` } : undefined} type="button">
        {!preview && <><span aria-hidden="true">▣</span><strong>No card image</strong><small>Click to add front and back</small></>}
        {preview && !previewIsImage && <><span>PDF</span><strong>{value(preview, "documentSide")} card</strong></>}
        <b>{front ? "Front saved" : "Front missing"} · {back ? "Back saved" : "Back missing"}</b>
      </button>
      <div className="insurance-card-caption"><span>{coveragePeriodState(coverage)} · {value(coverage, "priority")}</span><strong>{value(payer || {}, "name")} · {value(plan || {}, "name")}</strong><small>Member ID {value(coverage, "memberId")}</small><small>{shortDate(value(coverage, "effectiveDate"))} → {value(coverage, "terminationDate") ? shortDate(value(coverage, "terminationDate")) : "Open"}</small></div>
      {onCaptureCard && <div className="insurance-card-capture-actions">{(["front", "back"] as const).map((side) => <label aria-label={`Capture insurance card ${side}`} className={cardSaving ? "disabled" : ""} key={side} title={`Take a photo or upload the ${side} of this insurance card`}><span aria-hidden="true">📷</span>{side === "front" ? "Front" : "Back"}<input accept="image/jpeg,image/png,image/webp" capture="environment" disabled={cardSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onCaptureCard(patientId, value(coverage, "id"), side, file); event.currentTarget.value = ""; }} type="file" /></label>)}</div>}
    </article>;
  })}</div></section>
  {viewer && selectedCoverage && <div className="insurance-card-viewer-backdrop" onClick={() => setViewer(null)} role="presentation"><section aria-label="Insurance card viewer" aria-modal="true" className="insurance-card-viewer" onClick={(event) => event.stopPropagation()} role="dialog">
    <header><div><span>{coveragePeriodState(selectedCoverage)} · {value(selectedCoverage, "priority")}</span><strong>{value(selectedPayer || {}, "name")} · {value(selectedPlan || {}, "name")}</strong><small>Member ID {value(selectedCoverage, "memberId")}</small></div><button aria-label="Close insurance card viewer" onClick={() => setViewer(null)} type="button">×</button></header>
    <div className="insurance-card-side-tabs" role="tablist"><button aria-selected={viewer.side === "front"} className={viewer.side === "front" ? "active" : ""} onClick={() => setViewer({ ...viewer, side: "front" })} role="tab" type="button">Front</button><button aria-selected={viewer.side === "back"} className={viewer.side === "back" ? "active" : ""} onClick={() => setViewer({ ...viewer, side: "back" })} role="tab" type="button">Back</button></div>
    <div className="insurance-card-large-view">{selectedDocument ? value(selectedDocument, "contentType").startsWith("image/") ? <div aria-label={`${viewer.side} insurance card image`} className="insurance-card-large-image" role="img" style={{ backgroundImage: `url(${selectedUrl})` }} /> : <iframe src={selectedUrl} title={`${viewer.side} insurance card PDF`} /> : <div className="insurance-card-missing-side"><span aria-hidden="true">▣</span><strong>{viewer.side === "front" ? "Front" : "Back"} image not uploaded</strong><p>Capture this side from a phone or tablet, or upload it from a desktop.</p><div className="insurance-card-missing-actions">{onCaptureCard && <label aria-label={`Capture missing insurance card ${viewer.side}`} className={cardSaving ? "disabled" : ""}><span aria-hidden="true">📷</span>Take {viewer.side} photo<input accept="image/jpeg,image/png,image/webp" capture="environment" disabled={cardSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onCaptureCard(patientId, value(selectedCoverage, "id"), viewer.side, file); event.currentTarget.value = ""; }} type="file" /></label>}{onUploadCards && <button onClick={() => { setViewer(null); onUploadCards(patientId, value(selectedCoverage, "id")); }} type="button">Upload both sides</button>}</div></div>}</div>
  </section></div>}
  </>;
}

function PatientDocumentsForm({ data, form, update }: FormProps) {
  const patientId = String(form.patientId || "");
  const category = String(form.category || "medical_record");
  const coverages = data.coverages.filter((coverage) => value(coverage, "patientId") === patientId);
  const insuranceCard = category === "insurance_card";
  const coverageOptions = coverages.map((coverage) => {
    const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
    const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
    return [value(coverage, "id"), `${coveragePeriodState(coverage)} · ${value(coverage, "priority")} · ${value(payer || {}, "name")} · ${value(plan || {}, "name")} · ${value(coverage, "memberId")}`] as [string, string];
  });

  return <div className="patient-document-uploader">
    <fieldset><legend>Document details</legend><p className="form-guidance">{String(form.patientName || "Patient")} · Take a photo on mobile or upload JPG, PNG, WebP or PDF on desktop. Maximum 12 MB.</p><div className="form-grid">
      <Select label="Document type" name="category" form={form} update={update} required options={Object.entries(DOCUMENT_CATEGORY_LABELS)} />
      <Select label={insuranceCard ? "Insurance policy" : "Related insurance policy (optional)"} name="coverageId" form={form} update={update} required={insuranceCard} options={coverageOptions} />
      <Input label="Document title" name="title" form={form} update={update} placeholder={insuranceCard ? "2026 Aetna member card" : "Descriptive document title"} />
      <Input label="Document / service date" name="serviceDate" form={form} update={update} type="date" />
    </div></fieldset>
    {insuranceCard ? <fieldset><legend>Insurance member ID card</legend><p className="form-guidance">Capture or upload the front and back together. Each side is stored separately but linked to this exact coverage episode.</p><div className="document-capture-grid">
      <label><span>Front of card</span><strong>Take photo or upload front</strong><small>Place the full card inside the frame with all text readable.</small><input accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" name="front" type="file" /></label>
      <label><span>Back of card</span><strong>Take photo or upload back</strong><small>Include payer addresses, phone numbers and electronic IDs.</small><input accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" name="back" type="file" /></label>
    </div></fieldset> : <fieldset><legend>Capture or upload records</legend><p className="form-guidance">Take one photo now, or select multiple images and PDFs from the device. Every file is stored separately under this patient and document type.</p><div className="document-intake-choice-grid"><label className="document-file-drop camera"><span aria-hidden="true">📷</span><strong>Take a document photo</strong><small>Uses the rear camera on a phone or tablet.</small><input accept="image/jpeg,image/png,image/webp" capture="environment" name="document" type="file" /></label><label className="document-file-drop multiple"><span aria-hidden="true">＋</span><strong>Upload multiple files</strong><small>Select prior records, reports, images or PDFs together.</small><input accept="image/jpeg,image/png,image/webp,application/pdf" multiple name="documents" type="file" /></label></div></fieldset>}
    <div className="responsibility-rule-note"><strong>Patient record linkage</strong><span>Insurance cards appear on both the selected policy and the patient document library. Other files remain searchable under the patient and their selected category.</span></div>
  </div>;
}

function PatientClinicalDocuments({ data, patientId, onUpload }: { data: WorkspaceData; patientId: string; onUpload?: (patientId: string) => void }) {
  const documents = data.patientDocuments
    .filter((document) => value(document, "patientId") === patientId && value(document, "status") === "active" && !["patient_photo", "insurance_card"].includes(value(document, "category")))
    .sort((left, right) => value(right, "createdAt").localeCompare(value(left, "createdAt")));
  return <div className="patient-clinical-documents">
    <section className="document-intake-banner"><div><span className="eyebrow">Historical record intake</span><h3>Previous medical documents</h3><p>Photograph records from a phone or tablet, or upload several images and PDFs from a desktop.</p></div><button disabled={!patientId} onClick={() => onUpload?.(patientId)} type="button"><span aria-hidden="true">📷</span> Capture or upload</button></section>
    {!patientId ? <div className="document-empty-state"><strong>Save the patient first</strong><span>Document capture becomes available after the patient chart has an account number.</span></div> : documents.length ? <div className="clinical-document-grid">{documents.map((document) => <a href={`/api/patient-documents?id=${encodeURIComponent(value(document, "id"))}`} key={value(document, "id")} rel="noreferrer" target="_blank"><span>{value(document, "contentType") === "application/pdf" ? "PDF" : "IMAGE"}</span><div><strong>{value(document, "title")}</strong><small>{DOCUMENT_CATEGORY_LABELS[value(document, "category")] || value(document, "category").replaceAll("_", " ")}</small><small>{value(document, "serviceDate") ? `Record date ${shortDate(value(document, "serviceDate"))}` : `Uploaded ${shortDate(value(document, "createdAt"))}`}</small></div><b>Open ↗</b></a>)}</div> : <div className="document-empty-state"><strong>No previous records uploaded</strong><span>Ask the patient for discharge summaries, medication lists, specialist notes, test results and imaging reports.</span></div>}
  </div>;
}

function PatientForm({ data, form, update, onPhotoUpload, onCardUpload, onCardCapture, onDocumentUpload, photoSaving, cardSaving = false, initialTab = "demographics" }: FormProps & { onPhotoUpload: (patientId: string, file: File) => Promise<void>; onCardUpload?: (patientId: string, coverageId: string) => void; onCardCapture?: (patientId: string, coverageId: string, side: "front" | "back", file: File) => Promise<void>; onDocumentUpload?: (patientId: string) => void; photoSaving: boolean; cardSaving?: boolean; initialTab?: "demographics" | "contact" | "insurance" | "subscriber" | "documents" }) {
  const [activeTab, setActiveTab] = useState<"demographics" | "contact" | "insurance" | "subscriber" | "documents">(initialTab);
  const [addressStatus, setAddressStatus] = useState<"idle" | "checking" | "verified" | "corrected" | "error">("idle");
  const [addressMessage, setAddressMessage] = useState("");
  const [addressSuggestion, setAddressSuggestion] = useState<DataRow | null>(null);

  function updatePlan(planId: string) {
    update("planId", planId);
    const selectedPlan = data.plans.find((plan) => value(plan, "id") === planId);
    if (selectedPlan && !form.groupNumber) update("groupNumber", value(selectedPlan, "defaultGroupNumber"));
  }

  async function addressAction(actionName: "lookupZip" | "verifyAddress") {
    setAddressStatus("checking");
    setAddressMessage(actionName === "lookupZip" ? "Looking up ZIP…" : "Checking address…");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName, ...form }),
      });
      const body = (await response.json()) as DataRow;
      if (!response.ok) throw new Error(value(body, "error") || "Address service is unavailable.");
      if (actionName === "lookupZip") {
        if (value(body, "city")) update("city", value(body, "city"));
        if (value(body, "state")) update("state", value(body, "state"));
        setAddressStatus(value(body, "status") === "matched" ? "verified" : "idle");
      } else {
        setAddressSuggestion((body.standardized || null) as DataRow | null);
        setAddressStatus(value(body, "status") === "corrected" ? "corrected" : "verified");
      }
      setAddressMessage(value(body, "message"));
    } catch (reason) {
      setAddressStatus("error");
      setAddressMessage(reason instanceof Error ? reason.message : "Address service is unavailable.");
      setAddressSuggestion(null);
    }
  }

  function applyStandardizedAddress() {
    if (!addressSuggestion) return;
    ["addressLine1", "addressLine2", "city", "state", "postalCode", "zipPlus4"].forEach((field) => {
      update(field, value(addressSuggestion, field));
    });
    setAddressSuggestion(null);
    setAddressStatus("verified");
    setAddressMessage("Standardized address applied. Save the patient to keep this change.");
  }

  const tabs = [
    { id: "demographics" as const, number: "01", label: "Demographics", complete: Boolean(form.firstName && form.lastName && form.dateOfBirth) },
    { id: "contact" as const, number: "02", label: "Contact", complete: Boolean(form.addressLine1 && form.city && form.state && form.postalCode) },
    { id: "insurance" as const, number: "03", label: "Insurance", complete: Boolean(form.planId && form.memberId) },
    { id: "subscriber" as const, number: "04", label: "Subscriber", complete: Boolean(form.subscriberFirstName || form.relationship === "self") },
    { id: "documents" as const, number: "05", label: "Documents", complete: data.patientDocuments.some((document) => value(document, "patientId") === String(form.id || "") && value(document, "status") === "active" && !["patient_photo", "insurance_card"].includes(value(document, "category"))) },
  ];
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const patientId = String(form.id || "");
  const currentPhoto = data.patientDocuments
    .filter((document) => value(document, "patientId") === patientId && value(document, "category") === "patient_photo" && value(document, "status") === "active")
    .sort((left, right) => value(right, "createdAt").localeCompare(value(left, "createdAt")))[0];
  const photoUrl = currentPhoto ? `/api/patient-documents?id=${encodeURIComponent(value(currentPhoto, "id"))}` : "/patient-placeholder.png";

  return (
    <div className="patient-editor">
      <aside className="patient-editor-summary">
        <div className="patient-photo-control">
          <span aria-label={currentPhoto ? "Current patient photo" : "Fictional default patient placeholder"} className="patient-editor-photo" role="img" style={{ backgroundImage: `url(${photoUrl})` }} />
          <label aria-label="Capture or upload patient photo" className={`patient-camera-button ${!patientId || photoSaving ? "disabled" : ""}`} title={patientId ? "Take or upload patient photo" : "Save the patient before adding a photo"}>
            <span aria-hidden="true">📷</span>
            <input accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!patientId || photoSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onPhotoUpload(patientId, file); event.currentTarget.value = ""; }} type="file" />
          </label>
        </div>
        <span className="eyebrow">Patient record</span>
        <strong className="patient-editor-name">{form.firstName || form.lastName ? `${String(form.firstName || "")} ${String(form.lastName || "")}` : "New patient record"}</strong>
        <p>{form.memberId ? `Member ${String(form.memberId)}` : "Complete the sections to create a claim-ready patient master."}</p>
        <div className="patient-editor-progress">
          {tabs.map((tab) => <div className={tab.complete ? "complete" : ""} key={tab.id}><span>{tab.complete ? "✓" : tab.number}</span><div><strong>{tab.label}</strong><small>{tab.complete ? "Information ready" : "Needs information"}</small></div></div>)}
        </div>
        <div className="patient-editor-security"><strong>Protected health information</strong><span>Stored locally in the configured practice database.</span></div>
      </aside>

      <div className="patient-editor-workspace">
        <div aria-label="Patient information sections" className="patient-form-tabs" role="tablist">
          {tabs.map((tab) => <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button"><span>{tab.number}</span>{tab.label}{tab.complete && <b>✓</b>}</button>)}
        </div>

        {activeTab === "demographics" && <fieldset className="patient-tab-panel"><legend>Identity & demographics</legend><p className="patient-section-copy">Enter the patient’s legal identity exactly as shown on the insurance card.</p><div className="patient-name-grid"><Input label="First name" name="firstName" form={form} update={update} required hint="patientName" /><Input label="Middle name" name="middleName" form={form} update={update} hint="patientName" /><Input label="Last name" name="lastName" form={form} update={update} required hint="patientName" /><Input label="Suffix" name="suffix" form={form} update={update} hint="patientName" /></div><div className="patient-compact-grid"><Input label="Date of birth" name="dateOfBirth" form={form} update={update} required type="date" hint="patientBirthSex" /><Select label="Sex" name="sex" form={form} update={update} hint="patientBirthSex" options={[["male", "Male"], ["female", "Female"], ["unknown", "Unknown"]]} /><Select label="Marital status" name="maritalStatus" form={form} update={update} options={[["single", "Single"], ["married", "Married"], ["divorced", "Divorced"], ["widowed", "Widowed"], ["other", "Other"]]} /></div></fieldset>}

        {activeTab === "contact" && <fieldset className="patient-tab-panel">
          <legend>Address & contact</legend>
          <p className="patient-section-copy">Use a mailing-ready address for statements, eligibility and claim records.</p>
          <div className="patient-address-grid">
            <div className="street"><Input label="Street address" name="addressLine1" form={form} update={update} required hint="patientAddress" placeholder="500 Park Avenue" /></div>
            <div className="unit"><Input label="Apt / suite" name="addressLine2" form={form} update={update} hint="patientAddress" placeholder="Apt 4B" /></div>
            <div className="city"><Input label="City" name="city" form={form} update={update} required hint="patientAddress" /></div>
            <label className="field state">State <span><b>*</b><ClaimFieldHint hint={claimFieldHints.patientAddress} /></span><input aria-label="State" maxLength={2} required value={String(form.state || "")} onChange={(event) => update("state", event.target.value.replace(/[^a-z]/gi, "").toUpperCase())} /></label>
            <label className="field zip-five">ZIP <span><b>*</b><ClaimFieldHint hint={claimFieldHints.patientAddress} /></span><input aria-label="5-digit ZIP code" inputMode="numeric" maxLength={5} placeholder="10022" required value={String(form.postalCode || "")} onBlur={() => String(form.postalCode || "").length === 5 && addressAction("lookupZip")} onChange={(event) => update("postalCode", event.target.value.replace(/\D/g, "").slice(0, 5))} /></label>
            <label className="field zip-four">ZIP+4 <span><ClaimFieldHint hint={claimFieldHints.patientAddress} /></span><input aria-label="4-digit ZIP extension" inputMode="numeric" maxLength={4} placeholder="1234" value={String(form.zipPlus4 || "")} onChange={(event) => update("zipPlus4", event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
            <label className="field phone">Phone <span /><input autoComplete="tel" inputMode="tel" maxLength={14} placeholder="(212) 555-0199" value={String(form.phone || "")} onChange={(event) => update("phone", formatPhone(event.target.value))} /></label>
            <div className="email"><Input label="Email" name="email" form={form} update={update} type="email" hint="email" placeholder="patient@example.com" /></div>
          </div>
          <div className="address-tools">
            <button className="address-verify-button" disabled={addressStatus === "checking"} onClick={() => addressAction("verifyAddress")} type="button">{addressStatus === "checking" ? "Checking…" : "Verify with USPS"}</button>
            <p>USPS-ready verification · local test mode until a live adapter is activated</p>
          </div>
          {addressMessage && <div className={`address-verification-card ${addressStatus}`} role="status"><strong>{addressStatus === "error" ? "Needs attention" : addressStatus === "corrected" ? "Suggested correction" : "Address check"}</strong><span>{addressMessage}</span></div>}
          {addressSuggestion && <div className="address-comparison">
            <div><span>Entered</span><strong>{String(form.addressLine1 || "")} {String(form.addressLine2 || "")}</strong><p>{String(form.city || "")}, {String(form.state || "")} {String(form.postalCode || "")}{form.zipPlus4 ? `-${String(form.zipPlus4)}` : ""}</p></div>
            <div className="recommended"><span>Standardized</span><strong>{value(addressSuggestion, "addressLine1")} {value(addressSuggestion, "addressLine2")}</strong><p>{value(addressSuggestion, "city")}, {value(addressSuggestion, "state")} {value(addressSuggestion, "postalCode")}{value(addressSuggestion, "zipPlus4") ? `-${value(addressSuggestion, "zipPlus4")}` : ""}</p><button onClick={applyStandardizedAddress} type="button">Use standardized address</button></div>
          </div>}
        </fieldset>}

        {activeTab === "insurance" && <fieldset className="patient-tab-panel">
          <legend>Coverage & responsibility</legend>
          <CoverageHistoryStrip cardSaving={cardSaving} data={data} onCaptureCard={onCardCapture} onUploadCards={onCardUpload} patientId={String(form.id || "")} />
          <p className="patient-section-copy">Choose the responsibility type and billing position independently. Every type can be primary, secondary, tertiary, guarantor, final balance or controlled by a DOS profile.</p>
          <div className="patient-insurance-grid"><CoverageTypeSelector form={form} update={update} /><ResponsibilityPositionField form={form} update={update} /></div>
          {!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <><div className="patient-insurance-grid"><label className="field">Insurance plan <span><ClaimFieldHint hint={claimFieldHints.planName} /></span><select autoComplete="off" name="pracx-insurance-plan" value={String(form.planId || "")} onChange={(event) => updatePlan(event.target.value)}><option value="">Select</option>{data.plans.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label><Input label="Member ID" name="memberId" form={form} update={update} hint="memberId" /><Input label="Group number" name="groupNumber" form={form} update={update} hint="groupNumber" /><Select label="Relationship" name="relationship" form={form} update={update} hint="relationship" options={[["self", "Self"], ["spouse", "Spouse"], ["child", "Child"], ["other", "Other"]]} /><Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" /><Input label="Termination date" name="terminationDate" form={form} update={update} type="date" /></div><div className="patient-policy-options"><Check label="Accept assignment" name="acceptAssignment" form={form} update={update} hint="acceptAssignment" /><Check label="Release information" name="releaseOfInformation" form={form} update={update} hint="releaseInformation" /><Check label="Assignment of benefits" name="assignmentOfBenefits" form={form} update={update} hint="assignmentBenefits" /></div><CoverageTypeFields form={form} update={update} /></>}
          {["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <CoverageTypeFields form={form} update={update} />}
          <div className="insurance-save-actions"><div><strong>Add another coverage source</strong><span>Save this patient and current record, then continue with another policy or legal responsibility.</span></div><button disabled={!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && (!form.planId || !form.memberId)} name="submitIntent" type="submit" value="add-coverage">Save & add another →</button></div>
        </fieldset>}

        {activeTab === "subscriber" && <fieldset className="patient-tab-panel"><legend>Subscriber & verification</legend>{["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) ? <p className="patient-section-copy">This responsibility type does not create an insurance subscriber or eligibility inquiry.</p> : <><p className="patient-section-copy">Confirm whether the patient is the policy subscriber. Manual subscriber fields appear only when they are different.</p><SubscriberFields form={form} update={update} /><div className="eligibility-option"><Check label="Verify eligibility immediately after saving" name="verifyEligibility" form={form} update={update} /><p>PRACX sends a 270 inquiry and fills the returned payer, plan, coverage dates and benefit details. Live responses require an active eligibility adapter.</p></div></>}</fieldset>}

        {activeTab === "documents" && <fieldset className="patient-tab-panel patient-documents-panel"><legend>Documents & clinical review</legend><PatientClinicalDocuments data={data} onUpload={onDocumentUpload} patientId={String(form.id || "")} /></fieldset>}

        <div className="patient-tab-navigation">
          <button disabled={activeTabIndex === 0} onClick={() => setActiveTab(tabs[Math.max(0, activeTabIndex - 1)].id)} type="button">← Previous</button>
          <span>Section {activeTabIndex + 1} of {tabs.length}</span>
          {activeTabIndex < tabs.length - 1
            ? <button className="next" onClick={() => setActiveTab(tabs[activeTabIndex + 1].id)} type="button">Next section →</button>
            : <span className="ready-label">Review complete · Save below</span>}
        </div>
      </div>
    </div>
  );
}

function AppointmentPatientSearch({ patients, form, update }: { patients: DataRow[]; form: DataRow; update: (name: string, nextValue: unknown) => void }) {
  const selectedPatient = patients.find((patient) => value(patient, "id") === String(form.patientId || ""));
  const selectedLabel = selectedPatient ? `${value(selectedPatient, "firstName")} ${value(selectedPatient, "lastName")} · ${value(selectedPatient, "accountNumber")}` : "";
  const [searchTerm, setSearchTerm] = useState(selectedLabel);
  const [results, setResults] = useState<DataRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selectedLabel && String(form.patientId || "") && searchTerm === selectedLabel) {
      setResults([]);
      setSearching(false);
      return;
    }
    const query = searchTerm.trim();
    if (query.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/patient-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = (await response.json()) as { patients?: DataRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to search patients.");
        setResults(body.patients || []);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSearchError(error instanceof Error ? error.message : "Unable to search patients.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.patientId, searchTerm, selectedLabel]);

  function choosePatient(patient: DataRow) {
    update("patientId", value(patient, "id"));
    setSearchTerm(`${value(patient, "firstName")} ${value(patient, "lastName")} · ${value(patient, "accountNumber")}`);
    setResults([]);
    setOpen(false);
  }

  return <div className="appointment-patient-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor="appointment-patient-search">Find existing patient <span className="required-mark">*</span></label>
    <div className={`patient-search-input ${form.patientId ? "selected" : ""}`}><span aria-hidden="true">⌕</span><input aria-autocomplete="list" aria-controls="appointment-patient-results" aria-expanded={open} aria-required="true" autoComplete="off" id="appointment-patient-search" onChange={(event) => { setSearchTerm(event.target.value); update("patientId", ""); setOpen(true); }} onFocus={() => { if (results.length) setOpen(true); }} placeholder="Type 3 letters, account, phone or DOB" role="combobox" value={searchTerm} />{form.patientId && <button aria-label="Clear selected patient" onClick={() => { update("patientId", ""); setSearchTerm(""); setResults([]); }} type="button">×</button>}</div>
    {!form.patientId && <small className="patient-search-guidance">{searchTerm.trim().length < 3 ? "Enter at least 3 characters to search." : searching ? "Searching patient master…" : searchError || (open && !results.length ? "No matching active patients found." : "Select a patient from the matches below.")}</small>}
    {open && results.length > 0 && <div className="patient-search-results" id="appointment-patient-results" role="listbox">{results.map((patient) => <button aria-label={`Select ${value(patient, "firstName")} ${value(patient, "lastName")}`} key={value(patient, "id")} onClick={() => choosePatient(patient)} role="option" type="button"><span>{value(patient, "firstName")} {value(patient, "middleName")} {value(patient, "lastName")}</span><small>{value(patient, "accountNumber")} · DOB {shortDate(value(patient, "dateOfBirth"))} · {value(patient, "phone") || "Phone missing"}</small></button>)}</div>}
  </div>;
}

function AppointmentForm({ data, form, update, onAddPatient, reschedule = false }: FormProps & { onAddPatient: () => void; reschedule?: boolean }) {
  const selectedPatient = data.patients.find((patient) => value(patient, "id") === String(form.patientId || ""));
  const selectedCoverages = selectedPatient ? data.coverages.filter((coverage) => value(coverage, "patientId") === value(selectedPatient, "id") && value(coverage, "status") === "active") : [];
  const latestEligibility = selectedPatient ? data.eligibility.find((item) => value(item, "patientId") === value(selectedPatient, "id")) : undefined;
  const upcomingVisits = selectedPatient ? data.appointments.filter((appointment) => value(appointment, "patientId") === value(selectedPatient, "id") && new Date(value(appointment, "startAt")) >= new Date() && !["cancelled", "no_show"].includes(value(appointment, "status"))).length : 0;
  return <div className="appointment-editor">
    <fieldset><legend>Patient and visit</legend><p className="form-guidance">{reschedule ? `Change the appointment time for ${String(form.patientName || "this patient")}. Saving returns it to scheduled for confirmation.` : "Select the patient, visit type, provider and location. Provider conflicts are checked before saving."}</p><div className="form-grid">
      {reschedule ? <label className="field">Patient <span /><input disabled value={String(form.patientName || "")} /></label> : <div className="appointment-patient-picker"><AppointmentPatientSearch form={form} patients={data.patients} update={update} /><button className="appointment-add-patient" onClick={onAddPatient} type="button"><span>＋</span><strong>Patient not found?</strong><small>Create their chart and return to this appointment</small></button></div>}
      <Select label="Appointment type" name="appointmentType" form={form} update={update} required options={[["New patient visit", "New patient visit"], ["Office visit", "Office visit"], ["Follow-up", "Follow-up"], ["Annual wellness", "Annual wellness"], ["Procedure", "Procedure"], ["Physical therapy", "Physical therapy"], ["Telehealth", "Telehealth"], ["Consultation", "Consultation"]]} />
      <Select label="Billing context" name="billingContext" form={form} update={update} required options={[["routine", "Routine medical"], ["auto_pip", "Auto accident / PIP"], ["workers_comp", "Workers’ compensation"], ["liability", "Liability case"], ["lop_legal", "LOP / legal"], ["other", "Other"]]} />
      <Input label="Reason for visit" name="reason" form={form} update={update} placeholder="Symptoms, follow-up reason or procedure" />
    </div></fieldset>
    {selectedPatient && !reschedule && <section className="appointment-readiness">
      <div><span>Selected patient</span><strong>{value(selectedPatient, "firstName")} {value(selectedPatient, "lastName")}</strong><small>{value(selectedPatient, "accountNumber")} · {value(selectedPatient, "phone") || "Phone missing"}</small></div>
      <div><span>Coverage</span><strong>{selectedCoverages.length ? `${selectedCoverages.length} active` : "Needs insurance"}</strong><small>Primary, secondary and DOS order remain on the patient chart</small></div>
      <div><span>Eligibility</span><Status value={value(latestEligibility || {}, "status") || "not checked"} /><small>Verify for the appointment DOS after booking</small></div>
      <div><span>Upcoming visits</span><strong>{upcomingVisits}</strong><small>Helps prevent duplicate bookings</small></div>
    </section>}
    <fieldset><legend>Time and resources</legend><div className="form-grid">
      <Select label="Provider" name="providerId" form={form} update={update} required options={data.providers.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")} · ${value(row, "specialty")}`])} />
      <Select label="Facility" name="facilityId" form={form} update={update} required hint="facilityAssignment" options={data.facilities.map((row) => [value(row, "id"), value(row, "name")])} />
      <Input label="Start" name="startAt" form={form} update={update} required type="datetime-local" />
      <Select label="Duration" name="duration" form={form} update={update} required options={[["15", "15 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "1 hour"], ["90", "1 hour 30 minutes"], ["120", "2 hours"]]} />
    </div></fieldset>
    <div className="responsibility-rule-note"><strong>Conflict protection</strong><span>PRACX blocks overlapping appointments for the same provider. Eligibility remains tied to the patient and selected date of service.</span></div>
  </div>;
}

function EligibilityForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Coverage inquiry</legend><div className="form-grid"><Select label="Patient" name="patientId" form={form} update={update} required hint="memberId" options={data.patients.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Input label="Date of service" name="dateOfService" form={form} update={update} required type="date" hint="dateOfService" /></div><p className="form-guidance">The local adapter generates a test-mode 271 response. Live verification requires clearinghouse or payer credentials.</p></fieldset>;
}

function ClinicalCodePicker({ label, rows, selected, onChange }: { label: string; rows: DataRow[]; selected: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState("");
  const selectedCodes = selected.split(",").map((code) => code.trim()).filter(Boolean);
  const filtered = rows.filter((row) => `${value(row, "code")} ${value(row, "description")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  function add(code: string) { if (!selectedCodes.includes(code)) onChange([...selectedCodes, code].join(", ")); }
  function remove(code: string) { onChange(selectedCodes.filter((item) => item !== code).join(", ")); }
  return <section className="clinical-code-picker"><label>{label}<input aria-label={`Search ${label}`} onChange={(event) => setQuery(event.target.value)} placeholder="Type code or description" value={query} /></label><div className="selected-clinical-codes">{selectedCodes.length ? selectedCodes.map((code) => <button key={code} onClick={() => remove(code)} type="button">{code} ×</button>) : <span>No codes selected</span>}</div><div className="clinical-code-results">{filtered.map((row) => <button key={value(row, "id")} onClick={() => add(value(row, "code"))} type="button"><b>{value(row, "code")}</b><span>{value(row, "description")}</span>{row.defaultCharge !== undefined && <small>{currency(value(row, "defaultCharge"))}</small>}</button>)}</div></section>;
}

const CLINICAL_SECTIONS = [
  { key: "hpi", field: "historyOfPresentIllness", label: "HPI", fullLabel: "History of present illness", placeholder: "Document the symptom story, timeline and relevant context." },
  { key: "ros", field: "reviewOfSystems", label: "ROS", fullLabel: "Review of systems", placeholder: "Document pertinent positives and negatives by system." },
  { key: "exam", field: "physicalExam", label: "Exam", fullLabel: "Physical examination", placeholder: "Document objective findings from today’s examination." },
  { key: "assessment", field: "assessment", label: "Assessment", fullLabel: "Assessment", placeholder: "State the clinical impression and status of each problem.", required: true },
  { key: "plan", field: "treatmentPlan", label: "Plan", fullLabel: "Plan", placeholder: "Document medications, orders, counseling, procedures and rationale.", required: true },
  { key: "follow_up", field: "followUpInstructions", label: "Follow-up", fullLabel: "Follow-up instructions", placeholder: "Document return interval, precautions and patient instructions." },
  { key: "additional_note", field: "clinicalNote", label: "Additional", fullLabel: "Additional note", placeholder: "Add other clinically relevant documentation." },
] as const;

function mergeClinicalCodes(current: unknown, additions: string[]) {
  return Array.from(new Set([...String(current || "").split(",").map((code) => code.trim()).filter(Boolean), ...additions])).join(", ");
}

/** Billing ICD list = form.diagnosisCodes plus any coded working diagnoses from Assessment. */
function billingDiagnosisCodesFromForm(form: Record<string, string | boolean>) {
  const fromForm = String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
  const fromAssessment = codesFromAssessmentSubjectiveJson(form.subjectiveItemsJson);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const code of [...fromAssessment, ...fromForm]) {
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(code.toUpperCase());
  }
  return ordered;
}

function VisitNoteTemplateLibrary({ form, update }: SimpleFormProps) {
  const [query, setQuery] = useState("");
  const [templates, setTemplates] = useState<DataRow[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 3 || normalizedQuery === selectedTemplateName) {
      setTemplates([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/visit-note-templates?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
        const body = await response.json() as { templates?: DataRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to search templates.");
        setTemplates(body.templates || []);
      } catch (reason) {
        if (!controller.signal.aborted) setSearchError(reason instanceof Error ? reason.message : "Unable to search templates.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedTemplateName]);

  function templateFields(template: DataRow) {
    try { return JSON.parse(value(template, "templateJson") || "{}") as Record<string, string>; } catch { return {}; }
  }

  function exportTemplate(template: DataRow) {
    const fields = templateFields(template);
    const chiefComplaint = fields.chiefComplaint || value(template, "name");
    const historyOfPresentIllness = fields.historyOfPresentIllness || "";
    const currentSubjective = parseSubjectiveDocument(form.subjectiveItemsJson);
    const structuredSubjective: SubjectiveDocument = {
      ...currentSubjective,
      items: [{ id: crypto.randomUUID(), complaint: chiefComplaint, hpi: historyOfPresentIllness }],
      ...(fields.reviewOfSystems !== undefined ? { rosSelections: [], rosNormalSystems: [] } : {}),
    };
    update("subjectiveItemsJson", JSON.stringify(structuredSubjective));
    update("chiefComplaint", chiefComplaint);
    update("historyOfPresentIllness", historyOfPresentIllness);
    for (const field of ["reviewOfSystems", "physicalExam", "assessment", "treatmentPlan", "followUpInstructions", "clinicalNote"]) {
      if (fields[field] !== undefined) update(field, fields[field]);
    }
    const diagnosisCodes = list(template.suggestedDiagnosisCodes);
    const procedureCodes = list(template.suggestedProcedureCodes);
    const assist = {
      ...parseCodingAssistState(form.codingAssistJson),
      templateId: value(template, "id"),
      templateName: value(template, "name"),
      templateCategory: value(template, "category"),
      templateDiagnosisCodes: diagnosisCodes,
      templateProcedureCodes: procedureCodes,
      selectedIds: [
        ...diagnosisCodes.map((code) => `template-dx:${code}`),
        ...procedureCodes.map((code) => `template-cpt:${code}`),
      ],
    };
    update("codingAssistJson", JSON.stringify(assist));
    update("templateKey", value(template, "id"));
    setSelectedTemplateName(value(template, "name"));
    setQuery(value(template, "name"));
    setTemplates([]);
  }

  return <section className="visit-template-search visit-template-search-compact" id="visit-templates">
    <div className="visit-template-search-control"><label><span>⌕</span><input aria-autocomplete="list" aria-controls="visit-template-results" aria-expanded={templates.length > 0} aria-label="Search visit note templates" autoComplete="off" onChange={(event) => { setQuery(event.target.value); if (event.target.value !== selectedTemplateName) setSelectedTemplateName(""); }} placeholder="Search templates" value={query} />{isSearching && <em>Searching…</em>}</label>{templates.length > 0 && <div className="visit-template-ajax-results" id="visit-template-results" role="listbox">{templates.map((template) => <button key={value(template, "id")} onClick={() => exportTemplate(template)} role="option" type="button"><span><strong>{value(template, "name")}</strong><small>{value(template, "category")} · {value(template, "specialty")}</small></span><em>Insert</em></button>)}</div>}{query.trim().length >= 3 && !isSearching && !templates.length && !selectedTemplateName && !searchError && <span className="visit-template-search-message">No matching templates.</span>}{searchError && <span className="visit-template-search-message error">{searchError}</span>}</div>
    {selectedTemplateName && <div className="visit-template-inserted"><span>✓</span><span><strong>{selectedTemplateName} inserted</strong><small>SOAP updated. Review coding suggestions, mark counseling, then confirm codes before billing.</small></span></div>}
  </section>;
}

function VisitCodingAssistant({ data, form, update }: FormProps) {
  type AssistPayload = CodingAssistState & { templateDiagnosisCodes?: string[]; templateProcedureCodes?: string[] };
  const assist = useMemo(() => {
    const parsed = parseCodingAssistState(form.codingAssistJson) as AssistPayload;
    try {
      const raw = JSON.parse(String(form.codingAssistJson || "{}")) as AssistPayload;
      parsed.templateDiagnosisCodes = Array.isArray(raw.templateDiagnosisCodes) ? raw.templateDiagnosisCodes.map(String) : [];
      parsed.templateProcedureCodes = Array.isArray(raw.templateProcedureCodes) ? raw.templateProcedureCodes.map(String) : [];
    } catch { /* keep defaults */ }
    return parsed;
  }, [form.codingAssistJson]);

  const acceptedDx = billingDiagnosisCodesFromForm(form);
  const acceptedCpt = String(form.procedureCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
  let orderCodes: string[] = [];
  try {
    orderCodes = (JSON.parse(String(form.ordersJson || "[]")) as Array<Record<string, unknown>>)
      .map((row) => String(row.code || "").trim())
      .filter(Boolean);
  } catch { orderCodes = []; }

  const patientId = String(form.patientId || "");
  const hasMedicationList = (data.patientMedications || []).some((row) => value(row, "patientId") === patientId && value(row, "status") === "active");
  const medicationsReviewed = Boolean(form.medicationsReviewed);
  const subjective = parseSubjectiveDocument(form.subjectiveItemsJson);
  const visitTimeMinutes = String(subjective.visitTimeMinutes || assist.visitTimeMinutes || "");
  const templateDx = assist.templateDiagnosisCodes || [];
  const templateCpt = assist.templateProcedureCodes || [];
  const assessmentSignals = useMemo(
    () => assessmentCodingSignalsFromNote({
      problems: subjective.assessmentProblems,
      differentials: subjective.assessmentDifferentials,
      planJustification: subjective.assessmentPlanJustification,
      diagnosticNotes: subjective.diagnosticNotes,
    }),
    [
      subjective.assessmentProblems,
      subjective.assessmentDifferentials,
      subjective.assessmentPlanJustification,
      subjective.diagnosticNotes,
    ],
  );

  function suggestionInput(overrides: Partial<{
    visitTimeMinutes: string;
    counselingKeys: string[];
    qualityKeys: string[];
  }> = {}) {
    return {
      templateDiagnosisCodes: templateDx,
      templateProcedureCodes: templateCpt,
      templateCategory: assist.templateCategory,
      templateName: assist.templateName,
      visitTimeMinutes: overrides.visitTimeMinutes ?? visitTimeMinutes,
      counselingKeys: overrides.counselingKeys ?? assist.counselingKeys,
      qualityKeys: overrides.qualityKeys ?? assist.qualityKeys,
      orderCodes,
      telehealth: /telehealth/i.test(`${assist.templateName} ${assist.templateCategory}`),
      systolic: form.systolic,
      diastolic: form.diastolic,
      medicationsReviewed,
      hasMedicationList,
      acceptedDiagnosisCodes: acceptedDx,
      acceptedProcedureCodes: acceptedCpt,
      assessmentSignals,
    };
  }

  const suggestions = useMemo(
    () => buildVisitCodingSuggestions(suggestionInput()),
    [assist, templateDx, templateCpt, orderCodes, acceptedDx, acceptedCpt, form.systolic, form.diastolic, medicationsReviewed, hasMedicationList, visitTimeMinutes, assessmentSignals],
  );

  const selectedSet = useMemo(() => {
    if (assist.selectedIds.length) return new Set(assist.selectedIds);
    return new Set(suggestions.filter((row) => row.selected).map((row) => row.id));
  }, [assist.selectedIds, suggestions]);

  const unresolvedPrompts = ["historyOfPresentIllness", "reviewOfSystems", "physicalExam", "assessment", "treatmentPlan", "followUpInstructions"]
    .map((field) => String(form[field] || "").trim())
    .flatMap((text) => text.match(/\[[^\]]+\]/g) || []);

  function saveAssist(next: AssistPayload) {
    update("codingAssistJson", JSON.stringify({
      ...next,
      templateDiagnosisCodes: next.templateDiagnosisCodes || templateDx,
      templateProcedureCodes: next.templateProcedureCodes || templateCpt,
    }));
  }

  function toggleSuggestion(row: CodingSuggestion) {
    const nextSelected = new Set(selectedSet);
    if (nextSelected.has(row.id)) nextSelected.delete(row.id);
    else nextSelected.add(row.id);
    saveAssist({ ...assist, selectedIds: Array.from(nextSelected) });
  }

  function applyPlanPhrase(phrase: string, remove: boolean) {
    if (!phrase) return;
    const plan = String(form.treatmentPlan || "");
    if (remove) {
      update("treatmentPlan", plan.split(phrase).join("").replace(/\n{3,}/g, "\n\n").trim());
      return;
    }
    if (!plan.includes(phrase)) update("treatmentPlan", plan.trim() ? `${plan.trim()}\n${phrase}` : phrase);
  }

  function toggleCounseling(key: string) {
    const active = assist.counselingKeys.includes(key);
    const counselingKeys = active ? assist.counselingKeys.filter((item) => item !== key) : [...assist.counselingKeys, key];
    applyPlanPhrase(COUNSELING_OPTIONS.find((row) => row.key === key)?.planText || "", active);

    const nextSuggestions = buildVisitCodingSuggestions(suggestionInput({ counselingKeys }));
    const keep = new Set([...selectedSet].filter((id) => !id.includes(`:${key}:`) && !id.endsWith(`:${key}`)));
    if (!active) {
      for (const row of nextSuggestions) {
        if ((row.id.includes(`:${key}:`) || row.id.endsWith(`:${key}`)) && row.selected) keep.add(row.id);
      }
    }
    saveAssist({ ...assist, counselingKeys, selectedIds: Array.from(keep) });
  }

  function toggleQuality(key: string) {
    const active = assist.qualityKeys.includes(key);
    const qualityKeys = active ? assist.qualityKeys.filter((item) => item !== key) : [...assist.qualityKeys, key];
    applyPlanPhrase(QUALITY_OPTIONS.find((row) => row.key === key)?.planText || "", active);

    const nextSuggestions = buildVisitCodingSuggestions(suggestionInput({ qualityKeys }));
    const keep = new Set([...selectedSet].filter((id) => !id.includes(`:${key}:`) && !id.endsWith(`:${key}`)));
    if (!active) {
      for (const row of nextSuggestions) {
        if ((row.id.includes(`:${key}:`) || row.id.endsWith(`:${key}`)) && row.selected) keep.add(row.id);
      }
    }
    saveAssist({ ...assist, qualityKeys, selectedIds: Array.from(keep) });
  }

  function confirmSelected() {
    const chosen = suggestions.filter((row) => selectedSet.has(row.id));
    const dx = chosen.filter((row) => row.kind === "diagnosis").map((row) => row.code);
    const modifiers = chosen.filter((row) => row.kind === "modifier").map((row) => row.code);
    const procedures = applyModifierToProcedures(
      chosen.filter((row) => row.kind === "procedure" || row.kind === "quality").map((row) => row.code),
      modifiers,
    );
    update("diagnosisCodes", mergeClinicalCodes(form.diagnosisCodes, dx));
    update("procedureCodes", mergeClinicalCodes(form.procedureCodes, procedures));
    saveAssist({
      ...assist,
      selectedIds: suggestions.filter((row) => !selectedSet.has(row.id)).map((row) => row.id),
    });
  }

  const pendingCount = suggestions.filter((row) => selectedSet.has(row.id)).length;
  const codeLabel = (row: CodingSuggestion) => {
    if (row.kind === "quality") return row.label;
    const master = row.kind === "diagnosis"
      ? data.diagnosisCodes.find((item) => value(item, "code") === row.code)
      : data.procedureCodes.find((item) => value(item, "code") === row.code);
    return value(master || {}, "description") || row.label;
  };
  const kindBadge = (kind: CodingSuggestion["kind"]) => {
    if (kind === "diagnosis") return "DX";
    if (kind === "modifier") return "Mod";
    if (kind === "quality") return "Cat II";
    return "CPT";
  };

  return <section className="visit-coding-assistant" id="visit-coding-tray">
    <header>
      <div>
        <span className="eyebrow">Coding suggestions</span>
        <strong>{assist.templateName ? `Based on “${assist.templateName}”` : "Template, time, counseling, quality and orders"}</strong>
        <small>Mark what applies, then confirm. Category II codes are $0 quality reporting — nothing bills until you confirm.</small>
      </div>
      {pendingCount > 0 && <button className="primary-button" onClick={confirmSelected} type="button">Confirm {pendingCount} selected</button>}
    </header>

    <div className="visit-coding-controls">
      <div className="visit-coding-time visit-coding-time-readonly">
        <span>Time spent</span>
        <strong>{visitTimeMinutes ? `${visitTimeMinutes} min` : "Not recorded"}</strong>
        <small>{visitTimeMinutes ? "From Subjective · Visit & HPI" : "Enter minutes in Subjective → Visit & HPI"}</small>
      </div>
      <div className="visit-counseling-list" aria-label="Counseling provided">
        <span>Counseling provided</span>
        <div>
          {COUNSELING_OPTIONS.map((option) => <label key={option.key}><input checked={assist.counselingKeys.includes(option.key)} onChange={() => toggleCounseling(option.key)} type="checkbox" /><em>{option.label}</em></label>)}
        </div>
      </div>
      <div className="visit-counseling-list visit-quality-list" aria-label="Quality reporting">
        <span>Quality reporting</span>
        <div>
          {QUALITY_OPTIONS.map((option) => <label key={option.key}><input checked={assist.qualityKeys.includes(option.key)} onChange={() => toggleQuality(option.key)} type="checkbox" /><em>{option.label}</em></label>)}
          {medicationsReviewed && <span className="visit-quality-hint">Meds reviewed on Safety → suggests 1160F</span>}
          {(form.systolic || form.diastolic) && <span className="visit-quality-hint">BP {String(form.systolic || "—")}/{String(form.diastolic || "—")} → suggests Cat II BP codes</span>}
        </div>
      </div>
    </div>

    {unresolvedPrompts.length > 0 && <div className="visit-coding-alert"><strong>Complete template prompts</strong><span>{unresolvedPrompts.length} bracketed prompt{unresolvedPrompts.length === 1 ? "" : "s"} still open in the note.</span></div>}

    {suggestions.length ? <div className="visit-coding-suggestions" role="list">
      {suggestions.map((row) => <label className={`visit-coding-row kind-${row.kind} ${selectedSet.has(row.id) ? "selected" : ""}`} key={row.id} role="listitem">
        <input checked={selectedSet.has(row.id)} onChange={() => toggleSuggestion(row)} type="checkbox" />
        <span>
          <strong>{row.code}</strong>
          <small>{codeLabel(row)}</small>
          <em>{row.reason}</em>
        </span>
        <b>{kindBadge(row.kind)}</b>
      </label>)}
    </div> : <p className="visit-coding-empty">Insert a visit template, add time, counseling or quality items, or place orders to see suggested codes.</p>}

    {(acceptedDx.length > 0 || acceptedCpt.length > 0) && <footer className="visit-coding-accepted">
      <small>Accepted on visit: {[...acceptedDx, ...acceptedCpt].join(", ") || "none"}</small>
    </footer>}
  </section>;
}

function ClinicalPhraseField({ data, form, update, field, section, label, placeholder, required = false, dictate = true, objectivePolish = false }: FormProps & { field: string; section: string; label: string; placeholder: string; required?: boolean; dictate?: boolean; objectivePolish?: boolean }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const rows = normalized.length >= 2 ? data.clinicalContentItems.filter((row) => value(row, "section") === section && `${value(row, "title")} ${value(row, "content")} ${value(row, "keywords")}`.toLowerCase().includes(normalized)).slice(0, 8) : [];
  function insert(content: string) {
    const current = String(form[field] || "").trim();
    if (!current.includes(content)) update(field, current ? `${current}\n${content}` : content);
    setQuery("");
  }
  return (
    <div className="soap-phrase-field">
      {dictate ? (
        <DictateMicField
          label={label}
          onChange={(next) => update(field, next)}
          placeholder={placeholder}
          polish={objectivePolish ? polishObjectiveLocally : undefined}
          polishLabel="Clean"
          required={required}
          rows={6}
          value={String(form[field] || "")}
        />
      ) : (
        <TextArea form={form} label={label} name={field} placeholder={placeholder} required={required} rows={6} update={update} />
      )}
      <div className="soap-phrase-search">
        <label>
          <span>⌕</span>
          <input aria-label={`Search ${label} templates`} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()} smart phrases`} value={query} />
        </label>
        {rows.length > 0 && (
          <div>
            {rows.map((row) => (
              <button key={value(row, "id")} onClick={() => insert(value(row, "content"))} type="button">
                <span><strong>{value(row, "title")}</strong><small>{value(row, "content")}</small></span>
                <em>＋</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type SubjectiveItem = {
  id: string; complaint: string; hpi: string; patientWords?: string; onset?: string; location?: string;
  duration?: string; character?: string; severity?: string; frequency?: string; aggravating?: string;
  relieving?: string; associatedSymptoms?: string; relevantNegatives?: string; priorTreatment?: string;
  progress?: string; functionalImpact?: string; context?: string; selfTreatment?: string;
  selfTreatmentEffectiveness?: string; previousEpisodes?: string; previousEpisodeManagement?: string;
  previousEpisodeOutcome?: string; priorInvestigations?: string;
};
type SubjectiveDocument = {
  version: 2; source: string; sourceDetails: string; interpreter: string; patientConcern: string;
  patientGoal: string; treatmentPreference: string; clinicianObservation: string; visitType?: string;
  visitTimeMinutes?: string;
  medicalHistory?: Array<{ id: string; condition: string; status: string; notes: string }>;
  familyHistory?: Array<{ id: string; relationship: string; condition: string; notes: string }>;
  psychiatricHistory?: string; socialHistory?: string; priorInvestigations?: string;
  priorTreatments?: string; otherRelevantInfo?: string;
  historySelections?: Array<{ id: string; group: string; label: string; note: string }>;
  socialHistoryDetails?: {
    tobaccoStatus?: string; tobaccoType?: string; tobaccoAmount?: string; tobaccoYears?: string; tobaccoQuitDate?: string;
    alcoholStatus?: string; alcoholFrequency?: string; alcoholAmount?: string;
    drugStatus?: string; drugSubstances?: string; occupation?: string; livingSituation?: string; physicalActivity?: string;
  };
  rosSelections?: Array<{ id: string; system: string; symptom: string; status: "positive" | "negative"; note?: string }>;
  rosNormalSystems?: string[];
  examNormalSystems?: string[];
  examFindings?: Array<{ id: string; system: string; finding: string; status: "normal" | "abnormal"; detail?: string }>;
  diagnosticNotes?: string;
  generalAppearance?: string;
  clinicGlucose?: string;
  includedResultIds?: string[];
  objectiveVerifiedDos?: string;
  assessmentSummary?: string;
  assessmentProblems?: Array<{ id: string; diagnosis: string; code?: string; severity: "" | "mild" | "moderate" | "severe"; status: "" | "new" | "stable" | "improving" | "worsening" | "uncontrolled" | "resolved"; reasoning: string; response: string }>;
  assessmentDifferentials?: Array<{ id: string; diagnosis: string; whyLessLikely: string }>;
  assessmentPlanJustification?: string;
  items: SubjectiveItem[];
};

function parseSubjectiveDocument(input: unknown): SubjectiveDocument {
  const empty: SubjectiveDocument = {
    version: 2, source: "patient", sourceDetails: "", interpreter: "no", patientConcern: "", patientGoal: "", treatmentPreference: "", clinicianObservation: "", visitType: "problem", visitTimeMinutes: "",
    medicalHistory: [], familyHistory: [], rosSelections: [], rosNormalSystems: [], examNormalSystems: [], examFindings: [], diagnosticNotes: "", generalAppearance: "", clinicGlucose: "", includedResultIds: [], objectiveVerifiedDos: "",
    assessmentSummary: "", assessmentProblems: [], assessmentDifferentials: [], assessmentPlanJustification: "", items: [],
  };
  try {
    const parsed = JSON.parse(String(input || "[]")) as SubjectiveDocument | SubjectiveItem[];
    if (Array.isArray(parsed)) return { ...empty, items: parsed };
    if (parsed && Array.isArray(parsed.items)) {
      return {
        ...empty,
        ...parsed,
        version: 2,
        items: parsed.items,
        assessmentProblems: Array.isArray(parsed.assessmentProblems) ? parsed.assessmentProblems : [],
        assessmentDifferentials: Array.isArray(parsed.assessmentDifferentials) ? parsed.assessmentDifferentials : [],
        assessmentSummary: String(parsed.assessmentSummary || ""),
        assessmentPlanJustification: String(parsed.assessmentPlanJustification || ""),
      };
    }
  } catch { /* Preserve an empty structured note when legacy JSON cannot be read. */ }
  return empty;
}

function buildReviewOfSystemsText(document: Pick<SubjectiveDocument, "rosNormalSystems" | "rosSelections">) {
  const normals = (document.rosNormalSystems || []).map((system) => `${system.replaceAll("_", " ")}: Normal.`);
  const findings = (document.rosSelections || []).map((item) => `${item.system.replaceAll("_", " ")}: ${item.status === "negative" ? "Denies" : "Reports"} ${item.symptom.toLowerCase()}${item.note ? ` (${item.note})` : ""}.`);
  return [...normals, ...findings].join("\n");
}

function activePatientAllergies(rows: DataRow[] | undefined, patientId: string) {
  return (rows || []).filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active");
}

function subjectiveNarrative(item: SubjectiveItem) {
  const details = [
    item.onset && `Onset: ${item.onset}`,
    item.location && `Location: ${item.location}`,
    item.duration && `Duration: ${item.duration}`,
    item.character && `Character: ${item.character}`,
    item.severity && `Severity: ${item.severity}`,
    item.frequency && `Frequency: ${item.frequency}`,
    item.context && `Context: ${item.context}`,
    item.aggravating && `Aggravating factors: ${item.aggravating}`,
    item.relieving && `Relieving factors: ${item.relieving}`,
    item.associatedSymptoms && `Associated symptoms: ${item.associatedSymptoms}`,
    item.relevantNegatives && `Relevant negatives: ${item.relevantNegatives}`,
    item.priorTreatment && `Prior treatment and response: ${item.priorTreatment}`,
    item.selfTreatment && `Self-treatment attempted: ${item.selfTreatment}`,
    item.selfTreatmentEffectiveness && `Self-treatment effectiveness: ${item.selfTreatmentEffectiveness}`,
    item.previousEpisodes && `Previous similar episodes: ${item.previousEpisodes}`,
    item.previousEpisodeManagement && `Previous episode management: ${item.previousEpisodeManagement}`,
    item.previousEpisodeOutcome && `Previous episode outcome: ${item.previousEpisodeOutcome}`,
    item.priorInvestigations && `Prior investigations: ${item.priorInvestigations}`,
    item.progress && `Since the last visit: ${item.progress}`,
    item.functionalImpact && `Functional impact: ${item.functionalImpact}`,
  ].filter(Boolean);
  return details.join(". ") + (details.length ? "." : "");
}

function referringProviderLabel(row: DataRow) {
  return `${value(row, "firstName")} ${value(row, "lastName")}${value(row, "credentials") ? `, ${value(row, "credentials")}` : ""}`.trim();
}

function ExtendedHpiFields({ item, patch }: { item: SubjectiveItem; patch: (changes: Partial<SubjectiveItem>) => void }) {
  const fields: Array<[string, keyof SubjectiveItem, string]> = [
    ["Context", "context", "Circumstances when it occurs"],
    ["Self-treatment attempted", "selfTreatment", "Home/OTC measures already tried"],
    ["Self-treatment effectiveness", "selfTreatmentEffectiveness", "Benefit, no benefit or adverse response"],
    ["Previous similar episodes", "previousEpisodes", "When, frequency and similarity"],
    ["Previous episode management", "previousEpisodeManagement", "How earlier episodes were managed"],
    ["Previous episode outcome", "previousEpisodeOutcome", "Resolution, recurrence or complications"],
    ["Prior investigations", "priorInvestigations", "Relevant tests and known results"],
  ];
  return <details className="extended-hpi-fields"><summary>Additional HPI details <span>{fields.some(([, key]) => Boolean(item[key])) ? "Details added" : "Optional"}</span></summary><div>{fields.map(([label, key, placeholder]) => <label key={key}>{label}<input onChange={(event) => patch({ [key]: event.target.value })} placeholder={placeholder} value={String(item[key] || "")} /></label>)}</div></details>;
}

function HistorySmartPicker({ data, document, write, group, title, placeholder }: { data: WorkspaceData; document: SubjectiveDocument; write: (next: SubjectiveDocument) => void; group: string; title: string; placeholder: string }) {
  const [query, setQuery] = useState("");
  const [localOptions, setLocalOptions] = useState<DataRow[]>([]);
  const [status, setStatus] = useState("");
  const selections = (document.historySelections || []).filter((item) => item.group === group);
  const options = [...(data.clinicalOptions || []).filter((row) => value(row, "optionGroup") === group), ...localOptions];
  const normalized = query.trim().toLowerCase();
  const matches = normalized.length >= 2 ? options.filter((row) => `${value(row, "label")} ${value(row, "keywords")}`.toLowerCase().includes(normalized) && !selections.some((item) => item.id === value(row, "code"))).slice(0, 8) : [];
  function select(row: DataRow) {
    write({ ...document, historySelections: [...(document.historySelections || []), { id: value(row, "code"), group, label: value(row, "label"), note: "" }] });
    setQuery(""); setStatus("");
  }
  function remove(id: string) { write({ ...document, historySelections: (document.historySelections || []).filter((item) => !(item.group === group && item.id === id)) }); }
  function updateNote(id: string, note: string) { write({ ...document, historySelections: (document.historySelections || []).map((item) => item.group === group && item.id === id ? { ...item, note } : item) }); }
  async function addCustom() {
    if (!query.trim()) return;
    setStatus("Saving…");
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveClinicalOption", optionGroup: group, label: query.trim() }) });
      const body = await response.json() as { item?: DataRow; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error || "Unable to add this history option.");
      setLocalOptions((current) => [...current, body.item!]); select(body.item); setStatus("Added to the practice search directory.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Unable to add this history option."); }
  }
  return <section className="history-smart-picker"><header><strong>{title}</strong><small>{selections.length} selected</small></header><div className="history-smart-search"><span>⌕</span><input aria-label={`Search ${title}`} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} value={query} /><button aria-label={`Add ${title} option`} disabled={!query.trim()} onClick={() => void addCustom()} title={`Add ${title} option`} type="button">＋</button>{matches.length > 0 && <div>{matches.map((row) => <button key={value(row, "code")} onClick={() => select(row)} type="button"><span><strong>{value(row, "label")}</strong><small>{value(row, "keywords")}</small></span><em aria-hidden="true">＋</em></button>)}</div>}</div><div className="history-selection-list">{selections.map((item) => <article key={item.id}><span><strong>{item.label}</strong><button aria-label={`Remove ${item.label}`} onClick={() => remove(item.id)} type="button">×</button></span><input aria-label={`${item.label} details`} onChange={(event) => updateNote(item.id, event.target.value)} placeholder="Optional date, result, response or relevant context" value={item.note} /></article>)}</div>{status && <small className="history-picker-status">{status}</small>}</section>;
}

function RelevantHistoryDetails({ data, document, write }: { data: WorkspaceData; document: SubjectiveDocument; write: (next: SubjectiveDocument) => void }) {
  const social = document.socialHistoryDetails || {};
  function patchSocial(key: keyof NonNullable<SubjectiveDocument["socialHistoryDetails"]>, nextValue: string) { write({ ...document, socialHistoryDetails: { ...social, [key]: nextValue } }); }
  return <section className="relevant-history-details"><header><span><strong>Other history relevant to today’s visit</strong><small>Search, select and add verified items. Add a short note only when needed.</small></span><small>Information remains part of this encounter’s reviewable record.</small></header><div className="history-picker-grid"><HistorySmartPicker data={data} document={document} group="psychiatric_history" placeholder="Search depression, anxiety, PTSD…" title="Psychiatric history" write={write} /><HistorySmartPicker data={data} document={document} group="investigation_history" placeholder="Search CBC, MRI, EKG, colonoscopy…" title="Prior investigations" write={write} /><HistorySmartPicker data={data} document={document} group="treatment_history" placeholder="Search medication, therapy, procedure…" title="Prior treatments" write={write} /></div><section className="structured-social-history"><header><strong>Social history</strong><small>Structured values create a clearer note than a single paragraph.</small></header><div className="social-history-grid"><label>Tobacco use<select onChange={(event) => patchSocial("tobaccoStatus", event.target.value)} value={social.tobaccoStatus || ""}><option value="">Select</option><option value="never">Never</option><option value="current">Current</option><option value="former">Former</option><option value="passive">Passive exposure</option><option value="unknown">Unknown</option></select></label>{["current", "former"].includes(social.tobaccoStatus || "") && <><label>Product<select onChange={(event) => patchSocial("tobaccoType", event.target.value)} value={social.tobaccoType || ""}><option value="">Select</option><option value="cigarettes">Cigarettes</option><option value="cigars">Cigars</option><option value="pipe">Pipe</option><option value="smokeless">Smokeless tobacco</option><option value="vaping">Vaping / e-cigarette</option><option value="multiple">Multiple products</option></select></label><label>Amount / day<input onChange={(event) => patchSocial("tobaccoAmount", event.target.value)} placeholder="Packs, cigarettes or uses" value={social.tobaccoAmount || ""} /></label><label>Years used<input onChange={(event) => patchSocial("tobaccoYears", event.target.value)} inputMode="numeric" placeholder="Years" value={social.tobaccoYears || ""} /></label>{social.tobaccoStatus === "former" && <label>Quit date<input onChange={(event) => patchSocial("tobaccoQuitDate", event.target.value)} type="date" value={social.tobaccoQuitDate || ""} /></label>}</>}<label>Alcohol use<select onChange={(event) => patchSocial("alcoholStatus", event.target.value)} value={social.alcoholStatus || ""}><option value="">Select</option><option value="never">Never</option><option value="current">Current</option><option value="former">Former</option><option value="unknown">Unknown</option></select></label>{social.alcoholStatus === "current" && <><label>Frequency<select onChange={(event) => patchSocial("alcoholFrequency", event.target.value)} value={social.alcoholFrequency || ""}><option value="">Select</option><option value="monthly_or_less">Monthly or less</option><option value="2_to_4_month">2–4 times/month</option><option value="2_to_3_week">2–3 times/week</option><option value="4_plus_week">4+ times/week</option></select></label><label>Typical amount<input onChange={(event) => patchSocial("alcoholAmount", event.target.value)} placeholder="Drinks per occasion" value={social.alcoholAmount || ""} /></label></>}<label>Recreational drug use<select onChange={(event) => patchSocial("drugStatus", event.target.value)} value={social.drugStatus || ""}><option value="">Select</option><option value="never">Never</option><option value="current">Current</option><option value="former">Former</option><option value="unknown">Unknown</option></select></label>{["current", "former"].includes(social.drugStatus || "") && <label>Substance(s)<input onChange={(event) => patchSocial("drugSubstances", event.target.value)} placeholder="Type or search terms" value={social.drugSubstances || ""} /></label>}<label>Occupation<input onChange={(event) => patchSocial("occupation", event.target.value)} placeholder="Occupation / employment" value={social.occupation || ""} /></label><label>Living situation<select onChange={(event) => patchSocial("livingSituation", event.target.value)} value={social.livingSituation || ""}><option value="">Select</option><option value="alone">Lives alone</option><option value="family">Lives with family</option><option value="caregiver">Lives with caregiver</option><option value="assisted">Assisted living</option><option value="facility">Skilled/nursing facility</option><option value="unstable">Housing unstable</option><option value="other">Other</option></select></label><label>Physical activity<select onChange={(event) => patchSocial("physicalActivity", event.target.value)} value={social.physicalActivity || ""}><option value="">Select</option><option value="none">None</option><option value="limited">Limited</option><option value="1_2_week">1–2 days/week</option><option value="3_4_week">3–4 days/week</option><option value="5_plus_week">5+ days/week</option></select></label></div></section><label className="history-other-notes">Other relevant information<textarea onChange={(event) => write({ ...document, otherRelevantInfo: event.target.value })} placeholder="Exposures, barriers, safety concerns or other history affecting today’s care" rows={2} value={document.otherRelevantInfo || ""} /></label></section>;
}

function PatientSafetyReview({ data, form, update, onPatientAllergiesChange }: FormProps) {
  const patientId = String(form.patientId || "");
  const [allergies, setAllergies] = useState<DataRow[]>(() => (data.patientAllergies || []).filter((row) => value(row, "patientId") === patientId));
  const [draft, setDraft] = useState({ allergyType: "drug", substance: "", reaction: "", severity: "unknown", onsetDate: "", source: "patient", notes: "" });
  const [status, setStatus] = useState("");
  const active = allergies.filter((row) => value(row, "status") === "active");
  const medications = (data.patientMedications || []).filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active");

  useEffect(() => {
    setAllergies((data.patientAllergies || []).filter((row) => value(row, "patientId") === patientId));
  }, [data.patientAllergies, patientId]);

  function publishAllergies(next: DataRow[]) {
    setAllergies(next);
    onPatientAllergiesChange?.(patientId, next);
  }

  async function request(payload: DataRow) {
    const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json() as DataRow;
    if (!response.ok) throw new Error(value(body, "error") || "Unable to update allergy records.");
    return body;
  }
  async function addAllergy(nkda = false) {
    setStatus("Saving…");
    try {
      const body = await request({ action: "createPatientAllergy", patientId, encounterId: form.id || "", ...draft, allergyType: nkda ? "nkda" : draft.allergyType, substance: nkda ? "No known drug allergies" : draft.substance });
      const item = body.item as DataRow;
      publishAllergies([...allergies.map((row) => value(row, "status") === "active" && (nkda || value(row, "allergyType") === "nkda") ? { ...row, status: "inactive" } : row), item]);
      setDraft({ allergyType: "drug", substance: "", reaction: "", severity: "unknown", onsetDate: "", source: "patient", notes: "" });
      update("allergiesReviewed", true); setStatus("Allergy list updated and reviewed.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Unable to save allergy."); }
  }
  async function changeStatus(id: string, nextStatus: "inactive" | "entered_in_error") {
    try {
      await request({ action: "updatePatientAllergyStatus", id, status: nextStatus });
      publishAllergies(allergies.map((row) => value(row, "id") === id ? { ...row, status: nextStatus } : row));
      setStatus("Allergy history updated.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Unable to update allergy."); }
  }
  async function review() {
    if (!active.length) { setStatus("Record at least one allergy or explicitly mark NKDA before review."); return; }
    try {
      const body = await request({ action: "reviewPatientAllergies", patientId });
      update("allergiesReviewed", true);
      publishAllergies(allergies.map((row) => value(row, "status") === "active" ? { ...row, reviewedAt: body.reviewedAt, reviewedByName: body.reviewedByName } : row));
      setStatus("Allergies reconciled for this encounter.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Unable to review allergies."); }
  }
  return <section className="patient-safety-review"><header><div><strong>Allergies & medication safety</strong><small>Patient-level records remain available at every encounter. Verify; do not assume a blank list means none.</small></div><div><button onClick={() => void addAllergy(true)} type="button">Mark NKDA</button><button className="primary" onClick={() => void review()} type="button">Review for encounter</button></div></header><div className="allergy-active-list">{active.length ? active.map((row) => <article className={value(row, "severity") === "severe" ? "severe" : ""} key={value(row, "id")}><div><strong>{value(row, "substance")}</strong><small>{value(row, "allergyType")} · {value(row, "severity")} severity{value(row, "reaction") ? ` · Reaction: ${value(row, "reaction")}` : ""}</small><small>Reviewed {shortDate(value(row, "reviewedAt"), true)} by {value(row, "reviewedByName") || "—"}</small></div><div><button onClick={() => void changeStatus(value(row, "id"), "inactive")} type="button">Resolve</button><button onClick={() => void changeStatus(value(row, "id"), "entered_in_error")} type="button">Entered in error</button></div></article>) : <div className="allergy-empty"><strong>Allergy status is not documented</strong><span>Add an allergy or explicitly mark NKDA.</span></div>}</div><div className="allergy-entry-grid"><label>Type<select onChange={(event) => setDraft((current) => ({ ...current, allergyType: event.target.value }))} value={draft.allergyType}><option value="drug">Drug</option><option value="food">Food</option><option value="environmental">Environmental</option><option value="other">Other</option></select></label><label>Allergen / substance<input onChange={(event) => setDraft((current) => ({ ...current, substance: event.target.value }))} placeholder="e.g. penicillin" value={draft.substance} /></label><label>Reaction<input onChange={(event) => setDraft((current) => ({ ...current, reaction: event.target.value }))} placeholder="e.g. hives" value={draft.reaction} /></label><label>Severity<select onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))} value={draft.severity}><option value="unknown">Unknown</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label><label>Onset date<input onChange={(event) => setDraft((current) => ({ ...current, onsetDate: event.target.value }))} type="date" value={draft.onsetDate} /></label><button disabled={!draft.substance.trim()} onClick={() => void addAllergy()} type="button">Add allergy</button></div><div className="active-medication-summary"><div><strong>Active medications ({medications.length})</strong><small>{medications.length ? medications.map((row) => value(row, "medicationName")).join(" · ") : "No active medications recorded"}</small></div><label><input checked={Boolean(form.medicationsReviewed)} onChange={(event) => update("medicationsReviewed", event.target.checked)} type="checkbox" /> Medications reconciled</label></div>{status && <p>{status}</p>}</section>;
}

function ReferringProviderPicker({ data, form, update }: FormProps) {
  const [providers, setProviders] = useState(data.referringProviders);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [npiQuery, setNpiQuery] = useState("");
  const [registryState, setRegistryState] = useState("");
  const [registryResults, setRegistryResults] = useState<DataRow[]>([]);
  const [registryStatus, setRegistryStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({ firstName: "", lastName: "", credentials: "", npi: "", taxonomyCode: "", specialty: "", organizationName: "", phone: "", addressLine1: "", city: "", state: "", postalCode: "" });
  const normalized = query.trim().toLowerCase();
  const matches = normalized.length >= 2 ? providers.filter((row) => `${referringProviderLabel(row)} ${value(row, "npi")} ${value(row, "specialty")}`.toLowerCase().includes(normalized)).slice(0, 8) : [];
  const selected = providers.find((row) => value(row, "id") === String(form.referringProviderId || ""));

  useEffect(() => {
    const search = npiQuery.trim();
    if (search.length < 2) { setRegistryResults([]); setRegistryStatus(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRegistryStatus("Searching CMS NPI Registry…");
      try {
        const response = await fetch(`/api/npi-registry?q=${encodeURIComponent(search)}&state=${encodeURIComponent(registryState)}`, { signal: controller.signal });
        const body = await response.json() as { results?: DataRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Registry search failed.");
        setRegistryResults(body.results || []);
        setRegistryStatus(body.results?.length ? "" : "No matching individual providers found.");
      } catch (reason) {
        if (!controller.signal.aborted) setRegistryStatus(reason instanceof Error ? reason.message : "Registry search failed.");
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [npiQuery, registryState]);

  function chooseRegistry(row: DataRow) {
    setDraft((current) => ({ ...current, ...Object.fromEntries(Object.keys(current).map((key) => [key, value(row, key)])) }));
    setRegistryResults([]);
    setNpiQuery(`${value(row, "firstName")} ${value(row, "lastName")}`);
    setRegistryStatus("Registry details copied. Review before saving.");
  }

  async function saveProvider() {
    setSaving(true); setRegistryStatus("");
    try {
      const response = await fetch("/api/referring-providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json() as { provider?: DataRow; error?: string };
      if (!response.ok || !body.provider) throw new Error(body.error || "Unable to save referring provider.");
      setProviders((current) => [...current, body.provider!]);
      update("referringProviderId", value(body.provider, "id"));
      setQuery(referringProviderLabel(body.provider)); setAdding(false);
    } catch (reason) { setRegistryStatus(reason instanceof Error ? reason.message : "Unable to save referring provider."); }
    finally { setSaving(false); }
  }

  return <section className="referring-provider-picker">
    <div className="subjective-label-row"><label>Referring provider</label><button aria-label="Add referring provider" onClick={() => setAdding((current) => !current)} type="button">＋</button></div>
    {selected ? <div className="selected-referring-provider"><span><strong>{referringProviderLabel(selected)}</strong><small>NPI {value(selected, "npi")} · {value(selected, "specialty")}</small></span><button onClick={() => { update("referringProviderId", ""); setQuery(""); }} type="button">Change</button></div> : <div className="subjective-combobox"><input aria-label="Search referring providers" autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, specialty or NPI" value={query} />{matches.length > 0 && <div>{matches.map((row) => <button key={value(row, "id")} onClick={() => { update("referringProviderId", value(row, "id")); setQuery(referringProviderLabel(row)); }} type="button"><span><strong>{referringProviderLabel(row)}</strong><small>{value(row, "specialty")} · NPI {value(row, "npi")}</small></span><em>Select</em></button>)}</div>}</div>}
    {adding && <div className="referring-quick-add"><div className="referring-quick-head"><span><strong>Add referring provider</strong><small>Search the official NPI Registry, review the match, then save it to the provider master.</small></span><button onClick={() => setAdding(false)} type="button">×</button></div><div className="npi-search-row"><input aria-label="Search NPI Registry" onChange={(event) => setNpiQuery(event.target.value)} placeholder="Name or 10-digit NPI" value={npiQuery} /><input aria-label="NPI Registry state" maxLength={2} onChange={(event) => setRegistryState(event.target.value.toUpperCase())} placeholder="State" value={registryState} /></div>{registryResults.length > 0 && <div className="npi-results">{registryResults.map((row) => <button key={value(row, "npi")} onClick={() => chooseRegistry(row)} type="button"><span><strong>{referringProviderLabel(row)}</strong><small>{value(row, "specialty")} · {value(row, "city")}, {value(row, "state")}</small></span><em>NPI {value(row, "npi")}</em></button>)}</div>}<div className="referring-quick-grid">{[["First name", "firstName"], ["Last name", "lastName"], ["Credentials", "credentials"], ["NPI", "npi"], ["Specialty", "specialty"], ["Taxonomy", "taxonomyCode"], ["Phone", "phone"], ["Address", "addressLine1"], ["City", "city"], ["State", "state"], ["ZIP", "postalCode"]].map(([label, key]) => <label key={key}>{label}<input onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} value={draft[key] || ""} /></label>)}</div>{registryStatus && <p className="npi-status">{registryStatus}</p>}<div className="referring-save-row"><small>NPI Registry data identifies the record; it does not verify licensure or credentialing.</small><button disabled={saving} onClick={saveProvider} type="button">{saving ? "Saving…" : "Save & select"}</button></div></div>}
  </section>;
}

function SubjectiveWorkspace({ data, form, update }: FormProps) {
  const parseItems = (): SubjectiveItem[] => { try { const parsed = JSON.parse(String(form.subjectiveItemsJson || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
  const items = parseItems();
  const [complaintQuery, setComplaintQuery] = useState("");
  const [hpiQuery, setHpiQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState(items[0]?.id || "");
  const [localLibrary, setLocalLibrary] = useState(data.subjectiveLibraryItems || []);
  const [libraryStatus, setLibraryStatus] = useState("");
  const complaintMatches = complaintQuery.trim().length >= 2 ? localLibrary.filter((row) => ["complaint", "template"].includes(value(row, "itemType")) && `${value(row, "title")} ${value(row, "keywords")}`.toLowerCase().includes(complaintQuery.trim().toLowerCase())).slice(0, 8) : [];
  const hpiCatalog = [...localLibrary.filter((row) => ["hpi", "template"].includes(value(row, "itemType"))), ...data.clinicalContentItems.filter((row) => value(row, "section") === "hpi").map((row) => ({ ...row, itemType: "hpi" }))];
  const hpiMatches = hpiQuery.trim().length >= 2 ? hpiCatalog.filter((row) => `${value(row, "title")} ${value(row, "content")} ${value(row, "keywords")}`.toLowerCase().includes(hpiQuery.trim().toLowerCase())).slice(0, 8) : [];

  function sync(next: SubjectiveItem[]) {
    update("subjectiveItemsJson", JSON.stringify(next));
    update("chiefComplaint", next.map((item) => item.complaint.trim()).filter(Boolean).join("; "));
    update("historyOfPresentIllness", next.map((item) => item.hpi.trim()).filter(Boolean).join("\n\n"));
  }
  function addComplaint(complaint: string, hpi = "") {
    if (!complaint.trim()) return;
    const next = { id: crypto.randomUUID(), complaint: complaint.trim(), hpi };
    sync([...items, next]); setActiveItemId(next.id); setComplaintQuery("");
  }
  function patchItem(id: string, changes: Partial<SubjectiveItem>) { sync(items.map((item) => item.id === id ? { ...item, ...changes } : item)); }
  function moveItem(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; sync(next); }
  function addHpi(content: string) { const id = activeItemId || items[0]?.id; if (!id) return; const current = items.find((item) => item.id === id); if (!current) return; patchItem(id, { hpi: current.hpi.includes(content) ? current.hpi : [current.hpi, content].filter(Boolean).join("\n") }); setHpiQuery(""); }
  async function saveLibrary(itemType: "complaint" | "hpi" | "template", title: string, content: string) {
    if (!title.trim() || !content.trim()) return;
    setLibraryStatus("Saving to your personal draft library…");
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveSubjectiveLibraryItem", itemType, title, content, associatedComplaints: items.map((item) => item.complaint) }) });
      const body = await response.json() as { item?: DataRow; error?: string; existing?: boolean };
      if (!response.ok || !body.item) throw new Error(body.error || "Unable to save library item.");
      setLocalLibrary((current) => current.some((row) => value(row, "id") === value(body.item!, "id")) ? current : [...current, body.item!]);
      setLibraryStatus(body.existing ? "This item is already in the library." : "Saved as a personal draft. It is not published practice-wide.");
    } catch (reason) { setLibraryStatus(reason instanceof Error ? reason.message : "Unable to save library item."); }
  }

  return <div className="subjective-workspace"><div className="subjective-top-grid"><div><div className="subjective-label-row"><label>Chief complaints <b>*</b></label><small>{items.length} added</small></div><div className="subjective-combobox"><input aria-label="Search chief complaints" autoComplete="off" onChange={(event) => setComplaintQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && complaintQuery.trim()) { event.preventDefault(); addComplaint(complaintQuery); } }} placeholder="Search or type a new complaint" value={complaintQuery} />{complaintMatches.length > 0 && <div>{complaintMatches.map((row) => <button key={value(row, "id")} onClick={() => addComplaint(value(row, "title"), value(row, "content"))} type="button"><span><strong>{value(row, "title")}</strong><small>{value(row, "content")}</small></span><em>Add</em></button>)}</div>}</div>{complaintQuery.trim().length >= 2 && !complaintMatches.length && <button className="subjective-create-button" onClick={() => addComplaint(complaintQuery)} type="button">＋ Add “{complaintQuery.trim()}” to this visit</button>}</div><ReferringProviderPicker data={data} form={form} update={update} /></div>
    <div className="subjective-card-list">{items.length ? items.map((item, index) => <article className={activeItemId === item.id ? "active" : ""} key={item.id} onClick={() => setActiveItemId(item.id)}><div className="subjective-card-head"><span>{index + 1}</span><input aria-label={`Complaint ${index + 1}`} onChange={(event) => patchItem(item.id, { complaint: event.target.value })} value={item.complaint} /><div><button aria-label="Move complaint up" disabled={index === 0} onClick={() => moveItem(index, -1)} type="button">↑</button><button aria-label="Move complaint down" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} type="button">↓</button><button aria-label="Remove complaint" onClick={() => sync(items.filter((row) => row.id !== item.id))} type="button">×</button></div></div><label>History of present illness<textarea onChange={(event) => patchItem(item.id, { hpi: event.target.value })} placeholder="Onset, duration, severity, modifying factors and associated symptoms" rows={4} value={item.hpi} /></label><div className="subjective-card-footer"><small>Save useful wording explicitly; chart text is never auto-published.</small><button onClick={() => saveLibrary("template", item.complaint, item.hpi || item.complaint)} type="button">Save as my template</button></div></article>) : <div className="subjective-empty"><strong>Start with the patient’s reason for visit</strong><span>Search an existing complaint or type a new one. Add as many as needed.</span></div>}</div>
    {items.length > 0 && <section className="hpi-library-search"><div><strong>Add HPI wording to selected complaint</strong><small>{items.find((item) => item.id === activeItemId)?.complaint || items[0].complaint}</small></div><div className="subjective-combobox"><input aria-label="Search HPI library" onChange={(event) => setHpiQuery(event.target.value)} placeholder="Search HPI phrases" value={hpiQuery} />{hpiMatches.length > 0 && <div>{hpiMatches.map((row) => <button key={value(row, "id")} onClick={() => addHpi(value(row, "content"))} type="button"><span><strong>{value(row, "title")}</strong><small>{value(row, "content")}</small></span><em>Insert</em></button>)}</div>}</div>{hpiQuery.trim().length >= 2 && !hpiMatches.length && <button className="subjective-create-button" onClick={() => { addHpi(hpiQuery.trim()); void saveLibrary("hpi", hpiQuery.trim().slice(0, 70), hpiQuery.trim()); }} type="button">＋ Insert and save as my HPI phrase</button>}</section>}
    {libraryStatus && <p className="subjective-library-status">{libraryStatus}</p>}<ClinicalPhraseField data={data} field="reviewOfSystems" form={form} label="Review of systems" placeholder="Pertinent positives and negatives verified today" section="ros" update={update} /></div>;
}

function PatientCenteredSubjectiveWorkspace({
  data,
  form,
  update,
  onPatientAllergiesChange,
  subjectiveView,
  onSubjectiveViewChange,
}: FormProps & {
  subjectiveView: "visit" | "history" | "safety" | "ros";
  onSubjectiveViewChange: (view: "visit" | "history" | "safety" | "ros") => void;
}) {
  const document = parseSubjectiveDocument(form.subjectiveItemsJson);
  const items = document.items;
  const [complaintQuery, setComplaintQuery] = useState("");
  const [hpiQuery, setHpiQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState(items[0]?.id || "");
  const [localLibrary, setLocalLibrary] = useState(data.subjectiveLibraryItems || []);
  const [libraryStatus, setLibraryStatus] = useState("");
  const [templateDraft, setTemplateDraft] = useState<{ title: string; content: string } | null>(null);
  const [medicalDraft, setMedicalDraft] = useState({ condition: "", status: "active", notes: "" });
  const [familyDraft, setFamilyDraft] = useState({ relationship: "", condition: "", notes: "" });
  const [rosQuery, setRosQuery] = useState("");
  const [customRos, setCustomRos] = useState({ open: false, symptom: "", system: "constitutional" });
  const [localRosOptions, setLocalRosOptions] = useState<DataRow[]>([]);
  const masterOptions = (group: string) => (data.clinicalOptions || []).filter((row) => value(row, "optionGroup") === group);
  const patient = data.patients.find((row) => value(row, "id") === String(form.patientId || ""));
  const coverage = data.coverages.find((row) => value(row, "patientId") === String(form.patientId || "") && value(row, "priority") === "primary") || data.coverages.find((row) => value(row, "patientId") === String(form.patientId || ""));
  const patientName = patient ? `${value(patient, "firstName")} ${value(patient, "lastName")}`.trim() : String(form.patientName || "Patient");
  const subscriberName = coverage ? `${value(coverage, "subscriberFirstName")} ${value(coverage, "subscriberLastName")}`.trim() : "";
  const sourceName = document.source === "patient" ? patientName : document.source === "subscriber" ? (subscriberName || "Subscriber not saved") : document.sourceDetails;
  const rosOptions = [...masterOptions("ros_symptom"), ...localRosOptions];
  const rosSystems = ["constitutional", "eyes", "ent", "cardiovascular", "respiratory", "gastrointestinal", "genitourinary", "musculoskeletal", "skin", "neurologic", "psychiatric", "endocrine", "hematologic", "allergic_immunologic"];
  const complaintMatches = complaintQuery.trim().length >= 2 ? localLibrary.filter((row) => ["complaint", "template"].includes(value(row, "itemType")) && `${value(row, "title")} ${value(row, "keywords")}`.toLowerCase().includes(complaintQuery.trim().toLowerCase())).slice(0, 8) : [];
  const hpiCatalog = [...localLibrary.filter((row) => ["hpi", "template"].includes(value(row, "itemType"))), ...data.clinicalContentItems.filter((row) => value(row, "section") === "hpi").map((row) => ({ ...row, itemType: "hpi" }))];
  const hpiMatches = hpiQuery.trim().length >= 2 ? hpiCatalog.filter((row) => `${value(row, "title")} ${value(row, "content")} ${value(row, "keywords")}`.toLowerCase().includes(hpiQuery.trim().toLowerCase())).slice(0, 8) : [];
  const allHpi = items.map((item) => `${item.patientWords || ""} ${item.hpi || ""} ${subjectiveNarrative(item)}`).join(" ").toLowerCase();
  const ros = String(form.reviewOfSystems || "").toLowerCase();
  const conflictTerms = ["chest pain", "shortness of breath", "fever", "cough", "dizziness"].filter((term) => allHpi.includes(term) && new RegExp(`denies[^.]{0,80}${term.replace(/\s+/g, "\\s+")}`).test(ros));
  const completeness = [
    ["Reason", items.some((item) => item.complaint.trim())],
    ["Information source", Boolean(document.source)],
    ["HPI timeline", items.some((item) => item.hpi.trim() || item.onset || item.duration)],
    ["Severity or function", items.some((item) => item.severity || item.functionalImpact)],
    ["Associated symptoms", items.some((item) => item.associatedSymptoms || item.relevantNegatives)],
    ["Patient concern or goal", Boolean(document.patientConcern || document.patientGoal)],
  ] as const;

  function write(nextDocument: SubjectiveDocument) {
    update("subjectiveItemsJson", JSON.stringify(nextDocument));
    update("chiefComplaint", nextDocument.items.map((item) => item.complaint.trim()).filter(Boolean).join("; "));
    update("historyOfPresentIllness", nextDocument.items.map((item) => { const guided = subjectiveNarrative(item); return guided && item.hpi.includes(guided) ? item.hpi.trim() : [item.hpi.trim(), guided].filter(Boolean).join("\n"); }).filter(Boolean).join("\n\n"));
  }
  function syncVisitTime(minutes: string) {
    const cleaned = minutes.replace(/[^\d]/g, "");
    write({ ...document, visitTimeMinutes: cleaned });
    const assist = parseCodingAssistState(form.codingAssistJson) as CodingAssistState & { templateDiagnosisCodes?: string[]; templateProcedureCodes?: string[] };
    let templateDx: string[] = [];
    let templateCpt: string[] = [];
    try {
      const raw = JSON.parse(String(form.codingAssistJson || "{}")) as { templateDiagnosisCodes?: string[]; templateProcedureCodes?: string[] };
      templateDx = Array.isArray(raw.templateDiagnosisCodes) ? raw.templateDiagnosisCodes.map(String) : [];
      templateCpt = Array.isArray(raw.templateProcedureCodes) ? raw.templateProcedureCodes.map(String) : [];
    } catch { /* keep empty */ }
    const nextSuggestions = buildVisitCodingSuggestions({
      templateDiagnosisCodes: templateDx,
      templateProcedureCodes: templateCpt,
      templateCategory: assist.templateCategory,
      templateName: assist.templateName,
      visitTimeMinutes: cleaned,
      counselingKeys: assist.counselingKeys,
      qualityKeys: assist.qualityKeys,
      telehealth: /telehealth/i.test(`${assist.templateName} ${assist.templateCategory}`),
      acceptedDiagnosisCodes: String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean),
      acceptedProcedureCodes: String(form.procedureCodes || "").split(",").map((code) => code.trim()).filter(Boolean),
    });
    const keep = new Set((assist.selectedIds || []).filter((id) => !id.startsWith("time:") && !id.startsWith("problem-em:")));
    for (const row of nextSuggestions) {
      if ((row.id.startsWith("time:") || row.id.startsWith("problem-em:")) && row.selected) keep.add(row.id);
    }
    update("codingAssistJson", JSON.stringify({
      ...assist,
      visitTimeMinutes: cleaned,
      selectedIds: Array.from(keep),
      templateDiagnosisCodes: templateDx,
      templateProcedureCodes: templateCpt,
    }));
  }
  function sync(next: SubjectiveItem[]) { write({ ...document, items: next }); }
  function patchContext(key: keyof SubjectiveDocument, nextValue: string) { write({ ...document, [key]: nextValue }); }
  function addComplaint(complaint: string, hpi = "") {
    if (!complaint.trim()) return;
    const next: SubjectiveItem = { id: crypto.randomUUID(), complaint: complaint.trim(), hpi };
    sync([...items, next]); setActiveItemId(next.id); setComplaintQuery("");
  }
  function patchItem(id: string, changes: Partial<SubjectiveItem>) { sync(items.map((item) => item.id === id ? { ...item, ...changes } : item)); }
  function moveItem(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; sync(next); }
  function addHpi(content: string) { const id = activeItemId || items[0]?.id; const current = items.find((item) => item.id === id); if (!current) return; patchItem(id, { hpi: current.hpi.includes(content) ? current.hpi : [current.hpi, content].filter(Boolean).join("\n") }); setHpiQuery(""); }
  function prepareTemplate(item: SubjectiveItem) {
    setTemplateDraft({
      title: `${item.complaint || "Complaint"} – reusable HPI`,
      content: "Patient reports [chief concern in their own words]. Onset: [onset]. Location: [location]. Duration/frequency: [duration and frequency]. Character/severity: [quality and severity]. Aggravating/relieving factors: [factors]. Associated symptoms and relevant negatives: [symptoms]. Functional impact: [work, sleep, mobility or ADLs]. Prior treatment and response: [treatment/response].",
    });
  }
  function addMedicalHistory() { if (!medicalDraft.condition.trim()) return; write({ ...document, medicalHistory: [...(document.medicalHistory || []), { id: crypto.randomUUID(), ...medicalDraft }] }); setMedicalDraft({ condition: "", status: "active", notes: "" }); }
  function addFamilyHistory() { if (!familyDraft.relationship.trim() || !familyDraft.condition.trim()) return; write({ ...document, familyHistory: [...(document.familyHistory || []), { id: crypto.randomUUID(), ...familyDraft }] }); setFamilyDraft({ relationship: "", condition: "", notes: "" }); }
  function setRos(symptom: DataRow, status: "positive" | "negative") {
    const current = document.rosSelections || [];
    const symptomCode = value(symptom, "code");
    const system = value(symptom, "parentCode") || "other";
    const nextSelections = [...current.filter((item) => item.id !== symptomCode), { id: symptomCode, system, symptom: value(symptom, "label"), status }];
    const nextNormals = (document.rosNormalSystems || []).filter((item) => item !== system);
    const nextDocument = { ...document, rosSelections: nextSelections, rosNormalSystems: nextNormals };
    write(nextDocument);
    update("reviewOfSystems", buildReviewOfSystemsText(nextDocument));
  }
  function updateRosNote(id: string, note: string) {
    const nextSelections = (document.rosSelections || []).map((item) => item.id === id ? { ...item, note } : item);
    const nextDocument = { ...document, rosSelections: nextSelections };
    write(nextDocument);
    update("reviewOfSystems", buildReviewOfSystemsText(nextDocument));
  }
  function markSystemNormal(system: string) {
    const normal = document.rosNormalSystems || [];
    const nextNormals = normal.includes(system) ? normal.filter((item) => item !== system) : [...normal, system];
    const nextSelections = (document.rosSelections || []).filter((item) => item.system !== system);
    const nextDocument = { ...document, rosNormalSystems: nextNormals, rosSelections: nextSelections };
    write(nextDocument);
    update("reviewOfSystems", buildReviewOfSystemsText(nextDocument));
  }
  async function addCustomRos() { if (!customRos.symptom.trim()) return; const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveClinicalOption", optionGroup: "ros_symptom", label: customRos.symptom, parentCode: customRos.system }) }); const body = await response.json() as { item?: DataRow; error?: string }; if (!response.ok || !body.item) { setLibraryStatus(body.error || "Unable to add ROS symptom."); return; } setLocalRosOptions((current) => [...current, body.item!]); setRos(body.item, "positive"); setCustomRos({ open: false, symptom: "", system: customRos.system }); }
  async function saveLibrary(itemType: "hpi" | "template", title: string, content: string) {
    if (!title.trim() || !content.trim()) return;
    setLibraryStatus("Saving to your personal draft library…");
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveSubjectiveLibraryItem", itemType, title, content, associatedComplaints: items.map((item) => item.complaint) }) });
      const body = await response.json() as { item?: DataRow; error?: string; existing?: boolean };
      if (!response.ok || !body.item) throw new Error(body.error || "Unable to save library item.");
      setLocalLibrary((current) => current.some((row) => value(row, "id") === value(body.item!, "id")) ? current : [...current, body.item!]);
      setLibraryStatus(body.existing ? "This draft already exists." : "Saved as your personal draft. An administrator must approve practice-wide publication.");
      setTemplateDraft(null);
    } catch (reason) { setLibraryStatus(reason instanceof Error ? reason.message : "Unable to save library item."); }
  }

  return <div className={`subjective-workspace patient-centered-subjective subjective-view-${subjectiveView}`}>
    <div className="subjective-visit-toolbar">
      <nav aria-label="Subjective documentation sections" className="subjective-workflow-nav">
        <button aria-pressed={subjectiveView === "visit"} className={subjectiveView === "visit" ? "active" : ""} onClick={() => onSubjectiveViewChange("visit")} type="button"><b>1</b><span><strong>Visit & HPI</strong><small>Reason, narrative and goals</small></span></button>
        <button aria-pressed={subjectiveView === "history"} className={subjectiveView === "history" ? "active" : ""} onClick={() => onSubjectiveViewChange("history")} type="button"><b>2</b><span><strong>History</strong><small>Patient and family conditions</small></span></button>
        <button aria-pressed={subjectiveView === "safety"} className={subjectiveView === "safety" ? "active" : ""} onClick={() => onSubjectiveViewChange("safety")} type="button"><b>3</b><span><strong>Safety review</strong><small>Allergies and medications</small></span></button>
        <button aria-pressed={subjectiveView === "ros"} className={subjectiveView === "ros" ? "active" : ""} onClick={() => onSubjectiveViewChange("ros")} type="button"><b>4</b><span><strong>Review of systems</strong><small>Normal or specific findings</small></span></button>
      </nav>
      <section className="visit-time-attestation" id="visit-time-spent">
        <strong>Time</strong>
        <label>
          <span className="sr-only">Minutes</span>
          <input aria-label="Visit time spent in minutes" inputMode="numeric" min={0} onChange={(event) => syncVisitTime(event.target.value)} placeholder="min" type="number" value={document.visitTimeMinutes || parseCodingAssistState(form.codingAssistJson).visitTimeMinutes || ""} />
        </label>
      </section>
    </div>
    <VisitNoteTemplateLibrary form={form} update={update} />
    <section className="subjective-source-strip compact">
      <label>Information source<select aria-label="Subjective information source" onChange={(event) => { const source = event.target.value; write({ ...document, source, sourceDetails: ["patient", "subscriber"].includes(source) ? "" : document.sourceDetails }); }} value={document.source}>{masterOptions("information_source").map((row) => <option key={value(row, "code")} value={value(row, "value")}>{value(row, "label")}</option>)}</select></label>
      <label>Person/source name<input onChange={(event) => patchContext("sourceDetails", event.target.value)} placeholder="Name and relationship" readOnly={["patient", "subscriber"].includes(document.source)} value={sourceName} /></label>
      <label>Interpreter<select onChange={(event) => patchContext("interpreter", event.target.value)} value={document.interpreter}><option value="no">No</option><option value="yes">Yes</option><option value="declined">Declined</option></select></label>
    </section>
    <div className="subjective-top-grid"><div><div className="subjective-label-row"><label>Chief complaints <b>*</b></label><small>{items.length} added</small></div><div className="subjective-combobox"><input aria-label="Search chief complaints" autoComplete="off" onChange={(event) => setComplaintQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && complaintQuery.trim()) { event.preventDefault(); addComplaint(complaintQuery); } }} placeholder="Search or type a new complaint" value={complaintQuery} />{complaintMatches.length > 0 && <div>{complaintMatches.map((row) => <button key={value(row, "id")} onClick={() => addComplaint(value(row, "title"), value(row, "content"))} type="button"><span><strong>{value(row, "title")}</strong><small>{value(row, "content")}</small></span><em aria-hidden="true">＋</em></button>)}</div>}</div>{complaintQuery.trim().length >= 2 && !complaintMatches.length && <button aria-label={`Add ${complaintQuery.trim()} to this visit`} className="subjective-create-button icon-only" onClick={() => addComplaint(complaintQuery)} title={`Add ${complaintQuery.trim()} to this visit`} type="button">＋</button>}</div><ReferringProviderPicker data={data} form={form} update={update} /></div>
    <div className="subjective-card-list">{items.length ? items.map((item, index) => <article className={activeItemId === item.id ? "active" : ""} key={item.id} onClick={() => setActiveItemId(item.id)}><div className="subjective-card-head"><span>{index + 1}</span><input aria-label={`Complaint ${index + 1}`} onChange={(event) => patchItem(item.id, { complaint: event.target.value })} value={item.complaint} /><div><button aria-label="Move complaint up" disabled={index === 0} onClick={() => moveItem(index, -1)} type="button">↑</button><button aria-label="Move complaint down" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} type="button">↓</button><button aria-label="Remove complaint" onClick={() => sync(items.filter((row) => row.id !== item.id))} type="button">×</button></div></div><label className="patient-voice-field">Patient’s words<input onChange={(event) => patchItem(item.id, { patientWords: event.target.value })} placeholder="Optional direct quote, exactly as reported" value={item.patientWords || ""} /><small>Use quotation marks only when this is the patient’s actual wording.</small></label><HpiNarrativeField complaint={item.complaint} onChange={(next) => patchItem(item.id, { hpi: next })} value={item.hpi} /><details className="guided-hpi"><summary>Guided HPI & progress <span>{[item.onset, item.duration, item.severity, item.functionalImpact].filter(Boolean).length ? "Details added" : "Optional"}</span></summary><div>{[["Onset", "onset", "When did it begin?"], ["Location", "location", "Where?"], ["Duration", "duration", "How long?"], ["Character", "character", "Quality/description"], ["Severity", "severity", "Patient-reported intensity"], ["Frequency", "frequency", "Constant/intermittent/pattern"], ["Aggravating factors", "aggravating", "What makes it worse?"], ["Relieving factors", "relieving", "What helps?"], ["Associated symptoms", "associatedSymptoms", "Additional reported symptoms"], ["Relevant negatives", "relevantNegatives", "Pertinent symptoms denied"], ["Prior treatment/response", "priorTreatment", "What was tried and response?"], ["Change since last visit", "progress", "Better, unchanged or worse"], ["Functional impact", "functionalImpact", "Work, sleep, mobility, ADLs…"]].map(([label, key, placeholder]) => <label key={key}>{label}<input onChange={(event) => patchItem(item.id, { [key]: event.target.value })} placeholder={placeholder} value={String(item[key as keyof SubjectiveItem] || "")} /></label>)}</div><button onClick={() => { const generated = subjectiveNarrative(item); if (generated) patchItem(item.id, { hpi: [item.hpi.trim(), generated].filter(Boolean).join("\n") }); }} type="button">Build reviewable narrative from entered details</button></details><div className="subjective-card-footer"><small>Templates use placeholders and require explicit review.</small><button onClick={() => prepareTemplate(item)} type="button">Create reusable template</button></div></article>) : <div className="subjective-empty"><strong>Start with the patient’s reason for visit</strong><span>Search an existing complaint or type a new one. Add as many as needed.</span></div>}</div>
    {items.length > 0 && <section className="hpi-library-search"><div><strong>Add HPI wording to selected complaint</strong><small>{items.find((item) => item.id === activeItemId)?.complaint || items[0].complaint}</small></div><div className="subjective-combobox"><input aria-label="Search HPI library" onChange={(event) => setHpiQuery(event.target.value)} placeholder="Search HPI phrases" value={hpiQuery} />{hpiMatches.length > 0 && <div>{hpiMatches.map((row) => <button key={value(row, "id")} onClick={() => addHpi(value(row, "content"))} type="button"><span><strong>{value(row, "title")}</strong><small>{value(row, "content")}</small></span><em>Insert</em></button>)}</div>}</div>{hpiQuery.trim().length >= 2 && !hpiMatches.length && <button className="subjective-create-button" onClick={() => { addHpi(hpiQuery.trim()); void saveLibrary("hpi", hpiQuery.trim().slice(0, 70), hpiQuery.trim()); }} type="button">＋ Insert and save as my HPI phrase</button>}</section>}
    <details className="patient-perspective-details"><summary><span><strong>Patient goals & preferences</strong><small>Main concern, desired outcome and treatment preferences</small></span><em>{[document.patientConcern, document.patientGoal, document.treatmentPreference].filter(Boolean).length ? "Details added" : "Optional"}</em></summary><section className="patient-perspective-grid"><label>Patient’s main concern<textarea onChange={(event) => patchContext("patientConcern", event.target.value)} placeholder="What worries the patient most?" rows={2} value={document.patientConcern} /></label><label>Patient’s goal for today<textarea onChange={(event) => patchContext("patientGoal", event.target.value)} placeholder="What outcome is the patient seeking?" rows={2} value={document.patientGoal} /></label><label>Treatment preference<textarea onChange={(event) => patchContext("treatmentPreference", event.target.value)} placeholder="Preferences, priorities or constraints" rows={2} value={document.treatmentPreference} /></label></section></details>
    <section className="history-master-grid" id="subjective-history"><div><header><strong>Patient medical history</strong><small>Search the backend condition master</small></header><div className="history-entry-row"><input list="condition-master-options" onChange={(event) => setMedicalDraft((current) => ({ ...current, condition: event.target.value }))} placeholder="Search condition" value={medicalDraft.condition} /><select onChange={(event) => setMedicalDraft((current) => ({ ...current, status: event.target.value }))} value={medicalDraft.status}><option value="active">Active</option><option value="resolved">Resolved</option><option value="history">History</option></select><button aria-label="Add patient medical history" className="subjective-icon-add" onClick={addMedicalHistory} title="Add patient medical history" type="button">＋</button></div><div className="history-chip-list">{(document.medicalHistory || []).map((row) => <span key={row.id}><b>{row.condition}</b><small>{row.status}</small><button onClick={() => write({ ...document, medicalHistory: (document.medicalHistory || []).filter((item) => item.id !== row.id) })} type="button">×</button></span>)}</div></div><div><header><strong>Family history</strong><small>Relationship-based, not limited to parents</small></header><div className="history-entry-row family"><input list="family-relationship-options" onChange={(event) => setFamilyDraft((current) => ({ ...current, relationship: event.target.value }))} placeholder="Relationship" value={familyDraft.relationship} /><input list="condition-master-options" onChange={(event) => setFamilyDraft((current) => ({ ...current, condition: event.target.value }))} placeholder="Condition" value={familyDraft.condition} /><button aria-label="Add family history" className="subjective-icon-add" onClick={addFamilyHistory} title="Add family history" type="button">＋</button></div><div className="history-chip-list">{(document.familyHistory || []).map((row) => <span key={row.id}><b>{row.relationship}: {row.condition}</b><button onClick={() => write({ ...document, familyHistory: (document.familyHistory || []).filter((item) => item.id !== row.id) })} type="button">×</button></span>)}</div></div><datalist id="condition-master-options">{masterOptions("condition").map((row) => <option key={value(row, "code")} value={value(row, "label")} />)}</datalist><datalist id="family-relationship-options">{masterOptions("family_relationship").map((row) => <option key={value(row, "code")} value={value(row, "label")} />)}</datalist></section>
    <section className="structured-ros" id="subjective-ros"><header><span><strong>Review of systems</strong><small>Mark each reviewed system normal, or record specific positive/negative findings with notes.</small></span><div className="ros-search-add"><input onChange={(event) => setRosQuery(event.target.value)} placeholder="Search ROS symptoms" value={rosQuery} /><button aria-label="Add ROS symptom" onClick={() => setCustomRos((current) => ({ ...current, open: !current.open }))} type="button">＋</button></div></header>{customRos.open && <div className="custom-ros-entry"><select onChange={(event) => setCustomRos((current) => ({ ...current, system: event.target.value }))} value={customRos.system}>{rosSystems.map((system) => <option key={system} value={system}>{system.replaceAll("_", " ")}</option>)}</select><input onChange={(event) => setCustomRos((current) => ({ ...current, symptom: event.target.value }))} placeholder="New symptom name" value={customRos.symptom} /><button onClick={() => void addCustomRos()} type="button">Add as positive</button></div>}<div className="ros-normal-systems">{rosSystems.map((system) => <button className={(document.rosNormalSystems || []).includes(system) ? "active" : ""} key={system} onClick={() => markSystemNormal(system)} type="button">{(document.rosNormalSystems || []).includes(system) ? "✓ " : ""}{system.replaceAll("_", " ")} normal</button>)}</div><div className="ros-option-results">{rosOptions.filter((row) => !rosQuery.trim() || `${value(row, "label")} ${value(row, "parentCode")} ${value(row, "keywords")}`.toLowerCase().includes(rosQuery.toLowerCase())).slice(0, 20).map((row) => { const selected = (document.rosSelections || []).find((item) => item.id === value(row, "code")); return <article className={selected ? "selected" : ""} key={value(row, "code")}><span><strong>{value(row, "label")}</strong><small>{value(row, "parentCode")}</small></span><button className={selected?.status === "positive" ? "active positive" : ""} onClick={() => setRos(row, "positive")} type="button">＋ Positive</button><button className={selected?.status === "negative" ? "active negative" : ""} onClick={() => setRos(row, "negative")} type="button">− Negative</button>{selected && <input className="ros-finding-note" onChange={(event) => updateRosNote(selected.id, event.target.value)} placeholder="Comment / clinical context" value={selected.note || ""} />}</article>; })}</div></section>
    {conflictTerms.length > 0 && <div className="subjective-consistency-warning"><strong>Review possible inconsistency</strong><span>HPI mentions {conflictTerms.join(", ")}, while ROS may document a denial. Confirm the patient’s report before signing.</span></div>}
    <section className="subjective-completeness"><div><strong>Subjective completeness</strong><small>Helpful review only—this does not determine an E/M level.</small></div><div>{completeness.map(([label, complete]) => <span className={complete ? "done" : "missing"} key={label}>{complete ? "✓" : "○"} {label}</span>)}</div></section>
    {templateDraft && <section className="safe-template-review"><header><span><strong>Review reusable template</strong><small>Raw chart narrative was not copied. Remove any patient-specific information before saving.</small></span><button onClick={() => setTemplateDraft(null)} type="button">×</button></header><label>Template title<input onChange={(event) => setTemplateDraft((current) => current ? { ...current, title: event.target.value } : current)} value={templateDraft.title} /></label><label>Placeholder-based content<textarea onChange={(event) => setTemplateDraft((current) => current ? { ...current, content: event.target.value } : current)} rows={5} value={templateDraft.content} /></label><button onClick={() => void saveLibrary("template", templateDraft.title, templateDraft.content)} type="button">Save personal draft</button></section>}
    {items.find((item) => item.id === activeItemId) && <ExtendedHpiFields item={items.find((item) => item.id === activeItemId)!} patch={(changes) => patchItem(activeItemId, changes)} />}
    <div id="subjective-history-details"><RelevantHistoryDetails data={data} document={document} write={write} /></div>
    <div id="subjective-safety"><PatientSafetyReview data={data} form={form} onPatientAllergiesChange={onPatientAllergiesChange} update={update} /></div>
    {libraryStatus && <p className="subjective-library-status">{libraryStatus}</p>}
  </div>;
}

function ClinicianObservationField({ form, update }: SimpleFormProps) {
  const document = parseSubjectiveDocument(form.subjectiveItemsJson);
  return (
    <div className="clinician-observation-field">
      <DictateMicField
        label="Clinician observations (measurable)"
        onChange={(next) => update("subjectiveItemsJson", JSON.stringify({ ...document, clinicianObservation: next }))}
        placeholder="Numbers and observed facts only — ROM degrees, wound size, gait, MSE/PHQ-9 score, strength 0–5. No quotes (those go in Subjective)."
        polish={polishObjectiveLocally}
        rows={3}
        value={document.clinicianObservation || ""}
      />
      <small>Fact only. Interpretations and diagnoses belong in Assessment — not here.</small>
    </div>
  );
}

function ObjectiveWorkspace({ data, form, update, onRefresh }: FormProps & { onRefresh?: () => Promise<void> }) {
  const document = parseSubjectiveDocument(form.subjectiveItemsJson);
  const [findingDraft, setFindingDraft] = useState({ system: "heent", finding: "", detail: "", status: "abnormal" as "normal" | "abnormal" });
  const [activeExamSystem, setActiveExamSystem] = useState<string>("heent");
  const patientId = String(form.patientId || "");
  const dateOfService = String(form.dateOfService || "");
  const verified = isObjectiveVerifiedForDos(document.objectiveVerifiedDos, dateOfService);
  const results = (data.clinicalOrderResults || [])
    .filter((row) => value(row, "patientId") === patientId)
    .sort((a, b) => value(b, "resultedAt").localeCompare(value(a, "resultedAt")))
    .slice(0, 8);
  const includedResultIds = new Set(document.includedResultIds || []);
  const bmi = computeBmiFromMetric(form.height as string, form.weight as string);
  const findingsBySystem = new Map((document.examFindings || []).reduce((map, item) => {
    const list = map.get(item.system) || [];
    list.push(item);
    map.set(item.system, list);
    return map;
  }, new Map<string, NonNullable<SubjectiveDocument["examFindings"]>>()));
  const phraseOptions = OBJECTIVE_PHRASE_BANK[activeExamSystem] || [];
  const subjectiveFlags = findSubjectiveObjectiveIssues(
    [String(form.physicalExam || ""), document.clinicianObservation || "", document.diagnosticNotes || "", document.generalAppearance || ""].join("\n"),
  );

  function writeObjective(next: SubjectiveDocument) {
    update("subjectiveItemsJson", JSON.stringify(next));
    update("physicalExam", buildPhysicalExamText(next));
  }

  function toggleSystemNormal(system: string) {
    const normals = document.examNormalSystems || [];
    const nextNormals = normals.includes(system) ? normals.filter((item) => item !== system) : [...normals, system];
    const nextFindings = (document.examFindings || []).filter((item) => item.system !== system);
    writeObjective({ ...document, examNormalSystems: nextNormals, examFindings: nextFindings });
  }

  function addFinding(override?: Partial<typeof findingDraft>) {
    const draft = { ...findingDraft, system: activeExamSystem, ...override };
    const finding = draft.finding.trim();
    if (!finding) return;
    const system = draft.system;
    const nextFindings = [
      ...(document.examFindings || []).filter((item) => !(item.system === system && item.finding.toLowerCase() === finding.toLowerCase())),
      { id: crypto.randomUUID(), system, finding, status: draft.status, detail: draft.detail.trim() },
    ];
    const nextNormals = (document.examNormalSystems || []).filter((item) => item !== system);
    writeObjective({ ...document, examFindings: nextFindings, examNormalSystems: nextNormals });
    setFindingDraft({ system, finding: "", detail: "", status: "abnormal" });
    setActiveExamSystem(system);
  }

  function openSystemEntry(system: string) {
    setActiveExamSystem(system);
    setFindingDraft((current) => ({ ...current, system, finding: "", detail: "" }));
  }

  function removeFinding(id: string) {
    writeObjective({ ...document, examFindings: (document.examFindings || []).filter((item) => item.id !== id) });
  }

  function clearExamFindings() {
    writeObjective({ ...document, examFindings: [], examNormalSystems: [] });
  }

  function toggleResult(resultId: string, summary: string) {
    const current = new Set(document.includedResultIds || []);
    const notes = String(document.diagnosticNotes || "");
    if (current.has(resultId)) {
      current.delete(resultId);
      writeObjective({
        ...document,
        includedResultIds: [...current],
        diagnosticNotes: notes
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line && !line.includes(summary.slice(0, 40)))
          .join("\n"),
      });
      return;
    }
    current.add(resultId);
    writeObjective({
      ...document,
      includedResultIds: [...current],
      diagnosticNotes: [notes.trim(), summary.trim()].filter(Boolean).join("\n"),
    });
  }

  function appendDiagnostic(snippet: string) {
    const notes = String(document.diagnosticNotes || "").trim();
    if (notes.includes(snippet)) return;
    writeObjective({ ...document, diagnosticNotes: notes ? `${notes}\n${snippet}` : snippet });
  }

  function attestTodaysFindings() {
    writeObjective({ ...document, objectiveVerifiedDos: dateOfService });
  }

  const vitalFields: Array<[string, string, string]> = [
    ["Height", "height", "cm"],
    ["Weight", "weight", "lb"],
    ["Temp", "temperature", "°F"],
    ["Pulse", "pulse", "bpm"],
    ["Resp", "respirations", "/min"],
    ["BP sys", "systolic", "mmHg"],
    ["BP dia", "diastolic", "mmHg"],
    ["O₂", "oxygenSaturation", "%"],
    ["Pain", "painScore", "/10"],
  ];

  return (
    <div className="objective-workspace">
      <section className="objective-vitals-block">
        <header><strong>Vital signs</strong><small>Exact measurements for this encounter</small></header>
        <div className="soap-vitals-summary objective-vitals-grid">
          {vitalFields.map(([label, key, unit]) => (
            <label key={key}>
              <span>{label}</span>
              <input aria-label={label} onChange={(event) => update(key, event.target.value)} value={String(form[key] || "")} />
              <small>{unit}</small>
            </label>
          ))}
          <label className="objective-bmi-chip" title="Calculated from height and weight">
            <span>BMI</span>
            <strong aria-live="polite">{bmi ?? "—"}</strong>
            <small>calc</small>
          </label>
          <label>
            <span>Glucose</span>
            <input
              aria-label="Clinic glucose"
              onChange={(event) => writeObjective({ ...document, clinicGlucose: event.target.value })}
              placeholder="mg/dL"
              value={document.clinicGlucose || ""}
            />
            <small>mg/dL</small>
          </label>
        </div>
      </section>

      <section className="objective-exam-block">
        <header>
          <strong>Physical exam</strong>
          <small>Head-to-toe</small>
          {((document.examFindings || []).length > 0 || (document.examNormalSystems || []).length > 0) && (
            <button className="objective-exam-clear" onClick={clearExamFindings} type="button">Clear exam</button>
          )}
        </header>
        <DictateMicField
          className="objective-appearance-field"
          label="General appearance"
          onChange={(next) => writeObjective({ ...document, generalAppearance: next })}
          placeholder="Observable only — e.g. Alert and oriented ×3. Sitting comfortably."
          polish={polishObjectiveLocally}
          rows={2}
          value={document.generalAppearance || ""}
        />
        <div className="objective-exam-systems" aria-label="Head-to-toe physical exam">
          {EXAM_SYSTEMS.map((system, index) => {
            const isNormal = (document.examNormalSystems || []).includes(system);
            const systemFindings = findingsBySystem.get(system) || [];
            const isActive = activeExamSystem === system;
            const hasAbnormal = systemFindings.some((item) => item.status === "abnormal");
            return (
              <article
                className={`objective-exam-system ${isNormal ? "is-normal" : ""} ${hasAbnormal ? "is-abnormal" : ""} ${isActive ? "is-active" : ""}`}
                key={system}
              >
                <header>
                  <strong><span>{index + 1}.</span> {examSystemLabel(system)}</strong>
                  <div>
                    <button
                      aria-pressed={isNormal}
                      className={isNormal ? "active" : ""}
                      onClick={() => toggleSystemNormal(system)}
                      type="button"
                    >
                      {isNormal ? "✓ Normal" : "Mark normal"}
                    </button>
                    <button
                      className={isActive ? "active" : ""}
                      onClick={() => openSystemEntry(system)}
                      type="button"
                    >
                      {isActive ? "Adding…" : "+ Finding"}
                    </button>
                  </div>
                </header>
                {systemFindings.length > 0 && (
                  <ul>
                    {systemFindings.map((item) => (
                      <li key={item.id}>
                        <span><em>{item.status}</em> · {item.finding}{item.detail ? ` — ${item.detail}` : ""}</span>
                        <button aria-label={`Remove ${item.finding}`} onClick={() => removeFinding(item.id)} type="button">×</button>
                      </li>
                    ))}
                  </ul>
                )}
                {isActive && (
                  <div className="objective-exam-system-entry">
                    <input
                      aria-label={`${examSystemLabel(system)} finding`}
                      list={`objective-exam-phrases-${system}`}
                      onChange={(event) => setFindingDraft((current) => ({ ...current, system, finding: event.target.value }))}
                      placeholder="Finding (measurable)"
                      value={findingDraft.system === system ? findingDraft.finding : ""}
                    />
                    <select
                      aria-label="Finding status"
                      onChange={(event) => setFindingDraft((current) => ({ ...current, system, status: event.target.value as "normal" | "abnormal" }))}
                      value={findingDraft.system === system ? findingDraft.status : "abnormal"}
                    >
                      <option value="abnormal">Abnormal</option>
                      <option value="normal">Normal finding</option>
                    </select>
                    <input
                      aria-label="Finding detail"
                      onChange={(event) => setFindingDraft((current) => ({ ...current, system, detail: event.target.value }))}
                      placeholder="Measurement / detail"
                      value={findingDraft.system === system ? findingDraft.detail : ""}
                    />
                    <button className="primary" onClick={() => addFinding({ system })} type="button">Add</button>
                    {phraseOptions.length > 0 && (
                      <div className="objective-phrase-chips">
                        {phraseOptions.map((phrase) => (
                          <button
                            key={phrase}
                            onClick={() => addFinding({ system, finding: phrase, status: /no |clear|full|steady|equal|soft|regular/i.test(phrase) ? "normal" : "abnormal" })}
                            type="button"
                          >
                            {phrase}
                          </button>
                        ))}
                      </div>
                    )}
                    <datalist id={`objective-exam-phrases-${system}`}>
                      {(OBJECTIVE_PHRASE_BANK[system] || []).map((item) => <option key={item} value={item} />)}
                    </datalist>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="objective-diagnostics-block">
        <header><strong>Diagnostic & lab data</strong><small>Same-day reports · chart results · typed values</small></header>
        <ObjectiveVisitDocuments
          dateOfService={dateOfService}
          documents={data.patientDocuments || []}
          onRefresh={onRefresh}
          onUseInterpretation={(text) => {
            const notes = String(document.diagnosticNotes || "").trim();
            if (!text.trim()) return;
            if (notes.includes(text.trim())) return;
            writeObjective({ ...document, diagnosticNotes: notes ? `${notes}\n${text.trim()}` : text.trim() });
          }}
          patientId={patientId}
        />
        <div className="objective-pending-chips">
          {["CBC pending.", "BMP pending.", "TSH pending.", "Rapid flu test: pending.", "ECG pending."].map((snippet) => (
            <button key={snippet} onClick={() => appendDiagnostic(snippet)} type="button">{snippet.replace(/\.$/, "")}</button>
          ))}
        </div>
        <div className="objective-result-list">
          {results.length ? results.map((row) => {
            const id = value(row, "id");
            const summary = `${value(row, "summary") || "Result"}${value(row, "abnormalFlag") ? ` · ${value(row, "abnormalFlag")}` : ""}${value(row, "resultedAt") ? ` · ${shortDate(value(row, "resultedAt"), true)}` : ""}`;
            return (
              <button
                className={includedResultIds.has(id) ? "active" : ""}
                key={id}
                onClick={() => toggleResult(id, summary)}
                type="button"
              >
                <strong>{value(row, "summary") || "Clinical result"}</strong>
                <small>{[value(row, "resultStatus"), value(row, "abnormalFlag"), shortDate(value(row, "resultedAt"), true)].filter(Boolean).join(" · ")}</small>
              </button>
            );
          }) : <p className="objective-empty">No resulted orders on chart yet. Use same-day documents above or type values below.</p>}
        </div>
        <DictateMicField
          label="Diagnostic notes for today’s DOS (read & write)"
          onChange={(next) => writeObjective({ ...document, diagnosticNotes: next })}
          placeholder="Read the report (or AI draft), then write measurable values — e.g. Fasting sugar 148 mg/dL. TSH 1.9 (normal). Or use Mic to dictate."
          polish={polishObjectiveLocally}
          rows={3}
          value={document.diagnosticNotes || ""}
        />
      </section>

      <ClinicianObservationField form={form} update={update} />

      {subjectiveFlags.length > 0 && (
        <aside className="objective-subjective-warn" aria-live="polite">
          <strong>Looks like opinion wording</strong>
          <ul>{subjectiveFlags.map((row) => <li key={row.tip}>{row.tip}</li>)}</ul>
        </aside>
      )}

      <section className="objective-narrative-block">
        <ClinicalPhraseField
          data={data}
          field="physicalExam"
          form={form}
          label="Assembled exam narrative"
          objectivePolish
          placeholder="Built from systems and findings above — edit or dictate only verified today’s findings"
          required
          section="exam"
          update={update}
        />
        <div className={`objective-attest ${verified ? "verified" : ""}`}>
          <div>
            <strong>{verified ? "Verified for today’s DOS" : "Confirm findings are for this date of service"}</strong>
            <small>{dateOfService ? `DOS ${dateOfService}` : "Set date of service first"}. Avoid carrying stale objective text from prior visits.</small>
          </div>
          <button className={verified ? "is-complete" : "primary"} disabled={!dateOfService || verified} onClick={attestTodaysFindings} type="button">
            {verified ? "Verified ✓" : "Verify for today’s DOS"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EncounterNotePreview({ data, form }: Omit<FormProps, "update">) {
  const subjective = parseSubjectiveDocument(form.subjectiveItemsJson);
  const referringProvider = data.referringProviders.find((row) => value(row, "id") === String(form.referringProviderId || ""));
  const activeAllergies = (data.patientAllergies || []).filter((row) => value(row, "patientId") === String(form.patientId || "") && value(row, "status") === "active");
  const activeMedications = (data.patientMedications || []).filter((row) => value(row, "patientId") === String(form.patientId || "") && value(row, "status") === "active");
  const visitTimeMinutes = String(subjective.visitTimeMinutes || parseCodingAssistState(form.codingAssistJson).visitTimeMinutes || "");
  const noteInput = {
    patientName: String(form.patientName || "Patient"),
    providerName: String(form.providerName || "the treating provider"),
    dateOfService: String(form.dateOfService || ""),
    checkedInAt: String(form.checkedInAt || ""),
    billingContext: String(form.billingContext || ""),
    chiefComplaint: String(form.chiefComplaint || ""),
    historyOfPresentIllness: String(form.historyOfPresentIllness || ""),
    reviewOfSystems: String(form.reviewOfSystems || ""),
    physicalExam: String(form.physicalExam || ""),
    assessment: String(form.assessment || ""),
    treatmentPlan: String(form.treatmentPlan || ""),
    followUpInstructions: String(form.followUpInstructions || ""),
    clinicalNote: String(form.clinicalNote || ""),
    diagnosisCodes: String(form.diagnosisCodes || ""),
    procedureCodes: String(form.procedureCodes || ""),
    allergiesReviewed: Boolean(form.allergiesReviewed),
    medicationsReviewed: Boolean(form.medicationsReviewed),
    height: String(form.height || ""),
    weight: String(form.weight || ""),
    temperature: String(form.temperature || ""),
    pulse: String(form.pulse || ""),
    respirations: String(form.respirations || ""),
    systolic: String(form.systolic || ""),
    diastolic: String(form.diastolic || ""),
    oxygenSaturation: String(form.oxygenSaturation || ""),
    painScore: String(form.painScore ?? ""),
    referringProviderLabel: referringProvider ? referringProviderLabel(referringProvider) : "",
    visitTimeMinutes,
    subjective,
    allergies: activeAllergies,
    medications: activeMedications,
  };
  const noteText = buildEncounterNoteDraft(noteInput);
  const unresolved = Array.from(new Set(noteText.match(/\[[^\]]+\]/g) || []));
  const missing = encounterNoteGaps(noteInput);
  return <section className="encounter-note-preview">
    <header><div><span className="eyebrow">Live structured draft</span><h3>Encounter note preview</h3><p>Automatically assembled from recorded workflow data. Edit the source section—not this preview.</p></div><div className="note-provenance"><span>Check-in</span><span>Vitals</span><span>Provider documentation</span></div></header>
    {(unresolved.length > 0 || missing.length > 0 || !form.checkedInAt) && <div className="encounter-note-alert"><strong>Review before signing</strong><span>{!form.checkedInAt ? "Check-in time is missing. " : ""}{missing.length ? `Still needed: ${missing.join(", ")}. ` : ""}{unresolved.length ? `${unresolved.length} unresolved template prompt${unresolved.length === 1 ? "" : "s"}.` : ""}</span></div>}
    <textarea aria-label="Automatically generated encounter note preview" readOnly rows={18} value={noteText} />
    <footer>This preview does not invent findings or determine coding. The provider remains responsible for review, correction and signature.</footer>
  </section>;
}

function scrollVisitTarget(targetId: string, options?: { onlyIfNeeded?: boolean }) {
  const element = document.getElementById(targetId);
  if (!element) return;
  const scroller = (element.closest(".visit-workspace-scroll") || element.closest(".clinical-encounter-form")) as HTMLElement | null;
  if (!scroller) {
    element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const sticky = document.querySelector(".clinical-encounter-form .visit-sticky-chrome") as HTMLElement | null;
  const stickyHeight = sticky?.getBoundingClientRect().height || 0;
  const scrollerRect = scroller.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const visibleTop = scrollerRect.top + (scroller.classList.contains("visit-workspace-scroll") ? 8 : stickyHeight + 8);
  const visibleBottom = scrollerRect.bottom - 12;
  const inView = elementRect.top >= visibleTop - 12 && elementRect.top <= visibleBottom - 40;
  if (options?.onlyIfNeeded && inView) return;
  const nextTop = scroller.scrollTop + (elementRect.top - scrollerRect.top) - (scroller.classList.contains("visit-workspace-scroll") ? 10 : stickyHeight + 10);
  if (Math.abs(nextTop - scroller.scrollTop) < 8) return;
  scroller.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

type DocumentationFlowStep = "visit" | "history" | "safety" | "ros" | "objective" | "assessment" | "plan" | "charges";

const DOCUMENTATION_FLOW_STEPS: Array<{ key: DocumentationFlowStep; label: string; group: "subjective" | "soap" | "charges" }> = [
  { key: "visit", label: "Visit & HPI", group: "subjective" },
  { key: "history", label: "History", group: "subjective" },
  { key: "safety", label: "Safety review", group: "subjective" },
  { key: "ros", label: "Review of systems", group: "subjective" },
  { key: "objective", label: "Objective", group: "soap" },
  { key: "assessment", label: "Assessment", group: "soap" },
  { key: "plan", label: "Plan", group: "soap" },
  { key: "charges", label: "Charges", group: "charges" },
];

function soapSectionForVisitStep(step: DocumentationFlowStep): "subjective" | "objective" | "assessment" | "plan" {
  if (step === "charges" || step === "plan") return "plan";
  if (step === "objective" || step === "assessment") return step;
  return "subjective";
}

function visitStepFromSoapSection(
  section: "subjective" | "objective" | "assessment" | "plan",
  lastSubjective: "visit" | "history" | "safety" | "ros" = "visit",
): DocumentationFlowStep {
  if (section === "subjective") return lastSubjective;
  return section;
}

function VisitStoryStrip({
  data,
  form,
  visitStep,
  onJump,
}: Omit<FormProps, "update"> & { visitStep: DocumentationFlowStep; onJump: (step: DocumentationFlowStep) => void }) {
  const subjective = parseSubjectiveDocument(form.subjectiveItemsJson);
  const complaints = subjective.items.map((item) => item.complaint.trim()).filter(Boolean);
  const patientId = String(form.patientId || "");
  const allergies = (data.patientAllergies || []).filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active");
  const allergyLabels = allergies
    .filter((row) => value(row, "allergyType") !== "nkda")
    .map((row) => value(row, "substance") || value(row, "allergen") || value(row, "name"))
    .filter(Boolean);
  const nkda = allergies.some((row) => value(row, "allergyType") === "nkda") && allergyLabels.length === 0;
  const historyCount = (subjective.medicalHistory || []).length + (subjective.familyHistory || []).length + (subjective.historySelections || []).length;
  const rosReady = Boolean(String(form.reviewOfSystems || "").trim()) || (subjective.rosNormalSystems || []).length > 0 || (subjective.rosSelections || []).length > 0;
  const medsReviewed = Boolean(form.medicationsReviewed);
  const complaintText = complaints.length ? complaints.slice(0, 2).join(" · ") + (complaints.length > 2 ? ` +${complaints.length - 2}` : "") : "No complaint yet";
  const allergyText = allergyLabels.length ? allergyLabels.slice(0, 2).join(", ") + (allergyLabels.length > 2 ? ` +${allergyLabels.length - 2}` : "") : nkda ? "NKDA" : "Not documented";

  return (
    <section aria-label="Pinned visit story" className="visit-story-strip">
      <button aria-current={visitStep === "visit" ? "step" : undefined} className={visitStep === "visit" ? "active" : ""} onClick={() => onJump("visit")} type="button">
        <span>Complaints</span>
        <strong>{complaintText}</strong>
      </button>
      <button aria-current={visitStep === "safety" ? "step" : undefined} className={`allergy-chip ${allergyLabels.length ? "alert" : ""} ${visitStep === "safety" ? "active" : ""}`} onClick={() => onJump("safety")} type="button">
        <span>Allergies</span>
        <strong className={allergyLabels.length ? "allergy-alert-text" : ""}>{allergyText}</strong>
      </button>
      <button aria-current={visitStep === "safety" ? "step" : undefined} className={visitStep === "safety" ? "active" : ""} onClick={() => onJump("safety")} type="button">
        <span>Medications</span>
        <strong>{medsReviewed ? "Reviewed" : "Needs review"}</strong>
      </button>
      <button aria-current={visitStep === "history" ? "step" : undefined} className={visitStep === "history" ? "active" : ""} onClick={() => onJump("history")} type="button">
        <span>History</span>
        <strong>{historyCount ? `${historyCount} recorded` : "Not started"}</strong>
      </button>
      <button aria-current={visitStep === "ros" ? "step" : undefined} className={visitStep === "ros" ? "active" : ""} onClick={() => onJump("ros")} type="button">
        <span>ROS</span>
        <strong>{rosReady ? "Documented" : "Pending"}</strong>
      </button>
    </section>
  );
}

function ClinicalComposer({
  data,
  form,
  update,
  onPatientAllergiesChange,
  onRefresh,
  visitStep,
  onVisitStepChange,
  lastSubjectiveStep = "visit",
}: FormProps & {
  visitStep: DocumentationFlowStep;
  onVisitStepChange: (step: DocumentationFlowStep) => void;
  lastSubjectiveStep?: "visit" | "history" | "safety" | "ros";
  onRefresh?: () => Promise<void>;
}) {
  const selectedDiagnoses = billingDiagnosisCodesFromForm(form);
  const selectedProcedures = String(form.procedureCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
  const completedNarrative = (input: unknown) => Boolean(String(input || "").trim()) && !/^\[[\s\S]+\]$/.test(String(input || "").trim());
  const activeSoap = soapSectionForVisitStep(visitStep);
  const subjectiveView = visitStep === "history" || visitStep === "safety" || visitStep === "ros" ? visitStep : "visit";

  function openSoapSection(section: "subjective" | "objective" | "assessment" | "plan") {
    onVisitStepChange(visitStepFromSoapSection(section, lastSubjectiveStep));
  }

  useEffect(() => {
    function handleOpenSoap(event: Event) {
      const section = (event as CustomEvent<string>).detail;
      if (["subjective", "objective", "assessment", "plan"].includes(section)) {
        openSoapSection(section as "subjective" | "objective" | "assessment" | "plan");
      }
    }
    window.addEventListener("pracx:open-soap", handleOpenSoap);
    return () => window.removeEventListener("pracx:open-soap", handleOpenSoap);
  }, [onVisitStepChange, lastSubjectiveStep]);

  const soapTabs = [
    { key: "subjective", letter: "S", label: "Subjective", complete: completedNarrative(form.chiefComplaint) && completedNarrative(form.historyOfPresentIllness) },
    { key: "objective", letter: "O", label: "Objective", complete: completedNarrative(form.physicalExam) && isObjectiveVerifiedForDos(parseSubjectiveDocument(form.subjectiveItemsJson).objectiveVerifiedDos, String(form.dateOfService || "")) },
    { key: "assessment", letter: "A", label: "Assessment", complete: completedNarrative(form.assessment) && selectedDiagnoses.length > 0 },
    { key: "plan", letter: "P", label: "Plan", complete: completedNarrative(form.treatmentPlan) && selectedProcedures.length > 0 },
  ] as const;

  return <div className="smart-clinical-composer soap-composer soap-composer-focused">
    <nav aria-label="SOAP note sections" className="soap-tabs">{soapTabs.map((tab) => <button aria-pressed={activeSoap === tab.key} className={activeSoap === tab.key ? "active" : ""} key={tab.key} onClick={() => openSoapSection(tab.key)} type="button"><b>{tab.letter}</b><span><strong>{tab.label}</strong><small>{tab.complete ? "Ready" : "Needs work"}</small></span><em>{tab.complete ? "✓" : "○"}</em></button>)}</nav>
    {activeSoap === "subjective" && <section className="soap-panel subjective-panel" id="soap-section-subjective"><PatientCenteredSubjectiveWorkspace data={data} form={form} onPatientAllergiesChange={onPatientAllergiesChange} onSubjectiveViewChange={(view) => onVisitStepChange(view)} subjectiveView={subjectiveView} update={update} /></section>}
    {activeSoap === "objective" && <section className="soap-panel objective-panel" id="soap-section-objective"><ObjectiveWorkspace data={data} form={form} onRefresh={onRefresh} update={update} /></section>}
    {activeSoap === "assessment" && (
      <section className="soap-panel assessment-panel" id="soap-section-assessment">
        <AssessmentWorkspace
          data={data}
          document={parseSubjectiveDocument(form.subjectiveItemsJson)}
          form={form}
          onDocumentChange={(next) => update("subjectiveItemsJson", JSON.stringify(next))}
          update={update}
        />
      </section>
    )}
    {(activeSoap === "plan") && (
      <section className="soap-panel plan-panel" id="soap-section-plan">
        <header><span>P</span><div><h3>Plan</h3><p>Treatment, counseling, follow-up booking and patient instructions. Orders and charges stay in the action rail.</p></div></header>
        <div className="soap-field-grid">
          <ClinicalPhraseField data={data} field="treatmentPlan" form={form} label="Plan" placeholder="Medication, orders, counseling, procedures and rationale" required section="plan" update={update} />
          <ClinicalPhraseField data={data} field="followUpInstructions" form={form} label="Follow-up instructions" placeholder="Return interval, precautions and patient instructions" section="follow_up" update={update} />
        </div>
        <PlanFollowUpBooking data={data} form={form} onRefresh={onRefresh} update={update} />
        <TextArea form={form} label="Additional note" name="clinicalNote" placeholder="Other clinically relevant documentation" rows={3} update={update} />
      </section>
    )}
  </div>;
}

function VisitProcedureCharges({ data, form, update }: FormProps) {
  const [query, setQuery] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [reviewedPrompts, setReviewedPrompts] = useState<string[]>([]);
  const selectedCodes = String(form.procedureCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
  const normalizedQuery = query.trim().toLowerCase();
  const configuredProcedureCodes = new Set(data.practiceServices.map((row) => value(row, "procedureCode")).filter(Boolean));
  const serviceCatalog: DataRow[] = [
    ...data.practiceServices,
    ...data.procedureCodes
      .filter((row) => !configuredProcedureCodes.has(value(row, "code")))
      .map((row) => ({
        id: `charge-master:${value(row, "id")}`,
        name: value(row, "description"),
        category: value(row, "codeSet"),
        specialty: "Charge master",
        procedureCode: value(row, "code"),
        suggestedDiagnosisCodes: "[]",
        documentationPrompts: "[]",
        keywords: `${value(row, "code")} ${value(row, "description")}`,
        defaultCharge: value(row, "defaultCharge"),
      })),
  ];
  const results = normalizedQuery.length >= 2
    ? serviceCatalog
      .filter((row) => `${value(row, "name")} ${value(row, "category")} ${value(row, "specialty")} ${value(row, "procedureCode")} ${value(row, "keywords")}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 10)
    : [];
  const selectedService = serviceCatalog.find((row) => value(row, "id") === selectedServiceId);
  const servicePrompts = selectedService ? list(selectedService.documentationPrompts) : [];

  function addCode(code: string) {
    const normalized = code.trim();
    if (!normalized) return;
    update("procedureCodes", mergeClinicalCodes(form.procedureCodes, [normalized]));
  }
  function removeCode(code: string) {
    update("procedureCodes", selectedCodes.filter((item) => item !== code).join(", "));
  }
  function chooseService(service: DataRow) {
    setSelectedServiceId(value(service, "id"));
    setReviewedPrompts([]);
    setQuery(value(service, "name"));
    if (value(service, "procedureCode")) addCode(value(service, "procedureCode"));
  }

  return <section className="visit-procedure-charges" id="visit-procedure-charges">
    <header>
      <div>
        <span className="eyebrow">CPT / HCPCS</span>
        <strong>Add performed services</strong>
        <small>Search practice services or charge-master codes. Selected codes appear below.</small>
      </div>
    </header>
    <label className="visit-procedure-search">
      <span>⌕</span>
      <input aria-label="Search CPT HCPCS or performed services" onChange={(event) => setQuery(event.target.value)} placeholder="Type service, CPT, or HCPCS" value={query} />
    </label>
    <div className="selected-clinical-codes">
      {selectedCodes.length
        ? selectedCodes.map((code) => <button key={code} onClick={() => removeCode(code)} type="button">{code} ×</button>)
        : <span>No procedure codes selected</span>}
    </div>
    {results.length > 0 && <div className="clinical-service-results">
      {results.map((service) => <button className={selectedServiceId === value(service, "id") ? "active" : ""} key={value(service, "id")} onClick={() => chooseService(service)} type="button">
        <span>
          <b>{value(service, "name")}</b>
          <small>{value(service, "category")} · {value(service, "specialty")}</small>
        </span>
        <em>{value(service, "procedureCode") || "Clinical"}</em>
        {value(service, "defaultCharge") !== undefined && value(service, "defaultCharge") !== "" && <small>{currency(value(service, "defaultCharge"))}</small>}
      </button>)}
    </div>}
    {selectedService && (servicePrompts.length > 0 || list(selectedService.suggestedDiagnosisCodes).length > 0) && <article className="clinical-service-detail">
      <div className="clinical-service-title">
        <div>
          <span className="eyebrow">Documentation guide</span>
          <strong>{value(selectedService, "name")}</strong>
          <small>Record only work and findings actually performed.</small>
        </div>
        <div className="service-code-actions">
          {list(selectedService.suggestedDiagnosisCodes).map((code) => <button key={code} onClick={() => update("diagnosisCodes", mergeClinicalCodes(form.diagnosisCodes, [code]))} type="button">+ Diagnosis {code}</button>)}
        </div>
      </div>
      {servicePrompts.length > 0 && <div className="clinical-service-prompts">{servicePrompts.map((prompt) => <label key={prompt}><input checked={reviewedPrompts.includes(prompt)} onChange={() => setReviewedPrompts((current) => current.includes(prompt) ? current.filter((item) => item !== prompt) : [...current, prompt])} type="checkbox" /><span>{prompt}</span></label>)}</div>}
    </article>}
  </section>;
}

function VisitPatientRail({ data, form, update, focusTarget = "" }: FormProps & { focusTarget?: string }) {
  const railRef = useRef<HTMLElement | null>(null);
  const patientId = String(form.patientId || "");
  const patient = data.patients.find((row) => value(row, "id") === patientId);
  const allergies = activePatientAllergies(data.patientAllergies, patientId);
  const medications = (data.patientMedications || []).filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active");
  const patientEncounters = data.encounters.filter((row) => value(row, "patientId") === patientId && value(row, "id") !== String(form.id || "")).sort((a, b) => value(b, "dateOfService").localeCompare(value(a, "dateOfService")));
  const lastVisit = patientEncounters[0];
  const problems = Array.from(new Set(patientEncounters.flatMap((row) => list(row.diagnosisCodes)).concat(String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean))));
  const vitals = [["Ht", form.height, "cm"], ["Wt", form.weight, "lb"], ["Temp", form.temperature, "°F"], ["HR", form.pulse, ""], ["BP", form.systolic ? `${form.systolic}${form.diastolic ? `/${form.diastolic}` : ""}` : "", ""], ["SpO₂", form.oxygenSaturation, "%"], ["Pain", form.painScore, "/10"]].filter(([, measured]) => String(measured || "").trim());

  useEffect(() => {
    if (!focusTarget) return;
    const rail = railRef.current;
    if (!rail) return;
    const element = document.getElementById(focusTarget);
    if (!element || !rail.contains(element)) return;

    let timeoutId = 0;
    const frame = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        const railRect = rail.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const padding = 12;
        const fullyVisible = elementRect.top >= railRect.top + 4 && elementRect.bottom <= railRect.bottom - 4;
        if (!fullyVisible) {
          rail.scrollTo({
            top: Math.max(0, rail.scrollTop + (elementRect.top - railRect.top) - padding),
            behavior: "smooth",
          });
        }
        element.classList.remove("visit-target-flash");
        void element.offsetWidth;
        element.classList.add("visit-target-flash");
      }, 80);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [focusTarget]);

  return <aside className="visit-patient-rail" aria-label="Patient visit context" id="visit-patient-rail" ref={railRef}>
    <nav aria-label="Patient chart sections" className="visit-chart-section-nav">
      <strong>Chart</strong>
      {CHART_SECTIONS.map((section) => (
        patientId
          ? <Link href={`/chart?patientId=${encodeURIComponent(patientId)}&section=${section.id}`} key={section.id} rel="noopener noreferrer" target="_blank">{section.label}</Link>
          : <span className="visit-chart-section-disabled" key={section.id}>{section.label}</span>
      ))}
    </nav>
    {patientId && <Link className="visit-chart-link" href={`/chart?patientId=${encodeURIComponent(patientId)}`} rel="noopener noreferrer" target="_blank">Open full chart ↗{patient ? ` · ${value(patient, "accountNumber")}` : ""}</Link>}
    <section className={`visit-rail-card ${focusTarget === "visit-vitals" ? "visit-target-flash" : ""}`} id="visit-vitals">
      <header><strong>Vitals</strong><small>From intake</small></header>
      <div className="visit-vitals-chips">{vitals.length ? vitals.map(([label, measured, unit]) => <span key={String(label)}><b>{label}</b>{String(measured)}{unit ? ` ${unit}` : ""}</span>) : <span className="visit-empty">No vitals recorded yet</span>}</div>
    </section>
    <section className={`visit-rail-card ${focusTarget === "visit-allergies" ? "visit-target-flash" : ""}`} id="visit-allergies">
      <header><strong>Allergies</strong><label className="visit-review-check"><input checked={Boolean(form.allergiesReviewed)} onChange={(event) => update("allergiesReviewed", event.target.checked)} type="checkbox" /><span>Reviewed</span></label></header>
      <div className="visit-mini-list">{allergies.length ? allergies.map((row) => {
        const isNkda = value(row, "allergyType") === "nkda";
        const isSevere = ["severe", "life_threatening"].includes(value(row, "severity"));
        return <span key={value(row, "id")} className={isNkda ? "nkda" : isSevere ? "severe allergy-alert" : "allergy-alert"}>{isNkda ? "NKDA" : `${value(row, "substance")}${value(row, "reaction") ? ` · ${value(row, "reaction")}` : ""}${value(row, "severity") && value(row, "severity") !== "unknown" ? ` · ${value(row, "severity")}` : ""}`}</span>;
      }) : <span className="visit-empty">Not documented</span>}</div>
    </section>
    <section className={`visit-rail-card ${focusTarget === "visit-medications" ? "visit-target-flash" : ""}`} id="visit-medications">
      <header><strong>Medications</strong><label className="visit-review-check"><input checked={Boolean(form.medicationsReviewed)} onChange={(event) => update("medicationsReviewed", event.target.checked)} type="checkbox" /><span>Reviewed</span></label></header>
      <div className="visit-mini-list">{medications.length ? medications.slice(0, 6).map((row) => <span key={value(row, "id")}><b>{value(row, "medicationName")}</b>{[value(row, "dose"), value(row, "frequency")].filter(Boolean).join(" · ")}</span>) : <span className="visit-empty">No active medications</span>}</div>
    </section>
    <section className={`visit-rail-card ${focusTarget === "visit-problems" ? "visit-target-flash" : ""}`} id="visit-problems">
      <header><strong>Problems</strong><small>{problems.length}</small></header>
      <div className="visit-mini-list">{problems.length ? problems.slice(0, 8).map((code) => { const master = data.diagnosisCodes.find((row) => value(row, "code") === code); return <span key={code}><b>{code}</b>{value(master, "description") || "Clinical diagnosis"}</span>; }) : <span className="visit-empty">No coded problems yet</span>}</div>
    </section>
    <section className={`visit-rail-card ${focusTarget === "visit-recent-visits" ? "visit-target-flash" : ""}`} id="visit-recent-visits">
      <header><strong>Last visit</strong></header>
      {lastVisit ? <div className="visit-last-note"><strong>{shortDate(value(lastVisit, "dateOfService"))}</strong><p>{value(lastVisit, "chiefComplaint") || "Clinical encounter"}</p><small>{value(lastVisit, "providerName")} · {value(lastVisit, "status").replaceAll("_", " ")}</small></div> : <span className="visit-empty">No prior encounters</span>}
    </section>
    <VisitResultsSummary data={data} form={form} focusTarget={focusTarget} />
  </aside>;
}

function VisitActionRail({ data, form, update, openPanel, setOpenPanel, isSaving = false, onSaveOrders, onCompletionNavChange, saveNotice = "" }: FormProps & {
  openPanel: string;
  setOpenPanel: (panel: string) => void;
  isSaving?: boolean;
  onSaveOrders?: () => Promise<void> | void;
  onCompletionNavChange?: (nav: {
    reviewed: boolean;
    signed: boolean;
    readyToBill: boolean;
    markReviewed: () => void;
  } | null) => void;
  saveNotice?: string;
}) {
  let orderCount = 0;
  try { orderCount = (JSON.parse(String(form.ordersJson || "[]")) as unknown[]).length; } catch { orderCount = 0; }
  const ordersOpen = openPanel === "visit-orders";
  const [portalReady, setPortalReady] = useState(false);
  const [ordersSaveState, setOrdersSaveState] = useState("");
  const [noteReviewed, setNoteReviewed] = useState(false);
  const status = String(form.status || "draft");
  const signed = ["signed", "ready_to_bill", "billed"].includes(status);
  const readyToBill = ["ready_to_bill", "billed"].includes(status);
  const reviewed = noteReviewed || signed;
  const procedureCount = String(form.procedureCodes || "").split(",").map((code) => code.trim()).filter(Boolean).length;
  const assessmentProblems = parseSubjectiveDocument(form.subjectiveItemsJson).assessmentProblems || [];
  const diagnosisCodes = billingDiagnosisCodesFromForm(form);
  const diagnosisDetails = diagnosisCodes.map((code) => {
    const master = data.diagnosisCodes.find((row) => value(row, "code").toUpperCase() === code.toUpperCase());
    const fromAssessment = assessmentProblems.find((row) => String(row.code || "").toUpperCase() === code.toUpperCase());
    return {
      code,
      description: value(master, "description") || fromAssessment?.diagnosis || "From Assessment",
    };
  });

  useEffect(() => {
    const fromAssessment = codesFromAssessmentSubjectiveJson(form.subjectiveItemsJson);
    if (!fromAssessment.length) return;
    const current = String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
    const merged = mergeClinicalCodes(current.join(", "), fromAssessment);
    const normalizedCurrent = current.map((code) => code.toUpperCase()).join(", ");
    const normalizedMerged = merged.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean).join(", ");
    if (normalizedMerged && normalizedMerged !== normalizedCurrent) {
      update("diagnosisCodes", merged.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean).join(", "));
    }
  }, [form.subjectiveItemsJson, form.diagnosisCodes, update]);

  useEffect(() => { setPortalReady(true); }, []);

  useEffect(() => {
    if (!onCompletionNavChange) return;
    onCompletionNavChange({
      reviewed,
      signed,
      readyToBill,
      markReviewed: () => setNoteReviewed(true),
    });
  }, [reviewed, signed, readyToBill, onCompletionNavChange]);

  useEffect(() => () => onCompletionNavChange?.(null), [onCompletionNavChange]);

  useEffect(() => {
    if (!ordersOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPanel("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordersOpen, setOpenPanel]);

  useEffect(() => {
    if (!ordersOpen) return;
    if (saveNotice.toLowerCase().includes("order")) setOrdersSaveState(saveNotice);
  }, [saveNotice, ordersOpen]);

  async function saveOrders() {
    if (!onSaveOrders) return;
    setOrdersSaveState("Saving…");
    await onSaveOrders();
    setOrdersSaveState(orderCount ? `${orderCount} order${orderCount === 1 ? "" : "s"} / referral${orderCount === 1 ? "" : "s"} saved to this visit.` : "Visit orders saved.");
  }

  const ordersModal = ordersOpen && portalReady ? createPortal(
    <div className="visit-orders-modal-backdrop" onClick={() => setOpenPanel("")} role="presentation">
      <section aria-labelledby="visit-orders-title" aria-modal="true" className="visit-orders-modal" id="visit-orders" onClick={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <strong id="visit-orders-title">Orders & referrals</strong>
            <small>{orderCount ? `${orderCount} item${orderCount === 1 ? "" : "s"} on this visit` : "Medication, lab, imaging and referrals in one place"}</small>
          </div>
          <button aria-label="Close orders" className="visit-orders-close" onClick={() => setOpenPanel("")} type="button">×</button>
        </header>
        <div className="visit-orders-modal-body">
          <ClinicalOrdersEditor data={data} form={form} update={update} />
        </div>
        <footer className="visit-orders-modal-footer">
          <div aria-live="polite">{ordersSaveState ? <span className="visit-orders-save-state">✓ {ordersSaveState}</span> : <small>Add items to the list, then save to keep them on this visit.</small>}</div>
          <div className="visit-orders-modal-actions">
            <button className="secondary-button" onClick={() => setOpenPanel("")} type="button">Close</button>
            <button className="primary-button" disabled={isSaving || !onSaveOrders} onClick={() => void saveOrders()} type="button">{isSaving ? "Saving…" : "Save orders"}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <aside className="visit-action-rail" aria-label="Visit completion">
    {ordersModal}
    <section className={`visit-completion-panel ${openPanel === "visit-note-preview" || openPanel === "visit-billing" ? "visit-target-flash" : ""}`} id="visit-note-preview">
      <header className="visit-completion-header">
        <div>
          <span className="eyebrow">Final visit record</span>
          <strong>Review → Sign → Ready to bill</strong>
          <small>The assembled note appears here. Confirm it, sign, then release for billing.</small>
        </div>
        <ol className="visit-completion-steps" aria-label="Completion steps">
          <li className={reviewed ? "done" : "active"}><em>1</em><span>Review</span></li>
          <li className={signed ? "done" : reviewed ? "active" : ""}><em>2</em><span>Sign</span></li>
          <li className={readyToBill ? "done" : signed ? "active" : ""}><em>3</em><span>Ready to bill</span></li>
        </ol>
      </header>

      <div className="visit-completion-body">
        <section className={`visit-completion-charges ${openPanel === "visit-billing" ? "visit-target-flash" : ""}`} id="visit-billing">
          <header>
            <div>
              <strong>Charges for this visit</strong>
              <small>{procedureCount ? `${procedureCount} CPT / HCPCS code${procedureCount === 1 ? "" : "s"} selected` : "Confirm services before ready to bill"}</small>
            </div>
          </header>
          <div className="visit-billing-dx" aria-label="Diagnoses for billing">
            <strong>Diagnoses (ICD-10) from Assessment</strong>
            {diagnosisDetails.length ? (
              <div className="visit-billing-dx-codes">
                {diagnosisDetails.map((row) => (
                  <span key={row.code}><b>{row.code}</b>{row.description}</span>
                ))}
              </div>
            ) : (
              <small className="visit-empty">No ICD codes yet — in Assessment, search and pick each working diagnosis from the ICD list (code required for Charges).</small>
            )}
          </div>
          <VisitCodingAssistant data={data} form={form} update={update} />
          <VisitProcedureCharges data={data} form={form} update={update} />
        </section>

        <article className="visit-final-record" id="visit-final-record">
          <header>
            <div>
              <strong>Assembled encounter note</strong>
              <small>Built from check-in, vitals, SOAP and visit actions — review last before signing</small>
            </div>
            <Status value={status} />
          </header>
          <EncounterNotePreview data={data} form={form} />
        </article>
      </div>
    </section>
  </aside>;
}

function PhysicianEncounterCommandBar({ data, form, onFocusTarget }: Omit<FormProps, "update"> & { onFocusTarget: (target: string, soap?: "subjective" | "objective" | "assessment" | "plan") => void }) {
  const [activeAction, setActiveAction] = useState("Visit note");
  const patientId = String(form.patientId || "");
  const encounters = data.encounters.filter((row) => value(row, "patientId") === patientId && value(row, "id") !== String(form.id || ""));
  const medications = data.patientMedications.filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active");
  const allergies = activePatientAllergies(data.patientAllergies, patientId);
  const documents = data.patientDocuments.filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active" && value(row, "category") !== "patient_photo");
  const orders = data.clinicalOrders.filter((row) => value(row, "patientId") === patientId && value(row, "status") !== "cancelled");
  const results = data.clinicalOrderResults.filter((row) => value(row, "patientId") === patientId);
  const pendingResults = results.filter((row) => value(row, "reviewStatus") !== "reviewed");
  const severeAllergy = allergies.some((row) => ["severe", "life_threatening"].includes(value(row, "severity")));
  const recordedAllergy = allergies.some((row) => value(row, "allergyType") !== "nkda");
  const problemCodes = new Set([
    ...encounters.flatMap((row) => list(row.diagnosisCodes)),
    ...String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean),
  ]);
  const vitalsPresent = ["height", "weight", "temperature", "pulse", "respirations", "systolic", "oxygenSaturation", "painScore"].some((key) => String(form[key] || "").trim());
  const vitalsLabel = form.systolic
    ? `${String(form.systolic)}/${String(form.diastolic || "—")}`
    : vitalsPresent
      ? "Partial"
      : "Not recorded";

  function activate(label: string, target: string, soap?: "subjective" | "objective" | "assessment" | "plan") {
    setActiveAction(label);
    onFocusTarget(target, soap);
  }

  const actions = [
    { label: "Visit note", icon: "VN", run: () => activate("Visit note", "visit-note-workspace", "subjective") },
    { label: "Medications", icon: "Rx", count: medications.length, run: () => activate("Medications", "visit-medications") },
    { label: "Problems", icon: "Dx", count: problemCodes.size, run: () => activate("Problems", "visit-problems") },
    { label: "Orders", icon: "OR", count: orders.length, run: () => activate("Orders", "visit-orders") },
    { label: "Results", icon: "RS", count: pendingResults.length, run: () => activate("Results", "visit-results") },
    { label: "Documents", icon: "DC", count: documents.length, run: () => activate("Documents", "visit-documents-summary") },
    { label: "Charges", icon: "$", run: () => activate("Charges", "visit-billing") },
    { label: "Templates", icon: "TP", run: () => activate("Templates", "visit-templates", "subjective") },
    { label: "Review", icon: "RV", run: () => activate("Review", "visit-note-preview") },
  ];

  return <section className="physician-command-center" aria-label="Physician encounter tools">
    <nav className="physician-action-bar" aria-label="Chart actions">
      {patientId && <button aria-current={activeAction === "Full chart" ? "page" : undefined} className={`physician-action chart-action ${activeAction === "Full chart" ? "active" : ""}`} onClick={() => activate("Full chart", "visit-vitals")} type="button"><span>CH</span><strong>Full chart</strong></button>}
      {actions.map((action) => <button aria-current={activeAction === action.label ? "page" : undefined} className={`physician-action ${activeAction === action.label ? "active" : ""}`} key={action.label} onClick={action.run} type="button"><span>{action.icon}</span><strong>{action.label}</strong>{action.count !== undefined && <em>{action.count}</em>}</button>)}
    </nav>
    <div className="physician-context-strip">
      <button onClick={() => activate("Vitals", "visit-vitals")} type="button"><span>Vitals</span><strong>{vitalsLabel}</strong></button>
      <button className={severeAllergy || recordedAllergy ? "alert" : ""} onClick={() => activate("Allergies", "visit-allergies")} type="button"><span>Allergies</span><strong className={severeAllergy || recordedAllergy ? "allergy-alert-text" : ""}>{allergies.length ? `${allergies.length} recorded${severeAllergy ? " · severe" : ""}` : "Not documented"}</strong></button>
      <button onClick={() => activate("Medications", "visit-medications")} type="button"><span>Active medications</span><strong>{medications.length}</strong></button>
      <button onClick={() => activate("Previous visits", "visit-recent-visits")} type="button"><span>Previous visits</span><strong>{encounters.length}</strong></button>
      <button onClick={() => activate("Orders", "visit-orders")} type="button"><span>Orders</span><strong>{orders.length}</strong></button>
      <button onClick={() => activate("Results", "visit-results")} type="button"><span>Results to review</span><strong>{pendingResults.length}</strong></button>
      <button onClick={() => activate("Documents", "visit-documents-summary")} type="button"><span>Documents</span><strong>{documents.length}</strong></button>
    </div>
  </section>;
}

function VisitResultsSummary({ data, form, focusTarget = "" }: Omit<FormProps, "update"> & { focusTarget?: string }) {
  const patientId = String(form.patientId || "");
  const results = data.clinicalOrderResults.filter((row) => value(row, "patientId") === patientId).sort((a, b) => value(b, "resultedAt").localeCompare(value(a, "resultedAt")));
  const documents = data.patientDocuments.filter((row) => value(row, "patientId") === patientId && value(row, "status") === "active" && value(row, "category") !== "patient_photo").sort((a, b) => value(b, "documentDate").localeCompare(value(a, "documentDate")));
  return <>
    <section className={`visit-rail-card ${focusTarget === "visit-results" ? "visit-target-flash" : ""}`} id="visit-results"><header><strong>Results</strong><small>{results.length}</small></header><div className="visit-mini-list">{results.length ? results.slice(0, 4).map((row) => <span key={value(row, "id")}><b>{value(row, "orderName") || value(row, "summary") || "Clinical result"}</b>{[shortDate(value(row, "resultedAt")), value(row, "abnormalFlag")].filter(Boolean).join(" · ")}</span>) : <span className="visit-empty">No results recorded</span>}</div></section>
    <section className={`visit-rail-card ${focusTarget === "visit-documents-summary" ? "visit-target-flash" : ""}`} id="visit-documents-summary"><header><strong>Documents</strong><small>{documents.length}</small></header><div className="visit-mini-list">{documents.length ? documents.slice(0, 4).map((row) => <span key={value(row, "id")}><b>{value(row, "title") || value(row, "fileName") || "Document"}</b>{[value(row, "category").replaceAll("_", " "), shortDate(value(row, "documentDate") || value(row, "createdAt"))].filter(Boolean).join(" · ")}</span>) : <span className="visit-empty">No documents recorded</span>}</div></section>
  </>;
}

function ClinicalOrdersEditor({ data, form, update }: FormProps) {
  type OrderType = "medication" | "lab" | "imaging" | "referral";
  type OrderDraft = {
    orderType: OrderType;
    code: string;
    name: string;
    instructions: string;
    priority: string;
    specialty: string;
    referredTo: string;
    reason: string;
    clinicalQuestion: string;
    dose: string;
    frequency: string;
    bodySite: string;
  };

  const orderTypes: Array<{ key: OrderType; icon: string; label: string; hint: string }> = [
    { key: "medication", icon: "Rx", label: "Medication", hint: "Prescription / in-office med" },
    { key: "lab", icon: "Lb", label: "Laboratory", hint: "Blood, urine and panels" },
    { key: "imaging", icon: "Im", label: "Imaging", hint: "X-ray, CT, MRI, ultrasound" },
    { key: "referral", icon: "Rf", label: "Referral", hint: "Specialist consult request" },
  ];
  const specialties = ["Cardiology", "Dermatology", "Endocrinology", "ENT", "Gastroenterology", "General surgery", "Neurology", "Obstetrics / Gynecology", "Oncology", "Ophthalmology", "Orthopedics", "Pain management", "Physical therapy", "Psychiatry", "Pulmonology", "Rheumatology", "Urology", "Other"];

  function blankDraft(orderType: OrderType = "lab"): OrderDraft {
    return { orderType, code: "", name: "", instructions: "", priority: "routine", specialty: "", referredTo: "", reason: "", clinicalQuestion: "", dose: "", frequency: "", bodySite: "" };
  }

  const [draft, setDraft] = useState<OrderDraft>(blankDraft("lab"));
  const [catalogQuery, setCatalogQuery] = useState("");

  useEffect(() => {
    function prepareOrder(event: Event) {
      const orderType = (event as CustomEvent<string>).detail;
      if (["medication", "lab", "imaging", "referral"].includes(orderType)) {
        setDraft(blankDraft(orderType as OrderType));
        setCatalogQuery("");
      }
    }
    window.addEventListener("pracx:prepare-order", prepareOrder);
    return () => window.removeEventListener("pracx:prepare-order", prepareOrder);
  }, []);

  let orders: DataRow[] = [];
  try { orders = JSON.parse(String(form.ordersJson || "[]")) as DataRow[]; } catch { orders = []; }
  const clinicalRows = orders.filter((order) => value(order, "orderType") !== "referral");
  const referralRows = orders.filter((order) => value(order, "orderType") === "referral");
  const diagnosisHint = String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean).slice(0, 4).join(", ");
  const referringProviders = data.referringProviders || [];
  const catalogRows = (data.clinicalOrderCatalog || []).filter((row) => value(row, "orderType") === draft.orderType);
  const catalogMatches = catalogQuery.trim().length >= 1
    ? catalogRows.filter((row) => `${value(row, "code")} ${value(row, "name")} ${value(row, "category")} ${value(row, "keywords")} ${value(row, "specimenOrModality")}`.toLowerCase().includes(catalogQuery.trim().toLowerCase())).slice(0, 10)
    : catalogRows.slice(0, 8);

  function patchDraft(changes: Partial<OrderDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function selectCatalogItem(row: DataRow) {
    patchDraft({
      code: value(row, "code"),
      name: value(row, "name"),
      bodySite: draft.orderType === "imaging" ? value(row, "specimenOrModality") : draft.bodySite,
      instructions: draft.orderType === "lab" && value(row, "specimenOrModality")
        ? (draft.instructions.trim() || `Specimen: ${value(row, "specimenOrModality")}`)
        : draft.instructions,
    });
    setCatalogQuery("");
  }

  function orderIcon(orderType: string) {
    return orderTypes.find((item) => item.key === orderType)?.icon || "OR";
  }

  function switchType(orderType: OrderType) {
    setDraft(blankDraft(orderType));
    setCatalogQuery("");
  }

  function addOrder() {
    if (draft.orderType === "referral") {
      const specialty = draft.specialty.trim();
      const referredTo = draft.referredTo.trim();
      const reason = draft.reason.trim();
      if (!specialty && !referredTo) return;
      const name = draft.name.trim() || (specialty ? `${specialty} referral` : `Referral to ${referredTo}`);
      const instructions = [
        referredTo ? `To: ${referredTo}` : "",
        specialty ? `Specialty: ${specialty}` : "",
        reason ? `Reason: ${reason}` : "",
        draft.clinicalQuestion.trim() ? `Clinical question: ${draft.clinicalQuestion.trim()}` : "",
        draft.instructions.trim(),
      ].filter(Boolean).join(" · ");
      update("ordersJson", JSON.stringify([...orders, {
        id: crypto.randomUUID(),
        orderType: "referral",
        code: draft.code.trim() || specialty,
        name,
        instructions,
        priority: draft.priority,
        specialty,
        referredTo,
        reason,
        clinicalQuestion: draft.clinicalQuestion.trim(),
        status: "draft",
      }]));
      setDraft(blankDraft("referral"));
      return;
    }

    if (!draft.name.trim()) return;
    const instructions = draft.orderType === "medication"
      ? [draft.dose.trim() && `Dose: ${draft.dose.trim()}`, draft.frequency.trim() && `Frequency: ${draft.frequency.trim()}`, draft.instructions.trim()].filter(Boolean).join(" · ")
      : draft.orderType === "imaging"
        ? [draft.bodySite.trim() && `Site/views: ${draft.bodySite.trim()}`, draft.instructions.trim()].filter(Boolean).join(" · ")
        : draft.instructions.trim();
    update("ordersJson", JSON.stringify([...orders, {
      id: crypto.randomUUID(),
      orderType: draft.orderType,
      code: draft.code.trim(),
      name: draft.name.trim(),
      instructions,
      priority: draft.priority,
      dose: draft.dose.trim(),
      frequency: draft.frequency.trim(),
      bodySite: draft.bodySite.trim(),
      status: "draft",
    }]));
    setDraft(blankDraft(draft.orderType));
  }

  function removeOrder(id: string) {
    update("ordersJson", JSON.stringify(orders.filter((order) => value(order, "id") !== id)));
  }

  const activeType = orderTypes.find((item) => item.key === draft.orderType) || orderTypes[1];

  return <section className="clinical-orders-editor visit-orders-editor">
    <nav aria-label="Order type" className="visit-order-type-tabs">
      {orderTypes.map((item) => <button className={draft.orderType === item.key ? "active" : ""} key={item.key} onClick={() => switchType(item.key)} type="button"><span>{item.icon}</span><strong>{item.label}</strong><small>{item.hint}</small></button>)}
    </nav>

    <div className={`visit-order-form-card order-type-${draft.orderType}`}>
      <header>
        <span>{activeType.icon}</span>
        <div>
          <strong>{activeType.label} details</strong>
          <small>{draft.orderType === "referral" ? "Capture specialty, destination and clinical reason for the consult." : "Complete the fields for this visit order, then add it to the list below."}</small>
        </div>
      </header>

      {draft.orderType === "referral" ? <div className="visit-order-form-grid referral-grid">
        <label>Specialty<select aria-label="Referral specialty" onChange={(event) => patchDraft({ specialty: event.target.value, name: event.target.value ? `${event.target.value} referral` : "" })} value={draft.specialty}><option value="">Select specialty</option>{specialties.map((specialty) => <option key={specialty} value={specialty}>{specialty}</option>)}</select></label>
        <label>Urgency<select aria-label="Referral urgency" onChange={(event) => patchDraft({ priority: event.target.value })} value={draft.priority}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label>
        <label className="span-2">Referred to<input aria-label="Referred to provider or practice" list="visit-referral-providers" onChange={(event) => patchDraft({ referredTo: event.target.value })} placeholder="Specialist, practice or facility" value={draft.referredTo} /></label>
        <datalist id="visit-referral-providers">{referringProviders.map((row) => <option key={value(row, "id")} value={referringProviderLabel(row)}>{value(row, "specialty")} · NPI {value(row, "npi")}</option>)}</datalist>
        <label>Referral title<input aria-label="Referral title" onChange={(event) => patchDraft({ name: event.target.value })} placeholder="e.g. Cardiology consult" value={draft.name} /></label>
        <label>Auth / code<input aria-label="Referral authorization or code" onChange={(event) => patchDraft({ code: event.target.value })} placeholder="Optional auth or code" value={draft.code} /></label>
        <label className="span-2">Reason for referral<textarea aria-label="Reason for referral" onChange={(event) => patchDraft({ reason: event.target.value })} placeholder="Why is this consult needed for today’s visit?" rows={3} value={draft.reason} /></label>
        <label className="span-2">Clinical question<textarea aria-label="Clinical question for specialist" onChange={(event) => patchDraft({ clinicalQuestion: event.target.value })} placeholder="Specific question for the specialist" rows={2} value={draft.clinicalQuestion} /></label>
        <label className="span-2">Additional instructions<textarea aria-label="Additional referral instructions" onChange={(event) => patchDraft({ instructions: event.target.value })} placeholder="Records to send, preferred location, patient constraints" rows={2} value={draft.instructions} /></label>
        {diagnosisHint && <p className="visit-order-form-hint">Linked diagnoses on this visit: {diagnosisHint}</p>}
      </div> : <div className="visit-order-form-grid">
        {draft.orderType === "medication" ? <>
          <label className="span-2">Medication name<input aria-label="Medication name" onChange={(event) => patchDraft({ name: event.target.value })} placeholder="Generic or brand name" value={draft.name} /></label>
          <label>RxNorm / code<input aria-label="Medication code" onChange={(event) => patchDraft({ code: event.target.value })} placeholder="Optional code" value={draft.code} /></label>
          <label>Priority<select aria-label="Medication priority" onChange={(event) => patchDraft({ priority: event.target.value })} value={draft.priority}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label>
          <label>Dose<input aria-label="Medication dose" onChange={(event) => patchDraft({ dose: event.target.value })} placeholder="10 mg" value={draft.dose} /></label>
          <label>Frequency<input aria-label="Medication frequency" onChange={(event) => patchDraft({ frequency: event.target.value })} placeholder="Once daily" value={draft.frequency} /></label>
          <label className="span-2">Directions<textarea aria-label="Medication directions" onChange={(event) => patchDraft({ instructions: event.target.value })} placeholder="Route, indication and patient directions" rows={2} value={draft.instructions} /></label>
        </> : draft.orderType === "imaging" ? <>
          <div className="span-2 visit-order-catalog-search">
            <label>Search imaging catalog<input aria-label="Search imaging catalog" onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search MRI, CT, X-ray, ultrasound…" value={catalogQuery} /></label>
            <div className="visit-order-catalog-results">{catalogMatches.map((row) => <button key={value(row, "id")} onClick={() => selectCatalogItem(row)} type="button"><b>{value(row, "code")}</b><span><strong>{value(row, "name")}</strong><small>{value(row, "category")} · {value(row, "specimenOrModality") || "Imaging"}</small></span></button>)}{!catalogMatches.length && <em>No matching imaging studies. Type a custom study below.</em>}</div>
            <small>{catalogRows.length} imaging studies loaded in the practice catalog</small>
          </div>
          <label className="span-2">Study name<input aria-label="Imaging study name" onChange={(event) => patchDraft({ name: event.target.value })} placeholder="e.g. MRI lumbar spine without contrast" value={draft.name} /></label>
          <label>CPT / code<input aria-label="Imaging code" onChange={(event) => patchDraft({ code: event.target.value })} placeholder="Optional CPT" value={draft.code} /></label>
          <label>Priority<select aria-label="Imaging priority" onChange={(event) => patchDraft({ priority: event.target.value })} value={draft.priority}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label>
          <label className="span-2">Body site / views<input aria-label="Imaging body site or views" onChange={(event) => patchDraft({ bodySite: event.target.value })} placeholder="Laterality, views, contrast" value={draft.bodySite} /></label>
          <label className="span-2">Clinical indication<textarea aria-label="Imaging clinical indication" onChange={(event) => patchDraft({ instructions: event.target.value })} placeholder="Indication, history relevant to the study" rows={2} value={draft.instructions} /></label>
        </> : <>
          <div className="span-2 visit-order-catalog-search">
            <label>Search laboratory catalog<input aria-label="Search laboratory catalog" onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search CBC, A1c, lipid, TSH, UA…" value={catalogQuery} /></label>
            <div className="visit-order-catalog-results">{catalogMatches.map((row) => <button key={value(row, "id")} onClick={() => selectCatalogItem(row)} type="button"><b>{value(row, "code")}</b><span><strong>{value(row, "name")}</strong><small>{value(row, "category")} · {value(row, "specimenOrModality") || "Lab"}</small></span></button>)}{!catalogMatches.length && <em>No matching laboratory tests. Type a custom test below.</em>}</div>
            <small>{catalogRows.length} laboratory tests loaded in the practice catalog</small>
          </div>
          <label className="span-2">Test / panel name<input aria-label="Laboratory test name" onChange={(event) => patchDraft({ name: event.target.value })} placeholder="e.g. CBC with differential" value={draft.name} /></label>
          <label>Code<input aria-label="Laboratory code" onChange={(event) => patchDraft({ code: event.target.value })} placeholder="Optional LOINC / CPT" value={draft.code} /></label>
          <label>Priority<select aria-label="Laboratory priority" onChange={(event) => patchDraft({ priority: event.target.value })} value={draft.priority}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label>
          <label className="span-2">Collection instructions<textarea aria-label="Laboratory instructions" onChange={(event) => patchDraft({ instructions: event.target.value })} placeholder="Fasting, timing, specimen notes" rows={2} value={draft.instructions} /></label>
        </>}
      </div>}

      <div className="visit-order-form-actions">
        <button className="secondary-button" onClick={addOrder} type="button">{draft.orderType === "referral" ? "Add referral to list" : "Add order to list"}</button>
        <small>{draft.orderType === "referral" ? "Then click Save orders at the bottom to keep it on this visit." : "Then click Save orders at the bottom to keep it on this visit."}</small>
      </div>
    </div>

    <div className="visit-order-tables">
      <section className="visit-order-table-card">
        <header><strong>Clinical orders</strong><small>{clinicalRows.length}</small></header>
        {clinicalRows.length ? <div className="visit-order-table-wrap"><table><thead><tr><th>Type</th><th>Order</th><th>Code</th><th>Priority</th><th>Status</th><th /></tr></thead><tbody>{clinicalRows.map((order) => <tr key={value(order, "id")}><td><span className="visit-order-type-badge">{orderIcon(value(order, "orderType"))}</span></td><td><strong>{value(order, "name")}</strong><small>{value(order, "instructions") || "No instructions"}</small></td><td>{value(order, "code") || "—"}</td><td>{value(order, "priority")}</td><td><Status value={value(order, "status") || "draft"} /></td><td><button aria-label={`Remove ${value(order, "name")}`} onClick={() => removeOrder(value(order, "id"))} type="button">×</button></td></tr>)}</tbody></table></div> : <div className="clinical-orders-empty">No medication, lab or imaging orders added yet.</div>}
      </section>

      <section className="visit-order-table-card referral-table">
        <header><strong>Referrals</strong><small>{referralRows.length}</small></header>
        {referralRows.length ? <div className="visit-order-table-wrap"><table><thead><tr><th>Type</th><th>Specialty / title</th><th>Referred to</th><th>Reason</th><th>Urgency</th><th>Status</th><th /></tr></thead><tbody>{referralRows.map((order) => {
          const referredTo = value(order, "referredTo") || (value(order, "instructions").match(/To:\s*([^·]+)/)?.[1] || "").trim();
          const specialty = value(order, "specialty") || value(order, "code");
          const reason = value(order, "reason") || (value(order, "instructions").match(/Reason:\s*([^·]+)/)?.[1] || value(order, "instructions") || "—").trim();
          return <tr key={value(order, "id")}><td><span className="visit-order-type-badge">Rf</span></td><td><strong>{value(order, "name")}</strong><small>{specialty || "Specialty not set"}</small></td><td>{referredTo || "—"}</td><td>{reason}</td><td>{value(order, "priority")}</td><td><Status value={value(order, "status") || "draft"} /></td><td><button aria-label={`Remove ${value(order, "name")}`} onClick={() => removeOrder(value(order, "id"))} type="button">×</button></td></tr>;
        })}</tbody></table></div> : <div className="clinical-orders-empty">No referrals added yet. Use the Referral tab above.</div>}
      </section>
    </div>
  </section>;
}

function VitalsIntakeForm({ form, update }: SimpleFormProps) {
  const height = Number(form.height || 0);
  const weight = Number(form.weight || 0);
  const bmi = height > 0 && weight > 0 ? (weight * 0.45359237) / ((height / 100) ** 2) : null;
  const bmiValue = bmi ? Math.round(bmi * 10) / 10 : null;
  const bmiCategory = !bmiValue ? { label: "Awaiting measurements", risk: "Enter height and weight to calculate BMI.", tone: "unknown" }
    : bmiValue < 18.5 ? { label: "Underweight", risk: "Review nutritional status and clinical context.", tone: "underweight" }
      : bmiValue < 25 ? { label: "Healthy range", risk: "Lowest population-level weight-related risk range.", tone: "healthy" }
        : bmiValue < 30 ? { label: "Overweight", risk: "Consider cardiometabolic risk factors and patient context.", tone: "overweight" }
          : { label: "Obesity range", risk: "Assess related conditions and appropriate management options.", tone: "obesity" };
  const gaugeBmi = Math.min(40, Math.max(12, bmiValue || 12));
  const gaugeAngle = -90 + ((gaugeBmi - 12) / 28) * 180;
  const enteredPainScore = Number(form.painScore);
  const painScore = String(form.painScore ?? "").trim() !== "" && Number.isFinite(enteredPainScore) && enteredPainScore >= 0 && enteredPainScore <= 10 ? Math.round(enteredPainScore) : null;
  const painReference = painScore === null ? { label: "Awaiting rating", guidance: "Ask the patient to select the number that best describes their pain now.", tone: "unknown" }
    : painScore === 0 ? { label: "No pain", guidance: "Patient reports no pain at this time.", tone: "none" }
      : painScore <= 3 ? { label: "Mild pain", guidance: "Record the patient’s description, location and functional effect.", tone: "mild" }
        : painScore <= 6 ? { label: "Moderate pain", guidance: "Assess characteristics, functional effect and current management.", tone: "moderate" }
          : painScore <= 9 ? { label: "Severe pain", guidance: "Prompt clinical assessment and appropriate escalation may be needed.", tone: "severe" }
            : { label: "Worst pain imaginable", guidance: "Prompt clinical assessment and appropriate escalation may be needed.", tone: "worst" };

  return <div className="vitals-intake-form">
    <section className="encounter-patient-banner"><div><span className="eyebrow">Checked in · clinical intake</span><h3>{String(form.patientName || "Patient")}</h3><p>{String(form.providerName || "Provider")} · capture vitals before the provider begins SOAP documentation</p></div><Status value="vitals pending" /></section>
    <div className="vitals-intake-layout">
      <div className="vitals-intake-fields">
        <fieldset><legend>Room and reason</legend><div className="form-grid"><Select label="Room" name="roomName" form={form} update={update} required options={VISIT_ROOM_OPTIONS.map((room) => [room, room])} /><Input label="Chief complaint" name="chiefComplaint" form={form} update={update} required placeholder="Patient’s reason for today’s visit" /></div></fieldset>
        <fieldset><legend>Vitals</legend><div className="form-grid clinical-vitals-grid"><Input label="Height (cm)" name="height" form={form} update={update} placeholder="centimeters" type="number" /><Input label="Weight (lb)" name="weight" form={form} update={update} placeholder="pounds" type="number" /><Input label="Temperature" name="temperature" form={form} update={update} placeholder="°F" /><Input label="Pulse" name="pulse" form={form} update={update} placeholder="bpm" /><Input label="Respirations" name="respirations" form={form} update={update} placeholder="/min" /><Input label="Systolic BP" name="systolic" form={form} update={update} placeholder="mmHg" /><Input label="Diastolic BP" name="diastolic" form={form} update={update} placeholder="mmHg" /><Input label="O₂ saturation" name="oxygenSaturation" form={form} update={update} placeholder="%" /><Input label="Pain score" name="painScore" form={form} update={update} placeholder="0–10" type="number" /></div><div className="checkbox-grid"><Check label="Allergies reviewed" name="allergiesReviewed" form={form} update={update} /><Check label="Medications reviewed" name="medicationsReviewed" form={form} update={update} /></div></fieldset>
        <div className="intake-ready-note"><strong>Next step</strong><span>Saving intake moves this patient to Ready for provider and creates the connected draft encounter if needed.</span></div>
      </div>
      <div className="vitals-insight-rail">
        <aside aria-label="Body mass index assessment" className={`bmi-assessment-card ${bmiCategory.tone}`}>
          <header><div><span className="eyebrow">Calculated from vitals</span><h3>BMI health guide</h3></div><span className="bmi-live-value" aria-live="polite">{bmiValue ?? "—"}</span></header>
          <div aria-label={bmiValue ? `BMI ${bmiValue}, ${bmiCategory.label}` : "BMI awaiting height and weight"} className="bmi-gauge" role="img"><div className="bmi-gauge-scale"><span>Under</span><span>Healthy</span><span>Over</span><span>Obesity</span></div><span className="bmi-needle" style={{ transform: `translateX(-50%) rotate(${gaugeAngle}deg)` }} /><span className="bmi-gauge-hub" /></div>
          <div className="bmi-classification"><span>Current classification</span><strong>{bmiCategory.label}</strong><p>{bmiCategory.risk}</p></div>
          <div className="bmi-reference" aria-label="BMI reference ranges"><div><i className="underweight" /><span><b>Below 18.5</b>Underweight</span></div><div><i className="healthy" /><span><b>18.5–24.9</b>Healthy range</span></div><div><i className="overweight" /><span><b>25.0–29.9</b>Overweight</span></div><div><i className="obesity" /><span><b>30.0 or higher</b>Obesity range</span></div></div>
          <footer>BMI is a screening measure. Interpret it with the patient’s history, examination, body composition and clinical circumstances.</footer>
        </aside>
        <aside aria-label="Numeric pain rating reference" className={`pain-reference-card ${painReference.tone}`}>
          <header><div><span className="eyebrow">Patient-reported</span><h3>Pain reference</h3></div><span aria-live="polite">{painScore ?? "—"}<small>/10</small></span></header>
          <div aria-label="Select pain score from 0 to 10" className="pain-number-scale">{Array.from({ length: 11 }, (_, score) => <button aria-label={`Pain score ${score}`} aria-pressed={painScore === score} className={painScore === score ? "active" : ""} key={score} onClick={() => update("painScore", String(score))} type="button">{score}</button>)}</div>
          <div className="pain-scale-bands"><span>No pain</span><span>Mild</span><span>Moderate</span><span>Severe</span><span>Worst</span></div>
          <div className="pain-current-reference"><strong>{painReference.label}</strong><p>{painReference.guidance}</p></div>
          <footer>The numeric pain rating is selected by the patient: 0 means no pain and 10 means the worst pain imaginable. Preserve the exact reported score.</footer>
        </aside>
      </div>
    </div>
  </div>;
}

function ClinicalEncounterHeaderContext({ data, form, update }: FormProps) {
  const subjective = parseSubjectiveDocument(form.subjectiveItemsJson);
  const patient = data.patients.find((row) => value(row, "id") === String(form.patientId || ""));
  const coverage = data.coverages.find((row) => value(row, "patientId") === String(form.patientId || "") && value(row, "priority") === "primary") || data.coverages.find((row) => value(row, "patientId") === String(form.patientId || ""));
  const patientName = String(form.patientName || (patient ? `${value(patient, "firstName")} ${value(patient, "lastName")}`.trim() : "Select patient"));
  const subscriberName = coverage ? `${value(coverage, "subscriberFirstName")} ${value(coverage, "subscriberLastName")}`.trim() : "";
  const sourceName = subjective.source === "patient" ? patientName : subjective.source === "subscriber" ? (subscriberName || "Subscriber not saved") : subjective.sourceDetails;
  const sourceOptions = (data.clinicalOptions || []).filter((row) => value(row, "optionGroup") === "information_source");
  const activeAllergies = activePatientAllergies(data.patientAllergies, String(form.patientId || ""));
  const allergyLabel = activeAllergies.length ? activeAllergies.map((row) => value(row, "allergyType") === "nkda" ? "NKDA" : value(row, "substance")).filter(Boolean).join(", ") : "Not documented";
  const hasSevereAllergy = activeAllergies.some((row) => ["severe", "life_threatening"].includes(value(row, "severity")));
  const hasRecordedAllergy = activeAllergies.some((row) => value(row, "allergyType") !== "nkda");
  function writeSubjective(changes: Partial<SubjectiveDocument>) { update("subjectiveItemsJson", JSON.stringify({ ...subjective, ...changes })); }
  return <div className="clinical-encounter-header-context">
    <div className="clinical-header-patient"><strong>{patientName}</strong><span>{patient && value(patient, "dateOfBirth") ? `DOB ${value(patient, "dateOfBirth")} · ` : ""}{patient && value(patient, "sex") ? `${value(patient, "sex")} · ` : ""}{String(form.providerName || "Provider")} · DOS {String(form.dateOfService || "—")} · {String(form.billingContext || "routine").replaceAll("_", " ")}</span><span className={`clinical-allergy-flag ${hasSevereAllergy || hasRecordedAllergy ? "severe" : activeAllergies.length ? "recorded" : "missing"}`}><b>Allergies</b> {allergyLabel}</span></div>
    <label>Source<select aria-label="Subjective information source" onChange={(event) => writeSubjective({ source: event.target.value, sourceDetails: ["patient", "subscriber"].includes(event.target.value) ? "" : subjective.sourceDetails })} value={subjective.source}>{sourceOptions.map((row) => <option key={value(row, "code")} value={value(row, "value")}>{value(row, "label")}</option>)}</select></label>
    <label>Person / source<input aria-label="Person or source name" onChange={(event) => writeSubjective({ sourceDetails: event.target.value })} readOnly={["patient", "subscriber"].includes(subjective.source)} value={sourceName} /></label>
    <label>Interpreter<select aria-label="Interpreter used" onChange={(event) => writeSubjective({ interpreter: event.target.value })} value={subjective.interpreter}><option value="no">No</option><option value="yes">Yes</option><option value="declined">Declined</option></select></label>
    <Status value={String(form.status || "draft")} />
  </div>;
}

function EncounterForm({ data, form, update, onPatientAllergiesChange, onDocumentationNavChange, onCompletionNavChange, isSaving = false, onSaveOrders, onSign, onReadyToBill, saveNotice = "", onRefresh, onAutosaveDraft }: FormProps & {
  isSaving?: boolean;
  onDocumentationNavChange?: (nav: { label: string; onNext: () => void } | null) => void;
  onCompletionNavChange?: (nav: {
    reviewed: boolean;
    signed: boolean;
    readyToBill: boolean;
    markReviewed: () => void;
  } | null) => void;
  onSaveOrders?: () => Promise<void> | void;
  onSign?: () => Promise<void> | void;
  onReadyToBill?: () => Promise<void> | void;
  saveNotice?: string;
  onRefresh?: () => Promise<void>;
  onAutosaveDraft?: () => Promise<boolean>;
}) {
  const linked = Boolean(form.id);
  const [focusTarget, setFocusTarget] = useState("visit-note-workspace");
  const [visitStep, setVisitStep] = useState<DocumentationFlowStep>("visit");
  const [lastSubjectiveStep, setLastSubjectiveStep] = useState<"visit" | "history" | "safety" | "ros">("visit");
  const skipAutosaveMount = useRef(true);
  const debounceRef = useRef<number | null>(null);

  async function goToVisitStep(step: DocumentationFlowStep) {
    if (linked && onAutosaveDraft && step !== visitStep) {
      await onAutosaveDraft();
    }
    if (step === "visit" || step === "history" || step === "safety" || step === "ros") {
      setLastSubjectiveStep(step);
    }
    setVisitStep(step);
    if (step === "charges") {
      setFocusTarget("visit-billing");
      window.requestAnimationFrame(() => {
        window.setTimeout(() => scrollVisitTarget("visit-coding-tray"), 40);
      });
      return;
    }
    setFocusTarget("visit-note-workspace");
    window.requestAnimationFrame(() => {
      window.setTimeout(() => scrollVisitTarget("visit-note-workspace", { onlyIfNeeded: true }), 40);
    });
  }

  useEffect(() => {
    if (!linked || !onAutosaveDraft) return;
    if (["signed", "ready_to_bill", "billed"].includes(String(form.status || ""))) return;
    if (skipAutosaveMount.current) {
      skipAutosaveMount.current = false;
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void onAutosaveDraft();
    }, 1800);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [form, linked, onAutosaveDraft]);

  useEffect(() => {
    if (!onDocumentationNavChange) return;
    const index = DOCUMENTATION_FLOW_STEPS.findIndex((step) => step.key === visitStep);
    const next = index >= 0 && index < DOCUMENTATION_FLOW_STEPS.length - 1 ? DOCUMENTATION_FLOW_STEPS[index + 1] : null;
    if (!next) {
      onDocumentationNavChange(null);
      return;
    }
    const nextKey = next.key;
    const nextLabel = next.key === "charges" ? "Continue to Charges →" : `Next: ${next.label} →`;
    onDocumentationNavChange({
      label: nextLabel,
      onNext: () => { void goToVisitStep(nextKey); },
    });
  }, [visitStep, onDocumentationNavChange]);

  useEffect(() => () => onDocumentationNavChange?.(null), [onDocumentationNavChange]);

  function focusPanel(target: string, soap?: "subjective" | "objective" | "assessment" | "plan") {
    if (target === "visit-allergies") {
      goToVisitStep("safety");
      setFocusTarget("visit-allergies");
      return;
    }
    if (soap) {
      goToVisitStep(visitStepFromSoapSection(soap, lastSubjectiveStep));
      window.dispatchEvent(new CustomEvent("pracx:open-soap", { detail: soap }));
    }
    if (target === "visit-billing") setVisitStep("charges");
    if (target === "visit-orders" && focusTarget === "visit-orders") {
      setFocusTarget("");
      return;
    }
    const railTargets = new Set([
      "visit-vitals",
      "visit-allergies",
      "visit-medications",
      "visit-problems",
      "visit-recent-visits",
      "visit-results",
      "visit-documents-summary",
    ]);
    setFocusTarget("");
    window.requestAnimationFrame(() => {
      setFocusTarget(target);
      window.setTimeout(() => {
        if (target === "visit-orders") return;
        if (target === "visit-billing") {
          scrollVisitTarget("visit-coding-tray");
          return;
        }
        if (target === "visit-note-preview") {
          scrollVisitTarget("visit-note-preview");
          return;
        }
        if (target === "visit-note-workspace" || target === "visit-templates") {
          scrollVisitTarget(target === "visit-templates" ? "visit-templates" : "visit-note-workspace", { onlyIfNeeded: true });
          return;
        }
        if (railTargets.has(target)) {
          // Keep SOAP/workspace fixed; left rail scrolls to the card via VisitPatientRail.
          scrollVisitTarget("visit-workspace-grid", { onlyIfNeeded: true });
        }
      }, soap ? 40 : 0);
    });
  }

  return <div className="clinical-encounter-form visit-workspace-form">
    <div className="visit-sticky-chrome">
      <PhysicianEncounterCommandBar data={data} form={form} onFocusTarget={focusPanel} />
      <VisitStoryStrip data={data} form={form} onJump={goToVisitStep} visitStep={visitStep} />
    </div>
    <div className="visit-workspace-scroll">
      <div className="visit-workspace-grid" id="visit-workspace-grid">
        <VisitPatientRail data={data} focusTarget={focusTarget} form={form} update={update} />
        <main className="visit-chart-main" aria-label="Visit chart workspace">
          <fieldset className={`soap-workspace-fieldset visit-note-canvas ${focusTarget === "visit-note-workspace" || focusTarget === "visit-templates" ? "visit-target-flash" : ""}`} id="visit-note-workspace"><legend>SOAP visit note</legend><ClinicalComposer data={data} form={form} lastSubjectiveStep={lastSubjectiveStep} onPatientAllergiesChange={onPatientAllergiesChange} onRefresh={onRefresh} onVisitStepChange={goToVisitStep} update={update} visitStep={visitStep} /></fieldset>
        </main>
        <VisitActionRail data={data} form={form} isSaving={isSaving} onCompletionNavChange={onCompletionNavChange} onSaveOrders={onSaveOrders} openPanel={focusTarget} saveNotice={saveNotice} setOpenPanel={setFocusTarget} update={update} />
      </div>
    </div>
  </div>;
}

function ClinicalResultForm({ form, update }: SimpleFormProps) {
  return <div className="clinical-result-form">
    <section className="clinical-form-banner"><div><span className="eyebrow">Result entry</span><h3>{String(form.orderName || "Clinical order")}</h3><p>{String(form.patientName || "Patient")} · entered locally and held for clinician review</p></div><Status value="pending review" /></section>
    <fieldset><legend>Finding</legend><div className="form-grid">
      <Select label="Result status" name="resultStatus" form={form} update={update} required options={[["preliminary", "Preliminary"], ["final", "Final"], ["corrected", "Corrected"]]} />
      <Select label="Clinical flag" name="abnormalFlag" form={form} update={update} required options={[["unknown", "Not classified"], ["normal", "Normal"], ["abnormal", "Abnormal"], ["critical", "Critical"]]} />
      <Input label="Resulted date and time" name="resultedAt" form={form} update={update} required type="datetime-local" />
      <div className="span-2"><Input label="Result summary" name="summary" form={form} update={update} required placeholder="Concise impression or result summary" /></div>
      <div className="span-2"><TextArea label="Detailed values / narrative" name="resultData" form={form} update={update} rows={7} placeholder="Lab values, imaging impression or referral findings" /></div>
    </div><p className="form-guidance">A final or corrected result completes its order. The result stays visibly pending until a clinician marks it reviewed.</p></fieldset>
  </div>;
}

function MedicationForm({ data, form, update }: FormProps) {
  return <div className="medication-form">
    <section className="clinical-form-banner"><div><span className="eyebrow">Medication reconciliation</span><h3>Add to patient chart</h3><p>This records a medication locally. It does not send an electronic prescription.</p></div><Status value="local only" /></section>
    <fieldset><legend>Medication details</legend><div className="form-grid">
      <Select label="Patient" name="patientId" form={form} update={update} required options={data.patients.map((patient) => [value(patient, "id"), `${value(patient, "firstName")} ${value(patient, "lastName")} · ${value(patient, "medicalRecordNumber")}`])} />
      <Input label="Medication name" name="medicationName" form={form} update={update} required placeholder="Generic or brand name" />
      <Input label="RxNorm code" name="rxNormCode" form={form} update={update} placeholder="Optional normalized code" />
      <Input label="Dose" name="dose" form={form} update={update} placeholder="10 mg" />
      <Select label="Route" name="route" form={form} update={update} options={[["oral", "Oral"], ["topical", "Topical"], ["inhaled", "Inhaled"], ["subcutaneous", "Subcutaneous"], ["intramuscular", "Intramuscular"], ["intravenous", "Intravenous"], ["other", "Other"]]} />
      <Input label="Frequency" name="frequency" form={form} update={update} placeholder="Once daily" />
      <Input label="Start date" name="startDate" form={form} update={update} type="date" />
      <Input label="End date" name="endDate" form={form} update={update} type="date" />
      <div className="span-2"><TextArea label="Directions / notes" name="instructions" form={form} update={update} rows={4} placeholder="Patient directions, indication and reconciliation notes" /></div>
    </div></fieldset>
  </div>;
}

function ClaimForm({ data, form, update }: FormProps) {
  const configured = (category: string, fallback: [string, string][]) => {
    const options = data.claimConfigurationValues
      .filter((row) => value(row, "category") === category && value(row, "status") === "active")
      .map((row) => [value(row, "code"), `${value(row, "code")} · ${value(row, "displayName")}`] as [string, string]);
    return options.length ? options : fallback;
  };
  return <>
    <fieldset><legend>Generate from signed encounter</legend><div className="form-grid"><Select label="Ready encounter" name="encounterId" form={form} update={update} required options={data.encounters.filter((row) => ["ready_to_bill", "signed"].includes(value(row, "status"))).map((row) => [value(row, "id"), `${value(row, "patientName")} · ${value(row, "dateOfService")} · ${list(row.procedureCodes).join(", ")}`])} /></div><p className="form-guidance">PRACX copies demographics, the DOS responsibility snapshot, provider, facility, diagnoses and procedures into the professional claim.</p>{form.encounterId ? (() => { const encounter = data.encounters.find((row) => value(row, "id") === String(form.encounterId || "")); const dx = encounter ? list(encounter.diagnosisCodes) : []; return dx.length ? <p className="form-guidance"><strong>Box 21 diagnoses from encounter:</strong> {dx.join(", ")}</p> : <p className="form-guidance">Selected encounter has no ICD-10 diagnoses. Return to Assessment, pick working diagnoses from the ICD list, then mark Ready to bill again.</p>; })() : null}</fieldset>
    <fieldset><legend>Coverage and condition — Boxes 1, 10 and 11d</legend><div className="form-grid">
      <Select label="Box 1 insurance type" name="insuranceTypeCode" form={form} update={update} required hint="insuranceType" options={configured("insurance_type", [["medicare", "Medicare"], ["medicaid", "Medicaid"], ["tricare", "TRICARE"], ["champva", "CHAMPVA"], ["group", "Group health plan"], ["feca", "FECA"], ["black_lung", "Black Lung"], ["other", "Other"]])} />
      <Select label="Box 11d another health plan?" name="otherPlanIndicator" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Select label="Box 10a employment related?" name="employmentRelated" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Select label="Box 10b auto accident?" name="autoAccidentRelated" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Input label="Box 10b accident state" name="autoAccidentState" form={form} update={update} placeholder="FL" />
      <Select label="Box 10c other accident?" name="otherAccidentRelated" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <div className="span-2"><Input label="Box 10d NUCC condition codes" name="claimConditionCodes" form={form} update={update} placeholder="Separate codes with commas" /></div>
    </div></fieldset>
    <fieldset><legend>Claim-level CMS-1500 details</legend><div className="form-grid">
      <Select label="Box 11b qualifier" name="otherClaimIdQualifier" form={form} update={update} hint="otherClaimId" options={configured("other_claim_id", [["Y4", "Y4 · Agency / property casualty claim number"]])} />
      <Input label="Box 11b other claim ID" name="otherClaimId" form={form} update={update} hint="otherClaimId" />
      <Select label="Box 14 date qualifier" name="conditionDateQualifier" form={form} update={update} hint="currentIllnessDate" options={configured("condition_date", [["431", "431 · Onset of current symptoms or illness"], ["484", "484 · Last menstrual period"]])} />
      <Input label="Box 14 date" name="conditionDate" form={form} update={update} type="date" hint="currentIllnessDate" />
      <Select label="Box 15 other-date qualifier" name="otherDateQualifier" form={form} update={update} hint="otherDate" options={configured("other_date", [
        ["454", "454 · Initial treatment"], ["304", "304 · Latest visit or consultation"], ["453", "453 · Acute manifestation of chronic condition"],
        ["439", "439 · Accident"], ["455", "455 · Last X-ray"], ["471", "471 · Prescription"],
        ["090", "090 · Report start / assumed care"], ["091", "091 · Report end / relinquished care"], ["444", "444 · First visit or consultation"],
      ])} />
      <Input label="Box 15 other date" name="otherDate" form={form} update={update} type="date" hint="otherDate" />
      <Select label="Box 17 provider role" name="referringProviderQualifier" form={form} update={update} hint="referringQualifier" options={configured("provider_role", [["DN", "DN · Referring provider"], ["DK", "DK · Ordering provider"], ["DQ", "DQ · Supervising provider"]])} />
      <Select label="Box 17a other-ID qualifier" name="referringOtherIdQualifier" form={form} update={update} hint="providerOtherId" options={configured("box17a_identifier", [["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial number"], ["N5", "N5 · Plan network ID"], ["SY", "SY · SSN"], ["X5", "X5 · Industrial accident"], ["ZZ", "ZZ · Taxonomy"], ["LU", "LU · Location number (supervising only)"]])} />
      <Input label="Box 17a other provider ID" name="referringOtherId" form={form} update={update} hint="providerOtherId" />
      <Select label="Box 19 information qualifier" name="additionalClaimInfoQualifier" form={form} update={update} hint="providerOtherId" options={configured("box19_information", [
        ["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial number"], ["LU", "LU · Location number"],
        ["N5", "N5 · Plan network ID"], ["X5", "X5 · State industrial accident ID"], ["ZZ", "ZZ · Provider taxonomy"],
        ["ADD", "ADD · Additional information"], ["CER", "CER · Certification narrative"], ["DCP", "DCP · Goals / rehabilitation potential / discharge plan"],
        ["DGN", "DGN · Diagnosis description"], ["TPO", "TPO · Third-party organization notes"],
      ])} />
      <Input label="Box 19 additional claim information" name="additionalClaimInfo" form={form} update={update} hint="providerOtherId" />
      <Input label="Box 16 unable to work from" name="unableToWorkFrom" form={form} update={update} type="date" />
      <Input label="Box 16 unable to work through" name="unableToWorkTo" form={form} update={update} type="date" />
      <Input label="Box 18 hospitalization from" name="hospitalizationFrom" form={form} update={update} type="date" />
      <Input label="Box 18 hospitalization through" name="hospitalizationTo" form={form} update={update} type="date" />
      <Select label="Box 20 outside lab?" name="outsideLabIndicator" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Input label="Box 20 purchased-service charge" name="outsideLabCharges" form={form} update={update} type="number" />
      <Select label="Box 21 ICD indicator" name="icdIndicator" form={form} update={update} required hint="icdIndicator" options={configured("icd_indicator", [["0", "0 · ICD-10-CM"], ["9", "9 · ICD-9-CM"]])} />
      <Select label="Box 22 bill frequency" name="billFrequencyCode" form={form} update={update} hint="billFrequency" options={configured("bill_frequency", [["7", "7 · Replacement of prior claim"], ["8", "8 · Void / cancel prior claim"]])} />
      <Input label="Box 22 original reference number" name="originalReferenceNumber" form={form} update={update} hint="billFrequency" />
      <Input label="Box 23 authorization / referral / CLIA" name="priorAuthorizationNumber" form={form} update={update} />
      <Select label="Box 25 federal tax ID type" name="federalTaxIdType" form={form} update={update} options={[["EIN", "EIN"], ["SSN", "SSN"]]} />
      <Input label="Box 25 federal tax ID" name="federalTaxIdNumber" form={form} update={update} />
      <Select label="Box 32b facility ID qualifier" name="serviceFacilityOtherIdQualifier" form={form} update={update} hint="providerOtherId" options={configured("facility_identifier", [["0B", "0B · State license"], ["G2", "G2 · Commercial number"], ["LU", "LU · Location number"]])} />
      <Input label="Box 32b facility other ID" name="serviceFacilityOtherId" form={form} update={update} hint="providerOtherId" />
      <Select label="Box 33b billing ID qualifier" name="billingProviderOtherIdQualifier" form={form} update={update} hint="providerOtherId" options={configured("billing_identifier", [["0B", "0B · State license"], ["G2", "G2 · Commercial number"], ["ZZ", "ZZ · Provider taxonomy"]])} />
      <Input label="Box 33b billing provider ID" name="billingProviderOtherId" form={form} update={update} hint="providerOtherId" />
    </div></fieldset>
    <fieldset><legend>Service-line details — Box 24</legend><p className="form-guidance">These values apply to generated service lines. Procedure-specific supplemental information is attached to the first line.</p><div className="form-grid">
      <Input label="Box 24B place of service override" name="linePlaceOfService" form={form} update={update} placeholder="Leave blank for procedure default" />
      <Select label="Box 24C emergency?" name="emergencyIndicator" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Input label="Box 24D modifiers" name="lineModifiers" form={form} update={update} placeholder="25, 59" />
      <Input label="Box 24E diagnosis pointers" name="lineDiagnosisPointers" form={form} update={update} placeholder="ABCD" />
      <Input label="Box 24G days / units" name="lineUnits" form={form} update={update} type="number" />
      <Select label="Box 24H EPSDT indicator" name="epsdtIndicator" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Select label="Box 24H EPSDT reason" name="epsdtReasonCode" form={form} update={update} hint="epsdtReason" options={configured("epsdt_reason", [["AV", "AV · Available, not used"], ["S2", "S2 · Under treatment"], ["ST", "ST · New service requested"], ["NU", "NU · Not used"]])} />
      <Select label="Box 24I rendering ID qualifier" name="renderingOtherIdQualifier" form={form} update={update} hint="providerOtherId" options={configured("rendering_identifier", [["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial number"], ["LU", "LU · Location number"], ["ZZ", "ZZ · Provider taxonomy"]])} />
      <Input label="Box 24J rendering other ID" name="renderingOtherId" form={form} update={update} hint="providerOtherId" />
      <Select label="Box 24 shaded qualifier" name="supplementalQualifier" form={form} update={update} hint="supplementalInformation" options={configured("supplemental", [["ZZ", "ZZ · Narrative for unspecified code"], ["N4", "N4 · National Drug Code"], ["DI", "DI · Device identifier"], ["CTR", "CTR · Contract rate"], ["JP", "JP · Tooth number"], ["JO", "JO · Oral-cavity area"]])} />
      <div className="span-2"><Input label="Box 24 shaded supplemental information" name="supplementalInformation" form={form} update={update} hint="supplementalInformation" /></div>
      <Input label="NDC 11-digit code" name="ndcCode" form={form} update={update} />
      <Select label="NDC unit qualifier" name="ndcUnitQualifier" form={form} update={update} options={configured("ndc_unit", [["F2", "F2 · International unit"], ["GR", "GR · Gram"], ["ME", "ME · Milligram"], ["ML", "ML · Milliliter"], ["UN", "UN · Unit"]])} />
      <Input label="NDC quantity" name="ndcQuantity" form={form} update={update} type="number" />
      <Input label="NDC unit price" name="ndcUnitPrice" form={form} update={update} type="number" />
    </div><div className="checkbox-grid"><Check label="Box 24H Family Planning (Y)" name="familyPlanningIndicator" form={form} update={update} hint="epsdtReason" /></div></fieldset>
    <fieldset><legend>Signatures — Boxes 12, 13 and 31</legend><div className="form-grid">
      <Select label="Box 12 patient signature on file?" name="patientSignatureOnFile" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Input label="Box 12 signature date" name="patientSignatureDate" form={form} update={update} type="date" />
      <Select label="Box 13 insured signature on file?" name="insuredSignatureOnFile" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Select label="Box 31 provider signature on file?" name="providerSignatureOnFile" form={form} update={update} options={[["Y", "Yes"], ["N", "No"]]} />
      <Input label="Box 31 signature date" name="providerSignatureDate" form={form} update={update} type="date" />
    </div></fieldset>
  </>;
}

function PaymentMethodIcon({ kind }: { kind: string }) {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === "Cash" ? <><rect x="2" y="5" width="20" height="14" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M5 9v6m14-6v6" /></> : kind === "Check" ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9h6m-6 4h3m3 2 2 2 4-5" /></> : kind === "EFT" ? <><path d="m3 8 9-5 9 5H3Zm0 13h18M6 11v7m6-7v7m6-7v7" /></> : kind === "Digital Wallet" ? <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18m-6 4h6v4h-6z" /></> : <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M2 9h20M6 15h4" /></>}
  </svg>;
}

function PaymentEntryForm({ data, form, update }: FormProps) {
  const payerType = String(form.payerType || "payer");
  const method = String(form.paymentMethod || "Check");
  const isCard = CARD_METHODS.includes(method);
  const [partyQuery, setPartyQuery] = useState("");
  const [partyResults, setPartyResults] = useState<DataRow[]>([]);
  const [partyMessage, setPartyMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPartyResults([]);
    if (partyQuery.trim().length < 2) { setPartyMessage(""); return; }
    const timer = setTimeout(async () => {
      setPartyMessage("Searching…");
      try {
        const response = await fetch(`/api/payment-party-search?type=${payerType}&q=${encodeURIComponent(partyQuery.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Unable to search. Please retry.");
        const body = await response.json();
        setPartyResults(body.results || []);
        setPartyMessage(body.results?.length ? "" : "No matches found.");
      } catch (error) { if (!controller.signal.aborted) setPartyMessage(error instanceof Error ? error.message : "Unable to search."); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [partyQuery, payerType]);
  const effective = calculatePaymentTotalEffective({
    paymentAmount: String(form.paymentAmount || 0),
    offsetAmount: String(form.offsetAmount || 0),
    refundAmount: String(form.refundAmount || 0),
    incentiveAmount: String(form.incentiveAmount || 0),
    otherAdjustments: String(form.otherAdjustments || 0),
  });
  return (
    <fieldset className="payment-entry-fieldset payment-composer" disabled={Boolean(form.savedPaymentNumber)}>
      <legend>Payment details</legend>
      <div className="payment-compact-grid">
        <div className="payment-party-toggle"><span>Who paid?</span><div role="group" aria-label="Payer type">{[["patient", "Patient"], ["payer", "Insurance"]].map(([type, label]) => <button type="button" aria-pressed={payerType === type} key={type} onClick={() => { update("payerType", type); update("payerId", ""); update("patientId", ""); update("paymentPartyLabel", ""); update("remittanceId", ""); update("encounterId", ""); update("serviceDate", ""); update("paymentPurpose", ""); update("paymentMethod", "Check"); setPartyQuery(""); setPartyResults([]); }}>{label}</button>)}</div></div>
        <div className="field payment-party-search"><label><span>{payerType === "patient" ? "Patient" : "Payer"}</span><input aria-label={payerType === "patient" ? "Search patient by name, Patient ID or Claim ID" : "Search payer by name or Payer ID"} placeholder={payerType === "patient" ? "Name, Patient ID or Claim ID" : "Payer name or Payer ID"} value={String(form.paymentPartyLabel || partyQuery)} onKeyDown={(event) => { if (event.key === "Escape") setPartyResults([]); }} onChange={(event) => { setPartyQuery(event.target.value); update(payerType === "patient" ? "patientId" : "payerId", ""); update("paymentPartyLabel", ""); update("encounterId", ""); update("serviceDate", ""); update("paymentPurpose", ""); }} /></label>
          {partyMessage && <small role="status">{partyMessage}</small>}
          {partyResults.length > 0 && <div className="payment-party-results" aria-label="Search results">{partyResults.map((row) => <button type="button" key={value(row, "id")} onClick={() => { update(payerType === "patient" ? "patientId" : "payerId", value(row, "id")); update("paymentPartyLabel", value(row, "label")); setPartyQuery(""); setPartyResults([]); setPartyMessage(""); }}><strong>{value(row, "label")}</strong><small>{value(row, "identifier")}{value(row, "dateOfBirth") ? ` · DOB ${value(row, "dateOfBirth")}` : ""}</small></button>)}</div>}
        </div>
        <div className="payment-method-picker"><span>How was it paid?</span><div role="group" aria-label="Payment method" className="payment-method-tiles">{[["Cash", "Cash"], ["Credit Card", "Card"], ["Check", "Check"], ["EFT", "Bank transfer"], ["Digital Wallet", "Wallet"]].map(([key, label]) => <button type="button" key={key} aria-pressed={key === "Credit Card" ? isCard : method === key} onClick={() => update("paymentMethod", key)}><PaymentMethodIcon kind={key} /><span>{label}</span><b aria-hidden="true">{(key === "Credit Card" ? isCard : method === key) ? "✓" : ""}</b></button>)}</div><details className="payment-more-methods"><summary>More payment methods{!["Cash", "Credit Card", "Check", "EFT", "Digital Wallet"].includes(method) ? ` · ${method}` : ""}</summary><Select label="Payment method" name="paymentMethod" form={form} update={update} required options={PAYMENT_METHOD_OPTIONS.filter((option) => payerType !== "patient" || !["ERA", "Paper EOB"].includes(option)).map((option) => [option, option])} /></details></div>
        <div className="payment-receipt-meta"><Input label="Payment date" name="paymentDate" form={form} update={update} required type="date" /><Input label="Posting date" name="postingDate" form={form} update={update} required type="date" /><Input label="Receipt / reference" name="referenceNumber" form={form} update={update} placeholder="Optional reference" /></div>
        {payerType === "patient" && String(form.patientId || "") && <div className="payment-visit-map">
          <label className="field"><span>Visit / service date (DOS)</span><select aria-label="Choose visit or DOS" required={form.paymentPurpose !== "advance"} value={String(form.encounterId || "")} onChange={(event) => { const encounter = data.encounters.find((row) => value(row, "id") === event.target.value); update("encounterId", event.target.value); update("serviceDate", value(encounter || {}, "dateOfService").slice(0, 10)); }}><option value="">{form.paymentPurpose === "advance" ? "No visit yet · unapplied advance" : "Select the visit for this payment"}</option>{data.encounters.filter((row) => value(row, "patientId") === String(form.patientId)).sort((a, b) => value(b, "dateOfService").localeCompare(value(a, "dateOfService"))).map((row) => <option key={value(row, "id")} value={value(row, "id")}>{shortDate(value(row, "dateOfService"))} · {value(row, "chiefComplaint") || "Visit"} · {value(row, "status")}</option>)}</select><input type="hidden" name="serviceDate" value={String(form.serviceDate || "")} /></label>
          <label className="field"><span>Payment purpose *</span><select aria-label="Payment purpose" required value={String(form.paymentPurpose || "")} onChange={(event) => update("paymentPurpose", event.target.value)}><option value="">Select purpose</option><option value="copay">Copay</option><option value="deductible">Deductible</option><option value="coinsurance">Coinsurance</option><option value="past_balance">Past balance</option><option value="advance">Advance payment</option></select></label>
          {form.encounterId && <small>Linked to DOS {shortDate(String(form.serviceDate || ""))}. Claim allocation will be limited to this visit’s service date.</small>}
          {form.paymentPurpose === "advance" && !form.encounterId && <small>Will remain unapplied until a visit and claim are available.</small>}
        </div>}
        <div className="payment-amount-strip"><Input label="Amount received ($)" name="paymentAmount" form={form} update={update} required type="number" /><div className="payment-unapplied-summary"><span>Applied <b>$0.00</b></span><span>Unapplied <b>{currency(effective.toFixed(2))}</b></span></div></div>
        {isCard && <div className="payment-card-fields">
          <div className="payment-brand-picker"><span>Card brand</span><div role="group" aria-label="Card brand">{["Visa", "Mastercard", "American Express", "Discover"].map((brand) => <button type="button" key={brand} aria-pressed={form.cardBrand === brand} onClick={() => update("cardBrand", brand)}><strong className={`payment-brand-${brand.split(" ")[0].toLowerCase()}`}>{brand === "American Express" ? "AMEX" : brand === "Mastercard" ? <><i aria-hidden="true" className="payment-mastercard-mark" />Mastercard</> : brand}</strong>{form.cardBrand === brand && <b aria-hidden="true">✓</b>}</button>)}</div></div>
          <Select label="Card type" name="paymentMethod" form={form} update={update} options={CARD_METHODS.map((option) => [option, option])} />
          <Select label="All card brands" name="cardBrand" form={form} update={update} required options={CARD_BRANDS.map((brand) => [brand, brand])} />
          <Input label="Card last 4 digits" name="cardLast4" form={form} update={update} placeholder="1234" />
          <Input label="Authorization code" name="authorizationCode" form={form} update={update} />
          <Input label="Processor / terminal" name="processor" form={form} update={update} placeholder="Processor or terminal name" />
        </div>}
        {method === "Digital Wallet" && <Select label="Wallet" name="walletProvider" form={form} update={update} options={["Apple Pay", "Google Pay", "Samsung Pay", "PayPal", "Venmo", "Other"].map((wallet) => [wallet, wallet])} />}
        {["Check", "Cashier's Check", "Money Order", "EFT", "ACH", "Wire Transfer"].includes(method) && <Input label="Bank / issuer name" name="bankName" form={form} update={update} />}
        {method === "Online Payment" && <Input label="Payment portal / processor" name="processor" form={form} update={update} />}
        {method === "Other" && <Input label="Payment method description" name="otherMethod" form={form} update={update} required />}
        {payerType !== "patient" && <Select label="ERA (optional)" name="remittanceId" form={form} update={update} options={data.remittances.filter((row) => value(row, "status") !== "posted").map((row) => [value(row, "id"), `${value(row, "traceNumber")} · ${currency(value(row, "amount"))}`])} />}
        <details className="payment-adjustments"><summary>Adjustments <small>Offsets, refunds &amp; other amounts</small></summary><div className="payment-compact-grid"><Input label="Offset" name="offsetAmount" form={form} update={update} type="number" />
        <Input label="Refund" name="refundAmount" form={form} update={update} type="number" />
        <Input label="Incentive" name="incentiveAmount" form={form} update={update} type="number" />
        <Input label="Other adj." name="otherAdjustments" form={form} update={update} type="number" />
        </div></details>
        <div className="payment-entry-notes"><Input label="Notes" name="notes" form={form} update={update} placeholder="Deposit / lockbox notes" /></div>
      </div>
      {isCard && <p className="form-guidance">Record the receipt details only. Full card numbers and CVV are not collected. This entry records a payment; it does not charge a card.</p>}
      <div className="payment-composer-total" role="status"><span>{form.savedPaymentNumber ? "✓ Payment created" : "Payment total"}<small>{form.savedPaymentNumber ? `Payment ID: ${String(form.savedPaymentNumber)}` : `${method} · ${String(form.paymentPartyLabel || "Select a payer or patient")}`}</small></span><strong>{currency(effective.toFixed(2))}</strong></div>
    </fieldset>
  );
}

function EraForm({ data, form, update }: FormProps) {
  return (
    <fieldset className="payment-entry-fieldset">
      <legend>ERA 835</legend>
      <div className="payment-compact-grid">
        <Select label="Payer" name="payerId" form={form} update={update} options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} />
        <Input label="Check / EFT #" name="traceNumber" form={form} update={update} />
        <Input label="Check date" name="paymentDate" form={form} update={update} required type="date" />
        <Input label="Posting date" name="postingDate" form={form} update={update} required type="date" />
        <Input label="Amount" name="amount" form={form} update={update} required type="number" />
        <label className="field span-2"><span>Upload 835 file</span><input accept=".835,.dat,.edi,.txt,text/plain" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; update("fileName", file.name); void file.text().then((text) => { update("raw835", text); const parsed = parseEra835(text); if (!parsed.ok) return; update("amount", parsed.paymentAmount); update("traceNumber", parsed.referenceNumber); update("paymentDate", parsed.paymentDate); }); }} /><small className="address">Selecting a valid ERA fills the amount, check/EFT reference, and check date automatically. All values remain editable.</small></label>
        <div className="span-2"><Input label="Or paste 835 content" name="raw835" form={form} update={update} placeholder="Paste test 835 when no file is available" /></div>
      </div>
    </fieldset>
  );
}

function PayerForm({ form, update }: SimpleFormProps) {
  return <fieldset><legend>Payer routing</legend><div className="form-grid"><Input label="Payer name" name="name" form={form} update={update} required hint="planName" /><Input label="Claim payer ID" name="payerId" form={form} update={update} required /><Input label="Eligibility payer ID" name="eligibilityPayerId" form={form} update={update} /><Input label="Claim filing indicator" name="claimFilingIndicator" form={form} update={update} required /><Input label="Payer type" name="payerType" form={form} update={update} /><Input label="Response days" name="responseDays" form={form} update={update} type="number" /><Input label="Clearinghouse route" name="clearinghouseRoute" form={form} update={update} /><Input label="Phone" name="phone" form={form} update={update} /><Input label="Fax" name="fax" form={form} update={update} /></div><p className="form-guidance">Response days is how long to wait after a claim is sent before it appears in Collection Arena. Default is 12.</p></fieldset>;
}

function PlanForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Insurance plan</legend><div className="form-grid"><Select label="Payer" name="payerId" form={form} update={update} required options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Plan name" name="name" form={form} update={update} required hint="planName" /><Input label="Plan type" name="planType" form={form} update={update} /><Input label="Default group" name="defaultGroupNumber" form={form} update={update} hint="groupNumber" /><Input label="Timely filing days" name="timelyFilingDays" form={form} update={update} type="number" /></div><div className="checkbox-grid"><Check label="Referral required" name="requiresReferral" form={form} update={update} /><Check label="Authorization required" name="requiresAuthorization" form={form} update={update} /></div></fieldset>;
}

function FeeForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Contract fee schedule</legend><div className="form-grid"><Input label="Schedule name" name="name" form={form} update={update} required /><Select label="Payer" name="payerId" form={form} update={update} options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Effective date" name="effectiveDate" form={form} update={update} required type="date" /><Select label="Procedure" name="procedureCodeId" form={form} update={update} options={data.procedureCodes.map((row) => [value(row, "id"), `${value(row, "code")} · ${value(row, "description")}`])} /><Input label="Allowed amount" name="allowedAmount" form={form} update={update} type="number" /><Input label="Modifier" name="modifier" form={form} update={update} /></div></fieldset>;
}

function ProcedureForm({ form, update, editing = false }: SimpleFormProps & { editing?: boolean }) {
  const rpm = RPM_CODE_MASTER.find((item) => item.code === String(form.code || ""));
  return <fieldset><legend>{editing ? "Edit procedure & practice charge" : "Procedure charge master"}</legend><div className="form-grid"><Input label="Code" name="code" form={form} update={update} required hint="encounterProcedure" disabled={editing} /><Input label="Description" name="description" form={form} update={update} required /><Select label="Code set" name="codeSet" form={form} update={update} required options={[["CPT", "CPT"], ["HCPCS", "HCPCS"]]} /><Input label={rpm ? "Custom practice charge" : "Default charge"} name="defaultCharge" form={form} update={update} required type="number" hint="chargeAmount" /><Input label="Default place of service" name="defaultPlaceOfService" form={form} update={update} required hint="placeOfService" /></div>{rpm && <p className="form-guidance">2026 Medicare national-average reference: {currency(rpm.medicareReferenceFee)}. This is separate from your custom practice charge and is not a locality-specific payment guarantee.</p>}<div className="checkbox-grid"><Check label="Authorization required" name="requiresAuthorization" form={form} update={update} /></div></fieldset>;
}

function IntegrationForm({ data, form, update }: FormProps) {
  const integrationType = String(form.integrationType || "");
  const fields = credentialFieldsFor(integrationType);
  const goingLive = String(form.mode || "") === "live";

  const saved = (data.integrations.find((row) => value(row, "id") === String(form.id || "")) || {}) as DataRow;
  const savedStatus = ((saved.credentials || []) as DataRow[]);
  const statusFor = (key: string) => savedStatus.find((entry) => value(entry, "key") === key);

  return (
    <>
      <fieldset>
        <legend>Integration adapter</legend>
        <div className="form-grid">
          <Select label="Integration type" name="integrationType" form={form} update={update} required options={[["ehr_fhir", "EHR — FHIR R4 (any certified vendor)"], ["ehr_elation", "Elation EHR (clinical pull + status push)"], ["stedi_edi", "Stedi EDI (837 / 999 / 277CA / 835)"], ["eligibility_270_271", "Eligibility 270/271"], ["era_835", "ERA 835 retrieval"], ["laboratory_results", "Laboratory orders/results"], ["imaging_results", "Imaging orders/results"], ["e_prescribing", "Electronic prescribing"], ["usps_address", "USPS address verification"], ["secure_email", "Secure email"]]} />
          <Input label="Vendor name" name="vendorName" form={form} update={update} required placeholder="Elation, Stedi, or adapter" />
          <Input label="Inbound source system" name="sourceSystem" form={form} update={update} placeholder="elation, athena, ecw" />
          <Select label="Mode" name="mode" form={form} update={update} required options={[["file", "File exchange"], ["test", "Vendor test"], ["live", "Live — credentials required"]]} />
          <Input label="Endpoint" name="endpoint" form={form} update={update} placeholder="SFTP, API or service endpoint" />
        </div>
      </fieldset>

      {fields.length > 0 && (
        <fieldset>
          <legend>Credentials</legend>
          <div className="form-grid">
            {fields.map((field) => {
              const status = statusFor(field.key);
              const isSet = status ? status.isSet === true : false;
              return (
                <Input
                  key={field.key}
                  label={`${field.label}${field.secret && isSet ? ` — stored ••••${value(status || {}, "lastFour")}` : ""}`}
                  name={`cred_${field.key}`}
                  form={form}
                  update={update}
                  required={goingLive && field.required && !isSet}
                  type={field.secret ? "password" : "text"}
                  placeholder={field.secret && isSet ? "Leave blank to keep stored value" : field.placeholder}
                />
              );
            })}
          </div>
          <p className="form-guidance">
            Secrets are encrypted before storage and are never sent back to this screen. Leave a stored secret blank to keep it; type a new value to replace it.
            {goingLive && " Live mode is rejected until every required credential is present."}
          </p>
        </fieldset>
      )}

      <p className="form-guidance">PRACX never activates live transmission from this form alone. Vendor credentials, BAA, endpoint validation and production approval remain required.</p>
    </>
  );
}

function modalTitle(module: OperationsModule, mode: string) {
  if (module === "scheduler" && mode === "quick-patient") return "Register patient & continue booking";
  if (module === "scheduler" && mode === "reschedule") return "Reschedule appointment";
  if (module === "patients" && mode === "documents") return "Patient documents";
  if (module === "patients" && mode === "eligibility-review") return "Review eligibility updates";
  if (module === "patients" && mode === "responsibility") return "Add DOS responsibility profile";
  if (module === "patients" && mode === "close-responsibility") return "Close responsibility period";
  if (module === "patients" && mode === "coverage-order") return "Set default insurance order";
  if (module === "patients" && mode === "coverage") return "Add patient coverage";
  if (module === "patients" && mode === "edit-patient") return "Edit patient";
  if (module === "clinical" && mode === "encounter") return "Visit workspace";
  if (module === "clinical" && mode === "encounter-pick") return "Find patient for visit";
  if (module === "clinical" && mode === "vitals") return "Vitals & intake";
  if (module === "clinical" && mode === "order-result") return "Record clinical result";
  if (module === "clinical" && mode === "medication") return "Add patient medication";
  if (module === "payments" && mode === "era") return "Import ERA 835";
  if (module === "payments") return "New payment entry";
  if (module === "payers" && mode === "plan") return "Add insurance plan";
  if (module === "integrations" && mode === "edit") return "Configure integration";
  if (module === "procedures" && mode === "edit-procedure") return "Edit procedure charge";
  return moduleMeta[module].action;
}
