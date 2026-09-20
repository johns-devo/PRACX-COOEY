"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CLAIM_LIFECYCLE_LABELS,
  CLAIM_PARTY_LABELS,
  arenaFollowUpActions,
  type ClaimParty,
  type LifecycleActionId,
} from "../lib/claim-lifecycle";
import {
  AGING_BUCKETS,
  FOLLOW_UP_LABELS,
  INSURANCE_GAP_LABELS,
  INSURANCE_GAPS,
  buildCollectionRows,
  filterCollectionRows,
  type AgingBucket,
  type InsuranceGapId,
} from "../lib/collection-arena";

type DataRow = Record<string, unknown>;

function value(row: DataRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function currency(input: unknown) {
  return Number(input || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(input: unknown) {
  const raw = String(input || "");
  if (!raw) return "—";
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function lifecycleTone(status: string) {
  if (status.startsWith("denied_")) return "danger";
  if (status.startsWith("sent_") || status.startsWith("rebilled_")) return "warning";
  return "inactive";
}

export function CollectionArenaWorkspace({
  data,
  inquiryHref,
  claimPrepHref,
  isSaving,
  onAction,
  onOpenClaim,
}: {
  data: {
    patients: DataRow[];
    claims: DataRow[];
    coverages: DataRow[];
    plans: DataRow[];
    payers: DataRow[];
    eligibility: DataRow[];
  };
  inquiryHref: string;
  claimPrepHref: string;
  isSaving: boolean;
  onAction: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  onOpenClaim: (claimId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [dosFrom, setDosFrom] = useState("");
  const [dosTo, setDosTo] = useState("");
  const [aging, setAging] = useState<AgingBucket | "">("");
  const [payerId, setPayerId] = useState("");
  const [party, setParty] = useState<ClaimParty | "">("");
  const [gaps, setGaps] = useState<InsuranceGapId[]>([]);

  const rows = useMemo(() => buildCollectionRows({
    claims: data.claims,
    coverages: data.coverages || [],
    plans: data.plans || [],
    eligibility: data.eligibility || [],
    payers: data.payers || [],
  }), [data.claims, data.coverages, data.plans, data.eligibility, data.payers]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return filterCollectionRows(rows, { dosFrom, dosTo, aging, payerId, party, gaps }).filter((row) => {
      if (!needle) return true;
      const patient = data.patients.find((item) => value(item, "id") === value(row.claim, "patientId")) || {};
      return `${value(row.claim, "claimNumber")} ${value(row.claim, "patientName")} ${value(patient, "firstName")} ${value(patient, "lastName")} ${value(patient, "accountNumber")} ${value(row.claim, "payerName")}`.toLowerCase().includes(needle);
    });
  }, [rows, dosFrom, dosTo, aging, payerId, party, gaps, search, data.patients]);

  const outstanding = filtered.reduce((sum, row) => sum + Number(row.claim.remainingBalance || 0), 0);
  const overdue = filtered.filter((row) => row.ageDays > row.responseDays).length;
  const inProcess = filtered.filter((row) => row.followUpStatus === "in_process").length;
  const payers = (data.payers || []).filter((row) => rows.some((item) => value(item.claim, "payerId") === value(row, "id")));

  function toggleGap(id: InsuranceGapId) {
    setGaps((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function inquiryLink(row: { claim: DataRow }) {
    const claimId = value(row.claim, "id");
    const patientId = value(row.claim, "patientId");
    const join = inquiryHref.includes("?") ? "&" : "?";
    return `${inquiryHref}${join}patient=${encodeURIComponent(patientId)}&claim=${encodeURIComponent(claimId)}`;
  }

  async function runAction(claimId: string, id: LifecycleActionId) {
    if (id === "in_process") await onAction("setClaimFollowUp", { id: claimId, followUpStatus: "in_process" });
    if (id === "mark_denied") await onAction("setClaimFollowUp", { id: claimId, followUpStatus: "denied" });
    if (id === "rebill") await onAction("rebillClaim", { id: claimId });
    if (id === "bill_sec") await onAction("billClaimParty", { id: claimId, party: "sec" });
    if (id === "bill_ter") await onAction("billClaimParty", { id: claimId, party: "ter" });
    if (id === "bill_patient") await onAction("billClaimParty", { id: claimId, party: "patient" });
  }

  return (
    <div className="collection-arena">
      <div className="collection-arena-stats">
        <article><span>Due for follow-up</span><strong>{filtered.length}</strong></article>
        <article><span>Open A/R</span><strong>{currency(outstanding)}</strong></article>
        <article><span>Past response days</span><strong>{overdue}</strong></article>
        <article><span>In process to pay</span><strong>{inProcess}</strong></article>
      </div>

      <form className="collection-arena-filters" onSubmit={(event) => event.preventDefault()}>
        <label>Find<input onChange={(event) => setSearch(event.target.value)} placeholder="Patient, claim #, payer" value={search} /></label>
        <label>DOS from<input onChange={(event) => setDosFrom(event.target.value)} type="date" value={dosFrom} /></label>
        <label>DOS to<input onChange={(event) => setDosTo(event.target.value)} type="date" value={dosTo} /></label>
        <label>Aging
          <select onChange={(event) => setAging(event.target.value as AgingBucket | "")} value={aging}>
            <option value="">Any age</option>
            {AGING_BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{bucket} days</option>)}
          </select>
        </label>
        <label>Insurance
          <select onChange={(event) => setPayerId(event.target.value)} value={payerId}>
            <option value="">All payers</option>
            {payers.map((payer) => <option key={value(payer, "id")} value={value(payer, "id")}>{value(payer, "name")} · {value(payer, "responseDays") || "12"}d</option>)}
          </select>
        </label>
        <label>Party
          <select onChange={(event) => setParty(event.target.value as ClaimParty | "")} value={party}>
            <option value="">All parties</option>
            <option value="pri">Primary</option>
            <option value="sec">Secondary</option>
            <option value="ter">Tertiary</option>
            <option value="patient">Patient</option>
          </select>
        </label>
      </form>

      <div className="collection-arena-criteria" aria-label="Insurance gaps">
        {INSURANCE_GAPS.map((gap) => (
          <button aria-pressed={gaps.includes(gap)} className={gaps.includes(gap) ? "active" : ""} key={gap} onClick={() => toggleGap(gap)} type="button">
            {INSURANCE_GAP_LABELS[gap]}
          </button>
        ))}
        {gaps.length > 0 && <button className="collection-arena-clear" onClick={() => setGaps([])} type="button">Clear criteria</button>}
      </div>

      <div className="collection-arena-table">
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Patient</th>
              <th>DOS</th>
              <th>Insurance</th>
              <th>Party</th>
              <th>Status</th>
              <th>Wait</th>
              <th>Follow-up</th>
              <th>Balance</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? filtered.map((row) => {
              const patient = data.patients.find((item) => value(item, "id") === value(row.claim, "patientId")) || {};
              const coverages = (data.coverages || []).filter((item) => value(item, "patientId") === value(row.claim, "patientId") && value(item, "status") === "active");
              const actions = arenaFollowUpActions({
                status: row.lifecycle,
                remaining: Number(row.claim.remainingBalance || 0),
                hasSecondary: coverages.some((item) => value(item, "priority") === "secondary"),
                hasTertiary: coverages.some((item) => value(item, "priority") === "tertiary"),
                followUpStatus: row.followUpStatus,
              });
              return (
                <tr key={value(row.claim, "id")}>
                  <td><button className="mono collection-arena-claim" onClick={() => onOpenClaim(value(row.claim, "id"))} type="button">{value(row.claim, "claimNumber")}</button></td>
                  <td><strong>{value(patient, "lastName") ? `${value(patient, "lastName")}, ${value(patient, "firstName")}` : value(row.claim, "patientName") || "—"}</strong></td>
                  <td>{shortDate(row.claim.dateOfService)}</td>
                  <td>{value(row.claim, "payerName") || "Self pay"}</td>
                  <td>{row.party ? CLAIM_PARTY_LABELS[row.party] : "—"}</td>
                  <td><span className={`status-pill ${lifecycleTone(row.lifecycle)}`}>{CLAIM_LIFECYCLE_LABELS[row.lifecycle]}</span></td>
                  <td>{row.ageDays}d / {row.responseDays}d</td>
                  <td>{FOLLOW_UP_LABELS[row.followUpStatus] || "Due"}</td>
                  <td>{currency(row.claim.remainingBalance)}</td>
                  <td>
                    <div className="collection-arena-actions">
                      {actions.map((item) => (
                        <button disabled={isSaving} key={item.id} onClick={() => void runAction(value(row.claim, "id"), item.id)} type="button">{item.label}</button>
                      ))}
                      <Link href={inquiryLink(row)}>Account</Link>
                      <Link href={claimPrepHref}>Claim prep</Link>
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={10}>No submitted claims are past the payer response window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
