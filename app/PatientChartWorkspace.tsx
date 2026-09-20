"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalUser } from "../lib/auth";
import { CHART_SECTIONS, isChartSectionId, type ChartSectionId } from "../lib/patient-chart";
import {
  AccountPanel,
  AllergiesPanel,
  ChecklistPanel,
  DemographicsPanel,
  FacesheetPanel,
  FlowsheetsPanel,
  HistoryPanel,
  ImmunizationsPanel,
  LabsPanel,
  ListPanel,
  ProblemsPanel,
  RecallPanel,
} from "./PatientChartSections";

type Row = Record<string, unknown>;
type ChartData = {
  patients: Row[]; coverages: Row[]; payers: Row[]; plans: Row[];
  appointments: Row[]; eligibility: Row[]; encounters: Row[]; patientDocuments: Row[];
  clinicalOrders: Row[]; clinicalOrderResults: Row[]; patientMedications: Row[];
  patientAllergies: Row[]; patientProblems: Row[]; patientHistoryItems: Row[];
  patientImmunizations: Row[]; patientFlowsheetEntries: Row[]; patientCareChecklistItems: Row[];
  patientRecalls: Row[]; diagnosisCodes: Row[]; claims: Row[]; payments: Row[]; transactions: Row[];
};

const get = (row: Row | undefined, key: string) => String(row?.[key] ?? "");
const parseList = (input: unknown) => {
  try {
    const value = JSON.parse(String(input || "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};
const formatDate = (input: unknown, withTime = false) => {
  if (!input) return "—";
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
};
const age = (dob: string) => {
  const birth = new Date(dob);
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) years -= 1;
  return Number.isFinite(years) ? years : 0;
};
function parseVitals(raw: unknown) {
  try { return JSON.parse(String(raw || "{}")) as Record<string, string>; }
  catch { return {}; }
}

export function PatientChartWorkspace({ currentUser }: { currentUser: LocalUser }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [patientId, setPatientId] = useState("");
  const [section, setSection] = useState<ChartSectionId>("facesheet");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/operations");
    const body = await response.json() as ChartData & { error?: string };
    if (!response.ok) throw new Error(body.error || "Unable to load chart.");
    setData(body);
    const params = new URLSearchParams(window.location.search);
    const requestedPatient = params.get("patientId") || "";
    const requestedSection = params.get("section") || "";
    setPatientId(requestedPatient && body.patients.some((row) => get(row, "id") === requestedPatient)
      ? requestedPatient
      : get(body.patients[0], "id"));
    if (isChartSectionId(requestedSection)) setSection(requestedSection);
  }, []);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load chart."));
  }, [load]);

  const patient = data?.patients.find((row) => get(row, "id") === patientId);
  const forPatient = <T extends Row>(rows: T[] | undefined) => (rows || []).filter((row) => get(row, "patientId") === patientId);

  const encounters = useMemo(() => forPatient(data?.encounters).sort((a, b) =>
    `${get(b, "dateOfService")} ${get(b, "lastSavedAt")}`.localeCompare(`${get(a, "dateOfService")} ${get(a, "lastSavedAt")}`)), [data, patientId]);
  const appointments = useMemo(() => forPatient(data?.appointments), [data, patientId]);
  const orders = useMemo(() => forPatient(data?.clinicalOrders), [data, patientId]);
  const results = useMemo(() => forPatient(data?.clinicalOrderResults), [data, patientId]);
  const medications = useMemo(() => forPatient(data?.patientMedications), [data, patientId]);
  const allergies = useMemo(() => forPatient(data?.patientAllergies), [data, patientId]);
  const problems = useMemo(() => forPatient(data?.patientProblems), [data, patientId]);
  const historyItems = useMemo(() => forPatient(data?.patientHistoryItems), [data, patientId]);
  const immunizations = useMemo(() => forPatient(data?.patientImmunizations), [data, patientId]);
  const flowsheet = useMemo(() => forPatient(data?.patientFlowsheetEntries), [data, patientId]);
  const checklist = useMemo(() => forPatient(data?.patientCareChecklistItems), [data, patientId]);
  const recalls = useMemo(() => forPatient(data?.patientRecalls), [data, patientId]);
  const documents = useMemo(() => forPatient(data?.patientDocuments).filter((row) => get(row, "status") === "active"), [data, patientId]);
  const coverages = useMemo(() => forPatient(data?.coverages), [data, patientId]);
  const claims = useMemo(() => forPatient(data?.claims), [data, patientId]);
  const claimIds = useMemo(() => new Set(claims.map((row) => get(row, "id"))), [claims]);
  const payments = useMemo(
    () => (data?.payments || []).filter((row) => claimIds.has(get(row, "claimId"))),
    [data, claimIds],
  );
  const transactions = useMemo(() => forPatient(data?.transactions), [data, patientId]);
  const eligibility = useMemo(() => forPatient(data?.eligibility), [data, patientId]);

  const codedProblems = useMemo(() => {
    const fromEncounters = Array.from(new Set(encounters.flatMap((row) => parseList(row.diagnosisCodes))));
    return fromEncounters.map((code) => {
      const master = data?.diagnosisCodes.find((row) => get(row, "code") === code);
      return { code, description: get(master, "description") || "Clinical diagnosis" };
    });
  }, [encounters, data]);

  const vitalsHistory = useMemo(() => encounters.flatMap((row) => {
    const vitals = parseVitals(row.vitals);
    const keys = ["systolic", "diastolic", "pulse", "temperature", "weight", "height", "bmi", "oxygenSaturation", "respiratoryRate", "painScore"] as const;
    return keys.filter((key) => vitals[key]).map((key) => ({
      id: `${get(row, "id")}-${key}`,
      date: get(row, "dateOfService"),
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      value: vitals[key],
      source: "Visit vitals",
    }));
  }), [encounters]);

  const activeCoverage = coverages.find((row) => get(row, "status") === "active") || coverages[0];
  const activePlan = data?.plans.find((row) => get(row, "id") === get(activeCoverage, "planId"));
  const activePayer = data?.payers.find((row) => get(row, "id") === get(activePlan, "payerId"));
  const photo = documents.find((row) => get(row, "category") === "patient_photo");
  const upcoming = appointments.filter((row) => new Date(get(row, "startAt")) >= new Date()).sort((a, b) => get(a, "startAt").localeCompare(get(b, "startAt")))[0];
  const activeEncounter = encounters.find((row) => get(row, "status") === "draft") || encounters[0];
  const chartReturnPath = `/chart?patientId=${encodeURIComponent(patientId)}&section=${section}`;
  const visitNoteHref = (appointmentId: string) =>
    `/clinical${appointmentId ? `?appointmentId=${encodeURIComponent(appointmentId)}&returnTo=${encodeURIComponent(chartReturnPath)}` : `?returnTo=${encodeURIComponent(chartReturnPath)}`}`;
  const clinicalEditorHref = visitNoteHref(get(activeEncounter, "appointmentId"));

  function choosePatient(nextId: string) {
    setPatientId(nextId);
    setSection("facesheet");
    window.history.replaceState({}, "", `/chart?patientId=${encodeURIComponent(nextId)}&section=facesheet`);
  }

  function chooseSection(next: ChartSectionId) {
    setSection(next);
    window.history.replaceState({}, "", `/chart?patientId=${encodeURIComponent(patientId)}&section=${next}`);
  }

  async function chartAction(action: string, payload: Row, success: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to complete action.");
      setNotice(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete action.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!patientId || section !== "checklist" || checklist.length) return;
    void chartAction("ensurePatientCareChecklist", { patientId }, "Care checklist ready.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, section, checklist.length]);

  if (!data || !patient) {
    return <main className="chart-loading"><strong>PRACX</strong><p>{error || "Opening the patient chart…"}</p></main>;
  }

  const fullName = `${get(patient, "firstName")} ${get(patient, "middleName")} ${get(patient, "lastName")}`.replace(/\s+/g, " ").trim();
  const initials = `${get(patient, "firstName")[0] || ""}${get(patient, "lastName")[0] || ""}`;
  const openRecalls = recalls.filter((row) => get(row, "status") === "open").length;
  const activeAllergyCount = allergies.filter((row) => get(row, "status") === "active" && get(row, "allergyType") !== "nkda").length;

  return (
    <div className="patient-chart-shell chart-industry">
      <header className="chart-global-bar">
        <Link className="chart-brand" href="/dashboard"><span>PX</span><strong>PRACX</strong></Link>
        <nav>
          <Link href="/dashboard">Practice home</Link>
          <Link href="/patients">Find chart</Link>
          <Link href="/scheduler">Scheduler</Link>
          <Link href="/clinical">Clinical queue</Link>
        </nav>
        <div className="chart-user"><span>{currentUser.fullName}</span><Link href="/dashboard">Exit chart</Link></div>
      </header>

      <section className="chart-patient-banner">
        <div className="chart-patient-identity">
          <div className="chart-photo">{photo ? <img alt={fullName} src={`/api/patient-documents?id=${encodeURIComponent(get(photo, "id"))}`} /> : <span>{initials}</span>}</div>
          <div>
            <span className="chart-label">Patient chart</span>
            <h1>{fullName}</h1>
            <p>{formatDate(get(patient, "dateOfBirth"))} · {age(get(patient, "dateOfBirth"))} yr · {get(patient, "sex")} · MRN {get(patient, "accountNumber")}</p>
            <div className="chart-alert-row">
              <span className={`chart-alert ${activeAllergyCount ? "alert" : "good"}`}>{activeAllergyCount ? `${activeAllergyCount} active allerg${activeAllergyCount === 1 ? "y" : "ies"}` : "No active drug allergies"}</span>
              <span className={`chart-alert ${openRecalls ? "waiting" : "good"}`}>{openRecalls ? `${openRecalls} open recall${openRecalls === 1 ? "" : "s"}` : "No open recalls"}</span>
              <span className="chart-alert good">{get(activePayer, "name") || "Self pay"}</span>
            </div>
          </div>
        </div>
        <div className="chart-switcher">
          <label htmlFor="chart-patient-select">Switch patient</label>
          <select id="chart-patient-select" onChange={(event) => choosePatient(event.target.value)} value={patientId}>
            {data.patients.map((row) => <option key={get(row, "id")} value={get(row, "id")}>{get(row, "firstName")} {get(row, "lastName")} · {get(row, "accountNumber")}</option>)}
          </select>
          <Link className="chart-open-note" href={clinicalEditorHref}>Open visit note</Link>
        </div>
      </section>

      {notice && <div className="chart-notice">{notice}</div>}
      {error && <div className="chart-notice error">{error}</div>}

      <div className="chart-industry-layout">
        <nav aria-label="Patient chart sections" className="chart-left-nav">
          {CHART_SECTIONS.map((item) => (
            <button className={section === item.id ? "active" : ""} key={item.id} onClick={() => chooseSection(item.id)} type="button">
              {item.label}
            </button>
          ))}
        </nav>

        <main className="chart-section-panel" id={`chart-${section}`}>
          {section === "facesheet" && (
            <FacesheetPanel
              allergies={allergies.filter((row) => get(row, "status") === "active")}
              clinicalEditorHref={clinicalEditorHref}
              medications={medications.filter((row) => get(row, "status") === "active")}
              patient={patient}
              payerName={get(activePayer, "name")}
              planName={get(activePlan, "name")}
              problems={[
                ...problems.filter((row) => get(row, "status") === "active"),
                ...codedProblems.map((row) => ({ id: row.code, code: row.code, description: row.description, status: "active" } as Row)),
              ]}
              upcoming={upcoming}
            />
          )}
          {section === "history" && <HistoryPanel busy={busy} items={historyItems} onAdd={(payload) => chartAction("createPatientHistoryItem", { patientId, ...payload }, "History item saved.")} />}
          {section === "problems" && (
            <ProblemsPanel
              busy={busy}
              coded={codedProblems}
              items={problems}
              onAdd={(payload) => chartAction("createPatientProblem", { patientId, ...payload }, "Problem added.")}
              onStatus={(id, status) => chartAction("updatePatientProblemStatus", { id, status }, "Problem updated.")}
            />
          )}
          {section === "medications" && (
            <ListPanel
              action={<Link href={`/clinical?returnTo=${encodeURIComponent(chartReturnPath)}`}>Manage in Clinical</Link>}
              description="Active and historical medication list for this patient."
              empty="No medications recorded."
              rows={medications.map((row) => ({
                id: get(row, "id"),
                title: get(row, "medicationName"),
                meta: [get(row, "dose"), get(row, "route"), get(row, "frequency")].filter(Boolean).join(" · ") || "No sig",
                status: get(row, "status"),
                detail: get(row, "instructions") || (get(row, "rxNormCode") ? `RxNorm ${get(row, "rxNormCode")}` : "Chart medication"),
              }))}
              title="Medications"
            />
          )}
          {section === "immunizations" && <ImmunizationsPanel busy={busy} items={immunizations} onAdd={(payload) => chartAction("createPatientImmunization", { patientId, ...payload }, "Immunization recorded.")} />}
          {section === "allergies" && (
            <AllergiesPanel
              busy={busy}
              items={allergies}
              onAdd={(payload) => chartAction("createPatientAllergy", { patientId, ...payload }, "Allergy recorded.")}
              onReview={() => chartAction("reviewPatientAllergies", { patientId }, "Allergies marked reviewed.")}
              onStatus={(id, status) => chartAction("updatePatientAllergyStatus", { id, status }, "Allergy updated.")}
            />
          )}
          {section === "vitals" && (
            <ListPanel
              description="Visit vitals captured across encounters."
              empty="No vitals recorded yet."
              rows={vitalsHistory.map((row) => ({
                id: row.id,
                title: `${row.label}: ${row.value}`,
                meta: formatDate(row.date),
                status: row.source,
                detail: "From encounter vitals",
              }))}
              title="Vitals"
            />
          )}
          {section === "notes" && (
            <ListPanel
              action={<Link href={clinicalEditorHref}>Open visit note</Link>}
              description="Encounter documentation timeline."
              empty="No visit notes yet."
              rows={encounters.map((row) => ({
                id: get(row, "id"),
                title: get(row, "chiefComplaint") || "Clinical encounter",
                meta: `${formatDate(get(row, "dateOfService"))} · ${get(row, "providerName") || "Provider"}`,
                status: get(row, "status"),
                detail: parseList(row.diagnosisCodes).join(", ") || "No diagnosis codes",
                href: visitNoteHref(get(row, "appointmentId")),
              }))}
              title="Notes"
            />
          )}
          {section === "labs" && <LabsPanel orders={orders} results={results} />}
          {section === "flowsheets" && <FlowsheetsPanel busy={busy} entries={flowsheet} onAdd={(payload) => chartAction("createPatientFlowsheetEntry", { patientId, ...payload }, "Flowsheet entry saved.")} />}
          {section === "demographics" && <DemographicsPanel patient={patient} />}
          {section === "account" && (
            <AccountPanel
              claims={claims}
              coverages={coverages}
              eligibility={eligibility}
              patient={patient}
              payments={payments}
              payerName={get(activePayer, "name")}
              planName={get(activePlan, "name")}
              transactions={transactions}
            />
          )}
          {section === "checklist" && (
            <ChecklistPanel
              busy={busy}
              items={checklist}
              onEnsure={() => chartAction("ensurePatientCareChecklist", { patientId }, "Care checklist ready.")}
              onUpdate={(id, status) => chartAction("updateCareChecklistItem", { id, status }, "Checklist updated.")}
            />
          )}
          {section === "documents" && (
            <ListPanel
              action={<Link href={`/patients?patientId=${encodeURIComponent(patientId)}`}>Upload document</Link>}
              description="Clinical and administrative files on the chart."
              empty="No documents uploaded."
              rows={documents.filter((row) => get(row, "category") !== "patient_photo").map((row) => ({
                id: get(row, "id"),
                title: get(row, "title"),
                meta: `${get(row, "category").replaceAll("_", " ")} · ${formatDate(get(row, "serviceDate") || get(row, "createdAt"))}`,
                status: "filed",
                detail: get(row, "contentType") || "Document",
                href: `/api/patient-documents?id=${encodeURIComponent(get(row, "id"))}`,
              }))}
              title="Documents"
            />
          )}
          {section === "recall" && (
            <RecallPanel
              busy={busy}
              items={recalls}
              onAdd={(payload) => chartAction("createPatientRecall", { patientId, ...payload }, "Recall created.")}
              onStatus={(id, status) => chartAction("updatePatientRecallStatus", { id, status }, "Recall updated.")}
            />
          )}
        </main>
      </div>
    </div>
  );
}
