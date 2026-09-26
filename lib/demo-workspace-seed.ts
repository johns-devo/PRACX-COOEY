/**
 * On-demand demo data for scheduler, clinical, claim prep, and payment posting.
 * Uses reserved `smp_*` ids (not `pat_demo_` / `apt_demo_`, which bootstrap deactivates).
 */

import { eq, inArray, like } from "drizzle-orm";
import type { getDb } from "../db";
import {
  appointments,
  billingResponsibilityProfiles,
  claimBatchMembers,
  claimTransmissionLogs,
  claimBatches,
  claimCorrectionHistory,
  claimLines,
  claimPayments,
  claimResponsibilitySnapshots,
  claimWorkflowEvents,
  clinicalOrders,
  clinicalOrderResults,
  claims,
  encounterEvents,
  encounters,
  eligibilityChecks,
  eligibilityUpdateHistory,
  insurancePlans,
  patientCoverages,
  patientDocuments,
  patients,
  paymentEntries,
  paymentLogs,
  payments,
  ledgerTransactions,
  reconsiderations,
  integrationSyncEvents,
  integrationInboundEvents,
  patientMedications,
  patientAllergies,
  patientFlowsheetEntries,
  payers,
  responsibilitySources,
  visitFlowEvents,
} from "../db/schema";
import { DEFAULT_ORGANIZATION_ID } from "./onboarding";
import { SCRUB_RULES_CHECKED } from "./claim-workflow";
import { deriveClaimLifecycle } from "./claim-lifecycle";
import { calculatePaymentTotalEffective, moneyFixed } from "./payment-posting";

type Db = ReturnType<typeof getDb>;

const PROVIDER_ID = "prv_maya_chen";
const FACILITY_ID = "fac_midtown";
const REFERRING_ID = "ref_adrian_cole";
const AETNA_PLAN = "plan_aetna_choice";
const MEDICARE_PLAN = "plan_medicare_partb";
const AETNA_PAYER = "pay_aetna";
const MEDICARE_PAYER = "pay_medicare";
const PAPER_PAYER = "pay_smp_paper";
const PAPER_PLAN = "plan_smp_paper";

function isoAt(dateKey: string, hour: number, minute = 0) {
  const stamp = new Date(`${dateKey}T00:00:00`);
  stamp.setHours(hour, minute, 0, 0);
  return stamp.toISOString();
}

function claimSnapshot(patient: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}, coverage: {
  memberId: string;
  groupNumber?: string | null;
  relationship: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  subscriberDateOfBirth?: string | null;
  subscriberSex?: string | null;
}) {
  return JSON.stringify({
    patientFirstName: patient.firstName,
    patientMiddleName: patient.middleName || "",
    patientLastName: patient.lastName,
    patientDateOfBirth: patient.dateOfBirth,
    patientSex: patient.sex,
    patientAddressLine1: patient.addressLine1,
    patientCity: patient.city,
    patientState: patient.state,
    patientPostalCode: patient.postalCode,
    memberId: coverage.memberId,
    groupNumber: coverage.groupNumber || "",
    relationship: coverage.relationship,
    subscriberFirstName: coverage.subscriberFirstName,
    subscriberLastName: coverage.subscriberLastName,
    subscriberDateOfBirth: coverage.subscriberDateOfBirth || "",
    subscriberSex: coverage.subscriberSex || "",
    acceptAssignment: "Y",
  });
}

