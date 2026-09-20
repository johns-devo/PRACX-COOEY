import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db";
import {
  facilities,
  integrations,
  integrationEntityLinks,
  payers,
  insurancePlans,
  patients,
  providers,
} from "../db/schema";
import { DEFAULT_ORGANIZATION_ID } from "./onboarding";

type Db = ReturnType<typeof getDb>;

export type InboundIssue = {
  severity: "error" | "warning";
  code: string;
  field: string;
  message: string;
  suggestion?: string;
};

export type EhrInboundBundleV1 = {
  schemaVersion: "1";
  sourceSystem: string; // e.g. "elation", "athena", "ecw"
  sourceLabel?: string;
  eventType: "day_appointment" | "patient_demographics" | "insurance" | "encounter";
  externalIds?: {
    patient?: string;
    appointment?: string;
    encounter?: string;
    coverage?: string;
  };
  patient?: {
    firstName: string;
    middleName?: string;
    lastName: string;
    dateOfBirth: string; // YYYY-MM-DD
    sex?: "male" | "female" | "unknown";
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    phone?: string;
    email?: string;
  };
  appointment?: {
    startAt: string; // ISO
    durationMinutes?: number;
    appointmentType?: string;
    reason?: string;
  };
  coverage?: {
    payerId?: string;
    payerName: string;
    planName: string;
    memberId: string;
    groupNumber?: string;
    relationship?: "self" | "spouse" | "child" | "other";
    subscriberSameAsPatient?: boolean;
    subscriberFirstName?: string;
    subscriberLastName?: string;
    subscriberDateOfBirth?: string;
    subscriberSex?: string;
    subscriberAddressLine1?: string;
    subscriberCity?: string;
    subscriberState?: string;
    subscriberPostalCode?: string;
    effectiveDate?: string;
    terminationDate?: string;
  };
  encounter?: {
    dateOfService?: string; // YYYY-MM-DD
    chiefComplaint?: string;
    clinicalNote?: string;
  };
  /** Hints to match to configured PRACX records. */
  mapping?: {
    providerId?: string;
    providerNpi?: string;
    facilityId?: string;
    facilityNpi?: string;
    facilityCode?: string;
  };
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function zipOk(zip: string) {
  return /^\d{5}(?:-\d{4})?$/.test(zip);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateInboundBundleShape(input: unknown): {
  ok: boolean;
  bundle: EhrInboundBundleV1 | null;
  issues: InboundIssue[];
} {
  const issues: InboundIssue[] = [];
  let bundle: EhrInboundBundleV1 | null = null;
  try {
    bundle = input as EhrInboundBundleV1;
  } catch {
    bundle = null;
  }

  if (!bundle || typeof bundle !== "object") {
    return {
      ok: false,
      bundle: null,
      issues: [{ severity: "error", code: "invalid_json", field: "payload", message: "Payload must be a JSON object." }],
    };
  }

  if (bundle.schemaVersion !== "1") {
    issues.push({ severity: "error", code: "unsupported_version", field: "schemaVersion", message: "schemaVersion must be \"1\"." });
  }
  if (!clean(bundle.sourceSystem)) {
    issues.push({ severity: "error", code: "missing_source", field: "sourceSystem", message: "sourceSystem is required." });
  }
  if (!["day_appointment", "patient_demographics", "insurance", "encounter"].includes(String(bundle.eventType || ""))) {
    issues.push({ severity: "error", code: "invalid_event_type", field: "eventType", message: "eventType must be day_appointment, patient_demographics, insurance, or encounter." });
  }

  const patient = bundle.patient;
  if (!patient) {
    issues.push({ severity: "error", code: "missing_patient", field: "patient", message: "patient is required." });
  } else {
    const required = ["firstName", "lastName", "dateOfBirth", "addressLine1", "city", "state", "postalCode"] as const;
    for (const key of required) {
      if (!clean((patient as any)[key])) {
        issues.push({ severity: "error", code: "missing_patient_field", field: `patient.${key}`, message: `patient.${key} is required.` });
      }
    }
    if (clean(patient.dateOfBirth) && !isIsoDate(clean(patient.dateOfBirth))) {
      issues.push({ severity: "error", code: "invalid_dob", field: "patient.dateOfBirth", message: "patient.dateOfBirth must be YYYY-MM-DD." });
    }
    if (clean(patient.state) && clean(patient.state).length !== 2) {
      issues.push({ severity: "warning", code: "state_format", field: "patient.state", message: "patient.state should be 2-letter code.", suggestion: "Use e.g. FL, NY, CA." });
    }
    if (clean(patient.postalCode) && !zipOk(clean(patient.postalCode))) {
      issues.push({ severity: "error", code: "invalid_zip", field: "patient.postalCode", message: "patient.postalCode must be 5 digits (optional -4)." });
    }
  }

  const appt = bundle.appointment;
  if (!appt || !clean(appt.startAt)) {
    issues.push({ severity: "error", code: "missing_appointment", field: "appointment.startAt", message: "appointment.startAt (ISO) is required." });
  } else {
    const start = new Date(appt.startAt);
    if (Number.isNaN(start.getTime())) {
      issues.push({ severity: "error", code: "invalid_start", field: "appointment.startAt", message: "appointment.startAt must be a valid ISO timestamp." });
    }
    const dur = appt.durationMinutes ?? 30;
    if (!(Number(dur) > 0 && Number(dur) <= 8 * 60)) {
      issues.push({ severity: "error", code: "invalid_duration", field: "appointment.durationMinutes", message: "durationMinutes must be 1..480." });
    }
  }

  const cov = bundle.coverage;
  if (cov) {
    if (!clean(cov.payerName)) issues.push({ severity: "error", code: "missing_payer_name", field: "coverage.payerName", message: "coverage.payerName is required." });
    if (!clean(cov.planName)) issues.push({ severity: "error", code: "missing_plan_name", field: "coverage.planName", message: "coverage.planName is required." });
    if (!clean(cov.memberId)) issues.push({ severity: "error", code: "missing_member_id", field: "coverage.memberId", message: "coverage.memberId is required." });
    if (clean(cov.effectiveDate) && !isIsoDate(clean(cov.effectiveDate))) issues.push({ severity: "warning", code: "effective_date_format", field: "coverage.effectiveDate", message: "effectiveDate should be YYYY-MM-DD." });
    if (clean(cov.terminationDate) && !isIsoDate(clean(cov.terminationDate))) issues.push({ severity: "warning", code: "termination_date_format", field: "coverage.terminationDate", message: "terminationDate should be YYYY-MM-DD." });
  }

  return { ok: !issues.some((i) => i.severity === "error"), bundle, issues };
}

export async function resolveIntegrationId(db: Db, sourceSystem: string) {
  const source = clean(sourceSystem).toLowerCase();
  if (!source) return null;

  const [bySource] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(
      eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
      sql`lower(${integrations.sourceSystem}) = ${source}`,
    ))
    .limit(1);
  if (bySource?.id) return bySource.id;

  // Fallback for integrations configured before source_system existed.
  const legacyType = source === "elation" ? "ehr_elation" : source === "stedi" ? "stedi_edi" : "";
  if (!legacyType) return null;
  const [byType] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID), eq(integrations.integrationType, legacyType)))
    .limit(1);
  return byType?.id || null;
}

