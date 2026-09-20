type NoteRow = Record<string, unknown>;

function text(row: NoteRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function shortDate(input: unknown, includeTime = false) {
  if (!input) return "";
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function sentence(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function joinClauses(clauses: string[]) {
  const clean = clauses.map((item) => item.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join("; ")}; and ${clean[clean.length - 1]}`;
}

export type EncounterNoteInput = {
  patientName: string;
  providerName: string;
  dateOfService: string;
  checkedInAt?: string;
  billingContext?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  reviewOfSystems?: string;
  physicalExam?: string;
  assessment?: string;
  treatmentPlan?: string;
  followUpInstructions?: string;
  clinicalNote?: string;
  diagnosisCodes?: string;
  procedureCodes?: string;
  allergiesReviewed?: boolean;
  medicationsReviewed?: boolean;
  height?: string;
  weight?: string;
  temperature?: string;
  pulse?: string;
  respirations?: string;
  systolic?: string;
  diastolic?: string;
  oxygenSaturation?: string;
  painScore?: string;
  referringProviderLabel?: string;
  visitTimeMinutes?: string;
  subjective: {
    source?: string;
    sourceDetails?: string;
    interpreter?: string;
    patientConcern?: string;
    patientGoal?: string;
    treatmentPreference?: string;
    clinicianObservation?: string;
    medicalHistory?: Array<{ condition: string; status: string; notes?: string }>;
    familyHistory?: Array<{ relationship: string; condition: string; notes?: string }>;
    psychiatricHistory?: string;
    socialHistory?: string;
    priorInvestigations?: string;
    priorTreatments?: string;
    otherRelevantInfo?: string;
    historySelections?: Array<{ group: string; label: string; note?: string }>;
    socialHistoryDetails?: Record<string, string | undefined>;
    rosSelections?: Array<{ system: string; symptom: string; status: "positive" | "negative"; note?: string }>;
    rosNormalSystems?: string[];
  };
  allergies: NoteRow[];
  medications: NoteRow[];
};

function formatAllergy(row: NoteRow) {
  if (text(row, "allergyType") === "nkda") return "no known drug allergies (NKDA)";
  const substance = text(row, "substance");
  const reaction = text(row, "reaction");
  const severity = text(row, "severity");
  const type = text(row, "allergyType");
  const detail = [
    type && type !== "other" ? `${type}` : "",
    reaction ? `reaction: ${reaction}` : "",
    severity && severity !== "unknown" ? `${severity} severity` : "",
  ].filter(Boolean).join("; ");
  return detail ? `${substance} (${detail})` : substance;
}

function formatMedication(row: NoteRow) {
  return [text(row, "medicationName"), text(row, "dose"), text(row, "route"), text(row, "frequency")].filter(Boolean).join(" ");
}

function vitalsSentence(input: EncounterNoteInput) {
  const parts = [
    input.height && `height ${input.height} cm`,
    input.weight && `weight ${input.weight} lb`,
    input.temperature && `temperature ${input.temperature} °F`,
    input.pulse && `heart rate ${input.pulse} bpm`,
    input.respirations && `respiratory rate ${input.respirations}/min`,
    input.systolic && `blood pressure ${input.systolic}${input.diastolic ? `/${input.diastolic}` : ""} mm Hg`,
    input.oxygenSaturation && `oxygen saturation ${input.oxygenSaturation}% on room air unless otherwise noted`,
    input.painScore !== undefined && input.painScore !== "" && `pain score ${input.painScore}/10`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "";
  return `Vital signs today: ${joinClauses(parts)}.`;
}

function socialHistorySentence(social: Record<string, string | undefined>) {
  const parts = [
    social.tobaccoStatus && `tobacco use ${social.tobaccoStatus}${social.tobaccoType ? ` (${social.tobaccoType}` : ""}${social.tobaccoAmount ? `${social.tobaccoType ? "; " : " ("}${social.tobaccoAmount}/day` : ""}${social.tobaccoYears ? `; ${social.tobaccoYears} years` : ""}${social.tobaccoQuitDate ? `; quit ${social.tobaccoQuitDate}` : ""}${social.tobaccoType || social.tobaccoAmount || social.tobaccoYears || social.tobaccoQuitDate ? ")" : ""}`,
    social.alcoholStatus && `alcohol use ${social.alcoholStatus}${social.alcoholFrequency ? `, ${social.alcoholFrequency.replaceAll("_", " ")}` : ""}${social.alcoholAmount ? `, ${social.alcoholAmount} drinks per occasion` : ""}`,
    social.drugStatus && `recreational drug use ${social.drugStatus}${social.drugSubstances ? ` (${social.drugSubstances})` : ""}`,
    social.occupation && `occupation: ${social.occupation}`,
    social.livingSituation && `living situation: ${social.livingSituation.replaceAll("_", " ")}`,
    social.physicalActivity && `physical activity: ${social.physicalActivity.replaceAll("_", " ")}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "";
  return `Social history: ${joinClauses(parts)}.`;
}

/** Assembles a flowing clinical draft from structured visit data. Does not invent findings. */
export function buildEncounterNoteDraft(input: EncounterNoteInput) {
  const patient = input.patientName || "The patient";
  const provider = input.providerName || "the treating clinician";
  const dos = input.dateOfService || "the recorded date of service";
  const complaint = String(input.chiefComplaint || "").trim();
  const hpi = String(input.historyOfPresentIllness || "").trim();
  const ros = String(input.reviewOfSystems || "").trim();
  const exam = String(input.physicalExam || "").trim();
  const assessment = String(input.assessment || "").trim();
  const plan = String(input.treatmentPlan || "").trim();
  const followUp = String(input.followUpInstructions || "").trim();
  const additional = String(input.clinicalNote || "").trim();
  const dx = String(input.diagnosisCodes || "").trim();
  const cpt = String(input.procedureCodes || "").trim();
  const minutes = String(input.visitTimeMinutes || "").trim();
  const subjective = input.subjective || {};
  const sourceName = subjective.source === "patient"
    ? "the patient"
    : subjective.source === "subscriber"
      ? "the insurance subscriber"
      : (subjective.sourceDetails || String(subjective.source || "the informant").replaceAll("_", " "));

  const context: string[] = [];
  context.push(sentence([
    input.checkedInAt
      ? `${patient} presented and checked in at ${shortDate(input.checkedInAt, true)}`
      : `${patient} presents`,
    complaint ? `for evaluation of ${complaint.replace(/\.$/, "")}` : "for today's clinical encounter",
    `with ${provider} on ${dos}.`,
  ]));
  if (input.referringProviderLabel) context.push(`Referral source: ${input.referringProviderLabel}.`);
  if (input.billingContext) context.push(`Visit context: ${String(input.billingContext).replaceAll("_", " ")}.`);
  context.push(`History was obtained from ${sourceName}${subjective.interpreter === "yes" ? " with interpreter assistance" : subjective.interpreter === "declined" ? "; interpreter services were offered and declined" : ""}.`);

  const subjectiveLines: string[] = [];
  if (complaint) subjectiveLines.push(`Chief complaint: ${complaint.replace(/\.$/, "")}.`);
  if (hpi) subjectiveLines.push(`History of present illness: ${hpi}`);
  const medical = (subjective.medicalHistory || []).map((row) => `${row.condition} (${row.status})${row.notes ? ` — ${row.notes}` : ""}`);
  if (medical.length) subjectiveLines.push(`Past medical history includes ${joinClauses(medical)}.`);
  const family = (subjective.familyHistory || []).map((row) => `${row.relationship} with ${row.condition}${row.notes ? ` (${row.notes})` : ""}`);
  if (family.length) subjectiveLines.push(`Family history is notable for ${joinClauses(family)}.`);
  const structured = (subjective.historySelections || []).map((item) => `${item.group.replaceAll("_", " ")}: ${item.label}${item.note ? ` — ${item.note}` : ""}`);
  if (structured.length) subjectiveLines.push(`Additional history: ${joinClauses(structured)}.`);
  if (subjective.psychiatricHistory) subjectiveLines.push(`Psychiatric history: ${subjective.psychiatricHistory}`);
  if (subjective.priorInvestigations) subjectiveLines.push(`Prior investigations: ${subjective.priorInvestigations}`);
  if (subjective.priorTreatments) subjectiveLines.push(`Prior treatments: ${subjective.priorTreatments}`);
  const socialSentence = socialHistorySentence(subjective.socialHistoryDetails || {});
  if (socialSentence) subjectiveLines.push(socialSentence);
  else if (subjective.socialHistory) subjectiveLines.push(`Social history: ${subjective.socialHistory}`);
  if (subjective.otherRelevantInfo) subjectiveLines.push(`Other relevant history: ${subjective.otherRelevantInfo}`);
  if (ros) subjectiveLines.push(`Review of systems: ${ros}`);
  if (subjective.patientConcern) subjectiveLines.push(`The patient’s primary concern is ${subjective.patientConcern.replace(/\.$/, "")}.`);
  if (subjective.patientGoal) subjectiveLines.push(`Goals for today’s visit include ${subjective.patientGoal.replace(/\.$/, "")}.`);
  if (subjective.treatmentPreference) subjectiveLines.push(`Treatment preferences: ${subjective.treatmentPreference}`);

  const activeAllergies = input.allergies.filter((row) => text(row, "status") === "active" || text(row, "status") === "");
  const safetyLines: string[] = [];
  if (activeAllergies.length) {
    const allergyText = joinClauses(activeAllergies.map(formatAllergy));
    safetyLines.push(`Allergies: ${allergyText}.`);
    safetyLines.push(input.allergiesReviewed
      ? "Allergy list was reviewed and reconciled for this encounter."
      : "Allergy list is recorded; formal reconciliation for this encounter is still pending.");
  } else {
    safetyLines.push("Allergy status is not documented for this encounter.");
  }
  if (input.medications.length) {
    safetyLines.push(`Current medications: ${joinClauses(input.medications.map(formatMedication))}.`);
    safetyLines.push(input.medicationsReviewed
      ? "Medication list was reviewed for this encounter."
      : "Medication reconciliation for this encounter is pending.");
  } else {
    safetyLines.push("No active medications are recorded on the chart.");
    if (input.medicationsReviewed) safetyLines.push("Medication status was reviewed; no active medications identified.");
  }

  const objectiveLines: string[] = [];
  const vitals = vitalsSentence(input);
  if (vitals) objectiveLines.push(vitals);
  if (subjective.clinicianObservation) objectiveLines.push(`Clinician observations: ${subjective.clinicianObservation}`);
  if (exam) objectiveLines.push(`Physical examination: ${exam}`);

  const assessmentLines: string[] = [];
  if (assessment) assessmentLines.push(assessment);
  if (dx) assessmentLines.push(`Assessment codes addressed today: ${dx}.`);

  const planLines: string[] = [];
  if (plan) planLines.push(plan);
  if (minutes) {
    planLines.push(`Total time spent on the date of the encounter was ${minutes} minutes, inclusive of face-to-face evaluation and medically appropriate non-face-to-face work performed on the same calendar day.`);
  }
  if (followUp) planLines.push(`Follow-up and precautions: ${followUp}`);
  if (additional) planLines.push(`Additional clinical notes: ${additional}`);
  if (cpt) planLines.push(`Services/procedures documented for this visit: ${cpt}.`);

  const sections = [
    ["ENCOUNTER CONTEXT", context],
    ["SUBJECTIVE", subjectiveLines],
    ["SAFETY REVIEW", safetyLines],
    ["OBJECTIVE", objectiveLines],
    ["ASSESSMENT", assessmentLines],
    ["PLAN", planLines],
  ] as const;

  return sections
    .map(([title, lines]) => `${title}\n${lines.length ? lines.join("\n\n") : "Not yet documented."}`)
    .join("\n\n");
}

export function encounterNoteGaps(input: EncounterNoteInput) {
  const missing: string[] = [];
  if (!String(input.chiefComplaint || "").trim()) missing.push("Chief complaint");
  if (!String(input.historyOfPresentIllness || "").trim()) missing.push("HPI");
  if (!String(input.physicalExam || "").trim() && !input.systolic && !input.pulse) missing.push("Objective findings");
  if (!String(input.assessment || "").trim()) missing.push("Assessment");
  if (!String(input.treatmentPlan || "").trim() && !String(input.visitTimeMinutes || "").trim()) missing.push("Plan");
  return missing;
}
