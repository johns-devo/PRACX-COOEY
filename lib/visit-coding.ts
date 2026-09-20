export type CodingKind = "diagnosis" | "procedure" | "modifier" | "quality";

export type CodingSuggestion = {
  id: string;
  kind: CodingKind;
  code: string;
  label: string;
  reason: string;
  selected: boolean;
};

export type CounselingOption = {
  key: string;
  label: string;
  planText: string;
  diagnosisCodes?: string[];
  procedureCodes?: string[];
  qualityCodes?: string[];
};

export type QualityOption = {
  key: string;
  label: string;
  planText: string;
  qualityCodes: string[];
};

export type CodingAssistState = {
  templateId: string;
  templateName: string;
  templateCategory: string;
  visitTimeMinutes: string;
  counselingKeys: string[];
  qualityKeys: string[];
  selectedIds: string[];
};

export const COUNSELING_OPTIONS: CounselingOption[] = [
  {
    key: "diet",
    label: "Diet / nutrition",
    planText: "Nutrition counseling provided regarding diet goals and adherence.",
    diagnosisCodes: ["Z71.3"],
    procedureCodes: ["99401"],
  },
  {
    key: "exercise",
    label: "Exercise / activity",
    planText: "Exercise and activity counseling provided with a written activity plan.",
    diagnosisCodes: ["Z71.82"],
  },
  {
    key: "medication",
    label: "Medication adherence",
    planText: "Medication counseling provided covering indication, adherence, and adverse effects.",
  },
  {
    key: "tobacco",
    label: "Tobacco cessation",
    planText: "Tobacco cessation counseling provided with resources and follow-up plan.",
    diagnosisCodes: ["Z71.6"],
    procedureCodes: ["99406"],
  },
  {
    key: "fall_risk",
    label: "Fall risk / safety",
    planText: "Fall-risk and home-safety counseling provided. Falls plan of care documented.",
    qualityCodes: ["0518F"],
  },
  {
    key: "awv_prevention",
    label: "Prevention plan (AWV)",
    planText: "Written preventive care plan reviewed with the patient, including screenings and follow-up.",
  },
  {
    key: "chronic_disease",
    label: "Chronic disease self-management",
    planText: "Chronic disease self-management counseling provided.",
  },
];

export const QUALITY_OPTIONS: QualityOption[] = [
  {
    key: "incontinence_assessed",
    label: "Urinary incontinence assessed",
    planText: "Urinary incontinence assessed: presence or absence documented.",
    qualityCodes: ["1090F"],
  },
];

const QUALITY_CODE_LABELS: Record<string, string> = {
  "0518F": "Falls plan of care documented",
  "1090F": "Urinary incontinence assessed",
  "1159F": "Medication list documented in medical record",
  "1160F": "Medication review by prescribing clinician documented",
  "3074F": "Most recent systolic BP < 130 mm Hg",
  "3075F": "Most recent systolic BP 130–139 mm Hg",
  "3077F": "Most recent systolic BP ≥ 140 mm Hg",
  "3078F": "Most recent diastolic BP < 80 mm Hg",
  "3079F": "Most recent diastolic BP 80–89 mm Hg",
  "3080F": "Most recent diastolic BP ≥ 90 mm Hg",
};

export function emptyCodingAssistState(): CodingAssistState {
  return {
    templateId: "",
    templateName: "",
    templateCategory: "",
    visitTimeMinutes: "",
    counselingKeys: [],
    qualityKeys: [],
    selectedIds: [],
  };
}

export function parseCodingAssistState(input: unknown): CodingAssistState {
  try {
    const parsed = JSON.parse(String(input || "{}")) as Partial<CodingAssistState>;
    return {
      ...emptyCodingAssistState(),
      ...parsed,
      counselingKeys: Array.isArray(parsed.counselingKeys) ? parsed.counselingKeys.map(String) : [],
      qualityKeys: Array.isArray(parsed.qualityKeys) ? parsed.qualityKeys.map(String) : [],
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds.map(String) : [],
      visitTimeMinutes: String(parsed.visitTimeMinutes || ""),
      templateId: String(parsed.templateId || ""),
      templateName: String(parsed.templateName || ""),
      templateCategory: String(parsed.templateCategory || ""),
    };
  } catch {
    return emptyCodingAssistState();
  }
}

