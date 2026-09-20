"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { FLOWSHEET_METRICS } from "../lib/patient-chart";

type Row = Record<string, unknown>;

const get = (row: Row | undefined, key: string) => String(row?.[key] ?? "");
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
const statusTone = (status: string) =>
  ["active", "completed", "reviewed", "approved", "eligible", "ready_to_bill", "checked_out", "done", "open"].includes(status)
    ? "good"
    : ["critical", "abnormal", "denied", "cancelled", "rejected", "urgent", "severe"].includes(status)
      ? "alert"
      : "waiting";
const money = (input: unknown) =>
  Number(input || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PanelHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="chart-panel-header">
      <div><span className="chart-label">{title}</span><h2>{title}</h2><p>{description}</p></div>
      {action}
    </header>
  );
}

export function ListPanel({
  title, description, empty, action, rows,
}: {
  title: string; description: string; empty: string; action?: React.ReactNode;
  rows: Array<{ id: string; title: string; meta: string; status: string; detail: string; href?: string }>;
}) {
  return (
    <div>
      <PanelHeader title={title} description={description} action={action} />
      <div className="chart-data-grid">
        {rows.length ? rows.map((row) => {
          const body = (
            <>
              <div><strong>{row.title}</strong><span>{row.meta}</span></div>
              <span className={`chart-status ${statusTone(row.status)}`}>{row.status.replaceAll("_", " ")}</span>
              <p>{row.detail}</p>
            </>
          );
          return row.href
            ? <a className="chart-data-card-link" href={row.href} key={row.id} rel="noreferrer" target={row.href.startsWith("/api/") ? "_blank" : undefined}>{body}</a>
            : <article key={row.id}>{body}</article>;
        }) : <p className="chart-empty-line">{empty}</p>}
      </div>
    </div>
  );
}

export function FacesheetPanel({
  patient, payerName, planName, upcoming, problems, medications, allergies, clinicalEditorHref,
}: {
  patient: Row; payerName: string; planName: string; upcoming?: Row;
  problems: Row[]; medications: Row[]; allergies: Row[]; clinicalEditorHref: string;
}) {
  return (
    <div className="chart-facesheet">
      <PanelHeader title="Facesheet" description="At-a-glance clinical and administrative snapshot." action={<Link href={clinicalEditorHref}>Continue note</Link>} />
      <div className="chart-facesheet-grid">
        <article>
          <h3>Identity</h3>
          <dl className="chart-facts">
            <div><dt>Name</dt><dd>{get(patient, "firstName")} {get(patient, "lastName")}</dd></div>
            <div><dt>DOB / age</dt><dd>{formatDate(get(patient, "dateOfBirth"))} · {age(get(patient, "dateOfBirth"))} yr</dd></div>
            <div><dt>Sex</dt><dd>{get(patient, "sex")}</dd></div>
            <div><dt>Phone</dt><dd>{get(patient, "phone") || "—"}</dd></div>
            <div><dt>Address</dt><dd>{get(patient, "addressLine1")}, {get(patient, "city")}, {get(patient, "state")} {get(patient, "postalCode")}</dd></div>
            <div><dt>Coverage</dt><dd>{payerName || "Self pay"}{planName ? ` · ${planName}` : ""}</dd></div>
          </dl>
        </article>
        <article>
          <h3>Active problems</h3>
          <div className="chart-mini-list">{problems.length ? problems.slice(0, 8).map((row) => <div key={get(row, "id") || get(row, "code")}><strong>{get(row, "code") || "—"}</strong><span>{get(row, "description")}</span></div>) : <p>No active problems.</p>}</div>
        </article>
        <article>
          <h3>Medications</h3>
          <div className="chart-mini-list">{medications.length ? medications.slice(0, 8).map((row) => <div key={get(row, "id")}><strong>{get(row, "medicationName")}</strong><span>{get(row, "dose")} · {get(row, "frequency")}</span></div>) : <p>No active medications.</p>}</div>
        </article>
        <article>
          <h3>Allergies</h3>
          <div className="chart-mini-list">{allergies.length ? allergies.map((row) => <div key={get(row, "id")}><strong>{get(row, "substance")}</strong><span>{get(row, "severity")} · {get(row, "reaction") || "reaction not specified"}</span></div>) : <p>No allergy records.</p>}</div>
        </article>
        <article>
          <h3>Next appointment</h3>
          {upcoming ? <p><strong>{formatDate(get(upcoming, "startAt"), true)}</strong><br />{get(upcoming, "appointmentType")} · {get(upcoming, "providerName")}</p> : <p>Nothing scheduled.</p>}
        </article>
      </div>
    </div>
  );
}

