/** Clinical document categories relevant to same-day Objective review. */
export const OBJECTIVE_DOCUMENT_CATEGORIES = [
  "lab_result",
  "imaging_report",
  "pathology_report",
  "medical_record",
  "specialist_note",
  "discharge_summary",
  "medication_list",
  "referral",
  "other",
] as const;

export type ObjectiveDocumentCategory = (typeof OBJECTIVE_DOCUMENT_CATEGORIES)[number];

export const OBJECTIVE_DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  lab_result: "Lab result",
  imaging_report: "Imaging report",
  pathology_report: "Pathology report",
  medical_record: "Medical record",
  specialist_note: "Specialist note",
  discharge_summary: "Discharge summary",
  medication_list: "Medication list",
  referral: "Referral",
  other: "Other clinical document",
};

export const DOCUMENT_INTERPRET_CATEGORIES = new Set([
  "lab_result",
  "imaging_report",
  "pathology_report",
  "medical_record",
  "specialist_note",
  "discharge_summary",
  "medication_list",
  "referral",
  "other",
]);

export type DocumentInterpretation = {
  reportType?: string;
  documentDate?: string;
  summary?: string;
  headsUp?: string;
  urgentFindings?: string[];
  notableValues?: Array<{ label?: string; value?: string; flag?: string; note?: string } | string>;
  limitations?: string[];
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
  model?: string;
  analyzedAt?: string;
  reviewed?: boolean;
};

function dateOnly(input: string | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function isSameDayClinicalDocument(
  doc: { category?: string; serviceDate?: string; createdAt?: string; status?: string },
  dateOfService: string,
) {
  const dos = dateOnly(dateOfService);
  if (!dos) return false;
  if (String(doc.status || "active") !== "active") return false;
  if (!OBJECTIVE_DOCUMENT_CATEGORIES.includes(doc.category as ObjectiveDocumentCategory)) return false;
  const service = dateOnly(doc.serviceDate);
  const uploaded = dateOnly(doc.createdAt);
  return service === dos || (!service && uploaded === dos);
}

function asStringList(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return input.map((item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      return String(row.text || row.finding || row.label || row.value || "").trim();
    }
    return "";
  }).filter(Boolean);
}

export function parseDocumentInterpretation(analysisJson: string | undefined): DocumentInterpretation | null {
  const raw = String(analysisJson || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DocumentInterpretation;
  } catch {
    return { summary: raw };
  }
}

/** Provider-facing heads-up text: urgent items first, then summary and key values. */
export function formatProviderHeadsUp(analysisJson: string | undefined) {
  const parsed = parseDocumentInterpretation(analysisJson);
  if (!parsed) return "";

  const lines: string[] = [];
  const urgent = asStringList(parsed.urgentFindings);
  const headsUp = String(parsed.headsUp || "").trim();
  if (urgent.length) {
    lines.push(`HEADS-UP: ${urgent.join("; ")}`);
  } else if (headsUp) {
    lines.push(`HEADS-UP: ${headsUp}`);
  }

  const summary = String(parsed.summary || "").trim();
  if (summary) lines.push(summary);

  const notables = Array.isArray(parsed.notableValues) ? parsed.notableValues : Array.isArray((parsed as { results?: unknown[] }).results) ? (parsed as { results: unknown[] }).results : [];
  for (const item of notables.slice(0, 10)) {
    if (typeof item === "string") {
      if (item.trim()) lines.push(`• ${item.trim()}`);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label || row.testName || row.name || "").trim();
    const value = String(row.value || "").trim();
    const flag = String(row.flag || "").trim();
    const note = String(row.note || "").trim();
    const piece = [label && value ? `${label}: ${value}` : label || value, flag && flag !== "normal" ? `(${flag})` : "", note].filter(Boolean).join(" ");
    if (piece) lines.push(`• ${piece}`);
  }

  const limitations = asStringList(parsed.limitations);
  if (limitations.length) lines.push(`Limitations: ${limitations.slice(0, 3).join("; ")}`);

  return lines.join("\n").trim();
}

export function summarizeDocumentAnalysis(analysisJson: string | undefined) {
  return formatProviderHeadsUp(analysisJson);
}

