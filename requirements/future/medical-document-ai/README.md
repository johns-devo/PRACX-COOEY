# Future requirement: medical-document AI

Status: **Deferred — do not enable in the active PRACX application**

This folder preserves the proposed AI-assisted medical-document workflow while the scheduler, patient, eligibility, EMR, claims, billing, payments, ERA and reporting modules are completed and tested.

## Proposed scope

- Accept patient-authorized images and PDFs such as laboratory results, pathology reports, imaging reports, discharge summaries, specialist notes and medication lists.
- Extract document facts with page-level source references and confidence indicators.
- Present a concise clinician review packet containing possible abnormalities, medication/history reconciliation prompts, missing-record reminders and follow-up questions.
- Require a clinician to verify every extracted value against the original document before anything becomes part of the medical record.
- Never automatically diagnose, prescribe, predict disease, order services, choose codes, create claims or recommend revenue-generating services.
- Maintain document version history, patient consent, access auditing, model/version provenance, review status and correction history.

## Prerequisites before implementation

1. Complete and stabilize the core PRACX product modules.
2. Approve the clinical use cases, clinician-review policy, patient-consent workflow and escalation rules.
3. Complete security and privacy review, threat modeling and role-based access design.
4. Execute an applicable BAA and provision an approved PHI-capable API environment with the required retention controls.
5. Store credentials only as server-side secrets; never expose an API key to the browser or source repository.
6. Define data-retention, deletion, incident-response, audit and vendor-management policies.
7. Validate extraction accuracy with de-identified test reports and a clinician-approved evaluation set.
8. Add human-review gates, clear limitations, source links, monitoring and a kill switch before any pilot.

## Deferred workflow

1. Upload/capture the original document in the existing patient Documents area.
2. Confirm patient, document category, service date and consent.
3. Send the document through an approved server-side adapter.
4. Store structured draft findings separately from the legal medical record.
5. Show source-linked findings to an authorized clinician.
6. Require accept, correct or reject actions with an audit trail.
7. Promote only clinician-approved information into the EMR.

## Archived prototype

`prototype/patient-lab-analysis.route.ts` contains the earlier proof-of-concept route for reference only. It is intentionally outside `app/`, is not reachable as an application endpoint, and must not be restored without completing the prerequisites above.

No OpenAI API key is required for the active application while this requirement remains deferred.
