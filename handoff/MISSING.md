# Missing checklist

Use this as a todo list. Mark items done when verified.

## Blockers

- [ ] Put real `OPENAI_API_KEY` in `.dev.vars`
- [ ] Restart local app after saving `.dev.vars`
- [ ] Re-test **Get AI heads-up** on an uploaded same-day lab/report
- [ ] Confirm heads-up draft appears and can be added to diagnostic notes

## Assessment (verify in UI)

- [x] Assessment workspace wired into SOAP Assessment tab
- [x] Summary / working Dx / differentials / plan rationale assemble into narrative
- [ ] Spot-check: mic dictation on Assessment fields
- [ ] Spot-check: ICD picker still saves diagnosis codes
- [ ] Spot-check: leaving Assessment autosaves structured fields

## Nice-to-have next

- [ ] Spot-check full chart left-nav on `/chart` (all 15 sections)
- [ ] Facility-type setting → auto-shape SOAP/Objective (starters live in `lib/objective-exam.ts`)
- [ ] Structured Plan workspace (mirror Assessment pattern)
- [ ] Enable full document-AI review gates per `requirements/future/medical-document-ai/README.md` when BAA/PHI review is ready
- [ ] Consider autosave indicator polish / “last saved at” timestamp in the encounter footer

## Do not store here

- Real API keys
- PHI / patient documents
- Production secrets
