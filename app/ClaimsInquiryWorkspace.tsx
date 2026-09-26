"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CLAIM_LIFECYCLE_LABELS,
  claimActivityLabel,
  claimPartySlots,
  deriveClaimLifecycle,
  isLifecycleOnClaimPrep,
  lifecycleActions,
  type ClaimLifecycleStatus,
  type LifecycleActionId,
} from "../lib/claim-lifecycle";

type DataRow = Record<string, unknown>;
type InquiryTab = "claim" | "notes" | "payments" | "denials" | "activity";

function value(row: DataRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function shortDate(input: unknown, withTime = false) {
  const raw = String(input || "");
  if (!raw) return "—";
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function currency(input: unknown) {
  return Number(input || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ageFromDob(dob: string) {
  if (!dob) return "";
  const born = new Date(`${dob.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(born.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return `${age}yo`;
}

function lifecycleTone(status: string) {
  if (status === "closed" || status.startsWith("paid_") || status === "paid") return "active";
  if (status.startsWith("denied_") || status === "voided" || status === "denied") return "danger";
  if (status.startsWith("sent_") || status.startsWith("rebilled_") || status === "sent" || status === "billing") return "warning";
  return "inactive";
}

function slotTone(status: string) {
  if (status === "paid" || status === "closed") return "active";
  if (status === "denied" || status === "voided") return "danger";
  if (status === "sent" || status === "billing") return "warning";
  return "inactive";
}

export function ClaimsInquiryWorkspace({
  data,
  claimPrepHref,
  isSaving,
  onAction,
}: {
  data: {
    patients: DataRow[];
    claims: DataRow[];
    claimLines: DataRow[];
    claimWorkflowEvents: DataRow[];
    payments: DataRow[];
    paymentEntries?: DataRow[];
    claimPayments?: DataRow[];
    coverages: DataRow[];
  };
  claimPrepHref: string;
  isSaving: boolean;
  onAction: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const [patientQuery, setPatientQuery] = useState("");
  const [claimQuery, setClaimQuery] = useState("");
  const [payerQuery, setPayerQuery] = useState("");
  const [dosFrom, setDosFrom] = useState("");
  const [dosTo, setDosTo] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [patientSuggestions, setPatientSuggestions] = useState<DataRow[]>([]);
  const [isSearchingPatients, setSearchingPatients] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const patient = params.get("patient") || "";
    const claim = params.get("claim") || "";
    if (patient) setSelectedPatientId(patient);
    if (claim) setSelectedClaimId(claim);
  }, []);
  const [tab, setTab] = useState<InquiryTab>("claim");
  const [note, setNote] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);

  const patients = data.patients;
  const claims = data.claims;
  const coverages = data.coverages || [];

  useEffect(() => {
    const query = patientQuery.trim();
    if (query.length < 3 || selectedPatientId) { setPatientSuggestions([]); setSearchingPatients(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchingPatients(true);
      try {
        const response = await fetch(`/api/patient-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json() as { patients?: DataRow[] };
        if (response.ok) setPatientSuggestions(result.patients || []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setPatientSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearchingPatients(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [patientQuery, selectedPatientId]);

  const matchedPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    const claimNeedle = claimQuery.trim().toLowerCase();
    const payerNeedle = payerQuery.trim().toLowerCase();
    const hasCriteria = Boolean(q || claimNeedle || payerNeedle || dosFrom || dosTo);
    if (!hasCriteria) return [];
    let ids = q ? new Set<string>() : new Set(patients.map((row) => value(row, "id")));
    if (q.length >= 1) {
      ids = new Set(patients.filter((row) => {
        const memberIds = coverages.filter((coverage) => value(coverage, "patientId") === value(row, "id")).map((coverage) => value(coverage, "memberId")).join(" ");
        return `${value(row, "firstName")} ${value(row, "lastName")} ${value(row, "accountNumber")} ${value(row, "dateOfBirth")} ${value(row, "id")} ${value(row, "phone")} ${memberIds}`.toLowerCase().includes(q);
      }).map((row) => value(row, "id")));
    }
    const claimHits = claims.filter((claim) => {
      const dos = value(claim, "dateOfService");
      if (dosFrom && dos < dosFrom) return false;
      if (dosTo && dos > dosTo) return false;
      if (claimNeedle && !`${value(claim, "claimNumber")} ${value(claim, "id")}`.toLowerCase().includes(claimNeedle)) return false;
      if (payerNeedle && !`${value(claim, "payerName")} ${value(claim, "payerClaimPayerId")} ${value(claim, "memberId")}`.toLowerCase().includes(payerNeedle)) return false;
      return true;
    });
    if (claimNeedle || payerNeedle || dosFrom || dosTo) {
      const hitIds = new Set(claimHits.map((claim) => value(claim, "patientId")));
      if (payerNeedle) {
        coverages.filter((coverage) => `${value(coverage, "memberId")} ${value(coverage, "payerName")}`.toLowerCase().includes(payerNeedle)).forEach((coverage) => hitIds.add(value(coverage, "patientId")));
      }
      ids = new Set([...ids].filter((id) => hitIds.has(id)));
    }
    return patients.filter((row) => ids.has(value(row, "id")));
  }, [patients, claims, coverages, patientQuery, claimQuery, payerQuery, dosFrom, dosTo]);

  const selectedClaim = claims.find((row) => value(row, "id") === selectedClaimId);
  const activePatientId = selectedPatientId && matchedPatients.some((row) => value(row, "id") === selectedPatientId)
    ? selectedPatientId
    : value(selectedClaim || {}, "patientId") || (matchedPatients.length === 1 ? value(matchedPatients[0], "id") : "");

  const matchingClaims = useMemo(() => {
    const hasCriteria = Boolean(patientQuery.trim() || claimQuery.trim() || payerQuery.trim() || dosFrom || dosTo);
    if (!hasCriteria) return [];
    const patientIds = new Set(matchedPatients.map((row) => value(row, "id")));
    return claims.filter((claim) => {
      const patientId = value(claim, "patientId");
      const dos = value(claim, "dateOfService");
      const payerMatches = !payerQuery.trim() || `${value(claim, "payerName")} ${value(claim, "payerClaimPayerId")} ${value(claim, "memberId")} ${coverages.filter((coverage) => value(coverage, "patientId") === patientId).map((coverage) => `${value(coverage, "memberId")} ${value(coverage, "payerName")}`).join(" ")}`.toLowerCase().includes(payerQuery.trim().toLowerCase());
      return (!patientQuery.trim() || patientIds.has(patientId))
        && (!claimQuery.trim() || `${value(claim, "claimNumber")} ${value(claim, "id")}`.toLowerCase().includes(claimQuery.trim().toLowerCase()))
        && payerMatches
        && (!dosFrom || dos >= dosFrom)
        && (!dosTo || dos <= dosTo);
    }).sort((left, right) => value(right, "dateOfService").localeCompare(value(left, "dateOfService")));
  }, [claims, coverages, matchedPatients, patientQuery, claimQuery, payerQuery, dosFrom, dosTo]);

  const patientClaims = useMemo(() => {
    const hasClaimFilters = Boolean(claimQuery.trim() || payerQuery.trim() || dosFrom || dosTo);
    const rows = hasClaimFilters ? matchingClaims : claims.filter((row) => activePatientId && value(row, "patientId") === activePatientId);
    return rows.sort((left, right) => value(right, "dateOfService").localeCompare(value(left, "dateOfService")));
  }, [claims, activePatientId, matchingClaims, claimQuery, payerQuery, dosFrom, dosTo]);

  const activeClaimId = selectedClaimId && patientClaims.some((row) => value(row, "id") === selectedClaimId)
    ? selectedClaimId
    : value(patientClaims[0] || {}, "id");
  const claim = patientClaims.find((row) => value(row, "id") === activeClaimId);
  const selectedPatient = patients.find((row) => value(row, "id") === activePatientId);
  const patientCoverages = coverages.filter((row) => value(row, "patientId") === activePatientId && value(row, "status") === "active");
  const hasSecondary = patientCoverages.some((row) => value(row, "priority") === "secondary");
  const hasTertiary = patientCoverages.some((row) => value(row, "priority") === "tertiary");
  const lines = (data.claimLines || []).filter((row) => value(row, "claimId") === activeClaimId);
  const events = (data.claimWorkflowEvents || []).filter((row) => value(row, "claimId") === activeClaimId);
  const notes = events.filter((row) => value(row, "action").toUpperCase() === "NOTE");
  const claimPayments = (data.payments || []).filter((row) => value(row, "claimId") === activeClaimId);
  const paymentLines = (data.claimPayments || []).filter((row) => value(row, "claimId") === activeClaimId);
  const denials = [
    ...paymentLines.filter((row) => value(row, "denialCode")),
    ...claimPayments.filter((row) => value(row, "adjustmentReason") && /denial|CO-|OA-|PR-/i.test(value(row, "adjustmentReason"))),
    ...events.filter((row) => value(row, "action").toUpperCase() === "DENIED" || value(row, "newStatus").startsWith("denied_")),
  ];
  const lifecycle = claim ? deriveClaimLifecycle({
    lifecycleStatus: value(claim, "lifecycleStatus"),
    workflowStatus: value(claim, "workflowStatus"),
    status: value(claim, "status"),
    remainingBalance: value(claim, "remainingBalance"),
    firstBilledDate: value(claim, "firstBilledDate"),
  }) : "new";
  const slots = claimPartySlots({ lifecycle, hasSecondary, hasTertiary });
  const actions = lifecycleActions({
    status: lifecycle,
    remaining: Number(value(claim || {}, "remainingBalance") || 0),
    hasSecondary,
    hasTertiary,
  });
  const diagnoses = (() => {
    try { return JSON.parse(value(claim || {}, "diagnosisCodes") || "[]") as string[]; } catch { return []; }
  })();

  async function runAction(id: LifecycleActionId) {
    setActionsOpen(false);
    if (!claim) return;
    const claimId = value(claim, "id");
    if (id === "open_prep") return;
    if (id === "rebill") await onAction("rebillClaim", { id: claimId });
    if (id === "bill_sec") await onAction("billClaimParty", { id: claimId, party: "sec" });
    if (id === "bill_ter") await onAction("billClaimParty", { id: claimId, party: "ter" });
    if (id === "bill_patient") await onAction("billClaimParty", { id: claimId, party: "patient" });
    if (id === "void") await onAction("voidClaim", { id: claimId });
  }

  async function saveNote() {
    if (!claim || !note.trim()) return;
    const saved = await onAction("addClaimNote", { id: value(claim, "id"), note: note.trim() });
    if (saved) setNote("");
  }

  return (
    <div className="claim-inquiry">
      <form className="claim-inquiry-filters" onSubmit={(event) => event.preventDefault()}>
        <label>Patient<input autoComplete="off" onChange={(event) => { setPatientQuery(event.target.value); setSelectedPatientId(""); setSelectedClaimId(""); }} placeholder="Type patient name or ID" value={patientQuery} /></label>
        <label>Claim #<input onChange={(event) => { setClaimQuery(event.target.value); setSelectedClaimId(""); }} placeholder="PRACX claim number" value={claimQuery} /></label>
        <label>Payer / insurance ID<input onChange={(event) => { setPayerQuery(event.target.value); setSelectedClaimId(""); }} placeholder="Payer name, payer ID or member ID" value={payerQuery} /></label>
        <label>DOS from<input onChange={(event) => setDosFrom(event.target.value)} type="date" value={dosFrom} /></label>
        <label>DOS to<input onChange={(event) => setDosTo(event.target.value)} type="date" value={dosTo} /></label>
        {(patientQuery || claimQuery || payerQuery || dosFrom || dosTo) && <button className="claim-inquiry-clear" onClick={() => { setPatientQuery(""); setClaimQuery(""); setPayerQuery(""); setDosFrom(""); setDosTo(""); setSelectedPatientId(""); setSelectedClaimId(""); }} type="button">Clear</button>}
      </form>

      {patientQuery.trim().length >= 3 && !selectedPatientId && <div className="claim-inquiry-suggestions" role="listbox" aria-label="Patient search results">
        <strong>{isSearchingPatients ? "Searching patients…" : `${patientSuggestions.length} patient match${patientSuggestions.length === 1 ? "" : "es"}`}</strong>
        {patientSuggestions.map((patient) => <button key={value(patient, "id")} onClick={() => { setSelectedPatientId(value(patient, "id")); setSelectedClaimId(""); setTab("claim"); }} role="option" type="button"><span>{value(patient, "lastName")}, {value(patient, "firstName")}</span><small>{value(patient, "accountNumber")} · DOB {shortDate(value(patient, "dateOfBirth"))}</small></button>)}
        {!isSearchingPatients && patientSuggestions.length === 0 && <small>No matching patients. You can still search by claim, payer/member ID, or DOS.</small>}
      </div>}

      {selectedPatient && (
        <section className="claim-inquiry-banner">
          <div>
            <span className="claim-inquiry-avatar">{value(selectedPatient, "firstName").slice(0, 1)}{value(selectedPatient, "lastName").slice(0, 1)}</span>
            <div>
              <strong>{value(selectedPatient, "lastName")}, {value(selectedPatient, "firstName")}</strong>
              <p>{[ageFromDob(value(selectedPatient, "dateOfBirth")), value(selectedPatient, "sex")].filter(Boolean).join(" · ")} · DOB {shortDate(value(selectedPatient, "dateOfBirth"))} · #{value(selectedPatient, "accountNumber")}</p>
            </div>
          </div>
          <small>{patientCoverages.filter((row) => value(row, "priority") === "primary")[0] ? `Pri ${value(patientCoverages.find((row) => value(row, "priority") === "primary") || {}, "memberId") || "—"}` : "No primary coverage"}{value(selectedPatient, "phone") ? ` · ${value(selectedPatient, "phone")}` : ""}</small>
        </section>
      )}

      <div className="claim-inquiry-grid">
        <section className="claim-inquiry-pane">
          <header><strong>{selectedPatient ? `Claims · ${value(selectedPatient, "firstName")} ${value(selectedPatient, "lastName")}` : "Matching claims"}</strong><small>{patientClaims.length}</small></header>
          <ul>
            {patientClaims.length ? patientClaims.map((row) => {
              const id = value(row, "id");
              const status = deriveClaimLifecycle(row) as ClaimLifecycleStatus;
              return (
                <li key={id}>
                  <button className={id === activeClaimId ? "active" : ""} onClick={() => { setSelectedClaimId(id); setSelectedPatientId(value(row, "patientId")); setTab("claim"); setActionsOpen(false); }} type="button">
                    <span className="claim-inquiry-row">
                      <strong className="mono">{value(row, "claimNumber")}</strong>
                      <span className={`status-pill ${lifecycleTone(status)}`}>{CLAIM_LIFECYCLE_LABELS[status] || status}</span>
                    </span>
                    <small>{shortDate(value(row, "dateOfService"))} · {value(row, "payerName") || "Self pay"} · {currency(value(row, "totalCharge"))}</small>
                  </button>
                </li>
              );
            }) : <li className="claim-inquiry-empty">{patientQuery || claimQuery || payerQuery || dosFrom || dosTo ? "No claims match these search criteria." : "Search by patient, claim number, payer/member ID, or date of service."}</li>}
          </ul>
        </section>
        <section className="claim-inquiry-detail">
          {claim ? (
            <>
              <header className="claim-inquiry-claimhead">
                <div>
                  <span className="eyebrow">Claim {value(claim, "claimNumber")}</span>
                  <h2 className="mono">{value(claim, "claimNumber")}</h2>
                  <p>DOS {shortDate(value(claim, "dateOfService"))} · {value(claim, "payerName") || "Self pay"} · Outstanding {currency(value(claim, "remainingBalance"))}</p>
                </div>
                <div className="claim-inquiry-claimhead-actions">
                  <span className={`status-pill ${lifecycleTone(lifecycle)}`}>{CLAIM_LIFECYCLE_LABELS[lifecycle]}</span>
                  {actions.length > 0 && (
                    <div className="claim-inquiry-actions">
                      <button aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)} type="button">Actions</button>
                      {actionsOpen && (
                        <menu>
                          {actions.map((item) => item.id === "open_prep"
                            ? <Link href={claimPrepHref} key={item.id} onClick={() => setActionsOpen(false)}>{item.label}</Link>
                            : <button disabled={isSaving} key={item.id} onClick={() => void runAction(item.id)} type="button">{item.label}</button>)}
                        </menu>
                      )}
                    </div>
                  )}
                </div>
              </header>
              <div className="claim-inquiry-slots" aria-label="Payer status">
                {slots.filter((slot) => slot.present).map((slot) => (
                  <article className={slot.current ? "is-current" : ""} key={slot.party}>
                    <span>{slot.label}</span>
                    <strong className={slotTone(slot.status)}>{slot.statusLabel}</strong>
                  </article>
                ))}
              </div>
              <p className="claim-inquiry-next">
                {lifecycle === "closed"
                  ? "This claim is closed."
                  : lifecycle === "voided"
                    ? "This claim is voided."
                    : isLifecycleOnClaimPrep(lifecycle)
                      ? `Next: generate and send from Claim prep · ${CLAIM_LIFECYCLE_LABELS[lifecycle]}`
                      : lifecycle.startsWith("sent_") || lifecycle.startsWith("rebilled_")
                        ? `Waiting on payer · ${actions.find((item) => item.id !== "void")?.label || "no further action"} is available`
                        : `Next: ${actions.find((item) => item.id !== "void")?.label || CLAIM_LIFECYCLE_LABELS[lifecycle]}`}
              </p>
              <nav className="claim-inquiry-tabs" aria-label="Claim sections">
                {([["claim", "Claim"], ["notes", `Notes (${notes.length})`], ["payments", `Payments (${claimPayments.length})`], ["denials", `Denials (${denials.length})`], ["activity", "Activity"]] as [InquiryTab, string][]).map(([key, label]) => (
                  <button aria-pressed={tab === key} className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setActionsOpen(false); }} type="button">{label}</button>
                ))}
              </nav>

              {tab === "claim" && (
                <div className="claim-inquiry-tab">
                  <div className="claim-inquiry-balances">
                    <article><span>Charge</span><strong>{currency(value(claim, "totalCharge"))}</strong></article>
                    <article><span>Paid</span><strong>{currency(value(claim, "totalPaid"))}</strong></article>
                    <article><span>Adjusted</span><strong>{currency(value(claim, "totalAdjustment"))}</strong></article>
                    <article><span>Balance</span><strong>{currency(value(claim, "remainingBalance"))}</strong></article>
                  </div>
                  <p className="claim-inquiry-dx">{diagnoses.length ? `Box 21 · ${diagnoses.join(", ")}` : "No diagnosis codes on this claim."}</p>
                  <table>
                    <thead><tr><th>#</th><th>CPT</th><th>24E</th><th>Units</th><th>Charge</th></tr></thead>
                    <tbody>
                      {lines.length ? lines.map((line) => (
                        <tr key={value(line, "id")}><td>{value(line, "lineNumber")}</td><td className="mono">{value(line, "procedureCode")}</td><td>{value(line, "diagnosisPointers")}</td><td>{value(line, "units")}</td><td>{currency(value(line, "chargeAmount"))}</td></tr>
                      )) : <tr><td colSpan={5}>No service lines.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "notes" && (
                <div className="claim-inquiry-tab">
                  <label className="claim-inquiry-note">Add note
                    <textarea onChange={(event) => setNote(event.target.value)} placeholder="Billing note, follow-up, or denial review" rows={3} value={note} />
                  </label>
                  <button className="primary-button" disabled={isSaving || !note.trim()} onClick={() => void saveNote()} type="button">Save note</button>
                  <ol className="claim-inquiry-timeline">
                    {notes.length ? notes.map((event) => (
                      <li key={value(event, "id")}>
                        <span>{shortDate(value(event, "createdAt"), true)}</span>
                        <strong>{value(event, "actorName")}</strong>
                        <small>{value(event, "reason")}</small>
                      </li>
                    )) : <li>No notes yet.</li>}
                  </ol>
                </div>
              )}

              {tab === "payments" && (
                <div className="claim-inquiry-tab">
                  <table>
                    <thead><tr><th>Date</th><th>Payment ID</th><th>Paid</th><th>Adj</th><th>Reference</th></tr></thead>
                    <tbody>
                      {claimPayments.length ? claimPayments.map((payment) => (
                        <tr key={value(payment, "id")}>
                          <td>{shortDate(value(payment, "paymentDate") || value(payment, "postingDate"))}</td>
                          <td>{value(payment, "paymentEntryId") ? <a href={`${claimPrepHref.replace(/\/claims\/?$/, "/payments")}?paymentId=${encodeURIComponent(value(payment, "paymentEntryId"))}`}>{value((data.paymentEntries || []).find((entry) => value(entry, "id") === value(payment, "paymentEntryId")) || {}, "paymentNumber") || value(payment, "paymentEntryId")}</a> : "—"}</td>
                          <td>{currency(value(payment, "amount"))}</td>
                          <td>{currency(value(payment, "adjustmentAmount"))}</td>
                          <td>{value(payment, "referenceNumber") || value(payment, "payerName") || "—"}</td>
                        </tr>
                      )) : <tr><td colSpan={5}>No payments posted to this claim.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "denials" && (
                <div className="claim-inquiry-tab">
                  {denials.length ? (
                    <ul className="claim-inquiry-denials">
                      {denials.map((row, index) => (
                        <li key={value(row, "id") || `denial-${index}`}>
                          <strong>{value(row, "denialCode") || value(row, "adjustmentReason") || CLAIM_LIFECYCLE_LABELS[value(row, "newStatus") as ClaimLifecycleStatus] || "Denial"}</strong>
                          <p>{value(row, "errorMessage") || value(row, "reason") || value(row, "adjustmentReason") || "Review coding or coverage and use Actions to rebill."}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="claim-inquiry-empty">No denial codes posted on this claim.</p>}
                </div>
              )}

              {tab === "activity" && (
                <div className="claim-inquiry-tab">
                  <table>
                    <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Status</th><th>Note</th></tr></thead>
                    <tbody>
                      {events.length ? events.map((event) => (
                        <tr key={value(event, "id")}>
                          <td>{shortDate(value(event, "createdAt"), true)}</td>
                          <td>{value(event, "actorName")}</td>
                          <td>{claimActivityLabel(value(event, "action"), value(event, "newStatus"))}</td>
                          <td>{CLAIM_LIFECYCLE_LABELS[value(event, "newStatus") as ClaimLifecycleStatus] || value(event, "newStatus")}</td>
                          <td>{value(event, "reason") || "—"}</td>
                        </tr>
                      )) : <tr><td colSpan={5}>No activity recorded yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : <p className="claim-inquiry-empty">{patientQuery || claimQuery || payerQuery || dosFrom || dosTo ? "Choose a matching claim to open its complete billing record." : "Search by patient, claim number, payer/member ID, or date of service to open a billing record."}</p>}
        </section>
      </div>
    </div>
  );
}