export async function resolveProviderAndFacility(db: Db, bundle: EhrInboundBundleV1) {
  const issues: InboundIssue[] = [];
  const mapping = bundle.mapping || {};

  let providerId = clean(mapping.providerId);
  if (!providerId && clean(mapping.providerNpi)) {
    const [row] = await db.select({ id: providers.id }).from(providers).where(eq(providers.npi, clean(mapping.providerNpi))).limit(1);
    providerId = row?.id || "";
  }
  if (!providerId) {
    issues.push({ severity: "error", code: "missing_provider_map", field: "mapping.providerId/providerNpi", message: "Provider mapping is required (providerId or providerNpi must match an existing provider)." });
  }

  let facilityId = clean(mapping.facilityId);
  if (!facilityId && clean(mapping.facilityNpi)) {
    const [row] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.npi, clean(mapping.facilityNpi))).limit(1);
    facilityId = row?.id || "";
  }
  if (!facilityId && clean(mapping.facilityCode)) {
    const [row] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, clean(mapping.facilityCode))).limit(1);
    facilityId = row?.id || "";
  }
  if (!facilityId) {
    issues.push({ severity: "error", code: "missing_facility_map", field: "mapping.facilityId/facilityNpi/facilityCode", message: "Facility mapping is required (facilityId, facilityNpi or facilityCode must match an existing facility)." });
  }

  return { providerId, facilityId, issues };
}

