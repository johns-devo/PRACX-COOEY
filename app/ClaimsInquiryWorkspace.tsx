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

  const matchedPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    const claimNeedle = claimQuery.trim().toLowerCase();
    const payerNeedle = payerQuery.trim().toLowerCase();
    let ids = new Set(patients.map((row) => value(row, "id")));
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

  const activePatientId = selectedPatientId && matchedPatients.some((row) => value(row, "id") === selectedPatientId)
    ? selectedPatientId
    : value(matchedPatients[0] || {}, "id");

  const patientClaims = useMemo(() => {
    return claims
      .filter((claim) => value(claim, "patientId") === activePatientId)
      .filter((claim) => {
        const dos = value(claim, "dateOfService");
        if (dosFrom && dos < dosFrom) return false;
        if (dosTo && dos > dosTo) return false;
        if (claimQuery.trim() && !value(claim, "claimNumber").toLowerCase().includes(claimQuery.trim().toLowerCase())) return false;
        if (payerQuery.trim() && !`${value(claim, "payerName")} ${value(claim, "payerClaimPayerId")}`.toLowerCase().includes(payerQuery.trim().toLowerCase())) return false;
        return true;
      })
      .sort((left, right) => value(right, "dateOfService").localeCompare(value(left, "dateOfService")));
  }, [claims, activePatientId, dosFrom, dosTo, claimQuery, payerQuery]);

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
        <label>Patient<input onChange={(event) => { setPatientQuery(event.target.value); setSelectedPatientId(""); }} placeholder="Name, ID, account, DOB, member ID" value={patientQuery} /></label>
        <label>Claim #<input onChange={(event) => { setClaimQuery(event.target.value); setSelectedClaimId(""); }} placeholder="PRACX claim number" value={claimQuery} /></label>
        <label>Insurance ID<input onChange={(event) => setPayerQuery(event.target.value)} placeholder="Payer or member ID" value={payerQuery} /></label>
        <label>DOS from<input onChange={(event) => setDosFrom(event.target.value)} type="date" value={dosFrom} /></label>
        <label>DOS to<input onChange={(event) => setDosTo(event.target.value)} type="date" value={dosTo} /></label>
      </form>

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
          <header><strong>Patients</strong><small>{matchedPatients.length}</small></header>
          <ul>
            {matchedPatients.length ? matchedPatients.map((patient) => {
              const id = value(patient, "id");
              const count = claims.filter((item) => value(item, "patientId") === id).length;
              return (
                <li key={id}>
                  <button className={id === activePatientId ? "active" : ""} onClick={() => { setSelectedPatientId(id); setSelectedClaimId(""); setTab("claim"); }} type="button">
                    <strong>{value(patient, "lastName")}, {value(patient, "firstName")}</strong>
                    <small>{value(patient, "accountNumber")} · {shortDate(value(patient, "dateOfBirth"))} · {count} {count === 1 ? "claim" : "claims"}</small>
                  </button>
                </li>
              );
            }) : <li className="claim-inquiry-empty">No patients match.</li>}
          </ul>
        </section>
        <section className="claim-inquiry-pane">
          <header><strong>Claims</strong><small>{patientClaims.length}</small></header>
          <ul>
            {patientClaims.length ? patientClaims.map((row) => {
              const id = value(row, "id");
              const status = deriveClaimLifecycle(row) as ClaimLifecycleStatus;
              return (
                <li key={id}>
                  <button className={id === activeClaimId ? "active" : ""} onClick={() => { setSelectedClaimId(id); setTab("claim"); setActionsOpen(false); }} type="button">
                    <span className="claim-inquiry-row">
                      <strong className="mono">{value(row, "claimNumber")}</strong>
                      <span className={`status-pill ${lifecycleTone(status)}`}>{CLAIM_LIFECYCLE_LABELS[status] || status}</span>
                    </span>
                    <small>{shortDate(value(row, "dateOfService"))} · {value(row, "payerName") || "Self pay"} · {currency(value(row, "totalCharge"))}</small>
                  </button>
                </li>
              );
            }) : <li className="claim-inquiry-empty">No claims for this patient.</li>}
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
                    <thead><tr><th>Date</th><th>Paid</th><th>Adj</th><th>Reference</th></tr></thead>
                    <tbody>
                      {claimPayments.length ? claimPayments.map((payment) => (
                        <tr key={value(payment, "id")}>
                          <td>{shortDate(value(payment, "paymentDate") || value(payment, "postingDate"))}</td>
                          <td>{currency(value(payment, "amount"))}</td>
                          <td>{currency(value(payment, "adjustmentAmount"))}</td>
                          <td>{value(payment, "referenceNumber") || value(payment, "payerName") || "—"}</td>
                        </tr>
                      )) : <tr><td colSpan={4}>No payments posted to this claim.</td></tr>}
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
          ) : <p className="claim-inquiry-empty">Select a patient, then a PRACX claim number.</p>}
        </section>
      </div>
    </div>
  );
}
