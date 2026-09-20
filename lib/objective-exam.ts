export type ExamFinding = {
  id: string;
  system: string;
  finding: string;
  status: "normal" | "abnormal";
  detail?: string;
};

export const EXAM_SYSTEMS = [
  "heent",
  "lymphatic",
  "cardiovascular",
  "respiratory",
  "abdomen",
  "musculoskeletal",
  "skin",
  "neurologic",
  "psychiatric",
] as const;

export type ExamSystem = (typeof EXAM_SYSTEMS)[number];

export const EXAM_SYSTEM_LABELS: Record<string, string> = {
  general: "General",
  heent: "HEENT",
  cardiovascular: "Cardiovascular",
  respiratory: "Respiratory",
  abdomen: "Abdomen",
  musculoskeletal: "Musculoskeletal",
  neurologic: "Neurologic",
  skin: "Skin",
  psychiatric: "Psychiatric",
  lymphatic: "Lymphatic",
};

/** Short, specific normals — avoid vague “WNL”. */
export const EXAM_NORMAL_PHRASES: Record<string, string> = {
  general: "Alert, no acute distress.",
  heent: "Normocephalic. Mucous membranes moist. Pupils equal and reactive.",
  cardiovascular: "Regular rate and rhythm. No murmurs, rubs, or gallops.",
  respiratory: "Lungs clear bilaterally. No wheezing.",
  abdomen: "Soft, non-tender. No rebound or guarding.",
  musculoskeletal: "Full range of motion. No joint swelling.",
  neurologic: "Alert and oriented ×3. Gait steady. No focal deficit.",
  skin: "No rash. Intact, warm, dry.",
  psychiatric: "Affect congruent. Speech coherent. Eye contact appropriate.",
  lymphatic: "No cervical, axillary, or inguinal lymphadenopathy.",
};

/** Quick insert phrases by system (measurable / observable). */
export const OBJECTIVE_PHRASE_BANK: Record<string, string[]> = {
  general: [
    "Alert and oriented ×3",
    "No acute distress",
    "Sitting with slumped posture",
    "Sitting comfortably",
  ],
  heent: [
    "Pupils equal and reactive",
    "Mild nasal discharge",
    "Oropharynx erythematous",
    "TMs clear bilaterally",
  ],
  cardiovascular: [
    "Regular rate and rhythm",
    "No edema in lower limbs",
    "2+ distal pulses",
    "S1 S2 without murmur",
  ],
  respiratory: [
    "Lungs clear bilaterally",
    "No wheezing",
    "Scattered rhonchi",
    "Crackles at bases",
  ],
  abdomen: [
    "Soft, no tenderness",
    "Soft, non-tender, non-distended",
    "Guarding in right lower quadrant",
    "Bowel sounds present",
  ],
  musculoskeletal: [
    "Full ROM",
    "ROM left knee: 80° flexion, 10° extension",
    "Strength 4/5 left leg, 5/5 right",
    "Gait assisted with cane",
  ],
  neurologic: [
    "Alert and oriented ×3",
    "No tremors",
    "Gait steady",
    "Speech slow but coherent",
  ],
  skin: [
    "No rash",
    "Wound 4 cm × 3 cm, depth 0.5 cm",
    "Moderate serous drainage",
    "Surrounding skin erythematous, not warm",
  ],
  psychiatric: [
    "Affect flat",
    "Eye contact limited",
    "Speech slow but coherent",
    "Pacing and fidgeting",
  ],
  lymphatic: [
    "No lymphadenopathy",
    "Cervical nodes non-tender",
  ],
};

export type ObjectiveSpecialtyId =
  | "primary_care"
  | "mental_health"
  | "physical_therapy"
  | "pediatrics"
  | "wound_care";

export type ObjectiveSpecialtyStarter = {
  id: ObjectiveSpecialtyId;
  label: string;
  hint: string;
  normals: string[];
  findings: Array<{ system: string; finding: string; status: "normal" | "abnormal"; detail?: string }>;
  observations?: string;
  diagnostics?: string;
};

