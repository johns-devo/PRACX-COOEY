"use client";

import { useMemo, useState } from "react";

type DataRow = Record<string, unknown>;

function value(row: DataRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function toLocalDateTimeValue(input: Date) {
  return new Date(input.getTime() - input.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function addInterval(base: Date, interval: "week" | "2weeks" | "month", occurrenceIndex: number) {
  const next = new Date(base.getTime());
  if (interval === "week") next.setDate(next.getDate() + 7 * occurrenceIndex);
  else if (interval === "2weeks") next.setDate(next.getDate() + 14 * occurrenceIndex);
  else next.setMonth(next.getMonth() + occurrenceIndex);
  return next;
}

function defaultFirstStart(dateOfService: string) {
  const base = dateOfService ? new Date(`${dateOfService}T09:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 14);
    fallback.setHours(9, 0, 0, 0);
    return toLocalDateTimeValue(fallback);
  }
  base.setDate(base.getDate() + 14);
  base.setHours(9, 0, 0, 0);
  return toLocalDateTimeValue(base);
}

function formatWhen(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const INTERVAL_OPTIONS: Array<["week" | "2weeks" | "month", string]> = [
  ["week", "Weekly"],
  ["2weeks", "Every 2 weeks"],
  ["month", "Monthly"],
];

const QUICK_OFFSETS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
];

export function PlanFollowUpBooking({
  data,
  form,
  update,
  onRefresh,
}: {
  data: {
    appointments: DataRow[];
    providers: DataRow[];
    facilities: DataRow[];
  };
  form: Record<string, string | boolean>;
  update: (key: string, value: string | boolean) => void;
  onRefresh?: () => Promise<void>;
}) {
  const patientId = String(form.patientId || "");
  const [mode, setMode] = useState<"once" | "recurring">("once");
  const [startAt, setStartAt] = useState(() => defaultFirstStart(String(form.dateOfService || "")));
  const [duration, setDuration] = useState("30");
  const [providerId, setProviderId] = useState(String(form.providerId || ""));
  const [facilityId, setFacilityId] = useState(String(form.facilityId || ""));
  const [interval, setInterval] = useState<"week" | "2weeks" | "month">("month");
  const [occurrences, setOccurrences] = useState("3");
  const [reason, setReason] = useState(() => {
    const instructions = String(form.followUpInstructions || "").trim();
    return instructions || String(form.chiefComplaint || "Clinical follow-up").trim();
  });
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const upcoming = useMemo(() => {
    if (!patientId) return [] as DataRow[];
    const now = Date.now();
    return (data.appointments || [])
      .filter((row) => value(row, "patientId") === patientId)
      .filter((row) => !["cancelled", "no_show"].includes(value(row, "status")))
      .filter((row) => new Date(value(row, "startAt")).getTime() >= now - 60_000)
      .sort((a, b) => new Date(value(a, "startAt")).getTime() - new Date(value(b, "startAt")).getTime())
      .slice(0, 6);
  }, [data.appointments, patientId]);

  const previewStarts = useMemo(() => {
    const first = new Date(startAt);
    if (Number.isNaN(first.getTime())) return [] as string[];
    const count = mode === "once" ? 1 : Math.min(12, Math.max(1, Number(occurrences) || 1));
    return Array.from({ length: count }, (_, index) => toLocalDateTimeValue(addInterval(first, interval, index)));
  }, [startAt, mode, occurrences, interval]);

  function applyQuickOffset(days: number) {
    const next = new Date();
    next.setDate(next.getDate() + days);
    next.setHours(9, 0, 0, 0);
    setStartAt(toLocalDateTimeValue(next));
  }

  function appendInstructions(bookedLines: string[]) {
    if (!bookedLines.length) return;
    const existing = String(form.followUpInstructions || "").trim();
    const addition = bookedLines.length === 1
      ? `Follow-up scheduled for ${bookedLines[0]}.`
      : `Recurring follow-ups scheduled: ${bookedLines.join("; ")}.`;
    if (existing.includes(addition)) return;
    update("followUpInstructions", existing ? `${existing}\n${addition}` : addition);
  }

  async function book() {
    if (!patientId || !providerId || !facilityId || !startAt) {
      setStatus("Patient, provider, facility and start time are required.");
      return;
    }
    setSaving(true);
    setStatus("Booking…");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "createFollowUpAppointments",
          patientId,
          providerId,
          facilityId,
          startAt,
          duration,
          appointmentType: "Follow-up",
          billingContext: String(form.billingContext || "routine"),
          reason: reason.trim() || "Clinical follow-up",
          mode,
          interval: mode === "recurring" ? interval : "week",
          occurrences: mode === "recurring" ? occurrences : "1",
          encounterId: String(form.id || ""),
        }),
      });
      const body = await response.json() as {
        error?: string;
        booked?: Array<{ id: string; startAt: string }>;
        skipped?: Array<{ startAt: string; reason: string }>;
      };
      if (!response.ok) throw new Error(body.error || "Unable to book follow-up.");
      const booked = body.booked || [];
      const skipped = body.skipped || [];
      const bookedLabels = booked.map((row) => formatWhen(row.startAt));
      appendInstructions(bookedLabels);
      await onRefresh?.();
      if (booked.length && !skipped.length) {
        setStatus(booked.length === 1
          ? `Booked follow-up for ${bookedLabels[0]}.`
          : `Booked ${booked.length} follow-ups.`);
      } else if (booked.length && skipped.length) {
        setStatus(`Booked ${booked.length}; skipped ${skipped.length} conflict${skipped.length === 1 ? "" : "s"}.`);
      } else {
        setStatus(skipped[0]?.reason || "No appointments were booked.");
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to book follow-up.");
    } finally {
      setSaving(false);
    }
  }

  if (!patientId) {
    return (
      <aside className="plan-followup-booking">
        <header><strong>Book follow-up</strong></header>
        <p className="assessment-empty">Select a patient on this encounter before booking follow-up.</p>
      </aside>
    );
  }

  return (
    <aside className="plan-followup-booking" aria-label="Book follow-up appointment">
      <header>
        <strong>Book follow-up</strong>
        <small>Schedule from Plan — one visit or a recurring series</small>
      </header>

      <div className="plan-followup-modes" role="group" aria-label="Follow-up mode">
        <button aria-pressed={mode === "once"} className={mode === "once" ? "active" : ""} onClick={() => setMode("once")} type="button">One follow-up</button>
        <button aria-pressed={mode === "recurring"} className={mode === "recurring" ? "active" : ""} onClick={() => setMode("recurring")} type="button">Recurring</button>
      </div>

      <div className="plan-followup-quick">
        {QUICK_OFFSETS.map((row) => (
          <button key={row.label} onClick={() => applyQuickOffset(row.days)} type="button">{row.label}</button>
        ))}
      </div>

      <div className="plan-followup-grid">
        <label>
          First visit
          <input onChange={(event) => setStartAt(event.target.value)} type="datetime-local" value={startAt} />
        </label>
        <label>
          Duration
          <select onChange={(event) => setDuration(event.target.value)} value={duration}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </label>
        <label>
          Provider
          <select onChange={(event) => setProviderId(event.target.value)} value={providerId}>
            <option value="">Select provider</option>
            {data.providers.map((row) => (
              <option key={value(row, "id")} value={value(row, "id")}>
                {value(row, "firstName")} {value(row, "lastName")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Facility
          <select onChange={(event) => setFacilityId(event.target.value)} value={facilityId}>
            <option value="">Select facility</option>
            {data.facilities.map((row) => (
              <option key={value(row, "id")} value={value(row, "id")}>{value(row, "name")}</option>
            ))}
          </select>
        </label>
        {mode === "recurring" ? (
          <>
            <label>
              Repeat
              <select onChange={(event) => setInterval(event.target.value as "week" | "2weeks" | "month")} value={interval}>
                {INTERVAL_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>
              Visits
              <select onChange={(event) => setOccurrences(event.target.value)} value={occurrences}>
                {["2", "3", "4", "6", "8", "12"].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </>
        ) : null}
        <label className="plan-followup-reason">
          Reason
          <input onChange={(event) => setReason(event.target.value)} placeholder="Follow-up reason" value={reason} />
        </label>
      </div>

      {previewStarts.length > 1 ? (
        <div className="plan-followup-preview">
          <strong>Series preview</strong>
          <ul>{previewStarts.map((when) => <li key={when}>{formatWhen(when)}</li>)}</ul>
        </div>
      ) : null}

      <div className="plan-followup-actions">
        <button className="primary-button" disabled={saving} onClick={() => void book()} type="button">
          {saving ? "Booking…" : mode === "once" ? "Book follow-up" : `Book ${occurrences} follow-ups`}
        </button>
        {status ? <small aria-live="polite">{status}</small> : null}
      </div>

      {upcoming.length > 0 ? (
        <div className="plan-followup-upcoming">
          <strong>Upcoming for this patient</strong>
          <ul>
            {upcoming.map((row) => (
              <li key={value(row, "id")}>
                <b>{formatWhen(value(row, "startAt"))}</b>
                <span>{value(row, "appointmentType") || "Visit"} · {value(row, "status")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
