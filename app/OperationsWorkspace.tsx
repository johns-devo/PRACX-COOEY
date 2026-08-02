"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { LocalUser } from "../lib/auth";
import { claimFieldHints } from "../lib/cms1500";
import { ClaimFieldHint } from "./ClaimFieldHint";

export type OperationsModule =
  | "patients"
  | "scheduler"
  | "eligibility"
  | "clinical"
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
  remittances: DataRow[];
  payments: DataRow[];
  transactions: DataRow[];
  reconsiderations: DataRow[];
  integrations: DataRow[];
  responsibilityProfiles: DataRow[];
  responsibilitySources: DataRow[];
  responsibilityHistory: DataRow[];
  claimResponsibilitySnapshots: DataRow[];
  claimConfigurationValues: DataRow[];
  eligibilityUpdateHistory: DataRow[];
  legalResponsibilities: DataRow[];
  patientDocuments: DataRow[];
  error?: string;
};

const moduleMeta: Record<OperationsModule, { title: string; eyebrow: string; description: string; action: string }> = {
  patients: { title: "Patients", eyebrow: "Patient administration", description: "Demographics, coverage, legal responsibility and claim-ready registration.", action: "Add patient" },
  scheduler: { title: "Scheduler", eyebrow: "Care delivery", description: "Provider schedules, appointment flow and pre-visit readiness.", action: "New appointment" },
  eligibility: { title: "Eligibility", eyebrow: "270 / 271 verification", description: "Automated and on-demand coverage verification before service.", action: "Run verification" },
  clinical: { title: "Clinical & EMR", eyebrow: "Encounter documentation", description: "Signed notes, diagnoses, procedures and billing readiness.", action: "New encounter" },
  claims: { title: "Claims workbench", eyebrow: "Professional billing", description: "CMS-1500 entry, AI-assisted scrubbing, 837P and reconsiderations.", action: "Create claim" },
  payments: { title: "Payments & ERA", eyebrow: "835 and manual posting", description: "Receive, match, review and post insurance or patient payments.", action: "Post payment" },
  reports: { title: "Transaction report", eyebrow: "Reporting center", description: "A complete ledger powering financial and operational reporting.", action: "Export CSV" },
  payers: { title: "Payers & plans", eyebrow: "Practice setup", description: "Payer routing, plan rules and filing requirements.", action: "Add payer" },
  fees: { title: "Fee schedules", eyebrow: "Practice setup", description: "Contracted allowed amounts by payer, code and effective date.", action: "Add schedule" },
  procedures: { title: "Procedure codes", eyebrow: "Practice setup", description: "CPT/HCPCS charge master and authorization rules.", action: "Add procedure" },
  integrations: { title: "Integrations", eyebrow: "Connectivity", description: "Clearinghouse, eligibility, ERA, fax and email connection modes.", action: "Configure" },
};

const navItems = [
  { label: "Dashboard", href: "/dashboard", key: "dashboard" },
  { label: "Patients", href: "/patients", key: "patients" },
  { label: "Scheduler", href: "/scheduler", key: "scheduler" },
  { label: "Eligibility", href: "/eligibility", key: "eligibility" },
  { label: "Clinical", href: "/clinical", key: "clinical" },
  { label: "Claims", href: "/claims", key: "claims" },
  { label: "Payments", href: "/payments", key: "payments" },
  { label: "Reports", href: "/reports", key: "reports" },
];

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
  if (module === "clinical") return { dateOfService: today, billingContext: "routine", readyToBill: true };
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
  if (module === "payments") return { paymentType: "insurance", paymentDate: today, postingDate: today, amount: "0.00", adjustmentAmount: "0.00" };
  if (module === "payers") return { payerType: "Commercial", claimFilingIndicator: "CI" };
  if (module === "fees") return { effectiveDate: today, allowedAmount: "0.00" };
  if (module === "procedures") return { codeSet: "CPT", defaultCharge: "0.00", defaultPlaceOfService: "11" };
  if (module === "integrations") return { integrationType: "clearinghouse", mode: "file", vendorName: "" };
  return {};
}

