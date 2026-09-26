import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import {
  credentialFieldsFor,
  loadCredentialStatus,
  missingRequiredCredentials,
  saveCredentials,
  testConnection,
} from "../../../lib/integration-credentials";
import {
  appointments,
  billingResponsibilityProfiles,
  claimLines,
  claimCorrectionHistory,
  claimConfigurationValues,
  claimResponsibilitySnapshots,
  claimWorkflowEvents,
  claimBatches,
  claimBatchMembers,
  claimTransmissionLogs,
  claims,
  clinicalContentItems,
  clinicalOptionMaster,
  clinicalOrderResults,
  clinicalOrders,
  clinicalOrderCatalog,
  diagnosisCodeMaster,
  eligibilityChecks,
  eligibilityUpdateHistory,
  encounterEvents,
  encounters,
  facilities,
  feeScheduleItems,
  feeSchedules,
  insurancePlans,
  integrations,
  integrationEntityLinks,
  integrationInboundEvents,
  integrationSyncEvents,
  ledgerTransactions,
  patientCoverages,
  patientDocuments,
  patientAllergies,
  patientCareChecklistItems,
  patientFlowsheetEntries,
  patientHistoryItems,
  patientImmunizations,
  patientLegalResponsibilities,
  patientMedications,
  patientProblems,
  patientRecalls,
  patients,
  payers,
  paymentEntries,
  claimPayments,
  claimPaymentServiceLines,
  paymentLogs,
  payments,
  practiceSettings,
  practiceServices,
  procedureCodes,
  providers,
  reconsiderations,
  refillRequests,
  referringProviders,
  remittances,
  reconciliationLogs,
  responsibilityProfileHistory,
  responsibilitySources,
  subjectiveLibraryItems,
  visitFlowEvents,
} from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { codesFromAssessmentSubjectiveJson } from "../../../lib/assessment-note";
import {
  findLinkedInternalId,
  linkExternalId,
  resolveIntegrationId,
  resolveProviderAndFacility,
  upsertPayerAndPlan,
  validateInboundBundleShape,
  type EhrInboundBundleV1,
  type InboundIssue,
} from "../../../lib/inbound-bridge";
import { fhirBundleToInboundBundle } from "../../../lib/fhir-intake";
import {
  batchTypeFromPayer,
  buildBatchFileNames,
  buildBatchProofText,
  payerBatchGroupingKey,
} from "../../../lib/claim-batches";
import {
  claimFormatForChannel,
  deliveryChannelFromPayer,
  box22ScrubIssues,
  deriveWorkflowStatus,
  enrichScrubIssue,
  legacyStatusForWorkflow,
  SCRUB_RULES_CHECKED,
  scrubberStatusForWorkflow,
  storedBillFrequencyCode,
  type ClaimWorkflowStatus,
  type ScrubIssue,
} from "../../../lib/claim-workflow";
import {
  billStatusForParty,
  CLAIM_LIFECYCLE_LABELS,
  deriveClaimLifecycle,
  isLifecycleOnClaimPrep,
  lifecycleAfterAdjudication,
  lifecycleAfterFollowUpRebill,
  lifecycleAfterQueue,
  lifecycleAfterRebill,
  lifecycleAfterSend,
  type ClaimLifecycleStatus,
} from "../../../lib/claim-lifecycle";
import {
  buildReconciliationSnapshot,
  calculatePaymentTotalEffective,
  claimOutstandingBalance,
  derivePaymentEntryStatus,
  eraMappingError,
  isManualPaperEob,
  moneyFixed,
  moneyNumber,
  normalizePaymentMethod,
  paymentMethodDetails,
  suggestClaimPaymentSeed,
  sumClaimPostedAmounts,
  sumClaimCashAmounts,
  validatePaymentTotals,
} from "../../../lib/payment-posting";
import { claimStatusAfterPayment, parseEra835, remainingBalanceForClaim } from "../../../lib/era-835";
import { seedDemoWorkspace } from "../../../lib/demo-workspace-seed";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";
import { DEFAULT_CARE_CHECKLIST } from "../../../lib/patient-chart";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function acknowledgmentReference(batchNumber: string, response?: string | null) {
  const match = String(response || "").match(/(?:ACK|REF)[=:*-]?([A-Z0-9-]+)/i);
  return match?.[1] ? `ACK-${match[1]}` : `ACK-${batchNumber}`;
}

function acknowledgmentText(input: {
  batchNumber: string;
  payerName: string;
  payerIdentifier?: string | null;
  claimCount: string | number;
  response?: string | null;
  transmittedAt?: string | null;
  transmittedBy?: string | null;
}) {
  return [
    "PRACX CLEARINGHOUSE ACKNOWLEDGMENT",
    "===================================",
    `Acknowledgment reference: ${acknowledgmentReference(input.batchNumber, input.response)}`,
    `Batch number: ${input.batchNumber}`,
    `Payer: ${input.payerName}`,
    `Payer ID: ${input.payerIdentifier || "SELF_PAY"}`,
    `Claims acknowledged: ${input.claimCount}`,
    `Received at: ${input.transmittedAt || "Not available"}`,
    `Recorded by: ${input.transmittedBy || "Not available"}`,
    `Clearinghouse response: ${input.response || "Not available"}`,
    "",
    "This acknowledgment is a PRACX transmission record for the submitted batch.",
  ].join("\n");
}

function simplePdfFromText(text: string) {
  const lines = text.split("\n").flatMap((line) => {
    if (line.length <= 92) return [line];
    return line.match(/.{1,92}(?:\s|$)/g)?.map((part) => part.trimEnd()) || [line];
  });
  const content = ["BT", "/F1 11 Tf", "50 760 Td", ...lines.map((line, index) => `${index ? "0 -16 Td " : ""}(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function safeJsonParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

async function applyInboundBundleToPracx(db: ReturnType<typeof getDb>, input: {
  inboundEventId: string;
  sourceSystem: string;
  bundle: EhrInboundBundleV1;
  matchedPatientId?: string | null;
  currentUser: { id: string; fullName: string };
}) {
  const now = new Date().toISOString();
  const bundle = input.bundle;

  const shape = validateInboundBundleShape(bundle);
  if (!shape.ok || !shape.bundle) {
    return { error: "Inbound payload is invalid.", issues: shape.issues };
  }

  const { providerId, facilityId, issues: mappingIssues } = await resolveProviderAndFacility(db, shape.bundle);
  if (mappingIssues.some((i) => i.severity === "error")) {
    return { error: "Inbound payload could not be mapped to a provider/facility.", issues: [...shape.issues, ...mappingIssues] };
  }

  const patientPayload = shape.bundle.patient!;
  const sourceSystem = clean(shape.bundle.sourceSystem) || input.sourceSystem;

  // 1) Patient match / create
  let patientId = clean(input.matchedPatientId || "");
  const externalPatientId = clean(shape.bundle.externalIds?.patient || "");
  if (!patientId && externalPatientId) {
    patientId = (await findLinkedInternalId(db, { sourceSystem, entityType: "patient", externalId: externalPatientId })) || "";
  }
  if (!patientId) {
    const firstName = clean(patientPayload.firstName);
    const lastName = clean(patientPayload.lastName);
    const dateOfBirth = clean(patientPayload.dateOfBirth);
    const duplicates = await db.select({ id: patients.id }).from(patients).where(and(
      eq(patients.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(patients.dateOfBirth, dateOfBirth),
      sql`lower(${patients.firstName}) = lower(${firstName})`,
      sql`lower(${patients.lastName}) = lower(${lastName})`,
    )).limit(1);
    if (duplicates.length) {
      patientId = duplicates[0].id;
    } else {
      patientId = crypto.randomUUID();
      const accountNumber = `PX${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
      await db.insert(patients).values({
        id: patientId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        accountNumber,
        firstName,
        middleName: clean(patientPayload.middleName) || null,
        lastName,
        suffix: null,
        dateOfBirth,
        sex: patientPayload.sex === "male" || patientPayload.sex === "female" ? patientPayload.sex : "unknown",
        addressLine1: clean(patientPayload.addressLine1),
        addressLine2: clean(patientPayload.addressLine2) || null,
        city: clean(patientPayload.city),
        state: clean(patientPayload.state).toUpperCase(),
        postalCode: clean(patientPayload.postalCode),
        phone: clean(patientPayload.phone) || null,
        email: clean(patientPayload.email) || null,
        maritalStatus: null,
        status: "active",
      });
    }
  }

  if (externalPatientId) {
    await linkExternalId(db, { sourceSystem, entityType: "patient", externalId: externalPatientId, internalId: patientId, label: `${patientPayload.firstName} ${patientPayload.lastName}` });
  }

  // 2) Coverage (optional)
  let coverageId: string | null = null;
  const externalCoverageId = clean(shape.bundle.externalIds?.coverage || "");
  if (shape.bundle.coverage) {
    if (externalCoverageId) {
      const linked = await findLinkedInternalId(db, { sourceSystem, entityType: "coverage", externalId: externalCoverageId });
      if (linked) coverageId = linked;
    }
    if (!coverageId) {
      const { planId } = await upsertPayerAndPlan(db, shape.bundle.coverage);
      const memberId = clean(shape.bundle.coverage.memberId);
      const [existing] = await db.select({ id: patientCoverages.id }).from(patientCoverages).where(and(
        eq(patientCoverages.patientId, patientId),
        eq(patientCoverages.planId, planId),
        eq(patientCoverages.memberId, memberId),
      )).limit(1);
      coverageId = existing?.id || crypto.randomUUID();
      if (!existing) {
        const subscriberSameAsPatient = shape.bundle.coverage.subscriberSameAsPatient !== false;
        await db.insert(patientCoverages).values({
          id: coverageId,
          patientId,
          planId,
          coverageType: "health",
          priority: "primary",
          memberId,
          groupNumber: clean(shape.bundle.coverage.groupNumber) || null,
          relationship: subscriberSameAsPatient ? "self" : clean(shape.bundle.coverage.relationship) || "other",
          subscriberFirstName: subscriberSameAsPatient ? clean(patientPayload.firstName) : clean(shape.bundle.coverage.subscriberFirstName) || clean(patientPayload.firstName),
          subscriberLastName: subscriberSameAsPatient ? clean(patientPayload.lastName) : clean(shape.bundle.coverage.subscriberLastName) || clean(patientPayload.lastName),
          subscriberDateOfBirth: subscriberSameAsPatient ? clean(patientPayload.dateOfBirth) : clean(shape.bundle.coverage.subscriberDateOfBirth) || null,
          subscriberSex: subscriberSameAsPatient ? clean(patientPayload.sex || "unknown") : clean(shape.bundle.coverage.subscriberSex) || null,
          subscriberAddressLine1: subscriberSameAsPatient ? clean(patientPayload.addressLine1) : clean(shape.bundle.coverage.subscriberAddressLine1) || null,
          subscriberCity: subscriberSameAsPatient ? clean(patientPayload.city) : clean(shape.bundle.coverage.subscriberCity) || null,
          subscriberState: subscriberSameAsPatient ? clean(patientPayload.state).toUpperCase() : clean(shape.bundle.coverage.subscriberState).toUpperCase() || null,
          subscriberPostalCode: subscriberSameAsPatient ? clean(patientPayload.postalCode) : clean(shape.bundle.coverage.subscriberPostalCode) || null,
          effectiveDate: clean(shape.bundle.coverage.effectiveDate) || null,
          terminationDate: clean(shape.bundle.coverage.terminationDate) || null,
          acceptAssignment: "yes",
          releaseOfInformation: "yes",
          assignmentOfBenefits: "yes",
          status: "active",
        });
      }
    }
    if (externalCoverageId) {
      await linkExternalId(db, { sourceSystem, entityType: "coverage", externalId: externalCoverageId, internalId: coverageId, label: `${shape.bundle.coverage.payerName} ${shape.bundle.coverage.planName}` });
    }
  }

  // 3) Appointment
  const appointmentPayload = shape.bundle.appointment!;
  const externalAppointmentId = clean(shape.bundle.externalIds?.appointment || "");
  let appointmentId: string | null = null;
  if (externalAppointmentId) {
    const linked = await findLinkedInternalId(db, { sourceSystem, entityType: "appointment", externalId: externalAppointmentId });
    if (linked) appointmentId = linked;
  }
  const start = new Date(appointmentPayload.startAt);
  const duration = Number(appointmentPayload.durationMinutes ?? 30);
  const end = new Date(start.getTime() + duration * 60_000);
  if (Number.isNaN(start.getTime()) || end <= start) {
    return { error: "Inbound appointment start/duration is invalid.", issues: shape.issues };
  }

  if (!appointmentId) {
    const conflict = await db.select({ id: appointments.id }).from(appointments).where(and(
      eq(appointments.providerId, providerId),
      sql`${appointments.status} != 'cancelled'`,
      sql`${appointments.startAt} < ${end.toISOString()}`,
      sql`${appointments.endAt} > ${start.toISOString()}`,
    )).limit(1);
    if (conflict.length) {
      return { error: "Provider already has an appointment during this time.", issues: [{ severity: "error", code: "provider_conflict", field: "appointment.startAt", message: "Provider has a conflicting appointment." }] };
    }
    appointmentId = crypto.randomUUID();
    await db.insert(appointments).values({
      id: appointmentId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      patientId,
      providerId,
      facilityId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      appointmentType: clean(appointmentPayload.appointmentType) || "Office visit",
      billingContext: "routine",
      reason: clean(appointmentPayload.reason) || null,
      status: "scheduled",
      eligibilityStatus: "pending",
    });
  }
  if (externalAppointmentId && appointmentId) {
    await linkExternalId(db, { sourceSystem, entityType: "appointment", externalId: externalAppointmentId, internalId: appointmentId, label: clean(appointmentPayload.appointmentType) || "Appointment" });
  }

  // 4) Encounter (draft)
  const externalEncounterId = clean(shape.bundle.externalIds?.encounter || "");
  let encounterId: string | null = null;
  if (externalEncounterId) {
    const linked = await findLinkedInternalId(db, { sourceSystem, entityType: "encounter", externalId: externalEncounterId });
    if (linked) encounterId = linked;
  }
  if (!encounterId) {
    encounterId = crypto.randomUUID();
    const dateOfService = clean(shape.bundle.encounter?.dateOfService) || start.toISOString().slice(0, 10);
    await db.insert(encounters).values({
      id: encounterId,
      appointmentId,
      patientId,
      providerId,
      facilityId,
      referringProviderId: null,
      dateOfService,
      billingContext: "routine",
      templateKey: "general_soap",
      subjectiveItemsJson: "[]",
      chiefComplaint: clean(shape.bundle.encounter?.chiefComplaint) || null,
      historyOfPresentIllness: null,
      reviewOfSystems: null,
      physicalExam: null,
      assessment: null,
      treatmentPlan: null,
      followUpInstructions: null,
      clinicalNote: clean(shape.bundle.encounter?.clinicalNote) || null,
      codingAssistJson: "{}",
      diagnosisCodes: "[]",
      procedureCodes: "[]",
      status: "draft",
      lastSavedAt: now,
    });
    await db.insert(encounterEvents).values({
      id: crypto.randomUUID(),
      encounterId,
      action: "created",
      statusFrom: null,
      statusTo: "draft",
      changedByUserId: input.currentUser.id,
      changedByName: input.currentUser.fullName,
      occurredAt: now,
    });
  }
  if (externalEncounterId && encounterId) {
    await linkExternalId(db, { sourceSystem, entityType: "encounter", externalId: externalEncounterId, internalId: encounterId, label: `DOS ${clean(shape.bundle.encounter?.dateOfService) || start.toISOString().slice(0, 10)}` });
  }

  return {
    patientId,
    coverageId,
    appointmentId,
    encounterId,
    issues: [...shape.issues, ...mappingIssues],
  };
}

async function recordPaymentLog(
  db: ReturnType<typeof getDb>,
  input: {
    paymentId: string;
    claimId?: string | null;
    actionType: string;
    message: string;
  },
) {
  await db.insert(paymentLogs).values({
    id: crypto.randomUUID(),
    paymentId: input.paymentId,
    claimId: input.claimId || null,
    actionType: input.actionType,
    message: input.message,
    createdAt: new Date().toISOString(),
  });
}

async function refreshPaymentEntryTotals(
  db: ReturnType<typeof getDb>,
  paymentId: string,
  extras?: {
    autoPostResult?: string | null;
    errorMessage?: string | null;
    hasMismatchError?: boolean;
    clearPostedAt?: boolean;
  },
) {
  const lines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
  const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
  const claimPaidTotal = payment?.paymentMethod === "ERA" ? sumClaimCashAmounts(lines) : sumClaimPostedAmounts(lines);
  const postedClaimCount = lines.filter((row) => row.postingStatus === "posted").length;
  const status = derivePaymentEntryStatus({
    claimPayments: lines,
    hasMismatchError: extras?.hasMismatchError,
  });
  const now = new Date().toISOString();
  const zeroCheckEra = payment?.paymentMethod === "ERA" && moneyNumber(payment.paymentAmount) === 0 && claimPaidTotal > 0;
  const effective = zeroCheckEra
    ? claimPaidTotal
    : payment
      ? calculatePaymentTotalEffective(payment)
      : claimPaidTotal;
  const reconciliation = validatePaymentTotals({
    paymentAmount: payment?.paymentAmount,
    offsetAmount: payment?.offsetAmount,
    refundAmount: payment?.refundAmount,
    incentiveAmount: payment?.incentiveAmount,
    otherAdjustments: payment?.otherAdjustments,
    paymentTotalEffective: moneyFixed(effective),
    paymentMethod: payment?.paymentMethod,
    claimPayments: lines,
  });
  const patch: Record<string, string | null> = {
    claimCount: String(lines.length),
    postedClaimCount: String(postedClaimCount),
    claimPaidTotal: claimPaidTotal.toFixed(2),
    paymentStatus: status,
    paymentTotalEffective: moneyFixed(effective),
    reconciliationStatus: reconciliation.reconciliationStatus,
    updatedAt: now,
  };
  if (extras && "autoPostResult" in extras) patch.autoPostResult = extras.autoPostResult ?? null;
  if (extras && "errorMessage" in extras) patch.errorMessage = extras.errorMessage ?? null;
  if (status === "fully_posted") patch.postedAt = now;
  else if (extras?.clearPostedAt || status === "pending" || status === "error") patch.postedAt = null;
  await db.update(paymentEntries).set(patch as Partial<typeof paymentEntries.$inferInsert>).where(eq(paymentEntries.id, paymentId));
  return { lines, claimPaidTotal, postedClaimCount, status };
}

async function preflightPaymentClaims(db: ReturnType<typeof getDb>, lines: Array<typeof claimPayments.$inferSelect>) {
  const allocated = new Map<string, number>();
  for (const line of lines.filter((row) => row.postingStatus !== "posted")) {
    const [claim] = await db.select().from(claims).where(eq(claims.id, line.claimId)).limit(1);
    if (!claim) return "A mapped claim no longer exists. Review the payment.";
    const paid = Number(line.paidAmount);
    const adjustment = Number(line.adjustmentAmount);
    if (!Number.isFinite(paid) || !Number.isFinite(adjustment) || paid < 0 || adjustment < 0) return `Claim ${claim.claimNumber}: invalid payment or adjustment amount.`;
    const outstanding = claimOutstandingBalance(claim);
    if (paid + adjustment === 0 && ((!line.denialCode?.trim() && moneyNumber(line.patientResponsibility) <= 0) || outstanding <= 0.009)) return `Claim ${claim.claimNumber}: no valid payment, responsibility or open denial allocation.`;
    const total = (allocated.get(line.claimId) || 0) + paid + adjustment;
    if (total > outstanding + 0.001) return `Claim ${claim.claimNumber}: allocations exceed remaining balance ${outstanding.toFixed(2)}.`;
    allocated.set(line.claimId, total);
    const services = await db.select().from(claimPaymentServiceLines).where(eq(claimPaymentServiceLines.claimPaymentId, line.id));
    if (services.some((row) => row.postingStatus === "error" || row.errorMessage)) return `Claim ${claim.claimNumber}: correct CPT errors before posting.`;
  }
  return null;
}

async function applyClaimPaymentLine(
  db: ReturnType<typeof getDb>,
  input: {
    payment: typeof paymentEntries.$inferSelect;
    line: typeof claimPayments.$inferSelect;
    today: string;
    sourceLabel: string;
  },
) {
  const [claim] = await db.select().from(claims).where(eq(claims.id, input.line.claimId)).limit(1);
  if (!claim) return { ok: false as const, error: "Claim not found for payment line." };
  const paid = moneyNumber(input.line.paidAmount);
  const adjustment = moneyNumber(input.line.adjustmentAmount);
  const outstanding = claimOutstandingBalance(claim);
  // PR indicates responsibility, not a denial; CO-45 is a contractual reduction.
  const denialCodes = (input.line.denialCode || "").split(",").map((code) => code.trim()).filter((code) => code && !/^PR[- ]?\d/i.test(code) && code.toUpperCase() !== "CO-45");
  const hasDenial = denialCodes.length > 0;
  const hasResponsibility = moneyNumber(input.line.patientResponsibility) > 0;
  if (hasDenial && paid + adjustment <= 0 && outstanding <= 0.009) {
    return { ok: false as const, error: "Denial mapped to a claim with no remaining balance; review the claim before posting." };
  }
  if (paid < 0 || adjustment < 0 || (paid + adjustment <= 0 && !hasDenial && !hasResponsibility)) {
    return { ok: false as const, error: hasDenial ? "Enter a valid denial allocation." : "Enter a positive paid or adjustment amount." };
  }
  if (paid + adjustment > outstanding + 0.001) {
    return { ok: false as const, error: `Payment and adjustment exceed remaining balance of ${outstanding.toFixed(2)}.` };
  }
  const paymentDate = input.payment.paymentDate || input.today;
  const postingDate = input.payment.postingDate || input.today;
  const paymentRowId = crypto.randomUUID();
  const payerName = input.payment.payerId
    ? (await db.select().from(payers).where(eq(payers.id, input.payment.payerId)).limit(1))[0]?.name || null
    : null;
  await db.insert(payments).values({
    id: paymentRowId,
    paymentEntryId: input.payment.id,
    claimId: claim.id,
    remittanceId: input.payment.remittanceId || null,
    paymentType: input.payment.payerType === "patient" ? "patient" : "insurance",
    payerName,
    amount: moneyFixed(paid),
    adjustmentAmount: moneyFixed(adjustment),
    adjustmentReason: input.line.denialCode || null,
    referenceNumber: input.payment.referenceNumber || input.payment.paymentNumber,
    transactionDate: input.today,
    paymentDate,
    postingDate,
  });
  const newPaid = moneyNumber(claim.totalPaid) + paid;
  const newAdjustment = moneyNumber(claim.totalAdjustment) + adjustment;
  const remaining = remainingBalanceForClaim({
    totalCharge: claim.totalCharge,
    totalPaid: newPaid,
    totalAdjustment: newAdjustment,
  });
  const patientResp = moneyNumber(input.line.patientResponsibility) > 0
    ? moneyFixed(input.line.patientResponsibility)
    : hasDenial && paid + adjustment <= 0
      ? "0.00"
      : remaining.toFixed(2);
  const nextStatus = remaining <= 0.009
    ? "paid"
    : (paid + adjustment > 0 ? claimStatusAfterPayment(remaining, denialCodes) : (denialCodes.length ? "denied" : claim.status));
  const currentLife = deriveClaimLifecycle(claim);
  const nextLife = input.payment.payerType === "patient" ? (remaining <= 0.009 ? "closed" : currentLife) : lifecycleAfterAdjudication({
    current: currentLife,
    denied: remaining > 0.009 && paid <= 0.009 && denialCodes.length > 0,
    remaining,
    hasSecondary: await patientHasCoveragePriority(db, claim.patientId, "secondary"),
    hasTertiary: await patientHasCoveragePriority(db, claim.patientId, "tertiary"),
  });
  const nextAction = remaining <= 0.009 ? "paid_close" : input.payment.payerType === "patient" ? "bill_to_patient" : await nextResponsibilityAction(db, claim, input.payment.payerId);
  const reopenPrep = isLifecycleOnClaimPrep(nextLife);
  await db.update(claims).set({
    totalPaid: newPaid.toFixed(2),
    totalAdjustment: newAdjustment.toFixed(2),
    patientResponsibility: patientResp,
    remainingBalance: remaining.toFixed(2),
    paymentDate,
    postingDate,
    status: nextStatus,
    lifecycleStatus: nextLife,
    ...(reopenPrep ? {
      workflowStatus: "needs_scrub" as const,
      scrubberStatus: "not_run",
      batchId: null,
      submissionMethod: "unassigned" as const,
    } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(claims.id, claim.id));
  await db.update(claimPaymentServiceLines).set({ nextAction, updatedAt: new Date().toISOString() }).where(eq(claimPaymentServiceLines.claimPaymentId, input.line.id));
  await recordClaimWorkflowEvent(db, {
    claimId: claim.id,
    previousStatus: currentLife,
    newStatus: nextLife,
    action: nextLife.startsWith("denied_") ? "DENIED" : nextLife === "closed" ? "CLOSED" : "PAYMENT_POSTED",
    reason: `${CLAIM_LIFECYCLE_LABELS[nextLife]} · paid ${moneyFixed(paid)} adj ${moneyFixed(adjustment)}`,
    actorName: input.sourceLabel,
  });
  const ledgerBase = {
    paymentEntryId: input.payment.id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    patientId: claim.patientId,
    claimId: claim.id,
    source: input.sourceLabel,
    dateOfService: claim.dateOfService,
    transactionDate: input.today,
    paymentDate,
    postingDate,
    firstBilledDate: claim.firstBilledDate,
    lastBilledDate: claim.lastBilledDate,
  };
  if (paid > 0) {
    await db.insert(ledgerTransactions).values({
      id: crypto.randomUUID(),
      ...ledgerBase,
      transactionType: input.payment.payerType === "patient" ? "patient_payment" : "insurance_payment",
      amount: `-${moneyFixed(paid)}`,
      description: `${input.payment.payerType === "patient" ? "Patient" : "Insurance"} payment · ${input.payment.paymentNumber}`,
      referenceNumber: input.payment.referenceNumber || input.payment.paymentNumber,
    });
  }
  if (adjustment > 0) {
    await db.insert(ledgerTransactions).values({
      id: crypto.randomUUID(),
      ...ledgerBase,
      transactionType: "adjustment",
      amount: `-${moneyFixed(adjustment)}`,
      description: input.line.denialCode || `Adjustment · ${input.payment.paymentNumber}`,
      referenceNumber: input.payment.referenceNumber || input.payment.paymentNumber,
    });
  }
  const now = new Date().toISOString();
  await db.update(claimPayments).set({
    postingStatus: "posted",
    errorMessage: null,
    postedAt: now,
    updatedAt: now,
  }).where(eq(claimPayments.id, input.line.id));
  await db.update(claimPaymentServiceLines).set({
    postingStatus: "posted",
    errorMessage: null,
    postedAt: now,
    updatedAt: now,
  }).where(eq(claimPaymentServiceLines.claimPaymentId, input.line.id));
  return { ok: true as const, claimId: claim.id, remaining: remaining.toFixed(2) };
}

async function nextResponsibilityAction(db: ReturnType<typeof getDb>, claim: typeof claims.$inferSelect, currentPayerId: string | null) {
  const [patient] = await db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1);
  const coverages = await db.select({ coverage: patientCoverages, plan: insurancePlans }).from(patientCoverages).leftJoin(insurancePlans, eq(insurancePlans.id, patientCoverages.planId)).where(and(eq(patientCoverages.patientId, claim.patientId), eq(patientCoverages.status, "active")));
  const ordered = coverages.filter((row) => ["secondary", "tertiary"].includes(row.coverage.priority)).sort((a, b) => (a.coverage.priority === "secondary" ? 1 : 2) - (b.coverage.priority === "secondary" ? 1 : 2));
  const next = ordered.find((row) => row.plan?.payerId && row.plan.payerId !== currentPayerId);
  if (next) return next.coverage.priority === "tertiary" ? "bill_to_tertiary" : "bill_to_secondary";
  const age = patient?.dateOfBirth ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / 31557600000) : 99;
  const pediatric = age < 18;
  return pediatric ? "bill_to_guarantor" : "bill_to_patient";
}

async function syncClaimPaymentFromServiceLines(db: ReturnType<typeof getDb>, claimPaymentId: string) {
  const [parent] = await db.select().from(claimPayments).where(eq(claimPayments.id, claimPaymentId));
  if (!parent || parent.postingStatus === "posted") return null;
  const sourceDetails = parent.adjustmentDetails ? JSON.parse(parent.adjustmentDetails) : {};
  const serviceRows = await db.select().from(claimPaymentServiceLines).where(eq(claimPaymentServiceLines.claimPaymentId, claimPaymentId));
  if (!serviceRows.length) return null;
  const sum = (field: "allowedAmount" | "paidAmount" | "adjustmentAmount" | "patientResponsibility") => serviceRows.reduce((total, row) => total + moneyNumber(row[field]), 0).toFixed(2);
  const patch = {
    allowedAmount: sum("allowedAmount"),
    paidAmount: sum("paidAmount"),
    adjustmentAmount: moneyFixed(moneyNumber(sum("adjustmentAmount")) + (sourceDetails.adjustments || []).filter((row: { group: string }) => row.group !== "PR").reduce((total: number, row: { amount: string }) => total + moneyNumber(row.amount), 0)),
    patientResponsibility: parent.adjustmentDetails
      ? moneyFixed(moneyNumber(sum("patientResponsibility")) + moneyNumber(sourceDetails.unallocatedResponsibility))
      : (moneyNumber(sum("patientResponsibility")) > 0 ? sum("patientResponsibility") : parent.patientResponsibility),
    denialCode: Array.from(new Set(serviceRows.flatMap((row) => String(row.denialCode || "").split(",").map((code) => code.trim()).filter(Boolean)))).join(", ") || null,
    updatedAt: new Date().toISOString(),
  };
  await db.update(claimPayments).set(patch).where(eq(claimPayments.id, claimPaymentId));
  return patch;
}

async function recordClaimWorkflowEvent(
  db: ReturnType<typeof getDb>,
  input: {
    claimId: string;
    previousStatus?: string | null;
    newStatus: ClaimWorkflowStatus | string;
    action: string;
    reason?: string | null;
    errorInformation?: string | null;
    actorUserId?: string | null;
    actorName: string;
  },
) {
  await db.insert(claimWorkflowEvents).values({
    id: crypto.randomUUID(),
    claimId: input.claimId,
    previousStatus: input.previousStatus || null,
    newStatus: String(input.newStatus),
    action: input.action,
    reason: input.reason || null,
    errorInformation: input.errorInformation || null,
    actorUserId: input.actorUserId || null,
    actorName: input.actorName,
  });
}

async function patientHasCoveragePriority(
  db: ReturnType<typeof getDb>,
  patientId: string,
  priority: "secondary" | "tertiary",
) {
  const [row] = await db
    .select({ id: patientCoverages.id })
    .from(patientCoverages)
    .where(and(
      eq(patientCoverages.patientId, patientId),
      eq(patientCoverages.priority, priority),
      eq(patientCoverages.status, "active"),
    ))
    .limit(1);
  return Boolean(row);
}

async function writeClaimLifecycle(
  db: ReturnType<typeof getDb>,
  input: {
    claimId: string;
    previous?: string | null;
    next: ClaimLifecycleStatus;
    action: string;
    reason?: string | null;
    currentUser: { id: string; fullName: string };
    reopenPrep?: boolean;
    followUpStatus?: string;
  },
) {
  const now = new Date().toISOString();
  const patch: Partial<typeof claims.$inferInsert> = {
    lifecycleStatus: input.next,
    updatedAt: now,
  };
  if (input.followUpStatus !== undefined) patch.followUpStatus = input.followUpStatus;
  if (input.reopenPrep) patch.followUpStatus = "resubmitted";
  if (input.reopenPrep || isLifecycleOnClaimPrep(input.next)) {
    patch.batchId = null;
    if (input.reopenPrep) {
      patch.workflowStatus = "needs_scrub";
      patch.status = "draft";
      patch.scrubberStatus = "not_run";
      patch.submissionMethod = "unassigned";
    }
  }
  await db.update(claims).set(patch).where(eq(claims.id, input.claimId));
  await recordClaimWorkflowEvent(db, {
    claimId: input.claimId,
    previousStatus: input.previous || null,
    newStatus: input.next,
    action: input.action,
    reason: input.reason || CLAIM_LIFECYCLE_LABELS[input.next],
    actorUserId: input.currentUser.id,
    actorName: input.currentUser.fullName,
  });
}

const COVERAGE_PRIORITIES = ["primary", "secondary", "tertiary", "guarantor", "final_balance", "unassigned"] as const;
const VISIT_FLOW_TRANSITIONS: Record<string, string[]> = {
  not_arrived: ["arrived"],
  arrived: ["checked_in"],
  checked_in: ["waiting", "roomed"],
  waiting: ["roomed"],
  roomed: ["waiting", "ready_for_provider"],
  ready_for_provider: ["roomed", "consultation_started"],
  consultation_started: ["consultation_ended"],
  consultation_ended: ["consultation_started", "checked_out"],
  checked_out: [],
};

function coveragePriority(value: unknown) {
  const priority = clean(value);
  return COVERAGE_PRIORITIES.includes(priority as (typeof COVERAGE_PRIORITIES)[number]) ? priority : "unassigned";
}

const LOCAL_ZIP_DIRECTORY: Record<string, { city: string; state: string }> = {
  "02108": { city: "Boston", state: "MA" },
  "10022": { city: "New York", state: "NY" },
  "20001": { city: "Washington", state: "DC" },
  "33131": { city: "Miami", state: "FL" },
  "60601": { city: "Chicago", state: "IL" },
  "77002": { city: "Houston", state: "TX" },
  "90210": { city: "Beverly Hills", state: "CA" },
};

function zipParts(payload: Record<string, unknown>) {
  const suppliedZip = clean(payload.postalCode);
  const [baseZip, suppliedPlus4 = ""] = suppliedZip.split("-");
  return {
    zip5: baseZip.replace(/\D/g, "").slice(0, 5),
    zipPlus4: clean(payload.zipPlus4 || suppliedPlus4).replace(/\D/g, "").slice(0, 4),
  };
}

function standardizeAddressLine(input: unknown) {
  return clean(input)
    .toUpperCase()
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPARKWAY\b/g, "PKWY")
    .replace(/\bAPARTMENT\b/g, "APT")
    .replace(/\bSUITE\b/g, "STE")
    .replace(/\s+/g, " ");
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

const INSURANCE_COVERAGE_TYPES = new Set(["health", "medicare_medicaid", "auto_pip", "workers_comp", "liability", "other_insurance"]);
const LEGAL_RESPONSIBILITY_TYPES = new Set(["lop", "attorney", "self_pay", "other_responsibility"]);

function coverageType(input: unknown) {
  const selected = clean(input) || "health";
  return INSURANCE_COVERAGE_TYPES.has(selected) ? selected : "health";
}

function coverageClaimValues(payload: Record<string, unknown>) {
  return {
    coverageType: coverageType(payload.coverageType),
    propertyCasualtyClaimNumber: clean(payload.propertyCasualtyClaimNumber) || null,
    accidentDate: clean(payload.accidentDate) || null,
    accidentState: clean(payload.accidentState).toUpperCase() || null,
    adjusterName: clean(payload.adjusterName) || null,
    adjusterPhone: clean(payload.adjusterPhone) || null,
    adjusterEmail: clean(payload.adjusterEmail) || null,
    adjusterFax: clean(payload.adjusterFax) || null,
    claimAddressLine1: clean(payload.claimAddressLine1) || null,
    claimCity: clean(payload.claimCity) || null,
    claimState: clean(payload.claimState).toUpperCase() || null,
    claimPostalCode: clean(payload.claimPostalCode) || null,
    coverageLimit: clean(payload.coverageLimit) ? money(payload.coverageLimit) : null,
    amountUsed: clean(payload.amountUsed) ? money(payload.amountUsed) : "0.00",
    authorizationNumber: clean(payload.authorizationNumber) || null,
  };
}

function validateCoverageClaimValues(payload: Record<string, unknown>) {
  const type = coverageType(payload.coverageType);
  if (type === "auto_pip" && (!clean(payload.propertyCasualtyClaimNumber) || !clean(payload.accidentDate) || !/^[A-Z]{2}$/.test(clean(payload.accidentState).toUpperCase()))) {
    return "PIP coverage requires the property-casualty claim number, accident date and two-letter accident state.";
  }
  if (type === "workers_comp" && !clean(payload.propertyCasualtyClaimNumber)) {
    return "Workers’ compensation coverage requires its property-casualty claim number.";
  }
  if (Number(payload.amountUsed || 0) < 0 || Number(payload.coverageLimit || 0) < 0) {
    return "Coverage limit and amount used cannot be negative.";
  }
  if (clean(payload.coverageLimit) && Number(payload.amountUsed || 0) > Number(payload.coverageLimit)) {
    return "Amount used cannot exceed the recorded coverage limit.";
  }
  return "";
}

function legalResponsibilityValues(payload: Record<string, unknown>, patientId: string) {
  return {
    id: crypto.randomUUID(),
    patientId,
    responsibilityType: clean(payload.coverageType),
    balanceRole: clean(payload.balanceRole) || "final_balance",
    organizationName: clean(payload.organizationName) || null,
    attorneyName: clean(payload.attorneyName) || null,
    caseNumber: clean(payload.caseNumber) || null,
    lopNumber: clean(payload.lopNumber) || null,
    signedDate: clean(payload.signedDate) || null,
    receivedDate: clean(payload.receivedDate) || null,
    effectiveDate: clean(payload.effectiveDate) || null,
    terminationDate: clean(payload.terminationDate) || null,
    authorizedAmount: clean(payload.authorizedAmount) ? money(payload.authorizedAmount) : null,
    settlementStatus: clean(payload.settlementStatus) || "open",
    lienStatus: clean(payload.lienStatus) || "not_recorded",
    phone: clean(payload.responsibilityPhone) || null,
    email: clean(payload.responsibilityEmail) || null,
    fax: clean(payload.responsibilityFax) || null,
    addressLine1: clean(payload.responsibilityAddressLine1) || null,
    city: clean(payload.responsibilityCity) || null,
    state: clean(payload.responsibilityState).toUpperCase() || null,
    postalCode: clean(payload.responsibilityPostalCode) || null,
    notes: clean(payload.responsibilityNotes) || null,
    status: "active" as const,
  };
}

function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function claim837({
  claim,
  patient,
  payer,
  provider,
  lines,
  coverage,
}: {
  claim: typeof claims.$inferSelect;
  patient: typeof patients.$inferSelect;
  payer: typeof payers.$inferSelect | null;
  provider: typeof providers.$inferSelect;
  lines: (typeof claimLines.$inferSelect)[];
  coverage: typeof patientCoverages.$inferSelect | null;
}) {
  let snapshot: Record<string, string> = {};
  try { snapshot = JSON.parse(claim.claimDataSnapshot || "{}") as Record<string, string>; } catch { snapshot = {}; }
  const control = claim.claimNumber.replace(/\D/g, "").slice(-9).padStart(9, "0");
  const now = new Date();
  const ymd = now.toISOString().slice(2, 10).replaceAll("-", "");
  const hm = now.toISOString().slice(11, 16).replace(":", "");
  const filingIndicator = coverage?.coverageType === "auto_pip"
    ? "AM"
    : coverage?.coverageType === "workers_comp"
      ? "WC"
      : payer?.claimFilingIndicator || "CI";
  const relationship = snapshot.relationship || coverage?.relationship;
  const relationshipCode = relationship === "spouse" ? "01" : relationship === "child" ? "19" : relationship === "self" || !coverage ? "18" : "G8";
  const subscriberIsPatient = relationshipCode === "18";
  const subscriberSexValue = snapshot.subscriberSex || coverage?.subscriberSex;
  const subscriberSex = subscriberSexValue === "male" ? "M" : subscriberSexValue === "female" ? "F" : "U";
  const acceptAssignment = snapshot.acceptAssignment || (coverage?.acceptAssignment === "no" ? "N" : "Y");
  const relatedCause = claim.autoAccidentRelated === "Y"
    ? `AA:::${claim.autoAccidentState || ""}`
    : claim.employmentRelated === "Y"
      ? "EM"
      : claim.otherAccidentRelated === "Y" ? "OA" : "";
  const billingOtherIdQualifier = String(claim.billingProviderOtherIdQualifier || "").trim().toUpperCase();
  const billingOtherId = String(claim.billingProviderOtherId || "").replace(/[^A-Z0-9]/gi, "");
  const transactionSegments = [
    `ST*837*0001*005010X222A1~`,
    `BHT*0019*00*${claim.claimNumber}*20${ymd}*${hm}*CH~`,
    `NM1*41*2*PRACX CARE OPERATIONS*****46*PRACX~`,
    `NM1*40*2*${payer?.name || "FILE EXPORT"}*****46*${payer?.payerId || "FILE"}~`,
    `HL*1**20*1~`,
    `NM1*85*2*PRACX HEALTH NETWORK*****XX*${provider.npi || "0000000000"}~`,
    ...(billingOtherIdQualifier && billingOtherId
      ? billingOtherIdQualifier === "ZZ" ? [`PRV*BI*PXC*${billingOtherId}~`] : [`REF*${billingOtherIdQualifier}*${billingOtherId}~`]
      : provider.taxonomyCode ? [`PRV*BI*PXC*${String(provider.taxonomyCode).replace(/[^A-Z0-9]/gi, "")}~`] : []),
    `HL*2*1*22*${subscriberIsPatient ? "0" : "1"}~`,
    `SBR*P*${relationshipCode}*******${filingIndicator}~`,
    `NM1*IL*1*${snapshot.subscriberLastName || coverage?.subscriberLastName || patient.lastName}*${snapshot.subscriberFirstName || coverage?.subscriberFirstName || patient.firstName}****MI*${snapshot.memberId || coverage?.memberId || ""}~`,
    `DMG*D8*${(snapshot.subscriberDateOfBirth || coverage?.subscriberDateOfBirth || snapshot.patientDateOfBirth || patient.dateOfBirth).replaceAll("-", "")}*${coverage ? subscriberSex : patient.sex === "male" ? "M" : patient.sex === "female" ? "F" : "U"}~`,
    ...(!subscriberIsPatient ? [
      `HL*3*2*23*0~`,
      `PAT*${relationshipCode}~`,
      `NM1*QC*1*${snapshot.patientLastName || patient.lastName}*${snapshot.patientFirstName || patient.firstName}*${snapshot.patientMiddleName || patient.middleName || ""}~`,
      `DMG*D8*${(snapshot.patientDateOfBirth || patient.dateOfBirth).replaceAll("-", "")}*${snapshot.patientSex === "male" || (!snapshot.patientSex && patient.sex === "male") ? "M" : snapshot.patientSex === "female" || (!snapshot.patientSex && patient.sex === "female") ? "F" : "U"}~`,
    ] : []),
    ...(coverage?.propertyCasualtyClaimNumber ? [`REF*Y4*${coverage.propertyCasualtyClaimNumber}~`] : []),
    `CLM*${claim.claimNumber}*${claim.totalCharge}***11:B:1*Y*${acceptAssignment === "N" ? "C" : "A"}*Y*Y**${relatedCause}~`,
    ...(coverage?.accidentDate ? [`DTP*439*D8*${coverage.accidentDate.replaceAll("-", "")}~`] : []),
    ...(coverage?.authorizationNumber ? [`REF*G1*${coverage.authorizationNumber}~`] : []),
    ...(() => {
      let diagnoses: string[] = [];
      try { diagnoses = JSON.parse(claim.diagnosisCodes || "[]") as string[]; } catch { diagnoses = []; }
      return diagnoses.length ? [`HI*${diagnoses.map((code, index) => `${index === 0 ? "ABK" : "ABF"}:${code.replace(".", "")}`).join("*")}~`] : [];
    })(),
    ...lines.flatMap((line, index) => [
      `LX*${index + 1}~`,
      `SV1*HC:${line.procedureCode}${line.modifiers ? `:${line.modifiers.replaceAll(",", ":")}` : ""}*${line.chargeAmount}*UN*${line.units}***${line.diagnosisPointers}~`,
      `DTP*472*D8*${line.serviceDateFrom.replaceAll("-", "")}~`,
      ...(line.renderingNpi ? [`NM1*82*1*${provider.lastName || ""}*${provider.firstName || ""}****XX*${line.renderingNpi}~`] : []),
      ...(line.renderingOtherIdQualifier === "ZZ" && line.renderingOtherId ? [`PRV*PE*PXC*${String(line.renderingOtherId).replace(/[^A-Z0-9]/gi, "")}~`] : []),
    ]),
  ];
  const segments = [
    `ISA*00*          *00*          *ZZ*PRACX          *ZZ*${(payer?.payerId || "FILE").padEnd(15)}*${ymd}*${hm}*^*00501*${control}*0*T*:~`,
    `GS*HC*PRACX*${payer?.payerId || "FILE"}*20${ymd}*${hm}*${Number(control)}*X*005010X222A1~`,
    ...transactionSegments,
    `SE*${transactionSegments.length + 1}*0001~`,
    `GE*1*${Number(control)}~`,
    `IEA*1*${control}~`,
  ];
  return segments.join("\n");
}

async function performEligibilityCheck(
  db: ReturnType<typeof getDb>,
  patientId: string,
  dateOfService: string,
  selectedCoverageId?: string,
) {
  const [coverage] = await db
    .select({
      id: patientCoverages.id,
      memberId: patientCoverages.memberId,
      groupNumber: patientCoverages.groupNumber,
      relationship: patientCoverages.relationship,
      effectiveDate: patientCoverages.effectiveDate,
      terminationDate: patientCoverages.terminationDate,
      subscriberAddressLine1: patientCoverages.subscriberAddressLine1,
      subscriberCity: patientCoverages.subscriberCity,
      subscriberState: patientCoverages.subscriberState,
      subscriberPostalCode: patientCoverages.subscriberPostalCode,
      planName: insurancePlans.name,
      planType: insurancePlans.planType,
      defaultGroupNumber: insurancePlans.defaultGroupNumber,
      payerName: payers.name,
      payerIdentifier: payers.payerId,
    })
    .from(patientCoverages)
    .innerJoin(insurancePlans, eq(insurancePlans.id, patientCoverages.planId))
    .innerJoin(payers, eq(payers.id, insurancePlans.payerId))
    .where(and(
      eq(patientCoverages.patientId, patientId),
      eq(patientCoverages.status, "active"),
      selectedCoverageId ? eq(patientCoverages.id, selectedCoverageId) : undefined,
    ))
    .orderBy(sql`case ${patientCoverages.priority} when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3 when 'guarantor' then 4 when 'final_balance' then 5 else 6 end`)
    .limit(1);
  if (!coverage) return { error: "No active coverage is available for this patient." };

  const [adapter] = await db
    .select()
    .from(integrations)
    .where(and(
      eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(integrations.integrationType, "eligibility_270_271"),
    ))
    .limit(1);
  if (adapter?.mode === "live" && adapter.status !== "active") {
    return { error: "The live eligibility adapter still requires credentials and activation." };
  }
  if (adapter?.mode === "live") {
    return { error: "The live 270/271 transport must be certified before production inquiries can be sent." };
  }

  const groupNumber = coverage.groupNumber || coverage.defaultGroupNumber || null;
  if (!coverage.groupNumber && groupNumber) {
    await db.update(patientCoverages).set({ groupNumber }).where(eq(patientCoverages.id, coverage.id));
  }

  const id = crypto.randomUUID();
  const referenceNumber = `ELG${Date.now().toString().slice(-8)}`;
  const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  const details = {
    payerName: coverage.payerName,
    payerIdentifier: coverage.payerIdentifier,
    planName: coverage.planName,
    planType: coverage.planType,
    memberId: coverage.memberId,
    groupNumber,
    relationship: coverage.relationship,
    effectiveDate: coverage.effectiveDate,
    terminationDate: coverage.terminationDate,
    returnedAddress: {
      addressLine1: coverage.subscriberAddressLine1 || patient?.addressLine1 || "",
      addressLine2: patient?.addressLine2 || "",
      city: coverage.subscriberCity || patient?.city || "",
      state: coverage.subscriberState || patient?.state || "",
      postalCode: coverage.subscriberPostalCode || patient?.postalCode || "",
    },
    currentPatientAddress: {
      addressLine1: patient?.addressLine1 || "",
      addressLine2: patient?.addressLine2 || "",
      city: patient?.city || "",
      state: patient?.state || "",
      postalCode: patient?.postalCode || "",
    },
    status: "eligible",
    copayAmount: "30.00",
    deductibleRemaining: "420.00",
    coinsurancePercent: "20",
    responseMode: adapter?.mode || "test",
  };
  await db.insert(eligibilityChecks).values({
    id,
    patientId,
    coverageId: coverage.id,
    dateOfService,
    status: "eligible",
    copayAmount: details.copayAmount,
    deductibleRemaining: details.deductibleRemaining,
    coinsurancePercent: details.coinsurancePercent,
    referenceNumber,
    responseSummary: `${details.responseMode}-mode 271 response: active ${coverage.planName} medical coverage. Verify payer-specific limitations.`,
    responseDetails: JSON.stringify(details),
  });
  await db
    .update(appointments)
    .set({ eligibilityStatus: "eligible" })
    .where(and(
      eq(appointments.patientId, patientId),
      sql`date(${appointments.startAt}) = ${dateOfService}`,
    ));
  return { id, status: "eligible", referenceNumber, details };
}

async function loadWorkspace() {
  const db = getDb();
  const [
    patientRows,
    coverageRows,
    payerRows,
    planRows,
    providerRows,
    facilityRows,
    referringRows,
    appointmentRows,
    eligibilityRows,
    encounterRows,
    procedureRows,
    feeRows,
    feeItemRows,
    claimRows,
    claimLineRows,
    claimCorrectionRows,
    claimWorkflowEventRows,
    claimBatchRows,
    claimBatchMemberRows,
    claimTransmissionLogRows,
    paymentEntryRows,
    claimPaymentRows,
    claimPaymentServiceLineRows,
    paymentLogRows,
    remittanceRows,
    paymentRows,
    reconciliationLogRows,
    transactionRows,
    reconsiderationRows,
    integrationRows,
    inboundEventRows,
    syncEventRows,
    responsibilityProfileRows,
    responsibilitySourceRows,
    responsibilityHistoryRows,
    responsibilitySnapshotRows,
    claimConfigurationRows,
    eligibilityUpdateRows,
    legalResponsibilityRows,
    patientDocumentRows,
    practiceSettingRows,
    visitFlowEventRows,
    encounterEventRows,
    clinicalOrderRows,
    diagnosisCodeRows,
    clinicalOrderCatalogRows,
    clinicalOrderResultRows,
    patientMedicationRows,
    patientAllergyRows,
    patientProblemRows,
    patientHistoryRows,
    patientImmunizationRows,
    patientFlowsheetRows,
    patientChecklistRows,
    patientRecallRows,
    refillRequestRows,
    clinicalContentRows,
    clinicalOptionRows,
    subjectiveLibraryRows,
    practiceServiceRows,
  ] = await Promise.all([
    db.select().from(patients).where(eq(patients.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(patients.lastName)),
    db.select().from(patientCoverages).orderBy(asc(patientCoverages.priority)),
    db.select().from(payers).where(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(payers.name)),
    db.select().from(insurancePlans).orderBy(asc(insurancePlans.name)),
    db.select().from(providers).where(eq(providers.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(providers.lastName)),
    db.select().from(facilities).where(eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(facilities.name)),
    db.select().from(referringProviders).where(eq(referringProviders.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(referringProviders.lastName)),
    db
      .select({
        id: appointments.id,
        patientId: appointments.patientId,
        providerId: appointments.providerId,
        facilityId: appointments.facilityId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        appointmentType: appointments.appointmentType,
        billingContext: appointments.billingContext,
        reason: appointments.reason,
        status: appointments.status,
        eligibilityStatus: appointments.eligibilityStatus,
        flowStatus: appointments.flowStatus,
        roomName: appointments.roomName,
        flowStatusAt: appointments.flowStatusAt,
        arrivedAt: appointments.arrivedAt,
        checkedInAt: appointments.checkedInAt,
        waitingAt: appointments.waitingAt,
        roomedAt: appointments.roomedAt,
        readyForProviderAt: appointments.readyForProviderAt,
        consultationStartedAt: appointments.consultationStartedAt,
        consultationEndedAt: appointments.consultationEndedAt,
        checkedOutAt: appointments.checkedOutAt,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        providerName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
        facilityName: facilities.name,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(providers, eq(providers.id, appointments.providerId))
      .innerJoin(facilities, eq(facilities.id, appointments.facilityId))
      .orderBy(asc(appointments.startAt)),
    db
      .select({
        id: eligibilityChecks.id,
        patientId: eligibilityChecks.patientId,
        coverageId: eligibilityChecks.coverageId,
        dateOfService: eligibilityChecks.dateOfService,
        status: eligibilityChecks.status,
        copayAmount: eligibilityChecks.copayAmount,
        deductibleRemaining: eligibilityChecks.deductibleRemaining,
        coinsurancePercent: eligibilityChecks.coinsurancePercent,
        referenceNumber: eligibilityChecks.referenceNumber,
        responseSummary: eligibilityChecks.responseSummary,
        checkedAt: eligibilityChecks.checkedAt,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        memberId: patientCoverages.memberId,
        groupNumber: patientCoverages.groupNumber,
        relationship: patientCoverages.relationship,
        effectiveDate: patientCoverages.effectiveDate,
        terminationDate: patientCoverages.terminationDate,
        planName: insurancePlans.name,
        planType: insurancePlans.planType,
        payerName: payers.name,
        payerIdentifier: payers.payerId,
        responseMode: sql<string>`case when lower(${eligibilityChecks.responseSummary}) like 'live-mode%' then 'live' else 'test' end`,
      })
      .from(eligibilityChecks)
      .innerJoin(patients, eq(patients.id, eligibilityChecks.patientId))
      .innerJoin(patientCoverages, eq(patientCoverages.id, eligibilityChecks.coverageId))
      .innerJoin(insurancePlans, eq(insurancePlans.id, patientCoverages.planId))
      .innerJoin(payers, eq(payers.id, insurancePlans.payerId))
      .orderBy(desc(eligibilityChecks.checkedAt)),
    db
      .select({
        id: encounters.id,
        appointmentId: encounters.appointmentId,
        patientId: encounters.patientId,
        providerId: encounters.providerId,
        facilityId: encounters.facilityId,
        referringProviderId: encounters.referringProviderId,
        dateOfService: encounters.dateOfService,
        billingContext: encounters.billingContext,
        templateKey: encounters.templateKey,
        subjectiveItemsJson: encounters.subjectiveItemsJson,
        chiefComplaint: encounters.chiefComplaint,
        historyOfPresentIllness: encounters.historyOfPresentIllness,
        reviewOfSystems: encounters.reviewOfSystems,
        physicalExam: encounters.physicalExam,
        assessment: encounters.assessment,
        treatmentPlan: encounters.treatmentPlan,
        followUpInstructions: encounters.followUpInstructions,
        vitals: encounters.vitals,
        allergiesReviewed: encounters.allergiesReviewed,
        medicationsReviewed: encounters.medicationsReviewed,
        clinicalNote: encounters.clinicalNote,
        codingAssistJson: encounters.codingAssistJson,
        diagnosisCodes: encounters.diagnosisCodes,
        procedureCodes: encounters.procedureCodes,
        status: encounters.status,
        signedAt: encounters.signedAt,
        signedByName: encounters.signedByName,
        readyToBillAt: encounters.readyToBillAt,
        lastSavedAt: encounters.lastSavedAt,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        providerName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
      })
      .from(encounters)
      .innerJoin(patients, eq(patients.id, encounters.patientId))
      .innerJoin(providers, eq(providers.id, encounters.providerId))
      .orderBy(desc(encounters.dateOfService)),
    db.select().from(procedureCodes).orderBy(asc(procedureCodes.code)),
    db.select().from(feeSchedules).where(eq(feeSchedules.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(feeSchedules.name)),
    db.select().from(feeScheduleItems),
    db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        patientId: claims.patientId,
        encounterId: claims.encounterId,
        coverageId: claims.coverageId,
        payerId: claims.payerId,
        providerId: claims.providerId,
        facilityId: claims.facilityId,
        referringProviderId: claims.referringProviderId,
        insuranceTypeCode: claims.insuranceTypeCode,
        otherPlanIndicator: claims.otherPlanIndicator,
        employmentRelated: claims.employmentRelated,
        autoAccidentRelated: claims.autoAccidentRelated,
        autoAccidentState: claims.autoAccidentState,
        otherAccidentRelated: claims.otherAccidentRelated,
        claimConditionCodes: claims.claimConditionCodes,
        dateOfService: claims.dateOfService,
        transactionDate: claims.transactionDate,
        paymentDate: claims.paymentDate,
        postingDate: claims.postingDate,
        firstBilledDate: claims.firstBilledDate,
        lastBilledDate: claims.lastBilledDate,
        status: claims.status,
        lifecycleStatus: claims.lifecycleStatus,
        workflowStatus: claims.workflowStatus,
        scrubberStatus: claims.scrubberStatus,
        scrubberMessages: claims.scrubberMessages,
        lastScrubbedAt: claims.lastScrubbedAt,
        scrubResult: claims.scrubResult,
        scrubRulesChecked: claims.scrubRulesChecked,
        scrubErrorCount: claims.scrubErrorCount,
        scrubbedByName: claims.scrubbedByName,
        totalCharge: claims.totalCharge,
        totalPaid: claims.totalPaid,
        totalAdjustment: claims.totalAdjustment,
        patientResponsibility: claims.patientResponsibility,
        remainingBalance: claims.remainingBalance,
        followUpStatus: claims.followUpStatus,
        submissionMode: claims.submissionMode,
        submissionMethod: claims.submissionMethod,
        routedAt: claims.routedAt,
        printedAt: claims.printedAt,
        mailedAt: claims.mailedAt,
        mailedByName: claims.mailedByName,
        mailMethod: claims.mailMethod,
        mailTrackingNumber: claims.mailTrackingNumber,
        clearinghouseTrace: claims.clearinghouseTrace,
        generationId: claims.generationId,
        generatedAt: claims.generatedAt,
        generatedByName: claims.generatedByName,
        claimFormat: claims.claimFormat,
        generationResult: claims.generationResult,
        generatedTransactionRef: claims.generatedTransactionRef,
        batchId: claims.batchId,
        otherClaimIdQualifier: claims.otherClaimIdQualifier,
        otherClaimId: claims.otherClaimId,
        conditionDateQualifier: claims.conditionDateQualifier,
        conditionDate: claims.conditionDate,
        otherDateQualifier: claims.otherDateQualifier,
        otherDate: claims.otherDate,
        referringProviderQualifier: claims.referringProviderQualifier,
        referringOtherIdQualifier: claims.referringOtherIdQualifier,
        referringOtherId: claims.referringOtherId,
        additionalClaimInfoQualifier: claims.additionalClaimInfoQualifier,
        additionalClaimInfo: claims.additionalClaimInfo,
        serviceFacilityOtherIdQualifier: claims.serviceFacilityOtherIdQualifier,
        serviceFacilityOtherId: claims.serviceFacilityOtherId,
        billingProviderOtherIdQualifier: claims.billingProviderOtherIdQualifier,
        billingProviderOtherId: claims.billingProviderOtherId,
        icdIndicator: claims.icdIndicator,
        diagnosisCodes: claims.diagnosisCodes,
        claimDataSnapshot: claims.claimDataSnapshot,
        billFrequencyCode: claims.billFrequencyCode,
        originalReferenceNumber: claims.originalReferenceNumber,
        unableToWorkFrom: claims.unableToWorkFrom,
        unableToWorkTo: claims.unableToWorkTo,
        hospitalizationFrom: claims.hospitalizationFrom,
        hospitalizationTo: claims.hospitalizationTo,
        outsideLabIndicator: claims.outsideLabIndicator,
        outsideLabCharges: claims.outsideLabCharges,
        priorAuthorizationNumber: claims.priorAuthorizationNumber,
        federalTaxIdType: claims.federalTaxIdType,
        federalTaxIdNumber: claims.federalTaxIdNumber,
        patientSignatureOnFile: claims.patientSignatureOnFile,
        patientSignatureDate: claims.patientSignatureDate,
        insuredSignatureOnFile: claims.insuredSignatureOnFile,
        providerSignatureOnFile: claims.providerSignatureOnFile,
        providerSignatureDate: claims.providerSignatureDate,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        payerName: payers.name,
        payerClaimPayerId: payers.payerId,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        payerClearinghouseRoute: payers.clearinghouseRoute,
        providerName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
        facilityName: facilities.name,
      })
      .from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(providers, eq(providers.id, claims.providerId))
      .innerJoin(facilities, eq(facilities.id, claims.facilityId))
      .leftJoin(payers, eq(payers.id, claims.payerId))
      .where(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(claims.transactionDate)),
    db.select().from(claimLines).orderBy(asc(claimLines.lineNumber)),
    db.select().from(claimCorrectionHistory).orderBy(desc(claimCorrectionHistory.createdAt)),
    db.select().from(claimWorkflowEvents).orderBy(desc(claimWorkflowEvents.createdAt)),
    db
      .select({
        id: claimBatches.id,
        batchNumber: claimBatches.batchNumber,
        payerId: claimBatches.payerId,
        batchType: claimBatches.batchType,
        status: claimBatches.status,
        claimCount: claimBatches.claimCount,
        totalCharge: claimBatches.totalCharge,
        ediFileName: claimBatches.ediFileName,
        ediFilePath: claimBatches.ediFilePath,
        proofFileName: claimBatches.proofFileName,
        proofFilePath: claimBatches.proofFilePath,
        clearinghouseResponse: claimBatches.clearinghouseResponse,
        transmittedAt: claimBatches.transmittedAt,
        transmittedByName: claimBatches.transmittedByName,
        createdByName: claimBatches.createdByName,
        createdAt: claimBatches.createdAt,
        updatedAt: claimBatches.updatedAt,
        payerName: payers.name,
        payerClaimPayerId: payers.payerId,
        payerClearinghouseRoute: payers.clearinghouseRoute,
      })
      .from(claimBatches)
      .leftJoin(payers, eq(payers.id, claimBatches.payerId))
      .where(eq(claimBatches.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(claimBatches.createdAt)),
    db.select().from(claimBatchMembers),
    db.select().from(claimTransmissionLogs).orderBy(desc(claimTransmissionLogs.transmissionTime)),
    db
      .select({
        id: paymentEntries.id,
        paymentNumber: paymentEntries.paymentNumber,
        payerType: paymentEntries.payerType,
        patientId: paymentEntries.patientId,
        encounterId: paymentEntries.encounterId,
        serviceDate: paymentEntries.serviceDate,
        paymentPurpose: paymentEntries.paymentPurpose,
        payerId: paymentEntries.payerId,
        remittanceId: paymentEntries.remittanceId,
        paymentAmount: paymentEntries.paymentAmount,
        offsetAmount: paymentEntries.offsetAmount,
        refundAmount: paymentEntries.refundAmount,
        incentiveAmount: paymentEntries.incentiveAmount,
        otherAdjustments: paymentEntries.otherAdjustments,
        paymentTotalEffective: paymentEntries.paymentTotalEffective,
        paymentMethod: paymentEntries.paymentMethod,
        methodDetails: paymentEntries.methodDetails,
        referenceNumber: paymentEntries.referenceNumber,
        paymentDate: paymentEntries.paymentDate,
        postingDate: paymentEntries.postingDate,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        notes: paymentEntries.notes,
        paymentStatus: paymentEntries.paymentStatus,
        claimCount: paymentEntries.claimCount,
        postedClaimCount: paymentEntries.postedClaimCount,
        claimPaidTotal: paymentEntries.claimPaidTotal,
        autoPostResult: paymentEntries.autoPostResult,
        errorMessage: paymentEntries.errorMessage,
        reconciliationStatus: paymentEntries.reconciliationStatus,
        createdByName: paymentEntries.createdByName,
        postedAt: paymentEntries.postedAt,
        createdAt: paymentEntries.createdAt,
        updatedAt: paymentEntries.updatedAt,
        payerName: payers.name,
        payerClaimPayerId: payers.payerId,
      })
      .from(paymentEntries)
      .leftJoin(payers, eq(payers.id, paymentEntries.payerId))
      .leftJoin(patients, eq(patients.id, paymentEntries.patientId))
      .where(eq(paymentEntries.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(paymentEntries.createdAt)),
    db
      .select({
        id: claimPayments.id,
        paymentId: claimPayments.paymentId,
        claimId: claimPayments.claimId,
        allowedAmount: claimPayments.allowedAmount,
        paidAmount: claimPayments.paidAmount,
        adjustmentAmount: claimPayments.adjustmentAmount,
        patientResponsibility: claimPayments.patientResponsibility,
        adjustmentDetails: claimPayments.adjustmentDetails,
        denialCode: claimPayments.denialCode,
        postingStatus: claimPayments.postingStatus,
        errorMessage: claimPayments.errorMessage,
        postedAt: claimPayments.postedAt,
        createdAt: claimPayments.createdAt,
        updatedAt: claimPayments.updatedAt,
        claimNumber: claims.claimNumber,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        dateOfService: claims.dateOfService,
        totalCharge: claims.totalCharge,
        totalPaid: claims.totalPaid,
        totalAdjustment: claims.totalAdjustment,
        remainingBalance: claims.remainingBalance,
        claimStatus: claims.status,
      })
      .from(claimPayments)
      .innerJoin(claims, eq(claims.id, claimPayments.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .orderBy(asc(claims.claimNumber)),
    db.select().from(claimPaymentServiceLines).orderBy(asc(claimPaymentServiceLines.serviceDate), asc(claimPaymentServiceLines.procedureCode)),
    db.select().from(paymentLogs).orderBy(desc(paymentLogs.createdAt)),
    db
      .select({
        id: remittances.id,
        payerId: remittances.payerId,
        traceNumber: remittances.traceNumber,
        paymentDate: remittances.paymentDate,
        postingDate: remittances.postingDate,
        amount: remittances.amount,
        source: remittances.source,
        status: remittances.status,
        processedStatus: remittances.processedStatus,
        fileName: remittances.fileName,
        filePath: remittances.filePath,
        paymentEntryId: remittances.paymentEntryId,
        unmatchedJson: remittances.unmatchedJson,
        parseWarningsJson: remittances.parseWarningsJson,
        errorMessage: remittances.errorMessage,
        receivedAt: remittances.receivedAt,
        postedAt: remittances.postedAt,
        processedAt: remittances.processedAt,
        payerName: payers.name,
      })
      .from(remittances)
      .leftJoin(payers, eq(payers.id, remittances.payerId))
      .orderBy(desc(remittances.receivedAt)),
    db.select().from(payments).orderBy(desc(payments.postingDate)),
    db.select().from(reconciliationLogs).orderBy(desc(reconciliationLogs.createdAt)),
    db
      .select({
        id: ledgerTransactions.id,
        paymentEntryId: ledgerTransactions.paymentEntryId,
        paymentNumber: paymentEntries.paymentNumber,
        patientId: ledgerTransactions.patientId,
        claimId: ledgerTransactions.claimId,
        transactionType: ledgerTransactions.transactionType,
        source: ledgerTransactions.source,
        amount: ledgerTransactions.amount,
        description: ledgerTransactions.description,
        referenceNumber: ledgerTransactions.referenceNumber,
        dateOfService: ledgerTransactions.dateOfService,
        transactionDate: ledgerTransactions.transactionDate,
        paymentDate: ledgerTransactions.paymentDate,
        postingDate: ledgerTransactions.postingDate,
        firstBilledDate: ledgerTransactions.firstBilledDate,
        lastBilledDate: ledgerTransactions.lastBilledDate,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        claimNumber: claims.claimNumber,
      })
      .from(ledgerTransactions)
      .leftJoin(paymentEntries, eq(paymentEntries.id, ledgerTransactions.paymentEntryId))
      .innerJoin(patients, eq(patients.id, ledgerTransactions.patientId))
      .leftJoin(claims, eq(claims.id, ledgerTransactions.claimId))
      .where(eq(ledgerTransactions.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(ledgerTransactions.postingDate)),
    db.select().from(reconsiderations).orderBy(desc(reconsiderations.createdAt)),
    db.select().from(integrations).where(eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID)),
    db.select().from(integrationInboundEvents).where(eq(integrationInboundEvents.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(desc(integrationInboundEvents.receivedAt)),
    db.select().from(integrationSyncEvents).where(eq(integrationSyncEvents.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(desc(integrationSyncEvents.occurredAt)),
    db.select().from(billingResponsibilityProfiles).orderBy(desc(billingResponsibilityProfiles.effectiveFrom)),
    db.select().from(responsibilitySources).orderBy(asc(responsibilitySources.sequence)),
    db.select().from(responsibilityProfileHistory).orderBy(desc(responsibilityProfileHistory.createdAt)),
    db.select().from(claimResponsibilitySnapshots).orderBy(desc(claimResponsibilitySnapshots.createdAt)),
    db.select().from(claimConfigurationValues).where(eq(claimConfigurationValues.status, "active")).orderBy(asc(claimConfigurationValues.category), asc(claimConfigurationValues.code)),
    db.select().from(eligibilityUpdateHistory).orderBy(desc(eligibilityUpdateHistory.createdAt)),
    db.select().from(patientLegalResponsibilities).orderBy(desc(patientLegalResponsibilities.createdAt)),
    db.select().from(patientDocuments).where(eq(patientDocuments.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(desc(patientDocuments.createdAt)),
    db.select().from(practiceSettings).where(eq(practiceSettings.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1),
    db.select().from(visitFlowEvents).orderBy(desc(visitFlowEvents.occurredAt)),
    db.select().from(encounterEvents).orderBy(desc(encounterEvents.occurredAt)),
    db.select().from(clinicalOrders).orderBy(desc(clinicalOrders.orderedAt)),
    db.select().from(diagnosisCodeMaster).where(eq(diagnosisCodeMaster.status, "active")).orderBy(asc(diagnosisCodeMaster.code)),
    db.select().from(clinicalOrderCatalog).where(eq(clinicalOrderCatalog.status, "active")).orderBy(asc(clinicalOrderCatalog.orderType), asc(clinicalOrderCatalog.sortOrder), asc(clinicalOrderCatalog.name)),
    db.select().from(clinicalOrderResults).orderBy(desc(clinicalOrderResults.resultedAt)),
    db.select().from(patientMedications).orderBy(desc(patientMedications.updatedAt)),
    db.select().from(patientAllergies).orderBy(desc(patientAllergies.updatedAt)),
    db.select().from(patientProblems).orderBy(desc(patientProblems.updatedAt)),
    db.select().from(patientHistoryItems).orderBy(desc(patientHistoryItems.updatedAt)),
    db.select().from(patientImmunizations).orderBy(desc(patientImmunizations.administeredOn)),
    db.select().from(patientFlowsheetEntries).orderBy(desc(patientFlowsheetEntries.recordedAt)),
    db.select().from(patientCareChecklistItems).orderBy(asc(patientCareChecklistItems.category), asc(patientCareChecklistItems.label)),
    db.select().from(patientRecalls).orderBy(asc(patientRecalls.dueDate)),
    db.select().from(refillRequests).orderBy(desc(refillRequests.requestedAt)),
    db.select().from(clinicalContentItems).where(eq(clinicalContentItems.status, "active")).orderBy(asc(clinicalContentItems.section), asc(clinicalContentItems.sortOrder)),
    db.select().from(clinicalOptionMaster).where(and(eq(clinicalOptionMaster.organizationId, DEFAULT_ORGANIZATION_ID), eq(clinicalOptionMaster.status, "active"))).orderBy(asc(clinicalOptionMaster.optionGroup), asc(clinicalOptionMaster.sortOrder), asc(clinicalOptionMaster.label)),
    db.select().from(subjectiveLibraryItems).where(and(eq(subjectiveLibraryItems.organizationId, DEFAULT_ORGANIZATION_ID), eq(subjectiveLibraryItems.status, "active"))).orderBy(asc(subjectiveLibraryItems.itemType), asc(subjectiveLibraryItems.title)),
    db.select().from(practiceServices).where(and(eq(practiceServices.organizationId, DEFAULT_ORGANIZATION_ID), eq(practiceServices.status, "active"))).orderBy(asc(practiceServices.name)),
  ]);

  const isReservedDemoPatient = (patientId: unknown) => String(patientId || "").startsWith("pat_demo_");
  const isReservedDemoAppointment = (appointmentId: unknown) => String(appointmentId || "").startsWith("apt_demo_");
  const isReservedDemoEncounter = (encounterId: unknown) => String(encounterId || "").startsWith("enc_apt_demo_");
  const visibleClinicalOrders = clinicalOrderRows.filter((row) => !isReservedDemoEncounter(row.encounterId));
  const visibleClinicalOrderIds = new Set(visibleClinicalOrders.map((row) => row.id));

  return {
    patients: patientRows.filter((row) => !isReservedDemoPatient(row.id)),
    coverages: coverageRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    payers: payerRows,
    plans: planRows,
    providers: providerRows,
    facilities: facilityRows,
    referringProviders: referringRows,
    appointments: appointmentRows.filter((row) => !isReservedDemoAppointment(row.id) && !isReservedDemoPatient(row.patientId)),
    eligibility: eligibilityRows,
    encounters: encounterRows.filter((row) => !isReservedDemoEncounter(row.id) && !isReservedDemoAppointment(row.appointmentId) && !isReservedDemoPatient(row.patientId)),
    procedureCodes: procedureRows,
    feeSchedules: feeRows,
    feeScheduleItems: feeItemRows,
    claims: claimRows.map((row) => ({ ...row, lifecycleStatus: deriveClaimLifecycle(row) })),
    claimLines: claimLineRows,
    claimCorrections: claimCorrectionRows,
    claimWorkflowEvents: claimWorkflowEventRows,
    claimBatches: claimBatchRows,
    claimBatchMembers: claimBatchMemberRows,
    claimTransmissionLogs: claimTransmissionLogRows,
    paymentEntries: paymentEntryRows,
    claimPayments: claimPaymentRows,
    claimPaymentServiceLines: claimPaymentServiceLineRows,
    paymentLogs: paymentLogRows,
    remittances: remittanceRows,
    payments: paymentRows,
    reconciliationLogs: reconciliationLogRows,
    transactions: transactionRows,
    reconsiderations: reconsiderationRows,
    integrations: await Promise.all(integrationRows.map(async (row) => ({
      ...row,
      credentials: await loadCredentialStatus(db, row.id, row.integrationType),
      missingCredentials: await missingRequiredCredentials(db, row.id, row.integrationType),
    }))),
    inboundEvents: inboundEventRows,
    syncEvents: syncEventRows,
    responsibilityProfiles: responsibilityProfileRows,
    responsibilitySources: responsibilitySourceRows,
    responsibilityHistory: responsibilityHistoryRows,
    claimResponsibilitySnapshots: responsibilitySnapshotRows,
    claimConfigurationValues: claimConfigurationRows,
    eligibilityUpdateHistory: eligibilityUpdateRows,
    legalResponsibilities: legalResponsibilityRows,
    patientDocuments: patientDocumentRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    practiceSettings: practiceSettingRows[0] || { schedulerSlotMinutes: "15" },
    visitFlowEvents: visitFlowEventRows.filter((row) => !isReservedDemoAppointment(row.appointmentId)),
    encounterEvents: encounterEventRows.filter((row) => !isReservedDemoEncounter(row.encounterId)),
    clinicalOrders: visibleClinicalOrders,
    diagnosisCodes: diagnosisCodeRows,
    clinicalOrderCatalog: clinicalOrderCatalogRows,
    clinicalOrderResults: clinicalOrderResultRows.filter((row) => visibleClinicalOrderIds.has(row.orderId)),
    patientMedications: patientMedicationRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientAllergies: patientAllergyRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientProblems: patientProblemRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientHistoryItems: patientHistoryRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientImmunizations: patientImmunizationRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientFlowsheetEntries: patientFlowsheetRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientCareChecklistItems: patientChecklistRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    patientRecalls: patientRecallRows.filter((row) => !isReservedDemoPatient(row.patientId)),
    refillRequests: refillRequestRows,
    clinicalContentItems: clinicalContentRows,
    clinicalOptions: clinicalOptionRows,
    subjectiveLibraryItems: subjectiveLibraryRows,
    practiceServices: practiceServiceRows,
  };
}

async function queueClaimFromEncounter(
  db: ReturnType<typeof getDb>,
  input: {
    encounterId: string;
    currentUser: { id: string; fullName: string };
    today: string;
  },
) {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, input.encounterId)).limit(1);
  if (!encounter) return null;
  const [existing] = await db.select().from(claims).where(eq(claims.encounterId, encounter.id)).limit(1);
  if (existing) return { id: existing.id, claimNumber: existing.claimNumber, created: false };

  const candidateProfiles = await db
    .select()
    .from(billingResponsibilityProfiles)
    .where(and(
      eq(billingResponsibilityProfiles.patientId, encounter.patientId),
      eq(billingResponsibilityProfiles.billingContext, encounter.billingContext),
      eq(billingResponsibilityProfiles.status, "active"),
    ))
    .orderBy(desc(billingResponsibilityProfiles.effectiveFrom));
  const responsibilityProfile = candidateProfiles.find((profile) =>
    profile.effectiveFrom <= encounter.dateOfService
    && (!profile.effectiveTo || profile.effectiveTo >= encounter.dateOfService));
  const profileSources = responsibilityProfile
    ? await db.select().from(responsibilitySources).where(eq(responsibilitySources.profileId, responsibilityProfile.id)).orderBy(asc(responsibilitySources.sequence))
    : [];
  const profileClaimSource = profileSources.find((source) => source.coverageId);
  const [fallbackCoverage] = await db
    .select()
    .from(patientCoverages)
    .where(and(eq(patientCoverages.patientId, encounter.patientId), eq(patientCoverages.status, "active")))
    .orderBy(sql`case ${patientCoverages.priority} when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3 when 'guarantor' then 4 when 'final_balance' then 5 else 6 end`)
    .limit(1);
  const coverageId = responsibilityProfile ? profileClaimSource?.coverageId || null : fallbackCoverage?.id || null;
  const [coverage] = coverageId
    ? await db.select().from(patientCoverages).where(eq(patientCoverages.id, coverageId)).limit(1)
    : [];
  let procedures: string[] = [];
  try { procedures = JSON.parse(encounter.procedureCodes) as string[]; } catch { procedures = []; }
  procedures = procedures.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean);
  const procedureRows = procedures.length
    ? await db.select().from(procedureCodes).where(sql`${procedureCodes.code} in (${sql.join(procedures.map((code) => sql`${code}`), sql`, `)})`)
    : [];
  const total = procedures.reduce((sum, code) => {
    const procedure = procedureRows.find((item) => item.code === code);
    return sum + Number(procedure?.defaultCharge || 0);
  }, 0);
  const id = crypto.randomUUID();
  const claimNumber = `CLM${Date.now().toString().slice(-7)}`;
  const isPip = coverage?.coverageType === "auto_pip";
  const isWorkersComp = coverage?.coverageType === "workers_comp";
  const [[provider], [patient]] = await Promise.all([
    db.select().from(providers).where(eq(providers.id, encounter.providerId)).limit(1),
    db.select().from(patients).where(eq(patients.id, encounter.patientId)).limit(1),
  ]);
  const [planPayer] = coverage
    ? await db.select({ payerId: insurancePlans.payerId }).from(insurancePlans).where(eq(insurancePlans.id, coverage.planId)).limit(1)
    : [];

  await db.insert(claims).values({
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    claimNumber,
    patientId: encounter.patientId,
    encounterId: encounter.id,
    coverageId: coverage?.id || null,
    payerId: planPayer?.payerId || null,
    providerId: encounter.providerId,
    facilityId: encounter.facilityId,
    referringProviderId: encounter.referringProviderId,
    insuranceTypeCode: "other",
    otherPlanIndicator: "N",
    employmentRelated: isWorkersComp ? "Y" : "N",
    autoAccidentRelated: isPip ? "Y" : "N",
    autoAccidentState: isPip ? coverage?.accidentState || null : null,
    otherAccidentRelated: "N",
    claimConditionCodes: "[]",
    dateOfService: encounter.dateOfService,
    transactionDate: input.today,
    postingDate: input.today,
    status: "draft",
    lifecycleStatus: "bill_to_pri",
    workflowStatus: "needs_scrub",
    scrubberStatus: "not_run",
    scrubberMessages: "[]",
    scrubResult: null,
    scrubRulesChecked: "[]",
    scrubErrorCount: "0",
    lastScrubbedAt: null,
    scrubbedByUserId: null,
    scrubbedByName: null,
    generationId: null,
    generatedAt: null,
    generatedByUserId: null,
    generatedByName: null,
    claimFormat: null,
    generationResult: null,
    generatedTransactionRef: null,
    totalCharge: total.toFixed(2),
    otherClaimIdQualifier: coverage?.propertyCasualtyClaimNumber ? "Y4" : null,
    otherClaimId: coverage?.propertyCasualtyClaimNumber || null,
    conditionDateQualifier: isPip && coverage?.accidentDate ? "431" : null,
    conditionDate: isPip && coverage?.accidentDate ? coverage.accidentDate : null,
    otherDateQualifier: coverage?.accidentDate ? "439" : null,
    otherDate: coverage?.accidentDate || null,
    outsideLabIndicator: "N",
    priorAuthorizationNumber: coverage?.authorizationNumber || null,
    patientSignatureOnFile: "Y",
    insuredSignatureOnFile: "Y",
    providerSignatureOnFile: "Y",
    providerSignatureDate: input.today,
    icdIndicator: "0",
    diagnosisCodes: encounter.diagnosisCodes,
    claimDataSnapshot: JSON.stringify({
      patientFirstName: patient?.firstName || "",
      patientMiddleName: patient?.middleName || "",
      patientLastName: patient?.lastName || "",
      patientDateOfBirth: patient?.dateOfBirth || "",
      patientSex: patient?.sex || "",
      patientAddressLine1: patient?.addressLine1 || "",
      patientCity: patient?.city || "",
      patientState: patient?.state || "",
      patientPostalCode: patient?.postalCode || "",
      memberId: coverage?.memberId || "",
      groupNumber: coverage?.groupNumber || "",
      relationship: coverage?.relationship || "self",
      subscriberFirstName: coverage?.subscriberFirstName || "",
      subscriberLastName: coverage?.subscriberLastName || "",
      subscriberDateOfBirth: coverage?.subscriberDateOfBirth || "",
      subscriberSex: coverage?.subscriberSex || "",
      subscriberAddressLine1: coverage?.subscriberAddressLine1 || "",
      subscriberCity: coverage?.subscriberCity || "",
      subscriberState: coverage?.subscriberState || "",
      subscriberPostalCode: coverage?.subscriberPostalCode || "",
      acceptAssignment: coverage?.acceptAssignment === "no" ? "N" : "Y",
    }),
  });
  await db.insert(claimResponsibilitySnapshots).values({
    id: crypto.randomUUID(),
    claimId: id,
    profileId: responsibilityProfile?.id || null,
    billingContext: encounter.billingContext,
    profileSnapshot: JSON.stringify(responsibilityProfile ? {
      ...responsibilityProfile,
      sources: profileSources,
    } : {
      profileName: "Fallback active coverage",
      billingContext: encounter.billingContext,
      effectiveFrom: encounter.dateOfService,
      sources: coverage ? [{
        sequence: "1",
        role: "primary",
        sourceType: "insurance",
        coverageId: coverage.id,
        sourceName: "Active patient coverage",
      }] : [{
        sequence: "1",
        role: "primary",
        sourceType: "patient",
        coverageId: null,
        sourceName: "Patient / self pay",
      }],
    }),
  });
  for (const [index, code] of procedures.entries()) {
    const procedure = procedureRows.find((item) => item.code === code);
    await db.insert(claimLines).values({
      id: crypto.randomUUID(),
      claimId: id,
      lineNumber: String(index + 1),
      procedureCode: code,
      diagnosisPointers: "A",
      units: "1",
      chargeAmount: procedure?.defaultCharge || "0.00",
      placeOfService: procedure?.defaultPlaceOfService || "11",
      renderingNpi: provider?.npi || null,
      serviceDateFrom: encounter.dateOfService,
      serviceDateTo: encounter.dateOfService,
    });
  }
  await recordClaimWorkflowEvent(db, {
    claimId: id,
    previousStatus: null,
    newStatus: "needs_scrub",
    action: "Claim Created",
    reason: "New → Bill to Pri. Queued from ready-to-bill encounter into Claim preparation",
    actorUserId: input.currentUser.id,
    actorName: input.currentUser.fullName,
  });
  return { id, claimNumber, created: true };
}

async function scrubClaimRecord(
  db: ReturnType<typeof getDb>,
  id: string,
  currentUser: { id: string; fullName: string },
) {
  const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
  if (!claim) return { error: "Claim not found." };
  const previousWorkflow = deriveWorkflowStatus(claim);
  const scrubStartedAt = new Date().toISOString();
  await db.update(claims).set({
    workflowStatus: "scrubbing",
    updatedAt: scrubStartedAt,
  }).where(eq(claims.id, id));
  await recordClaimWorkflowEvent(db, {
    claimId: id,
    previousStatus: previousWorkflow,
    newStatus: "scrubbing",
    action: "Scrub Started",
    actorUserId: currentUser.id,
    actorName: currentUser.fullName,
  });
  const [patient, provider, facility, coverage, encounter] = await Promise.all([
    db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
    db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
    db.select().from(facilities).where(eq(facilities.id, claim.facilityId)).limit(1),
    claim.coverageId ? db.select().from(patientCoverages).where(eq(patientCoverages.id, claim.coverageId)).limit(1) : Promise.resolve([]),
    claim.encounterId ? db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1) : Promise.resolve([]),
  ]);
  const lines = await db.select().from(claimLines).where(eq(claimLines.claimId, id));
  let snapshot: Record<string, string> = {};
  try { snapshot = JSON.parse(claim.claimDataSnapshot || "{}") as Record<string, string>; } catch { snapshot = {}; }
  const rawIssues: { severity: "error" | "warning"; field: string; box: string; message: string; suggestion: string; diagnosis?: string }[] = [];
  if (!(snapshot.patientDateOfBirth || patient[0]?.dateOfBirth)) rawIssues.push({ severity: "error", field: "Patient DOB", box: "3", message: "Patient birth date is missing.", suggestion: "Complete the patient demographics." });
  if (!(snapshot.memberId || coverage[0]?.memberId)) rawIssues.push({ severity: "error", field: "Member ID", box: "1a", message: "Active insurance member ID is missing.", suggestion: "Add primary coverage." });
  if (!provider[0]?.npi) rawIssues.push({ severity: "error", field: "Rendering NPI", box: "24J", message: "Rendering provider NPI is missing.", suggestion: "Complete provider NPI." });
  if (!facility[0]?.npi) rawIssues.push({ severity: "warning", field: "Facility NPI", box: "32a", message: "Service facility NPI is not configured.", suggestion: "Confirm whether Box 32a is required for this payer." });
  if (!claim.dateOfService) rawIssues.push({ severity: "error", field: "Date of Service", box: "24A", message: "Date of service is missing.", suggestion: "Enter the service date." });
  const [plan] = coverage[0]
    ? await db.select().from(insurancePlans).where(eq(insurancePlans.id, coverage[0].planId)).limit(1)
    : [];
  const [claimPayer] = claim.payerId
    ? await db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1)
    : [];
  if (claim.payerId && !claimPayer) {
    rawIssues.push({ severity: "error", field: "Payer routing", box: "11c", message: "The claim references a payer that is no longer configured.", suggestion: "Select an active payer and verify its payer ID before billing." });
  } else if (claimPayer && claimPayer.status !== "active") {
    rawIssues.push({ severity: "error", field: "Payer routing", box: "11c", message: "The selected payer is inactive.", suggestion: "Activate the payer or select the current payer configuration." });
  } else if (claimPayer && !String(claimPayer.clearinghouseRoute || "").trim()) {
    rawIssues.push({ severity: "warning", field: "Payer routing", box: "11c", message: `${claimPayer.name} has no clearinghouse route and will be prepared as paper (CMS-1500).`, suggestion: "Configure the payer's clearinghouse route if electronic submission is required." });
  }
  if (plan?.requiresAuthorization === "yes" && !(claim.priorAuthorizationNumber || coverage[0]?.authorizationNumber)) {
    rawIssues.push({ severity: "error", field: "Authorization Number", box: "23", message: "Missing authorization number.", suggestion: "Enter the payer authorization before billing." });
  }
  const claimPairs: [unknown, unknown, string, string][] = [
    [claim.otherClaimIdQualifier, claim.otherClaimId, "11b", "other claim ID"],
    [claim.conditionDateQualifier, claim.conditionDate, "14", "condition date"],
    [claim.otherDateQualifier, claim.otherDate, "15", "other date"],
    [claim.referringOtherIdQualifier, claim.referringOtherId, "17a", "referring provider other ID"],
    [claim.additionalClaimInfoQualifier, claim.additionalClaimInfo, "19", "additional claim information"],
    [claim.serviceFacilityOtherIdQualifier, claim.serviceFacilityOtherId, "32b", "service facility other ID"],
    [claim.billingProviderOtherIdQualifier, claim.billingProviderOtherId, "33b", "billing provider other ID"],
  ];
  for (const [qualifier, enteredValue, box, field] of claimPairs) {
    if (Boolean(qualifier) !== Boolean(enteredValue)) rawIssues.push({ severity: "error", field, box, message: `Box ${box} has an incomplete qualifier/value pair.`, suggestion: "Enter both the qualifier and its accompanying value, or clear both." });
  }
  rawIssues.push(...box22ScrubIssues(claim.billFrequencyCode, claim.originalReferenceNumber));
  if (claim.referringOtherIdQualifier === "LU" && claim.referringProviderQualifier !== "DQ") {
    rawIssues.push({ severity: "error", field: "Referring provider other ID", box: "17a", message: "LU is only valid for a supervising provider in Box 17a.", suggestion: "Select DQ supervising provider or use the correct other-ID qualifier." });
  }
  if (claim.autoAccidentRelated === "Y" && !/^[A-Z]{2}$/.test(claim.autoAccidentState || "")) {
    rawIssues.push({ severity: "error", field: "Auto accident state", box: "10b", message: "An auto-accident claim requires a two-letter state code.", suggestion: "Enter the state where the accident occurred." });
  }
  if (coverage[0]?.coverageType === "auto_pip") {
    if (!coverage[0].propertyCasualtyClaimNumber) rawIssues.push({ severity: "error", field: "PIP claim number", box: "11b", message: "PIP requires a property-casualty claim number.", suggestion: "Complete the PIP coverage record; PRACX maps it with qualifier Y4." });
    if (!coverage[0].accidentDate) rawIssues.push({ severity: "error", field: "Accident date", box: "15", message: "PIP requires an accident date.", suggestion: "Complete the PIP accident details; PRACX maps qualifier 439." });
  }
  for (const [from, to, box, label] of [
    [claim.unableToWorkFrom, claim.unableToWorkTo, "16", "unable-to-work dates"],
    [claim.hospitalizationFrom, claim.hospitalizationTo, "18", "hospitalization dates"],
  ] as [string | null, string | null, string, string][]) {
    if (Boolean(from) !== Boolean(to)) rawIssues.push({ severity: "error", field: label, box, message: `Box ${box} requires both from and through dates.`, suggestion: "Complete both dates or clear the date range." });
    if (from && to && from > to) rawIssues.push({ severity: "error", field: label, box, message: `Box ${box} through date precedes its from date.`, suggestion: "Correct the date range." });
  }
  if ((claim.outsideLabIndicator === "Y") !== Boolean(claim.outsideLabCharges)) {
    rawIssues.push({ severity: "error", field: "Outside laboratory", box: "20", message: "Outside-lab selection and purchased-service charge do not agree.", suggestion: "Enter Yes with the charge, or No without a charge." });
  }
  if (Boolean(claim.federalTaxIdType) !== Boolean(claim.federalTaxIdNumber) || (claim.federalTaxIdNumber && !/^\d{9}$/.test(claim.federalTaxIdNumber))) {
    rawIssues.push({ severity: "error", field: "Federal tax ID", box: "25", message: "Federal tax ID type and a 9-digit identifier are required together.", suggestion: "Select EIN or SSN and enter nine digits." });
  }
  if (claim.providerSignatureOnFile !== "Y") {
    rawIssues.push({ severity: "error", field: "Provider signature", box: "31", message: "Provider signature authorization is not recorded.", suggestion: "Record the accountable provider signature and date." });
  }
  let diagnoses: string[] = [];
  try { diagnoses = JSON.parse(claim.diagnosisCodes || encounter[0]?.diagnosisCodes || "[]") as string[]; } catch { diagnoses = []; }
  if (!diagnoses.length) rawIssues.push({ severity: "error", field: "Diagnosis", box: "21", message: "No diagnosis code is linked.", suggestion: "Add at least one ICD-10-CM diagnosis." });
  if (diagnoses.length > 12) rawIssues.push({ severity: "error", field: "Diagnosis", box: "21", message: "A CMS-1500 claim can report no more than 12 diagnoses.", suggestion: "Split services related to additional diagnoses into another claim." });
  if (encounter[0]) {
    if (!["signed", "ready_to_bill", "billed"].includes(String(encounter[0].status))) {
      rawIssues.push({ severity: "error", field: "Encounter signature", box: "Clinical", message: "The clinical encounter is not signed or ready for billing.", suggestion: "Complete and sign the encounter before submitting the claim." });
    }
    if (!String(encounter[0].assessment || "").trim()) {
      rawIssues.push({ severity: "error", field: "Clinical assessment", box: "Clinical", message: "The encounter is missing an assessment.", suggestion: "Document the clinician's assessment before billing." });
    }
    if (!String(encounter[0].treatmentPlan || "").trim()) {
      rawIssues.push({ severity: "error", field: "Treatment plan", box: "Clinical", message: "The encounter is missing a treatment plan.", suggestion: "Document the plan, orders, counseling, or follow-up before billing." });
    }
    if (!String(encounter[0].historyOfPresentIllness || encounter[0].clinicalNote || "").trim()) {
      rawIssues.push({ severity: "warning", field: "Clinical documentation", box: "Clinical", message: "No HPI or clinical note is attached to the encounter.", suggestion: "Add the relevant history supporting today's services." });
    }
  }
  if (diagnoses.length) {
    const diagnosisMasterRows = await db.select({ code: diagnosisCodeMaster.code }).from(diagnosisCodeMaster).where(eq(diagnosisCodeMaster.status, "active"));
    const knownDiagnosisCodes = new Set(diagnosisMasterRows.map((row) => row.code.toUpperCase()));
    for (const diagnosis of diagnoses) {
      if (!knownDiagnosisCodes.has(String(diagnosis).trim().toUpperCase())) {
        rawIssues.push({ severity: "error", field: "Diagnosis code", box: "21", message: `Diagnosis code ${diagnosis} is not in the active ICD-10-CM directory.`, suggestion: "Choose an active diagnosis code from the directory or add it to coding configuration." });
      }
    }
  }
  if (!lines.length) rawIssues.push({ severity: "error", field: "Service lines", box: "24", message: "Claim has no service lines.", suggestion: "Add a procedure line." });
  if (lines.length > 50) rawIssues.push({ severity: "error", field: "Service lines", box: "24", message: "Current NUCC instructions require claims with more than 50 service lines to be split.", suggestion: "Split the claim into compliant groups." });
  if (lines.some((line) => Number(line.chargeAmount) <= 0)) rawIssues.push({ severity: "error", field: "Charges", box: "24F", message: "A service line has a zero charge.", suggestion: "Enter a valid charge amount." });
  const procedureMasterRows = await db.select({ code: procedureCodes.code }).from(procedureCodes).where(eq(procedureCodes.status, "active"));
  const knownProcedureCodes = new Set(procedureMasterRows.map((row) => row.code.toUpperCase()));
  for (const line of lines) {
    if (!knownProcedureCodes.has(String(line.procedureCode || "").trim().toUpperCase())) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} procedure code`, box: "24D", message: `Procedure code ${line.procedureCode || "(blank)"} is not in the active CPT/HCPCS directory.`, suggestion: "Select an active procedure code from the directory or configure the code before billing." });
    if (!/^\d{2}$/.test(line.placeOfService)) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} place of service`, box: "24B", message: "Place of service must contain two digits.", suggestion: "Select a valid CMS place-of-service code." });
    if (line.modifiers && (line.modifiers.split(",").length > 4 || line.modifiers.split(",").some((modifier) => !/^[A-Z0-9]{2}$/.test(modifier)))) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} modifiers`, box: "24D", message: "A line supports no more than four two-character modifiers.", suggestion: "Correct the modifier list." });
    if (!/^[A-L]{1,4}$/.test(line.diagnosisPointers)) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} diagnosis pointers`, box: "24E", message: "Diagnosis pointers must contain one to four letters from A through L.", suggestion: "Link the service line to valid Box 21 diagnoses." });
    else if (line.diagnosisPointers.split("").some((pointer) => pointer.charCodeAt(0) - 65 >= diagnoses.length)) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} diagnosis pointers`, box: "24E", message: "A service line points to a diagnosis that is not present in Box 21.", suggestion: "Add the referenced diagnosis or correct the line pointer." });
    if (Number(line.units) <= 0) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} units`, box: "24G", message: "Days or units must be greater than zero.", suggestion: "Enter the number of services, days, minutes or units." });
    if (line.epsdtIndicator && line.epsdtReasonCode) rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} EPSDT`, box: "24H", message: "EPSDT Y/N and an EPSDT reason code cannot be reported together.", suggestion: "Use the payer-required indicator or reason code, not both." });
    if (Boolean(line.renderingOtherIdQualifier) !== Boolean(line.renderingOtherId)) {
      rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} rendering other ID`, box: "24I/24J", message: "Rendering other-ID qualifier and identifier are incomplete.", suggestion: "Enter both values or clear both." });
    }
    if (line.epsdtReasonCode && !["AV", "S2", "ST", "NU"].includes(line.epsdtReasonCode)) {
      rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} EPSDT`, box: "24H", message: "Unsupported EPSDT reason code.", suggestion: "Use AV, S2, ST or NU." });
    }
    if (Boolean(line.supplementalQualifier) !== Boolean(line.supplementalInformation)) {
      rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} supplemental information`, box: "24 shaded", message: "Supplemental qualifier and information are incomplete.", suggestion: "Enter both values or clear both." });
    }
    if (line.supplementalQualifier === "JO" && !["00", "01", "02", "10", "20", "30", "40"].includes(line.supplementalInformation || "")) {
      rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} oral-cavity area`, box: "24 shaded", message: "JO contains an unsupported oral-cavity area.", suggestion: "Use 00, 01, 02, 10, 20, 30 or 40." });
    }
    if (line.ndcCode && (line.ndcCode.length !== 11 || !["F2", "GR", "ME", "ML", "UN"].includes(line.ndcUnitQualifier || "") || Number(line.ndcQuantity) <= 0)) {
      rawIssues.push({ severity: "error", field: `Line ${line.lineNumber} NDC`, box: "24 shaded", message: "NDC data is incomplete or incorrectly formatted.", suggestion: "Enter an 11-digit NDC, valid unit qualifier and positive quantity." });
    }
  }
  const identifiedAt = new Date().toISOString();
  const issues: ScrubIssue[] = rawIssues.map((issue) => enrichScrubIssue(issue, identifiedAt));
  const hasError = issues.some((issue) => issue.blocking);
  const nextWorkflow: ClaimWorkflowStatus = hasError ? "error" : "ready_to_bill";
  const errorCount = issues.filter((issue) => issue.blocking).length;
  await db.update(claims).set({
    scrubberStatus: scrubberStatusForWorkflow(nextWorkflow),
    scrubberMessages: JSON.stringify(issues),
    status: legacyStatusForWorkflow(nextWorkflow),
    workflowStatus: nextWorkflow,
    lastScrubbedAt: identifiedAt,
    scrubResult: hasError ? "error" : "pass",
    scrubRulesChecked: JSON.stringify([...SCRUB_RULES_CHECKED]),
    scrubErrorCount: String(errorCount),
    scrubbedByUserId: currentUser.id,
    scrubbedByName: currentUser.fullName,
    updatedAt: identifiedAt,
  }).where(eq(claims.id, id));
  await recordClaimWorkflowEvent(db, {
    claimId: id,
    previousStatus: "scrubbing",
    newStatus: nextWorkflow,
    action: hasError ? "Scrub Completed" : "Scrub Completed",
    reason: hasError ? `${errorCount} blocking error${errorCount === 1 ? "" : "s"}` : "PASS — all blocking rules cleared",
    errorInformation: hasError ? JSON.stringify(issues.filter((issue) => issue.blocking)) : null,
    actorUserId: currentUser.id,
    actorName: currentUser.fullName,
  });
  if (nextWorkflow === "ready_to_bill") {
    await recordClaimWorkflowEvent(db, {
      claimId: id,
      previousStatus: "scrubbing",
      newStatus: "ready_to_bill",
      action: "READY_TO_BILL",
      reason: "Claim passed required scrub rules",
      actorUserId: currentUser.id,
      actorName: currentUser.fullName,
    });
  } else {
    await recordClaimWorkflowEvent(db, {
      claimId: id,
      previousStatus: "scrubbing",
      newStatus: "error",
      action: "ERROR",
      reason: "Blocking scrub errors require correction",
      errorInformation: JSON.stringify(issues.filter((issue) => issue.blocking)),
      actorUserId: currentUser.id,
      actorName: currentUser.fullName,
    });
  }
  return {
    id,
    status: hasError ? "errors" : "clean",
    workflowStatus: nextWorkflow,
    scrubResult: hasError ? "error" : "pass",
    scrubErrorCount: errorCount,
    lastScrubbedAt: identifiedAt,
    issues,
  };

}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    return Response.json(await loadWorkspace());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load operations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const action = clean(payload.action);
    const db = getDb();

    if (action === "saveClinicalOption") {
      const optionGroup = clean(payload.optionGroup);
      const label = clean(payload.label);
      const editableGroups = new Set(["ros_symptom", "psychiatric_history", "investigation_history", "treatment_history"]);
      if (!editableGroups.has(optionGroup) || !label) return Response.json({ error: "A valid clinical option group and label are required." }, { status: 400 });
      const code = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}_${crypto.randomUUID().slice(0, 6)}`;
      const item = { id: crypto.randomUUID(), organizationId: DEFAULT_ORGANIZATION_ID, optionGroup, code, label, value: label, parentCode: clean(payload.parentCode) || "other", keywords: clean(payload.keywords), specialty: "All specialties", source: "User-added", version: "2026.1", metadataJson: JSON.stringify({ createdBy: currentUser.fullName }), sortOrder: "900", status: "active" as const };
      await db.insert(clinicalOptionMaster).values(item);
      return Response.json({ item }, { status: 201 });
    }

    if (action === "saveSubjectiveLibraryItem") {
      const itemType = clean(payload.itemType);
      const title = clean(payload.title);
      const content = clean(payload.content);
      if (!["complaint", "hpi", "template"].includes(itemType) || !title || !content) {
        return Response.json({ error: "A valid type, title and reusable content are required." }, { status: 400 });
      }
      const [duplicate] = await db.select().from(subjectiveLibraryItems).where(and(
        eq(subjectiveLibraryItems.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(subjectiveLibraryItems.itemType, itemType as "complaint" | "hpi" | "template"),
        sql`lower(${subjectiveLibraryItems.title}) = ${title.toLowerCase()}`,
        eq(subjectiveLibraryItems.status, "active"),
      )).limit(1);
      if (duplicate) return Response.json({ item: duplicate, existing: true });
      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(), organizationId: DEFAULT_ORGANIZATION_ID,
        itemType: itemType as "complaint" | "hpi" | "template", title, content,
        keywords: clean(payload.keywords), specialty: clean(payload.specialty) || "All specialties",
        associatedComplaints: JSON.stringify(Array.isArray(payload.associatedComplaints) ? payload.associatedComplaints : []),
        scope: "personal" as const, approvalStatus: "draft" as const,
        createdByUserId: currentUser.id, createdByName: currentUser.fullName,
        status: "active" as const, createdAt: now, updatedAt: now,
      };
      await db.insert(subjectiveLibraryItems).values(item);
      return Response.json({ item }, { status: 201 });
    }
    const today = dateOnly();

    if (action === "ingestInboundBundle" || action === "ingestFhirBundle") {
      let raw = payload.bundle ?? payload.payload ?? null;
      const conversionIssues: InboundIssue[] = [];

      if (action === "ingestFhirBundle") {
        const converted = fhirBundleToInboundBundle(raw, {
          sourceSystem: clean(payload.sourceSystem),
          sourceLabel: clean(payload.sourceLabel),
        });
        conversionIssues.push(...converted.issues);
        if (!converted.bundle) {
          return Response.json({ error: "Payload must be a FHIR R4 Bundle.", issues: converted.issues }, { status: 400 });
        }
        raw = converted.bundle;
      }

      const shape = validateInboundBundleShape(raw);
      if (!shape.bundle) return Response.json({ error: "Inbound bundle payload is required." }, { status: 400 });
      const bundle = shape.bundle;

      const integrationId = await resolveIntegrationId(db, clean(bundle.sourceSystem));
      const receivedAt = clean(payload.receivedAt) || new Date().toISOString();
      const id = crypto.randomUUID();

      const mapping = await resolveProviderAndFacility(db, bundle);
      const allIssues = [...conversionIssues, ...shape.issues, ...mapping.issues];
      const hasErrors = allIssues.some((issue) => issue.severity === "error");

      const patientNameExternal = bundle.patient ? `${clean(bundle.patient.firstName)} ${clean(bundle.patient.lastName)}`.trim() : null;
      const patientDobExternal = clean(bundle.patient?.dateOfBirth) || null;
      const externalId = clean(bundle.externalIds?.appointment || bundle.externalIds?.encounter || bundle.externalIds?.patient || "") || null;
      const firstError = allIssues.find((issue) => issue.severity === "error");

      // EHRs retry webhooks and polling windows. Treat an identical source/event
      // reference as the same intake event so retries cannot create duplicate
      // patients, encounters, or downstream claims.
      if (externalId) {
        const [existing] = await db
          .select({ id: integrationInboundEvents.id, status: integrationInboundEvents.status })
          .from(integrationInboundEvents)
          .where(and(
            eq(integrationInboundEvents.organizationId, DEFAULT_ORGANIZATION_ID),
            eq(integrationInboundEvents.sourceSystem, clean(bundle.sourceSystem) || "unknown"),
            eq(integrationInboundEvents.eventType, clean(bundle.eventType) || "day_appointment"),
            eq(integrationInboundEvents.externalId, externalId),
          ))
          .orderBy(desc(integrationInboundEvents.receivedAt))
          .limit(1);
        if (existing) {
          return Response.json({ id: existing.id, status: existing.status, duplicate: true, externalId }, { status: 200 });
        }
      }

      await db.insert(integrationInboundEvents).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        integrationId,
        sourceSystem: clean(bundle.sourceSystem) || "unknown",
        sourceLabel: clean(bundle.sourceLabel) || clean(bundle.sourceSystem) || "Inbound",
        eventType: clean(bundle.eventType) || "day_appointment",
        externalId,
        patientNameExternal,
        patientDobExternal,
        matchedPatientId: null,
        status: integrationId ? (hasErrors ? "held" : "pending") : "missing_integration",
        reasonCode: integrationId ? (firstError?.code || null) : "missing_integration",
        reasonDetail: integrationId ? (firstError?.message || null) : "No configured integration exists for this source system.",
        payloadSummary: clean(payload.payloadSummary) || `${clean(bundle.eventType)} received`,
        payloadJson: JSON.stringify(bundle),
        validationJson: JSON.stringify({ issues: allIssues }),
        receivedAt,
        resolvedAt: null,
        resolvedByName: null,
        createdAt: new Date().toISOString(),
      });

      return Response.json({ id, status: integrationId ? (hasErrors ? "held" : "pending") : "missing_integration", issues: allIssues }, { status: 201 });
    }

    if (action === "confirmEligibilityUpdate") {
      const eligibilityCheckId = clean(payload.eligibilityCheckId);
      const addressChoice = clean(payload.addressChoice);
      const reason = clean(payload.reason);
      if (!eligibilityCheckId || !["keep_current", "use_eligibility"].includes(addressChoice) || !reason) {
        return Response.json({ error: "Eligibility result, address choice and change reason are required." }, { status: 400 });
      }
      const [check] = await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.id, eligibilityCheckId)).limit(1);
      if (!check?.responseDetails) {
        return Response.json({ error: "This eligibility result does not contain reviewable response details." }, { status: 400 });
      }
      const [[patient], [coverage]] = await Promise.all([
        db.select().from(patients).where(eq(patients.id, check.patientId)).limit(1),
        db.select().from(patientCoverages).where(eq(patientCoverages.id, check.coverageId)).limit(1),
      ]);
      if (!patient || !coverage || patient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "The eligibility record is no longer linked to an active patient record." }, { status: 404 });
      }
      const responseDetails = JSON.parse(check.responseDetails) as Record<string, unknown>;
      const returnedAddress = (responseDetails.returnedAddress || {}) as Record<string, unknown>;
      const beforeSnapshot = { patient, coverage };
      const coverageUpdates = {
        memberId: clean(responseDetails.memberId) || coverage.memberId,
        groupNumber: clean(responseDetails.groupNumber) || coverage.groupNumber,
        relationship: clean(responseDetails.relationship) || coverage.relationship,
        effectiveDate: clean(responseDetails.effectiveDate) || coverage.effectiveDate,
        terminationDate: clean(responseDetails.terminationDate) || coverage.terminationDate,
      };
      await db.update(patientCoverages).set(coverageUpdates).where(eq(patientCoverages.id, coverage.id));
      let patientUpdates: Record<string, string> = {};
      if (addressChoice === "use_eligibility") {
        const addressLine1 = clean(returnedAddress.addressLine1);
        const city = clean(returnedAddress.city);
        const state = clean(returnedAddress.state).toUpperCase();
        const postalCode = clean(returnedAddress.postalCode);
        if (!addressLine1 || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
          return Response.json({ error: "The eligibility response does not contain a complete, valid address." }, { status: 400 });
        }
        patientUpdates = { addressLine1, addressLine2: clean(returnedAddress.addressLine2), city, state, postalCode };
        await db.update(patients).set({ ...patientUpdates, updatedAt: new Date().toISOString() }).where(eq(patients.id, patient.id));
      }
      const appliedSnapshot = { coverage: coverageUpdates, patientAddress: addressChoice === "use_eligibility" ? patientUpdates : "kept_current" };
      await db.insert(eligibilityUpdateHistory).values({
        id: crypto.randomUUID(),
        eligibilityCheckId,
        patientId: patient.id,
        coverageId: coverage.id,
        addressChoice,
        beforeSnapshot: JSON.stringify(beforeSnapshot),
        responseSnapshot: check.responseDetails,
        appliedSnapshot: JSON.stringify(appliedSnapshot),
        reason,
        changedBy: currentUser.fullName,
      });
      return Response.json({ id: eligibilityCheckId, applied: appliedSnapshot });
    }

    if (action === "createLegalResponsibility") {
      const patientId = clean(payload.patientId);
      const responsibilityType = clean(payload.coverageType);
      if (!patientId || !LEGAL_RESPONSIBILITY_TYPES.has(responsibilityType)) {
        return Response.json({ error: "Select a patient and a valid legal or patient responsibility type." }, { status: 400 });
      }
      const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
      if (!patient || patient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "Patient not found." }, { status: 404 });
      }
      if (responsibilityType === "lop" && (!clean(payload.organizationName) || !clean(payload.attorneyName) || !clean(payload.lopNumber) || !clean(payload.signedDate))) {
        return Response.json({ error: "LOP requires the law firm, attorney, LOP number and signed date." }, { status: 400 });
      }
      if (responsibilityType === "attorney" && (!clean(payload.organizationName) || !clean(payload.attorneyName) || !clean(payload.caseNumber))) {
        return Response.json({ error: "Attorney responsibility requires the law firm, attorney and case number." }, { status: 400 });
      }
      const values = legalResponsibilityValues(payload, patientId);
      await db.insert(patientLegalResponsibilities).values(values);
      return Response.json({ id: values.id }, { status: 201 });
    }

    if (action === "createPatientCoverage") {
      const patientId = clean(payload.patientId);
      const planId = clean(payload.planId);
      const memberId = clean(payload.memberId);
      if (!patientId || !planId || !memberId) {
        return Response.json({ error: "Patient, insurance plan and member ID are required." }, { status: 400 });
      }
      const [[patient], [plan], duplicateRows] = await Promise.all([
        db.select().from(patients).where(eq(patients.id, patientId)).limit(1),
        db.select().from(insurancePlans).where(eq(insurancePlans.id, planId)).limit(1),
        db.select().from(patientCoverages).where(and(
          eq(patientCoverages.patientId, patientId),
          eq(patientCoverages.planId, planId),
          eq(patientCoverages.memberId, memberId),
        )).limit(1),
      ]);
      if (!patient || patient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "Patient not found." }, { status: 404 });
      }
      if (!plan) return Response.json({ error: "Insurance plan not found." }, { status: 404 });
      if (duplicateRows.length) {
        return Response.json({ error: "This plan and member ID are already recorded for the patient." }, { status: 409 });
      }
      const effectiveDate = clean(payload.effectiveDate) || null;
      const terminationDate = clean(payload.terminationDate) || null;
      if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
        return Response.json({ error: "Coverage termination cannot be earlier than the effective date." }, { status: 400 });
      }
      const coverageError = validateCoverageClaimValues(payload);
      if (coverageError) return Response.json({ error: coverageError }, { status: 400 });
      const priority = coveragePriority(payload.priority);
      const subscriberSameAsPatient = payload.subscriberSameAsPatient !== false;
      const manualSubscriberFields = ["subscriberFirstName", "subscriberLastName", "subscriberDateOfBirth", "subscriberSex", "subscriberAddressLine1", "subscriberCity", "subscriberState", "subscriberPostalCode"];
      if (!subscriberSameAsPatient && manualSubscriberFields.some((field) => !clean(payload[field]))) {
        return Response.json({ error: "Enter the different subscriber’s name, birth date and address." }, { status: 400 });
      }
      if (priority !== "unassigned") {
        await db.update(patientCoverages).set({ priority: "unassigned" }).where(and(
          eq(patientCoverages.patientId, patientId),
          eq(patientCoverages.priority, priority),
          eq(patientCoverages.status, "active"),
        ));
      }
      const id = crypto.randomUUID();
      await db.insert(patientCoverages).values({
        id,
        patientId,
        planId,
        priority,
        memberId,
        groupNumber: clean(payload.groupNumber) || plan.defaultGroupNumber || null,
        relationship: subscriberSameAsPatient ? "self" : clean(payload.relationship) || "other",
        subscriberFirstName: subscriberSameAsPatient ? patient.firstName : clean(payload.subscriberFirstName),
        subscriberLastName: subscriberSameAsPatient ? patient.lastName : clean(payload.subscriberLastName),
        subscriberDateOfBirth: subscriberSameAsPatient ? patient.dateOfBirth : clean(payload.subscriberDateOfBirth),
        subscriberSex: subscriberSameAsPatient ? patient.sex : clean(payload.subscriberSex),
        subscriberAddressLine1: subscriberSameAsPatient ? patient.addressLine1 : clean(payload.subscriberAddressLine1),
        subscriberCity: subscriberSameAsPatient ? patient.city : clean(payload.subscriberCity),
        subscriberState: subscriberSameAsPatient ? patient.state : clean(payload.subscriberState),
        subscriberPostalCode: subscriberSameAsPatient ? patient.postalCode : clean(payload.subscriberPostalCode),
        effectiveDate,
        terminationDate,
        ...coverageClaimValues(payload),
        acceptAssignment: "yes",
        releaseOfInformation: "yes",
        assignmentOfBenefits: "yes",
        status: "active",
      });
      if (payload.verifyEligibility === true) {
        const eligibility = await performEligibilityCheck(db, patientId, today, id);
        return Response.json({
          id,
          eligibility: "error" in eligibility ? null : eligibility,
          eligibilityError: "error" in eligibility ? eligibility.error : null,
        }, { status: 201 });
      }
      return Response.json({ id }, { status: 201 });
    }

    if (action === "updateCoverageOrder") {
      const patientId = clean(payload.patientId);
      if (!patientId) return Response.json({ error: "Patient is required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
      if (!patient || patient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "Patient not found." }, { status: 404 });
      }
      const selections = [
        { id: clean(payload.primaryCoverageId), priority: "primary" },
        { id: clean(payload.secondaryCoverageId), priority: "secondary" },
        { id: clean(payload.tertiaryCoverageId), priority: "tertiary" },
      ].filter((item) => item.id);
      if (new Set(selections.map((item) => item.id)).size !== selections.length) {
        return Response.json({ error: "The same insurance policy cannot be primary, secondary and tertiary at the same time." }, { status: 400 });
      }
      const activeCoverages = await db.select().from(patientCoverages).where(and(
        eq(patientCoverages.patientId, patientId),
        eq(patientCoverages.status, "active"),
      ));
      if (selections.some((selection) => !activeCoverages.some((coverage) => coverage.id === selection.id))) {
        return Response.json({ error: "Every selected insurance policy must be active and belong to this patient." }, { status: 400 });
      }
      await db.update(patientCoverages).set({ priority: "unassigned" }).where(and(
        eq(patientCoverages.patientId, patientId),
        eq(patientCoverages.status, "active"),
      ));
      for (const selection of selections) {
        await db.update(patientCoverages).set({ priority: selection.priority }).where(eq(patientCoverages.id, selection.id));
      }
      return Response.json({ patientId, order: selections });
    }

    if (action === "createResponsibilityProfile") {
      const patientId = clean(payload.patientId);
      const profileName = clean(payload.profileName);
      const billingContext = clean(payload.billingContext) || "routine";
      const effectiveFrom = clean(payload.effectiveFrom);
      const effectiveTo = clean(payload.effectiveTo) || null;
      const primarySource = clean(payload.primarySource);
      if (!patientId || !profileName || !effectiveFrom || !primarySource) {
        return Response.json({ error: "Patient, profile name, start date and primary responsibility are required." }, { status: 400 });
      }
      if (effectiveTo && effectiveTo < effectiveFrom) {
        return Response.json({ error: "The end date cannot be earlier than the start date." }, { status: 400 });
      }
      const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
      if (!patient || patient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "Patient not found." }, { status: 404 });
      }
      const existingProfiles = await db
        .select()
        .from(billingResponsibilityProfiles)
        .where(and(
          eq(billingResponsibilityProfiles.patientId, patientId),
          eq(billingResponsibilityProfiles.billingContext, billingContext),
          eq(billingResponsibilityProfiles.status, "active"),
        ));
      const conflict = existingProfiles.find((profile) =>
        profile.effectiveFrom <= (effectiveTo || "9999-12-31")
        && (profile.effectiveTo || "9999-12-31") >= effectiveFrom);
      if (conflict) {
        return Response.json({
          error: `This DOS range overlaps "${conflict.profileName}" (${conflict.effectiveFrom} to ${conflict.effectiveTo || "open"}). Close or adjust that profile first.`,
          conflictId: conflict.id,
        }, { status: 409 });
      }

      const sourceInputs = [
        { value: primarySource, role: "primary", sequence: "1", activation: "Bill first for the selected DOS and context." },
        { value: clean(payload.secondarySource), role: "secondary", sequence: "2", activation: "Activate after primary adjudication or confirmed COB reordering." },
        { value: clean(payload.tertiarySource), role: "tertiary", sequence: "3", activation: "Activate after prior responsible sources adjudicate." },
        { value: clean(payload.finalBalanceSource), role: "final_balance", sequence: "4", activation: "Receive the eligible remaining balance after payer adjudication." },
      ].filter((source) => source.value);
      if (new Set(sourceInputs.map((source) => source.value)).size !== sourceInputs.length) {
        return Response.json({ error: "The same payment source cannot occupy more than one responsibility position." }, { status: 400 });
      }

      const patientCoverageRows = await db
        .select({
          id: patientCoverages.id,
          patientId: patientCoverages.patientId,
          planName: insurancePlans.name,
          payerName: payers.name,
          payerType: payers.payerType,
        })
        .from(patientCoverages)
        .innerJoin(insurancePlans, eq(insurancePlans.id, patientCoverages.planId))
        .innerJoin(payers, eq(payers.id, insurancePlans.payerId))
        .where(eq(patientCoverages.patientId, patientId));
      const legalRows = await db.select().from(patientLegalResponsibilities).where(and(
        eq(patientLegalResponsibilities.patientId, patientId),
        eq(patientLegalResponsibilities.status, "active"),
      ));
      const specialSources: Record<string, { name: string; type: string }> = {
        "special:patient": { name: `${patient.firstName} ${patient.lastName}`, type: "patient" },
        "special:lop": { name: clean(payload.legalSourceName) || "LOP / legal receivable", type: "lop" },
        "special:attorney": { name: clean(payload.legalSourceName) || "Attorney / law firm", type: "attorney" },
        "special:pip": { name: clean(payload.legalSourceName) || "PIP / no-fault carrier", type: "pip" },
        "special:workers_comp": { name: clean(payload.legalSourceName) || "Workers’ compensation", type: "workers_comp" },
        "special:other": { name: clean(payload.legalSourceName) || "Other responsible source", type: "other" },
      };
      const resolvedSources = sourceInputs.map((source) => {
        if (source.value.startsWith("coverage:")) {
          const coverage = patientCoverageRows.find((item) => item.id === source.value.slice("coverage:".length));
          if (!coverage) throw new Error("A selected insurance coverage does not belong to this patient.");
          return {
            ...source,
            coverageId: coverage.id,
            sourceName: `${coverage.payerName} · ${coverage.planName}`,
            sourceType: coverage.payerType.toLowerCase().includes("pip") ? "pip" : "insurance",
          };
        }
        if (source.value.startsWith("legal:")) {
          const record = legalRows.find((item) => item.id === source.value.slice("legal:".length));
          if (!record) throw new Error("A selected legal responsibility does not belong to this patient.");
          return {
            ...source,
            coverageId: null,
            sourceName: record.organizationName || record.attorneyName || record.responsibilityType.replaceAll("_", " "),
            sourceType: record.responsibilityType,
          };
        }
        const special = specialSources[source.value];
        if (!special) throw new Error("Select a valid payment source.");
        return { ...source, coverageId: null, sourceName: special.name, sourceType: special.type };
      });

      const id = crypto.randomUUID();
      const profileSnapshot = {
        profileName,
        billingContext,
        effectiveFrom,
        effectiveTo,
        verificationStatus: clean(payload.verificationStatus) || "unverified",
        guarantorType: clean(payload.guarantorType) || "patient",
        guarantorName: clean(payload.guarantorName) || `${patient.firstName} ${patient.lastName}`,
        patientBillingHold: payload.patientBillingHold === true ? "yes" : "no",
        sources: resolvedSources.map((source) => ({
          sequence: source.sequence,
          role: source.role,
          sourceType: source.sourceType,
          coverageId: source.coverageId,
          sourceName: source.sourceName,
          activationCondition: source.activation,
        })),
      };
      await db.insert(billingResponsibilityProfiles).values({
        id,
        patientId,
        profileName,
        billingContext,
        effectiveFrom,
        effectiveTo,
        verificationStatus: profileSnapshot.verificationStatus,
        guarantorType: profileSnapshot.guarantorType,
        guarantorName: profileSnapshot.guarantorName,
        patientBillingHold: profileSnapshot.patientBillingHold as "yes" | "no",
        reason: clean(payload.reason) || null,
        status: "active",
      });
      for (const source of resolvedSources) {
        await db.insert(responsibilitySources).values({
          id: crypto.randomUUID(),
          profileId: id,
          sequence: source.sequence,
          role: source.role,
          sourceType: source.sourceType,
          coverageId: source.coverageId,
          sourceName: source.sourceName,
          activationCondition: source.activation,
          status: source.sequence === "1" ? "ready" : "pending",
        });
      }
      await db.insert(responsibilityProfileHistory).values({
        id: crypto.randomUUID(),
        profileId: id,
        action: "created",
        snapshot: JSON.stringify(profileSnapshot),
        reason: clean(payload.reason) || "Initial DOS responsibility assignment",
        changedBy: currentUser.fullName,
      });
      return Response.json({ id, profile: profileSnapshot }, { status: 201 });
    }

    if (action === "closeResponsibilityProfile") {
      const id = clean(payload.id);
      const effectiveTo = clean(payload.effectiveTo) || today;
      const reason = clean(payload.reason);
      const [profile] = await db.select().from(billingResponsibilityProfiles).where(eq(billingResponsibilityProfiles.id, id)).limit(1);
      if (!profile) return Response.json({ error: "Responsibility profile not found." }, { status: 404 });
      if (effectiveTo < profile.effectiveFrom) {
        return Response.json({ error: "The closing date cannot be earlier than the profile start date." }, { status: 400 });
      }
      const sources = await db.select().from(responsibilitySources).where(eq(responsibilitySources.profileId, id));
      const snapshot = { ...profile, effectiveTo, status: "closed", sources };
      await db.update(billingResponsibilityProfiles).set({
        effectiveTo,
        status: "closed",
        updatedAt: new Date().toISOString(),
      }).where(eq(billingResponsibilityProfiles.id, id));
      await db.insert(responsibilityProfileHistory).values({
        id: crypto.randomUUID(),
        profileId: id,
        action: "closed",
        snapshot: JSON.stringify(snapshot),
        reason: reason || "Responsibility period closed",
        changedBy: currentUser.fullName,
      });
      return Response.json({ id, effectiveTo, status: "closed" });
    }

    if (action === "lookupZip" || action === "verifyAddress") {
      const { zip5, zipPlus4 } = zipParts(payload);
      const [adapter] = await db
        .select()
        .from(integrations)
        .where(and(
          eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
          eq(integrations.integrationType, "usps_address"),
        ))
        .limit(1);
      if (adapter?.mode === "live") {
        return Response.json({
          error: adapter.status === "active"
            ? "The live USPS transport must be certified before production address requests can be sent."
            : "The live USPS address adapter still requires credentials and activation.",
        }, { status: 400 });
      }
      if (!/^\d{5}$/.test(zip5)) {
        return Response.json({ error: "Enter a valid 5-digit ZIP code." }, { status: 400 });
      }
      const zipMatch = LOCAL_ZIP_DIRECTORY[zip5];
      if (action === "lookupZip") {
        return Response.json({
          status: zipMatch ? "matched" : "not_found",
          mode: adapter?.mode || "test",
          zipCode: zip5,
          city: zipMatch?.city || "",
          state: zipMatch?.state || "",
          message: zipMatch
            ? "City and state matched from the local ZIP test directory."
            : "ZIP format is valid. Exact USPS lookup requires an activated USPS address adapter.",
        });
      }

      const addressLine1 = clean(payload.addressLine1);
      if (!addressLine1) {
        return Response.json({ error: "Street address is required before verification." }, { status: 400 });
      }
      const standardized = {
        addressLine1: standardizeAddressLine(addressLine1),
        addressLine2: standardizeAddressLine(payload.addressLine2),
        city: (zipMatch?.city || clean(payload.city)).toUpperCase(),
        state: (zipMatch?.state || clean(payload.state)).toUpperCase(),
        postalCode: zip5,
        zipPlus4,
      };
      if (!standardized.city || !/^[A-Z]{2}$/.test(standardized.state)) {
        return Response.json({ error: "A valid city and 2-letter state are required." }, { status: 400 });
      }
      const original = {
        addressLine1,
        addressLine2: clean(payload.addressLine2),
        city: clean(payload.city),
        state: clean(payload.state),
        postalCode: zip5,
        zipPlus4,
      };
      const corrected = Object.keys(standardized).some((key) =>
        String(standardized[key as keyof typeof standardized]).toUpperCase()
          !== String(original[key as keyof typeof original]).toUpperCase());
      return Response.json({
        status: corrected ? "corrected" : "verified",
        mode: adapter?.mode || "test",
        standardized,
        message: zipPlus4
          ? "Address normalized in local test mode. Confirm it before saving."
          : "Address normalized in local test mode. A live USPS response is required to supply an exact ZIP+4.",
      });
    }

    if (action === "createPatient") {
      const firstName = clean(payload.firstName);
      const lastName = clean(payload.lastName);
      const dateOfBirth = clean(payload.dateOfBirth);
      const addressLine1 = clean(payload.addressLine1);
      const city = clean(payload.city);
      const state = clean(payload.state).toUpperCase();
      const { zip5, zipPlus4 } = zipParts(payload);
      const postalCode = zipPlus4 ? `${zip5}-${zipPlus4}` : zip5;
      const requiredPatientFields = { firstName, lastName, dateOfBirth, addressLine1, city, state, postalCode };
      const missingPatientFields = Object.entries(requiredPatientFields).filter(([, fieldValue]) => !fieldValue).map(([field]) => field);
      if (missingPatientFields.length) {
        return Response.json({ error: `Required patient fields are missing: ${missingPatientFields.join(", ")}.` }, { status: 400 });
      }
      if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
        return Response.json({ error: "ZIP must contain 5 digits, with an optional 4-digit extension." }, { status: 400 });
      }
      const planId = clean(payload.planId);
      const memberId = clean(payload.memberId);
      const selectedCoverageType = clean(payload.coverageType) || "health";
      const effectiveDate = clean(payload.effectiveDate) || null;
      const terminationDate = clean(payload.terminationDate) || null;
      if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
        return Response.json({ error: "Coverage termination cannot be earlier than the effective date." }, { status: 400 });
      }
      if (INSURANCE_COVERAGE_TYPES.has(selectedCoverageType) && Boolean(planId) !== Boolean(memberId)) {
        return Response.json({ error: "Insurance plan and member ID must be entered together." }, { status: 400 });
      }
      if (planId && memberId) {
        const coverageError = validateCoverageClaimValues(payload);
        if (coverageError) return Response.json({ error: coverageError }, { status: 400 });
      }
      if (selectedCoverageType === "lop" && (!clean(payload.organizationName) || !clean(payload.attorneyName) || !clean(payload.lopNumber) || !clean(payload.signedDate))) {
        return Response.json({ error: "LOP requires the law firm, attorney, LOP number and signed date." }, { status: 400 });
      }
      const subscriberSameAsPatient = payload.subscriberSameAsPatient !== false;
      const manualSubscriberFields = ["subscriberFirstName", "subscriberLastName", "subscriberDateOfBirth", "subscriberSex", "subscriberAddressLine1", "subscriberCity", "subscriberState", "subscriberPostalCode"];
      if (planId && memberId && !subscriberSameAsPatient && manualSubscriberFields.some((field) => !clean(payload[field]))) {
        return Response.json({ error: "Enter the different subscriber’s name, birth date and address." }, { status: 400 });
      }
      const duplicatePatient = await db.select({
        id: patients.id,
        accountNumber: patients.accountNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
      }).from(patients).where(and(
        eq(patients.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(patients.dateOfBirth, dateOfBirth),
        sql`lower(${patients.firstName}) = lower(${firstName})`,
        sql`lower(${patients.lastName}) = lower(${lastName})`,
      )).limit(1);
      if (duplicatePatient.length) {
        const match = duplicatePatient[0];
        return Response.json({
          error: `Possible duplicate patient: ${match.firstName} ${match.lastName} (${match.accountNumber}). Select the existing chart instead of creating another.`,
          duplicatePatientId: match.id,
        }, { status: 409 });
      }
      const patientId = crypto.randomUUID();
      const accountNumber = `PX${Date.now().toString().slice(-6)}`;
      await db.insert(patients).values({
        id: patientId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        accountNumber,
        firstName,
        middleName: clean(payload.middleName) || null,
        lastName,
        suffix: clean(payload.suffix) || null,
        dateOfBirth,
        sex: payload.sex === "male" || payload.sex === "female" ? payload.sex : "unknown",
        addressLine1,
        addressLine2: clean(payload.addressLine2) || null,
        city,
        state,
        postalCode,
        phone: clean(payload.phone) || null,
        email: clean(payload.email) || null,
        maritalStatus: clean(payload.maritalStatus) || null,
        status: "active",
      });
      let coverageId = "";
      if (planId && memberId) {
        coverageId = crypto.randomUUID();
        await db.insert(patientCoverages).values({
          id: coverageId,
          patientId,
          planId,
          priority: coveragePriority(payload.priority),
          memberId,
          groupNumber: clean(payload.groupNumber) || null,
          relationship: subscriberSameAsPatient ? "self" : clean(payload.relationship) || "other",
          subscriberFirstName: subscriberSameAsPatient ? firstName : clean(payload.subscriberFirstName),
          subscriberLastName: subscriberSameAsPatient ? lastName : clean(payload.subscriberLastName),
          subscriberDateOfBirth: subscriberSameAsPatient ? dateOfBirth : clean(payload.subscriberDateOfBirth),
          subscriberSex: subscriberSameAsPatient ? clean(payload.sex) || "unknown" : clean(payload.subscriberSex),
          subscriberAddressLine1: subscriberSameAsPatient ? addressLine1 : clean(payload.subscriberAddressLine1),
          subscriberCity: subscriberSameAsPatient ? city : clean(payload.subscriberCity),
          subscriberState: subscriberSameAsPatient ? state : clean(payload.subscriberState),
          subscriberPostalCode: subscriberSameAsPatient ? postalCode : clean(payload.subscriberPostalCode),
          effectiveDate,
          terminationDate,
          ...coverageClaimValues(payload),
          acceptAssignment: payload.acceptAssignment === false ? "no" : "yes",
          releaseOfInformation: payload.releaseOfInformation === false ? "no" : "yes",
          assignmentOfBenefits: payload.assignmentOfBenefits === false ? "no" : "yes",
          status: "active",
        });
      }
      if (LEGAL_RESPONSIBILITY_TYPES.has(selectedCoverageType)) {
        await db.insert(patientLegalResponsibilities).values(legalResponsibilityValues(payload, patientId));
      }
      if (payload.verifyEligibility === true) {
        if (LEGAL_RESPONSIBILITY_TYPES.has(selectedCoverageType)) {
          return Response.json({ id: patientId, accountNumber }, { status: 201 });
        }
        if (!coverageId) {
          return Response.json({
            id: patientId,
            accountNumber,
            eligibilityError: "Insurance plan and member ID are required for eligibility verification.",
          }, { status: 201 });
        }
        const eligibility = await performEligibilityCheck(db, patientId, today);
        return Response.json({
          id: patientId,
          accountNumber,
          eligibility: "error" in eligibility ? null : eligibility,
          eligibilityError: "error" in eligibility ? eligibility.error : null,
        }, { status: 201 });
      }
      return Response.json({ id: patientId, accountNumber }, { status: 201 });
    }

    if (action === "updatePatient") {
      const id = clean(payload.id);
      const firstName = clean(payload.firstName);
      const lastName = clean(payload.lastName);
      const dateOfBirth = clean(payload.dateOfBirth);
      const addressLine1 = clean(payload.addressLine1);
      const city = clean(payload.city);
      const state = clean(payload.state).toUpperCase();
      const { zip5, zipPlus4 } = zipParts(payload);
      const postalCode = zipPlus4 ? `${zip5}-${zipPlus4}` : zip5;
      if (!id) return Response.json({ error: "Patient ID is required." }, { status: 400 });
      const requiredPatientFields = { firstName, lastName, dateOfBirth, addressLine1, city, state, postalCode };
      const missingPatientFields = Object.entries(requiredPatientFields).filter(([, fieldValue]) => !fieldValue).map(([field]) => field);
      if (missingPatientFields.length) {
        return Response.json({ error: `Required patient fields are missing: ${missingPatientFields.join(", ")}.` }, { status: 400 });
      }
      if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
        return Response.json({ error: "ZIP must contain 5 digits, with an optional 4-digit extension." }, { status: 400 });
      }
      const planId = clean(payload.planId);
      const memberId = clean(payload.memberId);
      const coverageId = clean(payload.coverageId);
      const effectiveDate = clean(payload.effectiveDate) || null;
      const terminationDate = clean(payload.terminationDate) || null;
      if (Boolean(planId) !== Boolean(memberId)) {
        return Response.json({ error: "Insurance plan and member ID must be entered together." }, { status: 400 });
      }
      if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
        return Response.json({ error: "Coverage termination cannot be earlier than the effective date." }, { status: 400 });
      }
      if (planId && memberId) {
        const coverageError = validateCoverageClaimValues(payload);
        if (coverageError) return Response.json({ error: coverageError }, { status: 400 });
      }
      const subscriberSameAsPatient = payload.subscriberSameAsPatient !== false;
      const manualSubscriberFields = ["subscriberFirstName", "subscriberLastName", "subscriberDateOfBirth", "subscriberSex", "subscriberAddressLine1", "subscriberCity", "subscriberState", "subscriberPostalCode"];
      if (planId && memberId && !subscriberSameAsPatient && manualSubscriberFields.some((field) => !clean(payload[field]))) {
        return Response.json({ error: "Enter the different subscriber’s name, birth date and address." }, { status: 400 });
      }
      const [existingPatient] = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
      if (!existingPatient || existingPatient.organizationId !== DEFAULT_ORGANIZATION_ID) {
        return Response.json({ error: "Patient not found." }, { status: 404 });
      }

      await db.update(patients).set({
        firstName,
        middleName: clean(payload.middleName) || null,
        lastName,
        suffix: clean(payload.suffix) || null,
        dateOfBirth,
        sex: payload.sex === "male" || payload.sex === "female" ? payload.sex : "unknown",
        addressLine1,
        addressLine2: clean(payload.addressLine2) || null,
        city,
        state,
        postalCode,
        phone: clean(payload.phone) || null,
        email: clean(payload.email) || null,
        maritalStatus: clean(payload.maritalStatus) || null,
        updatedAt: new Date().toISOString(),
      }).where(eq(patients.id, id));

      const [existingCoverage] = await db
        .select()
        .from(patientCoverages)
        .where(and(
          eq(patientCoverages.patientId, id),
          eq(patientCoverages.status, "active"),
          coverageId ? eq(patientCoverages.id, coverageId) : undefined,
        ))
        .limit(1);
      if (planId && memberId) {
        const priority = coveragePriority(payload.priority);
        const coverageValues = {
          planId,
          priority,
          memberId,
          groupNumber: clean(payload.groupNumber) || null,
          relationship: subscriberSameAsPatient ? "self" : clean(payload.relationship) || "other",
          subscriberFirstName: subscriberSameAsPatient ? firstName : clean(payload.subscriberFirstName),
          subscriberLastName: subscriberSameAsPatient ? lastName : clean(payload.subscriberLastName),
          subscriberDateOfBirth: subscriberSameAsPatient ? dateOfBirth : clean(payload.subscriberDateOfBirth),
          subscriberSex: subscriberSameAsPatient ? clean(payload.sex) || "unknown" : clean(payload.subscriberSex),
          subscriberAddressLine1: subscriberSameAsPatient ? addressLine1 : clean(payload.subscriberAddressLine1),
          subscriberCity: subscriberSameAsPatient ? city : clean(payload.subscriberCity),
          subscriberState: subscriberSameAsPatient ? state : clean(payload.subscriberState),
          subscriberPostalCode: subscriberSameAsPatient ? postalCode : clean(payload.subscriberPostalCode),
          effectiveDate,
          terminationDate,
          ...coverageClaimValues(payload),
          acceptAssignment: payload.acceptAssignment === false ? "no" as const : "yes" as const,
          releaseOfInformation: payload.releaseOfInformation === false ? "no" as const : "yes" as const,
          assignmentOfBenefits: payload.assignmentOfBenefits === false ? "no" as const : "yes" as const,
          status: "active" as const,
        };
        if (priority !== "unassigned") {
          const samePriorityCoverages = await db.select({ id: patientCoverages.id }).from(patientCoverages).where(and(
            eq(patientCoverages.patientId, id),
            eq(patientCoverages.priority, priority),
            eq(patientCoverages.status, "active"),
          ));
          for (const coverage of samePriorityCoverages) {
            if (coverage.id !== existingCoverage?.id) {
              await db.update(patientCoverages).set({ priority: "unassigned" }).where(eq(patientCoverages.id, coverage.id));
            }
          }
        }
        if (existingCoverage) {
          await db.update(patientCoverages).set(coverageValues).where(eq(patientCoverages.id, existingCoverage.id));
        } else {
          await db.insert(patientCoverages).values({
            id: crypto.randomUUID(),
            patientId: id,
            ...coverageValues,
          });
        }
      } else if (existingCoverage) {
        await db.update(patientCoverages).set({ status: "inactive" }).where(eq(patientCoverages.id, existingCoverage.id));
      }

      if (payload.verifyEligibility === true) {
        const eligibility = await performEligibilityCheck(db, id, today);
        return Response.json({
          id,
          eligibility: "error" in eligibility ? null : eligibility,
          eligibilityError: "error" in eligibility ? eligibility.error : null,
        });
      }
      return Response.json({ id });
    }

    if (action === "createAppointment") {
      const patientId = clean(payload.patientId);
      const providerId = clean(payload.providerId);
      const facilityId = clean(payload.facilityId);
      const startAt = clean(payload.startAt);
      if (!patientId || !providerId || !facilityId || !startAt) {
        return Response.json({ error: "Patient, provider, facility and start time are required." }, { status: 400 });
      }
      const start = new Date(startAt);
      const end = new Date(start.getTime() + Number(payload.duration || 30) * 60_000);
      if (Number.isNaN(start.getTime()) || end <= start) {
        return Response.json({ error: "Enter a valid appointment start time and duration." }, { status: 400 });
      }
      const conflict = await db.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.providerId, providerId),
        sql`${appointments.status} != 'cancelled'`,
        sql`${appointments.startAt} < ${end.toISOString()}`,
        sql`${appointments.endAt} > ${start.toISOString()}`,
      )).limit(1);
      if (conflict.length) {
        return Response.json({ error: "This provider already has an appointment during the selected time." }, { status: 409 });
      }
      const id = crypto.randomUUID();
      await db.insert(appointments).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        patientId,
        providerId,
        facilityId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        appointmentType: clean(payload.appointmentType) || "Office visit",
        billingContext: clean(payload.billingContext) || "routine",
        reason: clean(payload.reason) || null,
        status: "scheduled",
        eligibilityStatus: "pending",
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createFollowUpAppointments") {
      const patientId = clean(payload.patientId);
      const providerId = clean(payload.providerId);
      const facilityId = clean(payload.facilityId);
      const startAt = clean(payload.startAt);
      const mode = clean(payload.mode) === "recurring" ? "recurring" : "once";
      const interval = ["week", "2weeks", "month"].includes(clean(payload.interval)) ? clean(payload.interval) : "month";
      const occurrences = mode === "once" ? 1 : Math.min(12, Math.max(1, Number(payload.occurrences || 1)));
      const durationMinutes = Math.max(5, Number(payload.duration || 30));
      if (!patientId || !providerId || !facilityId || !startAt) {
        return Response.json({ error: "Patient, provider, facility and start time are required." }, { status: 400 });
      }
      const first = new Date(startAt);
      if (Number.isNaN(first.getTime())) {
        return Response.json({ error: "Enter a valid follow-up start time." }, { status: 400 });
      }
      const appointmentType = clean(payload.appointmentType) || "Follow-up";
      const billingContext = clean(payload.billingContext) || "routine";
      const reason = clean(payload.reason) || "Clinical follow-up";
      const booked: Array<{ id: string; startAt: string; endAt: string }> = [];
      const skipped: Array<{ startAt: string; reason: string }> = [];

      for (let index = 0; index < occurrences; index += 1) {
        const start = new Date(first.getTime());
        if (interval === "week") start.setDate(start.getDate() + 7 * index);
        else if (interval === "2weeks") start.setDate(start.getDate() + 14 * index);
        else if (index > 0) start.setMonth(start.getMonth() + index);
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const conflict = await db.select({ id: appointments.id }).from(appointments).where(and(
          eq(appointments.providerId, providerId),
          sql`${appointments.status} != 'cancelled'`,
          sql`${appointments.startAt} < ${endIso}`,
          sql`${appointments.endAt} > ${startIso}`,
        )).limit(1);
        if (conflict.length) {
          skipped.push({ startAt: startIso, reason: "Provider already has an appointment at this time." });
          continue;
        }
        const id = crypto.randomUUID();
        await db.insert(appointments).values({
          id,
          organizationId: DEFAULT_ORGANIZATION_ID,
          patientId,
          providerId,
          facilityId,
          startAt: startIso,
          endAt: endIso,
          appointmentType,
          billingContext,
          reason,
          status: "scheduled",
          eligibilityStatus: "pending",
        });
        booked.push({ id, startAt: startIso, endAt: endIso });
      }

      if (!booked.length) {
        return Response.json({
          error: skipped[0]?.reason || "No follow-up appointments could be booked.",
          booked,
          skipped,
        }, { status: 409 });
      }
      return Response.json({ booked, skipped, count: booked.length }, { status: 201 });
    }

    if (action === "updateAppointmentStatus") {
      const id = clean(payload.id);
      const allowedStatuses = new Set(["scheduled", "confirmed", "arrived", "checked_in", "in_room", "completed", "cancelled", "no_show"]);
      const status = clean(payload.status);
      if (!id || !allowedStatuses.has(status)) {
        return Response.json({ error: "Select a valid appointment status." }, { status: 400 });
      }
      const [appointment] = await db.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.id, id),
        eq(appointments.organizationId, DEFAULT_ORGANIZATION_ID),
      )).limit(1);
      if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 });
      await db.update(appointments).set({ status }).where(eq(appointments.id, id));
      return Response.json({ id, status });
    }

    if (action === "updateVisitFlow") {
      const id = clean(payload.id);
      const nextStatus = clean(payload.flowStatus);
      if (!id || !Object.hasOwn(VISIT_FLOW_TRANSITIONS, nextStatus)) {
        return Response.json({ error: "Select a valid patient-flow status." }, { status: 400 });
      }
      const [appointment] = await db.select().from(appointments).where(and(
        eq(appointments.id, id),
        eq(appointments.organizationId, DEFAULT_ORGANIZATION_ID),
      )).limit(1);
      if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 });
      if (["cancelled", "no_show"].includes(appointment.status)) {
        return Response.json({ error: "Cancelled or no-show appointments cannot enter patient flow." }, { status: 409 });
      }

      const currentStatus = appointment.flowStatus || "not_arrived";
      const suppliedRoom = clean(payload.roomName);
      const roomName = suppliedRoom || appointment.roomName || "";
      const roomStatuses = ["roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"];
      const isRoomChange = nextStatus === currentStatus && suppliedRoom && suppliedRoom !== appointment.roomName && roomStatuses.includes(currentStatus);
      if (nextStatus !== currentStatus && !VISIT_FLOW_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
        return Response.json({ error: `Move the patient from ${currentStatus.replaceAll("_", " ")} using the next available step.` }, { status: 409 });
      }
      if (nextStatus === currentStatus && !isRoomChange) {
        return Response.json({ id, flowStatus: currentStatus, roomName: appointment.roomName, flowStatusAt: appointment.flowStatusAt });
      }
      if (roomStatuses.includes(nextStatus) && !roomName) {
        return Response.json({ error: "Assign a room before rooming the patient." }, { status: 400 });
      }

      const occurredAt = new Date().toISOString();
      const updateValues: Partial<typeof appointments.$inferInsert> = {
        flowStatus: nextStatus as typeof appointments.$inferInsert.flowStatus,
        flowStatusAt: occurredAt,
        roomName: roomName || null,
      };
      if (nextStatus === "arrived") updateValues.arrivedAt = occurredAt;
      if (nextStatus === "checked_in") updateValues.checkedInAt = occurredAt;
      if (nextStatus === "waiting") updateValues.waitingAt = occurredAt;
      if (nextStatus === "roomed") updateValues.roomedAt = occurredAt;
      if (nextStatus === "ready_for_provider") updateValues.readyForProviderAt = occurredAt;
      if (nextStatus === "consultation_started") updateValues.consultationStartedAt = occurredAt;
      if (nextStatus === "consultation_ended") updateValues.consultationEndedAt = occurredAt;
      if (nextStatus === "checked_out") updateValues.checkedOutAt = occurredAt;

      const legacyStatus = nextStatus === "arrived"
        ? "arrived"
        : ["checked_in", "waiting"].includes(nextStatus)
          ? "checked_in"
          : ["roomed", "ready_for_provider", "consultation_started", "consultation_ended"].includes(nextStatus)
            ? "in_room"
            : nextStatus === "checked_out" ? "completed" : appointment.status;
      updateValues.status = legacyStatus as typeof appointments.$inferInsert.status;

      await db.update(appointments).set(updateValues).where(eq(appointments.id, id));
      await db.insert(visitFlowEvents).values({
        id: crypto.randomUUID(),
        appointmentId: id,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        roomName: roomName || null,
        note: clean(payload.note).slice(0, 500) || (isRoomChange ? `Room changed to ${roomName}` : null),
        changedByUserId: currentUser.id,
        changedByName: currentUser.fullName,
        occurredAt,
      });
      return Response.json({ id, flowStatus: nextStatus, roomName: roomName || null, flowStatusAt: occurredAt, status: legacyStatus });
    }

    if (action === "rescheduleAppointment") {
      const id = clean(payload.id);
      const providerId = clean(payload.providerId);
      const facilityId = clean(payload.facilityId);
      const startAt = clean(payload.startAt);
      const duration = Number(payload.duration || 30);
      const start = new Date(startAt);
      const end = new Date(start.getTime() + duration * 60_000);
      if (!id || !providerId || !facilityId || Number.isNaN(start.getTime()) || duration < 5 || duration > 480) {
        return Response.json({ error: "Appointment, provider, facility, valid start time and duration are required." }, { status: 400 });
      }
      const [appointment] = await db.select().from(appointments).where(and(
        eq(appointments.id, id),
        eq(appointments.organizationId, DEFAULT_ORGANIZATION_ID),
      )).limit(1);
      if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 });
      const conflict = await db.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.providerId, providerId),
        sql`${appointments.id} != ${id}`,
        sql`${appointments.status} != 'cancelled'`,
        sql`${appointments.startAt} < ${end.toISOString()}`,
        sql`${appointments.endAt} > ${start.toISOString()}`,
      )).limit(1);
      if (conflict.length) {
        return Response.json({ error: "This provider already has an appointment during the selected time." }, { status: 409 });
      }
      await db.update(appointments).set({
        providerId,
        facilityId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        appointmentType: clean(payload.appointmentType) || appointment.appointmentType,
        billingContext: clean(payload.billingContext) || appointment.billingContext,
        reason: clean(payload.reason) || appointment.reason,
        status: "scheduled",
      }).where(eq(appointments.id, id));
      return Response.json({ id, startAt: start.toISOString(), endAt: end.toISOString(), status: "scheduled" });
    }

    if (action === "checkEligibility") {
      const patientId = clean(payload.patientId);
      const coverageId = clean(payload.coverageId);
      const dos = clean(payload.dateOfService) || today;
      if (!patientId) return Response.json({ error: "Select a patient to verify." }, { status: 400 });
      const eligibility = await performEligibilityCheck(db, patientId, dos, coverageId || undefined);
      if ("error" in eligibility) return Response.json({ error: eligibility.error }, { status: 400 });
      return Response.json(eligibility);
    }

    if (action === "recordVisitIntake") {
      const appointmentId = clean(payload.appointmentId);
      const [appointment] = await db.select().from(appointments).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, DEFAULT_ORGANIZATION_ID),
      )).limit(1);
      if (!appointment) return Response.json({ error: "Scheduled visit not found." }, { status: 404 });
      if (["cancelled", "no_show"].includes(appointment.status)) return Response.json({ error: "Vitals cannot be recorded for a cancelled or no-show appointment." }, { status: 409 });
      const roomName = clean(payload.roomName);
      if (!roomName) return Response.json({ error: "Select a room before completing intake." }, { status: 400 });
      const vitalKeys = ["height", "weight", "temperature", "pulse", "respirations", "systolic", "diastolic", "oxygenSaturation", "painScore"];
      const vitals = Object.fromEntries(vitalKeys.map((key) => [key, clean(payload[key])]).filter(([, entry]) => entry));
      if (!Object.keys(vitals).length) return Response.json({ error: "Record at least one vital sign before marking the patient ready." }, { status: 400 });
      const now = new Date().toISOString();
      const [existing] = await db.select().from(encounters).where(eq(encounters.appointmentId, appointmentId)).limit(1);
      const encounterId = existing?.id || crypto.randomUUID();
      if (existing) {
        await db.update(encounters).set({
          chiefComplaint: clean(payload.chiefComplaint) || existing.chiefComplaint,
          vitals: JSON.stringify(vitals),
          allergiesReviewed: payload.allergiesReviewed === true ? "yes" : "no",
          medicationsReviewed: payload.medicationsReviewed === true ? "yes" : "no",
          lastSavedAt: now,
        }).where(eq(encounters.id, existing.id));
      } else {
        await db.insert(encounters).values({
          id: encounterId,
          appointmentId,
          patientId: appointment.patientId,
          providerId: appointment.providerId,
          facilityId: appointment.facilityId,
          dateOfService: appointment.startAt.slice(0, 10),
          billingContext: appointment.billingContext || "routine",
          templateKey: "general_soap",
          chiefComplaint: clean(payload.chiefComplaint) || appointment.reason || appointment.appointmentType,
          vitals: JSON.stringify(vitals),
          allergiesReviewed: payload.allergiesReviewed === true ? "yes" : "no",
          medicationsReviewed: payload.medicationsReviewed === true ? "yes" : "no",
          status: "draft",
          lastSavedAt: now,
        });
      }
      await db.update(appointments).set({
        flowStatus: "ready_for_provider",
        flowStatusAt: now,
        roomName,
        waitingAt: appointment.waitingAt || now,
        roomedAt: appointment.roomedAt || now,
        readyForProviderAt: now,
        status: "in_room",
      }).where(eq(appointments.id, appointmentId));
      await db.insert(visitFlowEvents).values({
        id: crypto.randomUUID(), appointmentId, fromStatus: appointment.flowStatus || "checked_in", toStatus: "ready_for_provider",
        roomName, note: "Vitals and intake completed", changedByUserId: currentUser.id, changedByName: currentUser.fullName, occurredAt: now,
      });
      await db.insert(encounterEvents).values({
        id: crypto.randomUUID(), encounterId, action: existing ? "saved" : "created", statusFrom: existing?.status || null,
        statusTo: existing?.status || "draft", changedByUserId: currentUser.id, changedByName: currentUser.fullName, occurredAt: now,
      });
      return Response.json({ id: encounterId, flowStatus: "ready_for_provider", roomName });
    }

    if (action === "startEncounter") {
      const appointmentId = clean(payload.appointmentId);
      if (!appointmentId) return Response.json({ error: "Select a scheduled visit." }, { status: 400 });
      const [appointment] = await db.select().from(appointments).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, DEFAULT_ORGANIZATION_ID),
      )).limit(1);
      if (!appointment) return Response.json({ error: "Scheduled visit not found." }, { status: 404 });
      const [existing] = await db.select().from(encounters).where(eq(encounters.appointmentId, appointmentId)).limit(1);
      if (existing) return Response.json({ id: existing.id, encounter: existing });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const encounter = {
        id,
        appointmentId,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        facilityId: appointment.facilityId,
        dateOfService: appointment.startAt.slice(0, 10),
        billingContext: appointment.billingContext || "routine",
        templateKey: "general_soap",
        chiefComplaint: appointment.reason || appointment.appointmentType,
        status: "draft" as const,
        lastSavedAt: now,
      };
      await db.insert(encounters).values(encounter);
      await db.insert(encounterEvents).values({
        id: crypto.randomUUID(), encounterId: id, action: "created", statusFrom: null, statusTo: "draft",
        changedByUserId: currentUser.id, changedByName: currentUser.fullName, occurredAt: now,
      });
      return Response.json({ id, encounter }, { status: 201 });
    }

    if (action === "saveEncounter") {
      const id = clean(payload.id);
      const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id)).limit(1);
      if (!encounter) return Response.json({ error: "Encounter not found." }, { status: 404 });
      if (encounter.status === "billed") return Response.json({ error: "A billed encounter cannot be changed." }, { status: 409 });
      const intent = clean(payload.intent) || "draft";
      const fromAssessment = codesFromAssessmentSubjectiveJson(payload.subjectiveItemsJson);
      const diagnosisCodes = Array.from(new Set([
        ...clean(payload.diagnosisCodes).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
        ...fromAssessment,
      ]));
      const procedureList = clean(payload.procedureCodes).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      const chiefComplaint = clean(payload.chiefComplaint);
      const assessment = clean(payload.assessment);
      const treatmentPlan = clean(payload.treatmentPlan);
      if (intent !== "draft" && (!chiefComplaint || !assessment || !treatmentPlan || !diagnosisCodes.length || !procedureList.length)) {
        return Response.json({ error: "Signing requires the chief complaint, assessment, plan, diagnosis and procedure codes." }, { status: 400 });
      }
      const unresolvedTemplateFields = ["historyOfPresentIllness", "reviewOfSystems", "physicalExam", "assessment", "treatmentPlan", "followUpInstructions"]
        .filter((field) => /^\[[\s\S]+\]$/.test(clean(payload[field])));
      if (intent !== "draft" && unresolvedTemplateFields.length) {
        return Response.json({ error: "Complete or replace all bracketed template prompts before signing the note." }, { status: 400 });
      }
      const vitalKeys = ["height", "weight", "temperature", "pulse", "respirations", "systolic", "diastolic", "oxygenSaturation", "painScore"];
      const vitals = Object.fromEntries(vitalKeys.map((key) => [key, clean(payload[key])]).filter(([, value]) => value));
      const now = new Date().toISOString();
      const nextStatus = intent === "ready_to_bill" ? "ready_to_bill" : intent === "sign" ? "signed" : encounter.status === "draft" ? "draft" : encounter.status;
      let submittedOrders: Record<string, unknown>[] = [];
      try {
        const parsedOrders = JSON.parse(clean(payload.ordersJson) || "[]") as unknown;
        if (Array.isArray(parsedOrders)) submittedOrders = parsedOrders.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
      } catch {
        return Response.json({ error: "Clinical orders could not be read. Review the order list and try again." }, { status: 400 });
      }
      await db.update(encounters).set({
        templateKey: clean(payload.templateKey) || encounter.templateKey || "general_soap",
        subjectiveItemsJson: clean(payload.subjectiveItemsJson) || "[]",
        referringProviderId: clean(payload.referringProviderId) || null,
        chiefComplaint: chiefComplaint || null,
        historyOfPresentIllness: clean(payload.historyOfPresentIllness) || null,
        reviewOfSystems: clean(payload.reviewOfSystems) || null,
        physicalExam: clean(payload.physicalExam) || null,
        assessment: assessment || null,
        treatmentPlan: treatmentPlan || null,
        followUpInstructions: clean(payload.followUpInstructions) || null,
        vitals: JSON.stringify(vitals),
        allergiesReviewed: payload.allergiesReviewed === true ? "yes" : "no",
        medicationsReviewed: payload.medicationsReviewed === true ? "yes" : "no",
        clinicalNote: clean(payload.clinicalNote) || null,
        codingAssistJson: clean(payload.codingAssistJson) || "{}",
        diagnosisCodes: JSON.stringify(diagnosisCodes),
        procedureCodes: JSON.stringify(procedureList),
        status: nextStatus,
        signedAt: intent === "draft" ? encounter.signedAt : now,
        signedByUserId: intent === "draft" ? encounter.signedByUserId : currentUser.id,
        signedByName: intent === "draft" ? encounter.signedByName : currentUser.fullName,
        readyToBillAt: intent === "ready_to_bill" ? now : encounter.readyToBillAt,
        lastSavedAt: now,
      }).where(eq(encounters.id, id));
      for (const submittedOrder of submittedOrders) {
        const orderType = clean(submittedOrder.orderType);
        const name = clean(submittedOrder.name);
        if (!name || !["medication", "lab", "imaging", "referral"].includes(orderType)) continue;
        const orderId = clean(submittedOrder.id) || crypto.randomUUID();
        const priority = ["routine", "urgent", "stat"].includes(clean(submittedOrder.priority)) ? clean(submittedOrder.priority) : "routine";
        const status = nextStatus === "draft" ? "draft" : "ordered";
        const values = {
          encounterId: id, patientId: encounter.patientId, providerId: encounter.providerId,
          orderType: orderType as "medication" | "lab" | "imaging" | "referral",
          code: clean(submittedOrder.code) || null, name, instructions: clean(submittedOrder.instructions) || null,
          priority: priority as "routine" | "urgent" | "stat", status: status as "draft" | "ordered",
          orderedByUserId: currentUser.id, orderedByName: currentUser.fullName, orderedAt: now, updatedAt: now,
        };
        const [existingOrder] = await db.select().from(clinicalOrders).where(eq(clinicalOrders.id, orderId)).limit(1);
        if (existingOrder?.encounterId === id) await db.update(clinicalOrders).set(values).where(eq(clinicalOrders.id, orderId));
        else await db.insert(clinicalOrders).values({ id: orderId, ...values });
        if (orderType === "medication" && nextStatus !== "draft") {
          const [existingMedication] = await db.select().from(patientMedications).where(eq(patientMedications.sourceOrderId, orderId)).limit(1);
          const medicationValues = {
            patientId: encounter.patientId, encounterId: id, sourceOrderId: orderId, medicationName: name,
            rxNormCode: clean(submittedOrder.code) || null, instructions: clean(submittedOrder.instructions) || null,
            status: "active" as const, startDate: now.slice(0, 10), prescribedByUserId: currentUser.id,
            prescribedByName: currentUser.fullName, updatedAt: now,
          };
          if (existingMedication) await db.update(patientMedications).set(medicationValues).where(eq(patientMedications.id, existingMedication.id));
          else await db.insert(patientMedications).values({ id: crypto.randomUUID(), ...medicationValues });
        }
      }
      const eventAction = intent === "ready_to_bill" ? "ready_to_bill" : intent === "sign" ? "signed" : "saved";
      await db.insert(encounterEvents).values({
        id: crypto.randomUUID(), encounterId: id, action: eventAction, statusFrom: encounter.status, statusTo: nextStatus,
        changedByUserId: currentUser.id, changedByName: currentUser.fullName, occurredAt: now,
      });
      let queuedClaim: { id: string; claimNumber: string; created: boolean } | null = null;
      if (intent === "ready_to_bill") {
        queuedClaim = await queueClaimFromEncounter(db, {
          encounterId: id,
          currentUser,
          today,
        });
      }
      return Response.json({ id, status: nextStatus, signedAt: intent === "draft" ? encounter.signedAt : now, queuedClaim });
    }

    if (action === "createEncounter") {
      const patientId = clean(payload.patientId);
      const providerId = clean(payload.providerId);
      const facilityId = clean(payload.facilityId);
      const dateOfService = clean(payload.dateOfService) || today;
      const diagnosisCodes = clean(payload.diagnosisCodes).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      const procedureList = clean(payload.procedureCodes).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      if (!patientId || !providerId || !facilityId || !diagnosisCodes.length || !procedureList.length) {
        return Response.json({ error: "Patient, provider, facility, diagnosis and procedure are required." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      const ready = payload.readyToBill === true;
      const now = new Date().toISOString();
      await db.insert(encounters).values({
        id,
        appointmentId: clean(payload.appointmentId) || null,
        patientId,
        providerId,
        facilityId,
        referringProviderId: clean(payload.referringProviderId) || null,
        dateOfService,
        billingContext: clean(payload.billingContext) || "routine",
        chiefComplaint: clean(payload.chiefComplaint) || null,
        clinicalNote: clean(payload.clinicalNote) || null,
        diagnosisCodes: JSON.stringify(diagnosisCodes),
        procedureCodes: JSON.stringify(procedureList),
        status: ready ? "ready_to_bill" : "signed",
        signedAt: now,
        readyToBillAt: ready ? now : null,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createDraftEncounter") {
      const patientId = clean(payload.patientId);
      const providerId = clean(payload.providerId);
      const facilityId = clean(payload.facilityId);
      const dateOfService = clean(payload.dateOfService) || today;
      if (!patientId || !providerId || !facilityId) {
        return Response.json({ error: "Patient, provider and facility are required to open a visit." }, { status: 400 });
      }
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const encounter = {
        id,
        appointmentId: clean(payload.appointmentId) || null,
        patientId,
        providerId,
        facilityId,
        referringProviderId: clean(payload.referringProviderId) || null,
        dateOfService,
        billingContext: clean(payload.billingContext) || "routine",
        templateKey: "general_soap",
        subjectiveItemsJson: clean(payload.subjectiveItemsJson) || "[]",
        chiefComplaint: clean(payload.chiefComplaint) || null,
        historyOfPresentIllness: clean(payload.historyOfPresentIllness) || null,
        reviewOfSystems: clean(payload.reviewOfSystems) || null,
        physicalExam: clean(payload.physicalExam) || null,
        assessment: clean(payload.assessment) || null,
        treatmentPlan: clean(payload.treatmentPlan) || null,
        followUpInstructions: clean(payload.followUpInstructions) || null,
        clinicalNote: clean(payload.clinicalNote) || null,
        codingAssistJson: clean(payload.codingAssistJson) || "{}",
        diagnosisCodes: "[]",
        procedureCodes: "[]",
        status: "draft" as const,
        lastSavedAt: now,
      };
      await db.insert(encounters).values(encounter);
      await db.insert(encounterEvents).values({
        id: crypto.randomUUID(), encounterId: id, action: "created", statusFrom: null, statusTo: "draft",
        changedByUserId: currentUser.id, changedByName: currentUser.fullName, occurredAt: now,
      });
      const [patientRow] = await db.select({
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
      }).from(patients).where(eq(patients.id, patientId)).limit(1);
      const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
      return Response.json({
        id,
        encounter: {
          ...encounter,
          patientName: patientRow?.patientName || `${patient.firstName} ${patient.lastName}`,
          providerName: provider ? `${provider.firstName} ${provider.lastName}` : "",
        },
      }, { status: 201 });
    }

    if (action === "saveOrderResult") {
      const orderId = clean(payload.orderId);
      const [order] = await db.select().from(clinicalOrders).where(eq(clinicalOrders.id, orderId)).limit(1);
      if (!order) return Response.json({ error: "Clinical order not found." }, { status: 404 });
      if (!["lab", "imaging", "referral"].includes(order.orderType)) return Response.json({ error: "Results can only be recorded for lab, imaging or referral orders." }, { status: 400 });
      if (order.status === "cancelled") return Response.json({ error: "A cancelled order cannot receive a result." }, { status: 409 });
      const summary = clean(payload.summary);
      if (!summary) return Response.json({ error: "A result summary is required." }, { status: 400 });
      const now = new Date().toISOString();
      const resultStatus = ["preliminary", "final", "corrected"].includes(clean(payload.resultStatus)) ? clean(payload.resultStatus) : "final";
      const abnormalFlag = ["normal", "abnormal", "critical", "unknown"].includes(clean(payload.abnormalFlag)) ? clean(payload.abnormalFlag) : "unknown";
      const id = crypto.randomUUID();
      await db.insert(clinicalOrderResults).values({
        id, orderId, encounterId: order.encounterId, patientId: order.patientId,
        resultType: order.orderType as "lab" | "imaging" | "referral",
        resultStatus: resultStatus as "preliminary" | "final" | "corrected", summary,
        resultData: clean(payload.resultData) || null,
        abnormalFlag: abnormalFlag as "normal" | "abnormal" | "critical" | "unknown",
        reviewStatus: "pending", resultedAt: clean(payload.resultedAt) || now,
        createdByUserId: currentUser.id, createdByName: currentUser.fullName, updatedAt: now,
      });
      if (resultStatus !== "preliminary") await db.update(clinicalOrders).set({ status: "completed", updatedAt: now }).where(eq(clinicalOrders.id, orderId));
      return Response.json({ id }, { status: 201 });
    }

    if (action === "reviewOrderResult") {
      const id = clean(payload.id);
      const [result] = await db.select().from(clinicalOrderResults).where(eq(clinicalOrderResults.id, id)).limit(1);
      if (!result) return Response.json({ error: "Clinical result not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(clinicalOrderResults).set({ reviewStatus: "reviewed", reviewedAt: now, reviewedByUserId: currentUser.id, reviewedByName: currentUser.fullName, updatedAt: now }).where(eq(clinicalOrderResults.id, id));
      return Response.json({ id, reviewStatus: "reviewed" });
    }

    if (action === "updateClinicalOrderStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["completed", "cancelled"].includes(status)) return Response.json({ error: "Select completed or cancelled." }, { status: 400 });
      const [order] = await db.select().from(clinicalOrders).where(eq(clinicalOrders.id, id)).limit(1);
      if (!order) return Response.json({ error: "Clinical order not found." }, { status: 404 });
      await db.update(clinicalOrders).set({ status: status as "completed" | "cancelled", updatedAt: new Date().toISOString() }).where(eq(clinicalOrders.id, id));
      return Response.json({ id, status });
    }

    if (action === "createPatientMedication") {
      const patientId = clean(payload.patientId);
      const medicationName = clean(payload.medicationName);
      if (!patientId || !medicationName) return Response.json({ error: "Patient and medication name are required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(patientMedications).values({
        id, patientId, encounterId: clean(payload.encounterId) || null, sourceOrderId: null,
        medicationName, rxNormCode: clean(payload.rxNormCode) || null, dose: clean(payload.dose) || null,
        route: clean(payload.route) || null, frequency: clean(payload.frequency) || null,
        instructions: clean(payload.instructions) || null, status: "active",
        startDate: clean(payload.startDate) || now.slice(0, 10), endDate: clean(payload.endDate) || null,
        prescribedByUserId: currentUser.id, prescribedByName: currentUser.fullName, updatedAt: now,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createPatientAllergy") {
      const patientId = clean(payload.patientId);
      const allergyType = clean(payload.allergyType) || "drug";
      const isNkda = allergyType === "nkda";
      const substance = isNkda ? "No known drug allergies" : clean(payload.substance);
      if (!patientId || !substance) return Response.json({ error: "Patient and allergen/substance are required." }, { status: 400 });
      if (!["drug", "food", "environmental", "other", "nkda"].includes(allergyType)) return Response.json({ error: "Invalid allergy type." }, { status: 400 });
      const severity = ["mild", "moderate", "severe", "unknown"].includes(clean(payload.severity)) ? clean(payload.severity) : "unknown";
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const activeRows = await db.select().from(patientAllergies).where(and(eq(patientAllergies.patientId, patientId), eq(patientAllergies.status, "active")));
      if (!isNkda && activeRows.some((row) => row.allergyType !== "nkda" && row.substance.toLowerCase() === substance.toLowerCase())) return Response.json({ error: "This active allergy is already recorded." }, { status: 409 });
      const now = new Date().toISOString();
      for (const row of activeRows.filter((item) => isNkda || item.allergyType === "nkda")) {
        await db.update(patientAllergies).set({ status: "inactive", updatedAt: now }).where(eq(patientAllergies.id, row.id));
      }
      const id = crypto.randomUUID();
      await db.insert(patientAllergies).values({
        id, patientId, encounterId: clean(payload.encounterId) || null,
        allergyType: allergyType as "drug" | "food" | "environmental" | "other" | "nkda", substance,
        reaction: isNkda ? null : clean(payload.reaction) || null,
        severity: severity as "mild" | "moderate" | "severe" | "unknown", status: "active",
        onsetDate: clean(payload.onsetDate) || null, source: clean(payload.source) || "patient",
        notes: clean(payload.notes) || null, recordedByUserId: currentUser.id, recordedByName: currentUser.fullName,
        reviewedAt: now, reviewedByUserId: currentUser.id, reviewedByName: currentUser.fullName, updatedAt: now,
      });
      const [item] = await db.select().from(patientAllergies).where(eq(patientAllergies.id, id)).limit(1);
      return Response.json({ item }, { status: 201 });
    }

    if (action === "updatePatientAllergyStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["inactive", "entered_in_error"].includes(status)) return Response.json({ error: "Invalid allergy status." }, { status: 400 });
      const [allergy] = await db.select().from(patientAllergies).where(eq(patientAllergies.id, id)).limit(1);
      if (!allergy) return Response.json({ error: "Allergy record not found." }, { status: 404 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, allergy.patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Allergy record not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientAllergies).set({ status: status as "inactive" | "entered_in_error", updatedAt: now }).where(eq(patientAllergies.id, id));
      return Response.json({ id, status, updatedAt: now });
    }

    if (action === "reviewPatientAllergies") {
      const patientId = clean(payload.patientId);
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientAllergies).set({ reviewedAt: now, reviewedByUserId: currentUser.id, reviewedByName: currentUser.fullName, updatedAt: now }).where(and(eq(patientAllergies.patientId, patientId), eq(patientAllergies.status, "active")));
      return Response.json({ patientId, reviewedAt: now, reviewedByName: currentUser.fullName });
    }

    if (action === "createPatientProblem") {
      const patientId = clean(payload.patientId);
      const description = clean(payload.description);
      if (!patientId || !description) return Response.json({ error: "Patient and problem description are required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const severity = ["mild", "moderate", "severe"].includes(clean(payload.severity)) ? clean(payload.severity) : "";
      await db.insert(patientProblems).values({
        id, patientId, code: clean(payload.code) || null, description,
        status: "active", onsetDate: clean(payload.onsetDate) || null, resolvedDate: null,
        severity: severity as "" | "mild" | "moderate" | "severe",
        notes: clean(payload.notes) || null, recordedByName: currentUser.fullName, updatedAt: now,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "updatePatientProblemStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["active", "resolved", "inactive"].includes(status)) return Response.json({ error: "Invalid problem status." }, { status: 400 });
      const [problem] = await db.select().from(patientProblems).where(eq(patientProblems.id, id)).limit(1);
      if (!problem) return Response.json({ error: "Problem not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientProblems).set({
        status: status as "active" | "resolved" | "inactive",
        resolvedDate: status === "resolved" ? now.slice(0, 10) : null,
        updatedAt: now,
      }).where(eq(patientProblems.id, id));
      return Response.json({ id, status });
    }

    if (action === "createPatientHistoryItem") {
      const patientId = clean(payload.patientId);
      const historyType = clean(payload.historyType);
      const title = clean(payload.title);
      if (!patientId || !title) return Response.json({ error: "Patient and history title are required." }, { status: 400 });
      if (!["medical", "surgical", "family", "social", "hospitalization"].includes(historyType)) return Response.json({ error: "Invalid history type." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(patientHistoryItems).values({
        id, patientId,
        historyType: historyType as "medical" | "surgical" | "family" | "social" | "hospitalization",
        title, details: clean(payload.details) || null, onsetYear: clean(payload.onsetYear) || null,
        status: "active", recordedByName: currentUser.fullName, updatedAt: now,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createPatientImmunization") {
      const patientId = clean(payload.patientId);
      const vaccineName = clean(payload.vaccineName);
      const administeredOn = clean(payload.administeredOn) || new Date().toISOString().slice(0, 10);
      if (!patientId || !vaccineName) return Response.json({ error: "Patient and vaccine name are required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const status = ["completed", "refused", "deferred"].includes(clean(payload.status)) ? clean(payload.status) : "completed";
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(patientImmunizations).values({
        id, patientId, vaccineName, cvxCode: clean(payload.cvxCode) || null, administeredOn,
        doseNumber: clean(payload.doseNumber) || null, site: clean(payload.site) || null, route: clean(payload.route) || null,
        lotNumber: clean(payload.lotNumber) || null, manufacturer: clean(payload.manufacturer) || null,
        status: status as "completed" | "refused" | "deferred", notes: clean(payload.notes) || null,
        administeredByName: currentUser.fullName, updatedAt: now,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createPatientFlowsheetEntry") {
      const patientId = clean(payload.patientId);
      const metricKey = clean(payload.metricKey);
      const metricLabel = clean(payload.metricLabel) || metricKey;
      const valueText = clean(payload.value);
      if (!patientId || !metricKey || !valueText) return Response.json({ error: "Patient, metric and value are required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(patientFlowsheetEntries).values({
        id, patientId, encounterId: clean(payload.encounterId) || null,
        metricKey, metricLabel, value: valueText, unit: clean(payload.unit) || null,
        recordedAt: clean(payload.recordedAt) || now, notes: clean(payload.notes) || null,
        recordedByName: currentUser.fullName,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "ensurePatientCareChecklist") {
      const patientId = clean(payload.patientId);
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const existing = await db.select().from(patientCareChecklistItems).where(eq(patientCareChecklistItems.patientId, patientId));
      const existingKeys = new Set(existing.map((row) => row.itemKey));
      const now = new Date().toISOString();
      for (const item of DEFAULT_CARE_CHECKLIST) {
        if (existingKeys.has(item.itemKey)) continue;
        await db.insert(patientCareChecklistItems).values({
          id: crypto.randomUUID(), patientId, itemKey: item.itemKey, label: item.label, category: item.category,
          status: "pending", dueDate: null, completedAt: null, notes: null, updatedByName: currentUser.fullName, updatedAt: now,
        });
      }
      const items = await db.select().from(patientCareChecklistItems).where(eq(patientCareChecklistItems.patientId, patientId));
      return Response.json({ items });
    }

    if (action === "updateCareChecklistItem") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["pending", "done", "deferred", "not_applicable"].includes(status)) return Response.json({ error: "Invalid checklist status." }, { status: 400 });
      const [item] = await db.select().from(patientCareChecklistItems).where(eq(patientCareChecklistItems.id, id)).limit(1);
      if (!item) return Response.json({ error: "Checklist item not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientCareChecklistItems).set({
        status: status as "pending" | "done" | "deferred" | "not_applicable",
        completedAt: status === "done" ? now : null,
        notes: clean(payload.notes) || item.notes,
        updatedByName: currentUser.fullName,
        updatedAt: now,
      }).where(eq(patientCareChecklistItems.id, id));
      return Response.json({ id, status });
    }

    if (action === "createPatientRecall") {
      const patientId = clean(payload.patientId);
      const reason = clean(payload.reason);
      const dueDate = clean(payload.dueDate);
      if (!patientId || !reason || !dueDate) return Response.json({ error: "Patient, reason and due date are required." }, { status: 400 });
      const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });
      const priority = ["routine", "soon", "urgent"].includes(clean(payload.priority)) ? clean(payload.priority) : "routine";
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(patientRecalls).values({
        id, patientId, reason, dueDate,
        priority: priority as "routine" | "soon" | "urgent",
        status: "open", notes: clean(payload.notes) || null,
        createdByName: currentUser.fullName, completedAt: null, updatedAt: now,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "updatePatientRecallStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["open", "completed", "cancelled"].includes(status)) return Response.json({ error: "Invalid recall status." }, { status: 400 });
      const [recall] = await db.select().from(patientRecalls).where(eq(patientRecalls.id, id)).limit(1);
      if (!recall) return Response.json({ error: "Recall not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientRecalls).set({
        status: status as "open" | "completed" | "cancelled",
        completedAt: status === "completed" ? now : null,
        updatedAt: now,
      }).where(eq(patientRecalls.id, id));
      return Response.json({ id, status });
    }

    if (action === "updateMedicationStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status);
      if (!["active", "inactive", "completed", "discontinued"].includes(status)) return Response.json({ error: "Invalid medication status." }, { status: 400 });
      const [medication] = await db.select().from(patientMedications).where(eq(patientMedications.id, id)).limit(1);
      if (!medication) return Response.json({ error: "Medication not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(patientMedications).set({ status: status as "active" | "inactive" | "completed" | "discontinued", endDate: status === "active" ? null : now.slice(0, 10), updatedAt: now }).where(eq(patientMedications.id, id));
      return Response.json({ id, status });
    }

    if (action === "requestRefill") {
      const medicationId = clean(payload.medicationId);
      const [medication] = await db.select().from(patientMedications).where(eq(patientMedications.id, medicationId)).limit(1);
      if (!medication || medication.status !== "active") return Response.json({ error: "Only an active medication can be refilled." }, { status: 400 });
      const [pending] = await db.select().from(refillRequests).where(and(eq(refillRequests.medicationId, medicationId), eq(refillRequests.status, "pending"))).limit(1);
      if (pending) return Response.json({ error: "A refill request is already pending for this medication." }, { status: 409 });
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.insert(refillRequests).values({ id, medicationId, patientId: medication.patientId, status: "pending", requestedBy: clean(payload.requestedBy) || currentUser.fullName, requestedAt: now, notes: clean(payload.notes) || null, updatedAt: now });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "decideRefill") {
      const id = clean(payload.id);
      const decision = clean(payload.decision);
      if (!["approved", "denied"].includes(decision)) return Response.json({ error: "Select approve or deny." }, { status: 400 });
      const [refill] = await db.select().from(refillRequests).where(eq(refillRequests.id, id)).limit(1);
      if (!refill || refill.status !== "pending") return Response.json({ error: "Pending refill request not found." }, { status: 404 });
      const now = new Date().toISOString();
      await db.update(refillRequests).set({ status: decision as "approved" | "denied", decidedByUserId: currentUser.id, decidedByName: currentUser.fullName, decidedAt: now, decisionNotes: clean(payload.decisionNotes) || null, updatedAt: now }).where(eq(refillRequests.id, id));
      return Response.json({ id, status: decision });
    }

    if (action === "createPayer") {
      const name = clean(payload.name);
      const payerIdentifier = clean(payload.payerId);
      if (!name || !payerIdentifier) return Response.json({ error: "Payer name and payer ID are required." }, { status: 400 });
      const id = crypto.randomUUID();
      await db.insert(payers).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        name,
        payerId: payerIdentifier,
        eligibilityPayerId: clean(payload.eligibilityPayerId) || payerIdentifier,
        claimFilingIndicator: clean(payload.claimFilingIndicator) || "CI",
        payerType: clean(payload.payerType) || "Commercial",
        clearinghouseRoute: clean(payload.clearinghouseRoute) || null,
        phone: clean(payload.phone) || null,
        fax: clean(payload.fax) || null,
        responseDays: clean(payload.responseDays) || "12",
        status: "active",
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "updatePayer") {
      const id = clean(payload.id);
      const [payer] = await db.select().from(payers).where(eq(payers.id, id)).limit(1);
      if (!payer) return Response.json({ error: "Payer not found." }, { status: 404 });
      const responseDays = clean(payload.responseDays) || payer.responseDays || "12";
      if (!/^\d+$/.test(responseDays) || Number(responseDays) < 1) return Response.json({ error: "Response days must be at least 1." }, { status: 400 });
      await db.update(payers).set({
        name: clean(payload.name) || payer.name,
        eligibilityPayerId: clean(payload.eligibilityPayerId) || payer.eligibilityPayerId,
        claimFilingIndicator: clean(payload.claimFilingIndicator) || payer.claimFilingIndicator,
        payerType: clean(payload.payerType) || payer.payerType,
        clearinghouseRoute: clean(payload.clearinghouseRoute) || null,
        phone: clean(payload.phone) || null,
        fax: clean(payload.fax) || null,
        responseDays,
      }).where(eq(payers.id, id));
      return Response.json({ id, responseDays });
    }

    if (action === "createPlan") {
      const payerId = clean(payload.payerId);
      const name = clean(payload.name);
      if (!payerId || !name) return Response.json({ error: "Payer and plan name are required." }, { status: 400 });
      const id = crypto.randomUUID();
      await db.insert(insurancePlans).values({
        id,
        payerId,
        name,
        planType: clean(payload.planType) || "PPO",
        defaultGroupNumber: clean(payload.defaultGroupNumber) || null,
        timelyFilingDays: clean(payload.timelyFilingDays) || "90",
        requiresReferral: payload.requiresReferral ? "yes" : "no",
        requiresAuthorization: payload.requiresAuthorization ? "yes" : "no",
        status: "active",
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createProcedure") {
      const code = clean(payload.code).toUpperCase();
      const description = clean(payload.description);
      if (!code || !description) return Response.json({ error: "Procedure code and description are required." }, { status: 400 });
      const id = crypto.randomUUID();
      await db.insert(procedureCodes).values({
        id,
        code,
        description,
        codeSet: clean(payload.codeSet) || "CPT",
        defaultCharge: money(payload.defaultCharge),
        defaultPlaceOfService: clean(payload.defaultPlaceOfService) || "11",
        requiresAuthorization: payload.requiresAuthorization ? "yes" : "no",
        status: "active",
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "updateProcedure") {
      const id = clean(payload.id);
      const [procedure] = await db.select().from(procedureCodes).where(eq(procedureCodes.id, id)).limit(1);
      if (!procedure) return Response.json({ error: "Procedure code not found." }, { status: 404 });
      const charge = clean(payload.defaultCharge);
      if (!/^\d+(\.\d{1,2})?$/.test(charge)) return Response.json({ error: "Enter a valid practice charge with up to two decimal places." }, { status: 400 });
      await db.update(procedureCodes).set({
        description: clean(payload.description) || procedure.description,
        defaultCharge: money(charge),
        defaultPlaceOfService: clean(payload.defaultPlaceOfService) || procedure.defaultPlaceOfService,
        requiresAuthorization: payload.requiresAuthorization ? "yes" : "no",
      }).where(eq(procedureCodes.id, id));
      return Response.json({ id, code: procedure.code, defaultCharge: money(charge) });
    }

    if (action === "createFeeSchedule") {
      const name = clean(payload.name);
      if (!name) return Response.json({ error: "Fee schedule name is required." }, { status: 400 });
      const id = crypto.randomUUID();
      await db.insert(feeSchedules).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        payerId: clean(payload.payerId) || null,
        name,
        effectiveDate: clean(payload.effectiveDate) || today,
        status: "active",
      });
      const procedureCodeId = clean(payload.procedureCodeId);
      if (procedureCodeId) {
        await db.insert(feeScheduleItems).values({
          id: crypto.randomUUID(),
          feeScheduleId: id,
          procedureCodeId,
          allowedAmount: money(payload.allowedAmount),
          modifier: clean(payload.modifier) || null,
        });
      }
      return Response.json({ id }, { status: 201 });
    }

    if (action === "createClaim") {
      const encounterId = clean(payload.encounterId);
      const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId)).limit(1);
      if (!encounter) return Response.json({ error: "Select a valid encounter." }, { status: 400 });
      const claimQualifiers = {
        otherClaimIdQualifier: clean(payload.otherClaimIdQualifier),
        conditionDateQualifier: clean(payload.conditionDateQualifier),
        otherDateQualifier: clean(payload.otherDateQualifier),
        referringProviderQualifier: clean(payload.referringProviderQualifier),
        referringOtherIdQualifier: clean(payload.referringOtherIdQualifier),
        additionalClaimInfoQualifier: clean(payload.additionalClaimInfoQualifier),
        serviceFacilityOtherIdQualifier: clean(payload.serviceFacilityOtherIdQualifier),
        billingProviderOtherIdQualifier: clean(payload.billingProviderOtherIdQualifier),
        icdIndicator: clean(payload.icdIndicator) || "0",
        billFrequencyCode: storedBillFrequencyCode(payload.billFrequencyCode) || "",
        renderingOtherIdQualifier: clean(payload.renderingOtherIdQualifier),
        epsdtReasonCode: clean(payload.epsdtReasonCode),
        supplementalQualifier: clean(payload.supplementalQualifier),
      };
      const activeConfiguration = await db
        .select({ category: claimConfigurationValues.category, code: claimConfigurationValues.code })
        .from(claimConfigurationValues)
        .where(eq(claimConfigurationValues.status, "active"));
      const configuredCodes = (category: string, fallback: string[]) => {
        const values = activeConfiguration.filter((item) => item.category === category).map((item) => item.code);
        return ["", ...(values.length ? values : fallback)];
      };
      const allowedQualifiers: Record<keyof typeof claimQualifiers, string[]> = {
        otherClaimIdQualifier: configuredCodes("other_claim_id", ["Y4"]),
        conditionDateQualifier: configuredCodes("condition_date", ["431", "484"]),
        otherDateQualifier: configuredCodes("other_date", ["454", "304", "453", "439", "455", "471", "090", "091", "444"]),
        referringProviderQualifier: configuredCodes("provider_role", ["DN", "DK", "DQ"]),
        referringOtherIdQualifier: configuredCodes("box17a_identifier", ["0B", "1G", "G2", "LU"]),
        additionalClaimInfoQualifier: configuredCodes("box19_information", ["0B", "1G", "G2", "LU", "N5", "X5", "ZZ", "ADD", "CER", "DCP", "DGN", "TPO"]),
        serviceFacilityOtherIdQualifier: configuredCodes("facility_identifier", ["0B", "G2", "LU"]),
        billingProviderOtherIdQualifier: configuredCodes("billing_identifier", ["0B", "G2", "ZZ"]),
        icdIndicator: configuredCodes("icd_indicator", ["0", "9"]).filter(Boolean),
        billFrequencyCode: [...configuredCodes("bill_frequency", ["7", "8"]), "1"],
        renderingOtherIdQualifier: configuredCodes("rendering_identifier", ["0B", "1G", "G2", "LU", "ZZ"]),
        epsdtReasonCode: configuredCodes("epsdt_reason", ["AV", "S2", "ST", "NU"]),
        supplementalQualifier: configuredCodes("supplemental", ["ZZ", "N4", "DI", "CTR", "JP", "JO"]),
      };
      const invalidQualifier = (Object.keys(claimQualifiers) as (keyof typeof claimQualifiers)[])
        .find((key) => !allowedQualifiers[key].includes(claimQualifiers[key]));
      if (invalidQualifier) return Response.json({ error: `Invalid CMS-1500 qualifier for ${invalidQualifier}.` }, { status: 400 });
      const pairedFields: [string, string, string][] = [
        ["otherClaimIdQualifier", "otherClaimId", "Box 11b qualifier and claim ID"],
        ["conditionDateQualifier", "conditionDate", "Box 14 qualifier and date"],
        ["otherDateQualifier", "otherDate", "Box 15 qualifier and date"],
        ["referringOtherIdQualifier", "referringOtherId", "Box 17a qualifier and identifier"],
        ["additionalClaimInfoQualifier", "additionalClaimInfo", "Box 19 qualifier and information"],
        ["serviceFacilityOtherIdQualifier", "serviceFacilityOtherId", "Box 32b qualifier and identifier"],
        ["billingProviderOtherIdQualifier", "billingProviderOtherId", "Box 33b qualifier and identifier"],
        ["renderingOtherIdQualifier", "renderingOtherId", "Box 24I qualifier and rendering identifier"],
        ["supplementalQualifier", "supplementalInformation", "Box 24 shaded qualifier and information"],
      ];
      const incompletePair = pairedFields.find(([left, right]) => Boolean(clean(payload[left])) !== Boolean(clean(payload[right])));
      if (incompletePair) return Response.json({ error: `${incompletePair[2]} must be entered together.` }, { status: 400 });
      const box22Issue = box22ScrubIssues(payload.billFrequencyCode, payload.originalReferenceNumber)[0];
      if (box22Issue) return Response.json({ error: box22Issue.message }, { status: 400 });
      const ynFields = ["otherPlanIndicator", "employmentRelated", "autoAccidentRelated", "otherAccidentRelated", "outsideLabIndicator", "patientSignatureOnFile", "insuredSignatureOnFile", "providerSignatureOnFile", "emergencyIndicator", "epsdtIndicator"];
      const invalidYn = ynFields.find((key) => clean(payload[key]) && !["Y", "N"].includes(clean(payload[key])));
      if (invalidYn) return Response.json({ error: `${invalidYn} must be Y or N.` }, { status: 400 });
      if (clean(payload.autoAccidentRelated) === "Y" && !/^[A-Z]{2}$/.test(clean(payload.autoAccidentState).toUpperCase())) {
        return Response.json({ error: "Box 10b requires a two-letter accident state when auto accident is Yes." }, { status: 400 });
      }
      if ((clean(payload.outsideLabIndicator) === "Y") !== Boolean(clean(payload.outsideLabCharges))) {
        return Response.json({ error: "Box 20 outside-lab Yes and purchased-service charge must be entered together." }, { status: 400 });
      }
      if (Boolean(clean(payload.federalTaxIdType)) !== Boolean(clean(payload.federalTaxIdNumber))) {
        return Response.json({ error: "Box 25 tax ID type and number must be entered together." }, { status: 400 });
      }
      const conditionCodes = clean(payload.claimConditionCodes).split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
      const ndcCode = clean(payload.ndcCode).replace(/\D/g, "");
      const ndcUnitQualifier = clean(payload.ndcUnitQualifier);
      const ndcQuantity = clean(payload.ndcQuantity);
      const hasAnyNdc = Boolean(ndcCode || ndcUnitQualifier || ndcQuantity || clean(payload.ndcUnitPrice));
      if (hasAnyNdc && (ndcCode.length !== 11 || !["F2", "GR", "ME", "ML", "UN"].includes(ndcUnitQualifier) || !ndcQuantity)) {
        return Response.json({ error: "NDC reporting requires an 11-digit code, a valid unit qualifier, and quantity." }, { status: 400 });
      }
      const candidateProfiles = await db
        .select()
        .from(billingResponsibilityProfiles)
        .where(and(
          eq(billingResponsibilityProfiles.patientId, encounter.patientId),
          eq(billingResponsibilityProfiles.billingContext, encounter.billingContext),
          eq(billingResponsibilityProfiles.status, "active"),
        ))
        .orderBy(desc(billingResponsibilityProfiles.effectiveFrom));
      const responsibilityProfile = candidateProfiles.find((profile) =>
        profile.effectiveFrom <= encounter.dateOfService
        && (!profile.effectiveTo || profile.effectiveTo >= encounter.dateOfService));
      const profileSources = responsibilityProfile
        ? await db.select().from(responsibilitySources).where(eq(responsibilitySources.profileId, responsibilityProfile.id)).orderBy(asc(responsibilitySources.sequence))
        : [];
      const profileClaimSource = profileSources.find((source) => source.coverageId);
      const [fallbackCoverage] = await db
        .select()
        .from(patientCoverages)
        .where(and(eq(patientCoverages.patientId, encounter.patientId), eq(patientCoverages.status, "active")))
        .orderBy(sql`case ${patientCoverages.priority} when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3 when 'guarantor' then 4 when 'final_balance' then 5 else 6 end`)
        .limit(1);
      const coverageId = responsibilityProfile ? profileClaimSource?.coverageId || null : fallbackCoverage?.id || null;
      const [coverage] = coverageId
        ? await db.select().from(patientCoverages).where(eq(patientCoverages.id, coverageId)).limit(1)
        : [];
      const [claimPatient] = await db.select().from(patients).where(eq(patients.id, encounter.patientId)).limit(1);
      const procedures = JSON.parse(encounter.procedureCodes) as string[];
      const procedureRows = procedures.length
        ? await db.select().from(procedureCodes).where(sql`${procedureCodes.code} in (${sql.join(procedures.map((code) => sql`${code}`), sql`, `)})`)
        : [];
      const total = procedureRows.reduce((sum, item) => sum + Number(item.defaultCharge), 0);
      const id = crypto.randomUUID();
      const claimNumber = `CLM${Date.now().toString().slice(-7)}`;
      const isPip = coverage?.coverageType === "auto_pip";
      const isWorkersComp = coverage?.coverageType === "workers_comp";
      await db.insert(claims).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        claimNumber,
        patientId: encounter.patientId,
        encounterId: encounter.id,
        coverageId: coverage?.id || null,
        payerId: coverage ? (await db.select({ payerId: insurancePlans.payerId }).from(insurancePlans).where(eq(insurancePlans.id, coverage.planId)).limit(1))[0]?.payerId || null : null,
        providerId: encounter.providerId,
        facilityId: encounter.facilityId,
        referringProviderId: encounter.referringProviderId,
        insuranceTypeCode: clean(payload.insuranceTypeCode) || "other",
        otherPlanIndicator: clean(payload.otherPlanIndicator) || "N",
        employmentRelated: isWorkersComp ? "Y" : clean(payload.employmentRelated) || "N",
        autoAccidentRelated: isPip ? "Y" : clean(payload.autoAccidentRelated) || "N",
        autoAccidentState: isPip ? coverage.accidentState : clean(payload.autoAccidentState).toUpperCase() || null,
        otherAccidentRelated: clean(payload.otherAccidentRelated) || "N",
        claimConditionCodes: JSON.stringify(conditionCodes),
        dateOfService: encounter.dateOfService,
        transactionDate: today,
        postingDate: today,
        status: "draft",
        lifecycleStatus: "bill_to_pri",
        workflowStatus: "needs_scrub",
        scrubberStatus: "not_run",
        scrubberMessages: "[]",
        scrubResult: null,
        scrubRulesChecked: "[]",
        scrubErrorCount: "0",
        totalCharge: total.toFixed(2),
        otherClaimIdQualifier: coverage?.propertyCasualtyClaimNumber ? "Y4" : claimQualifiers.otherClaimIdQualifier || null,
        otherClaimId: coverage?.propertyCasualtyClaimNumber || clean(payload.otherClaimId) || null,
        conditionDateQualifier: isPip && coverage?.accidentDate ? "431" : claimQualifiers.conditionDateQualifier || null,
        conditionDate: isPip && coverage?.accidentDate ? coverage.accidentDate : clean(payload.conditionDate) || null,
        otherDateQualifier: coverage?.accidentDate ? "439" : claimQualifiers.otherDateQualifier || null,
        otherDate: coverage?.accidentDate || clean(payload.otherDate) || null,
        referringProviderQualifier: claimQualifiers.referringProviderQualifier || null,
        referringOtherIdQualifier: claimQualifiers.referringOtherIdQualifier || null,
        referringOtherId: clean(payload.referringOtherId) || null,
        additionalClaimInfoQualifier: claimQualifiers.additionalClaimInfoQualifier || null,
        additionalClaimInfo: clean(payload.additionalClaimInfo) || null,
        unableToWorkFrom: clean(payload.unableToWorkFrom) || null,
        unableToWorkTo: clean(payload.unableToWorkTo) || null,
        hospitalizationFrom: clean(payload.hospitalizationFrom) || null,
        hospitalizationTo: clean(payload.hospitalizationTo) || null,
        outsideLabIndicator: clean(payload.outsideLabIndicator) || "N",
        outsideLabCharges: clean(payload.outsideLabCharges) ? money(payload.outsideLabCharges) : null,
        priorAuthorizationNumber: coverage?.authorizationNumber || clean(payload.priorAuthorizationNumber) || null,
        federalTaxIdType: clean(payload.federalTaxIdType) || null,
        federalTaxIdNumber: clean(payload.federalTaxIdNumber).replace(/\D/g, "") || null,
        patientSignatureOnFile: clean(payload.patientSignatureOnFile) || "Y",
        patientSignatureDate: clean(payload.patientSignatureDate) || null,
        insuredSignatureOnFile: clean(payload.insuredSignatureOnFile) || "Y",
        providerSignatureOnFile: clean(payload.providerSignatureOnFile) || "Y",
        providerSignatureDate: clean(payload.providerSignatureDate) || today,
        serviceFacilityOtherIdQualifier: claimQualifiers.serviceFacilityOtherIdQualifier || null,
        serviceFacilityOtherId: clean(payload.serviceFacilityOtherId) || null,
        billingProviderOtherIdQualifier: claimQualifiers.billingProviderOtherIdQualifier || null,
        billingProviderOtherId: clean(payload.billingProviderOtherId) || null,
        icdIndicator: claimQualifiers.icdIndicator,
        diagnosisCodes: encounter.diagnosisCodes,
        claimDataSnapshot: JSON.stringify({
          patientFirstName: claimPatient?.firstName || "",
          patientMiddleName: claimPatient?.middleName || "",
          patientLastName: claimPatient?.lastName || "",
          patientDateOfBirth: claimPatient?.dateOfBirth || "",
          patientSex: claimPatient?.sex || "",
          patientAddressLine1: claimPatient?.addressLine1 || "",
          patientCity: claimPatient?.city || "",
          patientState: claimPatient?.state || "",
          patientPostalCode: claimPatient?.postalCode || "",
          memberId: coverage?.memberId || "",
          groupNumber: coverage?.groupNumber || "",
          relationship: coverage?.relationship || "self",
          subscriberFirstName: coverage?.subscriberFirstName || "",
          subscriberLastName: coverage?.subscriberLastName || "",
          subscriberDateOfBirth: coverage?.subscriberDateOfBirth || "",
          subscriberSex: coverage?.subscriberSex || "",
          subscriberAddressLine1: coverage?.subscriberAddressLine1 || "",
          subscriberCity: coverage?.subscriberCity || "",
          subscriberState: coverage?.subscriberState || "",
          subscriberPostalCode: coverage?.subscriberPostalCode || "",
          acceptAssignment: coverage?.acceptAssignment === "no" ? "N" : "Y",
        }),
        billFrequencyCode: claimQualifiers.billFrequencyCode || null,
        originalReferenceNumber: clean(payload.originalReferenceNumber) || null,
      });
      await db.insert(claimResponsibilitySnapshots).values({
        id: crypto.randomUUID(),
        claimId: id,
        profileId: responsibilityProfile?.id || null,
        billingContext: encounter.billingContext,
        profileSnapshot: JSON.stringify(responsibilityProfile ? {
          ...responsibilityProfile,
          sources: profileSources,
        } : {
          profileName: "Fallback active coverage",
          billingContext: encounter.billingContext,
          effectiveFrom: encounter.dateOfService,
          sources: coverage ? [{
            sequence: "1",
            role: "primary",
            sourceType: "insurance",
            coverageId: coverage.id,
            sourceName: "Active patient coverage",
          }] : [{
            sequence: "1",
            role: "primary",
            sourceType: "patient",
            coverageId: null,
            sourceName: "Patient / self pay",
          }],
        }),
      });
      const [provider] = await db.select().from(providers).where(eq(providers.id, encounter.providerId)).limit(1);
      for (const [index, code] of procedures.entries()) {
        const procedure = procedureRows.find((item) => item.code === code);
        await db.insert(claimLines).values({
          id: crypto.randomUUID(),
          claimId: id,
          lineNumber: String(index + 1),
          procedureCode: code,
          modifiers: clean(payload.lineModifiers).split(",").map((modifier) => modifier.trim().toUpperCase()).filter(Boolean).slice(0, 4).join(",") || null,
          diagnosisPointers: clean(payload.lineDiagnosisPointers).replace(/[^A-L]/gi, "").toUpperCase().slice(0, 4) || "A",
          units: clean(payload.lineUnits) || "1",
          chargeAmount: procedure?.defaultCharge || "0.00",
          placeOfService: clean(payload.linePlaceOfService) || procedure?.defaultPlaceOfService || "11",
          renderingNpi: provider?.npi || null,
          emergencyIndicator: clean(payload.emergencyIndicator) || null,
          serviceDateFrom: encounter.dateOfService,
          serviceDateTo: encounter.dateOfService,
          renderingOtherIdQualifier: index === 0 ? claimQualifiers.renderingOtherIdQualifier || null : null,
          renderingOtherId: index === 0 ? clean(payload.renderingOtherId) || null : null,
          epsdtReasonCode: index === 0 ? claimQualifiers.epsdtReasonCode || null : null,
          epsdtIndicator: index === 0 ? clean(payload.epsdtIndicator) || null : null,
          familyPlanningIndicator: index === 0 && payload.familyPlanningIndicator ? "Y" : null,
          supplementalQualifier: index === 0 ? hasAnyNdc ? "N4" : claimQualifiers.supplementalQualifier || null : null,
          supplementalInformation: index === 0 ? hasAnyNdc ? `${ndcCode} ${ndcUnitQualifier}${ndcQuantity}${clean(payload.ndcUnitPrice) ? ` ${money(payload.ndcUnitPrice)}` : ""}` : clean(payload.supplementalInformation) || null : null,
          ndcCode: index === 0 ? ndcCode || null : null,
          ndcUnitQualifier: index === 0 ? ndcUnitQualifier || null : null,
          ndcQuantity: index === 0 ? ndcQuantity || null : null,
          ndcUnitPrice: index === 0 ? clean(payload.ndcUnitPrice) || null : null,
        });
      }
      await recordClaimWorkflowEvent(db, {
        claimId: id,
        previousStatus: null,
        newStatus: "needs_scrub",
        action: "Claim Created",
        reason: "Entered through billing claim creation",
        actorUserId: currentUser.id,
        actorName: currentUser.fullName,
      });
      return Response.json({ id, claimNumber, workflowStatus: "needs_scrub" }, { status: 201 });
    }

    if (action === "queueReadyClaims") {
      const readyEncounters = await db.select().from(encounters).where(eq(encounters.status, "ready_to_bill"));
      const queued: Array<{ encounterId: string; claimId: string; claimNumber: string; created: boolean }> = [];
      for (const encounter of readyEncounters) {
        const result = await queueClaimFromEncounter(db, { encounterId: encounter.id, currentUser, today });
        if (result) queued.push({ encounterId: encounter.id, claimId: result.id, claimNumber: result.claimNumber, created: result.created });
      }
      return Response.json({ count: queued.length, created: queued.filter((row) => row.created).length, queued });
    }

    if (action === "seedDemoWorkspace" || action === "seedClaimWorkflowSamples") {
      if (currentUser.role.toLowerCase() !== "administrator") {
        return Response.json({ error: "Only an administrator can load sample workspace data." }, { status: 403 });
      }
      const summary = await seedDemoWorkspace(db, { currentUser, today });
      return Response.json({
        ok: true,
        message: "Sample patients, scheduler visits, encounters, claims, batches, and a payment entry were loaded.",
        ...summary,
      });
    }

    if (action === "seedCollectionFixtures") {
      if (currentUser.role.toLowerCase() !== "administrator") return Response.json({ error: "Only an administrator can load collection test data." }, { status: 403 });
      const [provider] = await db.select().from(providers).where(eq(providers.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
      const [facility] = await db.select().from(facilities).where(eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
      const [payer] = await db.select().from(payers).where(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
      const [plan] = payer ? await db.select().from(insurancePlans).where(eq(insurancePlans.payerId, payer.id)).limit(1) : [];
      const [secondaryPayer] = await db.select().from(payers).where(and(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID), sql`${payers.id} <> ${payer?.id || ""}`)).limit(1);
      const [secondaryPlan] = secondaryPayer ? await db.select().from(insurancePlans).where(eq(insurancePlans.payerId, secondaryPayer.id)).limit(1) : [];
      if (!provider || !facility || !payer || !plan) return Response.json({ error: "Create a provider, facility, payer and plan before loading collection fixtures." }, { status: 409 });
      const now = new Date().toISOString();
      const fixtures = [
        { key: "DENIAL", name: "Collection Denial", dos: "2025-01-18", billed: "2025-01-20", charge: "680.00", lifecycle: "denied_pri", status: "denied", code: "CO-16" },
        { key: "OPEN", name: "Collection Open", dos: "2025-03-12", billed: "2025-03-15", charge: "425.00", lifecycle: "sent_pri", status: "submitted", code: "" },
        { key: "SECONDARY", name: "Collection Secondary", dos: "2025-05-07", billed: "2025-05-10", charge: "910.00", lifecycle: "paid_pri", status: "partially_paid", code: "PR-2" },
        { key: "SECONDARY2", name: "Collection Secondary 2", dos: "2025-07-09", billed: "2025-07-12", charge: "540.00", lifecycle: "paid_pri", status: "partially_paid", code: "PR-2" },
        { key: "PATIENT", name: "Collection Patient", dos: "2025-06-22", billed: "2025-06-25", charge: "275.00", lifecycle: "paid_pri", status: "partially_paid", code: "PR-3" },
      ];
      const created: string[] = [];
      for (const fixture of fixtures) {
        const claimNumber = `COLL-DEMO-${fixture.key}`;
        const [existing] = await db.select().from(claims).where(and(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID), eq(claims.claimNumber, claimNumber))).limit(1);
        if (existing) { created.push(claimNumber); continue; }
        const patientId = crypto.randomUUID();
        const claimId = crypto.randomUUID();
        const coverageId = crypto.randomUUID();
        const firstName = fixture.name.split(" ")[1] || "Demo";
        const lastName = "Patient";
        await db.insert(patients).values({ id: patientId, organizationId: DEFAULT_ORGANIZATION_ID, accountNumber: `COLL-${fixture.key}`, firstName, lastName, dateOfBirth: "1982-05-14", sex: "unknown", addressLine1: `${200 + created.length} Collection Lane`, city: "Orlando", state: "FL", postalCode: `3281${created.length}`, phone: `407-555-${String(2300 + created.length)}`, email: `${fixture.key.toLowerCase()}@example.test`, status: "active", createdAt: now, updatedAt: now });
        await db.insert(patientCoverages).values({ id: coverageId, patientId, planId: plan.id, coverageType: "health", priority: "primary", memberId: `COLL-MEMBER-${fixture.key}`, groupNumber: "COLL-GROUP", relationship: "self", subscriberFirstName: firstName, subscriberLastName: lastName, subscriberDateOfBirth: "1982-05-14", subscriberSex: "unknown", effectiveDate: "2024-01-01", status: "active", createdAt: now });
        if (secondaryPlan && fixture.key.startsWith("SECONDARY")) await db.insert(patientCoverages).values({ id: crypto.randomUUID(), patientId, planId: secondaryPlan.id, coverageType: "health", priority: "secondary", memberId: `COLL-SECONDARY-${fixture.key}`, groupNumber: "COLL-SECONDARY-GROUP", relationship: "self", subscriberFirstName: firstName, subscriberLastName: lastName, subscriberDateOfBirth: "1982-05-14", subscriberSex: "unknown", effectiveDate: "2024-01-01", status: "active", createdAt: now });
        await db.insert(claims).values({ id: claimId, organizationId: DEFAULT_ORGANIZATION_ID, claimNumber, patientId, encounterId: null, coverageId, payerId: payer.id, providerId: provider.id, facilityId: facility.id, referringProviderId: null, insuranceTypeCode: "other", otherPlanIndicator: "N", employmentRelated: "N", autoAccidentRelated: "N", otherAccidentRelated: "N", claimConditionCodes: "[]", icdIndicator: "0", diagnosisCodes: JSON.stringify(["I10"]), claimDataSnapshot: JSON.stringify({ fixture: "collection_ar_test", denialCode: fixture.code }), dateOfService: fixture.dos, transactionDate: fixture.billed, postingDate: fixture.billed, firstBilledDate: fixture.billed, lastBilledDate: fixture.billed, status: fixture.status as "denied" | "submitted" | "partially_paid", lifecycleStatus: fixture.lifecycle, workflowStatus: "submitted", scrubberStatus: "passed", scrubberMessages: "[]", scrubRulesChecked: "[]", scrubErrorCount: "0", totalCharge: fixture.charge, totalPaid: fixture.key === "SECONDARY" ? "250.00" : fixture.key === "PATIENT" ? "100.00" : "0.00", totalAdjustment: "0.00", patientResponsibility: fixture.key === "SECONDARY" ? "660.00" : fixture.key === "PATIENT" ? "175.00" : fixture.charge, remainingBalance: fixture.key === "SECONDARY" ? "660.00" : fixture.key === "PATIENT" ? "175.00" : fixture.charge, submissionMode: "test", submissionMethod: "electronic", createdAt: now, updatedAt: now });
        await db.insert(claimLines).values({ id: crypto.randomUUID(), claimId, lineNumber: "1", procedureCode: "99213", modifiers: null, diagnosisPointers: "A", units: "1", chargeAmount: fixture.charge, placeOfService: "11", renderingNpi: provider.npi || null, serviceDateFrom: fixture.dos, serviceDateTo: fixture.dos });
        created.push(claimNumber);
      }
      return Response.json({ created: created.length, claimNumbers: created, message: "Collection Arena fixtures are ready." });
    }

    if (action === "saveClaimCorrections") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      const followUpSave = payload.followUpSave === true || clean(payload.followUpSave) === "true";
      const previouslySubmitted = Boolean(claim.firstBilledDate || claim.clearinghouseTrace || ["submitted", "accepted", "rejected", "denied"].includes(claim.status));
      if (claim.batchId && !followUpSave && !previouslySubmitted) {
        return Response.json({ error: "This claim is locked in a transmission batch and cannot be edited." }, { status: 409 });
      }
      if (["paid", "appealed"].includes(claim.status) && (!followUpSave || Number(claim.remainingBalance || 0) <= 0.009)) {
        return Response.json({ error: "Paid or appealed claims cannot be changed from the correction editor." }, { status: 409 });
      }

      const correctionAction = ["replacement", "void"].includes(clean(payload.correctionAction))
        ? clean(payload.correctionAction) as "replacement" | "void"
        : "save" as const;
      if (!previouslySubmitted && correctionAction !== "save") {
        return Response.json({ error: "Replacement and void actions are only available after an original claim was submitted." }, { status: 400 });
      }
      const originalReferenceNumber = clean(payload.originalReferenceNumber) || claim.originalReferenceNumber || claim.clearinghouseTrace || "";
      if (correctionAction !== "save" && !originalReferenceNumber) {
        return Response.json({ error: "Enter the payer or clearinghouse original claim reference before a replacement or void." }, { status: 400 });
      }

      const diagnosisCodes = clean(payload.diagnosisCodes)
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 12);
      const rawLines = Array.isArray(payload.lines) ? payload.lines as Record<string, unknown>[] : [];
      if (!rawLines.length) return Response.json({ error: "A claim requires at least one service line." }, { status: 400 });
      const nextLines = rawLines.slice(0, 50).map((line, index) => ({
        id: clean(line.id) || crypto.randomUUID(),
        claimId: id,
        lineNumber: String(index + 1),
        procedureCode: clean(line.procedureCode).toUpperCase(),
        modifiers: clean(line.modifiers).toUpperCase() || null,
        diagnosisPointers: clean(line.diagnosisPointers).toUpperCase() || "A",
        units: clean(line.units) || "1",
        chargeAmount: money(line.chargeAmount),
        placeOfService: clean(line.placeOfService) || "11",
        renderingNpi: clean(line.renderingNpi) || null,
        emergencyIndicator: clean(line.emergencyIndicator) || null,
        renderingOtherIdQualifier: clean(line.renderingOtherIdQualifier) || null,
        renderingOtherId: clean(line.renderingOtherId) || null,
        epsdtReasonCode: clean(line.epsdtReasonCode) || null,
        epsdtIndicator: clean(line.epsdtIndicator) || null,
        familyPlanningIndicator: clean(line.familyPlanningIndicator) || null,
        supplementalQualifier: clean(line.supplementalQualifier) || null,
        supplementalInformation: clean(line.supplementalInformation) || null,
        ndcCode: clean(line.ndcCode) || null,
        ndcUnitQualifier: clean(line.ndcUnitQualifier) || null,
        ndcQuantity: clean(line.ndcQuantity) || null,
        ndcUnitPrice: clean(line.ndcUnitPrice) || null,
        serviceDateFrom: clean(line.serviceDateFrom) || clean(payload.dateOfService) || claim.dateOfService,
        serviceDateTo: clean(line.serviceDateTo) || clean(line.serviceDateFrom) || clean(payload.dateOfService) || claim.dateOfService,
      }));
      if (nextLines.some((line) => !line.procedureCode)) return Response.json({ error: "Every service line requires a CPT/HCPCS code." }, { status: 400 });

      const beforeLines = await db.select().from(claimLines).where(eq(claimLines.claimId, id)).orderBy(asc(claimLines.lineNumber));
      const beforeSnapshot = JSON.stringify({ claim, lines: beforeLines });
      let existingClaimData: Record<string, string> = {};
      try { existingClaimData = JSON.parse(claim.claimDataSnapshot || "{}") as Record<string, string>; } catch { existingClaimData = {}; }
      const claimDataSnapshot = {
        ...existingClaimData,
        patientFirstName: clean(payload.patientFirstName) || existingClaimData.patientFirstName,
        patientMiddleName: clean(payload.patientMiddleName) || existingClaimData.patientMiddleName,
        patientLastName: clean(payload.patientLastName) || existingClaimData.patientLastName,
        patientDateOfBirth: clean(payload.patientDateOfBirth) || existingClaimData.patientDateOfBirth,
        patientSex: clean(payload.patientSex) || existingClaimData.patientSex,
        patientAddressLine1: clean(payload.patientAddressLine1) || existingClaimData.patientAddressLine1,
        patientCity: clean(payload.patientCity) || existingClaimData.patientCity,
        patientState: clean(payload.patientState).toUpperCase() || existingClaimData.patientState,
        patientPostalCode: clean(payload.patientPostalCode) || existingClaimData.patientPostalCode,
        memberId: clean(payload.memberId) || existingClaimData.memberId,
        groupNumber: clean(payload.groupNumber) || existingClaimData.groupNumber,
        relationship: clean(payload.relationship) || existingClaimData.relationship,
        subscriberFirstName: clean(payload.subscriberFirstName) || existingClaimData.subscriberFirstName,
        subscriberLastName: clean(payload.subscriberLastName) || existingClaimData.subscriberLastName,
        subscriberDateOfBirth: clean(payload.subscriberDateOfBirth) || existingClaimData.subscriberDateOfBirth,
        subscriberSex: clean(payload.subscriberSex) || existingClaimData.subscriberSex,
        subscriberAddressLine1: clean(payload.subscriberAddressLine1) || existingClaimData.subscriberAddressLine1,
        subscriberCity: clean(payload.subscriberCity) || existingClaimData.subscriberCity,
        subscriberState: clean(payload.subscriberState).toUpperCase() || existingClaimData.subscriberState,
        subscriberPostalCode: clean(payload.subscriberPostalCode) || existingClaimData.subscriberPostalCode,
        acceptAssignment: clean(payload.acceptAssignment) || existingClaimData.acceptAssignment || "Y",
        secondaryCoverageId: clean(payload.secondaryCoverageId) || existingClaimData.secondaryCoverageId || "",
        tertiaryCoverageId: clean(payload.tertiaryCoverageId) || existingClaimData.tertiaryCoverageId || "",
      };
      const claimConditionCodes = clean(payload.claimConditionCodes).split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
      const totalCharge = nextLines.reduce((total, line) => total + Number(line.chargeAmount), 0).toFixed(2);
      const now = new Date().toISOString();
      const updates: Partial<typeof claims.$inferInsert> = {
        insuranceTypeCode: clean(payload.insuranceTypeCode) || null,
        otherPlanIndicator: clean(payload.otherPlanIndicator) || null,
        employmentRelated: clean(payload.employmentRelated) || "N",
        autoAccidentRelated: clean(payload.autoAccidentRelated) || "N",
        autoAccidentState: clean(payload.autoAccidentState).toUpperCase() || null,
        otherAccidentRelated: clean(payload.otherAccidentRelated) || "N",
        claimConditionCodes: JSON.stringify(claimConditionCodes),
        otherClaimIdQualifier: clean(payload.otherClaimIdQualifier) || null,
        otherClaimId: clean(payload.otherClaimId) || null,
        conditionDateQualifier: clean(payload.conditionDateQualifier) || null,
        conditionDate: clean(payload.conditionDate) || null,
        otherDateQualifier: clean(payload.otherDateQualifier) || null,
        otherDate: clean(payload.otherDate) || null,
        referringProviderQualifier: clean(payload.referringProviderQualifier) || null,
        referringOtherIdQualifier: clean(payload.referringOtherIdQualifier) || null,
        referringOtherId: clean(payload.referringOtherId) || null,
        additionalClaimInfoQualifier: clean(payload.additionalClaimInfoQualifier) || null,
        additionalClaimInfo: clean(payload.additionalClaimInfo) || null,
        unableToWorkFrom: clean(payload.unableToWorkFrom) || null,
        unableToWorkTo: clean(payload.unableToWorkTo) || null,
        hospitalizationFrom: clean(payload.hospitalizationFrom) || null,
        hospitalizationTo: clean(payload.hospitalizationTo) || null,
        outsideLabIndicator: clean(payload.outsideLabIndicator) || "N",
        outsideLabCharges: clean(payload.outsideLabCharges) ? money(payload.outsideLabCharges) : null,
        priorAuthorizationNumber: clean(payload.priorAuthorizationNumber) || null,
        federalTaxIdType: clean(payload.federalTaxIdType) || null,
        federalTaxIdNumber: clean(payload.federalTaxIdNumber).replace(/\D/g, "") || null,
        patientSignatureOnFile: clean(payload.patientSignatureOnFile) || null,
        patientSignatureDate: clean(payload.patientSignatureDate) || null,
        insuredSignatureOnFile: clean(payload.insuredSignatureOnFile) || null,
        providerSignatureOnFile: clean(payload.providerSignatureOnFile) || null,
        providerSignatureDate: clean(payload.providerSignatureDate) || null,
        serviceFacilityOtherIdQualifier: clean(payload.serviceFacilityOtherIdQualifier) || null,
        serviceFacilityOtherId: clean(payload.serviceFacilityOtherId) || null,
        billingProviderOtherIdQualifier: clean(payload.billingProviderOtherIdQualifier) || null,
        billingProviderOtherId: clean(payload.billingProviderOtherId) || null,
        icdIndicator: clean(payload.icdIndicator) || "0",
        diagnosisCodes: JSON.stringify(diagnosisCodes),
        claimDataSnapshot: JSON.stringify(claimDataSnapshot),
        billFrequencyCode: correctionAction === "replacement" ? "7" : correctionAction === "void" ? "8" : storedBillFrequencyCode(payload.billFrequencyCode),
        originalReferenceNumber: correctionAction === "save" ? clean(payload.originalReferenceNumber) || null : originalReferenceNumber,
        dateOfService: clean(payload.dateOfService) || claim.dateOfService,
        status: deriveWorkflowStatus(claim) === "error" ? "scrub_error" : "draft",
        workflowStatus: deriveWorkflowStatus(claim) === "error" ? "error" : "needs_scrub",
        scrubberStatus: deriveWorkflowStatus(claim) === "error" ? "errors" : "not_run",
        scrubberMessages: "[]",
        scrubResult: null,
        scrubRulesChecked: "[]",
        scrubErrorCount: "0",
        lastScrubbedAt: null,
        scrubbedByUserId: null,
        scrubbedByName: null,
        generationId: null,
        generatedAt: null,
        generatedByUserId: null,
        generatedByName: null,
        claimFormat: null,
        generationResult: null,
        generatedTransactionRef: null,
        submissionMethod: "unassigned",
        routedAt: null,
        printedAt: null,
        mailedAt: null,
        mailedByName: null,
        mailMethod: null,
        mailTrackingNumber: null,
        totalCharge,
        updatedAt: now,
      };
      if (followUpSave) {
        delete updates.status;
        delete updates.workflowStatus;
        delete updates.scrubberStatus;
        delete updates.scrubberMessages;
        delete updates.scrubResult;
        delete updates.scrubRulesChecked;
        delete updates.scrubErrorCount;
        delete updates.lastScrubbedAt;
        delete updates.scrubbedByUserId;
        delete updates.scrubbedByName;
        delete updates.generationId;
        delete updates.generatedAt;
        delete updates.generatedByUserId;
        delete updates.generatedByName;
        delete updates.claimFormat;
        delete updates.generationResult;
        delete updates.generatedTransactionRef;
        delete updates.submissionMethod;
        delete updates.routedAt;
        delete updates.printedAt;
        delete updates.mailedAt;
        delete updates.mailedByName;
        delete updates.mailMethod;
        delete updates.mailTrackingNumber;
      }
      const nextCoverageId = clean(payload.coverageId) || claim.coverageId || "";
      if (nextCoverageId) {
        const [coverage] = await db.select().from(patientCoverages).where(eq(patientCoverages.id, nextCoverageId)).limit(1);
        if (!coverage || coverage.patientId !== claim.patientId) {
          return Response.json({ error: "Selected coverage does not belong to this patient." }, { status: 400 });
        }
        updates.coverageId = nextCoverageId;
        const [plan] = await db.select().from(insurancePlans).where(eq(insurancePlans.id, coverage.planId)).limit(1);
        if (plan) updates.payerId = plan.payerId;
      }
      const previousWorkflow = deriveWorkflowStatus(claim);
      await db.update(claims).set(updates).where(eq(claims.id, id));
      await db.delete(claimLines).where(eq(claimLines.claimId, id));
      await db.insert(claimLines).values(nextLines);

      const changeScope = clean(payload.changeScope) === "claim_and_master" ? "claim_and_master" as const : "claim_only" as const;
      if (changeScope === "claim_and_master") {
        const patientUpdates: Partial<typeof patients.$inferInsert> = {};
        if (clean(payload.patientDateOfBirth)) patientUpdates.dateOfBirth = clean(payload.patientDateOfBirth);
        if (clean(payload.patientFirstName)) patientUpdates.firstName = clean(payload.patientFirstName);
        if (clean(payload.patientMiddleName)) patientUpdates.middleName = clean(payload.patientMiddleName);
        if (clean(payload.patientLastName)) patientUpdates.lastName = clean(payload.patientLastName);
        if (["male", "female", "unknown"].includes(clean(payload.patientSex))) patientUpdates.sex = clean(payload.patientSex) as "male" | "female" | "unknown";
        if (clean(payload.patientAddressLine1)) patientUpdates.addressLine1 = clean(payload.patientAddressLine1);
        if (clean(payload.patientCity)) patientUpdates.city = clean(payload.patientCity);
        if (clean(payload.patientState)) patientUpdates.state = clean(payload.patientState).toUpperCase();
        if (clean(payload.patientPostalCode)) patientUpdates.postalCode = clean(payload.patientPostalCode);
        if (Object.keys(patientUpdates).length) await db.update(patients).set(patientUpdates).where(eq(patients.id, claim.patientId));
        const masterCoverageId = nextCoverageId || claim.coverageId;
        if (masterCoverageId) {
          await db.update(patientCoverages).set({
            ...(clean(payload.memberId) ? { memberId: clean(payload.memberId) } : {}),
            ...(clean(payload.groupNumber) ? { groupNumber: clean(payload.groupNumber) } : {}),
            ...(clean(payload.relationship) ? { relationship: clean(payload.relationship) } : {}),
            ...(clean(payload.subscriberFirstName) ? { subscriberFirstName: clean(payload.subscriberFirstName) } : {}),
            ...(clean(payload.subscriberLastName) ? { subscriberLastName: clean(payload.subscriberLastName) } : {}),
            ...(clean(payload.subscriberDateOfBirth) ? { subscriberDateOfBirth: clean(payload.subscriberDateOfBirth) } : {}),
            ...(clean(payload.subscriberSex) ? { subscriberSex: clean(payload.subscriberSex) } : {}),
            ...(clean(payload.subscriberAddressLine1) ? { subscriberAddressLine1: clean(payload.subscriberAddressLine1) } : {}),
            ...(clean(payload.subscriberCity) ? { subscriberCity: clean(payload.subscriberCity) } : {}),
            ...(clean(payload.subscriberState) ? { subscriberState: clean(payload.subscriberState).toUpperCase() } : {}),
            ...(clean(payload.subscriberPostalCode) ? { subscriberPostalCode: clean(payload.subscriberPostalCode) } : {}),
            ...(clean(payload.acceptAssignment) ? { acceptAssignment: clean(payload.acceptAssignment) === "N" ? "no" as const : "yes" as const } : {}),
            updatedAt: now,
          }).where(eq(patientCoverages.id, masterCoverageId));
        }
      }
      const [savedClaim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      const savedLines = await db.select().from(claimLines).where(eq(claimLines.claimId, id)).orderBy(asc(claimLines.lineNumber));
      await db.insert(claimCorrectionHistory).values({
        id: crypto.randomUUID(),
        claimId: id,
        action: correctionAction,
        changeScope,
        reason: clean(payload.reason) || null,
        beforeSnapshot,
        afterSnapshot: JSON.stringify({ claim: savedClaim, lines: savedLines }),
        changedByUserId: currentUser.id,
        changedByName: currentUser.fullName,
      });
      await recordClaimWorkflowEvent(db, {
        claimId: id,
        previousStatus: previousWorkflow,
        newStatus: followUpSave ? previousWorkflow : "needs_scrub",
        action: followUpSave ? "Follow-up Corrected" : previousWorkflow === "ready_to_bill" || previousWorkflow === "generated" ? "Scrub Invalidated" : "Error Corrected",
        reason: clean(payload.reason) || (followUpSave ? "Follow-up corrections saved on this claim; not resubmitted" : "Claim modified; previous scrub result cleared"),
        actorUserId: currentUser.id,
        actorName: currentUser.fullName,
      });
      return Response.json({
        id,
        status: followUpSave ? savedClaim.status : "draft",
        workflowStatus: followUpSave ? savedClaim.workflowStatus : "needs_scrub",
        correctionAction,
        totalCharge,
        changedAt: now,
        followUpSave,
      });
    }

    if (action === "routeClaim") {
      const id = clean(payload.id);
      const method = clean(payload.method);
      if (!['electronic', 'paper', 'hold'].includes(method)) {
        return Response.json({ error: "Select electronic, paper, or hold routing." }, { status: 400 });
      }
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.scrubberStatus !== "clean" || deriveWorkflowStatus(claim) !== "ready_to_bill") {
        return Response.json({ error: "Only Clean claims can be routed." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const generationId = method === "hold" ? claim.generationId : (claim.generationId || `ROUTE${Date.now().toString().slice(-8)}`);
      await db.update(claims).set({
        submissionMethod: method as "electronic" | "paper" | "hold",
        routedAt: now,
        ...(method === "hold" ? {
          workflowStatus: "ready_to_bill",
        } : {
          workflowStatus: "generated",
          generationId,
          generatedAt: claim.generatedAt || now,
          generatedByUserId: currentUser.id,
          generatedByName: currentUser.fullName,
          claimFormat: method === "paper" ? "CMS-1500" : "837P",
          generationResult: "success",
          generatedTransactionRef: claim.generatedTransactionRef || `${method}-${claim.claimNumber}-${generationId}`,
        }),
        ...(method === "paper" ? {} : {
          printedAt: null,
          mailedAt: null,
          mailedByName: null,
          mailMethod: null,
          mailTrackingNumber: null,
        }),
        updatedAt: now,
      }).where(eq(claims.id, id));
      if (method !== "hold") {
        await recordClaimWorkflowEvent(db, {
          claimId: id,
          previousStatus: "ready_to_bill",
          newStatus: "generated",
          action: "GENERATED",
          reason: `Routed to ${method} delivery`,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
        });
      }
      return Response.json({ id, submissionMethod: method, routedAt: now, workflowStatus: method === "hold" ? "ready_to_bill" : "generated" });
    }

    if (action === "markClaimPrinted") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.scrubberStatus !== "clean" || claim.submissionMethod !== "paper") {
        return Response.json({ error: "Route or generate an error-free paper claim before printing." }, { status: 409 });
      }
      if (!["generated", "ready_to_bill"].includes(deriveWorkflowStatus(claim))) {
        return Response.json({ error: "Only Clean or Generated paper claims can be printed." }, { status: 409 });
      }
      const now = new Date().toISOString();
      await db.update(claims).set({ printedAt: now, updatedAt: now }).where(eq(claims.id, id));
      return Response.json({ id, printedAt: now });
    }

    if (action === "markClaimMailed") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.scrubberStatus !== "clean" || claim.submissionMethod !== "paper") {
        return Response.json({ error: "Route an error-free claim to Paper before mailing." }, { status: 409 });
      }
      if (!claim.printedAt) {
        return Response.json({ error: "Print the CMS-1500 before marking the claim mailed." }, { status: 409 });
      }
      const mailMethod = clean(payload.mailMethod) || "usps_first_class";
      if (!["usps_first_class", "usps_certified", "courier", "other"].includes(mailMethod)) {
        return Response.json({ error: "Select a valid mail method." }, { status: 400 });
      }
      const now = new Date().toISOString();
      const sentStatus = lifecycleAfterSend(deriveClaimLifecycle(claim));
      await db.update(claims).set({
        status: "submitted",
        lifecycleStatus: sentStatus,
        workflowStatus: "submitted",
        submissionMode: "paper",
        mailedAt: now,
        mailedByName: currentUser.fullName,
        mailMethod,
        mailTrackingNumber: clean(payload.trackingNumber) || null,
        firstBilledDate: claim.firstBilledDate || today,
        lastBilledDate: today,
        updatedAt: now,
      }).where(eq(claims.id, id));
      await recordClaimWorkflowEvent(db, {
        claimId: id,
        previousStatus: deriveClaimLifecycle(claim),
        newStatus: sentStatus,
        action: "SUBMITTED",
        reason: `Paper claim mailed via ${mailMethod} · ${CLAIM_LIFECYCLE_LABELS[sentStatus]}`,
        actorUserId: currentUser.id,
        actorName: currentUser.fullName,
      });
      const [existingCharge] = await db
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(and(eq(ledgerTransactions.claimId, claim.id), eq(ledgerTransactions.transactionType, "charge")))
        .limit(1);
      if (!existingCharge) {
        await db.insert(ledgerTransactions).values({
          id: crypto.randomUUID(),
          organizationId: DEFAULT_ORGANIZATION_ID,
          patientId: claim.patientId,
          claimId: claim.id,
          transactionType: "charge",
          source: "Paper claim mailed",
          amount: claim.totalCharge,
          description: `${claim.claimNumber} professional claim`,
          referenceNumber: clean(payload.trackingNumber) || null,
          dateOfService: claim.dateOfService,
          transactionDate: claim.transactionDate,
          postingDate: claim.postingDate || today,
          firstBilledDate: claim.firstBilledDate || today,
          lastBilledDate: today,
        });
      }
      return Response.json({ id, status: "submitted", mailedAt: now, mailedByName: currentUser.fullName, mailMethod });
    }

    if (action === "rebillClaim") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      const currentLife = deriveClaimLifecycle(claim);
      const nextLife = lifecycleAfterFollowUpRebill(currentLife) || lifecycleAfterRebill(currentLife);
      if (!nextLife) return Response.json({ error: "This claim cannot be rebilled yet." }, { status: 409 });
      await writeClaimLifecycle(db, {
        claimId: id,
        previous: currentLife,
        next: nextLife,
        action: "REBILL",
        reason: `${CLAIM_LIFECYCLE_LABELS[currentLife]} → ${CLAIM_LIFECYCLE_LABELS[nextLife]}`,
        currentUser,
        reopenPrep: true,
      });
      return Response.json({ id, lifecycleStatus: nextLife, workflowStatus: "needs_scrub" });
    }

    if (action === "billClaimParty") {
      const id = clean(payload.id);
      const party = clean(payload.party);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (!["sec", "ter", "patient"].includes(party)) return Response.json({ error: "Select secondary, tertiary or patient." }, { status: 400 });
      const nextLife = billStatusForParty(party as "sec" | "ter" | "patient");
      const currentLife = deriveClaimLifecycle(claim);
      await writeClaimLifecycle(db, {
        claimId: id,
        previous: currentLife,
        next: nextLife,
        action: "BILL_PARTY",
        reason: `${CLAIM_LIFECYCLE_LABELS[currentLife]} → ${CLAIM_LIFECYCLE_LABELS[nextLife]}`,
        currentUser,
        reopenPrep: true,
      });
      return Response.json({ id, lifecycleStatus: nextLife, workflowStatus: "needs_scrub" });
    }

    if (action === "voidClaim") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      const currentLife = deriveClaimLifecycle(claim);
      if (currentLife === "closed" || currentLife === "voided") {
        return Response.json({ error: "This claim is already closed or voided." }, { status: 409 });
      }
      await writeClaimLifecycle(db, {
        claimId: id,
        previous: currentLife,
        next: "voided",
        action: "VOID",
        reason: clean(payload.reason) || "Claim voided",
        currentUser,
      });
      return Response.json({ id, lifecycleStatus: "voided" });
    }

    if (action === "addClaimNote") {
      const id = clean(payload.id);
      const note = clean(payload.note);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (!note) return Response.json({ error: "Enter a note." }, { status: 400 });
      await recordClaimWorkflowEvent(db, {
        claimId: id,
        previousStatus: deriveClaimLifecycle(claim),
        newStatus: deriveClaimLifecycle(claim),
        action: "NOTE",
        reason: note,
        actorUserId: currentUser.id,
        actorName: currentUser.fullName,
      });
      return Response.json({ id, saved: true });
    }

    if (action === "setClaimFollowUp") {
      const id = clean(payload.id);
      const followUp = clean(payload.followUpStatus);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (!["in_process", "denied"].includes(followUp)) return Response.json({ error: "Mark in process to pay or denied." }, { status: 400 });
      const currentLife = deriveClaimLifecycle(claim);
      if (followUp === "denied") {
        const nextLife = lifecycleAfterAdjudication({
          current: currentLife,
          denied: true,
          remaining: Number(claim.remainingBalance || 0),
          hasSecondary: false,
          hasTertiary: false,
        });
        await writeClaimLifecycle(db, {
          claimId: id,
          previous: currentLife,
          next: nextLife,
          action: "FOLLOW_UP",
          reason: "Follow-up: denied",
          currentUser,
          followUpStatus: "denied",
        });
        return Response.json({ id, lifecycleStatus: nextLife, followUpStatus: "denied" });
      }
      await db.update(claims).set({ followUpStatus: "in_process", updatedAt: new Date().toISOString() }).where(eq(claims.id, id));
      await recordClaimWorkflowEvent(db, {
        claimId: id,
        previousStatus: currentLife,
        newStatus: currentLife,
        action: "FOLLOW_UP",
        reason: "Follow-up: in process to pay",
        actorUserId: currentUser.id,
        actorName: currentUser.fullName,
      });
      return Response.json({ id, followUpStatus: "in_process" });
    }

    if (action === "scrubClaim") {
      const result = await scrubClaimRecord(db, clean(payload.id), currentUser);
      if ("error" in result && result.error) return Response.json({ error: result.error }, { status: 404 });
      return Response.json(result);
    }

    if (action === "generateClaims") {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((value) => clean(value)).filter(Boolean)
        : [clean(payload.id)].filter(Boolean);
      if (!ids.length) return Response.json({ error: "Select at least one Clean claim." }, { status: 400 });
      const forcedFormat = clean(payload.claimFormat);
      const results: Array<{ id: string; claimNumber: string; workflowStatus: string; generationId?: string; claimFormat?: string; deliveryChannel?: string; error?: string }> = [];
      for (const id of ids) {
        const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
        if (!claim) {
          results.push({ id, claimNumber: id, workflowStatus: "error", error: "Claim not found." });
          continue;
        }
        if (!claim.encounterId) {
          results.push({ id, claimNumber: claim.claimNumber, workflowStatus: deriveWorkflowStatus(claim), error: "Only EHR encounter claims can be generated from Claim prep." });
          continue;
        }
        if (deriveWorkflowStatus(claim) !== "ready_to_bill" || claim.scrubberStatus !== "clean") {
          results.push({ id, claimNumber: claim.claimNumber, workflowStatus: deriveWorkflowStatus(claim), error: "Only Clean claims can be generated." });
          continue;
        }
        const previousWorkflow = deriveWorkflowStatus(claim);
        const generatingAt = new Date().toISOString();
        await db.update(claims).set({ workflowStatus: "generating", updatedAt: generatingAt }).where(eq(claims.id, id));
        await recordClaimWorkflowEvent(db, {
          claimId: id,
          previousStatus: previousWorkflow,
          newStatus: "generating",
          action: "Generation Started",
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
        });

        const [[patient], [provider], payerRows, lines, coverageRows] = await Promise.all([
          db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
          db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
          claim.payerId ? db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1) : Promise.resolve([]),
          db.select().from(claimLines).where(eq(claimLines.claimId, id)),
          claim.coverageId ? db.select().from(patientCoverages).where(eq(patientCoverages.id, claim.coverageId)).limit(1) : Promise.resolve([]),
        ]);
        const deliveryChannel = deliveryChannelFromPayer(payerRows[0] || null);
        const claimFormat = forcedFormat === "CMS-1500" || forcedFormat === "837P"
          ? forcedFormat
          : claimFormatForChannel(deliveryChannel);
        let snapshot: Record<string, string> = {};
        try { snapshot = JSON.parse(claim.claimDataSnapshot || "{}") as Record<string, string>; } catch { snapshot = {}; }
        const finalIssues: ScrubIssue[] = [];
        if (!(patient?.dateOfBirth || snapshot.patientDateOfBirth)) {
          finalIssues.push(enrichScrubIssue({ severity: "error", field: "Patient DOB", box: "3", message: "Patient birth date is missing.", suggestion: "Complete demographics." }, generatingAt));
        }
        if (!(coverageRows[0]?.memberId || snapshot.memberId)) {
          finalIssues.push(enrichScrubIssue({ severity: "error", field: "Member ID", box: "1a", message: "Member ID is missing.", suggestion: "Add coverage." }, generatingAt));
        }
        if (!provider?.npi) finalIssues.push(enrichScrubIssue({ severity: "error", field: "Rendering NPI", box: "24J", message: "Rendering provider NPI is missing.", suggestion: "Complete provider NPI." }, generatingAt));
        if (!lines.length) finalIssues.push(enrichScrubIssue({ severity: "error", field: "Service lines", box: "24", message: "Claim has no service lines.", suggestion: "Add a procedure line." }, generatingAt));
        if (lines.some((line) => Number(line.chargeAmount) <= 0)) {
          finalIssues.push(enrichScrubIssue({ severity: "error", field: "Charges", box: "24F", message: "A service line has a zero charge.", suggestion: "Enter a valid charge." }, generatingAt));
        }
        if (finalIssues.some((issue) => issue.blocking)) {
          await db.update(claims).set({
            workflowStatus: "error",
            status: "scrub_error",
            scrubberStatus: "errors",
            scrubberMessages: JSON.stringify(finalIssues),
            scrubResult: "error",
            scrubErrorCount: String(finalIssues.filter((i) => i.blocking).length),
            lastScrubbedAt: generatingAt,
            scrubbedByUserId: currentUser.id,
            scrubbedByName: currentUser.fullName,
            updatedAt: generatingAt,
          }).where(eq(claims.id, id));
          await recordClaimWorkflowEvent(db, {
            claimId: id,
            previousStatus: "generating",
            newStatus: "error",
            action: "ERROR",
            reason: "Final validation failed before generation",
            errorInformation: JSON.stringify(finalIssues),
            actorUserId: currentUser.id,
            actorName: currentUser.fullName,
          });
          results.push({ id, claimNumber: claim.claimNumber, workflowStatus: "error", error: "Final validation failed." });
          continue;
        }

        const generationId = `GEN${Date.now().toString().slice(-8)}${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
        const generatedAt = new Date().toISOString();
        const transactionRef = claimFormat === "837P"
          ? `837-${claim.claimNumber}-${generationId}`
          : `CMS-${claim.claimNumber}-${generationId}`;
        let preview = "";
        if (claimFormat === "837P") {
          preview = claim837({ claim, patient, payer: payerRows[0] || null, provider, lines, coverage: coverageRows[0] || null });
        }
        await db.update(claims).set({
          workflowStatus: "generated",
          status: "ready",
          scrubberStatus: "clean",
          submissionMethod: claimFormat === "CMS-1500" ? "paper" : "electronic",
          routedAt: claim.routedAt || generatedAt,
          generationId,
          generatedAt,
          generatedByUserId: currentUser.id,
          generatedByName: currentUser.fullName,
          claimFormat,
          generationResult: "success",
          generatedTransactionRef: transactionRef,
          updatedAt: generatedAt,
        }).where(eq(claims.id, id));
        await recordClaimWorkflowEvent(db, {
          claimId: id,
          previousStatus: "generating",
          newStatus: "generated",
          action: "GENERATED",
          reason: `${claimFormat} generated · ${transactionRef}`,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
        });
        results.push({
          id,
          claimNumber: claim.claimNumber,
          workflowStatus: "generated",
          generationId,
          claimFormat,
          deliveryChannel,
          ...(preview ? { preview } : {}),
        } as { id: string; claimNumber: string; workflowStatus: string; generationId?: string; claimFormat?: string; deliveryChannel?: string; preview?: string });
      }
      const generated = results.filter((row) => row.workflowStatus === "generated").length;
      const failed = results.filter((row) => row.workflowStatus === "error").length;
      return Response.json({ generated, failed, results });
    }

    if (action === "createPayerBatches") {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((value) => clean(value)).filter(Boolean)
        : [];
      const readyClaims = (await db.select().from(claims).where(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID)))
        .filter((row) => {
          if (!row.encounterId || row.batchId) return false;
          const workflow = deriveWorkflowStatus(row);
          return (workflow === "ready_to_bill" || workflow === "generated") && row.scrubberStatus === "clean";
        });
      const selected = (ids.length ? readyClaims.filter((row) => ids.includes(row.id)) : readyClaims);
      if (!selected.length) {
        return Response.json({ error: "No unbatched Clean claims to group." }, { status: 409 });
      }

      const payerCache = new Map<string, typeof payers.$inferSelect | null>();
      const groups = new Map<string, { payerKey: string; payerIdentifier: string; batchType: "edi" | "paper"; claims: typeof selected }>();
      for (const claim of selected) {
        const payerKey = claim.payerId || "self_pay";
        if (claim.payerId && !payerCache.has(claim.payerId)) {
          const [payer] = await db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1);
          payerCache.set(claim.payerId, payer || null);
        } else if (!claim.payerId) {
          payerCache.set("self_pay", null);
        }
        const payer = claim.payerId ? payerCache.get(claim.payerId) || null : null;
        const batchType = batchTypeFromPayer(payer);
        const payerIdentifier = payer?.payerId || "SELF_PAY";
        const groupKey = payerBatchGroupingKey({ payerIdentifier, payerRecordId: payerKey, batchType });
        const group = groups.get(groupKey) || { payerKey, payerIdentifier, batchType, claims: [] as typeof selected };
        group.claims.push(claim);
        groups.set(groupKey, group);
      }

      const created: Array<{ id: string; batchNumber: string; batchType: string; claimCount: number; payerName: string }> = [];
      const now = new Date();
      const nowIso = now.toISOString();
      let sequence = 0;
      for (const group of groups.values()) {
        sequence += 1;
        const { payerKey, payerIdentifier, batchType, claims: groupClaims } = group;
        const payer = payerKey === "self_pay" ? null : payerCache.get(payerKey) || null;
        const payerName = payer?.name || "Self pay";
        const batchId = crypto.randomUUID();
        const batchNumber = `BAT${Date.now().toString().slice(-6)}${String(sequence).padStart(2, "0")}`;
        const totalCharge = groupClaims.reduce((sum, claim) => sum + Number(claim.totalCharge || 0), 0).toFixed(2);
        const names = buildBatchFileNames({ payerName, batchNumber, batchType, createdAt: now });

        let ediContent: string | null = null;
        if (batchType === "edi") {
          const segments: string[] = [];
          for (const claim of groupClaims) {
            const [[patient], [provider], lines, coverageRows] = await Promise.all([
              db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
              db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
              db.select().from(claimLines).where(eq(claimLines.claimId, claim.id)),
              claim.coverageId ? db.select().from(patientCoverages).where(eq(patientCoverages.id, claim.coverageId)).limit(1) : Promise.resolve([]),
            ]);
            if (!patient || !provider) continue;
            segments.push(claim837({
              claim,
              patient,
              payer,
              provider,
              lines,
              coverage: coverageRows[0] || null,
            }));
          }
          ediContent = segments.join("\n");
        }

        const proofContent = buildBatchProofText({
          batchNumber,
          payerName,
          payerIdentifier,
          batchType,
          claimCount: groupClaims.length,
          createdBy: currentUser.fullName,
          createdAt: nowIso,
          ediFileName: names.ediFileName,
          transmissionStatus: "generated",
        });

        await db.insert(claimBatches).values({
          id: batchId,
          organizationId: DEFAULT_ORGANIZATION_ID,
          batchNumber,
          payerId: payer?.id || null,
          batchType,
          status: "generated",
          claimCount: String(groupClaims.length),
          totalCharge,
          ediFileName: names.ediFileName,
          ediFilePath: names.ediFilePath,
          ediContent,
          proofFileName: names.proofFileName,
          proofFilePath: names.proofFilePath,
          proofContent,
          createdByUserId: currentUser.id,
          createdByName: currentUser.fullName,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        for (const claim of groupClaims) {
          await db.insert(claimBatchMembers).values({
            id: crypto.randomUUID(),
            batchId,
            claimId: claim.id,
          });
          await db.update(claims).set({
            batchId,
            workflowStatus: "generated",
            status: "ready",
            scrubberStatus: "clean",
            submissionMethod: batchType === "edi" ? "electronic" : "paper",
            claimFormat: batchType === "edi" ? "837P" : "CMS-1500",
            generationId: batchNumber,
            generatedAt: nowIso,
            generatedByUserId: currentUser.id,
            generatedByName: currentUser.fullName,
            generationResult: "success",
            generatedTransactionRef: names.ediFilePath || names.proofFilePath,
            updatedAt: nowIso,
          }).where(eq(claims.id, claim.id));
          await recordClaimWorkflowEvent(db, {
            claimId: claim.id,
            previousStatus: "ready_to_bill",
            newStatus: "generated",
            action: "Batched",
            reason: `Locked into ${batchNumber} (${batchType.toUpperCase()})`,
            actorUserId: currentUser.id,
            actorName: currentUser.fullName,
          });
        }

        created.push({
          id: batchId,
          batchNumber,
          batchType,
          claimCount: groupClaims.length,
          payerName,
        });
      }

      return Response.json({
        created: created.length,
        ediBatches: created.filter((row) => row.batchType === "edi").length,
        paperBatches: created.filter((row) => row.batchType === "paper").length,
        batches: created,
      }, { status: 201 });
    }

    if (action === "transmitClaimBatch") {
      const id = clean(payload.id);
      const [batch] = await db.select().from(claimBatches).where(eq(claimBatches.id, id)).limit(1);
      if (!batch) return Response.json({ error: "Batch not found." }, { status: 404 });
      if (batch.batchType !== "edi") {
        return Response.json({ error: "Only EDI batches are transmitted to the clearinghouse. Use paper print/mail for CMS-1500 batches." }, { status: 409 });
      }
      if (!["generated", "failed"].includes(batch.status)) {
        return Response.json({ error: "Batch must be generated before transmission." }, { status: 409 });
      }
      if (!batch.ediContent) {
        return Response.json({ error: "EDI file is missing for this batch." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const ack = `999*${batch.batchNumber}*A~277CA*ACCEPTED*${batch.claimCount}*TEST`;
      const proofContent = buildBatchProofText({
        batchNumber: batch.batchNumber,
        payerName: (await db.select().from(payers).where(eq(payers.id, batch.payerId || "")).limit(1))[0]?.name || "Self pay",
        batchType: "edi",
        claimCount: Number(batch.claimCount || 0),
        createdBy: batch.createdByName,
        createdAt: batch.createdAt,
        ediFileName: batch.ediFileName,
        transmissionStatus: "accepted",
        transmittedAt: now,
        clearinghouseResponse: ack,
      });
      await db.update(claimBatches).set({
        // The local clearinghouse adapter returns an immediate 999/277CA
        // acknowledgment, so the batch is recorded as accepted rather than
        // leaving it in an ambiguous "sent" state.
        status: "accepted",
        clearinghouseResponse: ack,
        transmittedAt: now,
        transmittedByName: currentUser.fullName,
        proofContent,
        updatedAt: now,
      }).where(eq(claimBatches.id, id));
      await db.insert(claimTransmissionLogs).values({
        id: crypto.randomUUID(),
        batchId: id,
        transmissionTime: now,
        clearinghouseResponse: ack,
        status: "accepted",
      });
      const members = await db.select().from(claimBatchMembers).where(eq(claimBatchMembers.batchId, id));
      for (const member of members) {
        const [claim] = await db.select().from(claims).where(eq(claims.id, member.claimId)).limit(1);
        if (!claim) continue;
        const sentStatus = lifecycleAfterSend(deriveClaimLifecycle(claim));
        await db.update(claims).set({
          status: "submitted",
          lifecycleStatus: sentStatus,
          workflowStatus: "submitted",
          clearinghouseTrace: `BATCH-${batch.batchNumber}`,
          firstBilledDate: claim.firstBilledDate || today,
          lastBilledDate: today,
          updatedAt: now,
        }).where(eq(claims.id, claim.id));
        await recordClaimWorkflowEvent(db, {
          claimId: claim.id,
          previousStatus: deriveClaimLifecycle(claim),
          newStatus: sentStatus,
          action: "SUBMITTED",
          reason: `Batch ${batch.batchNumber} transmitted · ${ack} · ${CLAIM_LIFECYCLE_LABELS[sentStatus]}`,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
        });
        const [existingCharge] = await db
          .select({ id: ledgerTransactions.id })
          .from(ledgerTransactions)
          .where(and(eq(ledgerTransactions.claimId, claim.id), eq(ledgerTransactions.transactionType, "charge")))
          .limit(1);
        if (!existingCharge) {
          await db.insert(ledgerTransactions).values({
            id: crypto.randomUUID(),
            organizationId: DEFAULT_ORGANIZATION_ID,
            patientId: claim.patientId,
            claimId: claim.id,
            transactionType: "charge",
            source: "Batch EDI transmission",
            amount: claim.totalCharge,
            description: `${claim.claimNumber} · ${batch.batchNumber}`,
            referenceNumber: batch.batchNumber,
            dateOfService: claim.dateOfService,
            transactionDate: claim.transactionDate,
            postingDate: claim.postingDate || today,
            firstBilledDate: claim.firstBilledDate || today,
            lastBilledDate: today,
          });
        }
      }
      return Response.json({ id, status: "accepted", clearinghouseResponse: ack, transmittedAt: now });
    }

    if (action === "markPaperBatchMailed") {
      const id = clean(payload.id);
      const [batch] = await db.select().from(claimBatches).where(eq(claimBatches.id, id)).limit(1);
      if (!batch) return Response.json({ error: "Batch not found." }, { status: 404 });
      if (batch.batchType !== "paper") {
        return Response.json({ error: "Only paper batches can be marked mailed." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const response = `PAPER_MAILED*${batch.batchNumber}*${clean(payload.mailMethod) || "usps_first_class"}`;
      const payerName = batch.payerId
        ? (await db.select().from(payers).where(eq(payers.id, batch.payerId)).limit(1))[0]?.name || "Self pay"
        : "Self pay";
      const proofContent = buildBatchProofText({
        batchNumber: batch.batchNumber,
        payerName,
        batchType: "paper",
        claimCount: Number(batch.claimCount || 0),
        createdBy: batch.createdByName,
        createdAt: batch.createdAt,
        transmissionStatus: "sent",
        transmittedAt: now,
        clearinghouseResponse: response,
      });
      await db.update(claimBatches).set({
        status: "sent",
        clearinghouseResponse: response,
        transmittedAt: now,
        transmittedByName: currentUser.fullName,
        proofContent,
        updatedAt: now,
      }).where(eq(claimBatches.id, id));
      await db.insert(claimTransmissionLogs).values({
        id: crypto.randomUUID(),
        batchId: id,
        transmissionTime: now,
        clearinghouseResponse: response,
        status: "sent",
      });
      const members = await db.select().from(claimBatchMembers).where(eq(claimBatchMembers.batchId, id));
      for (const member of members) {
        const [claim] = await db.select().from(claims).where(eq(claims.id, member.claimId)).limit(1);
        if (!claim) continue;
        const sentStatus = lifecycleAfterSend(deriveClaimLifecycle(claim));
        await db.update(claims).set({
          status: "submitted",
          lifecycleStatus: sentStatus,
          workflowStatus: "submitted",
          submissionMode: "paper",
          mailedAt: now,
          mailedByName: currentUser.fullName,
          mailMethod: clean(payload.mailMethod) || "usps_first_class",
          mailTrackingNumber: clean(payload.trackingNumber) || null,
          firstBilledDate: claim.firstBilledDate || today,
          lastBilledDate: today,
          updatedAt: now,
        }).where(eq(claims.id, claim.id));
      }
      return Response.json({ id, status: "sent", transmittedAt: now });
    }

    if (action === "downloadBatchFile") {
      const id = clean(payload.id);
      const requestedKind = clean(payload.kind);
      const kind = requestedKind === "proof" || requestedKind === "ackTxt" || requestedKind === "ackPdf" ? requestedKind : "edi";
      const [batch] = await db.select().from(claimBatches).where(eq(claimBatches.id, id)).limit(1);
      if (!batch) return Response.json({ error: "Batch not found." }, { status: 404 });
      if (kind === "ackTxt" || kind === "ackPdf") {
        if (!batch.clearinghouseResponse || !batch.transmittedAt) {
          return Response.json({ error: "No clearinghouse acknowledgment has been recorded for this batch." }, { status: 404 });
        }
        const payerName = batch.payerId
          ? (await db.select().from(payers).where(eq(payers.id, batch.payerId)).limit(1))[0]?.name || "Self pay"
          : "Self pay";
        const text = acknowledgmentText({
          batchNumber: batch.batchNumber,
          payerName,
          payerIdentifier: batch.payerId ? (await db.select().from(payers).where(eq(payers.id, batch.payerId)).limit(1))[0]?.payerId : null,
          claimCount: batch.claimCount,
          response: batch.clearinghouseResponse,
          transmittedAt: batch.transmittedAt,
          transmittedBy: batch.transmittedByName,
        });
        if (kind === "ackTxt") {
          return Response.json({ id, filename: `${batch.batchNumber}_ACK.txt`, content: text, acknowledgmentReference: acknowledgmentReference(batch.batchNumber, batch.clearinghouseResponse) });
        }
        return Response.json({
          id,
          filename: `${batch.batchNumber}_ACK.pdf`,
          base64: btoa(simplePdfFromText(text)),
          acknowledgmentReference: acknowledgmentReference(batch.batchNumber, batch.clearinghouseResponse),
        });
      }
      if (kind === "edi") {
        if (!batch.ediContent || !batch.ediFileName) {
          return Response.json({ error: "No EDI file on this batch." }, { status: 404 });
        }
        return Response.json({
          id,
          filename: batch.ediFileName,
          path: batch.ediFilePath,
          content: batch.ediContent,
        });
      }
      if (!batch.proofContent || !batch.proofFileName) {
        return Response.json({ error: "No proof file on this batch." }, { status: 404 });
      }
      return Response.json({
        id,
        filename: batch.proofFileName,
        path: batch.proofFilePath,
        content: batch.proofContent,
      });
    }

    if (action === "submitClaim" || action === "generate837") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.scrubberStatus !== "clean") return Response.json({ error: "Run the scrubber and resolve errors before submission." }, { status: 400 });
      const workflow = deriveWorkflowStatus(claim);
      if (!["generated", "ready_to_bill"].includes(workflow) && claim.submissionMethod === "unassigned") {
        return Response.json({ error: "Generate the claim from Clean before submission." }, { status: 409 });
      }
      if (claim.submissionMethod === "paper") return Response.json({ error: "Paper claims must be printed and mailed, not sent electronically." }, { status: 409 });
      if (workflow !== "generated" && workflow !== "ready_to_bill") {
        return Response.json({ error: "Only generated (or Clean) claims can be submitted." }, { status: 409 });
      }
      const [[patient], [provider], payerRows, lines, coverageRows] = await Promise.all([
        db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
        db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
        claim.payerId ? db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1) : Promise.resolve([]),
        db.select().from(claimLines).where(eq(claimLines.claimId, id)),
        claim.coverageId ? db.select().from(patientCoverages).where(eq(patientCoverages.id, claim.coverageId)).limit(1) : Promise.resolve([]),
      ]);
      const content = claim837({ claim, patient, payer: payerRows[0] || null, provider, lines, coverage: coverageRows[0] || null });
      if (action === "submitClaim") {
        const trace = `CH${Date.now()}`;
        const sentStatus = lifecycleAfterSend(deriveClaimLifecycle(claim));
        await db.update(claims).set({
          status: "submitted",
          lifecycleStatus: sentStatus,
          workflowStatus: "submitted",
          submissionMethod: "electronic",
          routedAt: claim.routedAt || new Date().toISOString(),
          submissionMode: clean(payload.mode) || "test",
          clearinghouseTrace: trace,
          firstBilledDate: claim.firstBilledDate || today,
          lastBilledDate: today,
          updatedAt: new Date().toISOString(),
        }).where(eq(claims.id, id));
        await recordClaimWorkflowEvent(db, {
          claimId: id,
          previousStatus: deriveClaimLifecycle(claim),
          newStatus: sentStatus,
          action: "SUBMITTED",
          reason: `Electronic submission · ${trace} · ${CLAIM_LIFECYCLE_LABELS[sentStatus]}`,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
        });
        const [existingCharge] = await db
          .select({ id: ledgerTransactions.id })
          .from(ledgerTransactions)
          .where(and(
            eq(ledgerTransactions.claimId, claim.id),
            eq(ledgerTransactions.transactionType, "charge"),
          ))
          .limit(1);
        if (!existingCharge) {
          await db.insert(ledgerTransactions).values({
            id: crypto.randomUUID(),
            organizationId: DEFAULT_ORGANIZATION_ID,
            patientId: claim.patientId,
            claimId: claim.id,
            transactionType: "charge",
            source: "Claim submission",
            amount: claim.totalCharge,
            description: `${claim.claimNumber} professional claim`,
            referenceNumber: trace,
            dateOfService: claim.dateOfService,
            transactionDate: claim.transactionDate,
            postingDate: claim.postingDate || today,
            firstBilledDate: claim.firstBilledDate || today,
            lastBilledDate: today,
          });
        }
        return Response.json({ id, trace, status: "submitted", preview: content });
      }
      return Response.json({ id, filename: `${claim.claimNumber}.837`, content });
    }

    if (action === "createPaymentEntry") {
      const payerType = clean(payload.payerType) || "payer";
      if (!["payer", "patient"].includes(payerType)) return Response.json({ error: "Select Payer or Patient." }, { status: 400 });
      const payerId = payerType === "payer" ? clean(payload.payerId) : null;
      const patientId = payerType === "patient" ? clean(payload.patientId) : null;
      const encounterId = payerType === "patient" ? clean(payload.encounterId) || null : null;
      const serviceDate = payerType === "patient" ? clean(payload.serviceDate) || null : null;
      const paymentPurpose = payerType === "patient" ? clean(payload.paymentPurpose) : null;
      if (payerType === "patient") {
        const [patient] = await db.select().from(patients).where(and(eq(patients.id, patientId || ""), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
        if (!patient) return Response.json({ error: "Select a patient from the search results." }, { status: 400 });
        if (!paymentPurpose || !["copay", "deductible", "coinsurance", "past_balance", "advance"].includes(paymentPurpose)) return Response.json({ error: "Select what the patient payment is for." }, { status: 400 });
        if (encounterId) {
          const [encounter] = await db.select().from(encounters).where(and(eq(encounters.id, encounterId), eq(encounters.patientId, patient.id))).limit(1);
          if (!encounter || (serviceDate && encounter.dateOfService.slice(0, 10) !== serviceDate)) return Response.json({ error: "Select a visit belonging to this patient and use its service date." }, { status: 400 });
          if (!serviceDate) return Response.json({ error: "The selected visit requires its service date." }, { status: 400 });
        } else if (paymentPurpose !== "advance") return Response.json({ error: "Choose the visit/DOS for this copay, deductible, coinsurance, or balance payment. Use Advance only for a payment without a visit yet." }, { status: 400 });
        if (clean(payload.remittanceId) || normalizePaymentMethod(payload.paymentMethod) === "ERA") return Response.json({ error: "Patient payments cannot be linked to an insurance ERA." }, { status: 400 });
      } else {
        const [payer] = await db.select().from(payers).where(and(eq(payers.id, payerId || ""), eq(payers.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
        if (!payer) return Response.json({ error: "Select a payer from the search results." }, { status: 400 });
      }
      const paymentAmount = money(payload.paymentAmount || payload.amount);
      const offsetAmount = money(payload.offsetAmount);
      const refundAmount = money(payload.refundAmount);
      const incentiveAmount = money(payload.incentiveAmount);
      const otherAdjustments = money(payload.otherAdjustments);
      const paymentTotalEffective = moneyFixed(calculatePaymentTotalEffective({
        paymentAmount,
        offsetAmount,
        refundAmount,
        incentiveAmount,
        otherAdjustments,
      }));
      if (moneyNumber(paymentAmount) <= 0 && moneyNumber(paymentTotalEffective) === 0) {
        return Response.json({ error: "Enter a payment amount or adjustment total greater than zero." }, { status: 400 });
      }
      const paymentMethod = normalizePaymentMethod(payload.paymentMethod);
      let methodDetails: string;
      try { methodDetails = JSON.stringify(paymentMethodDetails(paymentMethod, payload)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid payment method details." }, { status: 400 }); }
      const remittanceId = clean(payload.remittanceId) || null;
      if (remittanceId) {
        const [remittance] = await db.select().from(remittances).where(eq(remittances.id, remittanceId)).limit(1);
        if (!remittance) return Response.json({ error: "ERA remittance not found." }, { status: 404 });
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const paymentNumber = `PAY${Date.now().toString().slice(-8)}`;
      await db.insert(paymentEntries).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        paymentNumber,
        payerId,
        payerType,
        patientId,
        encounterId,
        serviceDate,
        paymentPurpose,
        remittanceId,
        paymentAmount,
        offsetAmount,
        refundAmount,
        incentiveAmount,
        otherAdjustments,
        paymentTotalEffective,
        paymentMethod,
        methodDetails,
        referenceNumber: clean(payload.referenceNumber || payload.checkNumber || payload.eftReference) || null,
        paymentDate: clean(payload.paymentDate) || today,
        postingDate: clean(payload.postingDate) || today,
        notes: clean(payload.notes) || null,
        paymentStatus: "pending",
        reconciliationStatus: "pending",
        claimCount: "0",
        postedClaimCount: "0",
        claimPaidTotal: "0.00",
        createdByUserId: currentUser.id,
        createdByName: currentUser.fullName,
        createdAt: now,
        updatedAt: now,
      });
      await recordPaymentLog(db, {
        paymentId: id,
        actionType: "Create",
        message: `Payment entry ${paymentNumber} created · ${paymentMethod} · amount ${paymentAmount} · effective ${paymentTotalEffective}${paymentPurpose ? ` · purpose ${paymentPurpose}` : ""}${serviceDate ? ` · DOS ${serviceDate} · encounter ${encounterId}` : ""}`,
      });
      return Response.json({ id, paymentNumber, paymentStatus: "pending", paymentTotalEffective }, { status: 201 });
    }

    if (action === "populatePaymentClaims") {
      const paymentId = clean(payload.id || payload.paymentId);
      const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      if (!payment) return Response.json({ error: "Payment entry not found." }, { status: 404 });
      if (payment.paymentStatus === "fully_posted") {
        return Response.json({ error: "Fully posted payments cannot be re-populated." }, { status: 409 });
      }
      if (normalizePaymentMethod(payment.paymentMethod) === "ERA") {
        return Response.json({ error: "ERA allocations come only from the uploaded 835. Review unmatched ERA claims or edit their CPT allocations; do not populate unrelated payer claims." }, { status: 409 });
      }
      if (payment.payerType === "patient" ? !payment.patientId : !payment.payerId) return Response.json({ error: "Payment has no selected payer or patient." }, { status: 400 });
      const claimIds = Array.isArray(payload.claimIds)
        ? payload.claimIds.map((value) => clean(value)).filter(Boolean)
        : [];
      if (!claimIds.length) return Response.json({ error: "Select the claims to add to this manual payment." }, { status: 400 });
      let candidateClaims = (await db.select().from(claims).where(and(
        eq(claims.organizationId, DEFAULT_ORGANIZATION_ID),
        payment.payerType === "patient" ? eq(claims.patientId, payment.patientId!) : eq(claims.payerId, payment.payerId!),
      ))).filter((row) => claimOutstandingBalance(row) > 0.009);
      if (payment.encounterId && payment.serviceDate) candidateClaims = candidateClaims.filter((row) => row.dateOfService.slice(0, 10) === payment.serviceDate);
      if (claimIds.length) {
        candidateClaims = candidateClaims.filter((row) => claimIds.includes(row.id));
      }
      if (!candidateClaims.length) {
        return Response.json({ error: "No open claims found for this payer to populate." }, { status: 409 });
      }
      const existing = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
      const existingClaimIds = new Set(existing.map((row) => row.claimId));
      const method = normalizePaymentMethod(payment.paymentMethod);
      let added = 0;
      const now = new Date().toISOString();
      for (const claim of candidateClaims) {
        if (existingClaimIds.has(claim.id)) continue;
        const seed = suggestClaimPaymentSeed({ method, claim });
        const claimPaymentId = crypto.randomUUID();
        await db.insert(claimPayments).values({
          id: claimPaymentId,
          paymentId,
          claimId: claim.id,
          allowedAmount: seed.allowedAmount,
          paidAmount: seed.paidAmount,
          adjustmentAmount: seed.adjustmentAmount,
          patientResponsibility: seed.patientResponsibility,
          denialCode: seed.denialCode,
          postingStatus: "pending",
          createdAt: now,
          updatedAt: now,
        });
        added += 1;
      }
      await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: null,
        errorMessage: null,
        hasMismatchError: false,
        clearPostedAt: true,
      });
      await recordPaymentLog(db, {
        paymentId,
        actionType: "Populate",
        message: isManualPaperEob(method)
          ? `Populated ${added} claim line(s) for manual Paper EOB entry.`
          : `Populated ${added} claim line(s) with suggested amounts from outstanding balances.`,
      });
      return Response.json({ id: paymentId, added, method });
    }

    if (action === "fixPaymentClaims") {
      const paymentId = clean(payload.id || payload.paymentId);
      const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      if (!payment) return Response.json({ error: "Payment entry not found." }, { status: 404 });
      if (payment.paymentStatus === "fully_posted") {
        return Response.json({ error: "Fully posted payments cannot be edited." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const hasHeaderPatch = ["paymentAmount", "offsetAmount", "refundAmount", "incentiveAmount", "otherAdjustments", "paymentDate", "postingDate", "notes"].some((key) => key in payload);
      if (hasHeaderPatch) {
        const paymentAmount = money(payload.paymentAmount ?? payment.paymentAmount);
        const offsetAmount = money(payload.offsetAmount ?? payment.offsetAmount);
        const refundAmount = money(payload.refundAmount ?? payment.refundAmount);
        const incentiveAmount = money(payload.incentiveAmount ?? payment.incentiveAmount);
        const otherAdjustments = money(payload.otherAdjustments ?? payment.otherAdjustments);
        const paymentTotalEffective = moneyFixed(calculatePaymentTotalEffective({
          paymentAmount,
          offsetAmount,
          refundAmount,
          incentiveAmount,
          otherAdjustments,
        }));
        await db.update(paymentEntries).set({
          paymentAmount,
          offsetAmount,
          refundAmount,
          incentiveAmount,
          otherAdjustments,
          paymentTotalEffective,
          paymentDate: clean(payload.paymentDate) || payment.paymentDate,
          postingDate: clean(payload.postingDate) || payment.postingDate,
          notes: "notes" in payload ? (clean(payload.notes) || null) : payment.notes,
          updatedAt: now,
        }).where(eq(paymentEntries.id, paymentId));
      }
      const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
      let updated = 0;
      for (const line of lines) {
        const lineId = clean(line.id);
        if (!lineId) continue;
        const [existing] = await db.select().from(claimPayments).where(and(
          eq(claimPayments.id, lineId),
          eq(claimPayments.paymentId, paymentId),
        )).limit(1);
        if (!existing || existing.postingStatus === "posted") continue;
        await db.update(claimPayments).set({
          allowedAmount: money(line.allowedAmount ?? existing.allowedAmount),
          paidAmount: money(line.paidAmount ?? existing.paidAmount),
          adjustmentAmount: money(line.adjustmentAmount ?? existing.adjustmentAmount),
          patientResponsibility: money(line.patientResponsibility ?? existing.patientResponsibility),
          denialCode: clean(line.denialCode) || null,
          postingStatus: "pending",
          errorMessage: null,
          updatedAt: now,
        }).where(eq(claimPayments.id, lineId));
        updated += 1;
      }
      const serviceLines = Array.isArray(payload.serviceLines) ? payload.serviceLines as Array<Record<string, unknown>> : [];
      let serviceUpdated = 0;
      for (const line of serviceLines) {
        const lineId = clean(line.id);
        if (!lineId) continue;
        const [existing] = await db.select().from(claimPaymentServiceLines).where(and(eq(claimPaymentServiceLines.id, lineId), eq(claimPaymentServiceLines.paymentId, paymentId))).limit(1);
        if (!existing || existing.postingStatus === "posted") continue;
        await db.update(claimPaymentServiceLines).set({
          allowedAmount: money(line.allowedAmount ?? existing.allowedAmount),
          paidAmount: money(line.paidAmount ?? existing.paidAmount),
          adjustmentAmount: money(line.adjustmentAmount ?? existing.adjustmentAmount),
          patientResponsibility: money(line.patientResponsibility ?? existing.patientResponsibility),
          denialCode: clean(line.denialCode) || null,
          eobPage: clean(line.eobPage) || null,
          nextAction: clean(line.nextAction) || null,
          updatedAt: now,
        }).where(eq(claimPaymentServiceLines.id, lineId));
        await syncClaimPaymentFromServiceLines(db, existing.claimPaymentId);
        serviceUpdated += 1;
      }
      if (!hasHeaderPatch && !lines.length && !serviceLines.length) {
        return Response.json({ error: "Provide payment adjustments or claim payment lines to update." }, { status: 400 });
      }
      await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: null,
        errorMessage: null,
        hasMismatchError: false,
        clearPostedAt: true,
      });
      await recordPaymentLog(db, {
        paymentId,
        actionType: "Correction",
        message: hasHeaderPatch
          ? `Corrected payment totals/adjustments, ${updated} claim payment line(s), and ${serviceUpdated} CPT line(s).`
          : `Corrected ${updated} claim payment line(s) and ${serviceUpdated} CPT line(s).`,
      });
      return Response.json({ id: paymentId, updated, serviceUpdated, headerUpdated: hasHeaderPatch });
    }

    if (action === "autoPostPayment" || action === "retryPostPayment") {
      const paymentId = clean(payload.id || payload.paymentId);
      const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      if (!payment) return Response.json({ error: "Payment entry not found." }, { status: 404 });
      if (payment.paymentStatus === "fully_posted") {
        return Response.json({ error: "Payment is already fully posted." }, { status: 409 });
      }
      if (normalizePaymentMethod(payment.paymentMethod) === "ERA") {
        const [era] = await db.select().from(remittances).where(eq(remittances.id, payment.remittanceId || "")).limit(1);
        const mappingError = era ? eraMappingError(era.unmatchedJson) : "Linked ERA not found. Review this payment before posting.";
        if (mappingError) return Response.json({ error: mappingError }, { status: 409 });
      }
      const lines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
      if (!lines.length) {
        return Response.json({ error: "Populate claim payments before auto-posting." }, { status: 409 });
      }
      for (const line of lines) await syncClaimPaymentFromServiceLines(db, line.id);
      const synchronizedLines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
      const validation = validatePaymentTotals({
        paymentAmount: payment.paymentAmount,
        offsetAmount: payment.offsetAmount,
        refundAmount: payment.refundAmount,
        incentiveAmount: payment.incentiveAmount,
        otherAdjustments: payment.otherAdjustments,
        paymentTotalEffective: payment.paymentTotalEffective,
        paymentMethod: payment.paymentMethod,
        claimPayments: synchronizedLines,
      });
      if (!validation.matched) {
        const now = new Date().toISOString();
        for (const line of lines) {
          if (line.postingStatus === "posted") continue;
          await db.update(claimPayments).set({
            postingStatus: "error",
            errorMessage: validation.mismatchMessage,
            updatedAt: now,
          }).where(eq(claimPayments.id, line.id));
        }
        await refreshPaymentEntryTotals(db, paymentId, {
          autoPostResult: "failed",
          errorMessage: validation.mismatchMessage,
          hasMismatchError: true,
          clearPostedAt: true,
        });
        await recordPaymentLog(db, {
          paymentId,
          actionType: "Error",
          message: validation.mismatchMessage || "Posted amounts do not match payment total.",
        });
        return Response.json({
          error: validation.mismatchMessage || "Posted amounts do not match payment total.",
          paymentTotalEffective: validation.paymentTotalEffective.toFixed(2),
          totalClaimsPosted: validation.totalClaimsPosted.toFixed(2),
          difference: validation.difference,
        }, { status: 409 });
      }

      const pending = synchronizedLines.filter((row) => row.postingStatus !== "posted");
      const preflightError = await preflightPaymentClaims(db, synchronizedLines);
      if (preflightError) return Response.json({ error: preflightError }, { status: 409 });
      const posted: string[] = [];
      const failed: Array<{ id: string; claimId: string; error: string }> = [];
      for (const line of pending) {
        const result = await applyClaimPaymentLine(db, {
          payment,
          line,
          today,
          sourceLabel: payment.paymentMethod === "ERA" ? "ERA payment entry" : "Payment entry auto-post",
        });
        if (!result.ok) {
          failed.push({ id: line.id, claimId: line.claimId, error: result.error });
          await db.update(claimPayments).set({
            postingStatus: "error",
            errorMessage: result.error,
            updatedAt: new Date().toISOString(),
          }).where(eq(claimPayments.id, line.id));
          await recordPaymentLog(db, {
            paymentId,
            claimId: line.claimId,
            actionType: "Error",
            message: result.error,
          });
        } else {
          posted.push(line.claimId);
          await recordPaymentLog(db, {
            paymentId,
            claimId: line.claimId,
            actionType: "AutoPost",
            message: `Auto-posted claim payment · remaining ${result.remaining}`,
          });
        }
      }

      if (failed.length) {
        await refreshPaymentEntryTotals(db, paymentId, {
          autoPostResult: "partial_error",
          errorMessage: `${failed.length} claim(s) failed during auto-post.`,
          hasMismatchError: false,
        });
        return Response.json({
          error: `${failed.length} claim(s) failed during auto-post.`,
          posted: posted.length,
          failed,
        }, { status: 409 });
      }

      const refreshed = await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: "success",
        errorMessage: null,
        hasMismatchError: false,
      });
      if (payment.remittanceId && refreshed.status === "fully_posted") {
        await db.update(remittances).set({
          status: "posted",
          postedAt: new Date().toISOString(),
        }).where(eq(remittances.id, payment.remittanceId));
      }
      await recordPaymentLog(db, {
        paymentId,
        actionType: "AutoPost",
        message: `Auto-post succeeded for ${posted.length} claim(s). Payment marked ${refreshed.status}.`,
      });
      return Response.json({
        id: paymentId,
        posted: posted.length,
        paymentStatus: refreshed.status,
        claimPaidTotal: refreshed.claimPaidTotal.toFixed(2),
      });
    }

    if (action === "manualPostClaimPayment") {
      const paymentId = clean(payload.id || payload.paymentId);
      const claimPaymentId = clean(payload.claimPaymentId || payload.lineId);
      const claimId = clean(payload.claimId);
      const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      if (!payment) return Response.json({ error: "Payment entry not found." }, { status: 404 });
      if (normalizePaymentMethod(payment.paymentMethod) === "ERA") {
        return Response.json({ error: "Use the ERA Post action so the entire remittance is validated before posting." }, { status: 409 });
      }
      const [line] = await db.select().from(claimPayments).where(and(
        eq(claimPayments.paymentId, paymentId),
        claimPaymentId ? eq(claimPayments.id, claimPaymentId) : eq(claimPayments.claimId, claimId),
      )).limit(1);
      if (!line) return Response.json({ error: "Claim payment line not found." }, { status: 404 });
      if (line.postingStatus === "posted") {
        return Response.json({ error: "This claim payment is already posted." }, { status: 409 });
      }
      if ("paidAmount" in payload || "adjustmentAmount" in payload || "allowedAmount" in payload || "patientResponsibility" in payload) {
        await db.update(claimPayments).set({
          allowedAmount: money(payload.allowedAmount ?? line.allowedAmount),
          paidAmount: money(payload.paidAmount ?? line.paidAmount),
          adjustmentAmount: money(payload.adjustmentAmount ?? line.adjustmentAmount),
          patientResponsibility: money(payload.patientResponsibility ?? line.patientResponsibility),
          denialCode: clean(payload.denialCode) || line.denialCode,
          updatedAt: new Date().toISOString(),
        }).where(eq(claimPayments.id, line.id));
      }
      const [freshLine] = await db.select().from(claimPayments).where(eq(claimPayments.id, line.id)).limit(1);
      const result = await applyClaimPaymentLine(db, {
        payment,
        line: freshLine || line,
        today,
        sourceLabel: "Paper EOB manual post",
      });
      if (!result.ok) {
        await db.update(claimPayments).set({
          postingStatus: "error",
          errorMessage: result.error,
          updatedAt: new Date().toISOString(),
        }).where(eq(claimPayments.id, line.id));
        await recordPaymentLog(db, {
          paymentId,
          claimId: line.claimId,
          actionType: "Error",
          message: result.error,
        });
        return Response.json({ error: result.error }, { status: 409 });
      }
      const refreshed = await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: "manual",
        errorMessage: null,
        hasMismatchError: false,
      });
      await recordPaymentLog(db, {
        paymentId,
        claimId: line.claimId,
        actionType: "ManualPost",
        message: `Manually posted claim payment · remaining ${result.remaining}`,
      });
      return Response.json({
        id: paymentId,
        claimId: line.claimId,
        paymentStatus: refreshed.status,
        remaining: result.remaining,
      });
    }

    if (action === "importEra") {
      const raw835 = clean(payload.raw835);
      const parsed = raw835 ? parseEra835(raw835) : null;
      const traceNumber = clean(payload.traceNumber)
        || parsed?.referenceNumber
        || `ERA${Date.now()}`;
      const amount = money(payload.amount || parsed?.paymentAmount || "0");
      const paymentDate = clean(payload.paymentDate) || parsed?.paymentDate || today;
      let payerId = clean(payload.payerId) || null;
      if (!payerId && parsed?.payerIdentifier) {
        const payerRows = await db.select().from(payers);
        payerId = payerRows.find((row) => row.payerId.toLowerCase() === parsed.payerIdentifier.toLowerCase())?.id || null;
      }
      if (!payerId && parsed?.payerName) {
        const payerRows = await db.select().from(payers);
        payerId = payerRows.find((row) => row.name.toLowerCase() === parsed.payerName.toLowerCase())?.id || null;
      }
      const id = crypto.randomUUID();
      const fileName = clean(payload.fileName) || `${traceNumber}.835`;
      await db.insert(remittances).values({
        id,
        payerId,
        traceNumber,
        paymentDate,
        postingDate: clean(payload.postingDate) || today,
        amount,
        source: clean(payload.source) || "835_file",
        status: "received",
        processedStatus: "pending",
        fileName,
        filePath: `era/${fileName}`,
        unmatchedJson: "[]",
        parseWarningsJson: JSON.stringify(parsed?.warnings || []),
        errorMessage: parsed && !parsed.ok ? parsed.error || null : null,
        raw835: raw835 || null,
      });
      return Response.json({
        id,
        traceNumber,
        processedStatus: "pending",
        parseOk: parsed?.ok ?? null,
        claimCount: parsed?.claims.length || 0,
      }, { status: 201 });
    }

    if (action === "seedEraClaims") {
      const eraId = clean(payload.id || payload.eraId || payload.remittanceId);
      const [era] = await db.select().from(remittances).where(eq(remittances.id, eraId)).limit(1);
      if (!era?.raw835) return Response.json({ error: "ERA file content was not found." }, { status: 404 });
      const parsed = parseEra835(era.raw835);
      if (!parsed.ok) return Response.json({ error: parsed.error || "ERA parse failed." }, { status: 409 });
      const payerId = era.payerId || (await db.select().from(payers)).find((row) => row.name.toLowerCase() === parsed.payerName.toLowerCase())?.id || null;
      const [provider] = await db.select().from(providers).where(eq(providers.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
      const [facility] = await db.select().from(facilities).where(eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
      if (!provider || !facility) return Response.json({ error: "A provider and facility are required to create sample claims." }, { status: 409 });
      // Build a small but realistic coverage set for the ERA fixtures. This lets
      // staff exercise secondary, patient-responsibility and pediatric-guarantor
      // routing without manually creating insurance records first.
      const payerRows = await db.select().from(payers).where(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID));
      const now = new Date().toISOString();
      const primaryPayer = payerId ? payerRows.find((row) => row.id === payerId) : payerRows[0];
      const secondaryPayer = payerRows.find((row) => row.payerId === "DEMO-SECONDARY-01") || (await (async () => {
        const createdPayerId = crypto.randomUUID();
        await db.insert(payers).values({ id: createdPayerId, organizationId: DEFAULT_ORGANIZATION_ID, name: "Demo Secondary Health Plan", payerId: "DEMO-SECONDARY-01", claimFilingIndicator: "CI", payerType: "Commercial", status: "active", responseDays: "14", createdAt: now });
        return (await db.select().from(payers).where(eq(payers.id, createdPayerId)).limit(1))[0];
      })());
      const ensurePlan = async (payer: typeof payers.$inferSelect, name: string) => {
        const [existingPlan] = await db.select().from(insurancePlans).where(and(eq(insurancePlans.payerId, payer.id), eq(insurancePlans.name, name))).limit(1);
        if (existingPlan) return existingPlan;
        const planId = crypto.randomUUID();
        await db.insert(insurancePlans).values({ id: planId, payerId: payer.id, name, planType: "PPO", defaultGroupNumber: "DEMO-GROUP", status: "active", createdAt: now });
        return (await db.select().from(insurancePlans).where(eq(insurancePlans.id, planId)).limit(1))[0];
      };
      const primaryPlan = primaryPayer ? await ensurePlan(primaryPayer, `${primaryPayer.name} Demo Plan`) : null;
      const secondaryPlan = secondaryPayer ? await ensurePlan(secondaryPayer, "Demo Secondary PPO") : null;
      const created: string[] = [];
      for (const [index, eraClaim] of parsed.claims.entries()) {
        const existing = await db.select().from(claims).where(and(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID), eq(claims.claimNumber, eraClaim.claimControlNumber))).limit(1);
        if (existing.length) {
          const existingClaim = existing[0];
          const existingPatient = (await db.select().from(patients).where(eq(patients.id, existingClaim.patientId)).limit(1))[0];
          if (existingPatient && existingPatient.addressLine1 === "ERA sample record") {
            const firstName = eraClaim.patientFirstName || existingPatient.firstName;
            const lastName = eraClaim.patientLastName || existingPatient.lastName;
            const dateOfBirth = index === parsed.claims.length - 1 ? "2016-04-18" : `19${String(70 + index).padStart(2, "0")}-0${(index % 8) + 1}-1${index + 1}`;
            const addressLine1 = `${120 + index} Demo Avenue`;
            const city = ["Orlando", "Tampa", "Jacksonville", "Miami"][index % 4];
            await db.update(patients).set({ firstName, lastName, dateOfBirth, addressLine1, city, state: "FL", postalCode: `3280${index + 1}`, phone: `407-555-${String(1200 + index)}`, email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z0-9]/gi, "")}@example.test`, updatedAt: now }).where(eq(patients.id, existingPatient.id));
          }
          if (existingPatient && primaryPlan) {
            const existingCoverage = await db.select().from(patientCoverages).where(eq(patientCoverages.patientId, existingPatient.id));
            const primaryCoverage = existingCoverage.find((row) => row.priority === "primary") || null;
            if (!primaryCoverage) {
              const coverageId = crypto.randomUUID();
              await db.insert(patientCoverages).values({ id: coverageId, patientId: existingPatient.id, planId: primaryPlan.id, coverageType: "health", priority: "primary", memberId: `ERA-${eraClaim.claimControlNumber}`, groupNumber: "ERA-DEMO-GROUP", relationship: "self", subscriberFirstName: existingPatient.firstName, subscriberLastName: existingPatient.lastName, subscriberDateOfBirth: existingPatient.dateOfBirth, subscriberSex: "unknown", effectiveDate: "2025-01-01", status: "active", createdAt: now });
              await db.update(claims).set({ coverageId, updatedAt: now }).where(eq(claims.id, existingClaim.id));
            }
            if (secondaryPlan && index % 2 === 0 && index !== parsed.claims.length - 1 && !existingCoverage.some((row) => row.priority === "secondary")) {
              await db.insert(patientCoverages).values({ id: crypto.randomUUID(), patientId: existingPatient.id, planId: secondaryPlan.id, coverageType: "health", priority: "secondary", memberId: `SEC-${eraClaim.claimControlNumber}`, groupNumber: "SEC-DEMO-GROUP", relationship: "self", subscriberFirstName: existingPatient.firstName, subscriberLastName: existingPatient.lastName, subscriberDateOfBirth: existingPatient.dateOfBirth, subscriberSex: "unknown", effectiveDate: "2025-01-01", status: "active", createdAt: now });
            }
          }
          if (era.paymentEntryId) {
            const existingClaimPayments = await db.select().from(claimPayments).where(and(eq(claimPayments.paymentId, era.paymentEntryId), eq(claimPayments.claimId, existingClaim.id)));
            const nextAction = await nextResponsibilityAction(db, existingClaim, payerId);
            for (const existingClaimPayment of existingClaimPayments) {
              await db.update(claimPaymentServiceLines).set({ nextAction, updatedAt: now }).where(eq(claimPaymentServiceLines.claimPaymentId, existingClaimPayment.id));
            }
          }
          continue;
        }
        const patientId = crypto.randomUUID();
        const claimId = crypto.randomUUID();
        const firstName = eraClaim.patientFirstName || "ERA";
        const lastName = eraClaim.patientLastName || `Claim ${eraClaim.claimControlNumber}`;
        // One fixture is pediatric so the guarantor route can be tested; the
        // remaining records use adult dates and distinct, recognizable addresses.
        const dateOfBirth = index === parsed.claims.length - 1 ? "2016-04-18" : `19${String(70 + index).padStart(2, "0")}-0${(index % 8) + 1}-1${index + 1}`;
        const addressLine1 = `${120 + index} Demo Avenue`;
        const city = ["Orlando", "Tampa", "Jacksonville", "Miami"][index % 4];
        const state = "FL";
        const postalCode = `3280${index + 1}`;
        await db.insert(patients).values({ id: patientId, organizationId: DEFAULT_ORGANIZATION_ID, accountNumber: `ERA-${eraClaim.claimControlNumber}`, firstName, lastName, dateOfBirth, sex: index === parsed.claims.length - 1 ? "unknown" : "unknown", addressLine1, city, state, postalCode, phone: `407-555-${String(1200 + index)}`, email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z0-9]/gi, "")}@example.test`, status: "active", createdAt: now, updatedAt: now });
        let primaryCoverageId: string | null = null;
        if (primaryPlan) {
          primaryCoverageId = crypto.randomUUID();
          await db.insert(patientCoverages).values({ id: primaryCoverageId, patientId, planId: primaryPlan.id, coverageType: "health", priority: "primary", memberId: `ERA-${eraClaim.claimControlNumber}`, groupNumber: "ERA-DEMO-GROUP", relationship: "self", subscriberFirstName: firstName, subscriberLastName: lastName, subscriberDateOfBirth: dateOfBirth, subscriberSex: "unknown", subscriberAddressLine1: addressLine1, subscriberCity: city, subscriberState: state, subscriberPostalCode: postalCode, effectiveDate: "2025-01-01", status: "active", createdAt: now });
        }
        // Alternating secondary coverage gives the demo both secondary billing
        // and direct patient-responsibility paths. The pediatric fixture is
        // intentionally left without secondary coverage so it routes to a guarantor.
        if (secondaryPlan && index % 2 === 0 && index !== parsed.claims.length - 1) {
          await db.insert(patientCoverages).values({ id: crypto.randomUUID(), patientId, planId: secondaryPlan.id, coverageType: "health", priority: "secondary", memberId: `SEC-${eraClaim.claimControlNumber}`, groupNumber: "SEC-DEMO-GROUP", relationship: "self", subscriberFirstName: firstName, subscriberLastName: lastName, subscriberDateOfBirth: dateOfBirth, subscriberSex: "unknown", subscriberAddressLine1: addressLine1, subscriberCity: city, subscriberState: state, subscriberPostalCode: postalCode, effectiveDate: "2025-01-01", status: "active", createdAt: now });
        }
        await db.insert(claims).values({ id: claimId, organizationId: DEFAULT_ORGANIZATION_ID, claimNumber: eraClaim.claimControlNumber, patientId, encounterId: null, coverageId: primaryCoverageId, payerId, providerId: provider.id, facilityId: facility.id, referringProviderId: null, insuranceTypeCode: "other", otherPlanIndicator: "N", employmentRelated: "N", autoAccidentRelated: "N", otherAccidentRelated: "N", claimConditionCodes: "[]", icdIndicator: "0", diagnosisCodes: "[]", claimDataSnapshot: JSON.stringify({ source: "ERA sample", eraTrace: era.traceNumber, fixture: "era_patient_responsibility_demo" }), dateOfService: eraClaim.dateOfService || era.paymentDate, transactionDate: today, postingDate: today, status: "ready", lifecycleStatus: "bill_to_pri", workflowStatus: "ready_to_bill", scrubberStatus: "passed", scrubberMessages: "[]", scrubRulesChecked: "[]", scrubErrorCount: "0", totalCharge: eraClaim.chargeAmount, totalPaid: "0.00", totalAdjustment: "0.00", patientResponsibility: eraClaim.patientResponsibility, remainingBalance: eraClaim.chargeAmount, submissionMode: "test", submissionMethod: "electronic", createdAt: now, updatedAt: now });
        for (const [lineIndex, service] of eraClaim.serviceLines.entries()) await db.insert(claimLines).values({ id: crypto.randomUUID(), claimId, lineNumber: String(lineIndex + 1), procedureCode: service.procedureCode, modifiers: null, diagnosisPointers: "[]", units: service.units, chargeAmount: service.chargeAmount, placeOfService: "11", renderingNpi: provider.npi || null, serviceDateFrom: service.serviceDate || eraClaim.dateOfService || era.paymentDate, serviceDateTo: service.serviceDate || eraClaim.dateOfService || era.paymentDate });
        created.push(eraClaim.claimControlNumber);
      }
      if (era.paymentEntryId) {
        const attached = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, era.paymentEntryId));
        if (!attached.length) {
          await db.delete(paymentLogs).where(eq(paymentLogs.paymentId, era.paymentEntryId));
          await db.delete(paymentEntries).where(eq(paymentEntries.id, era.paymentEntryId));
          await db.update(remittances).set({ paymentEntryId: null, processedStatus: "pending", status: "received", unmatchedJson: "[]", errorMessage: null, processedAt: null }).where(eq(remittances.id, eraId));
        }
      }
      return Response.json({ id: eraId, created: created.length, claimNumbers: created, message: `Created ${created.length} ERA sample claim(s). Re-upload or restart this ERA to match them.` });
    }

    if (action === "createEraTestVariant") {
      const eraId = clean(payload.id || payload.eraId || payload.remittanceId);
      const [sourceEra] = await db.select().from(remittances).where(eq(remittances.id, eraId)).limit(1);
      if (!sourceEra?.raw835) return Response.json({ error: "The saved ERA does not contain the original 835 content." }, { status: 404 });
      const variant = clean(payload.variant) || "denial";
      if (!["denial", "zero_check"].includes(variant)) return Response.json({ error: "Supported test variants are denial and zero_check." }, { status: 400 });
      const segmentDelimiter = sourceEra.raw835.includes("~") ? "~" : "\n";
      const variantStamp = Date.now().toString().slice(-6);
      const denialRaw835 = sourceEra.raw835.split(segmentDelimiter).map((segment) => {
        const parts = segment.trim().split("*");
        const tag = (parts[0] || "").toUpperCase();
        if (tag === "BPR" && variant === "zero_check") parts[2] = "0.00";
        if (tag === "BPR" && variant === "denial") parts[2] = "0.00";
        if (tag === "CLP" && variant === "denial") {
          parts[1] = `${parts[1] || "CLAIM"}-D${variantStamp}`; // force fresh demo claims instead of closed originals
          parts[2] = "4"; // denied claim status
          parts[4] = "0.00"; // no payer payment
          parts[5] = "0.00"; // no patient payment in the ERA
        }
        if (tag === "SVC" && variant === "denial") parts[3] = "0.00"; // zero paid at CPT level
        if (tag === "CAS" && variant === "denial") {
          // Preserve group/code pairs so denial codes remain visible, but make
          // the adjustment amount zero so the claim stays open for follow-up.
          for (let index = 3; index < parts.length; index += 3) {
            if (parts[index]) parts[index] = "0.00";
          }
        }
        return parts.join("*");
      }).filter(Boolean).join(segmentDelimiter);
      const now = new Date().toISOString();
      const traceNumber = `${sourceEra.traceNumber}-${variant.toUpperCase()}-${variantStamp}`;
      const fileName = sourceEra.fileName.replace(/(\.835|\.dat)?$/i, `-${variant}-test.835`);
      const parsed = parseEra835(denialRaw835);
      const id = crypto.randomUUID();
      await db.insert(remittances).values({
        id,
        payerId: sourceEra.payerId,
        traceNumber,
        paymentDate: sourceEra.paymentDate,
        postingDate: today,
        amount: "0.00",
        source: "835_test_variant",
        status: "received",
        processedStatus: "pending",
        fileName,
        filePath: `era/${fileName}`,
        unmatchedJson: "[]",
        parseWarningsJson: JSON.stringify(parsed.ok ? parsed.warnings : [parsed.error || "Denial variant parse warning"]),
        errorMessage: null,
        raw835: denialRaw835,
        receivedAt: now,
      });
      return Response.json({ id, fileName, traceNumber, amount: "0.00", claimCount: parsed.ok ? parsed.claims.length : 0, message: "Denial test ERA copy created. The original ERA was not changed." }, { status: 201 });
    }

    if (action === "processEra" || action === "createPaymentFromEra") {
      const autoPostRequested = payload.autoPost !== false;
      const eraId = clean(payload.id || payload.eraId || payload.remittanceId);
      const [era] = await db.select().from(remittances).where(eq(remittances.id, eraId)).limit(1);
      if (!era) return Response.json({ error: "ERA file not found." }, { status: 404 });
      if (era.paymentEntryId) {
        const mappingError = eraMappingError(era.unmatchedJson);
        if (autoPostRequested && mappingError) return Response.json({ error: mappingError }, { status: 409 });
        if (!autoPostRequested) return Response.json({ error: "This ERA has already been started.", paymentEntryId: era.paymentEntryId }, { status: 409 });
        const [existingPayment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, era.paymentEntryId)).limit(1);
        if (!existingPayment) return Response.json({ error: "The ERA payment entry could not be found." }, { status: 409 });
        const existingLines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, existingPayment.id));
        if (!existingLines.length) return Response.json({ error: "Populate claim payments before processing this ERA." }, { status: 409 });
        for (const line of existingLines) await syncClaimPaymentFromServiceLines(db, line.id);
        const synchronizedLines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, existingPayment.id));
        await refreshPaymentEntryTotals(db, existingPayment.id, { clearPostedAt: true });
        const [validationPayment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, existingPayment.id)).limit(1);
        const validation = validatePaymentTotals({
          paymentAmount: validationPayment?.paymentAmount || existingPayment.paymentAmount,
          offsetAmount: validationPayment?.offsetAmount || existingPayment.offsetAmount,
          refundAmount: validationPayment?.refundAmount || existingPayment.refundAmount,
          incentiveAmount: validationPayment?.incentiveAmount || existingPayment.incentiveAmount,
          otherAdjustments: validationPayment?.otherAdjustments || existingPayment.otherAdjustments,
          paymentTotalEffective: validationPayment?.paymentTotalEffective || existingPayment.paymentTotalEffective,
          paymentMethod: validationPayment?.paymentMethod || existingPayment.paymentMethod,
          claimPayments: synchronizedLines,
        });
        if (!validation.matched) {
          await refreshPaymentEntryTotals(db, existingPayment.id, { autoPostResult: "failed", errorMessage: validation.mismatchMessage, hasMismatchError: true, clearPostedAt: true });
          await db.update(remittances).set({ status: "review", errorMessage: validation.mismatchMessage }).where(eq(remittances.id, eraId));
          return Response.json({ error: validation.mismatchMessage || "ERA payment total does not match allocated claim amounts.", paymentEntryId: existingPayment.id, difference: validation.difference }, { status: 409 });
        }
        let posted = 0;
        const preflightError = await preflightPaymentClaims(db, synchronizedLines);
        if (preflightError) return Response.json({ error: preflightError }, { status: 409 });
        let postError: string | null = null;
        for (const line of synchronizedLines.filter((row) => row.postingStatus !== "posted")) {
          const result = await applyClaimPaymentLine(db, { payment: existingPayment, line, today, sourceLabel: "ERA 835 auto-post" });
          if (!result.ok) { postError = result.error; break; }
          posted += 1;
        }
        const refreshed = await refreshPaymentEntryTotals(db, existingPayment.id, { autoPostResult: postError ? "partial_error" : "success", errorMessage: postError, hasMismatchError: false });
        if (!postError && refreshed.status === "fully_posted") {
          await db.update(remittances).set({ status: "posted", postedAt: new Date().toISOString(), errorMessage: null }).where(eq(remittances.id, eraId));
        } else if (postError) {
          await db.update(remittances).set({ status: "review", errorMessage: postError }).where(eq(remittances.id, eraId));
        }
        await recordPaymentLog(db, { paymentId: existingPayment.id, actionType: postError ? "Error" : "AutoPost", message: postError || `ERA finalized · ${posted} claim(s) posted.` });
        return Response.json({ id: eraId, paymentEntryId: existingPayment.id, paymentNumber: existingPayment.paymentNumber, matched: synchronizedLines.length, unmatched: 0, autoPosted: posted, started: false, autoPostError: postError, reconciliationStatus: refreshed.status });
      }
      if (!era.raw835) {
        await db.update(remittances).set({
          processedStatus: "error",
          errorMessage: "ERA has no 835 content to parse.",
        }).where(eq(remittances.id, eraId));
        return Response.json({ error: "ERA has no 835 content to parse. Re-import with file content." }, { status: 409 });
      }
      const parsed = parseEra835(era.raw835);
      if (!parsed.ok) {
        await db.update(remittances).set({
          processedStatus: "error",
          errorMessage: parsed.error || "ERA parse failed.",
          parseWarningsJson: JSON.stringify(parsed.warnings || []),
        }).where(eq(remittances.id, eraId));
        return Response.json({ error: parsed.error || "ERA parse failed.", warnings: parsed.warnings }, { status: 409 });
      }

      let payerId = era.payerId;
      if (!payerId && parsed.payerIdentifier) {
        const payerRows = await db.select().from(payers);
        payerId = payerRows.find((row) => row.payerId.toLowerCase() === parsed.payerIdentifier.toLowerCase())?.id || null;
      }
      if (!payerId && parsed.payerName) {
        const payerRows = await db.select().from(payers);
        payerId = payerRows.find((row) => row.name.toLowerCase() === parsed.payerName.toLowerCase())?.id || null;
      }
      if (!payerId) {
        return Response.json({ error: "Select a payer on the ERA before processing, or include payer name in N1*PR." }, { status: 400 });
      }

      const paymentTotalEffective = moneyFixed(calculatePaymentTotalEffective({
        paymentAmount: parsed.paymentAmount,
        offsetAmount: parsed.offsetAmount,
        refundAmount: parsed.refundAmount,
        incentiveAmount: parsed.incentiveAmount,
        otherAdjustments: parsed.otherAdjustments,
      }));
      const paymentId = crypto.randomUUID();
      const now = new Date().toISOString();
      const paymentNumber = `PAY${Date.now().toString().slice(-8)}`;
      await db.insert(paymentEntries).values({
        id: paymentId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        paymentNumber,
        payerId,
        remittanceId: eraId,
        paymentAmount: parsed.paymentAmount,
        offsetAmount: parsed.offsetAmount,
        refundAmount: parsed.refundAmount,
        incentiveAmount: parsed.incentiveAmount,
        otherAdjustments: parsed.otherAdjustments,
        paymentTotalEffective,
        paymentMethod: "ERA",
        referenceNumber: parsed.referenceNumber || era.traceNumber,
        paymentDate: parsed.paymentDate || era.paymentDate,
        postingDate: era.postingDate || today,
        notes: `Auto-created from ERA ${era.traceNumber}`,
        paymentStatus: "pending",
        reconciliationStatus: "pending",
        claimCount: "0",
        postedClaimCount: "0",
        claimPaidTotal: "0.00",
        createdByUserId: currentUser.id,
        createdByName: currentUser.fullName,
        createdAt: now,
        updatedAt: now,
      });

      const unmatched: Array<{ claimControlNumber: string; reason: string; paidAmount: string; patientLastName?: string; patientFirstName?: string; dateOfService?: string; serviceLines?: unknown[] }> = [];
      let matched = 0;
      for (const eraClaim of parsed.claims) {
        const control = eraClaim.claimControlNumber;
        let claim = (await db.select().from(claims).where(and(
          eq(claims.organizationId, DEFAULT_ORGANIZATION_ID),
          eq(claims.claimNumber, control),
        )).limit(1))[0] as typeof claims.$inferSelect | undefined;
        if (!claim && control) {
          const candidates = await db.select().from(claims).where(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID));
          claim = candidates.find((row) => {
            const number = row.claimNumber.toLowerCase();
            const target = control.toLowerCase();
            return number === target || number.endsWith(target) || target.endsWith(number);
          });
        }
        // Many payers (including Oscar) return their own claim control number
        // instead of PRACX's claim number. Use patient name + DOS as a safe
        // secondary match, and leave ambiguous records in manual review.
        if (!claim && (eraClaim.patientLastName || eraClaim.patientFirstName) && eraClaim.dateOfService) {
          const candidates = await db.select().from(claims).where(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID));
          const patientRows = await db.select().from(patients);
          const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
          const last = normalized(eraClaim.patientLastName || "");
          const first = normalized(eraClaim.patientFirstName || "");
          const matches = candidates.filter((row) => {
            if (row.dateOfService !== eraClaim.dateOfService) return false;
            const person = patientRows.find((patient) => patient.id === row.patientId);
            if (!person) return false;
            return normalized(person.lastName) === last && (!first || normalized(person.firstName) === first);
          });
          if (matches.length === 1) claim = matches[0];
          else if (matches.length > 1) unmatched.push({ claimControlNumber: control, reason: "Multiple claims matched patient and service date", paidAmount: eraClaim.paidAmount, patientLastName: eraClaim.patientLastName, patientFirstName: eraClaim.patientFirstName, dateOfService: eraClaim.dateOfService, serviceLines: eraClaim.serviceLines });
        }
        if (!claim) {
          if (unmatched.some((row) => row.claimControlNumber === control)) continue;
          unmatched.push({
            claimControlNumber: control,
            reason: "Claim not found",
            paidAmount: eraClaim.paidAmount,
            patientLastName: eraClaim.patientLastName,
            patientFirstName: eraClaim.patientFirstName,
            dateOfService: eraClaim.dateOfService,
            serviceLines: eraClaim.serviceLines,
          });
          continue;
        }
        const claimPaymentId = crypto.randomUUID();
        await db.insert(claimPayments).values({
          id: claimPaymentId,
          paymentId,
          claimId: claim.id,
          allowedAmount: eraClaim.allowedAmount,
          paidAmount: eraClaim.paidAmount,
          adjustmentAmount: eraClaim.adjustmentAmount,
          patientResponsibility: eraClaim.patientResponsibility,
          adjustmentDetails: JSON.stringify({ adjustments: eraClaim.adjustments, unallocatedResponsibility: moneyFixed(moneyNumber(eraClaim.patientResponsibility) - eraClaim.serviceLines.reduce((sum, line) => sum + moneyNumber(line.patientResponsibility), 0)) }),
          denialCode: eraClaim.denialCodes.join(", ") || null,
          postingStatus: "pending",
          createdAt: now,
          updatedAt: now,
        });
        if (eraClaim.serviceLines.length) {
          const claimServiceLines = await db.select().from(claimLines).where(eq(claimLines.claimId, claim.id));
          const nextAction = await nextResponsibilityAction(db, claim, payerId);
          for (const service of eraClaim.serviceLines) {
            const matchingClaimLine = claimServiceLines.find((line) => line.procedureCode === service.procedureCode && line.serviceDateFrom === service.serviceDate);
            await db.insert(claimPaymentServiceLines).values({
              id: crypto.randomUUID(),
              paymentId,
              claimPaymentId,
              claimLineId: matchingClaimLine?.id || null,
              procedureCode: service.procedureCode,
              serviceDate: service.serviceDate,
              units: service.units,
              chargeAmount: service.chargeAmount,
              allowedAmount: service.allowedAmount,
              paidAmount: service.paidAmount,
              adjustmentAmount: service.adjustmentAmount,
              patientResponsibility: service.patientResponsibility,
              adjustmentDetails: JSON.stringify({ adjustments: service.adjustments }),
              denialCode: service.denialCodes.join(", ") || null,
              nextAction,
              postingStatus: "pending",
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        matched += 1;
      }

      const refreshed = await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: null,
        errorMessage: unmatched.length ? `${unmatched.length} unmatched ERA claim(s).` : null,
        hasMismatchError: false,
        clearPostedAt: true,
      });
      let autoPosted = 0;
      let autoPostError: string | null = null;
      // A fully matched ERA can be posted immediately. Any mismatch or
      // ambiguous claim stays editable in Pending/Errors for staff review.
      if (!unmatched.length && autoPostRequested) {
        const [freshPayment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
        const freshLines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
        const validation = freshPayment ? validatePaymentTotals({
          paymentAmount: freshPayment.paymentAmount,
          offsetAmount: freshPayment.offsetAmount,
          refundAmount: freshPayment.refundAmount,
          incentiveAmount: freshPayment.incentiveAmount,
          otherAdjustments: freshPayment.otherAdjustments,
          paymentTotalEffective: freshPayment.paymentTotalEffective,
          paymentMethod: freshPayment.paymentMethod,
          claimPayments: freshLines,
        }) : null;
        const preflightError = await preflightPaymentClaims(db, freshLines);
        if (!freshPayment || !validation?.matched || preflightError) {
          autoPostError = preflightError || validation?.mismatchMessage || "ERA payment could not be balanced for automatic posting.";
          await refreshPaymentEntryTotals(db, paymentId, { autoPostResult: "failed", errorMessage: autoPostError, hasMismatchError: true, clearPostedAt: true });
        } else {
          for (const line of freshLines) {
            const result = await applyClaimPaymentLine(db, { payment: freshPayment, line, today, sourceLabel: "ERA 835 auto-post" });
            if (!result.ok) { autoPostError = result.error; break; }
            autoPosted += 1;
          }
          await refreshPaymentEntryTotals(db, paymentId, {
            autoPostResult: autoPostError ? "partial_error" : "success",
            errorMessage: autoPostError,
            hasMismatchError: false,
          });
        }
      }
      await recordPaymentLog(db, {
        paymentId,
        actionType: "Populate",
        message: `ERA ${era.traceNumber} processed · ${matched} matched · ${unmatched.length} unmatched · ${autoPosted} auto-posted${autoPostError ? ` · ${autoPostError}` : ""}`,
      });
      await db.update(remittances).set({
        payerId,
        amount: parsed.paymentAmount,
        paymentDate: parsed.paymentDate || era.paymentDate,
        postingDate: era.postingDate || today,
        status: unmatched.length || autoPostError ? "review" : autoPostRequested && autoPosted === matched ? "posted" : "matched",
        processedStatus: "processed",
        paymentEntryId: paymentId,
        unmatchedJson: JSON.stringify(unmatched),
        parseWarningsJson: JSON.stringify(parsed.warnings || []),
        errorMessage: unmatched.length ? `${unmatched.length} unmatched claim(s)` : autoPostError,
        postedAt: autoPostRequested && !unmatched.length && !autoPostError && autoPosted === matched ? now : null,
        processedAt: now,
      }).where(eq(remittances.id, eraId));
      const [finalPayment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);

      return Response.json({
        id: eraId,
        paymentEntryId: paymentId,
        paymentNumber,
        matched,
        unmatched: unmatched.length,
        unmatchedClaims: unmatched,
        autoPosted,
        started: !autoPostRequested,
        autoPostError,
        reconciliationStatus: finalPayment?.reconciliationStatus || refreshed.status,
        warnings: parsed.warnings,
      });
    }

    if (action === "recalculatePayment") {
      const paymentId = clean(payload.id || payload.paymentId);
      const [payment] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      if (!payment) return Response.json({ error: "Payment entry not found." }, { status: 404 });
      const lines = await db.select().from(claimPayments).where(eq(claimPayments.paymentId, paymentId));
      const previous = buildReconciliationSnapshot({ ...payment, claimPayments: lines });
      const previousPosted = sumClaimPostedAmounts(lines);
      const previousDifference = Number((moneyNumber(previous.paymentTotalEffective) - previousPosted).toFixed(2));

      if ("paymentAmount" in payload || "offsetAmount" in payload || "refundAmount" in payload || "incentiveAmount" in payload || "otherAdjustments" in payload) {
        const paymentAmount = money(payload.paymentAmount ?? payment.paymentAmount);
        const offsetAmount = money(payload.offsetAmount ?? payment.offsetAmount);
        const refundAmount = money(payload.refundAmount ?? payment.refundAmount);
        const incentiveAmount = money(payload.incentiveAmount ?? payment.incentiveAmount);
        const otherAdjustments = money(payload.otherAdjustments ?? payment.otherAdjustments);
        await db.update(paymentEntries).set({
          paymentAmount,
          offsetAmount,
          refundAmount,
          incentiveAmount,
          otherAdjustments,
          paymentTotalEffective: moneyFixed(calculatePaymentTotalEffective({
            paymentAmount, offsetAmount, refundAmount, incentiveAmount, otherAdjustments,
          })),
          updatedAt: new Date().toISOString(),
        }).where(eq(paymentEntries.id, paymentId));
      }

      const refreshed = await refreshPaymentEntryTotals(db, paymentId, {
        autoPostResult: null,
        errorMessage: null,
        hasMismatchError: false,
      });
      const [fresh] = await db.select().from(paymentEntries).where(eq(paymentEntries.id, paymentId)).limit(1);
      const next = buildReconciliationSnapshot({
        ...(fresh || payment),
        claimPayments: refreshed.lines,
      });
      await db.insert(reconciliationLogs).values({
        id: crypto.randomUUID(),
        paymentId,
        previousTotalEffective: previous.paymentTotalEffective,
        previousTotalPosted: previousPosted.toFixed(2),
        previousDifference: previousDifference.toFixed(2),
        newTotalEffective: next.paymentTotalEffective,
        newTotalPosted: next.totalClaimsPosted,
        newDifference: next.difference,
        correctedByUserId: currentUser.id,
        correctedByName: currentUser.fullName,
        createdAt: new Date().toISOString(),
      });
      await recordPaymentLog(db, {
        paymentId,
        actionType: "Correction",
        message: `Recalculated · ${next.reconciliationStatus} · difference ${next.difference}`,
      });
      return Response.json({
        id: paymentId,
        ...next,
        autoPostAllowed: next.balanced,
      });
    }

    if (action === "postPayment") {
      const claimId = clean(payload.claimId);
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) return Response.json({ error: "Select a valid claim." }, { status: 400 });
      const amount = money(payload.amount);
      const adjustment = money(payload.adjustmentAmount);
      const amountNumber = Number(amount);
      const adjustmentNumber = Number(adjustment);
      const currentBalance = Math.max(
        0,
        Number(claim.totalCharge) - Number(claim.totalPaid) - Number(claim.totalAdjustment),
      );
      if (amountNumber < 0 || adjustmentNumber < 0 || amountNumber + adjustmentNumber <= 0) {
        return Response.json({ error: "Enter a positive payment or adjustment amount." }, { status: 400 });
      }
      if (amountNumber + adjustmentNumber > currentBalance + 0.001) {
        return Response.json({
          error: `Payment and adjustment exceed the remaining claim balance of ${currentBalance.toFixed(2)}.`,
        }, { status: 400 });
      }
      const remittanceId = clean(payload.remittanceId);
      if (remittanceId) {
        const [remittance] = await db.select().from(remittances).where(eq(remittances.id, remittanceId)).limit(1);
        if (!remittance) return Response.json({ error: "The selected ERA could not be found." }, { status: 400 });
        if (remittance.status === "posted") return Response.json({ error: "This ERA has already been posted." }, { status: 409 });
      }
      const paymentDate = clean(payload.paymentDate) || today;
      const postingDate = clean(payload.postingDate) || today;
      const paymentId = crypto.randomUUID();
      const paymentEntryId = crypto.randomUUID();
      const paymentNumber = `PAY-${paymentEntryId}`;
      await db.insert(paymentEntries).values({
        id: paymentEntryId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        paymentNumber,
        payerId: clean(payload.paymentType) === "patient" ? null : claim.payerId,
        payerType: clean(payload.paymentType) === "patient" ? "patient" : "payer",
        patientId: clean(payload.paymentType) === "patient" ? claim.patientId : null,
        remittanceId: remittanceId || null,
        paymentAmount: amount,
        paymentTotalEffective: amount,
        paymentMethod: remittanceId ? "ERA" : normalizePaymentMethod(payload.paymentMethod),
        referenceNumber: clean(payload.referenceNumber) || null,
        paymentDate,
        postingDate,
        paymentStatus: "fully_posted",
        reconciliationStatus: "balanced",
        claimCount: "1",
        postedClaimCount: "1",
        claimPaidTotal: amount,
        notes: clean(payload.paymentType) === "patient" ? "Patient payment collected against claim" : "Direct claim payment",
        createdByUserId: currentUser.id,
        createdByName: currentUser.fullName,
        postedAt: new Date().toISOString(),
      });
      await db.insert(claimPayments).values({
        id: crypto.randomUUID(),
        paymentId: paymentEntryId,
        claimId,
        paidAmount: amount,
        adjustmentAmount: adjustment,
        postingStatus: "posted",
        postedAt: new Date().toISOString(),
      });
      await db.insert(payments).values({
        id: paymentId,
        paymentEntryId,
        claimId,
        remittanceId: clean(payload.remittanceId) || null,
        paymentType: clean(payload.paymentType) || "insurance",
        payerName: clean(payload.payerName) || null,
        amount,
        adjustmentAmount: adjustment,
        adjustmentReason: clean(payload.adjustmentReason) || null,
        referenceNumber: clean(payload.referenceNumber) || null,
        transactionDate: today,
        paymentDate,
        postingDate,
      });
      const newPaid = Number(claim.totalPaid) + amountNumber;
      const newAdjustment = Number(claim.totalAdjustment) + adjustmentNumber;
      const remaining = Math.max(0, Number(claim.totalCharge) - newPaid - newAdjustment);
      await db.update(claims).set({
        totalPaid: newPaid.toFixed(2),
        totalAdjustment: newAdjustment.toFixed(2),
        patientResponsibility: remaining.toFixed(2),
        remainingBalance: remaining.toFixed(2),
        paymentDate,
        postingDate,
        status: remaining === 0 ? "paid" : amountNumber + adjustmentNumber > 0 ? "partially_paid" : claim.status,
        updatedAt: new Date().toISOString(),
      }).where(eq(claims.id, claimId));
      const ledgerBase = {
        paymentEntryId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        patientId: claim.patientId,
        claimId,
        source: clean(payload.remittanceId) ? "ERA 835" : "Manual posting",
        dateOfService: claim.dateOfService,
        transactionDate: today,
        paymentDate,
        postingDate,
        firstBilledDate: claim.firstBilledDate,
        lastBilledDate: claim.lastBilledDate,
      };
      await db.insert(ledgerTransactions).values({
        id: crypto.randomUUID(),
        ...ledgerBase,
        transactionType: clean(payload.paymentType) === "patient" ? "patient_payment" : "insurance_payment",
        amount: `-${amount}`,
        description: `${clean(payload.paymentType) || "Insurance"} payment`,
        referenceNumber: clean(payload.referenceNumber) || null,
      });
      if (Number(adjustment) > 0) {
        await db.insert(ledgerTransactions).values({
          id: crypto.randomUUID(),
          ...ledgerBase,
          transactionType: "adjustment",
          amount: `-${adjustment}`,
          description: clean(payload.adjustmentReason) || "Claim adjustment",
          referenceNumber: clean(payload.referenceNumber) || null,
        });
      }
      if (remittanceId) {
        const [remittance] = await db.select().from(remittances).where(eq(remittances.id, remittanceId)).limit(1);
        const appliedPayments = await db
          .select({ amount: payments.amount })
          .from(payments)
          .where(eq(payments.remittanceId, remittanceId));
        const appliedAmount = appliedPayments.reduce((sum, row) => sum + Number(row.amount), 0);
        const isFullyPosted = Boolean(remittance && appliedAmount + 0.001 >= Number(remittance.amount));
        await db.update(remittances).set({
          status: isFullyPosted ? "posted" : "matched",
          postedAt: isFullyPosted ? new Date().toISOString() : null,
        }).where(eq(remittances.id, remittanceId));
      }
      return Response.json({ id: paymentId, remaining: remaining.toFixed(2) }, { status: 201 });
    }

    if (action === "createReconsideration") {
      const claimId = clean(payload.claimId);
      if (!claimId || !clean(payload.reason)) return Response.json({ error: "Claim and reconsideration reason are required." }, { status: 400 });
      const id = crypto.randomUUID();
      const method = ["fax", "email", "portal", "mail"].includes(clean(payload.method)) ? clean(payload.method) as "fax" | "email" | "portal" | "mail" : "fax";
      const integrationType = method === "fax"
        ? "reconsideration_fax"
        : method === "email" ? "secure_email" : "";
      const [deliveryIntegration] = integrationType
        ? await db
          .select()
          .from(integrations)
          .where(and(
            eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
            eq(integrations.integrationType, integrationType),
          ))
          .limit(1)
        : [];
      const canSend = Boolean(
        clean(payload.destination)
        && payload.sendNow === true
        && deliveryIntegration?.mode === "live"
        && deliveryIntegration?.status === "active",
      );
      await db.insert(reconsiderations).values({
        id,
        claimId,
        method,
        destination: clean(payload.destination) || null,
        reason: clean(payload.reason),
        status: canSend ? "sent" : "ready",
        attachmentName: `${claimId}-reconsideration.pdf`,
        sentAt: canSend ? new Date().toISOString() : null,
      });
      await db.update(claims).set({ status: "appealed" }).where(eq(claims.id, claimId));
      return Response.json({ id, status: canSend ? "sent" : "ready" }, { status: 201 });
    }

    if (action === "resolveInboundEvent") {
      const id = clean(payload.id);
      const nextStatus = ["accepted", "rejected", "pending", "held"].includes(clean(payload.status))
        ? clean(payload.status) as "accepted" | "rejected" | "pending" | "held"
        : "";
      if (!id || !nextStatus) {
        return Response.json({ error: "Inbound event id and status are required." }, { status: 400 });
      }
      const [row] = await db.select().from(integrationInboundEvents).where(eq(integrationInboundEvents.id, id)).limit(1);
      if (!row) return Response.json({ error: "Inbound event not found." }, { status: 404 });
      const now = new Date().toISOString();
      if (nextStatus === "accepted") {
        const bundle = row.payloadJson ? safeJsonParse<EhrInboundBundleV1>(String(row.payloadJson)) : null;
        if (!bundle) {
          await db.update(integrationInboundEvents).set({
            status: "held",
            reasonCode: "missing_payload",
            reasonDetail: "Inbound event has no payload_json; cannot apply into PRACX.",
            resolvedAt: null,
            resolvedByName: null,
          }).where(eq(integrationInboundEvents.id, id));
          return Response.json({ error: "Inbound payload missing; event held." }, { status: 400 });
        }

        const applied = await applyInboundBundleToPracx(db, {
          inboundEventId: id,
          sourceSystem: String(row.sourceSystem || "unknown"),
          bundle,
          matchedPatientId: row.matchedPatientId,
          currentUser,
        });

        if ("error" in applied && applied.error) {
          await db.update(integrationInboundEvents).set({
            status: "held",
            reasonCode: "apply_failed",
            reasonDetail: applied.error,
            validationJson: JSON.stringify({ issues: applied.issues || [] }),
            resolvedAt: null,
            resolvedByName: null,
          }).where(eq(integrationInboundEvents.id, id));
          return Response.json({ error: applied.error, issues: applied.issues || [] }, { status: 400 });
        }

        await db.update(integrationInboundEvents).set({
          status: "accepted",
          reasonCode: null,
          reasonDetail: clean(payload.reasonDetail) || null,
          matchedPatientId: applied.patientId,
          appliedPatientId: applied.patientId,
          appliedCoverageId: applied.coverageId || null,
          appliedAppointmentId: applied.appointmentId || null,
          appliedEncounterId: applied.encounterId || null,
          appliedAt: now,
          validationJson: JSON.stringify({ issues: applied.issues || [] }),
          resolvedAt: now,
          resolvedByName: currentUser.fullName,
        }).where(eq(integrationInboundEvents.id, id));

        let queued: { id: string; claimNumber: string; created: boolean } | null = null;
        let scrub: Awaited<ReturnType<typeof scrubClaimRecord>> | null = null;
        if (applied.encounterId) {
          queued = await queueClaimFromEncounter(db, {
            encounterId: applied.encounterId,
            currentUser,
            today: dateOnly(),
          });
          if (queued?.id) {
            scrub = await scrubClaimRecord(db, queued.id, currentUser);
          }
        }

        return Response.json({
          id,
          status: "accepted",
          applied: {
            patientId: applied.patientId,
            coverageId: applied.coverageId || null,
            appointmentId: applied.appointmentId || null,
            encounterId: applied.encounterId || null,
            claimId: queued?.id || null,
            claimNumber: queued?.claimNumber || null,
          },
          scrub: scrub && !("error" in scrub && scrub.error)
            ? { status: scrub.status, workflowStatus: scrub.workflowStatus, scrubErrorCount: "scrubErrorCount" in scrub ? scrub.scrubErrorCount : 0 }
            : null,
          issues: applied.issues || [],
        });
      }

      await db.update(integrationInboundEvents).set({
        status: nextStatus,
        reasonDetail: clean(payload.reasonDetail) || row.reasonDetail,
        resolvedAt: nextStatus === "rejected" ? now : null,
        resolvedByName: nextStatus === "rejected" ? currentUser.fullName : null,
      }).where(eq(integrationInboundEvents.id, id));
      return Response.json({ id, status: nextStatus });
    }

    if (action === "testIntegrationConnection") {
      const id = clean(payload.id);
      const [row] = await db.select().from(integrations).where(and(
        eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(integrations.id, id),
      )).limit(1);
      if (!row) return Response.json({ error: "Integration not found." }, { status: 404 });

      const credentialKey = (env as Record<string, unknown>).INTEGRATION_CREDENTIAL_KEY as string | undefined;
      const result = await testConnection(db, { id: row.id, integrationType: row.integrationType }, credentialKey);

      await db.update(integrations).set({
        lastTestedAt: new Date().toISOString(),
        lastTestStatus: result.status,
        lastTestMessage: result.message,
      }).where(eq(integrations.id, row.id));

      return Response.json({ id: row.id, ...result });
    }

    if (action === "updateIntegration") {
      const integrationType = clean(payload.integrationType);
      const vendorName = clean(payload.vendorName);
      const mode = ["file", "test", "live"].includes(clean(payload.mode))
        ? clean(payload.mode) as "file" | "test" | "live"
        : "file";
      if (!integrationType || !vendorName) {
        return Response.json({ error: "Integration type and vendor name are required." }, { status: 400 });
      }

      const sourceSystem = clean(payload.sourceSystem).toLowerCase();
      if (sourceSystem && !/^[a-z0-9][a-z0-9_-]*$/.test(sourceSystem)) {
        return Response.json({ error: "Source system must be lowercase letters, numbers, hyphens or underscores." }, { status: 400 });
      }

      const editingId = clean(payload.id);
      const [existing] = editingId
        ? await db.select().from(integrations).where(and(
            eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
            eq(integrations.id, editingId),
          )).limit(1)
        : await db.select().from(integrations).where(and(
            eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
            eq(integrations.integrationType, integrationType),
          )).limit(1);

      if (sourceSystem) {
        const [clash] = await db
          .select({ id: integrations.id, vendorName: integrations.vendorName })
          .from(integrations)
          .where(and(
            eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
            sql`lower(${integrations.sourceSystem}) = ${sourceSystem}`,
          ))
          .limit(1);
        if (clash && clash.id !== existing?.id) {
          return Response.json(
            { error: `Source system "${sourceSystem}" is already routed to ${clash.vendorName}.` },
            { status: 409 },
          );
        }
      }

      const integrationId = existing?.id || crypto.randomUUID();
      const credentialKey = (env as Record<string, unknown>).INTEGRATION_CREDENTIAL_KEY as string | undefined;
      const submittedCredentials = (payload.credentials || {}) as Record<string, unknown>;

      if (existing) {
        await db.update(integrations).set({
          integrationType,
          vendorName,
          sourceSystem: sourceSystem || null,
          mode,
          endpoint: clean(payload.endpoint) || null,
        }).where(eq(integrations.id, existing.id));
      } else {
        await db.insert(integrations).values({
          id: integrationId,
          organizationId: DEFAULT_ORGANIZATION_ID,
          integrationType,
          vendorName,
          sourceSystem: sourceSystem || null,
          mode,
          endpoint: clean(payload.endpoint) || null,
          status: "needs_credentials",
        });
      }

      try {
        await saveCredentials(db, integrationId, integrationType, submittedCredentials, credentialKey);
      } catch (credentialError) {
        const message = credentialError instanceof Error ? credentialError.message : "Could not store credentials.";
        return Response.json({ error: message }, { status: 400 });
      }

      const missing = await missingRequiredCredentials(db, integrationId, integrationType);
      if (mode === "live" && missing.length) {
        await db.update(integrations).set({ mode: existing?.mode || "file", status: "needs_credentials" })
          .where(eq(integrations.id, integrationId));
        return Response.json(
          { error: `Live mode needs these credentials first: ${missing.join(", ")}.`, missing },
          { status: 400 },
        );
      }

      const status = mode === "live" ? "active" : missing.length ? "needs_credentials" : "configured";
      await db.update(integrations).set({ status }).where(eq(integrations.id, integrationId));

      return Response.json({ id: integrationId, status, missing }, { status: existing ? 200 : 201 });
    }

    return Response.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete operation.";
    const conflict = message.includes("UNIQUE constraint failed");
    return Response.json({ error: conflict ? "This record already exists." : message }, { status: conflict ? 409 : 500 });
  }
}
