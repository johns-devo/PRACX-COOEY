"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  INBOUND_STATUS_LABELS,
  SYNC_DIRECTION_LABELS,
  type SyncDirection,
  summarizeInboundEvents,
  summarizeSyncEvents,
} from "../lib/integration-dashboard";
import { workspaceBasePath, type WorkspaceVariant } from "../lib/workspace-nav";

type DataRow = Record<string, unknown>;

function value(row: DataRow | null | undefined, key: string) {
  const raw = row?.[key];
  return raw === null || raw === undefined ? "" : String(raw);
}

function parseValidationIssues(row: DataRow) {
  const raw = value(row, "validationJson");
  if (!raw) return { errors: 0, warnings: 0 };
  try {
    const parsed = JSON.parse(raw) as { issues?: Array<{ severity?: string }> };
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    return { errors, warnings };
  } catch {
    return { errors: 0, warnings: 0 };
  }
}

function Status({ value: status }: { value: string }) {
  const tone = ["accepted", "active", "configured", "clean", "posted", "success"].includes(status)
    ? "active"
    : ["rejected", "missing_integration", "unmatched", "error", "inactive"].includes(status)
      ? "danger"
      : "warning";
  return <span className={`status-pill ${tone}`}>{INBOUND_STATUS_LABELS[status as keyof typeof INBOUND_STATUS_LABELS] || status.replaceAll("_", " ")}</span>;
}

function isSpecConnector(type: string) {
  return type === "ehr_elation" || type === "stedi_edi" || type === "era_835" || type === "eligibility_270_271";
}

