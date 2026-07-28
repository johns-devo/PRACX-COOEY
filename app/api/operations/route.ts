import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import {
  appointments,
  billingResponsibilityProfiles,
  claimLines,
  claimConfigurationValues,
  claimResponsibilitySnapshots,
  claims,
  eligibilityChecks,
  eligibilityUpdateHistory,
  encounters,
  facilities,
  feeScheduleItems,
  feeSchedules,
  insurancePlans,
  integrations,
  ledgerTransactions,
  patientCoverages,
  patients,
  payers,
  payments,
  procedureCodes,
  providers,
  reconsiderations,
  referringProviders,
  remittances,
  responsibilityProfileHistory,
  responsibilitySources,
} from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const COVERAGE_PRIORITIES = ["primary", "secondary", "tertiary", "unassigned"] as const;

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

function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function claim837({
  claim,
  patient,
  payer,
  provider,
  lines,
}: {
  claim: typeof claims.$inferSelect;
  patient: typeof patients.$inferSelect;
  payer: typeof payers.$inferSelect | null;
  provider: typeof providers.$inferSelect;
  lines: (typeof claimLines.$inferSelect)[];
}) {
  const control = claim.claimNumber.replace(/\D/g, "").slice(-9).padStart(9, "0");
  const now = new Date();
  const ymd = now.toISOString().slice(2, 10).replaceAll("-", "");
  const hm = now.toISOString().slice(11, 16).replace(":", "");
  const segments = [
    `ISA*00*          *00*          *ZZ*PRACX          *ZZ*${(payer?.payerId || "FILE").padEnd(15)}*${ymd}*${hm}*^*00501*${control}*0*T*:~`,
    `GS*HC*PRACX*${payer?.payerId || "FILE"}*20${ymd}*${hm}*${Number(control)}*X*005010X222A1~`,
    `ST*837*0001*005010X222A1~`,
    `BHT*0019*00*${claim.claimNumber}*20${ymd}*${hm}*CH~`,
    `NM1*41*2*PRACX CARE OPERATIONS*****46*PRACX~`,
    `NM1*40*2*${payer?.name || "FILE EXPORT"}*****46*${payer?.payerId || "FILE"}~`,
    `HL*1**20*1~`,
    `NM1*85*2*PRACX HEALTH NETWORK*****XX*${provider.npi || "0000000000"}~`,
    `HL*2*1*22*0~`,
    `SBR*P*18*******${payer?.claimFilingIndicator || "CI"}~`,
    `NM1*IL*1*${patient.lastName}*${patient.firstName}*${patient.middleName || ""}***MI*${claim.coverageId || ""}~`,
    `DMG*D8*${patient.dateOfBirth.replaceAll("-", "")}*${patient.sex === "male" ? "M" : patient.sex === "female" ? "F" : "U"}~`,
    `CLM*${claim.claimNumber}*${claim.totalCharge}***11:B:1*Y*A*Y*Y~`,
    `HI*ABK:${JSON.parse((claim.scrubberMessages || "[]"))[0]?.diagnosis || "Z0000"}~`,
    ...lines.flatMap((line, index) => [
      `LX*${index + 1}~`,
      `SV1*HC:${line.procedureCode}${line.modifiers ? `:${line.modifiers.replaceAll(",", ":")}` : ""}*${line.chargeAmount}*UN*${line.units}***${line.diagnosisPointers}~`,
      `DTP*472*D8*${line.serviceDateFrom.replaceAll("-", "")}~`,
    ]),
    `SE*${15 + lines.length * 3}*0001~`,
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
    .orderBy(sql`case ${patientCoverages.priority} when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3 else 4 end`)
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
    remittanceRows,
    paymentRows,
    transactionRows,
    reconsiderationRows,
    integrationRows,
    responsibilityProfileRows,
    responsibilitySourceRows,
    responsibilityHistoryRows,
    responsibilitySnapshotRows,
    claimConfigurationRows,
    eligibilityUpdateRows,
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
        chiefComplaint: encounters.chiefComplaint,
        clinicalNote: encounters.clinicalNote,
        diagnosisCodes: encounters.diagnosisCodes,
        procedureCodes: encounters.procedureCodes,
        status: encounters.status,
        signedAt: encounters.signedAt,
        readyToBillAt: encounters.readyToBillAt,
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
        dateOfService: claims.dateOfService,
        transactionDate: claims.transactionDate,
        paymentDate: claims.paymentDate,
        postingDate: claims.postingDate,
        firstBilledDate: claims.firstBilledDate,
        lastBilledDate: claims.lastBilledDate,
        status: claims.status,
        scrubberStatus: claims.scrubberStatus,
        scrubberMessages: claims.scrubberMessages,
        totalCharge: claims.totalCharge,
        totalPaid: claims.totalPaid,
        totalAdjustment: claims.totalAdjustment,
        patientResponsibility: claims.patientResponsibility,
        submissionMode: claims.submissionMode,
        clearinghouseTrace: claims.clearinghouseTrace,
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
        billFrequencyCode: claims.billFrequencyCode,
        originalReferenceNumber: claims.originalReferenceNumber,
        patientName: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`,
        payerName: payers.name,
        providerName: sql<string>`${providers.firstName} || ' ' || ${providers.lastName}`,
      })
      .from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(providers, eq(providers.id, claims.providerId))
      .leftJoin(payers, eq(payers.id, claims.payerId))
      .where(eq(claims.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(claims.transactionDate)),
    db.select().from(claimLines).orderBy(asc(claimLines.lineNumber)),
    db
      .select({
        id: remittances.id,
        payerId: remittances.payerId,
        traceNumber: remittances.traceNumber,
        paymentDate: remittances.paymentDate,
        amount: remittances.amount,
        source: remittances.source,
        status: remittances.status,
        receivedAt: remittances.receivedAt,
        postedAt: remittances.postedAt,
        payerName: payers.name,
      })
      .from(remittances)
      .leftJoin(payers, eq(payers.id, remittances.payerId))
      .orderBy(desc(remittances.receivedAt)),
    db.select().from(payments).orderBy(desc(payments.postingDate)),
    db
      .select({
        id: ledgerTransactions.id,
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
      .innerJoin(patients, eq(patients.id, ledgerTransactions.patientId))
      .leftJoin(claims, eq(claims.id, ledgerTransactions.claimId))
      .where(eq(ledgerTransactions.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(desc(ledgerTransactions.postingDate)),
    db.select().from(reconsiderations).orderBy(desc(reconsiderations.createdAt)),
    db.select().from(integrations).where(eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID)),
    db.select().from(billingResponsibilityProfiles).orderBy(desc(billingResponsibilityProfiles.effectiveFrom)),
    db.select().from(responsibilitySources).orderBy(asc(responsibilitySources.sequence)),
    db.select().from(responsibilityProfileHistory).orderBy(desc(responsibilityProfileHistory.createdAt)),
    db.select().from(claimResponsibilitySnapshots).orderBy(desc(claimResponsibilitySnapshots.createdAt)),
    db.select().from(claimConfigurationValues).where(eq(claimConfigurationValues.status, "active")).orderBy(asc(claimConfigurationValues.category), asc(claimConfigurationValues.code)),
    db.select().from(eligibilityUpdateHistory).orderBy(desc(eligibilityUpdateHistory.createdAt)),
  ]);

  return {
    patients: patientRows,
    coverages: coverageRows,
    payers: payerRows,
    plans: planRows,
    providers: providerRows,
    facilities: facilityRows,
    referringProviders: referringRows,
    appointments: appointmentRows,
    eligibility: eligibilityRows,
    encounters: encounterRows,
    procedureCodes: procedureRows,
    feeSchedules: feeRows,
    feeScheduleItems: feeItemRows,
    claims: claimRows,
    claimLines: claimLineRows,
    remittances: remittanceRows,
    payments: paymentRows,
    transactions: transactionRows,
    reconsiderations: reconsiderationRows,
    integrations: integrationRows,
    responsibilityProfiles: responsibilityProfileRows,
    responsibilitySources: responsibilitySourceRows,
    responsibilityHistory: responsibilityHistoryRows,
    claimResponsibilitySnapshots: responsibilitySnapshotRows,
    claimConfigurationValues: claimConfigurationRows,
    eligibilityUpdateHistory: eligibilityUpdateRows,
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
    const today = dateOnly();

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
      const effectiveDate = clean(payload.effectiveDate) || null;
      const terminationDate = clean(payload.terminationDate) || null;
      if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
        return Response.json({ error: "Coverage termination cannot be earlier than the effective date." }, { status: 400 });
      }
      const subscriberSameAsPatient = payload.subscriberSameAsPatient !== false;
      const manualSubscriberFields = ["subscriberFirstName", "subscriberLastName", "subscriberDateOfBirth", "subscriberSex", "subscriberAddressLine1", "subscriberCity", "subscriberState", "subscriberPostalCode"];
      if (planId && memberId && !subscriberSameAsPatient && manualSubscriberFields.some((field) => !clean(payload[field]))) {
        return Response.json({ error: "Enter the different subscriber’s name, birth date and address." }, { status: 400 });
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
          acceptAssignment: payload.acceptAssignment === false ? "no" : "yes",
          releaseOfInformation: payload.releaseOfInformation === false ? "no" : "yes",
          assignmentOfBenefits: payload.assignmentOfBenefits === false ? "no" : "yes",
          status: "active",
        });
      }
      if (payload.verifyEligibility === true) {
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

    if (action === "updateAppointmentStatus") {
      const id = clean(payload.id);
      const status = clean(payload.status) as typeof appointments.$inferInsert.status;
      await db.update(appointments).set({ status }).where(eq(appointments.id, id));
      return Response.json({ id, status });
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
        status: "active",
      });
      return Response.json({ id }, { status: 201 });
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
        billFrequencyCode: clean(payload.billFrequencyCode),
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
        billFrequencyCode: configuredCodes("bill_frequency", ["7", "8"]),
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
        ["billFrequencyCode", "originalReferenceNumber", "Box 22 frequency and original reference"],
        ["renderingOtherIdQualifier", "renderingOtherId", "Box 24I qualifier and rendering identifier"],
        ["supplementalQualifier", "supplementalInformation", "Box 24 shaded qualifier and information"],
      ];
      const incompletePair = pairedFields.find(([left, right]) => Boolean(clean(payload[left])) !== Boolean(clean(payload[right])));
      if (incompletePair) return Response.json({ error: `${incompletePair[2]} must be entered together.` }, { status: 400 });
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
      const profilePrimary = profileSources.find((source) => source.role === "primary");
      const [fallbackCoverage] = await db
        .select()
        .from(patientCoverages)
        .where(and(eq(patientCoverages.patientId, encounter.patientId), eq(patientCoverages.status, "active")))
        .orderBy(sql`case ${patientCoverages.priority} when 'primary' then 1 when 'secondary' then 2 when 'tertiary' then 3 else 4 end`)
        .limit(1);
      const coverageId = profilePrimary?.coverageId || fallbackCoverage?.id || null;
      const [coverage] = coverageId
        ? await db.select().from(patientCoverages).where(eq(patientCoverages.id, coverageId)).limit(1)
        : [];
      const procedures = JSON.parse(encounter.procedureCodes) as string[];
      const procedureRows = procedures.length
        ? await db.select().from(procedureCodes).where(sql`${procedureCodes.code} in (${sql.join(procedures.map((code) => sql`${code}`), sql`, `)})`)
        : [];
      const total = procedureRows.reduce((sum, item) => sum + Number(item.defaultCharge), 0);
      const id = crypto.randomUUID();
      const claimNumber = `CLM${Date.now().toString().slice(-7)}`;
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
        employmentRelated: clean(payload.employmentRelated) || "N",
        autoAccidentRelated: clean(payload.autoAccidentRelated) || "N",
        autoAccidentState: clean(payload.autoAccidentState).toUpperCase() || null,
        otherAccidentRelated: clean(payload.otherAccidentRelated) || "N",
        claimConditionCodes: JSON.stringify(conditionCodes),
        dateOfService: encounter.dateOfService,
        transactionDate: today,
        postingDate: today,
        status: "draft",
        totalCharge: total.toFixed(2),
        otherClaimIdQualifier: claimQualifiers.otherClaimIdQualifier || null,
        otherClaimId: clean(payload.otherClaimId) || null,
        conditionDateQualifier: claimQualifiers.conditionDateQualifier || null,
        conditionDate: clean(payload.conditionDate) || null,
        otherDateQualifier: claimQualifiers.otherDateQualifier || null,
        otherDate: clean(payload.otherDate) || null,
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
        priorAuthorizationNumber: clean(payload.priorAuthorizationNumber) || null,
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
      return Response.json({ id, claimNumber }, { status: 201 });
    }

    if (action === "scrubClaim") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      const [patient, provider, facility, coverage, encounter] = await Promise.all([
        db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
        db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
        db.select().from(facilities).where(eq(facilities.id, claim.facilityId)).limit(1),
        claim.coverageId ? db.select().from(patientCoverages).where(eq(patientCoverages.id, claim.coverageId)).limit(1) : Promise.resolve([]),
        claim.encounterId ? db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1) : Promise.resolve([]),
      ]);
      const lines = await db.select().from(claimLines).where(eq(claimLines.claimId, id));
      const issues: { severity: "error" | "warning"; field: string; box: string; message: string; suggestion: string; diagnosis?: string }[] = [];
      if (!patient[0]?.dateOfBirth) issues.push({ severity: "error", field: "Patient DOB", box: "3", message: "Patient birth date is missing.", suggestion: "Complete the patient demographics." });
      if (!coverage[0]?.memberId) issues.push({ severity: "error", field: "Member ID", box: "1a", message: "Active insurance member ID is missing.", suggestion: "Add primary coverage." });
      if (!provider[0]?.npi) issues.push({ severity: "error", field: "Rendering NPI", box: "24J", message: "Rendering provider NPI is missing.", suggestion: "Complete provider NPI." });
      if (!facility[0]?.npi) issues.push({ severity: "warning", field: "Facility NPI", box: "32a", message: "Service facility NPI is not configured.", suggestion: "Confirm whether Box 32a is required for this payer." });
      const claimPairs: [unknown, unknown, string, string][] = [
        [claim.otherClaimIdQualifier, claim.otherClaimId, "11b", "other claim ID"],
        [claim.conditionDateQualifier, claim.conditionDate, "14", "condition date"],
        [claim.otherDateQualifier, claim.otherDate, "15", "other date"],
        [claim.referringOtherIdQualifier, claim.referringOtherId, "17a", "referring provider other ID"],
        [claim.additionalClaimInfoQualifier, claim.additionalClaimInfo, "19", "additional claim information"],
        [claim.billFrequencyCode, claim.originalReferenceNumber, "22", "resubmission reference"],
        [claim.serviceFacilityOtherIdQualifier, claim.serviceFacilityOtherId, "32b", "service facility other ID"],
        [claim.billingProviderOtherIdQualifier, claim.billingProviderOtherId, "33b", "billing provider other ID"],
      ];
      for (const [qualifier, enteredValue, box, field] of claimPairs) {
        if (Boolean(qualifier) !== Boolean(enteredValue)) issues.push({ severity: "error", field, box, message: `Box ${box} has an incomplete qualifier/value pair.`, suggestion: "Enter both the qualifier and its accompanying value, or clear both." });
      }
      if (claim.referringOtherIdQualifier === "LU" && claim.referringProviderQualifier !== "DQ") {
        issues.push({ severity: "error", field: "Referring provider other ID", box: "17a", message: "LU is only valid for a supervising provider in Box 17a.", suggestion: "Select DQ supervising provider or use the correct other-ID qualifier." });
      }
      if (claim.billFrequencyCode && !["7", "8"].includes(claim.billFrequencyCode)) {
        issues.push({ severity: "error", field: "Bill frequency", box: "22", message: "Unsupported bill frequency code.", suggestion: "Use 7 for replacement, 8 for void/cancel, or leave blank for an original claim." });
      }
      if (claim.autoAccidentRelated === "Y" && !/^[A-Z]{2}$/.test(claim.autoAccidentState || "")) {
        issues.push({ severity: "error", field: "Auto accident state", box: "10b", message: "An auto-accident claim requires a two-letter state code.", suggestion: "Enter the state where the accident occurred." });
      }
      for (const [from, to, box, label] of [
        [claim.unableToWorkFrom, claim.unableToWorkTo, "16", "unable-to-work dates"],
        [claim.hospitalizationFrom, claim.hospitalizationTo, "18", "hospitalization dates"],
      ] as [string | null, string | null, string, string][]) {
        if (Boolean(from) !== Boolean(to)) issues.push({ severity: "error", field: label, box, message: `Box ${box} requires both from and through dates.`, suggestion: "Complete both dates or clear the date range." });
        if (from && to && from > to) issues.push({ severity: "error", field: label, box, message: `Box ${box} through date precedes its from date.`, suggestion: "Correct the date range." });
      }
      if ((claim.outsideLabIndicator === "Y") !== Boolean(claim.outsideLabCharges)) {
        issues.push({ severity: "error", field: "Outside laboratory", box: "20", message: "Outside-lab selection and purchased-service charge do not agree.", suggestion: "Enter Yes with the charge, or No without a charge." });
      }
      if (Boolean(claim.federalTaxIdType) !== Boolean(claim.federalTaxIdNumber) || (claim.federalTaxIdNumber && !/^\d{9}$/.test(claim.federalTaxIdNumber))) {
        issues.push({ severity: "error", field: "Federal tax ID", box: "25", message: "Federal tax ID type and a 9-digit identifier are required together.", suggestion: "Select EIN or SSN and enter nine digits." });
      }
      if (claim.providerSignatureOnFile !== "Y") {
        issues.push({ severity: "error", field: "Provider signature", box: "31", message: "Provider signature authorization is not recorded.", suggestion: "Record the accountable provider signature and date." });
      }
      const diagnoses = encounter[0] ? (JSON.parse(encounter[0].diagnosisCodes) as string[]) : [];
      if (!diagnoses.length) issues.push({ severity: "error", field: "Diagnosis", box: "21", message: "No diagnosis code is linked.", suggestion: "Add at least one ICD-10-CM diagnosis." });
      if (diagnoses.length > 12) issues.push({ severity: "error", field: "Diagnosis", box: "21", message: "A CMS-1500 claim can report no more than 12 diagnoses.", suggestion: "Split services related to additional diagnoses into another claim." });
      if (!lines.length) issues.push({ severity: "error", field: "Service lines", box: "24", message: "Claim has no service lines.", suggestion: "Add a procedure line." });
      if (lines.length > 50) issues.push({ severity: "error", field: "Service lines", box: "24", message: "Current NUCC instructions require claims with more than 50 service lines to be split.", suggestion: "Split the claim into compliant groups." });
      if (lines.some((line) => Number(line.chargeAmount) <= 0)) issues.push({ severity: "error", field: "Charges", box: "24F", message: "A service line has a zero charge.", suggestion: "Enter a valid charge amount." });
      for (const line of lines) {
        if (!/^\d{2}$/.test(line.placeOfService)) issues.push({ severity: "error", field: `Line ${line.lineNumber} place of service`, box: "24B", message: "Place of service must contain two digits.", suggestion: "Select a valid CMS place-of-service code." });
        if (line.modifiers && (line.modifiers.split(",").length > 4 || line.modifiers.split(",").some((modifier) => !/^[A-Z0-9]{2}$/.test(modifier)))) issues.push({ severity: "error", field: `Line ${line.lineNumber} modifiers`, box: "24D", message: "A line supports no more than four two-character modifiers.", suggestion: "Correct the modifier list." });
        if (!/^[A-L]{1,4}$/.test(line.diagnosisPointers)) issues.push({ severity: "error", field: `Line ${line.lineNumber} diagnosis pointers`, box: "24E", message: "Diagnosis pointers must contain one to four letters from A through L.", suggestion: "Link the service line to valid Box 21 diagnoses." });
        if (Number(line.units) <= 0) issues.push({ severity: "error", field: `Line ${line.lineNumber} units`, box: "24G", message: "Days or units must be greater than zero.", suggestion: "Enter the number of services, days, minutes or units." });
        if (line.epsdtIndicator && line.epsdtReasonCode) issues.push({ severity: "error", field: `Line ${line.lineNumber} EPSDT`, box: "24H", message: "EPSDT Y/N and an EPSDT reason code cannot be reported together.", suggestion: "Use the payer-required indicator or reason code, not both." });
        if (Boolean(line.renderingOtherIdQualifier) !== Boolean(line.renderingOtherId)) {
          issues.push({ severity: "error", field: `Line ${line.lineNumber} rendering other ID`, box: "24I/24J", message: "Rendering other-ID qualifier and identifier are incomplete.", suggestion: "Enter both values or clear both." });
        }
        if (line.epsdtReasonCode && !["AV", "S2", "ST", "NU"].includes(line.epsdtReasonCode)) {
          issues.push({ severity: "error", field: `Line ${line.lineNumber} EPSDT`, box: "24H", message: "Unsupported EPSDT reason code.", suggestion: "Use AV, S2, ST or NU." });
        }
        if (Boolean(line.supplementalQualifier) !== Boolean(line.supplementalInformation)) {
          issues.push({ severity: "error", field: `Line ${line.lineNumber} supplemental information`, box: "24 shaded", message: "Supplemental qualifier and information are incomplete.", suggestion: "Enter both values or clear both." });
        }
        if (line.supplementalQualifier === "JO" && !["00", "01", "02", "10", "20", "30", "40"].includes(line.supplementalInformation || "")) {
          issues.push({ severity: "error", field: `Line ${line.lineNumber} oral-cavity area`, box: "24 shaded", message: "JO contains an unsupported oral-cavity area.", suggestion: "Use 00, 01, 02, 10, 20, 30 or 40." });
        }
        if (line.ndcCode && (line.ndcCode.length !== 11 || !["F2", "GR", "ME", "ML", "UN"].includes(line.ndcUnitQualifier || "") || Number(line.ndcQuantity) <= 0)) {
          issues.push({ severity: "error", field: `Line ${line.lineNumber} NDC`, box: "24 shaded", message: "NDC data is incomplete or incorrectly formatted.", suggestion: "Enter an 11-digit NDC, valid unit qualifier and positive quantity." });
        }
      }
      if (diagnoses[0]) issues.push({ severity: "warning", field: "Coding review", box: "21/24E", message: `AI interpretation: ${diagnoses[0]} is linked to ${lines.length} service line(s).`, suggestion: "Confirm medical necessity and diagnosis pointer before submission.", diagnosis: diagnoses[0] });
      const hasError = issues.some((issue) => issue.severity === "error");
      await db.update(claims).set({
        scrubberStatus: hasError ? "errors" : "clean",
        scrubberMessages: JSON.stringify(issues),
        status: hasError ? "scrub_error" : "ready",
        updatedAt: new Date().toISOString(),
      }).where(eq(claims.id, id));
      return Response.json({ id, status: hasError ? "errors" : "clean", issues });
    }

    if (action === "submitClaim" || action === "generate837") {
      const id = clean(payload.id);
      const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.scrubberStatus !== "clean") return Response.json({ error: "Run the scrubber and resolve errors before submission." }, { status: 400 });
      const [[patient], [provider], payerRows, lines] = await Promise.all([
        db.select().from(patients).where(eq(patients.id, claim.patientId)).limit(1),
        db.select().from(providers).where(eq(providers.id, claim.providerId)).limit(1),
        claim.payerId ? db.select().from(payers).where(eq(payers.id, claim.payerId)).limit(1) : Promise.resolve([]),
        db.select().from(claimLines).where(eq(claimLines.claimId, id)),
      ]);
      const content = claim837({ claim, patient, payer: payerRows[0] || null, provider, lines });
      if (action === "submitClaim") {
        const trace = `CH${Date.now()}`;
        await db.update(claims).set({
          status: "submitted",
          submissionMode: clean(payload.mode) || "test",
          clearinghouseTrace: trace,
          firstBilledDate: claim.firstBilledDate || today,
          lastBilledDate: today,
          updatedAt: new Date().toISOString(),
        }).where(eq(claims.id, id));
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

    if (action === "importEra") {
      const traceNumber = clean(payload.traceNumber) || `ERA${Date.now()}`;
      const id = crypto.randomUUID();
      await db.insert(remittances).values({
        id,
        payerId: clean(payload.payerId) || null,
        traceNumber,
        paymentDate: clean(payload.paymentDate) || today,
        amount: money(payload.amount),
        source: clean(payload.source) || "835_file",
        status: "received",
        raw835: clean(payload.raw835) || null,
      });
      return Response.json({ id, traceNumber }, { status: 201 });
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
      await db.insert(payments).values({
        id: paymentId,
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
        paymentDate,
        postingDate,
        status: remaining === 0 ? "paid" : claim.status,
        updatedAt: new Date().toISOString(),
      }).where(eq(claims.id, claimId));
      const ledgerBase = {
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

    if (action === "updateIntegration") {
      const integrationType = clean(payload.integrationType);
      const vendorName = clean(payload.vendorName);
      const mode = ["file", "test", "live"].includes(clean(payload.mode))
        ? clean(payload.mode) as "file" | "test" | "live"
        : "file";
      if (!integrationType || !vendorName) {
        return Response.json({ error: "Integration type and vendor name are required." }, { status: 400 });
      }
      const [existing] = await db
        .select()
        .from(integrations)
        .where(and(
          eq(integrations.organizationId, DEFAULT_ORGANIZATION_ID),
          eq(integrations.integrationType, integrationType),
        ))
        .limit(1);
      const status = mode === "live" ? "needs_credentials" : "configured";
      if (existing) {
        await db.update(integrations).set({
          vendorName,
          mode,
          endpoint: clean(payload.endpoint) || null,
          status,
        }).where(eq(integrations.id, existing.id));
        return Response.json({ id: existing.id, status });
      }
      const id = crypto.randomUUID();
      await db.insert(integrations).values({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        integrationType,
        vendorName,
        mode,
        endpoint: clean(payload.endpoint) || null,
        status,
      });
      return Response.json({ id, status }, { status: 201 });
    }

    return Response.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete operation.";
    const conflict = message.includes("UNIQUE constraint failed");
    return Response.json({ error: conflict ? "This record already exists." : message }, { status: conflict ? 409 : 500 });
  }
}