export function hasUrgentDocumentHeadsUp(analysisJson: string | undefined) {
  const parsed = parseDocumentInterpretation(analysisJson);
  if (!parsed) return false;
  if (asStringList(parsed.urgentFindings).length) return true;
  return Boolean(String(parsed.headsUp || "").trim());
}

export type VisitDiagnosticAiSummary = {
  id: string;
  title: string;
  category: string;
  text: string;
  urgent: boolean;
};

/** Same-day lab/imaging AI heads-ups + Objective diagnostic notes for Assessment plan rationale. */
export function collectVisitAiDiagnosticSummaries(input: {
  patientId?: string;
  dateOfService?: string;
  documents?: Array<Record<string, unknown>>;
  diagnosticNotes?: string;
}): VisitDiagnosticAiSummary[] {
  const patientId = String(input.patientId || "").trim();
  const dateOfService = String(input.dateOfService || "").trim();
  const rows: VisitDiagnosticAiSummary[] = [];

  for (const doc of input.documents || []) {
    if (!patientId || String(doc.patientId || "") !== patientId) continue;
    if (!isSameDayClinicalDocument({
      category: String(doc.category || ""),
      serviceDate: String(doc.serviceDate || ""),
      createdAt: String(doc.createdAt || ""),
      status: String(doc.status || "active"),
    }, dateOfService)) continue;

    const analysisJson = String(doc.analysisJson || "");
    const text = formatProviderHeadsUp(analysisJson);
    if (!text) continue;
    const title = String(doc.title || doc.fileName || "Clinical document").trim();
    const category = String(doc.category || "other");
    rows.push({
      id: String(doc.id || `${category}:${title}`),
      title,
      category,
      text,
      urgent: hasUrgentDocumentHeadsUp(analysisJson),
    });
  }

  const notes = String(input.diagnosticNotes || "").trim();
  if (notes) {
    const alreadyCovered = rows.some((row) => notes.includes(row.text.slice(0, 80)) || row.text.includes(notes.slice(0, 80)));
    if (!alreadyCovered) {
      rows.push({
        id: "objective-diagnostic-notes",
        title: "Objective diagnostic notes",
        category: "diagnostic_notes",
        text: notes,
        urgent: /^HEADS-UP:/m.test(notes),
      });
    }
  }

  return rows;
}

export function formatVisitAiSummariesForPlan(rows: VisitDiagnosticAiSummary[]) {
  if (!rows.length) return "";
  return rows.map((row) => {
    const label = row.category === "diagnostic_notes"
      ? row.title
      : `${OBJECTIVE_DOCUMENT_CATEGORY_LABELS[row.category] || "Document"}: ${row.title}`;
    return `${label}\n${row.text}`;
  }).join("\n\n");
}

export function mergePlanRationaleWithAiSummary(current: string, aiSummary: string) {
  const existing = String(current || "").trim();
  const addition = String(aiSummary || "").trim();
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}\n\nLabs & reports (AI draft — verify):\n${addition}`;
}

export const documentInterpretationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reportType", "documentDate", "summary", "headsUp", "urgentFindings", "notableValues", "limitations"],
  properties: {
    reportType: { type: "string" },
    documentDate: { type: "string" },
    summary: { type: "string" },
    headsUp: { type: "string" },
    urgentFindings: { type: "array", items: { type: "string" } },
    notableValues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "flag", "note"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          flag: { type: "string", enum: ["normal", "high", "low", "critical_high", "critical_low", "abnormal", "unknown"] },
          note: { type: "string" },
        },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildDocumentInterpretInstructions() {
  return [
    "You are a clinical documentation assistant preparing a brief provider HEADS-UP from a scanned or uploaded medical document.",
    "Extract only what is readable on the document. Prefer numbers, units, dates, and printed flags.",
    "urgentFindings / headsUp: items a clinician should notice quickly (critical labs, acute imaging language, allergies, anticoagulation, infection markers).",
    "summary: 2–4 short factual sentences for the visit Objective.",
    "notableValues: measurable results with value and flag when printed.",
    "Never diagnose, prescribe, predict disease, invent missing values, choose billing codes, or recommend revenue-generating services.",
    "If image quality is poor, say so in limitations and lower confidence by marking unclear flags as unknown.",
    "This output is a draft for clinician review only — not part of the legal medical record until the clinician accepts it.",
  ].join(" ");
}
