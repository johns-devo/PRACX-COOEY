"use client";

import { useEffect, useMemo, useState } from "react";
import { DictateMicField } from "./DictateMicField";
import {
  ASSESSMENT_SEVERITY_OPTIONS,
  ASSESSMENT_STATUS_OPTIONS,
  buildAssessmentText,
  codesFromAssessmentProblems,
  findAssessmentQualityIssues,
  polishAssessmentLocally,
  type AssessmentDifferential,
  type AssessmentProblem,
  type AssessmentSeverity,
  type AssessmentStatus,
} from "../lib/assessment-note";
import {
  collectVisitAiDiagnosticSummaries,
  formatVisitAiSummariesForPlan,
  mergePlanRationaleWithAiSummary,
  OBJECTIVE_DOCUMENT_CATEGORY_LABELS,
} from "../lib/objective-documents";

type DataRow = Record<string, unknown>;

function value(row: DataRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function mergeClinicalCodes(current: unknown, additions: string[]) {
  return Array.from(new Set([...String(current || "").split(",").map((code) => code.trim()).filter(Boolean), ...additions])).join(", ");
}

function ClinicalCodePicker({ label, rows, selected, onChange }: { label: string; rows: DataRow[]; selected: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState("");
  const selectedCodes = selected.split(",").map((code) => code.trim()).filter(Boolean);
  const filtered = rows.filter((row) => `${value(row, "code")} ${value(row, "description")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  function add(code: string) { if (!selectedCodes.includes(code)) onChange([...selectedCodes, code].join(", ")); }
  function remove(code: string) { onChange(selectedCodes.filter((item) => item !== code).join(", ")); }
  return (
    <section className="clinical-code-picker">
      <label>{label}<input aria-label={`Search ${label}`} onChange={(event) => setQuery(event.target.value)} placeholder="Type code or description" value={query} /></label>
      <div className="selected-clinical-codes">{selectedCodes.length ? selectedCodes.map((code) => <button key={code} onClick={() => remove(code)} type="button">{code} ×</button>) : <span>No codes selected</span>}</div>
      <div className="clinical-code-results">{filtered.map((row) => <button key={value(row, "id")} onClick={() => add(value(row, "code"))} type="button"><b>{value(row, "code")}</b><span>{value(row, "description")}</span></button>)}</div>
    </section>
  );
}

function AddDiagnosisComposer({
  rows,
  onAddCoded,
  onAddFreeText,
}: {
  rows: DataRow[];
  onAddCoded: (next: { code: string; diagnosis: string }) => void;
  onAddFreeText: (diagnosis: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (normalized.length < 1) return [];
    return rows
      .filter((row) => `${value(row, "code")} ${value(row, "description")}`.toLowerCase().includes(normalized))
      .slice(0, 16);
  }, [normalized, rows]);

  function clear() {
    setQuery("");
  }

  return (
    <div className="assessment-dx-add">
      <label>
        Add diagnosis
        <input
          aria-label="Add working diagnosis"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim() && matches.length === 0) {
              event.preventDefault();
              onAddFreeText(query.trim());
              clear();
            }
          }}
          placeholder="Search ICD-10 code or description, then pick — or Enter for free-text"
          value={query}
        />
      </label>
      {matches.length > 0 ? (
        <div className="assessment-dx-results" role="listbox" aria-label="ICD-10 matches">
          {matches.map((row) => (
            <button
              key={value(row, "id") || value(row, "code")}
              onClick={() => {
                onAddCoded({ code: value(row, "code"), diagnosis: value(row, "description") });
                clear();
              }}
              role="option"
              type="button"
            >
              <b>{value(row, "code")}</b>
              <span>{value(row, "description")}</span>
            </button>
          ))}
        </div>
      ) : null}
      {normalized.length >= 2 && matches.length === 0 ? (
        <button
          className="assessment-dx-freetext"
          onClick={() => {
            onAddFreeText(query.trim());
            clear();
          }}
          type="button"
        >
          ＋ Add “{query.trim()}” as clinical impression
        </button>
      ) : null}
    </div>
  );
}

type AssessmentDocumentSlice = {
  assessmentSummary?: string;
  assessmentProblems?: AssessmentProblem[];
  assessmentDifferentials?: AssessmentDifferential[];
  assessmentPlanJustification?: string;
  diagnosticNotes?: string;
};

function emptyProblem(): AssessmentProblem {
  return {
    id: `prob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    diagnosis: "",
    code: "",
    severity: "",
    status: "",
    reasoning: "",
    response: "",
  };
}

function emptyDifferential(): AssessmentDifferential {
  return {
    id: `dx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    diagnosis: "",
    whyLessLikely: "",
  };
}

function isFilledProblem(row: AssessmentProblem) {
  return Boolean(String(row.diagnosis || "").trim() || String(row.code || "").trim());
}

function isFilledDifferential(row: AssessmentDifferential) {
  return Boolean(String(row.diagnosis || "").trim() || String(row.whyLessLikely || "").trim());
}

export function AssessmentWorkspace({
  data,
  form,
  document,
  onDocumentChange,
  update,
}: {
  data: {
    diagnosisCodes: DataRow[];
    clinicalContentItems?: DataRow[];
    patientDocuments?: DataRow[];
  };
  form: Record<string, string | boolean>;
  document: AssessmentDocumentSlice & Record<string, unknown>;
  onDocumentChange: (next: AssessmentDocumentSlice & Record<string, unknown>) => void;
  update: (key: string, value: string | boolean) => void;
}) {
  const problems = (document.assessmentProblems || []).filter(isFilledProblem);
  const differentials = (document.assessmentDifferentials || []).filter(isFilledDifferential);
  const summary = document.assessmentSummary || "";
  const planJustification = document.assessmentPlanJustification || "";
  const dxCatalog = data.diagnosisCodes || [];
  const [diffDraft, setDiffDraft] = useState({ diagnosis: "", whyLessLikely: "" });

  const labAiSummaries = useMemo(() => collectVisitAiDiagnosticSummaries({
    patientId: String(form.patientId || ""),
    dateOfService: String(form.dateOfService || ""),
    documents: data.patientDocuments || [],
    diagnosticNotes: document.diagnosticNotes || "",
  }), [data.patientDocuments, document.diagnosticNotes, form.dateOfService, form.patientId]);

  const combinedLabAiSummary = useMemo(() => formatVisitAiSummariesForPlan(labAiSummaries), [labAiSummaries]);

  useEffect(() => {
    const rawProblems = document.assessmentProblems || [];
    const rawDiffs = document.assessmentDifferentials || [];
    const hasEmptyProblems = rawProblems.some((row) => !isFilledProblem(row));
    const hasEmptyDiffs = rawDiffs.some((row) => !isFilledDifferential(row));
    if (hasEmptyProblems || hasEmptyDiffs) {
      onDocumentChange({
        ...document,
        assessmentProblems: rawProblems.filter(isFilledProblem),
        assessmentDifferentials: rawDiffs.filter(isFilledDifferential),
      });
    }
    const coded = codesFromAssessmentProblems(rawProblems.filter(isFilledProblem));
    if (coded.length) {
      const existing = String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
      const merged = mergeClinicalCodes(existing.join(", "), coded)
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
        .join(", ");
      if (merged !== existing.map((code) => code.toUpperCase()).join(", ")) {
        update("diagnosisCodes", merged);
      }
    }
  // Push Assessment ICD codes into billing diagnosisCodes on open (ready-to-bill source of truth).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextBits = useMemo(() => {
    const complaint = String(form.chiefComplaint || "").trim();
    const hpi = String(form.historyOfPresentIllness || "").trim();
    const exam = String(form.physicalExam || "").trim();
    return {
      complaint,
      hpiPreview: hpi ? (hpi.length > 180 ? `${hpi.slice(0, 180)}…` : hpi) : "",
      examPreview: exam ? (exam.length > 180 ? `${exam.slice(0, 180)}…` : exam) : "",
    };
  }, [form.chiefComplaint, form.historyOfPresentIllness, form.physicalExam]);

  const qualityIssues = findAssessmentQualityIssues(String(form.assessment || ""));

  function syncNarrative(next: AssessmentDocumentSlice & Record<string, unknown>) {
    const cleaned: AssessmentDocumentSlice & Record<string, unknown> = {
      ...next,
      assessmentProblems: (next.assessmentProblems || []).filter(isFilledProblem),
      assessmentDifferentials: (next.assessmentDifferentials || []).filter(isFilledDifferential),
    };
    onDocumentChange(cleaned);
    update("assessment", buildAssessmentText({
      summary: cleaned.assessmentSummary,
      problems: cleaned.assessmentProblems,
      differentials: cleaned.assessmentDifferentials,
      planJustification: cleaned.assessmentPlanJustification,
    }));
    // Ready-to-bill / claims read form.diagnosisCodes — keep them aligned with coded working diagnoses.
    syncBillingFromProblems(cleaned.assessmentProblems || []);
  }

  function syncBillingFromProblems(nextProblems: AssessmentProblem[]) {
    const fromProblems = codesFromAssessmentProblems(nextProblems);
    if (!fromProblems.length) return;
    const existing = String(form.diagnosisCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
    const merged = mergeClinicalCodes(existing.join(", "), fromProblems)
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const currentNormalized = existing.map((code) => code.toUpperCase()).join(", ");
    const nextNormalized = merged.join(", ");
    if (nextNormalized !== currentNormalized) {
      update("diagnosisCodes", merged.join(", "));
    }
  }

  function patchProblem(id: string, changes: Partial<AssessmentProblem>) {
    const nextProblems = problems.map((row) => (row.id === id ? { ...row, ...changes } : row));
    syncNarrative({ ...document, assessmentProblems: nextProblems });
  }

  function addProblemFromPick(pick: { code?: string; diagnosis: string }) {
    const diagnosis = pick.diagnosis.trim();
    if (!diagnosis) return;
    const code = String(pick.code || "").trim();
    if (code && problems.some((row) => String(row.code || "").toUpperCase() === code.toUpperCase())) return;
    if (!code && problems.some((row) => row.diagnosis.trim().toLowerCase() === diagnosis.toLowerCase())) return;
    const nextProblems = [...problems, { ...emptyProblem(), diagnosis, code }];
    syncNarrative({ ...document, assessmentProblems: nextProblems });
  }

  function addDifferentialFromDraft() {
    const diagnosis = diffDraft.diagnosis.trim();
    if (!diagnosis) return;
    const next = [...differentials, { ...emptyDifferential(), diagnosis, whyLessLikely: diffDraft.whyLessLikely.trim() }];
    syncNarrative({ ...document, assessmentDifferentials: next });
    setDiffDraft({ diagnosis: "", whyLessLikely: "" });
  }

  function removeProblem(id: string) {
    syncNarrative({ ...document, assessmentProblems: problems.filter((row) => row.id !== id) });
  }

  function removeDifferential(id: string) {
    syncNarrative({ ...document, assessmentDifferentials: differentials.filter((row) => row.id !== id) });
  }

  return (
    <div className="assessment-workspace">
      <header className="assessment-workspace-head">
        <strong>Assessment</strong>
        <small>Clinical reasoning — working diagnosis, severity/status, differentials, plan rationale</small>
      </header>

      {(contextBits.complaint || contextBits.hpiPreview || contextBits.examPreview) && (
        <aside className="assessment-context" aria-label="Visit context from Subjective and Objective">
          <strong>From today’s visit</strong>
          {contextBits.complaint && <p><em>CC:</em> {contextBits.complaint}</p>}
          {contextBits.hpiPreview && <p><em>HPI:</em> {contextBits.hpiPreview}</p>}
          {contextBits.examPreview && <p><em>Exam:</em> {contextBits.examPreview}</p>}
          <small>Interpret these here — do not paste Objective lines into Assessment.</small>
        </aside>
      )}

      <section className="assessment-block">
        <DictateMicField
          label="Clinical summary (one sentence)"
          onChange={(next) => syncNarrative({ ...document, assessmentSummary: next })}
          placeholder="e.g. 45-year-old with 3 days of worsening dyspnea, most likely uncontrolled asthma."
          polish={polishAssessmentLocally}
          rows={2}
          value={summary}
        />
      </section>

      <section className="assessment-block">
        <header>
          <strong>Working diagnoses</strong>
          <span className="assessment-dx-count">{problems.length ? `${problems.length} added` : "None yet"} · {dxCatalog.length} ICD codes</span>
        </header>
        <AddDiagnosisComposer
          onAddCoded={(pick) => addProblemFromPick(pick)}
          onAddFreeText={(diagnosis) => addProblemFromPick({ diagnosis })}
          rows={dxCatalog}
        />
        {problems.length > 0 ? (
          <ul className="assessment-problem-stack">
            {problems.map((problem) => (
              <li key={problem.id} className="assessment-problem-row">
                <div className="assessment-problem-main">
                  <div className="assessment-problem-label">
                    {problem.code ? <b>{problem.code}</b> : null}
                    <span>{problem.diagnosis}</span>
                  </div>
                  <div className="assessment-problem-meta">
                    <select
                      aria-label={`Severity for ${problem.diagnosis}`}
                      onChange={(event) => patchProblem(problem.id, { severity: event.target.value as AssessmentSeverity })}
                      value={problem.severity}
                    >
                      {ASSESSMENT_SEVERITY_OPTIONS.map(([valueKey, optionLabel]) => <option key={valueKey || "sev"} value={valueKey}>{optionLabel}</option>)}
                    </select>
                    <select
                      aria-label={`Status for ${problem.diagnosis}`}
                      onChange={(event) => patchProblem(problem.id, { status: event.target.value as AssessmentStatus })}
                      value={problem.status}
                    >
                      {ASSESSMENT_STATUS_OPTIONS.map(([valueKey, optionLabel]) => <option key={valueKey || "st"} value={valueKey}>{optionLabel}</option>)}
                    </select>
                    <button aria-label={`Remove ${problem.diagnosis}`} onClick={() => removeProblem(problem.id)} type="button">×</button>
                  </div>
                </div>
                <details className="assessment-problem-details">
                  <summary>Reasoning & response</summary>
                  <DictateMicField
                    label="Clinical reasoning"
                    onChange={(next) => patchProblem(problem.id, { reasoning: next })}
                    placeholder="Why this fits: supporting symptoms/findings, and what is less likely."
                    polish={polishAssessmentLocally}
                    rows={2}
                    value={problem.reasoning}
                  />
                  <DictateMicField
                    label="Treatment response / course"
                    onChange={(next) => patchProblem(problem.id, { response: next })}
                    placeholder="Response to current therapy, adherence, side effects, or change since last visit."
                    polish={polishAssessmentLocally}
                    rows={2}
                    value={problem.response}
                  />
                </details>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="assessment-block">
        <header>
          <strong>Differential diagnoses</strong>
          <span className="assessment-dx-count">{differentials.length ? `${differentials.length} added` : "Optional"}</span>
        </header>
        <div className="assessment-diff-add">
          <input
            aria-label="Add differential diagnosis"
            onChange={(event) => setDiffDraft((current) => ({ ...current, diagnosis: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDifferentialFromDraft();
              }
            }}
            placeholder="Alternative diagnosis"
            value={diffDraft.diagnosis}
          />
          <input
            aria-label="Why less likely"
            onChange={(event) => setDiffDraft((current) => ({ ...current, whyLessLikely: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDifferentialFromDraft();
              }
            }}
            placeholder="Why less likely"
            value={diffDraft.whyLessLikely}
          />
          <button disabled={!diffDraft.diagnosis.trim()} onClick={addDifferentialFromDraft} type="button">Add</button>
        </div>
        {differentials.length > 0 ? (
          <ul className="assessment-diff-stack">
            {differentials.map((row) => (
              <li key={row.id}>
                <strong>{row.diagnosis}</strong>
                <span>{row.whyLessLikely || "—"}</span>
                <button aria-label={`Remove ${row.diagnosis}`} onClick={() => removeDifferential(row.id)} type="button">×</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="assessment-block">
        <DictateMicField
          label="Plan rationale"
          onChange={(next) => syncNarrative({ ...document, assessmentPlanJustification: next })}
          placeholder="Why the upcoming Plan actions are needed (labs, imaging, meds, referral)."
          polish={polishAssessmentLocally}
          rows={2}
          value={planJustification}
        />
        <aside className="assessment-lab-ai" aria-label="AI summaries from labs and reports">
          <header>
            <strong>Labs & reports (AI)</strong>
            {labAiSummaries.length > 0 ? (
              <button
                onClick={() => {
                  const next = mergePlanRationaleWithAiSummary(planJustification, combinedLabAiSummary);
                  syncNarrative({ ...document, assessmentPlanJustification: next });
                }}
                type="button"
              >
                Insert into plan rationale
              </button>
            ) : null}
          </header>
          {labAiSummaries.length ? (
            <ul>
              {labAiSummaries.map((row) => (
                <li key={row.id} className={row.urgent ? "urgent" : ""}>
                  <div>
                    <b>{row.category === "diagnostic_notes" ? row.title : (OBJECTIVE_DOCUMENT_CATEGORY_LABELS[row.category] || "Document")}</b>
                    {row.category !== "diagnostic_notes" ? <span>{row.title}</span> : null}
                    {row.urgent ? <em>Urgent</em> : null}
                  </div>
                  <pre>{row.text}</pre>
                  <button
                    onClick={() => {
                      const next = mergePlanRationaleWithAiSummary(planJustification, `${row.title}\n${row.text}`);
                      syncNarrative({ ...document, assessmentPlanJustification: next });
                    }}
                    type="button"
                  >
                    Insert this
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="assessment-empty">No same-day AI lab/report heads-up yet. Generate it in Objective → Same-day documents, or add diagnostic notes there first.</p>
          )}
        </aside>
      </section>

      {qualityIssues.length > 0 && (
        <aside className="assessment-quality-warn" aria-live="polite">
          <strong>Strengthen this Assessment</strong>
          <ul>{qualityIssues.map((row) => <li key={row.tip}>{row.tip}</li>)}</ul>
        </aside>
      )}

      <section className="assessment-block">
        <DictateMicField
          label="Assembled assessment narrative"
          onChange={(next) => update("assessment", next)}
          placeholder="Built from summary, problems, differentials, and plan rationale — edit or dictate as needed"
          polish={polishAssessmentLocally}
          required
          rows={6}
          value={String(form.assessment || "")}
        />
      </section>

      <ClinicalCodePicker
        label="ICD-10-CM diagnoses for billing (auto-filled from working diagnoses)"
        onChange={(next) => update("diagnosisCodes", next)}
        rows={dxCatalog}
        selected={String(form.diagnosisCodes || "")}
      />
      {!String(form.diagnosisCodes || "").trim() && problems.some((row) => !row.code) ? (
        <p className="assessment-empty">Working diagnoses without an ICD code won’t appear on Ready to bill. Search and pick each diagnosis from the ICD list above.</p>
      ) : null}
    </div>
  );
}
