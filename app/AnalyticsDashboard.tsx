"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LocalUser } from "../lib/auth";
import { isPracxStandalone, PRACX_STANDALONE_ORIGIN } from "../lib/app-surface";

const summaryCards = [
  { label: "Gross charges", value: "$482,640", change: "+8.4%", tone: "positive" },
  { label: "Insurance payments", value: "$286,914", change: "+12.1%", tone: "positive" },
  { label: "Patient payments", value: "$42,730", change: "+4.8%", tone: "positive" },
  { label: "Adjustments", value: "$96,288", change: "19.9% of charges", tone: "neutral" },
  { label: "Net collections", value: "$329,644", change: "+10.7%", tone: "positive" },
  { label: "Total outstanding A/R", value: "$618,320", change: "-3.2%", tone: "positive" },
  { label: "Clean claim rate", value: "94.2%", change: "+1.6 pts", tone: "positive" },
  { label: "Denial rate", value: "6.8%", change: "-0.9 pts", tone: "positive" },
];

const aging = [
  { label: "0–30 days", amount: "$254,980", percent: 41 },
  { label: "31–60 days", amount: "$154,580", percent: 25 },
  { label: "61–90 days", amount: "$92,748", percent: 15 },
  { label: "91–120 days", amount: "$61,832", percent: 10 },
  { label: "Over 120 days", amount: "$55,180", percent: 9 },
];

const workQueues = [
  { name: "Claims ready to bill", owner: "Billing", count: 38, amount: "$74,620", priority: "Today" },
  { name: "Scrubber exceptions", owner: "Coding", count: 14, amount: "$28,410", priority: "High" },
  { name: "Rejected claims", owner: "Billing", count: 9, amount: "$17,940", priority: "High" },
  { name: "Denials requiring action", owner: "A/R team", count: 26, amount: "$51,780", priority: "Due soon" },
  { name: "Unposted ERA", owner: "Payments", count: 6, amount: "$42,116", priority: "Review" },
];

const months = [
  { label: "Feb", charges: 70, payments: 53 },
  { label: "Mar", charges: 76, payments: 58 },
  { label: "Apr", charges: 74, payments: 61 },
  { label: "May", charges: 84, payments: 66 },
  { label: "Jun", charges: 88, payments: 71 },
  { label: "Jul", charges: 96, payments: 78 },
];

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthYearFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const rangeFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const navItems = [
  { label: "Dashboard", href: "/dashboard", active: true },
  { label: "Patients", href: "/patients" },
  { label: "Scheduler", href: "/scheduler" },
  { label: "Eligibility", href: "/eligibility" },
  { label: "Clinical", href: "/clinical" },
  { label: "Claims", href: "/claim-inquiry" },
  { label: "Collection Arena", href: "/collections" },
  { label: "Claim prep", href: "/claims" },
  { label: "Payments", href: "/payments" },
  { label: "Reports", href: "/reports" },
];

const clientNavItems = [
  { label: "Dashboard", href: "/dashboard", active: true },
  { label: "Patients", href: "/patients", active: false },
  { label: "Claims", href: "/claim-inquiry", active: false },
  { label: "Collection Arena", href: "/collections", active: false },
  { label: "Claim prep", href: "/claims", active: false },
  { label: "Payments", href: "/payments", active: false },
  { label: "Reports", href: "/reports", active: false },
];

