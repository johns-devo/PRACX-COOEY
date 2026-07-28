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
  error?: string;
};

const moduleMeta: Record<OperationsModule, { title: string; eyebrow: string; description: string; action: string }> = {
  patients: { title: "Patients", eyebrow: "Patient administration", description: "Demographics, guarantor, coverage and claim-ready registration.", action: "Add patient" },
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

function blankForm(module: OperationsModule): Record<string, string | boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (module === "patients") return { sex: "unknown", relationship: "self", priority: "primary", acceptAssignment: true, releaseOfInformation: true, assignmentOfBenefits: true, verifyEligibility: true };
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

  function updateField(name: string, next: string | boolean) {
    setForm((current) => ({ ...current, [name]: next }));
  }

  function continueWithNextCoverage(savedPatientId: string, savedForm: Record<string, string | boolean>) {
    const assigned = new Set(
      (data?.coverages || [])
        .filter((coverage) => value(coverage, "patientId") === savedPatientId && value(coverage, "status") === "active")
        .map((coverage) => value(coverage, "priority")),
    );
    assigned.add(String(savedForm.priority || "unassigned"));
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
      priority: nextOrder,
      relationship: "self",
      subscriberFirstName: firstName,
      subscriberLastName: lastName,
      subscriberDateOfBirth: dateOfBirth,
      subscriberSex: sex,
      effectiveDate: "",
      terminationDate: "",
      verifyEligibility: true,
    });
    setNotice(`Insurance saved. Add the ${nextOrder === "unassigned" ? "next" : nextOrder} policy.`);
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
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitIntent = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const submittedMode = formMode;
    const submittedForm = { ...form };
    const actionName =
      module === "patients" ? formMode === "responsibility" ? "createResponsibilityProfile" : formMode === "close-responsibility" ? "closeResponsibilityProfile" : formMode === "coverage-order" ? "updateCoverageOrder" : formMode === "coverage" ? "createPatientCoverage" : formMode === "edit-patient" ? "updatePatient" : "createPatient"
      : module === "scheduler" ? "createAppointment"
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
      if (module === "patients" && submitIntent === "add-coverage" && ["", "edit-patient", "coverage"].includes(submittedMode)) {
        const savedPatientId = submittedMode === "coverage" ? String(submittedForm.patientId || "") : String(result.id || submittedForm.id || "");
        continueWithNextCoverage(savedPatientId, submittedForm);
        return;
      }
      setModalOpen(false);
      setNotice(
        module === "patients" ? formMode === "responsibility" ? "DOS responsibility profile saved with an audit record."
          : formMode === "close-responsibility" ? "Responsibility period closed without changing historical claims."
          : formMode === "coverage-order" ? "Default primary, secondary and tertiary insurance order updated. Existing DOS profiles and claims were not changed."
          : formMode === "coverage" ? "Additional patient coverage saved."
          : result.eligibility
          ? `Patient ${formMode === "edit-patient" ? "updated" : "saved"} and eligibility verified: ${String((result.eligibility as DataRow).status)} coverage.`
          : result.eligibilityError ? `Patient ${formMode === "edit-patient" ? "updated" : "saved"}. Eligibility requires attention: ${String(result.eligibilityError)}`
          : formMode === "edit-patient" ? "Patient and coverage updated." : "Patient and coverage saved."
        : module === "scheduler" ? "Appointment scheduled."
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

  async function verifyPatientEligibility(patientId: string) {
    const result = await action("checkEligibility", {
      patientId,
      dateOfService: new Date().toISOString().slice(0, 10),
    });
    if (!result) return;
    const details = (result.details || {}) as DataRow;
    setNotice(
      `${value(details, "payerName")} ${value(details, "planName")} verified as ${String(result.status)}. `
      + `Copay ${currency(value(details, "copayAmount"))}; reference ${String(result.referenceNumber)}.`,
    );
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
      effectiveDate: value(coverage || {}, "effectiveDate"),
      terminationDate: value(coverage || {}, "terminationDate"),
      acceptAssignment: value(coverage || {}, "acceptAssignment") !== "no",
      releaseOfInformation: value(coverage || {}, "releaseOfInformation") !== "no",
      assignmentOfBenefits: value(coverage || {}, "assignmentOfBenefits") !== "no",
      verifyEligibility: true,
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function openCloseResponsibility(profile: DataRow) {
    const patient = data?.patients.find((item) => value(item, "id") === value(profile, "patientId"));
    setFormMode("close-responsibility");
    setForm({
      id: value(profile, "id"),
      patientName: `${value(patient || {}, "firstName")} ${value(patient || {}, "lastName")}`,
      profileName: value(profile, "profileName"),
      effectiveFrom: value(profile, "effectiveFrom"),
      effectiveTo: new Date().toISOString().slice(0, 10),
      reason: "",
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
                    return <tr key={value(patient, "id")}><td><PersonCell row={patient} /></td><td className="mono">{value(patient, "accountNumber")}</td><td>{shortDate(value(patient, "dateOfBirth"))}</td><td><Status value={value(latestEligibility || {}, "status") || "not checked"} /></td><td><Status value={value(patient, "status")} /></td><td><div className="row-actions"><button onClick={() => editPatient(patient, coverage)} type="button">Edit</button><button disabled={!coverage || isSaving} onClick={() => verifyPatientEligibility(value(patient, "id"))} type="button">Check eligibility</button></div></td></tr>;
                  })}</tbody></table>
              </TablePanel>
              <TablePanel title="Billing responsibility timeline" description="Primary, secondary, tertiary and guarantor assignments by DOS range and billing context.">
                <table><thead><tr><th>Patient / profile</th><th>DOS range</th><th>Context</th><th>Primary</th><th>Secondary</th><th>Tertiary / final balance</th><th>Guarantor</th><th>Verification</th><th>Billing hold</th><th>Actions</th></tr></thead>
                  <tbody>{data.responsibilityProfiles.map((profile) => {
                    const patient = data.patients.find((item) => value(item, "id") === value(profile, "patientId"));
                    const sources = data.responsibilitySources.filter((source) => value(source, "profileId") === value(profile, "id"));
                    const sourceFor = (role: string) => value(sources.find((source) => value(source, "role") === role) || {}, "sourceName") || "—";
                    const tertiary = sourceFor("tertiary");
                    const finalBalance = sourceFor("final_balance");
                    return <tr key={value(profile, "id")}><td><strong className="location-name">{value(patient || {}, "firstName")} {value(patient || {}, "lastName")}</strong><small className="address">{value(profile, "profileName")} · {value(profile, "status")}</small></td><td><strong className="location-name">{shortDate(value(profile, "effectiveFrom"))}</strong><small className="address">Through {value(profile, "effectiveTo") ? shortDate(value(profile, "effectiveTo")) : "Open"}</small></td><td><span className="context-chip">{value(profile, "billingContext").replaceAll("_", " ")}</span></td><td>{sourceFor("primary")}</td><td>{sourceFor("secondary")}</td><td><strong className="location-name">{tertiary}</strong>{finalBalance !== "—" && <small className="address">Balance → {finalBalance}</small>}</td><td><strong className="location-name">{value(profile, "guarantorName") || "Patient"}</strong><small className="address">{value(profile, "guarantorType").replaceAll("_", " ")}</small></td><td><Status value={value(profile, "verificationStatus")} /></td><td><Status value={value(profile, "patientBillingHold")} /></td><td><button className="table-button" disabled={value(profile, "status") !== "active"} onClick={() => openCloseResponsibility(profile)} type="button">{value(profile, "status") === "active" ? "Close period" : "Closed"}</button></td></tr>;
                  })}</tbody></table>
              </TablePanel>
            </>
          )}

          {data && module === "scheduler" && (
            <>
              <div className="date-strip"><button type="button">‹</button>{["Mon 27", "Tue 28", "Wed 29", "Thu 30", "Fri 31"].map((day, index) => <span className={index === 1 ? "selected" : ""} key={day}>{day}</span>)}<button type="button">›</button></div>
              <SummaryCards cards={[
                ["Today’s appointments", String(data.appointments.filter((row) => value(row, "startAt").startsWith("2026-07-28")).length), "Across all providers"],
                ["Confirmed", String(data.appointments.filter((row) => ["confirmed", "checked_in", "completed"].includes(value(row, "status"))).length), "Ready for care"],
                ["Eligibility ready", String(data.appointments.filter((row) => value(row, "eligibilityStatus") === "eligible").length), "Verified before service"],
                ["Open capacity", "6.5 hrs", "Across configured schedules"],
              ]} />
              <TablePanel title="Appointment flow" description="Schedule, check in and track encounter completion.">
                <table><thead><tr><th>Time</th><th>Patient</th><th>Provider / facility</th><th>Visit</th><th>Eligibility</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>{data.appointments.map((row) => <tr key={value(row, "id")}><td><strong>{shortDate(value(row, "startAt"), true)}</strong></td><td>{value(row, "patientName")}</td><td><strong className="location-name">{value(row, "providerName")}</strong><small className="address">{value(row, "facilityName")}</small></td><td><strong className="location-name">{value(row, "appointmentType")}</strong><small className="address">{value(row, "reason")}</small></td><td><Status value={value(row, "eligibilityStatus")} /></td><td><Status value={value(row, "status")} /></td><td><button className="table-button" onClick={() => action("updateAppointmentStatus", { id: value(row, "id"), status: value(row, "status") === "scheduled" ? "checked_in" : "completed" })} type="button">{value(row, "status") === "scheduled" ? "Check in" : "Complete"}</button></td></tr>)}</tbody></table>
              </TablePanel>
            </>
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
          <section aria-labelledby="operations-modal-title" aria-modal="true" className={`modal provider-modal ${module === "patients" ? "patient-modal" : ""}`} role="dialog">
            <div className="modal-header"><div><span className="eyebrow">{meta.eyebrow}</span><h2 id="operations-modal-title">{modalTitle(module, formMode)}</h2><p>Required fields are marked. Claim-related fields include CMS-1500 guidance.</p></div><button aria-label="Close dialog" className="close-button" onClick={() => setModalOpen(false)} type="button">×</button></div>
            <form onSubmit={submitForm}>
              {module === "patients" && (formMode === "responsibility" ? <ResponsibilityForm data={data} form={form} update={updateField} /> : formMode === "close-responsibility" ? <CloseResponsibilityForm form={form} update={updateField} /> : formMode === "coverage-order" ? <CoverageOrderForm data={data} form={form} update={updateField} /> : formMode === "coverage" ? <CoverageForm data={data} form={form} update={updateField} /> : <PatientForm data={data} form={form} update={updateField} />)}
              {module === "scheduler" && <AppointmentForm data={data} form={form} update={updateField} />}
              {module === "eligibility" && <EligibilityForm data={data} form={form} update={updateField} />}
              {module === "clinical" && <EncounterForm data={data} form={form} update={updateField} />}
              {module === "claims" && (formMode === "reconsideration" ? <ReconsiderationForm form={form} update={updateField} /> : <ClaimForm data={data} form={form} update={updateField} />)}
              {module === "payments" && (formMode === "era" ? <EraForm data={data} form={form} update={updateField} /> : <PaymentForm data={data} form={form} update={updateField} />)}
              {module === "payers" && (formMode === "plan" ? <PlanForm data={data} form={form} update={updateField} /> : <PayerForm form={form} update={updateField} />)}
              {module === "fees" && <FeeForm data={data} form={form} update={updateField} />}
              {module === "procedures" && <ProcedureForm form={form} update={updateField} />}
              {module === "integrations" && <IntegrationForm form={form} update={updateField} />}
              {error && <div className="notice error form-error">{error}</div>}
              <div className="modal-footer"><button className="secondary-button" onClick={() => setModalOpen(false)} type="button">Cancel</button><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving…" : formMode === "responsibility" ? "Save DOS profile" : formMode === "close-responsibility" ? "Close responsibility period" : formMode === "coverage-order" ? "Save default order" : formMode === "coverage" ? "Save coverage" : formMode === "edit-patient" ? "Save changes" : "Save and continue"}</button></div>
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

function PersonCell({ row }: { row: DataRow }) {
  const first = value(row, "firstName");
  const last = value(row, "lastName");
  return <div className="facility-name"><span>{first[0]}{last[0]}</span><div><strong>{first} {value(row, "middleName")} {last}</strong></div></div>;
}

function Status({ value: status }: { value: string }) {
  const tone = ["active", "eligible", "clean", "ready", "paid", "posted", "accepted", "configured", "completed", "yes", "sent"].includes(status) ? "active" : ["error", "errors", "rejected", "denied", "failed", "inactive"].includes(status) ? "danger" : "inactive";
  return <span className={`status-pill ${tone}`}>{status.replaceAll("_", " ") || "—"}</span>;
}

function CodeList({ codes }: { codes: string[] }) {
  return <div className="code-list">{codes.length ? codes.map((code) => <span key={code}>{code}</span>) : "—"}</div>;
}

type FormProps = { data: WorkspaceData; form: Record<string, string | boolean>; update: (name: string, value: string | boolean) => void };
type SimpleFormProps = Omit<FormProps, "data">;

function Input({ label, name, form, update, required, type = "text", hint, placeholder }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; required?: boolean; type?: string; hint?: keyof typeof claimFieldHints; placeholder?: string }) {
  const browserType = type === "date" ? "text" : type;
  return <label className="field">{label} <span>{required && <b>*</b>}{hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</span><input type={browserType} required={required} placeholder={placeholder || (type === "date" ? "YYYY-MM-DD" : undefined)} value={String(form[name] || "")} onChange={(event) => update(name, event.target.value)} /></label>;
}

function Select({ label, name, form, update, options, required, hint }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; options: [string, string][]; required?: boolean; hint?: keyof typeof claimFieldHints }) {
  return <label className="field">{label} <span>{required && <b>*</b>}{hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</span><select required={required} value={String(form[name] || "")} onChange={(event) => update(name, event.target.value)}><option value="">Select</option>{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}

function Check({ label, name, form, update, hint }: { label: string; name: string; form: Record<string, string | boolean>; update: FormProps["update"]; hint?: keyof typeof claimFieldHints }) {
  return <label className="check-card"><input checked={Boolean(form[name])} onChange={(event) => update(name, event.target.checked)} type="checkbox" /><span><strong>{label} {hint && <ClaimFieldHint hint={claimFieldHints[hint]} />}</strong><small>Enabled for this record</small></span></label>;
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
    ["special:pip", "PIP / no-fault carrier"],
    ["special:workers_comp", "Workers’ compensation"],
    ["special:lop", "LOP / legal receivable"],
    ["special:attorney", "Attorney / law firm"],
    ["special:patient", "Patient / self pay"],
    ["special:other", "Other responsible source"],
  ];
  const existingProfiles = data.responsibilityProfiles.filter((profile) => value(profile, "patientId") === patientId);

  return <div className="responsibility-editor">
    <section className="responsibility-intro">
      <div><span className="eyebrow">DOS responsibility</span><h3>{String(form.patientName || "Patient")}</h3><p>Prefilled from the patient’s default insurance order. Change it for this date range and billing context without altering the policy master or existing claims.</p></div>
      <span className="responsibility-count">{existingProfiles.length} existing profile{existingProfiles.length === 1 ? "" : "s"}</span>
    </section>
    {existingProfiles.length > 0 && <div className="responsibility-existing">{existingProfiles.slice(0, 3).map((profile) => <article key={value(profile, "id")}><span>{value(profile, "billingContext").replaceAll("_", " ")}</span><strong>{value(profile, "profileName")}</strong><small>{shortDate(value(profile, "effectiveFrom"))} → {value(profile, "effectiveTo") ? shortDate(value(profile, "effectiveTo")) : "Open"}</small></article>)}</div>}
    <fieldset><legend>Profile and date-of-service range</legend><div className="form-grid responsibility-profile-grid">
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
    <section className="responsibility-intro"><div><span className="eyebrow">Default coordination of benefits</span><h3>{String(form.patientName || "Patient")}</h3><p>Set the normal insurance sequence used when no DOS-specific profile applies. A policy may occupy only one position.</p></div><span className="responsibility-count">{activeCoverages.length} active</span></section>
    <fieldset><legend>Primary, secondary and tertiary defaults</legend><div className="form-grid">
      <Select label="Primary insurance" name="primaryCoverageId" form={form} update={update} options={options} />
      <Select label="Secondary insurance" name="secondaryCoverageId" form={form} update={update} options={options} />
      <Select label="Tertiary insurance" name="tertiaryCoverageId" form={form} update={update} options={options} />
    </div></fieldset>
    <div className="responsibility-rule-note"><strong>DOS protection</strong><span>Use DOS Order when this sequence changes for a date-of-service range. Saving these defaults does not rewrite existing DOS profiles or claims.</span></div>
  </div>;
}

function CoverageForm({ data, form, update }: FormProps) {
  function updatePlan(planId: string) {
    update("planId", planId);
    const selectedPlan = data.plans.find((plan) => value(plan, "id") === planId);
    if (selectedPlan && !form.groupNumber) update("groupNumber", value(selectedPlan, "defaultGroupNumber"));
  }
  const existingCoverages = data.coverages.filter((coverage) => value(coverage, "patientId") === String(form.patientId || ""));
  return <div className="responsibility-editor coverage-editor">
    <section className="responsibility-intro"><div><span className="eyebrow">Additional coverage</span><h3>{String(form.patientName || "Patient")}</h3><p>Add another policy without replacing existing coverage. The DOS responsibility profile determines the working claim order.</p></div><span className="responsibility-count">{existingCoverages.length} existing</span></section>
    {existingCoverages.length > 0 && <div className="responsibility-existing">{existingCoverages.map((coverage) => {
      const plan = data.plans.find((item) => value(item, "id") === value(coverage, "planId"));
      const payer = data.payers.find((item) => value(item, "id") === value(plan || {}, "payerId"));
      return <article key={value(coverage, "id")}><span>{value(coverage, "priority").replaceAll("_", " ")} default</span><strong>{value(payer || {}, "name")} · {value(plan || {}, "name")}</strong><small>{value(coverage, "memberId")} · {value(coverage, "status")}</small></article>;
    })}</div>}
    <fieldset><legend>Policy information</legend><div className="form-grid">
      <label className="field">Insurance plan <span><b>*</b><ClaimFieldHint hint={claimFieldHints.planName} /></span><select required value={String(form.planId || "")} onChange={(event) => updatePlan(event.target.value)}><option value="">Select</option>{data.plans.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label>
      <Input label="Member ID" name="memberId" form={form} update={update} required hint="memberId" />
      <Input label="Group number" name="groupNumber" form={form} update={update} hint="groupNumber" />
      <Select label="Default insurance order" name="priority" form={form} update={update} required options={[["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Tertiary"], ["unassigned", "Unassigned / determine by DOS"]]} />
      <Select label="Relationship" name="relationship" form={form} update={update} required hint="relationship" options={[["self", "Self"], ["spouse", "Spouse"], ["child", "Child"], ["other", "Other"]]} />
      <Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" />
      <Input label="Termination date" name="terminationDate" form={form} update={update} type="date" />
    </div></fieldset>
    <fieldset><legend>Subscriber</legend><div className="form-grid">
      <Input label="Subscriber first name" name="subscriberFirstName" form={form} update={update} required hint="subscriberName" />
      <Input label="Subscriber last name" name="subscriberLastName" form={form} update={update} required hint="subscriberName" />
      <Input label="Subscriber DOB" name="subscriberDateOfBirth" form={form} update={update} type="date" hint="subscriberBirthSex" />
      <Select label="Subscriber sex" name="subscriberSex" form={form} update={update} hint="subscriberBirthSex" options={[["male", "Male"], ["female", "Female"], ["unknown", "Unknown"]]} />
    </div><div className="responsibility-hold"><Check label="Verify this coverage immediately after saving" name="verifyEligibility" form={form} update={update} /></div></fieldset>
    <div className="insurance-save-actions"><div><strong>Need another policy?</strong><span>Save this insurance and continue with the next available order.</span></div><button disabled={!form.planId || !form.memberId} name="submitIntent" type="submit" value="add-coverage">Save & add another insurance →</button></div>
  </div>;
}

function CloseResponsibilityForm({ form, update }: SimpleFormProps) {
  return <div className="responsibility-editor">
    <section className="responsibility-intro"><div><span className="eyebrow">Close DOS range</span><h3>{String(form.profileName || "Responsibility profile")}</h3><p>{String(form.patientName || "Patient")} · Started {shortDate(String(form.effectiveFrom || ""))}. Existing claims keep the responsibility snapshot captured when they were created.</p></div></section>
    <fieldset><legend>Closing information</legend><div className="form-grid">
      <Input label="Effective through" name="effectiveTo" form={form} update={update} required type="date" />
      <Input label="Reason for closing or reordering" name="reason" form={form} update={update} required placeholder="Coverage ended, COB changed, PIP exhausted…" />
    </div></fieldset>
    <div className="responsibility-rule-note"><strong>Historical protection</strong><span>Closing this period prevents it from being selected for future DOS dates. It does not rewrite previously created claims.</span></div>
  </div>;
}

function PatientForm({ data, form, update }: FormProps) {
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
  const initials = `${String(form.firstName || "")[0] || ""}${String(form.lastName || "")[0] || ""}`.toUpperCase() || "PX";

  return (
    <div className="patient-editor">
      <aside className="patient-editor-summary">
        <span className="patient-editor-avatar">{initials}</span>
        <span className="eyebrow">Patient record</span>
        <h3>{form.firstName || form.lastName ? `${String(form.firstName || "")} ${String(form.lastName || "")}` : "New patient"}</h3>
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

        {activeTab === "insurance" && <fieldset className="patient-tab-panel"><legend>Insurance policy</legend><p className="patient-section-copy">Set the normal coordination order here. Use DOS Order from the patient list whenever the order changes for a service-date range.</p><div className="patient-insurance-grid"><label className="field">Insurance plan <span><ClaimFieldHint hint={claimFieldHints.planName} /></span><select value={String(form.planId || "")} onChange={(event) => updatePlan(event.target.value)}><option value="">Select</option>{data.plans.map((row) => <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>)}</select></label><Input label="Member ID" name="memberId" form={form} update={update} hint="memberId" /><Input label="Group number" name="groupNumber" form={form} update={update} hint="groupNumber" /><Select label="Default insurance order" name="priority" form={form} update={update} options={[["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Tertiary"], ["unassigned", "Unassigned / determine by DOS"]]} /><Select label="Relationship" name="relationship" form={form} update={update} hint="relationship" options={[["self", "Self"], ["spouse", "Spouse"], ["child", "Child"], ["other", "Other"]]} /><Input label="Effective date" name="effectiveDate" form={form} update={update} type="date" /><Input label="Termination date" name="terminationDate" form={form} update={update} type="date" /></div><div className="patient-policy-options"><Check label="Accept assignment" name="acceptAssignment" form={form} update={update} hint="acceptAssignment" /><Check label="Release information" name="releaseOfInformation" form={form} update={update} hint="releaseInformation" /><Check label="Assignment of benefits" name="assignmentOfBenefits" form={form} update={update} hint="assignmentBenefits" /></div><div className="insurance-save-actions"><div><strong>Add Secondary or Tertiary insurance</strong><span>Save this patient and current policy, then continue directly to another policy.</span></div><button disabled={!form.planId || !form.memberId} name="submitIntent" type="submit" value="add-coverage">Save & add another insurance →</button></div></fieldset>}

        {activeTab === "subscriber" && <fieldset className="patient-tab-panel"><legend>Subscriber & verification</legend><p className="patient-section-copy">Complete this section when the policyholder differs from the patient.</p><div className="patient-subscriber-grid"><Input label="Subscriber first name" name="subscriberFirstName" form={form} update={update} hint="subscriberName" /><Input label="Subscriber last name" name="subscriberLastName" form={form} update={update} hint="subscriberName" /><Input label="Subscriber DOB" name="subscriberDateOfBirth" form={form} update={update} type="date" hint="subscriberBirthSex" /><Select label="Subscriber sex" name="subscriberSex" form={form} update={update} hint="subscriberBirthSex" options={[["male", "Male"], ["female", "Female"], ["unknown", "Unknown"]]} /><div className="wide"><Input label="Subscriber address" name="subscriberAddressLine1" form={form} update={update} hint="subscriberAddress" /></div><Input label="City" name="subscriberCity" form={form} update={update} hint="subscriberAddress" /><Input label="State" name="subscriberState" form={form} update={update} hint="subscriberAddress" /><Input label="ZIP" name="subscriberPostalCode" form={form} update={update} hint="subscriberAddress" /></div><div className="eligibility-option"><Check label="Verify eligibility immediately after saving" name="verifyEligibility" form={form} update={update} /><p>PRACX sends a 270 inquiry and fills the returned payer, plan, coverage dates and benefit details. Live responses require an active eligibility adapter.</p></div></fieldset>}

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

function AppointmentForm({ data, form, update }: FormProps) {
  return <fieldset><legend>Appointment details</legend><div className="form-grid"><Select label="Patient" name="patientId" form={form} update={update} required options={data.patients.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Select label="Billing context" name="billingContext" form={form} update={update} required options={[["routine", "Routine medical"], ["auto_pip", "Auto accident / PIP"], ["workers_comp", "Workers’ compensation"], ["liability", "Liability case"], ["lop_legal", "LOP / legal"], ["other", "Other"]]} /><Select label="Provider" name="providerId" form={form} update={update} required options={data.providers.map((row) => [value(row, "id"), `${value(row, "firstName")} ${value(row, "lastName")}`])} /><Select label="Facility" name="facilityId" form={form} update={update} required hint="facilityAssignment" options={data.facilities.map((row) => [value(row, "id"), value(row, "name")])} /><Input label="Start" name="startAt" form={form} update={update} required type="datetime-local" /><Input label="Duration minutes" name="duration" form={form} update={update} required type="number" /><Input label="Appointment type" name="appointmentType" form={form} update={update} required /><div className="span-2"><Input label="Reason for visit" name="reason" form={form} update={update} /></div></div></fieldset>;
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
