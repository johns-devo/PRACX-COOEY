# PRACX handoff — continue here

Next time, tell the agent:

> Go to `handoff/` under PRACX_COOEY and finish the missing items.

This folder tracks in-progress clinical visit work (Objective, Assessment, same-day documents + AI heads-up, autosave). It is **not** production documentation.

---

## Missing / blocked (do these first)

### 1. OpenAI key for document AI
- File: `../.dev.vars` (gitignored; created from `.dev.vars.example`)
- Set:
  ```bash
  OPENAI_API_KEY=sk-...your key...
  OPENAI_LAB_MODEL=gpt-4.1-mini
  OPENAI_HPI_MODEL=gpt-4.1-mini
  ```
- Restart the local app after saving.
- Without this key: upload/view works; **AI heads-up will not draft**.
- After key is set: open Objective → Same-day documents → select uploaded file → **Get AI heads-up** (or re-upload; interpret runs automatically).

### 2. Verify AI heads-up end-to-end
- Upload a lab photo/PDF on today’s DOS.
- Confirm red/green status line shows success or a clear error.
- Confirm draft appears in the AI heads-up box.
- Confirm **Add heads-up to diagnostic notes** copies into Objective notes.
- Confirm nothing auto-enters the signed note without clinician accept.

### 3. Optional later (deferred product work)
- Facility-type settings driving SOAP/exam layout (specialty starters removed from Objective UI; starters still in `lib/objective-exam.ts`).
- Full medical-document AI policy/BAA items: see `../requirements/future/medical-document-ai/README.md`.
- Plan section structured workspace (similar pattern to Assessment), if desired.

---

## Done in this pass (do not redo unless broken)

### Assessment workspace
- UI: `../app/AssessmentWorkspace.tsx`
- Builders: `../lib/assessment-note.ts`
- Clinical summary, working diagnoses (severity/status/reasoning/response), differentials, plan rationale.
- Assembled narrative syncs into `form.assessment`; structured fields persist in `subjectiveItemsJson`.
- Mic on assessment fields; ICD-10 picker kept.
- Quality tips for vague / Objective-leak wording (no long CMS banner).

### Objective workspace
- Head-to-toe physical exam checklist (HEENT → … → Psychiatric).
- Vitals + BMI + clinic glucose.
- Grouped findings by system; specialty starter chips removed from UI.
- CMS tip banner removed (clinicians know the rules).
- Diagnostic notes + clinician observations with Mic (`DictateMicField`).
- DOS verify required for Objective “Ready”.

### Same-day documents + AI heads-up
- UI: `../app/ObjectiveVisitDocuments.tsx`
- API: `../app/api/document-interpret/route.ts`
- Helpers: `../lib/objective-documents.ts`
- Flow: front desk or doctor Photo/Upload → View → AI heads-up → verify → add to notes.
- Errors now surface in status line + draft box (including missing API key).

### Encounter draft autosave
- Quiet autosave on section change, ~1.8s after typing, and on Close encounter.
- Footer: Saving draft… / ✓ Draft saved.
- Wired via `autosaveEncounterDraft` / `onAutosaveDraft` in `../app/OperationsWorkspace.tsx`.
- Does not overwrite signed / ready_to_bill / billed encounters.

### Dictation
- Mic on Objective narrative fields, Assessment structured fields, and ClinicalPhraseField (Plan/ROS/exam).

### Charges E/M from Assessment
- `lib/visit-coding.ts` suggests office-visit CPT from Assessment complexity (problem count, severity, status, differentials, plan rationale, diagnostic notes).
- Takes the higher of time-based vs Assessment MDM-ish level; clinician still confirms in Charges.
- Wired from Assessment fields in `VisitCodingAssistant` (`OperationsWorkspace.tsx`).

### Patient chart (industry left-nav)
- `/chart` now has Facesheet, History, Problems, Medications, Immunizations, Allergies, Vitals, Notes, Labs/Studies, Flowsheets, Demographics, Account, Care Checklist, Documents, Recall.
- New tables: problems, history, immunizations, flowsheet entries, care checklist, recalls.
- UI: `app/PatientChartWorkspace.tsx` + `app/PatientChartSections.tsx`; section catalog in `lib/patient-chart.ts`.

---

## Key files

| Area | Path |
|------|------|
| Visit / SOAP UI | `app/OperationsWorkspace.tsx` |
| Assessment UI | `app/AssessmentWorkspace.tsx` |
| Assessment builders | `lib/assessment-note.ts` |
| Objective docs UI | `app/ObjectiveVisitDocuments.tsx` |
| Dictate mic | `app/DictateMicField.tsx` |
| HPI mic/polish | `app/HpiNarrativeField.tsx` |
| Exam builders | `lib/objective-exam.ts` |
| Doc + heads-up helpers | `lib/objective-documents.ts` |
| Interpret API | `app/api/document-interpret/route.ts` |
| Document upload/view | `app/api/patient-documents/route.ts` |
| Local secrets | `.dev.vars` (create/fill; gitignored) |
| Secrets template | `.dev.vars.example` |
| Deferred AI policy | `requirements/future/medical-document-ai/README.md` |
