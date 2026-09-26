"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LocalUser } from "../lib/auth";
import { setupTabHref, type WorkspaceVariant } from "../lib/workspace-nav";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type FeeRow = { id: string; codeSet: string; code: string; description: string; medicareAllowed: string; defaultCharge: string; chargeOverride: string; updatedAt: string; source: string };
function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += character;
  }
  values.push(current.trim());
  return values;
}

export function FeeSetupWorkspace({ currentUser, variant = "operations" }: { currentUser: LocalUser; variant?: WorkspaceVariant }) {
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { medicareAllowed: string; defaultCharge: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/fee-setup", { signal });
    const body = await response.json() as { rows?: FeeRow[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Unable to load Medicare fees.");
    setRows(body.rows || []);
    setDrafts(Object.fromEntries((body.rows || []).map((row) => [row.id, { medicareAllowed: row.medicareAllowed, defaultCharge: row.defaultCharge }])));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    const start = window.setTimeout(() => {
      load(controller.signal).catch((reason: Error) => setError(reason.name === "AbortError" ? "Loading Fee setup timed out. Please retry." : reason.message)).finally(() => setLoading(false));
    }, 0);
    return () => { window.clearTimeout(start); window.clearTimeout(timeout); controller.abort(); };
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/fee-setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json() as { error?: string; imported?: number };
    if (!response.ok) throw new Error(body.error || "Unable to save Medicare fees.");
    return body;
  }

  async function upload(file?: File) {
    if (!file) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("Choose a CSV with a header row and at least one CPT/HCPCS fee.");
      const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const codeIndex = indexOf("code", "cpt", "hcpcs", "procedurecode");
      const descriptionIndex = indexOf("description", "shortdescription", "longdescription");
      const rateIndex = indexOf("medicareallowed", "medicarefee", "allowedamount", "allowed", "paymentamount", "rate", "amount");
      const setIndex = indexOf("codeset", "type");
      if (codeIndex < 0 || descriptionIndex < 0 || rateIndex < 0) throw new Error("CSV must contain code, description, and Medicare allowed amount columns. Example: code,codeSet,description,medicareAllowed.");
      const parsed = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        return { code: values[codeIndex], codeSet: setIndex >= 0 ? values[setIndex] : "CPT", description: values[descriptionIndex], medicareAllowed: values[rateIndex] };
      }).filter((item) => item.code && item.description && item.medicareAllowed);
      const result = await post({ action: "import", rows: parsed });
      await load(); setNotice(`${result.imported || 0} CPT/HCPCS Medicare fee(s) uploaded. Default charges calculated at 150%, rounded to the nearest $10.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to upload Medicare fee file."); }
    finally { setSaving(false); }
  }

  async function saveRow(row: FeeRow) {
    const draft = drafts[row.id];
    if (!draft) return;
    const medicareChanged = draft.medicareAllowed !== row.medicareAllowed;
    const chargeChanged = draft.defaultCharge !== row.defaultCharge;
    if (!medicareChanged && !chargeChanged) return;
    setSaving(true); setError(""); setNotice("");
    try {
      if (medicareChanged) await post({ action: "update", id: row.id, field: "medicareAllowed", value: draft.medicareAllowed });
      if (chargeChanged) await post({ action: "update", id: row.id, field: "defaultCharge", value: draft.defaultCharge });
      await load(); setNotice(`${row.codeSet} ${row.code} updated.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update fee."); }
    finally { setSaving(false); }
  }

  async function retry() {
    setLoading(true); setError("");
    try { await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Medicare fees."); }
    finally { setLoading(false); }
  }

  return <div className="app-shell"><WorkspaceSidebar activeKey="fee_setup" currentUser={currentUser} variant={variant} />
    <main className="main claim-config-page fee-setup-page">
      <header className="claim-config-header"><div><span className="eyebrow">Configuration · Fees</span><h1>Medicare fee setup</h1><p>Upload the Medicare fee file, then maintain your CPT/HCPCS charges in one list.</p></div><div className="claim-config-account"><strong>{currentUser.fullName}</strong><span>Administrator</span><Link href={setupTabHref(variant, "/setup/fee-schedules")}>Payer fee schedules →</Link></div></header>
      <section className="fee-upload-card"><div><span className="eyebrow">Medicare fee file</span><h2>Upload or update fees</h2><p>Each uploaded Medicare allowed amount sets the default CPT charge to 150%, rounded to the nearest $10.</p><small>CSV columns: code, description, medicareAllowed. Optional: codeSet (CPT or HCPCS). Uploading a code again updates its Medicare amount, default charge, and updated date.</small></div><label className={`fee-upload-button ${saving ? "disabled" : ""}`}>＋ Upload Medicare fees<input type="file" accept=".csv,text/csv" disabled={saving} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></section>
      <div className="fee-reference-note"><strong>How to use the amounts:</strong> Default charge is the practice’s charge for the CPT. Medicare allowed is a reference for checking payment; it is not the payer contract rate. Use the appropriate Medicare fee file for your practice.</div>
      {error && <div className="notice error" role="alert">{error} <button className="table-button" onClick={() => void retry()} type="button">Retry</button></div>}
      {notice && <div className="notice success" role="status">{notice}</div>}
      <section className="fee-setup-card fee-rates-card"><div className="fee-setup-card-heading"><div><span className="eyebrow">Fee list</span><h2>Procedure code fees</h2></div><span className="fee-count">{rows.length} codes</span></div>
        {loading ? <div className="loading-state" role="status">Loading fee list…</div> : <div className="table-wrap fee-rates-table"><table><thead><tr><th>CPT / HCPCS</th><th>Description</th><th>Medicare allowed</th><th>Default charge · 150% rounded to $10</th><th>Updated</th><th /></tr></thead><tbody>
          {rows.map((row) => { const draft = drafts[row.id] || { medicareAllowed: row.medicareAllowed, defaultCharge: row.defaultCharge }; const dirty = draft.medicareAllowed !== row.medicareAllowed || draft.defaultCharge !== row.defaultCharge; return <tr key={row.id}><td><strong>{row.codeSet} {row.code}</strong></td><td>{row.description}</td><td><label className="fee-inline-edit"><span className="sr-only">Medicare allowed for {row.code}</span><b>$</b><input aria-label={`Medicare allowed for ${row.code}`} inputMode="decimal" value={draft.medicareAllowed} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, medicareAllowed: event.target.value } })} /></label></td><td><div className="fee-charge-cell"><label className="fee-inline-edit"><span className="sr-only">Default charge for {row.code}</span><b>$</b><input aria-label={`Default charge for ${row.code}`} inputMode="decimal" value={draft.defaultCharge} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, defaultCharge: event.target.value } })} /></label><small className={row.chargeOverride === "yes" ? "manual-fee-badge" : "auto-fee-badge"}>{row.chargeOverride === "yes" ? "Manual" : "150% default"}</small></div></td><td><time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleDateString()}</time></td><td><button className="table-button" type="button" disabled={saving || !dirty} onClick={() => void saveRow(row)}>{saving ? "Saving…" : "Save"}</button></td></tr>; })}
          {!rows.length && <tr><td colSpan={6} className="empty-state">No Medicare fees uploaded yet. Upload a CSV to create the CPT/HCPCS fee list.</td></tr>}
        </tbody></table></div>}
      </section>
    </main>
  </div>;
}
