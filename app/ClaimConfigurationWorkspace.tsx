"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { LocalUser } from "../lib/auth";

type Row = Record<string, unknown>;
type Payload = {
  categories: Record<string, string>;
  values: Row[];
  history: Row[];
  payers: Row[];
  error?: string;
};

const emptyForm = {
  id: "",
  category: "insurance_type",
  code: "",
  displayName: "",
  internalGuidance: "",
  payerId: "",
  effectiveDate: "",
  terminationDate: "",
  status: "active",
  isOfficial: "no",
};

function text(row: Row, key: string) {
  return row[key] === null || row[key] === undefined ? "" : String(row[key]);
}

export function ClaimConfigurationWorkspace({ currentUser }: { currentUser: LocalUser }) {
  const [data, setData] = useState<Payload | null>(null);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/claim-configuration");
    const body = await response.json() as Payload;
    if (!response.ok) throw new Error(body.error || "Unable to load claim configuration.");
    setData(body);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((reason: Error) => setError(reason.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => (data?.values || []).filter((row) => {
    const matchesCategory = category === "all" || text(row, "category") === category;
    const haystack = `${text(row, "code")} ${text(row, "displayName")} ${text(row, "internalGuidance")}`.toLowerCase();
    return matchesCategory && haystack.includes(search.toLowerCase());
  }), [category, data, search]);

  function edit(row: Row) {
    setForm({
      id: text(row, "id"),
      category: text(row, "category"),
      code: text(row, "code"),
      displayName: text(row, "displayName"),
      internalGuidance: text(row, "internalGuidance"),
      payerId: text(row, "payerId"),
      effectiveDate: text(row, "effectiveDate"),
      terminationDate: text(row, "terminationDate"),
      status: text(row, "status") || "active",
      isOfficial: text(row, "isOfficial"),
    });
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/claim-configuration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: form.id ? "update" : "create", ...form }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to save the value.");
      await load();
      setMessage(form.id ? "Configuration updated and audited." : "Custom configuration value added.");
      setForm(emptyForm);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the value.");
    } finally {
      setSaving(false);
    }
  }

  const official = form.isOfficial === "yes";
  return <main className="claim-config-page">
    <header className="claim-config-header">
      <div><span className="eyebrow">Administrator controls</span><h1>Claim configuration</h1><p>Manage active billing values without changing the official NUCC/CMS identities used for compliance.</p></div>
      <div className="claim-config-account"><strong>{currentUser.fullName}</strong><span>Administrator</span><Link href="/claims">Return to claims</Link></div>
    </header>

    <section className="claim-config-summary">
      <article><strong>{data?.values.length || 0}</strong><span>Configured values</span></article>
      <article><strong>{data?.values.filter((row) => text(row, "status") === "active").length || 0}</strong><span>Active</span></article>
      <article><strong>{data?.values.filter((row) => text(row, "isOfficial") === "no").length || 0}</strong><span>Custom / payer values</span></article>
      <article><strong>{data?.history.length || 0}</strong><span>Recent audited changes</span></article>
    </section>

    <div className="claim-config-layout">
      <section className="claim-config-list">
        <div className="claim-config-toolbar">
          <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All CMS-1500 categories</option>
            {Object.entries(data?.categories || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input aria-label="Search configuration values" placeholder="Search code or description" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button onClick={() => setForm(emptyForm)} type="button">Add custom value</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <div className="table-wrap"><table><thead><tr><th>Category</th><th>Code</th><th>Description</th><th>Source</th><th>Effective</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((row) => <tr key={text(row, "id")}><td>{data?.categories[text(row, "category")] || text(row, "category")}</td><td className="mono"><strong>{text(row, "code")}</strong></td><td><strong>{text(row, "displayName")}</strong><small className="address">{text(row, "internalGuidance") || "No internal guidance"}</small></td><td><span className={text(row, "isOfficial") === "yes" ? "config-source official" : "config-source custom"}>{text(row, "isOfficial") === "yes" ? "Official" : "Custom"}</span>{text(row, "payerId") && <small className="address">Payer override</small>}</td><td>{text(row, "effectiveDate") || "Open"}{text(row, "terminationDate") && <small className="address">Through {text(row, "terminationDate")}</small>}</td><td><span className={`status-pill ${text(row, "status") === "active" ? "active" : "inactive"}`}>{text(row, "status")}</span></td><td><button className="table-button" onClick={() => edit(row)} type="button">Edit</button></td></tr>)}
        </tbody></table></div>
      </section>

      <aside className="claim-config-editor">
        <span className="eyebrow">{form.id ? "Edit value" : "New custom value"}</span>
        <h2>{official ? `${form.code} · Official code` : form.id ? "Custom configuration" : "Add payer or practice value"}</h2>
        {official && <p className="config-lock-note">The official category, code and published description are locked. Administrators can control availability, dates and internal guidance.</p>}
        <form onSubmit={save}>
          <label>Category<select disabled={official} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{Object.entries(data?.categories || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Code<input disabled={official} required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></label>
          <label>Published description<input disabled={official} required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label>Internal guidance<textarea rows={3} value={form.internalGuidance} onChange={(event) => setForm({ ...form, internalGuidance: event.target.value })} /></label>
          {!official && <label>Payer override<select value={form.payerId} onChange={(event) => setForm({ ...form, payerId: event.target.value })}><option value="">Practice-wide</option>{(data?.payers || []).map((payer) => <option key={text(payer, "id")} value={text(payer, "id")}>{text(payer, "name")}</option>)}</select></label>}
          <div className="config-date-grid"><label>Effective date<input placeholder="YYYY-MM-DD" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} /></label><label>Termination date<input placeholder="YYYY-MM-DD" value={form.terminationDate} onChange={(event) => setForm({ ...form, terminationDate: event.target.value })} /></label></div>
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <button className="config-save" disabled={saving} type="submit">{saving ? "Saving…" : form.id ? "Save audited change" : "Add custom value"}</button>
        </form>
      </aside>
    </div>
  </main>;
}