export function HistoryPanel({ items, busy, onAdd }: { items: Row[]; busy: boolean; onAdd: (payload: Row) => void }) {
  const [historyType, setHistoryType] = useState("medical");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({ historyType, title, details });
    setTitle("");
    setDetails("");
  }
  const groups = ["medical", "surgical", "family", "social", "hospitalization"] as const;
  return (
    <div>
      <PanelHeader title="History" description="Longitudinal medical, surgical, family, social and hospitalization history." />
      <form className="chart-inline-form" onSubmit={submit}>
        <select disabled={busy} onChange={(e) => setHistoryType(e.target.value)} value={historyType}>
          {groups.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="History item" required value={title} />
        <input disabled={busy} onChange={(e) => setDetails(e.target.value)} placeholder="Details" value={details} />
        <button disabled={busy || !title.trim()} type="submit">Add</button>
      </form>
      <div className="chart-grouped-lists">
        {groups.map((type) => {
          const rows = items.filter((row) => get(row, "historyType") === type);
          return (
            <section key={type}>
              <h3>{type}</h3>
              {rows.length ? rows.map((row) => (
                <article key={get(row, "id")}><strong>{get(row, "title")}</strong><p>{get(row, "details") || "No details"}</p></article>
              )) : <p className="chart-empty-line">None recorded.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function ProblemsPanel({
  items, coded, busy, onAdd, onStatus,
}: {
  items: Row[]; coded: Array<{ code: string; description: string }>; busy: boolean;
  onAdd: (payload: Row) => void; onStatus: (id: string, status: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    onAdd({ description, code });
    setDescription("");
    setCode("");
  }
  return (
    <div>
      <PanelHeader title="Problems" description="Managed problem list plus diagnoses documented on visits." />
      <form className="chart-inline-form" onSubmit={submit}>
        <input disabled={busy} onChange={(e) => setCode(e.target.value)} placeholder="ICD-10 (optional)" value={code} />
        <input disabled={busy} onChange={(e) => setDescription(e.target.value)} placeholder="Problem description" required value={description} />
        <button disabled={busy || !description.trim()} type="submit">Add problem</button>
      </form>
      <div className="chart-data-grid">
        {items.map((row) => (
          <article key={get(row, "id")}>
            <div><strong>{get(row, "code") || "Uncoded"}</strong><span>{get(row, "description")}</span></div>
            <span className={`chart-status ${statusTone(get(row, "status"))}`}>{get(row, "status")}</span>
            <div className="chart-row-actions">
              {get(row, "status") === "active" && <button disabled={busy} onClick={() => onStatus(get(row, "id"), "resolved")} type="button">Resolve</button>}
              {get(row, "status") !== "inactive" && <button disabled={busy} onClick={() => onStatus(get(row, "id"), "inactive")} type="button">Inactivate</button>}
            </div>
          </article>
        ))}
        {coded.map((row) => (
          <article key={`coded-${row.code}`}>
            <div><strong>{row.code}</strong><span>{row.description}</span></div>
            <span className="chart-status waiting">from visits</span>
          </article>
        ))}
        {!items.length && !coded.length && <p className="chart-empty-line">No problems on the chart yet.</p>}
      </div>
    </div>
  );
}

export function ImmunizationsPanel({ items, busy, onAdd }: { items: Row[]; busy: boolean; onAdd: (payload: Row) => void }) {
  const [vaccineName, setVaccineName] = useState("");
  const [administeredOn, setAdministeredOn] = useState(new Date().toISOString().slice(0, 10));
  const [lotNumber, setLotNumber] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!vaccineName.trim()) return;
    onAdd({ vaccineName, administeredOn, lotNumber });
    setVaccineName("");
    setLotNumber("");
  }
  return (
    <div>
      <PanelHeader title="Immunizations" description="Vaccine administration history for this patient." />
      <form className="chart-inline-form" onSubmit={submit}>
        <input disabled={busy} onChange={(e) => setVaccineName(e.target.value)} placeholder="Vaccine name" required value={vaccineName} />
        <input disabled={busy} onChange={(e) => setAdministeredOn(e.target.value)} type="date" value={administeredOn} />
        <input disabled={busy} onChange={(e) => setLotNumber(e.target.value)} placeholder="Lot #" value={lotNumber} />
        <button disabled={busy || !vaccineName.trim()} type="submit">Record</button>
      </form>
      <div className="chart-data-grid">
        {items.length ? items.map((row) => (
          <article key={get(row, "id")}>
            <div><strong>{get(row, "vaccineName")}</strong><span>{formatDate(get(row, "administeredOn"))}{get(row, "lotNumber") ? ` · Lot ${get(row, "lotNumber")}` : ""}</span></div>
            <span className={`chart-status ${statusTone(get(row, "status"))}`}>{get(row, "status")}</span>
            <p>{get(row, "administeredByName")}</p>
          </article>
        )) : <p className="chart-empty-line">No immunizations recorded.</p>}
      </div>
    </div>
  );
}

export function AllergiesPanel({
  items, busy, onAdd, onReview, onStatus,
}: {
  items: Row[]; busy: boolean;
  onAdd: (payload: Row) => void; onReview: () => void; onStatus: (id: string, status: string) => void;
}) {
  const [substance, setSubstance] = useState("");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState("unknown");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!substance.trim()) return;
    onAdd({ substance, reaction, severity, allergyType: "drug" });
    setSubstance("");
    setReaction("");
  }
  return (
    <div>
      <PanelHeader
        title="Allergies"
        description="Drug, food and environmental allergy list with review tracking."
        action={<button disabled={busy} onClick={onReview} type="button">Mark reviewed</button>}
      />
      <form className="chart-inline-form" onSubmit={submit}>
        <input disabled={busy} onChange={(e) => setSubstance(e.target.value)} placeholder="Substance" required value={substance} />
        <input disabled={busy} onChange={(e) => setReaction(e.target.value)} placeholder="Reaction" value={reaction} />
        <select disabled={busy} onChange={(e) => setSeverity(e.target.value)} value={severity}>
          <option value="unknown">Unknown</option>
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </select>
        <button disabled={busy || !substance.trim()} type="submit">Add</button>
        <button disabled={busy} onClick={() => onAdd({ allergyType: "nkda", substance: "No known drug allergies" })} type="button">NKDA</button>
      </form>
      <div className="chart-data-grid">
        {items.length ? items.map((row) => (
          <article key={get(row, "id")}>
            <div><strong>{get(row, "substance")}</strong><span>{get(row, "allergyType")} · {get(row, "severity")}{get(row, "reaction") ? ` · ${get(row, "reaction")}` : ""}</span></div>
            <span className={`chart-status ${statusTone(get(row, "status"))}`}>{get(row, "status")}</span>
            {get(row, "status") === "active" && (
              <div className="chart-row-actions">
                <button disabled={busy} onClick={() => onStatus(get(row, "id"), "inactive")} type="button">Inactivate</button>
              </div>
            )}
          </article>
        )) : <p className="chart-empty-line">No allergies recorded.</p>}
      </div>
    </div>
  );
}

export function LabsPanel({ orders, results }: { orders: Row[]; results: Row[] }) {
  return (
    <div>
      <PanelHeader title="Labs/Studies" description="Orders and resulted laboratory, imaging and referral findings." />
      <div className="chart-split-columns">
        <section>
          <h3>Results</h3>
          <div className="chart-data-grid">
            {results.length ? results.map((row) => (
              <article key={get(row, "id")}>
                <div><strong>{get(row, "summary")}</strong><span>{get(row, "resultType")} · {formatDate(get(row, "resultedAt"), true)}</span></div>
                <span className={`chart-status ${statusTone(get(row, "abnormalFlag"))}`}>{get(row, "abnormalFlag")}</span>
                <p>{get(row, "resultData") || "No detailed values."}</p>
              </article>
            )) : <p className="chart-empty-line">No results yet.</p>}
          </div>
        </section>
        <section>
          <h3>Orders</h3>
          <div className="chart-data-grid">
            {orders.length ? orders.map((row) => (
              <article key={get(row, "id")}>
                <div><strong>{get(row, "name")}</strong><span>{get(row, "orderType")} · {formatDate(get(row, "orderedAt"), true)}</span></div>
                <span className={`chart-status ${statusTone(get(row, "status"))}`}>{get(row, "status")}</span>
                <p>{get(row, "instructions") || "No instructions."}</p>
              </article>
            )) : <p className="chart-empty-line">No orders yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function FlowsheetsPanel({ entries, busy, onAdd }: { entries: Row[]; busy: boolean; onAdd: (payload: Row) => void }) {
  const [metricKey, setMetricKey] = useState(FLOWSHEET_METRICS[0].key);
  const [value, setValue] = useState("");
  const metric = FLOWSHEET_METRICS.find((row) => row.key === metricKey) || FLOWSHEET_METRICS[0];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onAdd({ metricKey: metric.key, metricLabel: metric.label, unit: metric.unit, value });
    setValue("");
  }
  return (
    <div>
      <PanelHeader title="Flowsheets" description="Trended clinical measures across visits and chart entries." />
      <form className="chart-inline-form" onSubmit={submit}>
        <select disabled={busy} onChange={(e) => setMetricKey(e.target.value)} value={metricKey}>
          {FLOWSHEET_METRICS.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select>
        <input disabled={busy} onChange={(e) => setValue(e.target.value)} placeholder={`Value (${metric.unit})`} required value={value} />
        <button disabled={busy || !value.trim()} type="submit">Add reading</button>
      </form>
      <div className="chart-grouped-lists">
        {FLOWSHEET_METRICS.map((group) => {
          const rows = entries.filter((row) => get(row, "metricKey") === group.key);
          if (!rows.length) return null;
          return (
            <section key={group.key}>
              <h3>{group.label} ({group.unit})</h3>
              {rows.map((row) => (
                <article key={get(row, "id")}><strong>{get(row, "value")}</strong><p>{formatDate(get(row, "recordedAt"), true)} · {get(row, "recordedByName")}</p></article>
              ))}
            </section>
          );
        })}
        {!entries.length && <p className="chart-empty-line">No flowsheet readings yet.</p>}
      </div>
    </div>
  );
}

export function DemographicsPanel({ patient }: { patient: Row }) {
  return (
    <div>
      <PanelHeader
        title="Demographics"
        description="Registration identity and contact details."
        action={<Link href={`/patients?patientId=${encodeURIComponent(get(patient, "id"))}`}>Edit patient</Link>}
      />
      <dl className="chart-facts chart-facts-wide">
        <div><dt>Account</dt><dd>{get(patient, "accountNumber")}</dd></div>
        <div><dt>Legal name</dt><dd>{get(patient, "firstName")} {get(patient, "middleName")} {get(patient, "lastName")} {get(patient, "suffix")}</dd></div>
        <div><dt>Date of birth</dt><dd>{formatDate(get(patient, "dateOfBirth"))}</dd></div>
        <div><dt>Sex</dt><dd>{get(patient, "sex")}</dd></div>
        <div><dt>Marital status</dt><dd>{get(patient, "maritalStatus") || "—"}</dd></div>
        <div><dt>Status</dt><dd>{get(patient, "status")}</dd></div>
        <div><dt>Phone</dt><dd>{get(patient, "phone") || "—"}</dd></div>
        <div><dt>Email</dt><dd>{get(patient, "email") || "—"}</dd></div>
        <div><dt>Address</dt><dd>{get(patient, "addressLine1")}{get(patient, "addressLine2") ? `, ${get(patient, "addressLine2")}` : ""}, {get(patient, "city")}, {get(patient, "state")} {get(patient, "postalCode")}</dd></div>
      </dl>
    </div>
  );
}

export function AccountPanel({
  patient, coverages, payerName, planName, eligibility, claims, payments, transactions,
}: {
  patient: Row; coverages: Row[]; payerName: string; planName: string;
  eligibility: Row[]; claims: Row[]; payments: Row[]; transactions: Row[];
}) {
  return (
    <div>
      <PanelHeader title="Account" description="Coverage, eligibility, claims and ledger activity." action={<Link href="/claims">Open billing</Link>} />
      <div className="chart-split-columns">
        <section>
          <h3>Coverage</h3>
          <p><strong>{payerName || "Self pay"}</strong>{planName ? ` · ${planName}` : ""}</p>
          <div className="chart-mini-list">
            {coverages.map((row) => (
              <div key={get(row, "id")}><strong>{get(row, "priority")}</strong><span>{get(row, "memberId")} · {get(row, "status")}</span></div>
            ))}
            {!coverages.length && <p className="chart-empty-line">No coverage on file.</p>}
          </div>
          <h3>Eligibility</h3>
          <div className="chart-mini-list">
            {eligibility.slice(0, 5).map((row) => (
              <div key={get(row, "id")}><strong>{get(row, "status")}</strong><span>{formatDate(get(row, "checkedAt") || get(row, "createdAt"), true)}</span></div>
            ))}
            {!eligibility.length && <p className="chart-empty-line">No eligibility checks.</p>}
          </div>
        </section>
        <section>
          <h3>Claims · {claims.length}</h3>
          <div className="chart-data-grid">
            {claims.slice(0, 8).map((row) => (
              <article key={get(row, "id")}>
                <div><strong>{get(row, "claimNumber")}</strong><span>{formatDate(get(row, "createdAt"))}</span></div>
                <span className={`chart-status ${statusTone(get(row, "status"))}`}>{get(row, "status")}</span>
              </article>
            ))}
            {!claims.length && <p className="chart-empty-line">No claims.</p>}
          </div>
          <h3>Payments · {payments.length}</h3>
          <div className="chart-mini-list">
            {payments.slice(0, 6).map((row) => (
              <div key={get(row, "id")}><strong>{money(get(row, "amount"))}</strong><span>{get(row, "paymentType")} · {formatDate(get(row, "paymentDate") || get(row, "createdAt"))}</span></div>
            ))}
            {!payments.length && <p className="chart-empty-line">No payments posted.</p>}
          </div>
          <h3>Ledger · {transactions.length}</h3>
          <div className="chart-mini-list">
            {transactions.slice(0, 6).map((row) => (
              <div key={get(row, "id")}><strong>{money(get(row, "amount"))}</strong><span>{get(row, "transactionType") || get(row, "description") || "Ledger"} · {formatDate(get(row, "postingDate") || get(row, "createdAt"))}</span></div>
            ))}
            {!transactions.length && <p className="chart-empty-line">No ledger rows. Account {get(patient, "accountNumber")}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ChecklistPanel({
  items, busy, onEnsure, onUpdate,
}: {
  items: Row[]; busy: boolean; onEnsure: () => void; onUpdate: (id: string, status: string) => void;
}) {
  return (
    <div>
      <PanelHeader
        title="Care Checklist"
        description="Preventive and safety tasks for longitudinal care quality."
        action={<button disabled={busy} onClick={onEnsure} type="button">Refresh defaults</button>}
      />
      <div className="chart-checklist">
        {items.length ? items.map((row) => (
          <article key={get(row, "id")}>
            <div>
              <strong>{get(row, "label")}</strong>
              <span>{get(row, "category")}</span>
            </div>
            <select disabled={busy} onChange={(e) => onUpdate(get(row, "id"), e.target.value)} value={get(row, "status")}>
              <option value="pending">Pending</option>
              <option value="done">Done</option>
              <option value="deferred">Deferred</option>
              <option value="not_applicable">N/A</option>
            </select>
          </article>
        )) : <p className="chart-empty-line">Loading checklist…</p>}
      </div>
    </div>
  );
}

export function RecallPanel({
  items, busy, onAdd, onStatus,
}: {
  items: Row[]; busy: boolean;
  onAdd: (payload: Row) => void; onStatus: (id: string, status: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("routine");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim() || !dueDate) return;
    onAdd({ reason, dueDate, priority });
    setReason("");
    setDueDate("");
  }
  return (
    <div>
      <PanelHeader title="Recall" description="Outreach and return-to-clinic reminders for this patient." />
      <form className="chart-inline-form" onSubmit={submit}>
        <input disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Recall reason" required value={reason} />
        <input disabled={busy} onChange={(e) => setDueDate(e.target.value)} required type="date" value={dueDate} />
        <select disabled={busy} onChange={(e) => setPriority(e.target.value)} value={priority}>
          <option value="routine">Routine</option>
          <option value="soon">Soon</option>
          <option value="urgent">Urgent</option>
        </select>
        <button disabled={busy || !reason.trim() || !dueDate} type="submit">Create recall</button>
      </form>
      <div className="chart-data-grid">
        {items.length ? items.map((row) => (
          <article key={get(row, "id")}>
            <div><strong>{get(row, "reason")}</strong><span>Due {formatDate(get(row, "dueDate"))} · {get(row, "priority")}</span></div>
            <span className={`chart-status ${statusTone(get(row, "status") === "open" && get(row, "priority") === "urgent" ? "urgent" : get(row, "status"))}`}>{get(row, "status")}</span>
            {get(row, "status") === "open" && (
              <div className="chart-row-actions">
                <button disabled={busy} onClick={() => onStatus(get(row, "id"), "completed")} type="button">Complete</button>
                <button disabled={busy} onClick={() => onStatus(get(row, "id"), "cancelled")} type="button">Cancel</button>
              </div>
            )}
          </article>
        )) : <p className="chart-empty-line">No recalls scheduled.</p>}
      </div>
    </div>
  );
}
