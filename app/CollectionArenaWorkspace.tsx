"use client";

import { useMemo, useState } from "react";
import {
  CLAIM_LIFECYCLE_LABELS,
  CLAIM_PARTY_LABELS,
  type ClaimParty,
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

      <details className="collection-arena-more">
        <summary>Insurance criteria{gaps.length ? ` · ${gaps.length} selected` : ""}</summary>
        <div className="collection-arena-criteria" aria-label="Insurance gaps">
          {INSURANCE_GAPS.map((gap) => (
            <button aria-pressed={gaps.includes(gap)} className={gaps.includes(gap) ? "active" : ""} key={gap} onClick={() => toggleGap(gap)} type="button">
              {INSURANCE_GAP_LABELS[gap]}
            </button>
          ))}
          {gaps.length > 0 && <button className="collection-arena-clear" onClick={() => setGaps([])} type="button">Clear criteria</button>}
          <button className="collection-arena-clear" disabled={isSaving} onClick={() => void onAction("seedCollectionFixtures", {})} type="button">Load sample claims</button>
        </div>
      </details>

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
            </tr>
          </thead>
          <tbody>
            {filtered.length ? filtered.map((row) => {
              const patient = data.patients.find((item) => value(item, "id") === value(row.claim, "patientId")) || {};
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
                </tr>
              );
            }) : (
              <tr><td colSpan={9}>No submitted claims are past the payer response window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
