"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { LocalUser } from "../lib/auth";
import { claimFieldHints } from "../lib/cms1500";
import { ClaimFieldHint } from "./ClaimFieldHint";

type Kind = "internal" | "referring";
type FacilityOption = { id: string; name: string; code: string };
type Provider = {
  id: string;
  providerCode?: string;
  firstName: string;
  lastName: string;
  credentials: string | null;
  npi: string | null;
  taxonomyCode: string | null;
  specialty: string;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive";
  isBilling?: "yes" | "no";
  isRendering?: "yes" | "no";
  isSupervising?: "yes" | "no";
  facilityName?: string | null;
  licenseState?: string | null;
  licenseNumber?: string | null;
  licenseExpiration?: string | null;
  organizationName?: string | null;
  fax?: string | null;
  city?: string | null;
  state?: string | null;
};

type ProviderResponse = {
  providers: Provider[];
  facilities?: FacilityOption[];
  summary: { total: number; active: number; rendering?: number };
  error?: string;
};

const internalInitial = {
  providerCode: "",
  firstName: "",
  lastName: "",
  credentials: "MD",
  npi: "",
  taxonomyCode: "",
  specialty: "",
  email: "",
  phone: "",
  facilityId: "",
  licenseState: "",
  licenseNumber: "",
  licenseExpiration: "",
  isBilling: false,
  isRendering: true,
  isSupervising: false,
  status: "active",
};

const referringInitial = {
  firstName: "",
  lastName: "",
  credentials: "MD",
  npi: "",
  taxonomyCode: "",
  specialty: "",
  organizationName: "",
  email: "",
  phone: "",
  fax: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  status: "active",
};

const setupItems = [
  { label: "Organization", href: "#" },
  { label: "Facilities", href: "/setup" },
  { label: "Providers", href: "/setup/providers" },
  { label: "Referring providers", href: "/setup/referring-providers" },
  { label: "Payers & plans", href: "/setup/payers" },
  { label: "Fee schedules", href: "/setup/fee-schedules" },
  { label: "Procedure codes", href: "/setup/procedure-codes" },
];

const navSections = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Patients", href: "/patients" },
  { label: "Scheduler", href: "/scheduler" },
  { label: "Eligibility", href: "/eligibility" },
  { label: "Clinical", href: "/clinical" },
  { label: "Claims", href: "/claims" },
  { label: "Payments", href: "/payments" },
  { label: "Reports", href: "/reports" },
];