/** Specialty starters matching common Objective SOAP patterns. */
export const OBJECTIVE_SPECIALTY_STARTERS: ObjectiveSpecialtyStarter[] = [
  {
    id: "primary_care",
    label: "Primary care",
    hint: "Vitals + multi-system exam + clinic labs",
    normals: ["respiratory", "abdomen"],
    findings: [
      { system: "general", finding: "Alert and oriented ×3", status: "normal" },
      { system: "respiratory", finding: "Lungs clear bilaterally", status: "normal" },
      { system: "abdomen", finding: "Soft, no tenderness", status: "normal" },
    ],
    observations: "",
    diagnostics: "",
  },
  {
    id: "mental_health",
    label: "Mental health",
    hint: "Appearance, speech, psychomotor — medical vitals/labs only",
    normals: ["neurologic"],
    findings: [
      { system: "psychiatric", finding: "Affect flat", status: "abnormal" },
      { system: "psychiatric", finding: "Eye contact limited", status: "abnormal" },
      { system: "neurologic", finding: "Speech slow but coherent", status: "abnormal" },
      { system: "neurologic", finding: "No tremors. Gait steady", status: "normal" },
    ],
    diagnostics: "Lab results: TSH ___ (pending or value)",
  },
  {
    id: "physical_therapy",
    label: "Physical therapy",
    hint: "Gait, ROM degrees, strength 0–5, pain scores",
    normals: [],
    findings: [
      { system: "musculoskeletal", finding: "Gait assisted with cane. Stride length reduced", status: "abnormal" },
      { system: "musculoskeletal", finding: "ROM left knee", status: "abnormal", detail: "80° flexion, 10° extension" },
      { system: "musculoskeletal", finding: "Strength", status: "abnormal", detail: "4/5 left leg, 5/5 right" },
    ],
    observations: "Pain score: __/10 before session, __/10 after.",
  },
  {
    id: "pediatrics",
    label: "Pediatrics",
    hint: "Age-appropriate vitals, focused exam, rapid tests",
    normals: [],
    findings: [
      { system: "general", finding: "Child appears tired", status: "abnormal" },
      { system: "heent", finding: "Mild nasal discharge", status: "abnormal" },
      { system: "respiratory", finding: "Scattered rhonchi", status: "abnormal" },
    ],
    diagnostics: "Rapid flu test: pending / negative / positive.",
  },
  {
    id: "wound_care",
    label: "Wound care",
    hint: "Location, size, depth, drainage, surrounding skin",
    normals: [],
    findings: [
      {
        system: "skin",
        finding: "Wound right lower leg",
        status: "abnormal",
        detail: "Size 4 cm × 3 cm. Depth 0.5 cm. Moderate serous drainage. Edges clean. Surrounding skin slightly red, not warm. No foul odor.",
      },
    ],
    observations: "Pain score __/10 during dressing change. No signs of infection observed at this time.",
  },
];

const SUBJECTIVE_OBJECTIVE_PATTERNS: Array<{ pattern: RegExp; tip: string }> = [
  { pattern: /\bseems?\b/i, tip: "Avoid “seems” — describe what you observed." },
  { pattern: /\bmaybe\b/i, tip: "Avoid “maybe” — leave uncertain items out or write “unable to assess.”" },
  { pattern: /\bappears anxious\b/i, tip: "Replace “appears anxious” with observed behavior (e.g. pacing, fidgeting)." },
  { pattern: /\blooks (sad|better|worse)\b/i, tip: "Replace opinion with observable facts (tearful, slow movement)." },
  { pattern: /\b(better|worse)\b(?!\s*(than|with|on)\b)/i, tip: "Avoid “better/worse” without numbers (scores, ROM, vitals)." },
  { pattern: /\bWNL\b|\bwithin normal limits\b/i, tip: "Avoid WNL — write the specific normal finding." },
  { pattern: /\bI (think|believe|feel)\b/i, tip: "Interpretation belongs in Assessment, not Objective." },
];

export function examSystemLabel(system: string) {
  return EXAM_SYSTEM_LABELS[system] || system.replaceAll("_", " ");
}

export function findSubjectiveObjectiveIssues(text: string) {
  const input = String(text || "");
  if (!input.trim()) return [] as Array<{ tip: string }>;
  const found: Array<{ tip: string }> = [];
  for (const row of SUBJECTIVE_OBJECTIVE_PATTERNS) {
    if (row.pattern.test(input) && !found.some((item) => item.tip === row.tip)) {
      found.push({ tip: row.tip });
    }
  }
  return found;
}

export function polishObjectiveLocally(input: string) {
  let text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text
    .replace(/\bWNL\b/gi, "")
    .replace(/\bwithin normal limits\b/gi, "")
    .replace(/\bseems?\b/gi, "")
    .replace(/\bmaybe\b/gi, "")
    .replace(/\bappears anxious\b/gi, "pacing and fidgeting")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim().replace(/^[,;.\s]+/, ""))
    .filter(Boolean)
    .map((sentence) => {
      const capped = sentence.charAt(0).toUpperCase() + sentence.slice(1);
      return /[.!?]$/.test(capped) ? capped : `${capped}.`;
    });
  return sentences.join(" ");
}