async function clearExistingDemo(db: Db) {
  const batchIds = (await db.select({ id: claimBatches.id }).from(claimBatches).where(like(claimBatches.id, "smp_batch_%"))).map((row) => row.id);
  const paymentIds = (await db.select({ id: paymentEntries.id }).from(paymentEntries).where(like(paymentEntries.id, "smp_pay_%"))).map((row) => row.id);
  const appointmentIds = (await db.select({ id: appointments.id }).from(appointments).where(like(appointments.id, "smp_apt_%"))).map((row) => row.id);
  const encounterIds = (await db.select({ id: encounters.id }).from(encounters).where(like(encounters.id, "smp_enc_%"))).map((row) => row.id);
  const claimRows = await db.select({ id: claims.id, encounterId: claims.encounterId }).from(claims);
  const claimIds = claimRows.filter((row) => row.id.startsWith("smp_clm_") || (row.encounterId && encounterIds.includes(row.encounterId))).map((row) => row.id);
  const patientIds = (await db.select({ id: patients.id }).from(patients).where(like(patients.id, "smp_pat_%"))).map((row) => row.id);

  for (const paymentId of paymentIds) {
    await db.delete(paymentLogs).where(eq(paymentLogs.paymentId, paymentId));
    await db.delete(claimPayments).where(eq(claimPayments.paymentId, paymentId));
    await db.delete(paymentEntries).where(eq(paymentEntries.id, paymentId));
  }
  for (const batchId of batchIds) {
    await db.delete(claimTransmissionLogs).where(eq(claimTransmissionLogs.batchId, batchId));
    await db.delete(claimBatchMembers).where(eq(claimBatchMembers.batchId, batchId));
    await db.delete(claimBatches).where(eq(claimBatches.id, batchId));
  }
  for (const claimId of claimIds) {
    await db.delete(claimBatchMembers).where(eq(claimBatchMembers.claimId, claimId));
    await db.delete(paymentLogs).where(eq(paymentLogs.claimId, claimId));
    await db.delete(claimPayments).where(eq(claimPayments.claimId, claimId));
    await db.delete(payments).where(eq(payments.claimId, claimId));
    await db.delete(reconsiderations).where(eq(reconsiderations.claimId, claimId));
    await db.delete(integrationSyncEvents).where(eq(integrationSyncEvents.claimId, claimId));
    await db.delete(ledgerTransactions).where(eq(ledgerTransactions.claimId, claimId));
    await db.delete(claimCorrectionHistory).where(eq(claimCorrectionHistory.claimId, claimId));
    await db.delete(claimWorkflowEvents).where(eq(claimWorkflowEvents.claimId, claimId));
    await db.delete(claimLines).where(eq(claimLines.claimId, claimId));
    await db.delete(claimResponsibilitySnapshots).where(eq(claimResponsibilitySnapshots.claimId, claimId));
    await db.delete(claims).where(eq(claims.id, claimId));
  }
  for (const encounterId of encounterIds) {
    await db.delete(clinicalOrderResults).where(eq(clinicalOrderResults.encounterId, encounterId));
    await db.delete(clinicalOrders).where(eq(clinicalOrders.encounterId, encounterId));
    await db.delete(patientMedications).where(eq(patientMedications.encounterId, encounterId));
    await db.delete(patientAllergies).where(eq(patientAllergies.encounterId, encounterId));
    await db.delete(patientFlowsheetEntries).where(eq(patientFlowsheetEntries.encounterId, encounterId));
    await db.delete(integrationInboundEvents).where(eq(integrationInboundEvents.appliedEncounterId, encounterId));
    await db.delete(encounterEvents).where(eq(encounterEvents.encounterId, encounterId));
    await db.delete(encounters).where(eq(encounters.id, encounterId));
  }
  for (const appointmentId of appointmentIds) {
    await db.delete(visitFlowEvents).where(eq(visitFlowEvents.appointmentId, appointmentId));
    await db.delete(appointments).where(eq(appointments.id, appointmentId));
  }
  for (const patientId of patientIds) {
    const profiles = await db.select({ id: billingResponsibilityProfiles.id }).from(billingResponsibilityProfiles).where(eq(billingResponsibilityProfiles.patientId, patientId));
    for (const profile of profiles) {
      await db.delete(responsibilitySources).where(eq(responsibilitySources.profileId, profile.id));
      await db.delete(billingResponsibilityProfiles).where(eq(billingResponsibilityProfiles.id, profile.id));
    }
    const coverageIds = (await db.select({ id: patientCoverages.id }).from(patientCoverages).where(eq(patientCoverages.patientId, patientId))).map((row) => row.id);
    if (coverageIds.length) {
      await db.delete(eligibilityUpdateHistory).where(inArray(eligibilityUpdateHistory.coverageId, coverageIds));
      await db.delete(eligibilityChecks).where(inArray(eligibilityChecks.coverageId, coverageIds));
      await db.delete(patientDocuments).where(inArray(patientDocuments.coverageId, coverageIds));
    }
    await db.delete(patientCoverages).where(eq(patientCoverages.patientId, patientId));
    await db.delete(patients).where(eq(patients.id, patientId));
  }
  await db.delete(insurancePlans).where(eq(insurancePlans.id, PAPER_PLAN));
  await db.delete(payers).where(eq(payers.id, PAPER_PAYER));
}