export function ProviderWorkspace({
  currentUser,
  kind,
}: {
  currentUser: LocalUser;
  kind: Kind;
}) {
  const isInternal = kind === "internal";
  const endpoint = isInternal ? "/api/providers" : "/api/referring-providers";
  const title = isInternal ? "Providers" : "Referring providers";
  const singular = isInternal ? "provider" : "referring provider";
  const [data, setData] = useState<ProviderResponse | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [isModalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>(
    isInternal ? internalInitial : referringInitial,
  );
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProviders = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    const response = await fetch(`${endpoint}?${params}`);
    const body = (await response.json()) as ProviderResponse;
    if (!response.ok) throw new Error(body.error || `Unable to load ${title.toLowerCase()}.`);
    setData(body);
    if (isInternal && !form.facilityId && body.facilities?.[0]?.id) {
      setForm((current) => ({ ...current, facilityId: body.facilities?.[0]?.id || "" }));
    }
  }, [endpoint, form.facilityId, isInternal, search, status, title]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProviders().catch((reason: Error) => setError(reason.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadProviders]);

  function updateField(name: string, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function openCreate() {
    const next = isInternal ? { ...internalInitial } : { ...referringInitial };
    if (isInternal && data?.facilities?.[0]?.id) next.facilityId = data.facilities[0].id;
    setForm(next);
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Unable to save ${singular}.`);
      setModalOpen(false);
      setNotice(`${isInternal ? "Provider" : "Referring provider"} created successfully.`);
      await loadProviders();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to save ${singular}.`);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  const initials = currentUser.fullName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PX</span>
          <div><strong>PRACX</strong><small>Care operations</small></div>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navSections.map((item) => (
            <Link className="nav-item" href={item.href} key={item.label}>
              <span className="nav-dot" aria-hidden="true" />{item.label}
            </Link>
          ))}
          <p className="nav-label setup-label">Configuration</p>
          <Link className="nav-item active" href="/setup">
            <span className="nav-dot" aria-hidden="true" />Practice setup
          </Link>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{initials}</span>
          <div className="sidebar-user"><strong>{currentUser.fullName}</strong><small>{currentUser.role}</small></div>
          <button aria-label="Sign out" className="signout-button" onClick={signOut} type="button">↗</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Configuration / Practice setup</span>
            <h1>{title}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications" type="button"><span aria-hidden="true">•</span></button>
            <button className="primary-button" onClick={openCreate} type="button">
              <span aria-hidden="true">＋</span>Add {singular}
            </button>
          </div>
        </header>

        <section className="content">
          <div className="section-tabs" role="tablist" aria-label="Practice setup sections">
            {setupItems.map((item) => (
              <Link
                aria-selected={item.label === title}
                className={item.label === title ? "selected" : ""}
                href={item.href}
                key={item.label}
                role="tab"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {notice && <div className="notice success">{notice}</div>}
          {!isModalOpen && error && <div className="notice error">{error}</div>}

          <section className="stats-grid" aria-label={`${title} summary`}>
            <article><span>Total {title.toLowerCase()}</span><strong>{data?.summary.total ?? 0}</strong><small>Configured in this organization</small></article>
            <article><span>Active</span><strong>{data?.summary.active ?? 0}</strong><small>Available for care workflows</small></article>
            <article>
              <span>{isInternal ? "Rendering providers" : "Referral network"}</span>
              <strong>{isInternal ? data?.summary.rendering ?? 0 : data?.summary.active ?? 0}</strong>
              <small>{isInternal ? "Eligible for claim rendering" : "Active referral contacts"}</small>
            </article>
            <article><span>Configuration health</span><strong className="health-value">{data?.summary.total ? "Ready" : "Start"}</strong><small>{data?.summary.total ? "Core records present" : `Add your first ${singular}`}</small></article>
          </section>

          <section className="table-card">
            <div className="table-header">
              <div>
                <h2>{title}</h2>
                <p>{isInternal ? "Manage clinical roles, licenses and facility assignments." : "Manage external clinicians used on referrals and claims."}</p>
              </div>
              <div className="filters">
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label={`Search ${title.toLowerCase()}`}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, NPI or specialty"
                    value={search}
                  />
                </label>
                <select aria-label={`Filter ${title.toLowerCase()} by status`} onChange={(event) => setStatus(event.target.value)} value={status}>
                  <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{isInternal ? "Provider" : "Referring provider"}</th>
                    <th>Specialty</th>
                    <th>NPI / Taxonomy</th>
                    <th>{isInternal ? "Primary facility" : "Organization"}</th>
                    <th>{isInternal ? "License" : "Contact"}</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.providers.map((provider) => (
                    <tr key={provider.id}>
                      <td>
                        <div className="facility-name">
                          <span>{provider.firstName[0]}{provider.lastName[0]}</span>
                          <div>
                            <strong>{provider.firstName} {provider.lastName}{provider.credentials ? `, ${provider.credentials}` : ""}</strong>
                            <small>{isInternal ? provider.providerCode : provider.email || "External provider"}</small>
                          </div>
                        </div>
                      </td>
                      <td>{provider.specialty}</td>
                      <td><strong className="location-name mono">{provider.npi || "Not set"}</strong><small className="address">{provider.taxonomyCode || "No taxonomy"}</small></td>
                      <td>{isInternal ? provider.facilityName || "Unassigned" : provider.organizationName || "Independent"}</td>
                      <td>
                        {isInternal ? (
                          <><strong className="location-name">{provider.licenseState} {provider.licenseNumber}</strong><small className="address">{provider.licenseExpiration ? `Expires ${provider.licenseExpiration}` : "No expiration"}</small></>
                        ) : (
                          <><strong className="location-name">{provider.phone || "No phone"}</strong><small className="address">{provider.fax ? `Fax ${provider.fax}` : [provider.city, provider.state].filter(Boolean).join(", ") || "No location"}</small></>
                        )}
                      </td>
                      <td><span className={`status-pill ${provider.status}`}>{provider.status}</span></td>
                      <td><button className="row-action" aria-label={`Open ${provider.firstName} ${provider.lastName}`} type="button">•••</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.providers.length === 0 && (
                <div className="empty-state">
                  <span>02</span><h3>No matching {title.toLowerCase()}</h3>
                  <p>Adjust the filters or create a new record for this organization.</p>
                  {!search && status === "all" && <button className="primary-button" onClick={openCreate} type="button">Add {singular}</button>}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="provider-modal-title" aria-modal="true" className="modal provider-modal" role="dialog">
            <div className="modal-header">
              <div><span className="eyebrow">Practice setup</span><h2 id="provider-modal-title">Add {singular}</h2><p>{isInternal ? "Create the provider, license and primary facility assignment." : "Create an external provider for referral and claim use."}</p></div>
              <button className="close-button" aria-label="Close dialog" onClick={() => setModalOpen(false)} type="button">×</button>
            </div>
            <form onSubmit={submitProvider}>
              <fieldset>
                <legend>Provider identity</legend>
                <div className="form-grid">
                  <label className="field">First name <span><b>*</b><ClaimFieldHint hint={isInternal ? claimFieldHints.providerName : claimFieldHints.referringName} /></span><input autoFocus required value={String(form.firstName)} onChange={(event) => updateField("firstName", event.target.value)} /></label>
                  <label className="field">Last name <span><b>*</b><ClaimFieldHint hint={isInternal ? claimFieldHints.providerName : claimFieldHints.referringName} /></span><input required value={String(form.lastName)} onChange={(event) => updateField("lastName", event.target.value)} /></label>
                  <label className="field">Credentials <ClaimFieldHint hint={isInternal ? claimFieldHints.providerCredentials : claimFieldHints.referringName} /><input placeholder="MD, DO, NP, PA-C" value={String(form.credentials)} onChange={(event) => updateField("credentials", event.target.value)} /></label>
                  {isInternal ? <label className="field">Provider code <span><b>*</b><ClaimFieldHint hint={claimFieldHints.providerCode} /></span><input required placeholder="CHEN01" value={String(form.providerCode)} onChange={(event) => updateField("providerCode", event.target.value.toUpperCase())} /></label> : <label className="field">Organization <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.organizationName)} onChange={(event) => updateField("organizationName", event.target.value)} /></label>}
                  <label className="field">NPI <span><b>*</b><ClaimFieldHint hint={isInternal ? claimFieldHints.providerNpi : claimFieldHints.referringNpi} /></span><input inputMode="numeric" maxLength={10} required placeholder="10 digits" value={String(form.npi)} onChange={(event) => updateField("npi", event.target.value.replace(/\D/g, ""))} /></label>
                  <label className="field">Taxonomy code <ClaimFieldHint hint={isInternal ? claimFieldHints.providerTaxonomy : claimFieldHints.referringTaxonomy} /><input placeholder="207Q00000X" value={String(form.taxonomyCode)} onChange={(event) => updateField("taxonomyCode", event.target.value.toUpperCase())} /></label>
                  <label className="field span-2">Specialty <span><b>*</b><ClaimFieldHint hint={claimFieldHints.providerSpecialty} /></span><input required placeholder="Family Medicine" value={String(form.specialty)} onChange={(event) => updateField("specialty", event.target.value)} /></label>
                </div>
              </fieldset>

              {isInternal ? (
                <>
                  <fieldset>
                    <legend>Facility & license</legend>
                    <div className="form-grid">
                      <label className="field span-2">Primary facility <span><b>*</b><ClaimFieldHint hint={claimFieldHints.facilityAssignment} /></span><select required value={String(form.facilityId)} onChange={(event) => updateField("facilityId", event.target.value)}><option value="">Select a facility</option>{data?.facilities?.map((facility) => <option value={facility.id} key={facility.id}>{facility.name} ({facility.code})</option>)}</select></label>
                      <label className="field">License state <span><b>*</b><ClaimFieldHint hint={claimFieldHints.providerLicense} /></span><input maxLength={2} required placeholder="NY" value={String(form.licenseState)} onChange={(event) => updateField("licenseState", event.target.value.toUpperCase())} /></label>
                      <label className="field">License number <span><b>*</b><ClaimFieldHint hint={claimFieldHints.providerLicense} /></span><input required value={String(form.licenseNumber)} onChange={(event) => updateField("licenseNumber", event.target.value)} /></label>
                      <label className="field">License expiration <ClaimFieldHint hint={claimFieldHints.licenseExpiration} /><input type="date" value={String(form.licenseExpiration)} onChange={(event) => updateField("licenseExpiration", event.target.value)} /></label>
                      <label className="field">Status <ClaimFieldHint hint={claimFieldHints.status} /><select value={String(form.status)} onChange={(event) => updateField("status", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Claim roles</legend>
                    <div className="checkbox-grid">
                      {([["isRendering", "Rendering provider"], ["isBilling", "Billing provider"], ["isSupervising", "Supervising provider"]] as const).map(([name, label]) => (
                        <label className="check-card" key={name}><input type="checkbox" checked={Boolean(form[name])} onChange={(event) => updateField(name, event.target.checked)} /><span><strong>{label} <ClaimFieldHint hint={claimFieldHints.providerRole} /></strong><small>Allow this role on professional claims</small></span></label>
                      ))}
                    </div>
                  </fieldset>
                </>
              ) : (
                <fieldset>
                  <legend>Contact & location</legend>
                  <div className="form-grid">
                    <label className="field">Email <ClaimFieldHint hint={claimFieldHints.referringContact} /><input type="email" value={String(form.email)} onChange={(event) => updateField("email", event.target.value)} /></label>
                    <label className="field">Phone <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.phone)} onChange={(event) => updateField("phone", event.target.value)} /></label>
                    <label className="field">Fax <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.fax)} onChange={(event) => updateField("fax", event.target.value)} /></label>
                    <label className="field">Status <ClaimFieldHint hint={claimFieldHints.status} /><select value={String(form.status)} onChange={(event) => updateField("status", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
                    <label className="field span-2">Address <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.addressLine1)} onChange={(event) => updateField("addressLine1", event.target.value)} /></label>
                    <label className="field">City <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.city)} onChange={(event) => updateField("city", event.target.value)} /></label>
                    <div className="field-row"><label className="field compact">State <ClaimFieldHint hint={claimFieldHints.referringContact} /><input maxLength={2} value={String(form.state)} onChange={(event) => updateField("state", event.target.value.toUpperCase())} /></label><label className="field">ZIP code <ClaimFieldHint hint={claimFieldHints.referringContact} /><input value={String(form.postalCode)} onChange={(event) => updateField("postalCode", event.target.value)} /></label></div>
                    <p className="form-guidance span-2">This provider will be searchable from patient referrals and claim entry.</p>
                  </div>
                </fieldset>
              )}

              {isInternal && <fieldset>
                <legend>Contact</legend>
                <div className="form-grid">
                  <label className="field">Email <ClaimFieldHint hint={claimFieldHints.email} /><input type="email" value={String(form.email)} onChange={(event) => updateField("email", event.target.value)} /></label>
                  <label className="field">Phone <ClaimFieldHint hint={claimFieldHints.providerPhone} /><input value={String(form.phone)} onChange={(event) => updateField("phone", event.target.value)} /></label>
                </div>
              </fieldset>}

              {error && <div className="notice error form-error">{error}</div>}
              <div className="modal-footer"><button className="secondary-button" onClick={() => setModalOpen(false)} type="button">Cancel</button><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving…" : `Create ${singular}`}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
