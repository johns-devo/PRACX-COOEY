"use client";

import Link from "next/link";

type Row = Record<string, unknown>;
type BillingData = {
  claims: Row[]; claimWorkflowEvents: Row[]; payments: Row[]; paymentEntries: Row[];
  claimPayments: Row[]; claimPaymentServiceLines: Row[]; remittances: Row[];
  encounters: Row[]; claimBatchMembers: Row[]; claimBatches: Row[];
  claimTransmissionLogs: Row[]; paymentLogs: Row[]; reconciliationLogs: Row[];
};
const text = (row: Row | undefined, key: string) => row?.[key] == null ? "" : String(row[key]);
const money = (input: unknown) => Number(input || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (input: unknown) => {
  const raw = String(input || ""); if (!raw) return "—";
  const parsed = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function PatientBillingHistory({ patientId, data, basePath = "" }: { patientId: string; data: BillingData; basePath?: string }) {
  const claimHref = `${basePath}/claim-inquiry` || "/claim-inquiry";
  const paymentHref = `${basePath}/payments` || "/payments";
  const claims = data.claims.filter((row) => text(row, "patientId") === patientId);
  const visits = new Map<string, { claims: Row[]; encounters: Row[]; entries: Row[] }>();
  const ensure = (dos: string) => {
    const key = dos.slice(0, 10) || "undated";
    if (!visits.has(key)) visits.set(key, { claims: [], encounters: [], entries: [] });
    return visits.get(key)!;
  };
  claims.forEach((row) => ensure(text(row, "dateOfService")).claims.push(row));
  data.encounters.filter((row) => text(row, "patientId") === patientId).forEach((row) => ensure(text(row, "dateOfService")).encounters.push(row));
  data.paymentEntries.filter((row) => text(row, "patientId") === patientId && text(row, "serviceDate")).forEach((row) => ensure(text(row, "serviceDate")).entries.push(row));
  const sortedVisits = [...visits.entries()].sort(([left], [right]) => right.localeCompare(left));

  return <section className="patient-billing-history">
    <header className="patient-billing-heading"><div><span className="eyebrow">Patient account</span><h2>Billing history by date of service</h2><p>Claims, payer activity, patient payments, remittances, acknowledgements, and notes for each visit.</p></div><Link href={claimHref}>Open Claims workspace</Link></header>
    {sortedVisits.length ? <div className="patient-dos-list">{sortedVisits.map(([dos, visit]) => (
      <details className="patient-dos-card" key={dos} open={sortedVisits.length === 1}>
        <summary><span className="patient-dos-date">{dos === "undated" ? "Date of service not recorded" : date(dos)}</span><span>{visit.claims.length} {visit.claims.length === 1 ? "claim" : "claims"}</span><span className="patient-dos-balance">{money(visit.claims.reduce((sum, row) => sum + Number(text(row, "remainingBalance") || 0), 0))} open balance</span></summary>
        <div className="patient-dos-content">
          {visit.encounters.map((encounter) => <div className="patient-encounter-strip" key={text(encounter, "id")}><strong>Visit</strong><span>{text(encounter, "chiefComplaint") || text(encounter, "billingContext") || "Encounter"}</span><span>{text(encounter, "status")}</span><span>Encounter {text(encounter, "id").slice(0, 8)}</span></div>)}
          {visit.entries.map((entry) => <div className="patient-unapplied-payment" key={text(entry, "id")}><strong>{text(entry, "paymentNumber") || "Patient payment"}</strong><span>{text(entry, "paymentPurpose") || "Advance payment"}</span><span>{money(text(entry, "paymentAmount"))} · {text(entry, "paymentStatus")}</span><Link href={`${paymentHref}?paymentId=${encodeURIComponent(text(entry, "id"))}`}>Open payment</Link></div>)}
          {visit.claims.map((claim) => {
            const claimId = text(claim, "id");
            const claimPaymentRows = data.claimPayments.filter((row) => text(row, "claimId") === claimId);
            const financialRows = data.payments.filter((row) => text(row, "claimId") === claimId);
            const events = data.claimWorkflowEvents.filter((row) => text(row, "claimId") === claimId).sort((a, b) => text(b, "createdAt").localeCompare(text(a, "createdAt")));
            const batches = data.claimBatchMembers.filter((row) => text(row, "claimId") === claimId).map((member) => data.claimBatches.find((batch) => text(batch, "id") === text(member, "batchId"))).filter((row): row is Row => Boolean(row));
            const transmissions = batches.flatMap((batch) => data.claimTransmissionLogs.filter((log) => text(log, "batchId") === text(batch, "id")).map((log) => ({ ...log, batchNumber: text(batch, "batchNumber") })));
            const remittances = [...new Map(financialRows.map((payment) => data.remittances.find((remit) => text(remit, "id") === text(payment, "remittanceId"))).filter((row): row is Row => Boolean(row)).map((row) => [text(row, "id"), row])).values()];
            return <details className="patient-claim-card" key={claimId}>
              <summary><span className="mono">Claim {text(claim, "claimNumber")}</span><span>{text(claim, "payerName") || "Patient / self pay"}</span><span className="patient-claim-status">{text(claim, "lifecycleStatus") || text(claim, "status")}</span><span>Charge {money(text(claim, "totalCharge"))}</span><span>Paid {money(text(claim, "totalPaid"))}</span><span className={Number(text(claim, "remainingBalance")) > 0 ? "patient-balance-open" : ""}>Balance {money(text(claim, "remainingBalance"))}</span></summary>
              <div className="patient-claim-detail">
                <div className="patient-claim-detail-actions"><Link href={`${claimHref}?patient=${encodeURIComponent(patientId)}&claim=${encodeURIComponent(claimId)}`}>View claim record</Link><span>Claim ID {text(claim, "claimNumber")}</span><span>Next action: {text(claim, "nextAction") || text(claim, "lifecycleStatus") || "Review status"}</span></div>
                <section><h3>Payments &amp; adjustments</h3>{financialRows.length ? <table><thead><tr><th>Date</th><th>Payment ID</th><th>Source / reference</th><th>Paid</th><th>Adjustment</th><th>Status</th></tr></thead><tbody>{financialRows.map((payment) => {
                  const entry = data.paymentEntries.find((row) => text(row, "id") === text(payment, "paymentEntryId"));
                  return <tr key={text(payment, "id")}><td>{date(text(payment, "paymentDate") || text(payment, "postingDate"))}</td><td>{entry ? <Link href={`${paymentHref}?paymentId=${encodeURIComponent(text(entry, "id"))}`}>{text(entry, "paymentNumber")}</Link> : text(payment, "paymentEntryId") || "—"}</td><td>{text(payment, "referenceNumber") || text(payment, "payerName") || "—"}</td><td>{money(text(payment, "amount"))}</td><td>{money(text(payment, "adjustmentAmount"))}</td><td>{text(entry || {}, "paymentStatus") || "Posted"}</td></tr>;
                })}</tbody></table> : <p className="patient-history-empty">No claim payment transactions yet.</p>}
                  {claimPaymentRows.map((paymentLine) => { const services = data.claimPaymentServiceLines.filter((line) => text(line, "claimPaymentId") === text(paymentLine, "id")); return <details className="patient-payment-breakdown" key={text(paymentLine, "id")}><summary>Remittance allocation · {text(paymentLine, "postingStatus")} · paid {money(text(paymentLine, "paidAmount"))} · patient responsibility {money(text(paymentLine, "patientResponsibility"))}</summary>{services.length > 0 && <ul>{services.map((line) => <li key={text(line, "id")}>CPT {text(line, "procedureCode")} · {date(text(line, "serviceDate"))} · charge {money(text(line, "chargeAmount"))} · allowed {money(text(line, "allowedAmount"))} · paid {money(text(line, "paidAmount"))} · PR {money(text(line, "patientResponsibility"))} {text(line, "denialCode")}</li>)}</ul>}</details>; })}</section>
                <section><h3>EOB / ERA</h3>{remittances.length ? remittances.map((remit) => <p className="patient-history-row" key={text(remit, "id")}><strong>{text(remit, "fileName") || "Electronic remittance"}</strong><span>Trace {text(remit, "traceNumber") || "—"}</span><span>Received {date(text(remit, "receivedAt"))}</span><span>{text(remit, "status")} · {text(remit, "processedStatus")}</span>{text(remit, "paymentEntryId") && <Link href={`${paymentHref}?paymentId=${encodeURIComponent(text(remit, "paymentEntryId"))}`}>Open posting</Link>}</p>) : <p className="patient-history-empty">No EOB or ERA linked to this claim.</p>}</section>
                <section><h3>Submission acknowledgements</h3>{transmissions.length ? transmissions.map((log, index) => <p className="patient-history-row" key={text(log, "id") || index}><strong>{text(log, "batchNumber")}</strong><span>{text(log, "status")}</span><span>{date(text(log, "transmissionTime"))}</span><span>{text(log, "clearinghouseResponse") || "No response detail"}</span></p>) : batches.length ? batches.map((batch) => <p className="patient-history-row" key={text(batch, "id")}><strong>{text(batch, "batchNumber")}</strong><span>{text(batch, "status")}</span><span>{date(text(batch, "transmittedAt"))}</span><span>{text(batch, "clearinghouseResponse") || "Awaiting acknowledgment"}</span></p>) : <p className="patient-history-empty">No transmission acknowledgement linked yet.</p>}</section>
                <section><h3>Claim activity</h3>{events.length ? <ol className="patient-history-events">{events.map((event) => <li key={text(event, "id")}><time>{date(text(event, "createdAt"))}</time><strong>{text(event, "actorName") || "System"} · {text(event, "action")}</strong><span>{text(event, "reason") || text(event, "newStatus")}</span></li>)}</ol> : <p className="patient-history-empty">No claim activity recorded.</p>}</section>
              </div>
            </details>;
          })}
          {visit.claims.length === 0 && visit.entries.length === 0 && <p className="patient-history-empty">A visit is recorded, but no claim or patient payment is linked yet.</p>}
        </div>
      </details>
    ))}</div> : <p className="patient-history-empty">No visit, claim, or payment history found for this patient.</p>}
  </section>;
}