export function OperationsWorkspace({ currentUser, module }: { currentUser: LocalUser; module: OperationsModule }) {
  const meta = moduleMeta[module];
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [search, setSearch] = useState("");
  const [isModalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState("");
  const [form, setForm] = useState<Record<string, string | boolean>>(blankForm(module));
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [claimIssues, setClaimIssues] = useState<Record<string, DataRow[]>>({});
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [eligibilityReview, setEligibilityReview] = useState<DataRow | null>(null);
  const [schedulerDate, setSchedulerDate] = useState(new Date().toISOString().slice(0, 10));
  const [appointmentDraft, setAppointmentDraft] = useState<Record<string, string | boolean> | null>(null);

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
    setError("");
    setNotice("");
    setModalOpen(true);
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

  function openDocuments(patientId: string, coverageId = "") {
    const patient = data?.patients.find((item) => value(item, "id") === patientId);
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
      if (!response.ok) throw new Error(String(body.error || "Unable to complete action."));
      await loadData();
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete action.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        setModalOpen(false);
        setNotice(`${String(body.count || 1)} patient document${Number(body.count || 1) === 1 ? "" : "s"} saved securely.`);
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
    const actionName =
      module === "patients" ? formMode === "eligibility-review" ? "confirmEligibilityUpdate" : formMode === "responsibility" ? "createResponsibilityProfile" : formMode === "close-responsibility" ? "closeResponsibilityProfile" : formMode === "coverage-order" ? "updateCoverageOrder" : formMode === "coverage" ? ["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) ? "createLegalResponsibility" : "createPatientCoverage" : formMode === "edit-patient" ? "updatePatient" : "createPatient"
      : module === "scheduler" ? formMode === "quick-patient" ? "createPatient" : formMode === "reschedule" ? "rescheduleAppointment" : "createAppointment"
      : module === "eligibility" ? "checkEligibility"
      : module === "clinical" ? "createEncounter"
      : module === "claims" ? formMode === "reconsideration" ? "createReconsideration" : "createClaim"
      : module === "payments" ? formMode === "era" ? "importEra" : "postPayment"
      : module === "payers" ? formMode === "plan" ? "createPlan" : "createPayer"
      : module === "fees" ? "createFeeSchedule"
      : module === "procedures" ? "createProcedure"
      : module === "integrations" ? "updateIntegration"
      : "";
    if (!actionName) return;
    const result = await action(actionName, form);
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
        : module === "clinical" ? "Encounter signed and routed."
        : module === "claims" ? formMode === "reconsideration" ? "Reconsideration package prepared." : "Claim created from encounter."
        : module === "payments" ? formMode === "era" ? "ERA received for matching and review." : "Payment posted to the ledger."
        : module === "integrations" ? "Integration configuration saved in safe mode."
        : "Configuration saved.",
      );
    }
  }

  async function scrubClaim(id: string) {
    const result = await action("scrubClaim", { id });
    if (result) {
      setClaimIssues((current) => ({ ...current, [id]: (result.issues || []) as DataRow[] }));
      setNotice(result.status === "clean" ? "Claim scrub completed: ready for submission." : "Claim scrub found blocking issues.");
    }
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

  async function submitClaim(id: string) {
    const result = await action("submitClaim", { id, mode: "test" });
    if (result) setNotice(`Claim submitted in test mode. Trace ${result.trace}.`);
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

  function download835(remittance: DataRow) {
    const trace = value(remittance, "traceNumber") || "remittance";
    const content = value(remittance, "raw835") || [
      `PRACX ERA 835 FILE REFERENCE`,
      `Trace: ${trace}`,
      `Payer: ${value(remittance, "payerName") || "Unmatched payer"}`,
      `Payment date: ${value(remittance, "paymentDate")}`,
      `Amount: ${value(remittance, "amount")}`,
      `Source: ${value(remittance, "source")}`,
      "Original X12 content is not stored for this remittance.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${trace}.835`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("ERA 835 downloaded.");
  }

  function openEraPosting(remittance: DataRow) {
    const today = new Date().toISOString().slice(0, 10);
    const appliedAmount = (data?.payments || [])
      .filter((payment) => value(payment, "remittanceId") === value(remittance, "id"))
      .reduce((sum, payment) => sum + Number(value(payment, "amount")), 0);
    const unappliedAmount = Math.max(0, Number(value(remittance, "amount")) - appliedAmount);
    setFormMode("");
    setForm({
      paymentType: "insurance",
      remittanceId: value(remittance, "id"),
      payerName: value(remittance, "payerName"),
      amount: unappliedAmount.toFixed(2),
      adjustmentAmount: "0.00",
      referenceNumber: value(remittance, "traceNumber"),
      paymentDate: value(remittance, "paymentDate") || today,
      postingDate: today,
    });
    setError("");
    setModalOpen(true);
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
    if (module === "reports") return exportTransactions();
    if (module === "scheduler") return openAppointment();
    openForm();
  }

  const setupModule = ["payers", "fees", "procedures"].includes(module);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">PX</span><div><strong>PRACX</strong><small>Care operations</small></div></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <Link className={`nav-item ${item.key === module ? "active" : ""}`} href={item.href} key={item.key}>
              <span className="nav-dot" aria-hidden="true" />{item.label}
            </Link>
          ))}
          <p className="nav-label setup-label">Configuration</p>
          <Link className={`nav-item ${setupModule ? "active" : ""}`} href="/setup"><span className="nav-dot" aria-hidden="true" />Practice setup</Link>
          {currentUser.role.toLowerCase() === "administrator" && <Link className="nav-item" href="/setup/claim-configuration"><span className="nav-dot" aria-hidden="true" />Claim configuration</Link>}
          <Link className={`nav-item ${module === "integrations" ? "active" : ""}`} href="/integrations"><span className="nav-dot" aria-hidden="true" />Integrations</Link>
        </nav>
        <div className="sidebar-footer"><span className="avatar">{initials}</span><div className="sidebar-user"><strong>{currentUser.fullName}</strong><small>{currentUser.role}</small></div><button aria-label="Sign out" className="signout-button" onClick={signOut} type="button">↗</button></div>
      </aside>

      <main className="main">
        <header className="topbar operations-topbar">
          <div><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className="top-actions">
            {module === "payments" && <button className="secondary-button" onClick={() => openForm("era")} type="button">Import ERA 835</button>}
            {module === "payers" && <button className="secondary-button" onClick={() => openForm("plan")} type="button">Add plan</button>}
            <button className="primary-button" onClick={primaryAction} type="button"><span aria-hidden="true">{module === "reports" ? "↓" : "＋"}</span>{meta.action}</button>
          </div>
        </header>

        <section className="operations-content">
          {setupModule && (
            <div className="section-tabs" role="tablist" aria-label="Practice setup sections">
              <Link href="/setup" role="tab">Facilities</Link><Link href="/setup/providers" role="tab">Providers</Link><Link href="/setup/referring-providers" role="tab">Referring providers</Link>
              <Link className={module === "payers" ? "selected" : ""} href="/setup/payers" role="tab">Payers & plans</Link>
              <Link className={module === "fees" ? "selected" : ""} href="/setup/fee-schedules" role="tab">Fee schedules</Link>
              <Link className={module === "procedures" ? "selected" : ""} href="/setup/procedure-codes" role="tab">Procedure codes</Link>
              {currentUser.role.toLowerCase() === "administrator" && <Link href="/setup/claim-configuration" role="tab">Claim configuration</Link>}
            </div>
          )}
          {notice && <div className="notice success">{notice}</div>}
          {!isModalOpen && error && <div className="notice error">{error}</div>}
          {!data && !error && <div className="loading-state">Loading PRACX workspace…</div>}

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
                    return <tr className={selectedPatientId === value(patient, "id") ? "selected-patient-row" : ""} key={value(patient, "id")}><td><button className="patient-select-button" onClick={() => setSelectedPatientId(value(patient, "id"))} type="button"><PersonCell row={patient} /></button></td><td className="mono">{value(patient, "accountNumber")}</td><td>{shortDate(value(patient, "dateOfBirth"))}</td><td><Status value={value(latestEligibility || {}, "status") || "not checked"} /></td><td><Status value={value(patient, "status")} /></td><td><div className="row-actions"><button onClick={() => editPatient(patient, coverage)} type="button">Edit</button><button disabled={!coverage || isSaving} onClick={() => verifyPatientEligibility(value(patient, "id"))} type="button">Check eligibility</button></div></td></tr>;
                  })}</tbody></table>
              </TablePanel>
              <SelectedPatientInsurance data={data} patientId={selectedPatientId} isSaving={isSaving} onCheck={verifyPatientEligibility} onDocuments={openDocuments} onEdit={editPatient} />
            </>
          )}

          {data && module === "scheduler" && (
            <SchedulerWorkspace
              action={action}
              data={data}
              isSaving={isSaving}
              onNew={openAppointment}
              onReschedule={rescheduleAppointment}
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

          {data && module === "clinical" && (
            <>
              <SummaryCards cards={[
                ["Encounters", String(data.encounters.length), "Current clinical records"],
                ["Ready to bill", String(data.encounters.filter((row) => value(row, "status") === "ready_to_bill").length), "Signed with charges"],
                ["Draft notes", String(data.encounters.filter((row) => value(row, "status") === "draft").length), "Require provider completion"],
                ["Charge capture", "Connected", "Procedures flow to claims"],
              ]} />
              <TablePanel title="Encounter workspace" description="Clinical documentation and provider-marked procedures.">
                <table><thead><tr><th>Date</th><th>Patient</th><th>Provider</th><th>Chief complaint</th><th>Diagnoses</th><th>Procedures</th><th>Status</th></tr></thead>
                  <tbody>{data.encounters.map((row) => <tr key={value(row, "id")}><td>{shortDate(value(row, "dateOfService"))}</td><td><strong>{value(row, "patientName")}</strong></td><td>{value(row, "providerName")}</td><td>{value(row, "chiefComplaint") || "—"}</td><td><CodeList codes={list(row.diagnosisCodes)} /></td><td><CodeList codes={list(row.procedureCodes)} /></td><td><Status value={value(row, "status")} /></td></tr>)}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "claims" && (
            <>
              <SummaryCards cards={[
                ["Total claims", String(data.claims.length), "Professional claims"],
                ["Ready / clean", String(data.claims.filter((row) => ["ready", "accepted"].includes(value(row, "status")) || value(row, "scrubberStatus") === "clean").length), "Passed claim edits"],
                ["Submitted", String(data.claims.filter((row) => ["submitted", "accepted", "paid"].includes(value(row, "status"))).length), "837P or clearinghouse"],
                ["Claim value", currency(data.claims.reduce((sum, row) => sum + Number(value(row, "totalCharge")), 0)), "Gross submitted charges"],
              ]} />
              <TablePanel title="Claim entry and submission" description="Scrub, interpret edits, download 837P or submit in integration test mode." search={search} setSearch={setSearch}>
                <table><thead><tr><th>Claim / patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>Charge</th><th>Scrubber</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>{filteredClaims.map((row) => <tr key={value(row, "id")}><td><strong className="location-name">{value(row, "claimNumber")}</strong><small className="address">{value(row, "patientName")}</small></td><td>{shortDate(value(row, "dateOfService"))}</td><td>{value(row, "payerName") || "Self pay"}</td><td>{value(row, "providerName")}</td><td>{currency(value(row, "totalCharge"))}</td><td><Status value={value(row, "scrubberStatus")} /></td><td><Status value={value(row, "status")} /></td><td><div className="row-actions"><button onClick={() => scrubClaim(value(row, "id"))} type="button">Scrub</button><button onClick={() => download837(value(row, "id"))} type="button">837</button><button onClick={() => submitClaim(value(row, "id"))} type="button">Submit</button><button onClick={() => { setForm({ claimId: value(row, "id"), method: "fax", reason: "Request reconsideration of denied or underpaid claim." }); setFormMode("reconsideration"); setModalOpen(true); }} type="button">Appeal</button></div></td></tr>)}</tbody></table>
              </TablePanel>
              {Object.entries(claimIssues).map(([claimId, issues]) => <section className="scrubber-panel" key={claimId}><div><span className="eyebrow">AI-assisted interpretation</span><h3>Claim scrubber findings</h3></div>{issues.length ? issues.map((issue, index) => <article key={`${claimId}-${index}`}><Status value={value(issue, "severity")} /><div><strong>CMS-1500 Box {value(issue, "box")} · {value(issue, "field")}</strong><p>{value(issue, "message")} {value(issue, "suggestion")}</p></div></article>) : <p>No blocking issues found.</p>}</section>)}
              <TablePanel title="Reconsiderations" description="Fax, email, portal and mail appeal packages.">
                <table><thead><tr><th>Claim</th><th>Method</th><th>Destination</th><th>Reason</th><th>Package</th><th>Status</th></tr></thead><tbody>{data.reconsiderations.map((row) => <tr key={value(row, "id")}><td className="mono">{value(row, "claimId")}</td><td>{value(row, "method")}</td><td>{value(row, "destination") || "Not configured"}</td><td>{value(row, "reason")}</td><td>{value(row, "attachmentName")}</td><td><Status value={value(row, "status")} /></td></tr>)}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "payments" && (
            <>
              <SummaryCards cards={[
                ["ERA received", String(data.remittances.length), "835 files and retrievals"],
                ["Unposted ERA", String(data.remittances.filter((row) => value(row, "status") !== "posted").length), "Require match and review"],
                ["Insurance posted", currency(data.payments.filter((row) => value(row, "paymentType") === "insurance").reduce((sum, row) => sum + Number(value(row, "amount")), 0)), "Applied to claims"],
                ["Patient posted", currency(data.payments.filter((row) => value(row, "paymentType") === "patient").reduce((sum, row) => sum + Number(value(row, "amount")), 0)), "Manual or portal payments"],
              ]} />
              <TablePanel title="ERA 835 inbox" description="Automatically retrieved or manually imported remittances.">
                <table><thead><tr><th>Trace</th><th>Payer</th><th>Payment date</th><th>Amount</th><th>Source</th><th>Received</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.remittances.map((row) => <tr key={value(row, "id")}><td className="mono">{value(row, "traceNumber")}</td><td>{value(row, "payerName") || "Unmatched payer"}</td><td>{shortDate(value(row, "paymentDate"))}</td><td>{currency(value(row, "amount"))}</td><td>{value(row, "source")}</td><td>{shortDate(value(row, "receivedAt"), true)}</td><td><Status value={value(row, "status")} /></td><td><div className="row-actions"><button onClick={() => download835(row)} type="button">Download</button>{value(row, "status") !== "posted" && <button onClick={() => openEraPosting(row)} type="button">Match & post</button>}</div></td></tr>)}</tbody></table>
              </TablePanel>
              <TablePanel title="Posted payments" description="Insurance, patient and adjustment activity.">
                <table><thead><tr><th>Claim</th><th>Type</th><th>Payer/source</th><th>Payment</th><th>Adjustment</th><th>Payment date</th><th>Posting date</th><th>Reference</th></tr></thead><tbody>{data.payments.map((row) => <tr key={value(row, "id")}><td className="mono">{value(row, "claimId")}</td><td>{value(row, "paymentType")}</td><td>{value(row, "payerName") || "Patient"}</td><td>{currency(value(row, "amount"))}</td><td>{currency(value(row, "adjustmentAmount"))}</td><td>{shortDate(value(row, "paymentDate"))}</td><td>{shortDate(value(row, "postingDate"))}</td><td>{value(row, "referenceNumber")}</td></tr>)}</tbody></table>
              </TablePanel>
            </>
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
                <table><thead><tr><th>Patient / claim</th><th>Transaction</th><th>Source</th><th>Amount</th><th>DOS</th><th>Transaction</th><th>Payment</th><th>Posting</th><th>First billed</th><th>Last billed</th></tr></thead><tbody>{data.transactions.map((row) => <tr key={value(row, "id")}><td><strong className="location-name">{value(row, "patientName")}</strong><small className="address">{value(row, "claimNumber") || "No claim"}</small></td><td><strong className="location-name">{value(row, "transactionType").replaceAll("_", " ")}</strong><small className="address">{value(row, "description")}</small></td><td>{value(row, "source")}</td><td className={Number(value(row, "amount")) < 0 ? "amount-credit" : "amount-charge"}>{currency(value(row, "amount"))}</td><td>{shortDate(value(row, "dateOfService"))}</td><td>{shortDate(value(row, "transactionDate"))}</td><td>{shortDate(value(row, "paymentDate"))}</td><td>{shortDate(value(row, "postingDate"))}</td><td>{shortDate(value(row, "firstBilledDate"))}</td><td>{shortDate(value(row, "lastBilledDate"))}</td></tr>)}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "payers" && (
            <>
              <SummaryCards cards={[["Payers", String(data.payers.length), "Electronic and paper destinations"], ["Plans", String(data.plans.length), "Configured benefit products"], ["Eligibility routes", String(data.payers.filter((row) => value(row, "eligibilityPayerId")).length), "270/271 identifiers"], ["Clearinghouse routes", String(data.payers.filter((row) => value(row, "clearinghouseRoute")).length), "837/835 connections"]]} />
              <TablePanel title="Payers" description="Carrier block, electronic payer IDs and routing."><table><thead><tr><th>Payer</th><th>Claim payer ID</th><th>Eligibility ID</th><th>Filing indicator</th><th>Clearinghouse</th><th>Contact</th><th>Status</th></tr></thead><tbody>{data.payers.map((row) => <tr key={value(row, "id")}><td><strong>{value(row, "name")}</strong></td><td className="mono">{value(row, "payerId")}</td><td className="mono">{value(row, "eligibilityPayerId")}</td><td>{value(row, "claimFilingIndicator")}</td><td>{value(row, "clearinghouseRoute") || "File mode"}</td><td>{value(row, "phone") || "—"}</td><td><Status value={value(row, "status")} /></td></tr>)}</tbody></table></TablePanel>
              <TablePanel title="Insurance plans" description="Coverage rules and timely filing."><table><thead><tr><th>Plan</th><th>Payer</th><th>Type</th><th>Group</th><th>Timely filing</th><th>Referral</th><th>Authorization</th></tr></thead><tbody>{data.plans.map((row) => { const payer = data.payers.find((item) => value(item, "id") === value(row, "payerId")); return <tr key={value(row, "id")}><td><strong>{value(row, "name")}</strong></td><td>{value(payer || {}, "name")}</td><td>{value(row, "planType")}</td><td>{value(row, "defaultGroupNumber") || "Varies"}</td><td>{value(row, "timelyFilingDays")} days</td><td><Status value={value(row, "requiresReferral")} /></td><td><Status value={value(row, "requiresAuthorization")} /></td></tr>; })}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "fees" && (
            <>
              <SummaryCards cards={[["Fee schedules", String(data.feeSchedules.length), "Active contract tables"], ["Contracted codes", String(data.feeScheduleItems.length), "Allowed amount entries"], ["Payers represented", String(new Set(data.feeSchedules.map((row) => value(row, "payerId"))).size), "Contract coverage"], ["Effective controls", "Enabled", "Date-based fee selection"]]} />
              <TablePanel title="Contracted fee schedules" description="Payer allowed amounts used by payment variance analysis."><table><thead><tr><th>Schedule</th><th>Payer</th><th>Effective</th><th>Procedure</th><th>Allowed</th><th>Status</th></tr></thead><tbody>{data.feeSchedules.map((row) => { const payer = data.payers.find((item) => value(item, "id") === value(row, "payerId")); const item = data.feeScheduleItems.find((entry) => value(entry, "feeScheduleId") === value(row, "id")); const procedure = data.procedureCodes.find((entry) => value(entry, "id") === value(item || {}, "procedureCodeId")); return <tr key={value(row, "id")}><td><strong>{value(row, "name")}</strong></td><td>{value(payer || {}, "name") || "Standard"}</td><td>{shortDate(value(row, "effectiveDate"))}</td><td><CodeList codes={procedure ? [value(procedure, "code")] : []} /></td><td>{currency(value(item || {}, "allowedAmount"))}</td><td><Status value={value(row, "status")} /></td></tr>; })}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "procedures" && (
            <>
              <SummaryCards cards={[["Active codes", String(data.procedureCodes.length), "CPT and HCPCS"], ["Average charge", currency(data.procedureCodes.reduce((sum, row) => sum + Number(value(row, "defaultCharge")), 0) / Math.max(1, data.procedureCodes.length)), "Default charge master"], ["Authorization rules", String(data.procedureCodes.filter((row) => value(row, "requiresAuthorization") === "yes").length), "Codes requiring review"], ["Claim mapping", "24D", "CMS-1500 service lines"]]} />
              <TablePanel title="Procedure charge master" description="Codes, charges, place of service and billing controls."><table><thead><tr><th>Code</th><th>Description</th><th>Set</th><th>Default charge</th><th>POS</th><th>Authorization</th><th>Status</th></tr></thead><tbody>{data.procedureCodes.map((row) => <tr key={value(row, "id")}><td><CodeList codes={[value(row, "code")]} /></td><td>{value(row, "description")}</td><td>{value(row, "codeSet")}</td><td>{currency(value(row, "defaultCharge"))}</td><td>{value(row, "defaultPlaceOfService")}</td><td><Status value={value(row, "requiresAuthorization")} /></td><td><Status value={value(row, "status")} /></td></tr>)}</tbody></table></TablePanel>
            </>
          )}

          {data && module === "integrations" && (
            <>
              <div className="integration-warning"><strong>Safe local mode</strong><p>No PHI is transmitted externally. Switch to live only after credentials, BAAs, endpoint testing and production approval.</p></div>
              <section className="integration-grid">{data.integrations.map((row) => <article key={value(row, "id")}><div className="integration-icon">{value(row, "integrationType").includes("era") ? "835" : value(row, "integrationType").includes("eligibility") ? "271" : "837"}</div><div><span className="eyebrow">{value(row, "integrationType").replaceAll("_", " ")}</span><h2>{value(row, "vendorName")}</h2><p>Mode: {value(row, "mode")} · Endpoint: {value(row, "endpoint") || "Not configured"}</p></div><Status value={value(row, "status")} /><button className="secondary-button" onClick={() => setNotice(`${value(row, "integrationType")} remains safely in ${value(row, "mode")} mode.`)} type="button">Review</button></article>)}</section>
              <section className="integration-grid secondary-integrations"><article><div className="integration-icon">FAX</div><div><span className="eyebrow">Reconsiderations</span><h2>Fax adapter</h2><p>Credential required for live delivery; PDF packages are generated locally.</p></div><Status value="needs_credentials" /></article><article><div className="integration-icon">@</div><div><span className="eyebrow">Secure email</span><h2>Email adapter</h2><p>Credential and secure-delivery policy required before activation.</p></div><Status value="needs_credentials" /></article></section>
            </>
          )}
        </section>
      </main>

      {isModalOpen && data && (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="operations-modal-title" aria-modal="true" className={`modal provider-modal ${module === "patients" || formMode === "quick-patient" ? "patient-modal" : ""}`} role="dialog">
            <div className="modal-header"><div><span className="eyebrow">{meta.eyebrow}</span><h2 id="operations-modal-title">{modalTitle(module, formMode)}</h2><p>Required fields are marked. Claim-related fields include CMS-1500 guidance.</p></div><button aria-label="Close dialog" className="close-button" onClick={() => setModalOpen(false)} type="button">×</button></div>
            <form onSubmit={submitForm}>
              {module === "patients" && (formMode === "documents" ? <PatientDocumentsForm data={data} form={form} update={updateField} /> : formMode === "eligibility-review" ? <EligibilityReviewForm review={eligibilityReview} form={form} update={updateField} /> : formMode === "responsibility" ? <ResponsibilityForm data={data} form={form} update={updateField} /> : formMode === "close-responsibility" ? <CloseResponsibilityForm form={form} update={updateField} /> : formMode === "coverage-order" ? <CoverageOrderForm data={data} form={form} update={updateField} /> : formMode === "coverage" ? <CoverageForm data={data} form={form} update={updateField} /> : <PatientForm data={data} form={form} onCardUpload={openDocuments} onPhotoUpload={uploadPatientPhoto} photoSaving={isSaving} update={updateField} />)}
              {module === "scheduler" && (formMode === "quick-patient" ? <PatientForm data={data} form={form} onPhotoUpload={uploadPatientPhoto} photoSaving={isSaving} update={updateField} /> : <AppointmentForm data={data} form={form} onAddPatient={addPatientFromAppointment} update={updateField} reschedule={formMode === "reschedule"} />)}
              {module === "eligibility" && <EligibilityForm data={data} form={form} update={updateField} />}
              {module === "clinical" && <EncounterForm data={data} form={form} update={updateField} />}
              {module === "claims" && (formMode === "reconsideration" ? <ReconsiderationForm form={form} update={updateField} /> : <ClaimForm data={data} form={form} update={updateField} />)}
              {module === "payments" && (formMode === "era" ? <EraForm data={data} form={form} update={updateField} /> : <PaymentForm data={data} form={form} update={updateField} />)}
              {module === "payers" && (formMode === "plan" ? <PlanForm data={data} form={form} update={updateField} /> : <PayerForm form={form} update={updateField} />)}
              {module === "fees" && <FeeForm data={data} form={form} update={updateField} />}
              {module === "procedures" && <ProcedureForm form={form} update={updateField} />}
              {module === "integrations" && <IntegrationForm form={form} update={updateField} />}
              {error && <div className="notice error form-error">{error}</div>}
              <div className="modal-footer">
                <button className="secondary-button" onClick={() => setModalOpen(false)} type="button">Cancel</button>
                {module === "patients" && ["", "edit-patient"].includes(formMode) && <button className="secondary-button schedule-after-save" disabled={isSaving} name="submitIntent" type="submit" value="schedule">Save & schedule</button>}
                <button className="primary-button" disabled={isSaving} type="submit">{isSaving ? (formMode === "documents" ? "Uploading…" : "Saving…") : formMode === "quick-patient" ? "Save patient & continue booking" : formMode === "documents" ? "Upload documents" : formMode === "reschedule" ? "Save new time" : formMode === "eligibility-review" ? "Confirm & apply selected updates" : formMode === "responsibility" ? "Save DOS profile" : formMode === "close-responsibility" ? "Close responsibility period" : formMode === "coverage-order" ? "Save default order" : formMode === "coverage" ? "Save coverage" : formMode === "edit-patient" ? "Save changes" : "Save and continue"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ cards }: { cards: string[][] }) {
  return <section className="stats-grid">{cards.map(([label, metric, description]) => <article key={label}><span>{label}</span><strong className={metric === "Ready" || metric === "Connected" || metric === "Enabled" ? "health-value" : ""}>{metric}</strong><small>{description}</small></article>)}</section>;
}

function TablePanel({ title, description, search, setSearch, children }: { title: string; description: string; search?: string; setSearch?: (value: string) => void; children: React.ReactNode }) {
  return <section className="table-card operations-table"><div className="table-header"><div><h2>{title}</h2><p>{description}</p></div>{setSearch && <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label={`Search ${title}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" value={search} /></label>}</div><div className="table-wrap">{children}</div></section>;
}

function SchedulerWorkspace({ data, selectedDate, setSelectedDate, onNew, onReschedule, action, setNotice, isSaving }: {
  data: WorkspaceData;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onNew: (startAt?: string) => void;
  onReschedule: (appointment: DataRow) => void;
  action: (name: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  setNotice: (notice: string) => void;
  isSaving: boolean;
}) {
  const [view, setView] = useState<"day" | "week">("day");
  const [providerFilter, setProviderFilter] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [appointmentSearch, setAppointmentSearch] = useState("");
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
  const scheduledMinutes = visibleAppointments
    .filter((appointment) => !["cancelled", "no_show"].includes(value(appointment, "status")))
    .reduce((total, appointment) => total + Math.max(0, (new Date(value(appointment, "endAt")).getTime() - new Date(value(appointment, "startAt")).getTime()) / 60_000), 0);
  const capacityHours = Math.max(0, columns.length * (endHour - startHour) - scheduledMinutes / 60);
  const eligibilityReady = visibleAppointments.filter((appointment) => value(appointment, "eligibilityStatus") === "eligible").length;
  const activeAppointments = visibleAppointments.filter((appointment) => !["cancelled", "no_show"].includes(value(appointment, "status")));

  async function changeStatus(appointment: DataRow, status: string) {
    const result = await action("updateAppointmentStatus", { id: value(appointment, "id"), status });
    if (result) setNotice(`${value(appointment, "patientName")} marked ${status.replaceAll("_", " ")}.`);
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
    const height = Math.max(42, ((end.getTime() - start.getTime()) / 3_600_000) * hourHeight);
    return <button className={`scheduler-appointment tone-${columnIndex % 5} status-${value(appointment, "status")}`} key={value(appointment, "id")} onClick={() => onReschedule(appointment)} style={{ height: `${height}px`, top: `${Math.max(0, top)}px` }} type="button"><span>{start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span><strong>{value(appointment, "patientName")}</strong><small>{value(appointment, "appointmentType")} · {value(appointment, "providerName")}</small></button>;
  }

  const rangeLabel = view === "day"
    ? selected.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return <div className="scheduler-workspace">
    <section className="scheduler-metric-grid">
      <article><span className="scheduler-metric-icon mint">PX</span><div><small>Appointments</small><strong>{activeAppointments.length}</strong><p>{visibleAppointments.filter((appointment) => value(appointment, "status") === "completed").length} completed</p></div></article>
      <article><span className="scheduler-metric-icon blue">✓</span><div><small>Eligibility ready</small><strong>{eligibilityReady}</strong><p>{visibleAppointments.length - eligibilityReady} need review</p></div></article>
      <article><span className="scheduler-metric-icon amber">◷</span><div><small>Open capacity</small><strong>{capacityHours.toFixed(1)}h</strong><p>Across visible columns</p></div></article>
      <article><span className="scheduler-metric-icon rose">!</span><div><small>No-show / cancelled</small><strong>{visibleAppointments.filter((appointment) => ["cancelled", "no_show"].includes(value(appointment, "status"))).length}</strong><p>Excluded from capacity</p></div></article>
    </section>

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
              {Array.from({ length: endHour - startHour }, (_, index) => <button aria-label={`Create appointment at ${startHour + index}:00`} className="scheduler-hour-slot" key={index} onClick={() => onNew(`${column.date}T${String(startHour + index).padStart(2, "0")}:00`)} style={{ height: `${hourHeight}px`, top: `${index * hourHeight}px` }} type="button" />)}
              {visibleAppointments.filter((appointment) => view === "day" ? value(appointment, "providerId") === column.id : appointmentDate(appointment) === column.date).map((appointment) => appointmentBlock(appointment, columnIndex))}
            </div>)}
          </div>
        </div>
      </section>

      <aside className="scheduler-agenda">
        <header><div><span className="eyebrow">Front desk flow</span><h3>{selected.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</h3></div><span>{selectedAppointments.length}</span></header>
        <div className="scheduler-agenda-list">{selectedAppointments.length ? selectedAppointments.map((appointment) => {
          const status = value(appointment, "status");
          const start = new Date(value(appointment, "startAt"));
          return <article key={value(appointment, "id")}><div className="agenda-time"><strong>{start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</strong><small>{Math.max(5, Math.round((new Date(value(appointment, "endAt")).getTime() - start.getTime()) / 60_000))} min</small></div><div className="agenda-detail"><div><strong>{value(appointment, "patientName")}</strong><Status value={status} /></div><p>{value(appointment, "appointmentType")} · {value(appointment, "providerName")}</p><small><Status value={value(appointment, "eligibilityStatus")} /> {value(appointment, "facilityName")}</small><div className="agenda-actions"><button onClick={() => onReschedule(appointment)} type="button">Reschedule</button>{value(appointment, "eligibilityStatus") !== "eligible" && <button disabled={isSaving} onClick={() => checkAppointmentEligibility(appointment)} type="button">Eligibility</button>}{status === "scheduled" && <button onClick={() => changeStatus(appointment, "confirmed")} type="button">Confirm</button>}{["scheduled", "confirmed"].includes(status) && <button onClick={() => changeStatus(appointment, "arrived")} type="button">Arrived</button>}{status === "arrived" && <button onClick={() => changeStatus(appointment, "checked_in")} type="button">Check in</button>}{status === "checked_in" && <button onClick={() => changeStatus(appointment, "in_room")} type="button">In room</button>}{status === "in_room" && <button onClick={() => changeStatus(appointment, "completed")} type="button">Complete</button>}{!["completed", "cancelled", "no_show"].includes(status) && <><button className="quiet-danger" onClick={() => changeStatus(appointment, "no_show")} type="button">No show</button><button className="quiet-danger" onClick={() => changeStatus(appointment, "cancelled")} type="button">Cancel</button></>}</div></div></article>;
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
  const documents = data.patientDocuments.filter((item) => value(item, "patientId") === patientId && value(item, "status") === "active");
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
    <div className="patient-document-library"><div className="patient-document-heading"><div><span className="eyebrow">Patient documents</span><h3>Documents attached to this patient</h3></div><button onClick={() => onDocuments(patientId)} type="button">＋ Upload</button></div>{documents.length ? <div className="patient-document-grid">{documents.map((document) => <a href={`/api/patient-documents?id=${encodeURIComponent(value(document, "id"))}`} key={value(document, "id")} rel="noreferrer" target="_blank"><span>{value(document, "contentType") === "application/pdf" ? "PDF" : value(document, "documentSide") === "front" ? "FRONT" : value(document, "documentSide") === "back" ? "BACK" : "FILE"}</span><strong>{value(document, "title")}</strong><small>{DOCUMENT_CATEGORY_LABELS[value(document, "category")] || value(document, "category").replaceAll("_", " ")} · {shortDate(value(document, "createdAt"))}</small></a>)}</div> : <p>No documents have been uploaded for this patient.</p>}</div>
    {history.length > 0 && <div className="eligibility-audit"><strong>Recent eligibility-applied changes</strong>{history.map((item) => <span key={value(item, "id")}>{shortDate(value(item, "createdAt"), true)} · {value(item, "reason")} · {value(item, "changedBy")}</span>)}</div>}
  </section>;
}

function PersonCell({ row }: { row: DataRow }) {
  const first = value(row, "firstName");
  const last = value(row, "lastName");
  return <div className="facility-name"><span>{first[0]}{last[0]}</span><div><strong>{first} {value(row, "middleName")} {last}</strong></div></div>;
}

function Status({ value: status }: { value: string }) {
  const tone = ["active", "eligible", "clean", "ready", "paid", "posted", "accepted", "configured", "confirmed", "arrived", "checked_in", "in_room", "completed", "yes", "sent"].includes(status) ? "active" : ["error", "errors", "rejected", "denied", "failed", "inactive", "cancelled", "no_show"].includes(status) ? "danger" : "inactive";
  return <span className={`status-pill ${tone}`}>{status.replaceAll("_", " ") || "—"}</span>;
}

function CodeList({ codes }: { codes: string[] }) {
  return <div className="code-list">{codes.length ? codes.map((code) => <span key={code}>{code}</span>) : "—"}</div>;
}

type FormProps = { data: WorkspaceData; form: Record<string, string | boolean>; update: (name: string, value: string | boolean) => void };
type SimpleFormProps = Omit<FormProps, "data">;

function Input({ label, name, form, update, required, type = "text", hint, placeholder }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; required?: boolean; type?: string; hint?: keyof typeof claimFieldHints; placeholder?: string }) {
  return <label className="field">{label} <span>{required && <b>*</b>}{hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</span><input autoComplete="off" name={`pracx-${name}`} type={type} required={required} placeholder={placeholder} value={String(form[name] || "")} onChange={(event) => update(name, event.target.value)} /></label>;
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

function CoverageHistoryStrip({ data, patientId, onUploadCards }: { data: WorkspaceData; patientId: string; onUploadCards?: (patientId: string, coverageId: string) => void }) {
  const [viewer, setViewer] = useState<{ coverageId: string; side: "front" | "back" } | null>(null);
  if (!patientId) return null;
  const coverages = data.coverages.filter((coverage) => value(coverage, "patientId") === patientId);
  if (!coverages.length) return <div className="existing-coverage-strip empty"><strong>No existing insurance history</strong><span>This will be the patient’s first coverage episode.</span></div>;
  const selectedCoverage = viewer ? coverages.find((coverage) => value(coverage, "id") === viewer.coverageId) : undefined;
  const selectedDocuments = selectedCoverage ? data.patientDocuments.filter((document) => value(document, "coverageId") === value(selectedCoverage, "id") && value(document, "category") === "insurance_card" && value(document, "status") === "active") : [];
  const selectedDocument = selectedDocuments.find((document) => value(document, "documentSide") === viewer?.side);
  const selectedPlan = selectedCoverage ? data.plans.find((item) => value(item, "id") === value(selectedCoverage, "planId")) : undefined;
  const selectedPayer = selectedPlan ? data.payers.find((item) => value(item, "id") === value(selectedPlan, "payerId")) : undefined;
  const selectedUrl = selectedDocument ? `/api/patient-documents?id=${encodeURIComponent(value(selectedDocument, "id"))}` : "";
  return <><section className="existing-coverage-strip"><div><strong>Insurance cards & coverage history</strong><span>Click a card image to view its front and back. Policy dates and order remain attached to each coverage episode.</span></div><div className="existing-coverage-cards">{coverages.map((coverage) => {
    const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
    const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
    const cardDocuments = data.patientDocuments.filter((document) => value(document, "coverageId") === value(coverage, "id") && value(document, "category") === "insurance_card" && value(document, "status") === "active");
    const front = cardDocuments.find((document) => value(document, "documentSide") === "front");
    const back = cardDocuments.find((document) => value(document, "documentSide") === "back");
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
    </article>;
  })}</div></section>
  {viewer && selectedCoverage && <div className="insurance-card-viewer-backdrop" onClick={() => setViewer(null)} role="presentation"><section aria-label="Insurance card viewer" aria-modal="true" className="insurance-card-viewer" onClick={(event) => event.stopPropagation()} role="dialog">
    <header><div><span>{coveragePeriodState(selectedCoverage)} · {value(selectedCoverage, "priority")}</span><strong>{value(selectedPayer || {}, "name")} · {value(selectedPlan || {}, "name")}</strong><small>Member ID {value(selectedCoverage, "memberId")}</small></div><button aria-label="Close insurance card viewer" onClick={() => setViewer(null)} type="button">×</button></header>
    <div className="insurance-card-side-tabs" role="tablist"><button aria-selected={viewer.side === "front"} className={viewer.side === "front" ? "active" : ""} onClick={() => setViewer({ ...viewer, side: "front" })} role="tab" type="button">Front</button><button aria-selected={viewer.side === "back"} className={viewer.side === "back" ? "active" : ""} onClick={() => setViewer({ ...viewer, side: "back" })} role="tab" type="button">Back</button></div>
    <div className="insurance-card-large-view">{selectedDocument ? value(selectedDocument, "contentType").startsWith("image/") ? <div aria-label={`${viewer.side} insurance card image`} className="insurance-card-large-image" role="img" style={{ backgroundImage: `url(${selectedUrl})` }} /> : <iframe src={selectedUrl} title={`${viewer.side} insurance card PDF`} /> : <div className="insurance-card-missing-side"><span aria-hidden="true">▣</span><strong>{viewer.side === "front" ? "Front" : "Back"} image not uploaded</strong><p>Capture this side from a phone or tablet, or upload it from a desktop.</p>{onUploadCards && <button onClick={() => { setViewer(null); onUploadCards(patientId, value(selectedCoverage, "id")); }} type="button">Upload card images</button>}</div>}</div>
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
    </div></fieldset> : <fieldset><legend>Choose document</legend><label className="document-file-drop"><span>Upload {DOCUMENT_CATEGORY_LABELS[category] || "patient document"}</span><strong>Take a photo or choose a file</strong><small>The file will be available under Patient Documents after upload.</small><input accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" name="document" required type="file" /></label></fieldset>}
    <div className="responsibility-rule-note"><strong>Patient record linkage</strong><span>Insurance cards appear on both the selected policy and the patient document library. Other files remain searchable under the patient and their selected category.</span></div>
  </div>;
}

function PatientForm({ data, form, update, onPhotoUpload, onCardUpload, photoSaving }: FormProps & { onPhotoUpload: (patientId: string, file: File) => Promise<void>; onCardUpload?: (patientId: string, coverageId: string) => void; photoSaving: boolean }) {
  const [activeTab, setActiveTab] = useState<"demographics" | "contact" | "insurance" | "subscriber">("demographics");
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

        {activeTab === "insurance" && <fieldset className="patient-tab-panel"><legend>Coverage & responsibility</legend><CoverageHistoryStrip data={data} onUploadCards={onCardUpload} patientId={String(form.id || "")} /><p className="patient-section-copy">Choose the responsibility type and billing position independently. Every type can be primary, secondary, tertiary, guarantor, final balance or controlled by a DOS profile.</p><div className="patient-insurance-grid"><CoverageTypeSelector form={form} update={update} /><ResponsibilityPositionField form={form} update={update} /></div>{!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <><div className="patient-insurance-grid"><label className="field">Insurance plan <span><ClaimFieldHint hint={claimFieldHints.planName} /></span><select autoComplete="off" name="pracx-insurance-plan" value={String(form.planId || "")} onChange={(event) => updatePlan(event.target.value)}><option value="">Select</option>{data.plans.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label><Input label="Member ID" name="memberId" form={form} update={update} hint="memberId" /><Input label="Group number" name="groupNumber" form={form} update={update} hint="groupNumber" /><Select label="Relationship" name="relationship" form={form} update={update} hint="relationship" options={[["self", "Self"], ["spouse", "Spouse"], ["child", "Child"], ["other", "Other"]]} /><Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" /><Input label="Termination date" name="terminationDate" form={form} update={update} type="date" /></div><div className="patient-policy-options"><Check label="Accept assignment" name="acceptAssignment" form={form} update={update} hint="acceptAssignment" /><Check label="Release information" name="releaseOfInformation" form={form} update={update} hint="releaseInformation" /><Check label="Assignment of benefits" name="assignmentOfBenefits" form={form} update={update} hint="assignmentBenefits" /></div><CoverageTypeFields form={form} update={update} /></>}{["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && <CoverageTypeFields form={form} update={update} />}<div className="insurance-save-actions"><div><strong>Add another coverage source</strong><span>Save this patient and current record, then continue with another policy or legal responsibility.</span></div><button disabled={!["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) && (!form.planId || !form.memberId)} name="submitIntent" type="submit" value="add-coverage">Save & add another →</button></div></fieldset>}

        {activeTab === "subscriber" && <fieldset className="patient-tab-panel"><legend>Subscriber & verification</legend>{["lop", "attorney", "self_pay", "other_responsibility"].includes(String(form.coverageType || "")) ? <p className="patient-section-copy">This responsibility type does not create an insurance subscriber or eligibility inquiry.</p> : <><p className="patient-section-copy">Confirm whether the patient is the policy subscriber. Manual subscriber fields appear only when they are different.</p><SubscriberFields form={form} update={update} /><div className="eligibility-option"><Check label="Verify eligibility immediately after saving" name="verifyEligibility" form={form} update={update} /><p>PRACX sends a 270 inquiry and fills the returned payer, plan, coverage dates and benefit details. Live responses require an active eligibility adapter.</p></div></>}</fieldset>}

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

function AppointmentForm({ data, form, update, onAddPatient, reschedule = false }: FormProps & { onAddPatient: () => void; reschedule?: boolean }) {
  const selectedPatient = data.patients.find((patient) => value(patient, "id") === String(form.patientId || ""));
  const selectedCoverages = selectedPatient ? data.coverages.filter((coverage) => value(coverage, "patientId") === value(selectedPatient, "id") && value(coverage, "status") === "active") : [];
  const latestEligibility = selectedPatient ? data.eligibility.find((item) => value(item, "patientId") === value(selectedPatient, "id")) : undefined;
  const upcomingVisits = selectedPatient ? data.appointments.filter((appointment) => value(appointment, "patientId") === value(selectedPatient, "id") && new Date(value(appointment, "startAt")) >= new Date() && !["cancelled", "no_show"].includes(value(appointment, "status"))).length : 0;
  return <div className="appointment-editor">
    <fieldset><legend>Patient and visit</legend><p className="form-guidance">{reschedule ? `Change the appointment time for ${String(form.patientName || "this patient")}. Saving returns it to scheduled for confirmation.` : "Select the patient, visit type, provider and location. Provider conflicts are checked before saving."}</p><div className="form-grid">
      {reschedule ? <label className="field">Patient <span /><input disabled value={String(form.patientName || "")} /></label> : <div className="appointment-patient-picker"><Select label="Find existing patient" name="patientId" form={form} update={update} required options={data.patients.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")} · DOB ${shortDate(value(row, "dateOfBirth"))} · ${value(row, "accountNumber")}`])} /><button className="appointment-add-patient" onClick={onAddPatient} type="button"><span>＋</span><strong>Patient not found?</strong><small>Create their chart and return to this appointment</small></button></div>}
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

function EncounterForm({ data, form, update }: FormProps) {
  return <><fieldset><legend>Encounter identity</legend><div className="form-grid"><Select label="Patient" name="patientId" form={form} update={update} required options={data.patients.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Select label="Billing context" name="billingContext" form={form} update={update} required options={[["routine", "Routine medical"], ["auto_pip", "Auto accident / PIP"], ["workers_comp", "Workers’ compensation"], ["liability", "Liability case"], ["lop_legal", "LOP / legal"], ["other", "Other"]]} /><Select label="Provider" name="providerId" form={form} update={update} required options={data.providers.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Select label="Facility" name="facilityId" form={form} update={update} required hint="facilityAssignment" options={data.facilities.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Date of service" name="dateOfService" form={form} update={update} required type="date" hint="dateOfService" /><Select label="Referring provider" name="referringProviderId" form={form} update={update} hint="referringName" options={data.referringProviders.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Input label="Chief complaint" name="chiefComplaint" form={form} update={update} /></div></fieldset><fieldset><legend>Documentation & charge capture</legend><div className="form-grid"><div className="span-2"><Input label="Clinical note" name="clinicalNote" form={form} update={update} /></div><Input label="Diagnosis codes" name="diagnosisCodes" form={form} update={update} required hint="encounterDiagnosis" placeholder="I10, E11.9" /><Input label="Procedure codes" name="procedureCodes" form={form} update={update} required hint="encounterProcedure" placeholder="99213, 93000" /></div><div className="checkbox-grid"><Check label="Sign and mark ready to bill" name="readyToBill" form={form} update={update} /></div></fieldset></>;
}

function ClaimForm({ data, form, update }: FormProps) {
  const configured = (category: string, fallback: [string, string][]) => {
    const options = data.claimConfigurationValues
      .filter((row) => value(row, "category") === category && value(row, "status") === "active")
      .map((row) => [value(row, "code"), `${value(row, "code")} · ${value(row, "displayName")}`] as [string, string]);
    return options.length ? options : fallback;
  };
  return <>
    <fieldset><legend>Generate from signed encounter</legend><div className="form-grid"><Select label="Ready encounter" name="encounterId" form={form} update={update} required options={data.encounters.filter((row) => ["ready_to_bill", "signed"].includes(value(row, "status"))).map((row) => [value(row, "id"), `${value(row, "patientName")} · ${value(row, "dateOfService")} · ${list(row.procedureCodes).join(", ")}`])} /></div><p className="form-guidance">PRACX copies demographics, the DOS responsibility snapshot, provider, facility, diagnoses and procedures into the professional claim.</p></fieldset>
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
      <Select label="Box 17a other-ID qualifier" name="referringOtherIdQualifier" form={form} update={update} hint="providerOtherId" options={configured("box17a_identifier", [["0B", "0B · State license"], ["1G", "1G · UPIN"], ["G2", "G2 · Commercial number"], ["LU", "LU · Location number (supervising only)"]])} />
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

function ReconsiderationForm({ form, update }: SimpleFormProps) {
  return <fieldset><legend>Reconsideration package</legend><div className="form-grid"><Input label="Claim" name="claimId" form={form} update={update} required /><Select label="Delivery method" name="method" form={form} update={update} required options={[["fax", "Fax"], ["email", "Secure email"], ["portal", "Payer portal"], ["mail", "Mail"]]} /><Input label="Destination" name="destination" form={form} update={update} placeholder="Fax number or secure email" /><div className="span-2"><Input label="Reason" name="reason" form={form} update={update} required /></div></div><div className="checkbox-grid"><Check label="Send now when live adapter is available" name="sendNow" form={form} update={update} /></div></fieldset>;
}

function EraForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Receive ERA 835</legend><div className="form-grid"><Select label="Payer" name="payerId" form={form} update={update} options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Trace number" name="traceNumber" form={form} update={update} /><Input label="Payment date" name="paymentDate" form={form} update={update} required type="date" /><Input label="ERA amount" name="amount" form={form} update={update} required type="number" /><div className="span-2"><Input label="835 content or file reference" name="raw835" form={form} update={update} placeholder="Paste test 835 content or filename" /></div></div></fieldset>;
}

function PaymentForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Manual or ERA posting</legend><div className="form-grid"><Select label="Claim" name="claimId" form={form} update={update} required options={data.claims.map((row) => [value(row, "id"), `${value(row, "claimNumber")} · ${value(row, "patientName")} · ${currency(value(row, "totalCharge"))}`])} /><Select label="Payment type" name="paymentType" form={form} update={update} required options={[["insurance", "Insurance"], ["patient", "Patient"]]} /><Select label="ERA to post" name="remittanceId" form={form} update={update} options={data.remittances.filter((row) => value(row, "status") !== "posted").map((row) => [value(row, "id"), `${value(row, "traceNumber")} · ${currency(value(row, "amount"))}`])} /><Input label="Payer/source name" name="payerName" form={form} update={update} /><Input label="Payment amount" name="amount" form={form} update={update} required type="number" hint="amountPaid" /><Input label="Adjustment amount" name="adjustmentAmount" form={form} update={update} type="number" /><Input label="Adjustment reason" name="adjustmentReason" form={form} update={update} placeholder="CO-45 Contractual obligation" /><Input label="Reference number" name="referenceNumber" form={form} update={update} /><Input label="Payment date" name="paymentDate" form={form} update={update} required type="date" /><Input label="Posting date" name="postingDate" form={form} update={update} required type="date" /></div></fieldset>;
}

function PayerForm({ form, update }: SimpleFormProps) {
  return <fieldset><legend>Payer routing</legend><div className="form-grid"><Input label="Payer name" name="name" form={form} update={update} required hint="planName" /><Input label="Claim payer ID" name="payerId" form={form} update={update} required /><Input label="Eligibility payer ID" name="eligibilityPayerId" form={form} update={update} /><Input label="Claim filing indicator" name="claimFilingIndicator" form={form} update={update} required /><Input label="Payer type" name="payerType" form={form} update={update} /><Input label="Clearinghouse route" name="clearinghouseRoute" form={form} update={update} /><Input label="Phone" name="phone" form={form} update={update} /><Input label="Fax" name="fax" form={form} update={update} /></div></fieldset>;
}

function PlanForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Insurance plan</legend><div className="form-grid"><Select label="Payer" name="payerId" form={form} update={update} required options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Plan name" name="name" form={form} update={update} required hint="planName" /><Input label="Plan type" name="planType" form={form} update={update} /><Input label="Default group" name="defaultGroupNumber" form={form} update={update} hint="groupNumber" /><Input label="Timely filing days" name="timelyFilingDays" form={form} update={update} type="number" /></div><div className="checkbox-grid"><Check label="Referral required" name="requiresReferral" form={form} update={update} /><Check label="Authorization required" name="requiresAuthorization" form={form} update={update} /></div></fieldset>;
}

function FeeForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Contract fee schedule</legend><div className="form-grid"><Input label="Schedule name" name="name" form={form} update={update} required /><Select label="Payer" name="payerId" form={form} update={update} options={data.payers.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Effective date" name="effectiveDate" form={form} update={update} required type="date" /><Select label="Procedure" name="procedureCodeId" form={form} update={update} options={data.procedureCodes.map((row) => [value(row, "id"), `${value(row, "code")} · ${value(row, "description")}`])} /><Input label="Allowed amount" name="allowedAmount" form={form} update={update} type="number" /><Input label="Modifier" name="modifier" form={form} update={update} /></div></fieldset>;
}

function ProcedureForm({ form, update }: SimpleFormProps) {
  return <fieldset><legend>Procedure charge master</legend><div className="form-grid"><Input label="Code" name="code" form={form} update={update} required hint="encounterProcedure" /><Input label="Description" name="description" form={form} update={update} required /><Select label="Code set" name="codeSet" form={form} update={update} required options={[["CPT", "CPT"], ["HCPCS", "HCPCS"]]} /><Input label="Default charge" name="defaultCharge" form={form} update={update} required type="number" hint="chargeAmount" /><Input label="Default place of service" name="defaultPlaceOfService" form={form} update={update} required hint="placeOfService" /></div><div className="checkbox-grid"><Check label="Authorization required" name="requiresAuthorization" form={form} update={update} /></div></fieldset>;
}

function IntegrationForm({ form, update }: SimpleFormProps) {
  return <fieldset><legend>Integration adapter</legend><div className="form-grid"><Select label="Integration type" name="integrationType" form={form} update={update} required options={[["clearinghouse", "Clearinghouse 837/999/277CA"], ["eligibility_270_271", "Eligibility 270/271"], ["era_835", "ERA 835 retrieval"], ["usps_address", "USPS address verification"], ["reconsideration_fax", "Reconsideration fax"], ["secure_email", "Secure email"]]} /><Input label="Vendor name" name="vendorName" form={form} update={update} required placeholder="Vendor or file workflow" /><Select label="Mode" name="mode" form={form} update={update} required options={[["file", "File exchange"], ["test", "Vendor test"], ["live", "Live — credentials required"]]} /><Input label="Endpoint" name="endpoint" form={form} update={update} placeholder="SFTP, API or service endpoint" /></div><p className="form-guidance">PRACX never activates live transmission from this form alone. Vendor credentials, BAA, endpoint validation and production approval remain required.</p></fieldset>;
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
  if (module === "payments" && mode === "era") return "Import ERA 835";
  if (module === "payers" && mode === "plan") return "Add insurance plan";
  if (module === "claims" && mode === "reconsideration") return "Create reconsideration";
  return moduleMeta[module].action;
}