export function PracxIntegrationDashboard({
  data,
  variant,
  isSaving,
  onResolve,
  onOpenIntegrations,
  onIngest,
}: {
  data: {
    integrations: DataRow[];
    inboundEvents: DataRow[];
    syncEvents?: DataRow[];
  };
  variant: WorkspaceVariant;
  isSaving: boolean;
  onResolve: (id: string, status: "accepted" | "rejected" | "held") => void;
  onOpenIntegrations: () => void;
  onIngest: (bundle: unknown, format: "pracx" | "fhir") => void;
}) {
  const base = workspaceBasePath(variant);
  const inbound = data.inboundEvents || [];
  const syncEvents = data.syncEvents || [];
  const summary = summarizeInboundEvents(inbound);
  const syncSummary = summarizeSyncEvents(syncEvents);
  const connectors = data.integrations.filter((row) => isSpecConnector(value(row, "integrationType")));
  const elationInbound = inbound.filter((row) => value(row, "sourceSystem") === "elation");
  const stediInbound = inbound.filter((row) => value(row, "sourceSystem") === "stedi");
  const blocked = inbound.filter((row) => value(row, "status") !== "accepted");
  const needsAttention = blocked.filter((row) => ["unmatched", "held", "pending", "missing_integration"].includes(value(row, "status")));
  const lifecycleOpen = syncEvents.filter((row) => ["pending", "error"].includes(value(row, "status")));
  const [ingestText, setIngestText] = useState("");
  const [ingestFormat, setIngestFormat] = useState<"pracx" | "fhir">("fhir");
  const ingestParsed = useMemo(() => {
    if (!ingestText.trim()) return { ok: true, value: null as unknown };
    try {
      return { ok: true, value: JSON.parse(ingestText) as unknown };
    } catch (error) {
      return { ok: false, value: error };
    }
  }, [ingestText]);

  return (
    <>
      <section className="pracx-dash-hero">
        <div>
          <span className="eyebrow">Two-way integration</span>
          <h2>Elation ↔ PRACX ↔ Stedi</h2>
          <p>
            Pull clinical claim inputs from Elation, submit EDI through Stedi, bring acknowledgements and ERA back into PRACX,
            then push claim lifecycle status back to Elation.
          </p>
        </div>
        <div className="pracx-dash-hero-actions">
          <button className="secondary-button" onClick={onOpenIntegrations} type="button">Open Integrations</button>
          <Link className="primary-button" href={`${base}/claims` || "/claims"}>Go to Claim prep</Link>
        </div>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <h2>Inbound intake</h2>
            <p>Submit an EHR bundle to the validation bridge before it reaches claim prep.</p>
          </div>
          <div className="pracx-format-switch" role="group" aria-label="Bundle format">
            <button
              className={ingestFormat === "fhir" ? "selected" : ""}
              onClick={() => setIngestFormat("fhir")}
              type="button"
            >
              FHIR R4
            </button>
            <button
              className={ingestFormat === "pracx" ? "selected" : ""}
              onClick={() => setIngestFormat("pracx")}
              type="button"
            >
              PRACX v1
            </button>
          </div>
        </div>
        <div className="pracx-ingest">
          <textarea
            aria-label="Inbound bundle"
            onChange={(event) => setIngestText(event.target.value)}
            placeholder={
              ingestFormat === "fhir"
                ? '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient"}},{"resource":{"resourceType":"Appointment"}}]}'
                : '{"schemaVersion":"1","sourceSystem":"elation","eventType":"day_appointment","patient":{},"appointment":{},"mapping":{}}'
            }
            value={ingestText}
          />
          {!ingestParsed.ok && <div className="notice error">{(ingestParsed.value as Error).message}</div>}
          <div className="pracx-ingest-actions">
            <button
              className="primary-button"
              disabled={!ingestParsed.ok || !ingestText.trim() || isSaving}
              onClick={() => {
                if (!ingestParsed.ok) return;
                onIngest(ingestParsed.value, ingestFormat);
                setIngestText("");
              }}
              type="button"
            >
              Validate and queue
            </button>
            <span className="pracx-ingest-hint">
              {ingestFormat === "fhir"
                ? "Patient and Appointment resources required. Practitioner needs a US NPI identifier."
                : "Patient, appointment and provider mapping are required."}
            </span>
          </div>
        </div>
      </section>

      <section className="pracx-flow-lane" aria-label="Integration directions">
        {syncSummary.byDirection.map((lane) => (
          <article key={lane.direction}>
            <span className="eyebrow">{lane.title}</span>
            <strong>{lane.total}</strong>
            <p>{lane.subtitle}</p>
            <small>{lane.success} ok · {lane.pending} pending · {lane.error} error</small>
          </article>
        ))}
      </section>

      <section className="pracx-dash-metrics" aria-label="Intake and sync summary">
        <article><small>Elation pull events</small><strong>{elationInbound.length}</strong><p>Patients / encounters / insurance</p></article>
        <article className="tone-ok"><small>Accepted into PRACX</small><strong>{summary.accepted}</strong><p>{summary.acceptanceRate}% of inbound</p></article>
        <article className="tone-warn"><small>Stuck mid-flight</small><strong>{summary.pending + summary.unmatched}</strong><p>Held, pending, or identity mismatch</p></article>
        <article><small>Stedi inbound</small><strong>{stediInbound.length}</strong><p>999 / 277CA / 835</p></article>
        <article className="tone-ok"><small>Lifecycle sync OK</small><strong>{syncSummary.success}</strong><p>Two-way claim events</p></article>
        <article className="tone-warn"><small>Lifecycle open</small><strong>{syncSummary.pendingOrError}</strong><p>Pending push or error</p></article>
      </section>

      <div className="pracx-dash-split">
        <section className="table-card">
          <div className="table-header">
            <div>
              <h2>By source system</h2>
              <p>Only Elation and Stedi feed this practice — accepted vs blocked.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Source</th><th>Received</th><th>Accepted</th><th>Not accepted</th><th>Acceptance</th></tr>
              </thead>
              <tbody>
                {summary.bySource.length ? summary.bySource.map((row) => (
                  <tr key={row.system}>
                    <td><strong>{row.label}</strong><small className="address">{row.system}</small></td>
                    <td>{row.total}</td>
                    <td>{row.accepted}</td>
                    <td>{row.blocked}</td>
                    <td>{row.total ? `${Math.round((row.accepted / row.total) * 100)}%` : "—"}</td>
                  </tr>
                )) : <tr><td colSpan={5}>No inbound events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-card">
          <div className="table-header">
            <div>
              <h2>Top block reasons</h2>
              <p>Why Elation / Stedi data did not land cleanly in PRACX.</p>
            </div>
          </div>
          <ul className="pracx-reason-list">
            {summary.topReasons.length ? summary.topReasons.map((row) => (
              <li key={row.code}>
                <strong>{row.code.replaceAll("_", " ")}</strong>
                <b>{row.count}</b>
              </li>
            )) : <li>No blocking reasons recorded.</li>}
          </ul>
        </section>
      </div>

      <section className="table-card">
        <div className="table-header">
          <div>
            <h2>Spec connectors</h2>
            <p>Elation EHR API and Stedi EDI — the only two-way partners for this build.</p>
          </div>
        </div>
        <div className="pracx-connector-grid">
          {connectors.length ? connectors.map((row) => (
            <article key={value(row, "id")}>
              <span className="eyebrow">{value(row, "integrationType").replaceAll("_", " ")}</span>
              <strong>{value(row, "vendorName")}</strong>
              <Status value={value(row, "status")} />
              <small>{value(row, "mode")} mode{value(row, "endpoint") ? ` · ${value(row, "endpoint")}` : ""}</small>
            </article>
          )) : <p className="empty-hint">Configure Elation and Stedi under Integrations.</p>}
        </div>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <h2>Claim lifecycle sync</h2>
            <p>Every important claim event reflected in PRACX and pushed back to Elation when status changes.</p>
          </div>
          <span className="demo-pill">{lifecycleOpen.length} open</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Direction</th>
                <th>Event</th>
                <th>Claim</th>
                <th>External ref</th>
                <th>Status</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {syncEvents.length ? syncEvents.map((row) => {
                const direction = value(row, "direction") as SyncDirection;
                const labels = SYNC_DIRECTION_LABELS[direction];
                return (
                  <tr key={value(row, "id")}>
                    <td>{new Date(value(row, "occurredAt")).toLocaleString()}</td>
                    <td><strong>{labels?.title || direction.replaceAll("_", " ")}</strong></td>
                    <td>{value(row, "eventType").replaceAll("_", " ")}</td>
                    <td className="mono">{value(row, "claimNumber") || "—"}</td>
                    <td className="mono">{value(row, "externalRef") || "—"}</td>
                    <td><Status value={value(row, "status")} /></td>
                    <td><small>{value(row, "summary")}</small></td>
                  </tr>
                );
              }) : <tr><td colSpan={7}>No claim lifecycle sync events yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <h2>Needs attention</h2>
            <p>Elation pull or Stedi ack/ERA stuck mid-flight — mismatch, incomplete payload, or review hold.</p>
          </div>
          <span className="demo-pill">{needsAttention.length} open</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Source</th>
                <th>Type</th>
                <th>External ref</th>
                <th>External patient</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {needsAttention.length ? needsAttention.map((row) => (
                <tr key={value(row, "id")}>
                  <td>{new Date(value(row, "receivedAt")).toLocaleString()}</td>
                  <td><strong>{value(row, "sourceLabel")}</strong></td>
                  <td>{value(row, "eventType").replaceAll("_", " ")}</td>
                  <td className="mono">{value(row, "externalId") || "—"}</td>
                  <td>
                    <strong>{value(row, "patientNameExternal") || "—"}</strong>
                    <small className="address">{value(row, "patientDobExternal") || value(row, "externalId") || ""}</small>
                  </td>
                  <td><Status value={value(row, "status")} /></td>
                  <td>
                    <strong className="location-name">{value(row, "reasonCode").replaceAll("_", " ") || "—"}</strong>
                    <small className="address">{value(row, "reasonDetail") || value(row, "payloadSummary")}</small>
                    {(() => {
                      const { errors, warnings } = parseValidationIssues(row);
                      const appliedEncounterId = value(row, "appliedEncounterId");
                      const applied = appliedEncounterId ? `Applied → ${appliedEncounterId}` : "";
                      const counts = (errors || warnings) ? `${errors} error · ${warnings} warn` : "";
                      const text = [counts, applied].filter(Boolean).join(" · ");
                      return text ? <small className="address mono">{text}</small> : null;
                    })()}
                  </td>
                  <td>
                    <div className="row-actions">
                      {value(row, "status") !== "missing_integration" && (
                        <>
                          <button disabled={isSaving} onClick={() => onResolve(value(row, "id"), "accepted")} type="button">{["held", "pending", "unmatched"].includes(value(row, "status")) ? "Reprocess & accept" : "Accept"}</button>
                          <button disabled={isSaving} onClick={() => onResolve(value(row, "id"), "held")} type="button">Hold</button>
                          <button disabled={isSaving} onClick={() => onResolve(value(row, "id"), "rejected")} type="button">Reject</button>
                        </>
                      )}
                      {value(row, "status") === "missing_integration" && (
                        <button onClick={onOpenIntegrations} type="button">Fix connector</button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={8}>No blocked inbound items. All current payloads were accepted.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <h2>Full inbound log</h2>
            <p>Elation pulls and Stedi acknowledgements / ERA — including accepted ones.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Received</th><th>Source</th><th>External ID</th><th>Patient</th><th>Status</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {inbound.map((row) => (
                <tr key={value(row, "id")}>
                  <td>{new Date(value(row, "receivedAt")).toLocaleString()}</td>
                  <td>{value(row, "sourceLabel")}</td>
                  <td className="mono">{value(row, "externalId") || "—"}</td>
                  <td>{value(row, "patientNameExternal") || "—"}</td>
                  <td><Status value={value(row, "status")} /></td>
                  <td><small>{value(row, "payloadSummary") || value(row, "reasonDetail") || "—"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