export async function seedDemoWorkspace(
  db: Db,
  input: {
    currentUser: { id: string; fullName: string };
    today?: string;
  },
) {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  await clearExistingDemo(db);

  await db.insert(payers).values({
    id: PAPER_PAYER,
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: "Demo Paper Mutual",
    payerId: "PAPER01",
    eligibilityPayerId: "PAPER01",
    claimFilingIndicator: "CI",
    payerType: "Commercial",
    clearinghouseRoute: null,
    phone: "(800) 555-0199",
    responseDays: "12",
    status: "active",
  });
  await db.insert(insurancePlans).values({
    id: PAPER_PLAN,
    payerId: PAPER_PAYER,
    name: "Demo Paper PPO",
    planType: "PPO",
    defaultGroupNumber: "PAPGRP1",
    timelyFilingDays: "90",
    requiresReferral: "no",
    requiresAuthorization: "no",
    status: "active",
  });

  const samplePatients = [
    {
      id: "smp_pat_ava",
      account: "SMP1001",
      firstName: "Ava",
      middleName: "J",
      lastName: "Brooks",
      dob: "1991-03-12",
      sex: "female" as const,
      address: "220 Lexington Ave",
      city: "New York",
      state: "NY",
      zip: "10016",
      phone: "(212) 555-0101",
      email: "ava.brooks@example.test",
      planId: AETNA_PLAN,
      payerId: AETNA_PAYER,
      memberId: "SMPAVA1001",
      groupNumber: "GRP44591",
      coverageId: "smp_cov_ava",
    },
    {
      id: "smp_pat_liam",
      account: "SMP1002",
      firstName: "Liam",
      middleName: null,
      lastName: "Ortiz",
      dob: "1978-09-04",
      sex: "male" as const,
      address: "91 West End Ave",
      city: "New York",
      state: "NY",
      zip: "10023",
      phone: "(212) 555-0102",
      email: "liam.ortiz@example.test",
      planId: MEDICARE_PLAN,
      payerId: MEDICARE_PAYER,
      memberId: "1EG4SMPLIAM",
      groupNumber: null,
      coverageId: "smp_cov_liam",
    },
    {
      id: "smp_pat_mia",
      account: "SMP1003",
      firstName: "Mia",
      middleName: "R",
      lastName: "Nguyen",
      dob: "1988-12-21",
      sex: "female" as const,
      address: "44 Hudson St",
      city: "Hoboken",
      state: "NJ",
      zip: "07030",
      phone: "(201) 555-0103",
      email: "mia.nguyen@example.test",
      planId: PAPER_PLAN,
      payerId: PAPER_PAYER,
      memberId: "PAPMIA1003",
      groupNumber: "PAPGRP1",
      coverageId: "smp_cov_mia",
    },
    {
      id: "smp_pat_ethan",
      account: "SMP1004",
      firstName: "Ethan",
      middleName: null,
      lastName: "Patel",
      dob: "1965-06-30",
      sex: "male" as const,
      address: "18 Park Avenue South",
      city: "New York",
      state: "NY",
      zip: "10016",
      phone: "(646) 555-0104",
      email: "ethan.patel@example.test",
      planId: AETNA_PLAN,
      payerId: AETNA_PAYER,
      memberId: "SMPETH1004",
      groupNumber: "GRP44591",
      coverageId: "smp_cov_ethan",
    },
    {
      id: "smp_pat_sofia",
      account: "SMP1005",
      firstName: "Sofia",
      middleName: "L",
      lastName: "Reyes",
      dob: "1999-01-18",
      sex: "female" as const,
      address: "7 Riverside Blvd",
      city: "New York",
      state: "NY",
      zip: "10069",
      phone: "(917) 555-0105",
      email: "sofia.reyes@example.test",
      planId: AETNA_PLAN,
      payerId: AETNA_PAYER,
      memberId: "SMPSOF1005",
      groupNumber: "GRP44591",
      coverageId: "smp_cov_sofia",
    },
    {
      id: "smp_pat_noah",
      account: "SMP1006",
      firstName: "Noah",
      middleName: null,
      lastName: "Kim",
      dob: "1982-11-08",
      sex: "male" as const,
      address: "305 East 40th Street",
      city: "New York",
      state: "NY",
      zip: "10016",
      phone: "(212) 555-0106",
      email: "noah.kim@example.test",
      planId: MEDICARE_PLAN,
      payerId: MEDICARE_PAYER,
      memberId: "1EG4SMPNOAH",
      groupNumber: null,
      coverageId: "smp_cov_noah",
    },
  ] as const;

  for (const patient of samplePatients) {
    await db.insert(patients).values({
      id: patient.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      accountNumber: patient.account,
      firstName: patient.firstName,
      middleName: patient.middleName,
      lastName: patient.lastName,
      dateOfBirth: patient.dob,
      sex: patient.sex,
      addressLine1: patient.address,
      city: patient.city,
      state: patient.state,
      postalCode: patient.zip,
      phone: patient.phone,
      email: patient.email,
      maritalStatus: "single",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(patientCoverages).values({
      id: patient.coverageId,
      patientId: patient.id,
      planId: patient.planId,
      coverageType: "health",
      priority: "primary",
      memberId: patient.memberId,
      groupNumber: patient.groupNumber,
      relationship: "self",
      subscriberFirstName: patient.firstName,
      subscriberLastName: patient.lastName,
      subscriberDateOfBirth: patient.dob,
      subscriberSex: patient.sex,
      subscriberAddressLine1: patient.address,
      subscriberCity: patient.city,
      subscriberState: patient.state,
      subscriberPostalCode: patient.zip,
      effectiveDate: "2026-01-01",
      acceptAssignment: "yes",
      releaseOfInformation: "yes",
      assignmentOfBenefits: "yes",
      status: "active",
      createdAt: now,
    });
    const profileId = `smp_rsp_${patient.id.slice(8)}`;
    await db.insert(billingResponsibilityProfiles).values({
      id: profileId,
      patientId: patient.id,
      profileName: `${patient.firstName} ${patient.lastName} routine 2026`,
      billingContext: "routine",
      effectiveFrom: "2026-01-01",
      verificationStatus: "verified",
      guarantorType: "patient",
      guarantorName: `${patient.firstName} ${patient.lastName}`,
      patientBillingHold: "no",
      reason: "Sample workspace coverage profile.",
      status: "active",
    });
    await db.insert(responsibilitySources).values({
      id: `smp_rsrc_${patient.id.slice(8)}`,
      profileId,
      sequence: "1",
      role: "primary",
      sourceType: "insurance",
      coverageId: patient.coverageId,
      sourceName: "Primary sample coverage",
      activationCondition: "Bill first for routine services.",
      status: "ready",
    });
  }

  const byId = Object.fromEntries(samplePatients.map((row) => [row.id, row]));

  type FlowStatus = "not_arrived" | "arrived" | "checked_in" | "waiting" | "roomed" | "ready_for_provider" | "consultation_started" | "consultation_ended" | "checked_out";
  type AptStatus = "scheduled" | "confirmed" | "arrived" | "checked_in" | "in_room" | "completed" | "cancelled" | "no_show";

  type FlowDef = {
    id: string;
    patientId: string;
    hour: number;
    minute: number;
    type: string;
    reason: string;
    status: AptStatus;
    flow: FlowStatus;
    eligibility: string;
    room?: string;
  };

  const flowAppointments: FlowDef[] = [
    { id: "smp_apt_not_arrived", patientId: "smp_pat_sofia", hour: 9, minute: 0, type: "New patient", reason: "Annual physical", status: "scheduled", flow: "not_arrived", eligibility: "pending" },
    { id: "smp_apt_arrived", patientId: "smp_pat_ava", hour: 9, minute: 30, type: "Office visit", reason: "Hypertension follow-up", status: "arrived", flow: "arrived", eligibility: "eligible" },
    { id: "smp_apt_waiting", patientId: "smp_pat_liam", hour: 10, minute: 0, type: "Medicare AWV", reason: "Annual wellness", status: "checked_in", flow: "waiting", eligibility: "eligible", room: "Waiting" },
    { id: "smp_apt_roomed", patientId: "smp_pat_mia", hour: 10, minute: 30, type: "Office visit", reason: "Sinus congestion", status: "in_room", flow: "roomed", eligibility: "eligible", room: "Exam 2" },
    { id: "smp_apt_ready", patientId: "smp_pat_ethan", hour: 11, minute: 0, type: "Follow-up", reason: "Diabetes follow-up", status: "in_room", flow: "ready_for_provider", eligibility: "eligible", room: "Exam 3" },
    { id: "smp_apt_consult", patientId: "smp_pat_noah", hour: 11, minute: 30, type: "Office visit", reason: "Low back pain", status: "in_room", flow: "consultation_started", eligibility: "eligible", room: "Exam 1" },
    { id: "smp_apt_ended", patientId: "smp_pat_ava", hour: 13, minute: 0, type: "Follow-up", reason: "Medication review", status: "completed", flow: "consultation_ended", eligibility: "eligible", room: "Exam 4" },
    { id: "smp_apt_checkout", patientId: "smp_pat_liam", hour: 13, minute: 30, type: "Office visit", reason: "Post-lab review", status: "completed", flow: "checked_out", eligibility: "eligible", room: "Exam 2" },
    { id: "smp_apt_tomorrow", patientId: "smp_pat_mia", hour: 15, minute: 0, type: "Follow-up", reason: "Results review", status: "confirmed", flow: "not_arrived", eligibility: "pending" },
  ];

  const reached = (flow: FlowStatus, gate: FlowStatus) => {
    const order: FlowStatus[] = ["not_arrived", "arrived", "checked_in", "waiting", "roomed", "ready_for_provider", "consultation_started", "consultation_ended", "checked_out"];
    return order.indexOf(flow) >= order.indexOf(gate);
  };

  for (const apt of flowAppointments) {
    const startAt = isoAt(today, apt.hour, apt.minute);
    const endAt = isoAt(today, apt.hour, apt.minute + 30);
    await db.insert(appointments).values({
      id: apt.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      patientId: apt.patientId,
      providerId: PROVIDER_ID,
      facilityId: FACILITY_ID,
      startAt,
      endAt,
      appointmentType: apt.type,
      billingContext: "routine",
      reason: apt.reason,
      status: apt.status,
      eligibilityStatus: apt.eligibility,
      flowStatus: apt.flow,
      roomName: apt.room || null,
      flowStatusAt: now,
      arrivedAt: reached(apt.flow, "arrived") ? now : null,
      checkedInAt: reached(apt.flow, "waiting") || apt.flow === "checked_in" ? now : null,
      waitingAt: reached(apt.flow, "waiting") ? now : null,
      roomedAt: reached(apt.flow, "roomed") ? now : null,
      readyForProviderAt: reached(apt.flow, "ready_for_provider") ? now : null,
      consultationStartedAt: reached(apt.flow, "consultation_started") ? now : null,
      consultationEndedAt: reached(apt.flow, "consultation_ended") ? now : null,
      checkedOutAt: apt.flow === "checked_out" ? now : null,
      createdAt: now,
    });
    await db.insert(visitFlowEvents).values({
      id: `smp_flow_${apt.id}`,
      appointmentId: apt.id,
      fromStatus: "not_arrived",
      toStatus: apt.flow,
      roomName: apt.room || null,
      note: "Sample seed visit flow",
      changedByUserId: input.currentUser.id,
      changedByName: input.currentUser.fullName,
      occurredAt: now,
    });
  }

  type EncounterDef = {
    id: string;
    appointmentId?: string;
    patientId: string;
    status: "draft" | "signed" | "ready_to_bill" | "billed";
    dx: string[];
    px: string[];
    complaint: string;
    assessment: string;
  };

  const encounterDefs: EncounterDef[] = [
    {
      id: "smp_enc_draft",
      appointmentId: "smp_apt_roomed",
      patientId: "smp_pat_mia",
      status: "draft",
      dx: ["J06.9"],
      px: ["99213"],
      complaint: "Sinus congestion and facial pressure",
      assessment: "Acute upper respiratory infection; documentation in progress.",
    },
    {
      id: "smp_enc_ready_unclaimed",
      appointmentId: "smp_apt_checkout",
      patientId: "smp_pat_liam",
      status: "ready_to_bill",
      dx: ["E11.9", "I10"],
      px: ["99213"],
      complaint: "Diabetes and blood-pressure follow-up",
      assessment: "Type 2 diabetes mellitus without complications; essential hypertension.",
    },
    {
      id: "smp_enc_needs_scrub",
      appointmentId: "smp_apt_ended",
      patientId: "smp_pat_ava",
      status: "ready_to_bill",
      dx: ["I10"],
      px: ["99213"],
      complaint: "Hypertension follow-up",
      assessment: "Essential (primary) hypertension, stable on current therapy.",
    },
    {
      id: "smp_enc_errors",
      patientId: "smp_pat_ethan",
      status: "ready_to_bill",
      dx: [],
      px: ["99213"],
      complaint: "Medication refill visit",
      assessment: "Incomplete diagnosis list — sample scrub errors.",
    },
    {
      id: "smp_enc_ready",
      patientId: "smp_pat_sofia",
      status: "billed",
      dx: ["Z00.00"],
      px: ["G0439"],
      complaint: "Preventive visit",
      assessment: "Encounter for general adult medical examination without abnormal findings.",
    },
    {
      id: "smp_enc_edi",
      patientId: "smp_pat_noah",
      status: "billed",
      dx: ["M54.50"],
      px: ["99213"],
      complaint: "Low back pain",
      assessment: "Low back pain, unspecified.",
    },
    {
      id: "smp_enc_paper",
      patientId: "smp_pat_mia",
      status: "billed",
      dx: ["J01.90"],
      px: ["99213"],
      complaint: "Acute sinusitis",
      assessment: "Acute sinusitis, unspecified.",
    },
    {
      id: "smp_enc_submitted",
      patientId: "smp_pat_ava",
      status: "billed",
      dx: ["I10", "E78.5"],
      px: ["99213", "93000"],
      complaint: "Hypertension and lipids",
      assessment: "Essential hypertension; hyperlipidemia, unspecified.",
    },
  ];

  for (const enc of encounterDefs) {
    const signed = enc.status !== "draft";
    await db.insert(encounters).values({
      id: enc.id,
      appointmentId: enc.appointmentId || null,
      patientId: enc.patientId,
      providerId: PROVIDER_ID,
      facilityId: FACILITY_ID,
      referringProviderId: REFERRING_ID,
      dateOfService: today,
      billingContext: "routine",
      templateKey: "general_soap",
      subjectiveItemsJson: "[]",
      chiefComplaint: enc.complaint,
      historyOfPresentIllness: `${enc.complaint}. Interval history reviewed with the patient.`,
      reviewOfSystems: "Constitutional negative. Relevant systems reviewed and documented.",
      physicalExam: "General: alert, no acute distress. Focused exam documented.",
      assessment: enc.assessment,
      treatmentPlan: "Continue current plan; counseling provided; return precautions reviewed.",
      followUpInstructions: "Return in 3 months or sooner for worsening symptoms.",
      vitals: JSON.stringify({ bloodPressure: "128/78", pulse: "72", temperature: "98.4", weight: "162", height: "66" }),
      allergiesReviewed: "yes",
      medicationsReviewed: "yes",
      clinicalNote: `${enc.complaint}\n\nAssessment: ${enc.assessment}`,
      codingAssistJson: "{}",
      diagnosisCodes: JSON.stringify(enc.dx),
      procedureCodes: JSON.stringify(enc.px),
      status: enc.status,
      signedAt: signed ? now : null,
      signedByUserId: signed ? input.currentUser.id : null,
      signedByName: signed ? input.currentUser.fullName : null,
      readyToBillAt: enc.status === "ready_to_bill" || enc.status === "billed" ? now : null,
      lastSavedAt: now,
      createdAt: now,
    });
    await db.insert(encounterEvents).values({
      id: `smp_ee_${enc.id}`,
      encounterId: enc.id,
      action: enc.status === "draft" ? "created" : "ready_to_bill",
      statusFrom: "draft",
      statusTo: enc.status === "draft" ? "draft" : "ready_to_bill",
      changedByUserId: input.currentUser.id,
      changedByName: input.currentUser.fullName,
      occurredAt: now,
    });
  }

  const fullCmsFields = {
    insuranceTypeCode: "other",
    otherPlanIndicator: "N",
    employmentRelated: "N",
    autoAccidentRelated: "N",
    autoAccidentState: null as string | null,
    otherAccidentRelated: "N",
    claimConditionCodes: "[]",
    otherClaimIdQualifier: null as string | null,
    otherClaimId: null as string | null,
    conditionDateQualifier: "431",
    conditionDate: today,
    otherDateQualifier: "439",
    otherDate: today,
    referringProviderQualifier: "DN",
    referringOtherIdQualifier: "0B",
    referringOtherId: "298541",
    additionalClaimInfoQualifier: null as string | null,
    additionalClaimInfo: null as string | null,
    unableToWorkFrom: null as string | null,
    unableToWorkTo: null as string | null,
    hospitalizationFrom: null as string | null,
    hospitalizationTo: null as string | null,
    outsideLabIndicator: "N",
    outsideLabCharges: null as string | null,
    priorAuthorizationNumber: "AUTH-SMP-7781",
    federalTaxIdType: "EI",
    federalTaxIdNumber: "12-3456789",
    patientSignatureOnFile: "Y",
    patientSignatureDate: today,
    insuredSignatureOnFile: "Y",
    providerSignatureOnFile: "Y",
    providerSignatureDate: today,
    serviceFacilityOtherIdQualifier: "LU",
    serviceFacilityOtherId: "MIDTOWN",
    billingProviderOtherIdQualifier: "G2",
    billingProviderOtherId: "CHEN01",
    icdIndicator: "0",
  };

  type ClaimDef = {
    id: string;
    number: string;
    encounterId: string;
    patientId: string;
    coverageId: string;
    payerId: string;
    status: typeof claims.$inferInsert.status;
    workflow: typeof claims.$inferInsert.workflowStatus;
    scrub: string;
    method: "unassigned" | "electronic" | "paper";
    charge: string;
    dx: string[];
    lines: Array<{ code: string; charge: string; pointers: string }>;
    scrubMessages?: string;
    scrubResult?: string | null;
    scrubErrors?: string;
    batchId?: string | null;
    billed?: boolean;
    format?: string | null;
    paid?: string;
    adjustment?: string;
    pr?: string;
    remaining?: string;
  };

  const claimDefs: ClaimDef[] = [
    {
      id: "smp_clm_needs_scrub",
      number: "SMP-NEEDS-SCRUB",
      encounterId: "smp_enc_needs_scrub",
      patientId: "smp_pat_ava",
      coverageId: "smp_cov_ava",
      payerId: AETNA_PAYER,
      status: "draft",
      workflow: "needs_scrub",
      scrub: "not_run",
      method: "unassigned",
      charge: "145.00",
      dx: ["I10"],
      lines: [{ code: "99213", charge: "145.00", pointers: "A" }],
    },
    {
      id: "smp_clm_errors",
      number: "SMP-ERRORS",
      encounterId: "smp_enc_errors",
      patientId: "smp_pat_ethan",
      coverageId: "smp_cov_ethan",
      payerId: AETNA_PAYER,
      status: "scrub_error",
      workflow: "error",
      scrub: "errors",
      method: "unassigned",
      charge: "145.00",
      dx: [],
      lines: [{ code: "99213", charge: "145.00", pointers: "Z" }],
      scrubMessages: JSON.stringify([
        { severity: "error", field: "Diagnosis", box: "21", message: "No diagnosis code is linked.", suggestion: "Add at least one ICD-10-CM diagnosis." },
        { severity: "error", field: "Line 1 diagnosis pointers", box: "24E", message: "Diagnosis pointers must contain one to four letters from A through L.", suggestion: "Link the service line to a valid Box 21 diagnosis." },
      ]),
      scrubResult: "error",
      scrubErrors: "2",
    },
    {
      id: "smp_clm_ready",
      number: "SMP-READY",
      encounterId: "smp_enc_ready",
      patientId: "smp_pat_sofia",
      coverageId: "smp_cov_sofia",
      payerId: AETNA_PAYER,
      status: "ready",
      workflow: "ready_to_bill",
      scrub: "clean",
      method: "unassigned",
      charge: "225.00",
      dx: ["Z00.00"],
      lines: [{ code: "G0439", charge: "225.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
    },
    {
      id: "smp_clm_ready_aetna_2",
      number: "SMP-READY-AETNA-2",
      encounterId: "smp_enc_submitted",
      patientId: "smp_pat_ava",
      coverageId: "smp_cov_ava",
      payerId: AETNA_PAYER,
      status: "ready",
      workflow: "ready_to_bill",
      scrub: "clean",
      method: "unassigned",
      charge: "110.00",
      dx: ["E78.5"],
      lines: [{ code: "99212", charge: "110.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
    },
    {
      id: "smp_clm_ready_medicare",
      number: "SMP-READY-MEDICARE",
      encounterId: "smp_enc_ready_unclaimed",
      patientId: "smp_pat_liam",
      coverageId: "smp_cov_liam",
      payerId: MEDICARE_PAYER,
      status: "ready",
      workflow: "ready_to_bill",
      scrub: "clean",
      method: "unassigned",
      charge: "175.00",
      dx: ["E11.9", "I10"],
      lines: [{ code: "99214", charge: "175.00", pointers: "AB" }],
      scrubResult: "pass",
      scrubErrors: "0",
    },
    {
      id: "smp_clm_ready_medicare_2",
      number: "SMP-READY-MEDICARE-2",
      encounterId: "smp_enc_edi",
      patientId: "smp_pat_noah",
      coverageId: "smp_cov_noah",
      payerId: MEDICARE_PAYER,
      status: "ready",
      workflow: "ready_to_bill",
      scrub: "clean",
      method: "unassigned",
      charge: "145.00",
      dx: ["M54.50"],
      lines: [{ code: "99213", charge: "145.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
    },
    {
      id: "smp_clm_ready_paper",
      number: "SMP-READY-PAPER",
      encounterId: "smp_enc_draft",
      patientId: "smp_pat_mia",
      coverageId: "smp_cov_mia",
      payerId: PAPER_PAYER,
      status: "ready",
      workflow: "ready_to_bill",
      scrub: "clean",
      method: "unassigned",
      charge: "145.00",
      dx: ["J01.90"],
      lines: [{ code: "99213", charge: "145.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
    },
    {
      id: "smp_clm_edi",
      number: "SMP-EDI-BATCH",
      encounterId: "smp_enc_edi",
      patientId: "smp_pat_noah",
      coverageId: "smp_cov_noah",
      payerId: MEDICARE_PAYER,
      status: "ready",
      workflow: "generated",
      scrub: "clean",
      method: "electronic",
      charge: "145.00",
      dx: ["M54.50"],
      lines: [{ code: "99213", charge: "145.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
      batchId: "smp_batch_edi",
      format: "837P",
    },
    {
      id: "smp_clm_paper",
      number: "SMP-PAPER-BATCH",
      encounterId: "smp_enc_paper",
      patientId: "smp_pat_mia",
      coverageId: "smp_cov_mia",
      payerId: PAPER_PAYER,
      status: "ready",
      workflow: "generated",
      scrub: "clean",
      method: "paper",
      charge: "145.00",
      dx: ["J01.90"],
      lines: [{ code: "99213", charge: "145.00", pointers: "A" }],
      scrubResult: "pass",
      scrubErrors: "0",
      batchId: "smp_batch_paper",
      format: "CMS-1500",
    },
    {
      id: "smp_clm_submitted",
      number: "SMP-SUBMITTED",
      encounterId: "smp_enc_submitted",
      patientId: "smp_pat_ava",
      coverageId: "smp_cov_ava",
      payerId: AETNA_PAYER,
      status: "submitted",
      workflow: "submitted",
      scrub: "clean",
      method: "electronic",
      charge: "230.00",
      dx: ["I10", "E78.5"],
      lines: [
        { code: "99213", charge: "145.00", pointers: "AB" },
        { code: "93000", charge: "85.00", pointers: "A" },
      ],
      scrubResult: "pass",
      scrubErrors: "0",
      batchId: "smp_batch_sent",
      format: "837P",
      billed: true,
      paid: "0.00",
      adjustment: "0.00",
      pr: "0.00",
      remaining: "230.00",
    },
  ];

  await db.insert(claimBatches).values([
    {
      id: "smp_batch_edi",
      organizationId: DEFAULT_ORGANIZATION_ID,
      batchNumber: "SMP-EDI-001",
      payerId: MEDICARE_PAYER,
      batchType: "edi",
      status: "generated",
      claimCount: "1",
      totalCharge: "145.00",
      ediFileName: "SMP-EDI-001.837",
      ediContent: "ISA*00*          *00*          *ZZ*PRACX          *ZZ*MEDICARE       *260824*1200*^*00501*000000901*0*T*:~",
      proofFileName: "SMP-EDI-001-proof.txt",
      proofContent: "Sample EDI batch proof\nClaim SMP-EDI-BATCH · $145.00",
      createdByUserId: input.currentUser.id,
      createdByName: "System sample",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "smp_batch_paper",
      organizationId: DEFAULT_ORGANIZATION_ID,
      batchNumber: "SMP-PAPER-001",
      payerId: PAPER_PAYER,
      batchType: "paper",
      status: "generated",
      claimCount: "1",
      totalCharge: "145.00",
      proofFileName: "SMP-PAPER-001-cms1500.txt",
      proofContent: "Sample CMS-1500 proof\nClaim SMP-PAPER-BATCH · $145.00",
      createdByUserId: input.currentUser.id,
      createdByName: "System sample",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "smp_batch_sent",
      organizationId: DEFAULT_ORGANIZATION_ID,
      batchNumber: "SMP-SENT-001",
      payerId: AETNA_PAYER,
      batchType: "edi",
      status: "sent",
      claimCount: "1",
      totalCharge: "230.00",
      ediFileName: "SMP-SENT-001.837",
      ediContent: "ISA*00*          *00*          *ZZ*PRACX          *ZZ*AETNA          *260824*1300*^*00501*000000902*0*T*:~",
      proofFileName: "SMP-SENT-001-proof.txt",
      proofContent: "Sample transmitted batch\nClaim SMP-SUBMITTED · $230.00",
      clearinghouseResponse: "ACK accepted · TRACE SMP-CH-9001",
      transmittedAt: now,
      transmittedByName: input.currentUser.fullName,
      createdByUserId: input.currentUser.id,
      createdByName: "System sample",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  for (const claim of claimDefs) {
    const patient = byId[claim.patientId];
    const scrubbed = claim.scrub !== "not_run";
    const generated = Boolean(claim.batchId) || claim.workflow === "generated" || claim.workflow === "submitted";
    await db.insert(claims).values({
      id: claim.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      claimNumber: claim.number,
      patientId: claim.patientId,
      encounterId: claim.encounterId,
      coverageId: claim.coverageId,
      payerId: claim.payerId,
      providerId: PROVIDER_ID,
      facilityId: FACILITY_ID,
      referringProviderId: REFERRING_ID,
      ...fullCmsFields,
      diagnosisCodes: JSON.stringify(claim.dx),
      claimDataSnapshot: claimSnapshot({
        firstName: patient.firstName,
        middleName: patient.middleName,
        lastName: patient.lastName,
        dateOfBirth: patient.dob,
        sex: patient.sex,
        addressLine1: patient.address,
        city: patient.city,
        state: patient.state,
        postalCode: patient.zip,
      }, {
        memberId: patient.memberId,
        groupNumber: patient.groupNumber,
        relationship: "self",
        subscriberFirstName: patient.firstName,
        subscriberLastName: patient.lastName,
        subscriberDateOfBirth: patient.dob,
        subscriberSex: patient.sex,
      }),
      dateOfService: today,
      transactionDate: today,
      postingDate: today,
      firstBilledDate: claim.billed ? today : null,
      lastBilledDate: claim.billed ? today : null,
      status: claim.status,
      lifecycleStatus: deriveClaimLifecycle({
        workflowStatus: claim.workflow,
        status: claim.status,
        remainingBalance: claim.remaining || claim.charge,
        firstBilledDate: claim.billed ? today : null,
      }),
      workflowStatus: claim.workflow,
      scrubberStatus: claim.scrub,
      scrubberMessages: claim.scrubMessages || "[]",
      lastScrubbedAt: scrubbed ? now : null,
      scrubResult: claim.scrubResult ?? null,
      scrubRulesChecked: scrubbed ? JSON.stringify([...SCRUB_RULES_CHECKED]) : "[]",
      scrubErrorCount: claim.scrubErrors || "0",
      scrubbedByName: scrubbed ? "System sample" : null,
      totalCharge: claim.charge,
      totalPaid: claim.paid || "0.00",
      totalAdjustment: claim.adjustment || "0.00",
      patientResponsibility: claim.pr || "0.00",
      remainingBalance: claim.remaining || claim.charge,
      submissionMode: claim.billed ? "test" : "file",
      submissionMethod: claim.method,
      routedAt: claim.method !== "unassigned" ? now : null,
      clearinghouseTrace: claim.billed ? "SMP-CH-9001" : null,
      generationId: generated ? `GEN-${claim.number}` : null,
      generatedAt: generated ? now : null,
      generatedByName: generated ? "System sample" : null,
      claimFormat: claim.format || null,
      generationResult: generated ? "success" : null,
      generatedTransactionRef: claim.billed ? "SMP-TRACE-9001" : null,
      batchId: claim.batchId || null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(claimResponsibilitySnapshots).values({
      id: `smp_crs_${claim.id}`,
      claimId: claim.id,
      profileId: `smp_rsp_${claim.patientId.slice(8)}`,
      billingContext: "routine",
      profileSnapshot: JSON.stringify({ profileName: "Sample routine", primary: claim.payerId }),
    });
    for (const [index, line] of claim.lines.entries()) {
      await db.insert(claimLines).values({
        id: `smp_line_${claim.id}_${index + 1}`,
        claimId: claim.id,
        lineNumber: String(index + 1),
        procedureCode: line.code,
        modifiers: index === 0 && claim.id === "smp_clm_submitted" ? "25" : null,
        diagnosisPointers: line.pointers,
        units: "1",
        chargeAmount: line.charge,
        placeOfService: "11",
        renderingNpi: "1487926404",
        serviceDateFrom: today,
        serviceDateTo: today,
      });
    }
    if (claim.batchId) {
      await db.insert(claimBatchMembers).values({
        id: `smp_bm_${claim.id}`,
        batchId: claim.batchId,
        claimId: claim.id,
        createdAt: now,
      });
    }
  }

  const paymentAmount = "190.00";
  const paymentId = "smp_pay_pending";
  await db.insert(paymentEntries).values({
    id: paymentId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    paymentNumber: "SMP-PMT-001",
    payerId: AETNA_PAYER,
    remittanceId: null,
    paymentAmount,
    offsetAmount: "0.00",
    refundAmount: "0.00",
    incentiveAmount: "0.00",
    otherAdjustments: "0.00",
    paymentTotalEffective: moneyFixed(calculatePaymentTotalEffective({ paymentAmount })),
    paymentMethod: "Check",
    referenceNumber: "CHK-SMP-4401",
    paymentDate: today,
    notes: "Sample check for posting practice (edit claim lines to balance).",
    paymentStatus: "pending",
    claimCount: "1",
    postedClaimCount: "0",
    claimPaidTotal: "0.00",
    autoPostResult: null,
    errorMessage: null,
    reconciliationStatus: "unbalanced",
    createdByUserId: input.currentUser.id,
    createdByName: input.currentUser.fullName,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(claimPayments).values({
    id: "smp_cp_submitted",
    paymentId,
    claimId: "smp_clm_submitted",
    allowedAmount: "180.00",
    paidAmount: "150.00",
    adjustmentAmount: "40.00",
    patientResponsibility: "30.00",
    denialCode: null,
    postingStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(paymentLogs).values({
    id: "smp_plog_create",
    paymentId,
    claimId: null,
    actionType: "Create",
    message: "Sample payment entry created for posting practice.",
    createdAt: now,
  });

  return {
    patients: samplePatients.length,
    appointments: flowAppointments.length,
    encounters: encounterDefs.length,
    claims: claimDefs.length,
    batches: 3,
    payments: 1,
    today,
  };
}
