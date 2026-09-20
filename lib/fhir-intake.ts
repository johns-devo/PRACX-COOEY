import type { EhrInboundBundleV1, InboundIssue } from "./inbound-bridge";

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";

type FhirResource = Record<string, any>;

type FhirBundle = {
  resourceType?: string;
  type?: string;
  meta?: { source?: string };
  entry?: Array<{ fullUrl?: string; resource?: FhirResource }>;
};

/** `Bundle.meta.source` is a URI; the trailing segment names the sending system. */
function sourceFromMeta(bundle: FhirBundle) {
  const raw = str(bundle.meta?.source);
  if (!raw) return "";
  return raw.split("/").filter(Boolean).pop() || "";
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function collect(bundle: FhirBundle) {
  const byType = new Map<string, FhirResource[]>();
  const byRef = new Map<string, FhirResource>();

  for (const entry of bundle.entry || []) {
    const resource = entry?.resource;
    const resourceType = str(resource?.resourceType);
    if (!resource || !resourceType) continue;

    const list = byType.get(resourceType) || [];
    list.push(resource);
    byType.set(resourceType, list);

    const id = str(resource.id);
    if (id) byRef.set(`${resourceType}/${id}`, resource);
    const fullUrl = str(entry.fullUrl);
    if (fullUrl) byRef.set(fullUrl, resource);
  }

  return { byType, byRef };
}

function resolve(byRef: Map<string, FhirResource>, reference: unknown) {
  const ref = str(typeof reference === "string" ? reference : (reference as any)?.reference);
  if (!ref) return null;
  return byRef.get(ref) || null;
}

function humanName(resource: FhirResource | null) {
  const names: FhirResource[] = Array.isArray(resource?.name) ? resource!.name : [];
  const preferred =
    names.find((entry) => str(entry.use) === "official") ||
    names.find((entry) => str(entry.use) === "usual") ||
    names[0];
  if (!preferred) return { first: "", middle: "", last: "" };
  const given: string[] = Array.isArray(preferred.given) ? preferred.given.map(str).filter(Boolean) : [];
  return {
    first: given[0] || "",
    middle: given.slice(1).join(" "),
    last: str(preferred.family),
  };
}

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/**
 * Truncating a full state name to two characters silently produces a valid but
 * wrong code ("New York" -> "NE"), so unrecognized values pass through intact
 * and fail validation instead.
 */
function stateCode(raw: string) {
  const value = raw.trim();
  if (value.length === 2) return value.toUpperCase();
  return STATE_CODES[value.toLowerCase()] || value;
}

function address(resource: FhirResource | null) {
  const list: FhirResource[] = Array.isArray(resource?.address) ? resource!.address : [];
  const preferred = list.find((entry) => str(entry.use) === "home") || list[0];
  const lines: string[] = Array.isArray(preferred?.line) ? preferred!.line.map(str).filter(Boolean) : [];
  return {
    line1: lines[0] || "",
    line2: lines.slice(1).join(", "),
    city: str(preferred?.city),
    state: stateCode(str(preferred?.state)),
    postalCode: str(preferred?.postalCode),
  };
}

function telecom(resource: FhirResource | null, system: string) {
  const list: FhirResource[] = Array.isArray(resource?.telecom) ? resource!.telecom : [];
  const match = list.find((entry) => str(entry.system) === system);
  return str(match?.value);
}

function identifierBySystem(resource: FhirResource | null, system: string) {
  const list: FhirResource[] = Array.isArray(resource?.identifier) ? resource!.identifier : [];
  const match = list.find((entry) => str(entry.system) === system);
  return str(match?.value);
}

function sexFrom(gender: unknown): "male" | "female" | "unknown" {
  const value = str(gender).toLowerCase();
  return value === "male" || value === "female" ? value : "unknown";
}

function codeableText(node: unknown): string {
  if (!node) return "";
  const source = Array.isArray(node) ? node[0] : node;
  const direct = str((source as any)?.text);
  if (direct) return direct;
  const coding = (source as any)?.coding;
  const first = Array.isArray(coding) ? coding[0] : null;
  return str(first?.display) || str(first?.code);
}

function participantRef(appointment: FhirResource | null, prefix: string) {
  const list: FhirResource[] = Array.isArray(appointment?.participant) ? appointment!.participant : [];
  for (const item of list) {
    const ref = str(item?.actor?.reference);
    if (ref.startsWith(prefix)) return ref;
  }
  return "";
}

function coverageClass(coverage: FhirResource | null, type: string) {
  const list: FhirResource[] = Array.isArray(coverage?.class) ? coverage!.class : [];
  const match = list.find((entry) => codeableText(entry?.type).toLowerCase() === type);
  return str(match?.value) || str(match?.name);
}

function relationshipFrom(coverage: FhirResource | null): "self" | "spouse" | "child" | "other" {
  const code = codeableText(coverage?.relationship).toLowerCase();
  if (code.includes("self")) return "self";
  if (code.includes("spouse")) return "spouse";
  if (code.includes("child")) return "child";
  return code ? "other" : "self";
}

export function fhirBundleToInboundBundle(
  input: unknown,
  options?: { sourceSystem?: string; sourceLabel?: string },
): { bundle: EhrInboundBundleV1 | null; issues: InboundIssue[] } {
  const issues: InboundIssue[] = [];
  const bundle = input as FhirBundle;

  if (!bundle || typeof bundle !== "object" || str(bundle.resourceType) !== "Bundle") {
    return {
      bundle: null,
      issues: [
        {
          severity: "error",
          code: "not_a_fhir_bundle",
          field: "resourceType",
          message: "Payload must be a FHIR R4 Bundle.",
        },
      ],
    };
  }

  const { byType, byRef } = collect(bundle);

  const appointment = (byType.get("Appointment") || [])[0] || null;
  const encounter = (byType.get("Encounter") || [])[0] || null;
  const coverage = (byType.get("Coverage") || [])[0] || null;

  let patient: FhirResource | null = (byType.get("Patient") || [])[0] || null;
  if (!patient && appointment) {
    patient = resolve(byRef, participantRef(appointment, "Patient/"));
  }
  if (!patient && encounter) {
    patient = resolve(byRef, encounter.subject);
  }

  if (!patient) {
    issues.push({
      severity: "error",
      code: "missing_patient_resource",
      field: "Bundle.entry",
      message: "Bundle must contain a Patient resource.",
    });
  }

  const name = humanName(patient);
  const addr = address(patient);

  let practitioner: FhirResource | null = (byType.get("Practitioner") || [])[0] || null;
  if (!practitioner && appointment) {
    practitioner = resolve(byRef, participantRef(appointment, "Practitioner/"));
  }

  let location: FhirResource | null = (byType.get("Location") || [])[0] || null;
  if (!location && appointment) {
    location = resolve(byRef, participantRef(appointment, "Location/"));
  }

  const payerOrg = coverage ? resolve(byRef, (coverage.payor || [])[0]) : null;
  const payerName = str(payerOrg?.name) || str((coverage?.payor || [])[0]?.display);

  const start = str(appointment?.start) || str(encounter?.period?.start);
  const end = str(appointment?.end) || str(encounter?.period?.end);
  let durationMinutes = Number(appointment?.minutesDuration) || 0;
  if (!durationMinutes && start && end) {
    const delta = new Date(end).getTime() - new Date(start).getTime();
    if (delta > 0) durationMinutes = Math.round(delta / 60_000);
  }
  if (!durationMinutes) durationMinutes = 30;

  if (!start) {
    issues.push({
      severity: "error",
      code: "missing_appointment_time",
      field: "Appointment.start",
      message: "Bundle must contain an Appointment.start or Encounter.period.start.",
    });
  }

  const providerNpi = identifierBySystem(practitioner, NPI_SYSTEM);
  const facilityNpi = identifierBySystem(location, NPI_SYSTEM);
  if (!providerNpi && practitioner) {
    issues.push({
      severity: "warning",
      code: "practitioner_without_npi",
      field: "Practitioner.identifier",
      message: "Practitioner has no NPI identifier; provider mapping may fail.",
      suggestion: `Include an identifier with system ${NPI_SYSTEM}.`,
    });
  }

  const normalized: EhrInboundBundleV1 = {
    schemaVersion: "1",
    sourceSystem: str(options?.sourceSystem) || sourceFromMeta(bundle) || "fhir",
    sourceLabel: str(options?.sourceLabel) || "FHIR R4",
    eventType: "day_appointment",
    externalIds: {
      patient: str(patient?.id) || undefined,
      appointment: str(appointment?.id) || undefined,
      encounter: str(encounter?.id) || undefined,
      coverage: str(coverage?.id) || undefined,
    },
    patient: {
      firstName: name.first,
      middleName: name.middle || undefined,
      lastName: name.last,
      dateOfBirth: dateOnly(patient?.birthDate),
      sex: sexFrom(patient?.gender),
      addressLine1: addr.line1,
      addressLine2: addr.line2 || undefined,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      phone: telecom(patient, "phone") || undefined,
      email: telecom(patient, "email") || undefined,
    },
    appointment: {
      startAt: start,
      durationMinutes,
      appointmentType: codeableText(appointment?.appointmentType) || "Office visit",
      reason:
        codeableText(appointment?.reasonCode) ||
        str(appointment?.description) ||
        codeableText(encounter?.reasonCode) ||
        undefined,
    },
    mapping: {
      providerNpi: providerNpi || undefined,
      facilityNpi: facilityNpi || undefined,
      facilityCode: str(location?.id) || undefined,
    },
  };

  if (coverage) {
    normalized.coverage = {
      payerName,
      planName: coverageClass(coverage, "plan") || codeableText(coverage.type) || payerName,
      memberId: str(coverage.subscriberId) || identifierBySystem(coverage, "") || str((coverage.identifier || [])[0]?.value),
      groupNumber: coverageClass(coverage, "group") || undefined,
      relationship: relationshipFrom(coverage),
      subscriberSameAsPatient: relationshipFrom(coverage) === "self",
      effectiveDate: dateOnly(coverage.period?.start) || undefined,
      terminationDate: dateOnly(coverage.period?.end) || undefined,
    };
    if (!payerName) {
      issues.push({
        severity: "error",
        code: "missing_payer",
        field: "Coverage.payor",
        message: "Coverage has no resolvable payor Organization.",
      });
    }
  }

  if (encounter) {
    normalized.encounter = {
      dateOfService: dateOnly(encounter.period?.start) || dateOnly(start) || undefined,
      chiefComplaint: codeableText(encounter.reasonCode) || undefined,
    };
  }

  return { bundle: normalized, issues };
}