export function AnalyticsDashboard({ currentUser }: { currentUser: LocalUser }) {
  const pracxClient = isPracxStandalone();
  const surfaceNavItems = pracxClient ? clientNavItems : navItems;
  const [now] = useState(() => new Date());
  const currentMonthPrefix = now.toISOString().slice(0, 7);
  const [operations, setOperations] = useState<{
    patients?: Record<string, unknown>[];
    appointments?: Record<string, unknown>[];
    encounters?: Record<string, unknown>[];
    integrations?: Record<string, unknown>[];
    inboundEvents?: Record<string, unknown>[];
    syncEvents?: Record<string, unknown>[];
    claims: Record<string, unknown>[];
    remittances: Record<string, unknown>[];
    paymentEntries?: Record<string, unknown>[];
    transactions: Record<string, unknown>[];
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/operations")
        .then((response) => response.json())
        .then((body) => setOperations(body))
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const liveSummary = useMemo(() => {
    if (!operations) return summaryCards;
    const amount = (row: Record<string, unknown>) => Number(row.amount || 0);
    const claimAmount = (row: Record<string, unknown>, field: string) => Number(row[field] || 0);
    const currentTransactions = operations.transactions.filter((row) => String(row.postingDate || row.transactionDate).startsWith(currentMonthPrefix));
    const currentClaims = operations.claims.filter((row) => String(row.transactionDate).startsWith(currentMonthPrefix));
    const charges = currentTransactions.filter((row) => row.transactionType === "charge").reduce((sum, row) => sum + amount(row), 0);
    const insurance = Math.abs(currentTransactions.filter((row) => row.transactionType === "insurance_payment").reduce((sum, row) => sum + amount(row), 0));
    const patient = Math.abs(currentTransactions.filter((row) => row.transactionType === "patient_payment").reduce((sum, row) => sum + amount(row), 0));
    const adjustments = Math.abs(currentTransactions.filter((row) => row.transactionType === "adjustment").reduce((sum, row) => sum + amount(row), 0));
    const outstanding = operations.claims.reduce((sum, row) => sum + Math.max(0, claimAmount(row, "totalCharge") - claimAmount(row, "totalPaid") - claimAmount(row, "totalAdjustment")), 0);
    const clean = currentClaims.filter((row) => row.scrubberStatus === "clean").length;
    const denied = currentClaims.filter((row) => row.status === "denied" || row.status === "rejected").length;
    const currency = (number: number) => number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    return [
      { label: "Gross charges", value: currency(charges), change: "From transaction ledger", tone: "positive" },
      { label: "Insurance payments", value: currency(insurance), change: "Posted insurance receipts", tone: "positive" },
      { label: "Patient payments", value: currency(patient), change: "Posted patient receipts", tone: "positive" },
      { label: "Adjustments", value: currency(adjustments), change: "Contractual and other", tone: "neutral" },
      { label: "Net collections", value: currency(insurance + patient), change: "Insurance plus patient", tone: "positive" },
      { label: "Total outstanding A/R", value: currency(outstanding), change: "Current claim balances", tone: "neutral" },
      { label: "Clean claim rate", value: `${currentClaims.length ? ((clean / currentClaims.length) * 100).toFixed(1) : "0.0"}%`, change: `${clean} clean claims`, tone: "positive" },
      { label: "Denial rate", value: `${currentClaims.length ? ((denied / currentClaims.length) * 100).toFixed(1) : "0.0"}%`, change: `${denied} denied or rejected`, tone: denied ? "neutral" : "positive" },
    ];
  }, [currentMonthPrefix, operations]);

  const liveMonths = useMemo(() => {
    if (!operations) return months;
    const buckets = Array.from({ length: 6 }, (_, reverseIndex) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - reverseIndex), 1);
      return {
        key: date.toISOString().slice(0, 7),
        label: monthFormatter.format(date),
        chargesAmount: 0,
        paymentsAmount: 0,
      };
    });
    for (const row of operations.transactions) {
      const bucket = buckets.find((candidate) => String(row.postingDate || row.transactionDate).startsWith(candidate.key));
      if (!bucket) continue;
      const value = Math.abs(Number(row.amount || 0));
      if (row.transactionType === "charge") bucket.chargesAmount += value;
      if (row.transactionType === "insurance_payment" || row.transactionType === "patient_payment") bucket.paymentsAmount += value;
    }
    const maximum = Math.max(1, ...buckets.flatMap((bucket) => [bucket.chargesAmount, bucket.paymentsAmount]));
    return buckets.map((bucket) => ({
      label: bucket.label,
      charges: Math.max(bucket.chargesAmount ? 8 : 0, Math.round((bucket.chargesAmount / maximum) * 100)),
      payments: Math.max(bucket.paymentsAmount ? 8 : 0, Math.round((bucket.paymentsAmount / maximum) * 100)),
    }));
  }, [now, operations]);

  const liveAging = useMemo(() => {
    if (!operations) return { total: "$618,320", buckets: aging };
    const definitions = [
      { label: "0–30 days", minimum: 0, maximum: 30 },
      { label: "31–60 days", minimum: 31, maximum: 60 },
      { label: "61–90 days", minimum: 61, maximum: 90 },
      { label: "91–120 days", minimum: 91, maximum: 120 },
      { label: "Over 120 days", minimum: 121, maximum: Number.POSITIVE_INFINITY },
    ];
    const currency = (number: number) => number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const results = definitions.map((definition) => ({ ...definition, value: 0 }));
    for (const claim of operations.claims) {
      const balance = Math.max(0, Number(claim.totalCharge || 0) - Number(claim.totalPaid || 0) - Number(claim.totalAdjustment || 0));
      if (!balance) continue;
      const start = new Date(String(claim.firstBilledDate || claim.transactionDate));
      const days = Number.isNaN(start.getTime()) ? 0 : Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
      const bucket = results.find((candidate) => days >= candidate.minimum && days <= candidate.maximum);
      if (bucket) bucket.value += balance;
    }
    const total = results.reduce((sum, result) => sum + result.value, 0);
    return {
      total: currency(total),
      buckets: results.map((result) => ({
        label: result.label,
        amount: currency(result.value),
        percent: total ? Math.round((result.value / total) * 100) : 0,
      })),
    };
  }, [now, operations]);

  const liveQueues = useMemo(() => {
    if (!operations) return workQueues;
    const claimTotal = (statuses: string[]) => operations.claims.filter((row) => statuses.includes(String(row.status))).reduce((sum, row) => sum + Number(row.totalCharge || 0), 0);
    const currency = (number: number) => number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const queue = (name: string, owner: string, statuses: string[], priority: string) => {
      const rows = operations.claims.filter((row) => statuses.includes(String(row.status)));
      return { name, owner, count: rows.length, amount: currency(claimTotal(statuses)), priority };
    };
    const unposted = operations.remittances.filter((row) => row.status !== "posted");
    return [
      queue("Clean claims", "Billing", ["ready", "draft"], "Today"),
      queue("Error claims", "Coding", ["scrub_error"], "High"),
      queue("Rejected claims", "Billing", ["rejected"], "High"),
      queue("Denials requiring action", "A/R team", ["denied"], "Due soon"),
      { name: "Unposted ERA", owner: "Payments", count: unposted.length, amount: currency(unposted.reduce((sum, row) => sum + Number(row.amount || 0), 0)), priority: "Review" },
    ];
  }, [operations]);

  const todayOperations = useMemo(() => {
    const todayKey = now.toISOString().slice(0, 10);
    const appointments = (operations?.appointments || []).filter((row) => String(row.startAt || "").startsWith(todayKey));
    const claims = operations?.claims || [];
    const encounterCount = (operations?.encounters || []).filter((row) => String(row.dateOfService || "").startsWith(todayKey)).length;
    const waiting = appointments.filter((row) => ["arrived", "checked_in", "waiting", "roomed", "ready_for_provider"].includes(String(row.flowStatus))).length;
    const inVisit = appointments.filter((row) => String(row.flowStatus) === "consultation_started").length;
    const completed = appointments.filter((row) => ["checked_out", "completed"].includes(String(row.flowStatus)) || String(row.status) === "completed").length;
    const ready = claims.filter((row) => ["ready", "draft"].includes(String(row.status)) && row.scrubberStatus === "clean").length;
    const exceptions = claims.filter((row) => row.scrubberStatus === "error" || String(row.status) === "scrub_error").length;
    const pending = claims.filter((row) => ["submitted", "accepted", "pending"].includes(String(row.status))).length;
    return { appointments: appointments.length, encounterCount, waiting, inVisit, completed, ready, exceptions, pending };
  }, [now, operations]);

  const integrationPulse = useMemo(() => {
    const integrations = operations?.integrations || [];
    const inbound = operations?.inboundEvents || [];
    const sync = operations?.syncEvents || [];
    const connected = integrations.filter((row) => ["active", "configured"].includes(String(row.status))).length;
    const openInbound = inbound.filter((row) => String(row.status) !== "accepted").length;
    const openSync = sync.filter((row) => ["pending", "error"].includes(String(row.status))).length;
    return { connected, total: integrations.length, openInbound, openSync };
  }, [operations]);

  const clientPulse = useMemo(() => {
    const claims = operations?.claims || [];
    const remittances = operations?.remittances || [];
    const paymentEntries = operations?.paymentEntries || [];
    const ready = claims.filter((row) => ["ready", "draft"].includes(String(row.status)) && row.scrubberStatus === "clean").length;
    const errors = claims.filter((row) => row.scrubberStatus === "error" || String(row.status) === "scrub_error").length;
    const unpostedEra = remittances.filter((row) => String(row.status) !== "posted").length;
    const pendingPayments = paymentEntries.filter((row) => !["posted", "completed"].includes(String(row.paymentStatus))).length;
    return { ready, errors, unpostedEra, pendingPayments };
  }, [operations]);

  const initials = currentUser.fullName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  return (
    <div className="app-shell analytics-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PX</span>
          <div><strong>PRACX</strong><small>{pracxClient ? "Client workspace" : "Care operations"}</small></div>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {surfaceNavItems.map((item) => (
            <Link
              className={`nav-item ${item.active ? "active" : ""}`}
              href={item.href}
              key={item.label}
            >
              <span className="nav-dot" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
          <p className="nav-label setup-label">Configuration</p>
          <Link className="nav-item" href="/setup">
            <span className="nav-dot" aria-hidden="true" />
            Practice setup
          </Link>
          <Link className="nav-item" href="/integrations">
            <span className="nav-dot" aria-hidden="true" />
            Integrations
          </Link>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{initials}</span>
          <div className="sidebar-user">
            <strong>{currentUser.fullName}</strong>
            <small>{currentUser.role}</small>
          </div>
          <button aria-label="Sign out" className="signout-button" onClick={signOut} type="button">↗</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar analytics-topbar">
          <div>
            <span className="eyebrow">{pracxClient ? "PRACX client · Revenue cycle command center" : "Revenue cycle command center"}</span>
            <h1>{pracxClient ? "PRACX command center" : "Account analytics"}</h1>
          </div>
          <div className="top-actions">
            <span className="demo-pill">{pracxClient ? "Client workspace" : "Local operational data"}</span>
            {pracxClient ? <Link className="secondary-button" href="/integrations">Review integrations</Link> : <a className="secondary-button" href={PRACX_STANDALONE_ORIGIN}>Open PRACX client</a>}
            <Link className="secondary-button" href="/reports">Export report</Link>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="dashboard-heading">
            <div>
              <h2>{monthYearFormatter.format(now)} performance</h2>
              <p>Current-month financial, claim and A/R performance across the organization.</p>
            </div>
            <div className="dashboard-filters">
              <select aria-label="Date basis" defaultValue="posting">
                <option value="posting">Posting date</option>
                <option value="service">Date of service</option>
                <option value="transaction">Transaction date</option>
                <option value="payment">Payment date</option>
                <option value="first-billed">First billed date</option>
                <option value="last-billed">Last billed date</option>
              </select>
              <select aria-label="Facility" defaultValue="all">
                <option value="all">All facilities</option>
              </select>
              <button className="month-button" type="button">
                {rangeFormatter.format(new Date(now.getFullYear(), now.getMonth(), 1))} – {rangeFormatter.format(now)}
              </button>
            </div>
          </div>

          <section className="dashboard-pulse" aria-label="Today's operating pulse">
            <div className="pulse-intro">
              <span className="eyebrow">{pracxClient ? "Client command center" : "Today at a glance"}</span>
              <h3>{pracxClient ? "Know what needs action" : "Keep the day moving"}</h3>
              <p>{pracxClient ? "Integration health, claims and payment work in one view." : "Front desk, clinical flow and billing queues in one view."}</p>
            </div>
            {pracxClient ? <>
              <Link className="pulse-card pulse-card-primary" href="/integrations">
                <span>Integration health</span>
                <strong>{integrationPulse.connected}/{integrationPulse.total}</strong>
                <small>{integrationPulse.openInbound} inbound · {integrationPulse.openSync} sync items open</small>
                <b>Open integrations →</b>
              </Link>
              <Link className="pulse-card" href="/claims">
                <span>Claim readiness</span>
                <strong>{clientPulse.ready}</strong>
                <small>{clientPulse.errors} scrub exceptions · {todayOperations.pending} pending</small>
                <b>Open claim prep →</b>
              </Link>
              <Link className="pulse-card" href="/payments">
                <span>Payment posting</span>
                <strong>{clientPulse.unpostedEra + clientPulse.pendingPayments}</strong>
                <small>{clientPulse.unpostedEra} ERA · {clientPulse.pendingPayments} payment entries</small>
                <b>Open payments →</b>
              </Link>
            </> : <>
              <Link className="pulse-card pulse-card-primary" href="/scheduler">
                <span>Clinic schedule</span>
                <strong>{todayOperations.appointments}</strong>
                <small>{todayOperations.waiting} waiting · {todayOperations.inVisit} in visit</small>
                <b>Open scheduler →</b>
              </Link>
              <Link className="pulse-card" href="/clinical">
                <span>Clinical flow</span>
                <strong>{todayOperations.encounterCount}</strong>
                <small>{todayOperations.completed} completed today</small>
                <b>Open clinical →</b>
              </Link>
              <Link className="pulse-card" href="/claims">
                <span>Claim readiness</span>
                <strong>{todayOperations.ready}</strong>
                <small>{todayOperations.exceptions} scrub exceptions · {todayOperations.pending} pending</small>
                <b>Open claim prep →</b>
              </Link>
            </>}
          </section>

          <section className="analytics-cards" aria-label="Current month summary">
            {liveSummary.map((card) => (
              <article key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small className={card.tone}>{card.change}</small>
              </article>
            ))}
          </section>

          <div className="analytics-grid">
            <section className="analytics-panel collections-panel">
              <div className="panel-heading">
                <div><h3>Charges & collections</h3><p>Six-month financial trend</p></div>
                <div className="chart-legend"><span className="charges">Charges</span><span className="payments">Payments</span></div>
              </div>
              <div className="bar-chart" aria-label="Monthly charges and payments chart">
                {liveMonths.map((month) => (
                  <div className="month-group" key={month.label}>
                    <div className="bar-pair">
                      <span className="chart-bar charges" style={{ height: `${month.charges}%` }} />
                      <span className="chart-bar payments" style={{ height: `${month.payments}%` }} />
                    </div>
                    <small>{month.label}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="analytics-panel aging-panel">
              <div className="panel-heading">
                <div><h3>A/R aging</h3><p>{liveAging.total} outstanding</p></div>
                <Link className="text-button" href="/reports">View aging report</Link>
              </div>
              <div className="aging-list">
                {liveAging.buckets.map((bucket) => (
                  <div className="aging-row" key={bucket.label}>
                    <div><span>{bucket.label}</span><strong>{bucket.amount}</strong></div>
                    <div className="aging-track"><span style={{ width: `${bucket.percent}%` }} /></div>
                    <small>{bucket.percent}%</small>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="analytics-panel queue-panel">
            <div className="panel-heading">
              <div><h3>RCM work queues</h3><p>Items requiring operational attention</p></div>
              <Link className="secondary-button button-link" href="/claims">Open Claim prep</Link>
            </div>
            <div className="queue-table-wrap">
              <table>
                <thead><tr><th>Work queue</th><th>Owner</th><th>Items</th><th>Value</th><th>Priority</th><th /></tr></thead>
                <tbody>
                  {liveQueues.map((queue) => (
                    <tr key={queue.name}>
                      <td><strong>{queue.name}</strong></td>
                      <td>{queue.owner}</td>
                      <td>{queue.count}</td>
                      <td className="mono">{queue.amount}</td>
                      <td><span className="queue-priority">{queue.priority}</span></td>
                      <td>
                        <Link
                          aria-label={`Open ${queue.name}`}
                          className="row-action"
                          href={queue.name === "Unposted ERA" ? "/payments" : "/claims"}
                        >
                          →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="quick-reports">
            <div><span>Monthly reports</span><h3>Reporting center</h3><p>Review complete financial and operational detail.</p></div>
            {["Transaction report", "Payer performance", "Provider production", "Denial analysis"].map((report) => (
              <Link href="/reports" key={report}><span>{report}</span><b>→</b></Link>
            ))}
          </section>
        </section>
      </main>
    </div>
  );
}