export function groupExamFindingsBySystem(findings: ExamFinding[] = []) {
  const buckets = new Map<string, ExamFinding[]>();
  for (const item of findings) {
    const key = item.system || "general";
    const list = buckets.get(key) || [];
    list.push(item);
    buckets.set(key, list);
  }
  const ranked = [...buckets.entries()].sort((a, b) => {
    const aAbnormal = a[1].some((item) => item.status === "abnormal") ? 0 : 1;
    const bAbnormal = b[1].some((item) => item.status === "abnormal") ? 0 : 1;
    if (aAbnormal !== bAbnormal) return aAbnormal - bAbnormal;
    const aIndex = EXAM_SYSTEMS.indexOf(a[0] as ExamSystem);
    const bIndex = EXAM_SYSTEMS.indexOf(b[0] as ExamSystem);
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
  });
  return ranked.map(([system, items]) => ({
    system,
    label: examSystemLabel(system),
    hasAbnormal: items.some((item) => item.status === "abnormal"),
    items,
  }));
}

export function buildPhysicalExamText(input: {
  examNormalSystems?: string[];
  examFindings?: ExamFinding[];
  diagnosticNotes?: string;
  generalAppearance?: string;
  clinicGlucose?: string;
}) {
  const appearance = String(input.generalAppearance || "").trim();
  const grouped = groupExamFindingsBySystem(input.examFindings || []);
  const findingSystems = new Set(grouped.map((row) => row.system));
  const normals = (input.examNormalSystems || [])
    .filter((system) => !findingSystems.has(system))
    .map((system) => {
      const phrase = EXAM_NORMAL_PHRASES[system] || "No acute abnormalities noted.";
      return `${examSystemLabel(system)}: ${phrase}`;
    });

  function formatItem(item: ExamFinding) {
    const detail = item.detail?.trim();
    const finding = item.finding.trim().replace(/\.$/, "");
    return detail ? `${finding} — ${detail}` : finding;
  }

  const findingLines = grouped.map((group) => {
    const body = group.items.map(formatItem).join(". ");
    return `${group.label}: ${body}.`;
  });

  const parts: string[] = [];
  if (appearance) parts.push(`General appearance: ${appearance.replace(/\.$/, "")}.`);
  // Groups already rank abnormal systems first.
  parts.push(...findingLines);
  parts.push(...normals);

  const glucose = String(input.clinicGlucose || "").trim();
  if (glucose) parts.push(`Clinic glucose: ${glucose}${/mg\/?dL/i.test(glucose) ? "" : " mg/dL"}.`);

  const diagnostic = String(input.diagnosticNotes || "").trim();
  if (diagnostic) parts.push(`Diagnostic / lab data reviewed today: ${diagnostic}`);
  return parts.join("\n");
}

/** Specialty starters replace the structured exam so clicking several templates does not stack duplicate systems. */
export function applySpecialtyStarter(
  current: {
    examNormalSystems?: string[];
    examFindings?: ExamFinding[];
    diagnosticNotes?: string;
    clinicianObservation?: string;
  },
  starter: ObjectiveSpecialtyStarter,
) {
  const examFindings = starter.findings.map((row, index) => ({
    id: `exam-${starter.id}-${index}-${Date.now().toString(36)}`,
    system: row.system,
    finding: row.finding,
    status: row.status,
    detail: row.detail || "",
  }));
  const abnormalSystems = new Set(
    examFindings.filter((item) => item.status === "abnormal").map((item) => item.system),
  );
  const examNormalSystems = starter.normals.filter((system) => !abnormalSystems.has(system));
  const starterDiagnostics = starter.diagnostics?.trim() || "";
  const starterObservations = starter.observations?.trim() || "";

  return {
    examNormalSystems,
    examFindings,
    diagnosticNotes: starterDiagnostics || String(current.diagnosticNotes || ""),
    clinicianObservation: starterObservations || String(current.clinicianObservation || ""),
  };
}

export function isObjectiveVerifiedForDos(verifiedDos: string | undefined, dateOfService: string | undefined) {
  const verified = String(verifiedDos || "").trim();
  const dos = String(dateOfService || "").trim();
  return Boolean(verified && dos && verified === dos);
}

export function computeBmiFromMetric(heightCm: string | number | undefined, weightLb: string | number | undefined) {
  const height = Number(heightCm);
  const weight = Number(weightLb);
  if (!(height > 0 && weight > 0)) return null;
  const bmi = (weight * 0.45359237) / ((height / 100) ** 2);
  return Math.round(bmi * 10) / 10;
}
