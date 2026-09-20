"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { LocalUser } from "../lib/auth";
import { claimFieldHints } from "../lib/cms1500";
import { ClaimFieldHint } from "./ClaimFieldHint";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { type WorkspaceVariant, setupTabHref } from "../lib/workspace-nav";

type Facility = {
  id: string;
  name: string;
  code: string;
  facilityType: string;
  npi: string | null;
  phone: string | null;
  timezone: string;
  status: "active" | "inactive";
  locationName: string | null;
  placeOfServiceCode: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

type FacilityResponse = {
  organization: {
    legalName: string;
    dbaName: string | null;
    organizationNpi: string | null;
    status: "active" | "inactive";
  } | null;
  practiceSettings: { schedulerSlotMinutes: string };
  facilities: Facility[];
  summary: { total: number; active: number };
  error?: string;
};

const initialForm = {
  name: "",
  code: "",
  facilityType: "Medical office",
  npi: "",
  phone: "",
  email: "",
  locationName: "Main service location",
  placeOfServiceCode: "11",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  timezone: "America/New_York",
  status: "active",
};

const setupItemsFor = (variant: WorkspaceVariant) => [
  { label: "Organization", href: "#" },
  { label: "Facilities", href: setupTabHref(variant, "/setup") },
  { label: "Providers", href: setupTabHref(variant, "/setup/providers") },
  { label: "Referring providers", href: setupTabHref(variant, "/setup/referring-providers") },
  { label: "Payers & plans", href: setupTabHref(variant, "/setup/payers") },
  { label: "Fee schedules", href: setupTabHref(variant, "/setup/fee-schedules") },
  { label: "Procedure codes", href: setupTabHref(variant, "/setup/procedure-codes") },
  { label: "Scheduler settings", href: "#scheduler-settings" },
];

export function FacilityWorkspace({
  currentUser,
  onboardingCompleted,
  variant = "operations",
}: {
  currentUser: LocalUser;
  onboardingCompleted: boolean;
  variant?: WorkspaceVariant;
}) {
  const [data, setData] = useState<FacilityResponse | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [isModalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [isSaving, setSaving] = useState(false);
  const [isCompleting, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [schedulerSlotMinutes, setSchedulerSlotMinutes] = useState("15");
  const [savingSchedulerSettings, setSavingSchedulerSettings] = useState(false);

  const loadFacilities = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    const response = await fetch(`/api/facilities?${params}`);
    const body = (await response.json()) as FacilityResponse;
    if (!response.ok) throw new Error(body.error || "Unable to load facilities.");
    setData(body);
    setSchedulerSlotMinutes(body.practiceSettings?.schedulerSlotMinutes || "15");
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFacilities().catch((reason: Error) => setError(reason.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadFacilities]);

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitFacility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/facilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to save facility.");
      setModalOpen(false);
      setForm(initialForm);
      setNotice("Facility and primary service location created.");
      await loadFacilities();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save facility.");
    } finally {
      setSaving(false);
    }
  }

  const total = data?.summary.total ?? 0;
  const active = data?.summary.active ?? 0;
  const setupItems = setupItemsFor(variant);

  async function finishSetup() {
    setCompleting(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding/complete", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to complete setup.");
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete setup.");
      setCompleting(false);
    }
  }

  async function saveSchedulerSettings() {
    setSavingSchedulerSettings(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/practice-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedulerSlotMinutes }),
      });
      const body = (await response.json()) as { schedulerSlotMinutes?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to save scheduler settings.");
      setSchedulerSlotMinutes(body.schedulerSlotMinutes || schedulerSlotMinutes);
      setNotice(`Scheduler interval saved as ${body.schedulerSlotMinutes || schedulerSlotMinutes} minutes.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save scheduler settings.");
    } finally {
      setSavingSchedulerSettings(false);
    }
  }

  return (
    <div className="app-shell">
      <WorkspaceSidebar activeKey="setup" currentUser={currentUser} variant={variant} />

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Configuration / Practice setup</span>
            <h1>Organization & facilities</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications" type="button">
              <span aria-hidden="true">•</span>
            </button>
            <button className="primary-button" onClick={() => setModalOpen(true)} type="button">
              <span aria-hidden="true">＋</span>
              Add facility
            </button>
          </div>
        </header>

        <section className="content">
          {!onboardingCompleted && variant === "operations" && (
            <section className="onboarding-banner">
              <div className="onboarding-progress">1</div>
              <div>
                <span className="micro-label">Initial organization setup</span>
                <h2>Complete the foundation, then enter your dashboard</h2>
                <p>
                  This setup appears only until the organization is activated. You can return
                  here later from Configuration.
                </p>
              </div>
              <div className="onboarding-actions">
                <span>Foundation data</span>
                <strong>{total > 0 ? "Ready to continue" : "Facility required"}</strong>
                <button
                  className="primary-button"
                  disabled={isCompleting || total < 1}
                  onClick={finishSetup}
                  type="button"
                >
                  {isCompleting ? "Completing…" : "Finish initial setup"}
                </button>
              </div>
            </section>
          )}

          <div className="section-tabs" role="tablist" aria-label="Practice setup sections">
            {setupItems.map((item) => (
              <Link
                aria-selected={item.label === "Facilities"}
                className={item.label === "Facilities" ? "selected" : ""}
                href={item.href}
                key={item.label}
                role="tab"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {notice && <div className="notice success">{notice}</div>}
          {error && <div className="notice error">{error}</div>}

          <section className="organization-card">
            <div className="org-monogram">PH</div>
            <div className="org-details">
              <span className="micro-label">Parent organization</span>
              <h2>{data?.organization?.legalName || "PRACX Health Network, PLLC"}</h2>
              <div className="org-meta">
                <span>DBA {data?.organization?.dbaName || "PRACX Care"}</span>
                <span>NPI {data?.organization?.organizationNpi || "—"}</span>
                <span className="status-pill active">Active</span>
              </div>
            </div>
            <button className="secondary-button" type="button">Organization details</button>
          </section>

          <section className="scheduler-settings-card" id="scheduler-settings">
            <div><span className="micro-label">Scheduler configuration</span><h2>Appointment time interval</h2><p>Controls the clickable time divisions shown across every provider schedule. Existing appointments are not changed.</p></div>
            <label>Calendar interval<select aria-label="Scheduler time interval" disabled={currentUser.role.toLowerCase() !== "administrator"} onChange={(event) => setSchedulerSlotMinutes(event.target.value)} value={schedulerSlotMinutes}><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label>
            <div><strong>{schedulerSlotMinutes} minute slots</strong><small>{60 / Number(schedulerSlotMinutes)} selectable start times per hour</small><button className="primary-button" disabled={savingSchedulerSettings || currentUser.role.toLowerCase() !== "administrator"} onClick={saveSchedulerSettings} type="button">{savingSchedulerSettings ? "Saving…" : "Save scheduler setting"}</button></div>
          </section>

          <section className="stats-grid" aria-label="Facility summary">
            <article>
              <span>Total facilities</span>
              <strong>{total}</strong>
              <small>Across the organization</small>
            </article>
            <article>
              <span>Active facilities</span>
              <strong>{active}</strong>
              <small>Available for scheduling</small>
            </article>
            <article>
              <span>Service locations</span>
              <strong>{total}</strong>
              <small>Primary locations configured</small>
            </article>
            <article>
              <span>Setup health</span>
              <strong className="health-value">{total ? "Ready" : "Start"}</strong>
              <small>{total ? "Core facility data present" : "Add your first facility"}</small>
            </article>
          </section>

          <section className="table-card">
            <div className="table-header">
              <div>
                <h2>Facilities</h2>
                <p>Manage care sites, billing identifiers and primary service locations.</p>
              </div>
              <div className="filters">
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="Search facilities"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, code, NPI or city"
                    value={search}
                  />
                </label>
                <select
                  aria-label="Filter facilities by status"
                  onChange={(event) => setStatus(event.target.value)}
                  value={status}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Facility</th>
                    <th>Primary location</th>
                    <th>POS</th>
                    <th>NPI</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.facilities.map((facility) => (
                    <tr key={facility.id}>
                      <td>
                        <div className="facility-name">
                          <span>{facility.code.slice(0, 2)}</span>
                          <div>
                            <strong>{facility.name}</strong>
                            <small>{facility.code} · {facility.facilityType}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong className="location-name">{facility.locationName}</strong>
                        <small className="address">
                          {facility.addressLine1}, {facility.city}, {facility.state} {facility.postalCode}
                        </small>
                      </td>
                      <td>
                        <span className="pos-badge">{facility.placeOfServiceCode}</span>
                      </td>
                      <td className="mono">{facility.npi || "Not set"}</td>
                      <td><span className={`status-pill ${facility.status}`}>{facility.status}</span></td>
                      <td><button className="row-action" aria-label={`Open ${facility.name}`} type="button">•••</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.facilities.length === 0 && (
                <div className="empty-state">
                  <span>01</span>
                  <h3>{search || status !== "all" ? "No matching facilities" : "Create your first facility"}</h3>
                  <p>
                    {search || status !== "all"
                      ? "Adjust the search or status filter."
                      : "A facility connects providers, schedules, service locations and billing identifiers."}
                  </p>
                  {!search && status === "all" && (
                    <button className="primary-button" onClick={() => setModalOpen(true)} type="button">
                      Add facility
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="facility-modal-title" aria-modal="true" className="modal" role="dialog">
            <div className="modal-header">
              <div>
                <span className="eyebrow">Practice setup</span>
                <h2 id="facility-modal-title">Add facility</h2>
                <p>Create the facility and its primary service location.</p>
              </div>
              <button className="close-button" aria-label="Close dialog" onClick={() => setModalOpen(false)} type="button">×</button>
            </div>

            <form onSubmit={submitFacility}>
              <fieldset>
                <legend>Facility identity</legend>
                <div className="form-grid">
                  <label className="field span-2">
                    Facility name <span><b>*</b><ClaimFieldHint hint={claimFieldHints.facilityName} /></span>
                    <input
                      autoFocus
                      onChange={(event) => updateField("name", event.target.value)}
                      placeholder="e.g. Midtown Medical Center"
                      required
                      value={form.name}
                    />
                  </label>
                  <label className="field">
                    Facility code <span><b>*</b><ClaimFieldHint hint={claimFieldHints.facilityCode} /></span>
                    <input
                      maxLength={12}
                      onChange={(event) => updateField("code", event.target.value.toUpperCase())}
                      placeholder="MIDTOWN"
                      required
                      value={form.code}
                    />
                  </label>
                  <label className="field">
                    Facility type <span><b>*</b><ClaimFieldHint hint={claimFieldHints.facilityType} /></span>
                    <select onChange={(event) => updateField("facilityType", event.target.value)} value={form.facilityType}>
                      <option>Medical office</option>
                      <option>Independent clinic</option>
                      <option>Outpatient hospital</option>
                      <option>Laboratory</option>
                      <option>Telehealth</option>
                    </select>
                  </label>
                  <label className="field">
                    Facility NPI <ClaimFieldHint hint={claimFieldHints.facilityNpi} />
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) => updateField("npi", event.target.value.replace(/\D/g, ""))}
                      placeholder="10 digits"
                      value={form.npi}
                    />
                  </label>
                  <label className="field">
                    Phone <ClaimFieldHint hint={claimFieldHints.facilityPhone} />
                    <input onChange={(event) => updateField("phone", event.target.value)} placeholder="(555) 000-0000" value={form.phone} />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Primary service location</legend>
                <div className="form-grid">
                  <label className="field">
                    Location name <span><b>*</b><ClaimFieldHint hint={claimFieldHints.serviceLocation} /></span>
                    <input onChange={(event) => updateField("locationName", event.target.value)} required value={form.locationName} />
                  </label>
                  <label className="field">
                    Place of service <span><b>*</b><ClaimFieldHint hint={claimFieldHints.placeOfService} /></span>
                    <select onChange={(event) => updateField("placeOfServiceCode", event.target.value)} value={form.placeOfServiceCode}>
                      <option value="11">11 — Office</option>
                      <option value="22">22 — Outpatient hospital</option>
                      <option value="49">49 — Independent clinic</option>
                      <option value="81">81 — Independent laboratory</option>
                    </select>
                  </label>
                  <label className="field span-2">
                    Address line 1 <span><b>*</b><ClaimFieldHint hint={claimFieldHints.serviceLocation} /></span>
                    <input onChange={(event) => updateField("addressLine1", event.target.value)} placeholder="Street address" required value={form.addressLine1} />
                  </label>
                  <label className="field">
                    City <span><b>*</b><ClaimFieldHint hint={claimFieldHints.serviceLocation} /></span>
                    <input onChange={(event) => updateField("city", event.target.value)} required value={form.city} />
                  </label>
                  <div className="field-row">
                    <label className="field compact">
                      State <span><b>*</b><ClaimFieldHint hint={claimFieldHints.serviceLocation} /></span>
                      <input maxLength={2} onChange={(event) => updateField("state", event.target.value.toUpperCase())} required value={form.state} />
                    </label>
                    <label className="field">
                      ZIP code <span><b>*</b><ClaimFieldHint hint={claimFieldHints.serviceLocation} /></span>
                      <input maxLength={10} onChange={(event) => updateField("postalCode", event.target.value)} required value={form.postalCode} />
                    </label>
                  </div>
                </div>
              </fieldset>

              {error && <div className="notice error form-error">{error}</div>}
              <div className="modal-footer">
                <button className="secondary-button" onClick={() => setModalOpen(false)} type="button">Cancel</button>
                <button className="primary-button" disabled={isSaving} type="submit">
                  {isSaving ? "Saving…" : "Create facility"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
