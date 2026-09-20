export type AssessmentSeverity = "" | "mild" | "moderate" | "severe";
export type AssessmentStatus =
  | ""
  | "new"
  | "stable"
  | "improving"
  | "worsening"
  | "uncontrolled"
  | "resolved";

export type AssessmentProblem = {
  id: string;
  diagnosis: string;
  /** ICD-10-CM code when selected from the diagnosis master list. */
  code?: string;
  severity: AssessmentSeverity;
  status: AssessmentStatus;
  reasoning: string;
  response: string;
};

export type AssessmentDifferential = {
  id: string;
  diagnosis: string;
  whyLessLikely: string;
};

export const ASSESSMENT_SEVERITY_OPTIONS: Array<[AssessmentSeverity, string]> = [
  ["", "Severity"],
  ["mild", "Mild"],
  ["moderate", "Moderate"],
  ["severe", "Severe"],
];

export const ASSESSMENT_STATUS_OPTIONS: Array<[AssessmentStatus, string]> = [
  ["", "Status"],
  ["new", "New"],
  ["stable", "Stable"],
  ["improving", "Improving"],
  ["worsening", "Worsening"],
  ["uncontrolled", "Uncontrolled"],
  ["resolved", "Resolved"],
];

export function buildAssessmentText(input: {
  summary?: string;
  problems?: AssessmentProblem[];
  differentials?: AssessmentDifferential[];
  planJustification?: string;
}) {
  const parts: string[] = [];
  const summary = String(input.summary || "").trim();
  if (summary) parts.push(summary.replace(/\.$/, "") + ".");

  const problems = input.problems || [];
  problems.forEach((problem, index) => {
    const diagnosis = problem.diagnosis.trim();
    if (!diagnosis) return;
    const code = String(problem.code || "").trim().toUpperCase();
    const label = code && !diagnosis.toUpperCase().startsWith(code) ? `${code} — ${diagnosis}` : diagnosis;
    const meta = [
      problem.severity && `${problem.severity}`,
      problem.status && `${problem.status}`,
    ].filter(Boolean).join(", ");
    const header = `${index + 1}. ${label}${meta ? ` (${meta})` : ""}.`;
    const lines = [header];
    const reasoning = problem.reasoning.trim();
    const response = problem.response.trim();
    if (reasoning) lines.push(reasoning.replace(/\.$/, "") + ".");
    if (response) lines.push(`Treatment response: ${response.replace(/\.$/, "")}.`);
    parts.push(lines.join(" "));
  });

  const differentials = (input.differentials || []).filter((row) => row.diagnosis.trim());
  if (differentials.length) {
    const body = differentials.map((row) => {
      const why = row.whyLessLikely.trim();
      return why
        ? `${row.diagnosis.trim()} (less likely: ${why.replace(/\.$/, "")})`
        : row.diagnosis.trim();
    }).join("; ");
    parts.push(`Differential considerations: ${body}.`);
  }

  const planJustification = String(input.planJustification || "").trim();
  if (planJustification) {
    parts.push(`Plan rationale: ${planJustification.replace(/\.$/, "")}.`);
  }

  return parts.join("\n");
}

const OBJECTIVE_LEAK_PATTERNS: Array<{ pattern: RegExp; tip: string }> = [
  { pattern: /\blungs clear\b/i, tip: "Interpret exam findings (e.g. clear lungs lower pneumonia likelihood) — do not paste Objective text." },
  { pattern: /\bregular rate and rhythm\b/i, tip: "Use RR R as reasoning support, not as Assessment content." },
  { pattern: /\bbp\s*\d{2,3}\s*\/\s*\d{2,3}\b/i, tip: "Vitals belong in Objective; in Assessment say what they mean for severity/control." },
  { pattern: /\btemp(erature)?\s*\d/i, tip: "Temperature is Objective data — interpret fever risk here instead of repeating the number alone." },
];

export function findAssessmentQualityIssues(text: string) {
  const input = String(text || "").trim();
  const issues: Array<{ tip: string }> = [];
  if (!input) return issues;
  if (input.length < 40) {
    issues.push({ tip: "Assessment looks too short — add working diagnosis, brief reasoning, and differentials when relevant." });
  }
  if (/^(diagnosis|assessment)\s*:\s*.+$/i.test(input) && !/\b(likely|because|consistent|differential|less likely|stable|worsening|improving)\b/i.test(input)) {
    issues.push({ tip: "Avoid diagnosis-only lines. Add clinical reasoning that links Subjective + Objective to the impression." });
  }
  for (const row of OBJECTIVE_LEAK_PATTERNS) {
    if (row.pattern.test(input) && !issues.some((item) => item.tip === row.tip)) {
      issues.push({ tip: row.tip });
    }
  }
  return issues;
}

export function codesFromAssessmentProblems(problems?: AssessmentProblem[]) {
  return Array.from(new Set(
    (problems || [])
      .map((row) => String(row.code || "").trim().toUpperCase())
      .filter(Boolean),
  ));
}

export function codesFromAssessmentSubjectiveJson(subjectiveItemsJson: unknown) {
  try {
    const parsed = JSON.parse(String(subjectiveItemsJson || "{}")) as { assessmentProblems?: AssessmentProblem[] };
    if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.assessmentProblems)) return [] as string[];
    return codesFromAssessmentProblems(parsed.assessmentProblems);
  } catch {
    return [] as string[];
  }
}

export function polishAssessmentLocally(input: string) {
  let text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
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
