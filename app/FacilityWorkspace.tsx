"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

const navSections = [
  "Dashboard",
  "Scheduler",
  "Patients",
  "Clinical",
  "Claims",
  "Payments",
  "Reports",
];

const setupItems = [
  "Organization",
  "Facilities",
  "Providers",
  "Referring providers",
  "Payers & plans",
  "Fee schedules",
  "Procedure codes",
];

export function FacilityWorkspace() {
  const [data, setData] = useState<FacilityResponse | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [isModalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadFacilities = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    const response = await fetch(`/api/facilities?${params}`);
    const body = (await response.json()) as FacilityResponse;
    if (!response.ok) throw new Error(body.error || "Unable to load facilities.");
    setData(body);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PX</span>
          <div>
            <strong>PRACX</strong>
            <small>Care operations</small>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navSections.map((item) => (
            <button className="nav-item" key={item} type="button">
              <span className="nav-dot" aria-hidden="true" />
              {item}
            </button>
          ))}
          <p className="nav-label setup-label">Configuration</p>
          <button className="nav-item active" type="button">
            <span className="nav-dot" aria-hidden="true" />
            Practice setup
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="avatar">JR</span>
          <div>
            <strong>Administrator</strong>
            <small>Practice owner</small>
          </div>
        </div>
      </aside>

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
          <div className="section-tabs" role="tablist" aria-label="Practice setup sections">
            {setupItems.map((item) => (
              <button
                aria-selected={item === "Facilities"}
                className={item === "Facilities" ? "selected" : ""}
                key={item}
                role="tab"
                type="button"
              >
                {item}
              </button>
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
                    Facility name <b>*</b>
                    <input
                      autoFocus
                      onChange={(event) => updateField("name", event.target.value)}
                      placeholder="e.g. Midtown Medical Center"
                      required
                      value={form.name}
                    />
                  </label>
                  <label className="field">
                    Facility code <b>*</b>
                    <input
                      maxLength={12}
                      onChange={(event) => updateField("code", event.target.value.toUpperCase())}
                      placeholder="MIDTOWN"
                      required
                      value={form.code}
                    />
                  </label>
                  <label className="field">
                    Facility type <b>*</b>
                    <select onChange={(event) => updateField("facilityType", event.target.value)} value={form.facilityType}>
                      <option>Medical office</option>
                      <option>Independent clinic</option>
                      <option>Outpatient hospital</option>
                      <option>Laboratory</option>
                      <option>Telehealth</option>
                    </select>
                  </label>
                  <label className="field">
                    Facility NPI
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) => updateField("npi", event.target.value.replace(/\D/g, ""))}
                      placeholder="10 digits"
                      value={form.npi}
                    />
                  </label>
                  <label className="field">
                    Phone
                    <input onChange={(event) => updateField("phone", event.target.value)} placeholder="(555) 000-0000" value={form.phone} />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Primary service location</legend>
                <div className="form-grid">
                  <label className="field">
                    Location name <b>*</b>
                    <input onChange={(event) => updateField("locationName", event.target.value)} required value={form.locationName} />
                  </label>
                  <label className="field">
                    Place of service <b>*</b>
                    <select onChange={(event) => updateField("placeOfServiceCode", event.target.value)} value={form.placeOfServiceCode}>
                      <option value="11">11 — Office</option>
                      <option value="22">22 — Outpatient hospital</option>
                      <option value="49">49 — Independent clinic</option>
                      <option value="81">81 — Independent laboratory</option>
                    </select>
                  </label>
                  <label className="field span-2">
                    Address line 1 <b>*</b>
                    <input onChange={(event) => updateField("addressLine1", event.target.value)} placeholder="Street address" required value={form.addressLine1} />
                  </label>
                  <label className="field">
                    City <b>*</b>
                    <input onChange={(event) => updateField("city", event.target.value)} required value={form.city} />
                  </label>
                  <div className="field-row">
                    <label className="field compact">
                      State <b>*</b>
                      <input maxLength={2} onChange={(event) => updateField("state", event.target.value.toUpperCase())} required value={form.state} />
                    </label>
                    <label className="field">
                      ZIP code <b>*</b>
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