function uniqueSuggestions(rows: CodingSuggestion[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.kind}:${row.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushQualitySuggestion(
  suggestions: CodingSuggestion[],
  acceptedCpt: Set<string>,
  code: string,
  reason: string,
  idPrefix: string,
  selected = true,
) {
  const normalized = code.trim().toUpperCase();
  if (!normalized || acceptedCpt.has(normalized)) return;
  suggestions.push({
    id: `${idPrefix}:${normalized}`,
    kind: "quality",
    code: normalized,
    label: QUALITY_CODE_LABELS[normalized] || `${normalized} · quality reporting`,
    reason,
    selected,
  });
}

export function bloodPressureQualityCodes(systolic?: string | number, diastolic?: string | number): Array<{ code: string; label: string }> {
  const rows: Array<{ code: string; label: string }> = [];
  const sys = Number(systolic);
  const dia = Number(diastolic);
  if (Number.isFinite(sys) && sys > 0) {
    if (sys < 130) rows.push({ code: "3074F", label: QUALITY_CODE_LABELS["3074F"] });
    else if (sys <= 139) rows.push({ code: "3075F", label: QUALITY_CODE_LABELS["3075F"] });
    else rows.push({ code: "3077F", label: QUALITY_CODE_LABELS["3077F"] });
  }
  if (Number.isFinite(dia) && dia > 0) {
    if (dia < 80) rows.push({ code: "3078F", label: QUALITY_CODE_LABELS["3078F"] });
    else if (dia <= 89) rows.push({ code: "3079F", label: QUALITY_CODE_LABELS["3079F"] });
    else rows.push({ code: "3080F", label: QUALITY_CODE_LABELS["3080F"] });
  }
  return rows;
}

export function suggestOfficeVisitByTime(minutes: number, isNewPatient = false): CodingSuggestion | null {
  if (!Number.isFinite(minutes) || minutes < 10) return null;
  if (isNewPatient) {
    if (minutes >= 60) return { id: "time:99205", kind: "procedure", code: "99205", label: "Office visit, new patient (60+ min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
    if (minutes >= 45) return { id: "time:99204", kind: "procedure", code: "99204", label: "Office visit, new patient (45–59 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
    if (minutes >= 30) return { id: "time:99203", kind: "procedure", code: "99203", label: "Office visit, new patient (30–44 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
    if (minutes >= 15) return { id: "time:99202", kind: "procedure", code: "99202", label: "Office visit, new patient (15–29 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
    return null;
  }
  if (minutes >= 40) return { id: "time:99215", kind: "procedure", code: "99215", label: "Office visit, established (40+ min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
  if (minutes >= 30) return { id: "time:99214", kind: "procedure", code: "99214", label: "Office visit, established (30–39 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
  if (minutes >= 20) return { id: "time:99213", kind: "procedure", code: "99213", label: "Office visit, established (20–29 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
  if (minutes >= 10) return { id: "time:99212", kind: "procedure", code: "99212", label: "Office visit, established (10–19 min)", reason: `Suggested from ${minutes} minutes documented`, selected: true };
  return null;
}

export type AssessmentCodingSignals = {
  problemCount: number;
  differentialCount: number;
  hasSevere: boolean;
  hasModerate: boolean;
  hasWorseningOrUncontrolled: boolean;
  hasNewProblem: boolean;
  hasPlanRationale: boolean;
  hasDiagnosticDataReviewed: boolean;
};

export function assessmentCodingSignalsFromNote(input: {
  problems?: Array<{ diagnosis?: string; code?: string; severity?: string; status?: string }>;
  differentials?: Array<{ diagnosis?: string }>;
  planJustification?: string;
  diagnosticNotes?: string;
}): AssessmentCodingSignals {
  const problems = (input.problems || []).filter((row) => String(row.diagnosis || "").trim() || String(row.code || "").trim());
  const differentials = (input.differentials || []).filter((row) => String(row.diagnosis || "").trim());
  return {
    problemCount: problems.length,
    differentialCount: differentials.length,
    hasSevere: problems.some((row) => String(row.severity || "").toLowerCase() === "severe"),
    hasModerate: problems.some((row) => String(row.severity || "").toLowerCase() === "moderate"),
    hasWorseningOrUncontrolled: problems.some((row) => ["worsening", "uncontrolled"].includes(String(row.status || "").toLowerCase())),
    hasNewProblem: problems.some((row) => String(row.status || "").toLowerCase() === "new"),
    hasPlanRationale: Boolean(String(input.planJustification || "").trim()),
    hasDiagnosticDataReviewed: Boolean(String(input.diagnosticNotes || "").trim()),
  };
}

/** Rough MDM level 2–5 from Assessment signals (not a full AMA MDM calculator). */
export function suggestMdmLevelFromAssessment(signals: AssessmentCodingSignals): number {
  if (signals.problemCount < 1) return 0;
  let score = 1;
  if (signals.problemCount >= 2) score += 1;
  if (signals.problemCount >= 3) score += 1;
  if (signals.hasModerate) score += 1;
  if (signals.hasSevere) score += 2;
  if (signals.hasWorseningOrUncontrolled) score += 1;
  if (signals.hasNewProblem) score += 1;
  if (signals.differentialCount >= 1) score += 1;
  if (signals.differentialCount >= 3) score += 1;
  if (signals.hasPlanRationale) score += 1;
  if (signals.hasDiagnosticDataReviewed) score += 1;
  if (score >= 7) return 5;
  if (score >= 4) return 4;
  if (score >= 2) return 3;
  return 2;
}

function officeVisitCodeForLevel(level: number, isNewPatient: boolean) {
  if (level < 2) return "";
  if (isNewPatient) {
    if (level >= 5) return "99205";
    if (level === 4) return "99204";
    if (level === 3) return "99203";
    return "99202";
  }
  if (level >= 5) return "99215";
  if (level === 4) return "99214";
  if (level === 3) return "99213";
  return "99212";
}

function emLevelFromCode(code: string) {
  const normalized = code.toUpperCase();
  if (["99205", "99215"].includes(normalized)) return 5;
  if (["99204", "99214"].includes(normalized)) return 4;
  if (["99203", "99213"].includes(normalized)) return 3;
  if (["99202", "99212"].includes(normalized)) return 2;
  return 0;
}

export function suggestOfficeVisitByAssessment(
  signals: AssessmentCodingSignals,
  isNewPatient = false,
): CodingSuggestion | null {
  const level = suggestMdmLevelFromAssessment(signals);
  const code = officeVisitCodeForLevel(level, isNewPatient);
  if (!code) return null;
  const reasons: string[] = [];
  if (signals.problemCount) reasons.push(`${signals.problemCount} assessed problem${signals.problemCount === 1 ? "" : "s"}`);
  if (signals.hasSevere) reasons.push("severe problem");
  else if (signals.hasModerate) reasons.push("moderate problem");
  if (signals.hasWorseningOrUncontrolled) reasons.push("worsening/uncontrolled status");
  if (signals.hasNewProblem) reasons.push("new problem");
  if (signals.differentialCount) reasons.push(`${signals.differentialCount} differential${signals.differentialCount === 1 ? "" : "s"}`);
  if (signals.hasDiagnosticDataReviewed) reasons.push("diagnostics reviewed");
  if (signals.hasPlanRationale) reasons.push("plan rationale documented");
  return {
    id: `assessment-em:${code}`,
    kind: "procedure",
    code,
    label: isNewPatient
      ? `Office visit, new patient (Assessment MDM ~ level ${level})`
      : `Office visit, established (Assessment MDM ~ level ${level})`,
    reason: `Suggested from Assessment complexity: ${reasons.join("; ") || "documented problems"}`,
    selected: true,
  };
}

const PREVENTIVE_CODES = new Set(["G0402", "G0403", "G0438", "G0439", "99385", "99386", "99387", "99395", "99396", "99397"]);
const PROBLEM_EM_CODES = new Set(["99202", "99203", "99204", "99205", "99212", "99213", "99214", "99215"]);

export function buildVisitCodingSuggestions(input: {
  templateDiagnosisCodes?: string[];
  templateProcedureCodes?: string[];
  templateCategory?: string;
  templateName?: string;
  visitTimeMinutes?: string | number;
  counselingKeys?: string[];
  qualityKeys?: string[];
  orderCodes?: string[];
  telehealth?: boolean;
  systolic?: string | number;
  diastolic?: string | number;
  medicationsReviewed?: boolean;
  hasMedicationList?: boolean;
  acceptedDiagnosisCodes?: string[];
  acceptedProcedureCodes?: string[];
  assessmentSignals?: AssessmentCodingSignals;
}): CodingSuggestion[] {
  const suggestions: CodingSuggestion[] = [];
  const acceptedDx = new Set((input.acceptedDiagnosisCodes || []).map((code) => code.toUpperCase()));
  const acceptedCpt = new Set((input.acceptedProcedureCodes || []).map((code) => code.replace(/-.+$/, "").toUpperCase()));

  for (const code of input.templateDiagnosisCodes || []) {
    const normalized = code.trim().toUpperCase();
    if (!normalized || acceptedDx.has(normalized)) continue;
    suggestions.push({
      id: `template-dx:${normalized}`,
      kind: "diagnosis",
      code: normalized,
      label: `${normalized} · template diagnosis`,
      reason: input.templateName ? `From template “${input.templateName}”` : "From selected visit template",
      selected: true,
    });
  }

  for (const code of input.templateProcedureCodes || []) {
    const normalized = code.trim().toUpperCase();
    if (!normalized || acceptedCpt.has(normalized)) continue;
    suggestions.push({
      id: `template-cpt:${normalized}`,
      kind: "procedure",
      code: normalized,
      label: `${normalized} · template service`,
      reason: input.templateName ? `From template “${input.templateName}”` : "From selected visit template",
      selected: true,
    });
  }

  for (const code of input.orderCodes || []) {
    const normalized = code.trim().toUpperCase();
    if (!normalized || acceptedCpt.has(normalized)) continue;
    suggestions.push({
      id: `order-cpt:${normalized}`,
      kind: "procedure",
      code: normalized,
      label: `${normalized} · clinical order`,
      reason: "Linked from an order on this visit",
      selected: true,
    });
  }

  const category = String(input.templateCategory || "").toLowerCase();
  const isPreventive = /medicare|wellness|preventive|awv|ipp|cpe|well-woman|well woman/.test(`${category} ${input.templateName || ""}`.toLowerCase());
  const isNewPatient = /new patient/.test(String(input.templateName || "").toLowerCase());
  const minutes = Number(input.visitTimeMinutes || 0);
  const timeSuggestion = !isPreventive ? suggestOfficeVisitByTime(minutes, isNewPatient) : null;
  const assessmentSuggestion = !isPreventive && input.assessmentSignals
    ? suggestOfficeVisitByAssessment(input.assessmentSignals, isNewPatient)
    : null;

  let chosenEm: CodingSuggestion | null = null;
  if (timeSuggestion && assessmentSuggestion) {
    const timeLevel = emLevelFromCode(timeSuggestion.code);
    const assessmentLevel = emLevelFromCode(assessmentSuggestion.code);
    if (assessmentLevel > timeLevel) {
      chosenEm = {
        ...assessmentSuggestion,
        reason: `${assessmentSuggestion.reason} (higher than time-based ${timeSuggestion.code})`,
      };
    } else if (timeLevel > assessmentLevel) {
      chosenEm = {
        ...timeSuggestion,
        reason: `${timeSuggestion.reason}${assessmentSuggestion ? `; Assessment supported ${assessmentSuggestion.code}` : ""}`,
      };
    } else {
      chosenEm = {
        ...assessmentSuggestion,
        id: `em:${assessmentSuggestion.code}`,
        reason: `${assessmentSuggestion.reason}; also supported by documented time (${minutes} min)`,
      };
    }
  } else {
    chosenEm = assessmentSuggestion || timeSuggestion;
  }

  if (chosenEm && !acceptedCpt.has(chosenEm.code.toUpperCase())) {
    suggestions.push(chosenEm);
  }

  if (isPreventive && minutes >= 20) {
    const problemEm = suggestOfficeVisitByTime(minutes, false);
    if (problemEm && !acceptedCpt.has(problemEm.code)) {
      suggestions.push({
        ...problemEm,
        id: `problem-em:${problemEm.code}`,
        label: `${problemEm.code} · problem-oriented E/M (if separately addressed)`,
        reason: `Time ${minutes} min with a preventive template — use only if a significant separate problem was addressed`,
        selected: false,
      });
    }
  }

  for (const key of input.counselingKeys || []) {
    const option = COUNSELING_OPTIONS.find((row) => row.key === key);
    if (!option) continue;
    for (const code of option.diagnosisCodes || []) {
      if (acceptedDx.has(code)) continue;
      suggestions.push({
        id: `counsel-dx:${key}:${code}`,
        kind: "diagnosis",
        code,
        label: `${code} · ${option.label}`,
        reason: "From counseling documented today",
        selected: true,
      });
    }
    for (const code of option.procedureCodes || []) {
      if (acceptedCpt.has(code)) continue;
      const tobaccoLong = key === "tobacco" && minutes >= 10;
      const resolved = tobaccoLong && code === "99406" ? "99407" : code;
      suggestions.push({
        id: `counsel-cpt:${key}:${resolved}`,
        kind: "procedure",
        code: resolved,
        label: `${resolved} · ${option.label}`,
        reason: tobaccoLong ? "Tobacco counseling ≥10 minutes" : "From counseling documented today",
        selected: true,
      });
    }
    for (const code of option.qualityCodes || []) {
      pushQualitySuggestion(
        suggestions,
        acceptedCpt,
        code,
        key === "fall_risk" ? "From fall plan of care" : "From counseling documented today",
        `counsel-quality:${key}`,
      );
    }
  }

  for (const key of input.qualityKeys || []) {
    const option = QUALITY_OPTIONS.find((row) => row.key === key);
    if (!option) continue;
    for (const code of option.qualityCodes) {
      pushQualitySuggestion(suggestions, acceptedCpt, code, "From incontinence assessment", `quality:${key}`);
    }
  }

  for (const row of bloodPressureQualityCodes(input.systolic, input.diastolic)) {
    pushQualitySuggestion(suggestions, acceptedCpt, row.code, "From documented BP", "quality-bp");
  }

  if (input.medicationsReviewed) {
    if (input.hasMedicationList) {
      pushQualitySuggestion(suggestions, acceptedCpt, "1159F", "From medication list on chart", "quality-meds");
    }
    pushQualitySuggestion(suggestions, acceptedCpt, "1160F", "From medication review", "quality-meds");
  }

  const proposedProcedures = new Set([
    ...suggestions.filter((row) => row.kind === "procedure").map((row) => row.code.toUpperCase()),
    ...acceptedCpt,
  ]);

  const hasPreventive = [...proposedProcedures].some((code) => PREVENTIVE_CODES.has(code));
  const hasProblemEm = [...proposedProcedures].some((code) => PROBLEM_EM_CODES.has(code));
  if (hasPreventive && hasProblemEm) {
    const problemSelected = suggestions.some((row) => row.kind === "procedure" && PROBLEM_EM_CODES.has(row.code.toUpperCase()) && row.selected)
      || [...acceptedCpt].some((code) => PROBLEM_EM_CODES.has(code));
    suggestions.push({
      id: "modifier:25",
      kind: "modifier",
      code: "25",
      label: "Modifier 25 · significant separately identifiable E/M",
      reason: "Preventive/wellness service plus problem-oriented E/M on the same day",
      selected: problemSelected,
    });
  }

  if (input.telehealth) {
    suggestions.push({
      id: "modifier:95",
      kind: "modifier",
      code: "95",
      label: "Modifier 95 · synchronous telemedicine",
      reason: "Telehealth visit template or modality",
      selected: true,
    });
  }

  return uniqueSuggestions(suggestions);
}

export function applyModifierToProcedures(procedureCodes: string[], modifiers: string[]) {
  const uniqueModifiers = Array.from(new Set(modifiers.map((item) => item.trim()).filter(Boolean)));
  if (!uniqueModifiers.length) return procedureCodes;
  return procedureCodes.map((code) => {
    const base = code.split("-")[0];
    if (!PROBLEM_EM_CODES.has(base.toUpperCase()) && !PREVENTIVE_CODES.has(base.toUpperCase())) return code;
    const existing = code.includes("-") ? code.split("-").slice(1) : [];
    const next = Array.from(new Set([...existing, ...uniqueModifiers]));
    return `${base}-${next.join("-")}`;
  });
}

export function counselingPlanText(keys: string[]) {
  return keys
    .map((key) => COUNSELING_OPTIONS.find((row) => row.key === key)?.planText || "")
    .filter(Boolean)
    .join(" ");
}

export function qualityPlanText(keys: string[]) {
  return keys
    .map((key) => QUALITY_OPTIONS.find((row) => row.key === key)?.planText || "")
    .filter(Boolean)
    .join(" ");
}