export async function upsertPayerAndPlan(db: Db, coverage: NonNullable<EhrInboundBundleV1["coverage"]>) {
  const payerIdentifier = clean(coverage.payerId) || "";
  const payerName = clean(coverage.payerName);
  const planName = clean(coverage.planName);

  let payerRow:
    | { id: string }
    | undefined;

  if (payerIdentifier) {
    [payerRow] = await db.select({ id: payers.id }).from(payers).where(and(
      eq(payers.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(payers.payerId, payerIdentifier),
    )).limit(1);
  }
  if (!payerRow) {
    [payerRow] = await db.select({ id: payers.id }).from(payers).where(and(
      eq(payers.organizationId, DEFAULT_ORGANIZATION_ID),
      sql`lower(${payers.name}) = lower(${payerName})`,
    )).limit(1);
  }
  let payerId = payerRow?.id || "";
  if (!payerId) {
    payerId = crypto.randomUUID();
    await db.insert(payers).values({
      id: payerId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: payerName,
      payerId: payerIdentifier || `UNK${Date.now().toString().slice(-6)}`,
      eligibilityPayerId: payerIdentifier || `UNK${Date.now().toString().slice(-6)}`,
      claimFilingIndicator: "CI",
      payerType: "Commercial",
      clearinghouseRoute: null,
      phone: null,
      fax: null,
      responseDays: "12",
      status: "active",
    });
  }

  const [existingPlan] = await db.select({ id: insurancePlans.id }).from(insurancePlans).where(and(
    eq(insurancePlans.payerId, payerId),
    sql`lower(${insurancePlans.name}) = lower(${planName})`,
  )).limit(1);
  let planId = existingPlan?.id || "";
  if (!planId) {
    planId = crypto.randomUUID();
    await db.insert(insurancePlans).values({
      id: planId,
      payerId,
      name: planName,
      planType: "PPO",
      defaultGroupNumber: clean(coverage.groupNumber) || null,
      timelyFilingDays: "90",
      requiresReferral: "no",
      requiresAuthorization: "no",
      status: "active",
    });
  }

  return { payerId, planId };
}

export async function findLinkedInternalId(db: Db, input: { sourceSystem: string; entityType: string; externalId: string }) {
  const [row] = await db
    .select({ internalId: integrationEntityLinks.internalId })
    .from(integrationEntityLinks)
    .where(and(
      eq(integrationEntityLinks.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(integrationEntityLinks.sourceSystem, input.sourceSystem),
      eq(integrationEntityLinks.entityType, input.entityType),
      eq(integrationEntityLinks.externalId, input.externalId),
    ))
    .limit(1);
  return row?.internalId || null;
}

export async function linkExternalId(db: Db, input: { sourceSystem: string; entityType: string; externalId: string; internalId: string; label?: string | null }) {
  const now = new Date().toISOString();
  try {
    await db.insert(integrationEntityLinks).values({
      id: crypto.randomUUID(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      sourceSystem: input.sourceSystem,
      entityType: input.entityType,
      externalId: input.externalId,
      internalId: input.internalId,
      label: input.label || null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("UNIQUE constraint failed")) throw error;
  }
}

