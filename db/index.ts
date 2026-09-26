import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { CLAIM_CONFIGURATION_DEFAULTS } from "../lib/claim-configuration";
import { uniqueDiagnosisCodeSeeds } from "../lib/diagnosis-code-seeds";
import { RPM_CODE_MASTER, RPM_MEDICARE_REFERENCE } from "../lib/rpm-code-master";
import * as schema from "./schema";

async function runD1Batches(db: D1Database, statements: D1PreparedStatement[], chunkSize = 50) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

function visitTemplateSeed(
  id: string,
  name: string,
  category: string,
  chiefComplaint: string,
  assessmentPrompt: string,
  planPrompt: string,
  diagnosisCodes: string[] = [],
  procedureCodes: string[] = [],
  keywords = "",
) {
  return {
    id,
    name,
    category,
    specialty: "Primary Care",
    templateJson: JSON.stringify({
      chiefComplaint,
      historyOfPresentIllness: `[Complete the ${name} history: onset/current status, interval change, treatment adherence, relevant history and patient concerns.]`,
      reviewOfSystems: "[Document only pertinent positive and negative review-of-systems findings verified today.]",
      physicalExam: "[Document the examination performed and objective findings relevant to today’s service.]",
      assessment: `[${assessmentPrompt}]`,
      treatmentPlan: `[${planPrompt}]`,
      followUpInstructions: "[Enter the follow-up interval, return precautions and patient instructions.]",
      clinicalNote: "",
    }),
    diagnosisCodes: JSON.stringify(diagnosisCodes),
    procedureCodes: JSON.stringify(procedureCodes),
    keywords,
  };
}

const VISIT_NOTE_TEMPLATE_SEEDS = [
  visitTemplateSeed("vnt_cystitis", "*E Cystitis", "Acute care", "Urinary symptoms", "Assess cystitis and relevant differential diagnoses using today’s verified findings", "Document testing, medication decision, hydration counseling and return precautions", ["N30.90"], [], "uti dysuria urinary infection"),
  visitTemplateSeed("vnt_htn", "*E HTN", "Chronic care", "Hypertension follow-up", "State blood-pressure control and the status of hypertension and related conditions", "Document medication decisions, monitoring, lifestyle counseling and follow-up", ["I10"], ["99213"], "hypertension blood pressure bp"),
  visitTemplateSeed("vnt_phq9", "*E PHQ 9 Screening", "Behavioral screening", "Depression screening", "Record PHQ-9 score, interpretation and safety assessment when indicated", "Document counseling, treatment/referral decision and follow-up", ["Z13.31"], ["96127"], "phq depression screening behavioral health"),
  visitTemplateSeed("vnt_sinusitis", "*E Sinusitis, bacterial", "Acute care", "Sinus symptoms", "Assess rhinosinusitis using symptom duration, severity and verified findings", "Document supportive care, antimicrobial decision when indicated and return precautions", ["J01.90"], ["99213"], "sinusitis congestion facial pain bacterial"),
  visitTemplateSeed("vnt_urine_dip", "*E Urine Dipstick", "Point-of-care testing", "Urinary symptoms / urine testing", "Record the indication and interpreted urinalysis findings", "Document how the result affects the assessment and plan", [], ["81003"], "urinalysis urine dipstick poc"),
  visitTemplateSeed("vnt_adhd", "ADD/ADHD follow up", "Behavioral health", "ADHD follow-up", "Assess symptom control, function, medication response and adverse effects", "Document medication monitoring, counseling and follow-up interval", ["F90.9"], ["99213"], "adhd add stimulant focus"),
  visitTemplateSeed("vnt_ccm_intake", "CCM intake", "Care management", "Chronic care management intake", "Identify qualifying chronic conditions, risks, goals and care-team needs", "Document consent, comprehensive care plan and communication preferences", [], ["99490"], "ccm intake chronic care management"),
  visitTemplateSeed("vnt_ccm_monthly", "CCM monthly", "Care management", "Monthly chronic care management", "Summarize conditions addressed, interval changes and barriers", "Document furnished services, care-plan updates, coordination and time", [], ["99490"], "ccm monthly time care coordination"),
  visitTemplateSeed("vnt_cpe_woman_under40", "cpe woman (less than 40, upto 39)", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document counseling, screenings, immunizations and follow-up", ["Z00.00"], [], "female woman preventive physical under 40 cpe"),
  visitTemplateSeed("vnt_cpe_woman_over50", "CPE women >50", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document screenings, immunizations, risk reduction and follow-up", ["Z00.00"], [], "female woman preventive physical over 50 cpe"),
  visitTemplateSeed("vnt_cpe_woman_40_49", "CPE Women 40-49 yr.", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document screenings, immunizations, counseling and follow-up", ["Z00.00"], [], "female woman preventive physical 40 49 cpe"),
  visitTemplateSeed("vnt_depo", "DEPO SHOT ONLY", "Injection", "Scheduled contraceptive injection", "Confirm indication, interval history, contraindication review and required testing", "Document medication, dose, route, site, administration and follow-up schedule", [], ["96372"], "depo medroxyprogesterone contraception injection"),
  visitTemplateSeed("vnt_cognitive", "Detailed Cognitive assessment", "Cognitive care", "Cognitive assessment", "Document cognition, function, safety, informant history and contributing conditions", "Document interpretation, care plan, referrals and follow-up", [], ["99483"], "cognitive memory dementia assessment"),
  visitTemplateSeed("vnt_hdh_followup", "Follow Up- HDH", "Follow-up", "Follow-up visit", "Update the problems addressed and their current status", "Document treatment decisions, monitoring and next follow-up", [], ["99213"], "hdh follow up"),
  visitTemplateSeed("vnt_hga_screenings", "HGA Advanced Screenings", "Screening", "Advanced screening review", "Record each screening performed, score/result and interpretation", "Document recommendations, counseling, referrals and follow-up", [], [], "advanced screenings hga"),
  visitTemplateSeed("vnt_home_health", "Home health/Physical Therapy certification", "Certification", "Home health / therapy certification", "Document diagnoses, functional limitations, homebound status when applicable and skilled need", "Document certification period, ordered disciplines, goals and oversight plan", [], [], "home health physical therapy certification plan of care"),
  visitTemplateSeed("vnt_hospital_followup", "Hospital F/u", "Transitional care", "Hospital follow-up", "Reconcile the hospitalization, discharge diagnoses, pending results and current clinical status", "Document medication reconciliation, care coordination, red flags and follow-up", [], ["99214"], "hospital discharge follow up transition tcm"),
  visitTemplateSeed("vnt_cpe_male_18_39", "Male, 18-39, CPE", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document screenings, immunizations, counseling and follow-up", ["Z00.00"], [], "male preventive physical 18 39 cpe"),
  visitTemplateSeed("vnt_cpe_male_40_44", "Male, 40-44 CPE", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document screenings, immunizations, counseling and follow-up", ["Z00.00"], [], "male preventive physical 40 44 cpe"),
  visitTemplateSeed("vnt_cpe_male_over45", "Male, over 45 CPE template", "Preventive", "Comprehensive preventive examination", "Record age-appropriate preventive risk assessment and active problems", "Document screenings, immunizations, risk reduction and follow-up", ["Z00.00"], [], "male preventive physical over 45 cpe"),
  visitTemplateSeed("vnt_awv_female", "Medicare AWV (Female)", "Medicare wellness", "Medicare annual wellness visit", "Complete the health-risk assessment and review cognition, function, mood, safety and preventive needs", "Create or update the written prevention plan and follow-up recommendations", [], ["G0439"], "medicare awv female wellness"),
  visitTemplateSeed("vnt_awv_male", "Medicare AWV (Male)", "Medicare wellness", "Medicare annual wellness visit", "Complete the health-risk assessment and review cognition, function, mood, safety and preventive needs", "Create or update the written prevention plan and follow-up recommendations", [], ["G0439"], "medicare awv male wellness"),
  visitTemplateSeed("vnt_new_patient", "New patient-establish care.", "New patient", "Establish care", "Document relevant medical, surgical, family and social history plus active problems", "Establish the problem list, medication plan, preventive needs and follow-up", [], [], "new patient establish care history"),
  visitTemplateSeed("vnt_office", "Office visit", "Evaluation & management", "Office visit", "Assess each problem addressed and its current status using verified findings", "Document management decisions, orders, counseling and follow-up", [], ["99213"], "office visit evaluation management"),
  visitTemplateSeed("vnt_plain_awv", "PLAIN Medicare AWV (Female/MALE)", "Medicare wellness", "Medicare annual wellness visit", "Complete the required wellness components and record pertinent findings", "Create or update the prevention plan and follow-up recommendations", [], ["G0439"], "plain medicare awv wellness"),
  visitTemplateSeed("vnt_telehealth", "TELEHEALTH NOTE", "Telehealth", "Telehealth visit", "Document patient location, consent, modality, participants and limitations plus problems addressed", "Document management, instructions, escalation criteria and follow-up", [], [], "telehealth video audio consent location"),
  visitTemplateSeed("vnt_b12", "Vitamin B12 injection", "Injection", "Scheduled vitamin B12 injection", "Confirm indication, interval response, contraindications and relevant monitoring", "Document medication, dose, route, site, lot/expiration when available and follow-up", ["E53.8"], ["96372"], "b12 cyanocobalamin injection vitamin"),
  visitTemplateSeed("vnt_weight_med", "weight loss medication follow up", "Weight management", "Weight-management medication follow-up", "Assess weight trend, adherence, nutrition/activity, benefit and adverse effects", "Document medication decision, monitoring, counseling and follow-up", ["Z71.3"], ["99213"], "weight loss obesity medication follow up"),
  visitTemplateSeed("vnt_welcome_male", "WELCOME TO Medicare AWV (male)-1st mawv with ekg", "Medicare wellness", "Initial preventive physical examination", "Complete the initial preventive assessment and document the clinical indication for ECG when performed", "Create the prevention plan and document ECG interpretation and resulting management when applicable", [], ["G0402", "G0403"], "welcome medicare ipp male ekg ecg"),
  visitTemplateSeed("vnt_welcome_female", "WELCOME TO Medicare AWV- 1st MAWV (female)", "Medicare wellness", "Initial preventive physical examination", "Complete the initial preventive assessment and applicable preventive review", "Create the written prevention plan and follow-up recommendations", [], ["G0402"], "welcome medicare ipp female"),
  visitTemplateSeed("vnt_wwe", "WWE women with pelvic exam/PAP", "Women’s health", "Well-woman examination", "Document preventive history, menstrual/reproductive history and examination actually performed", "Document specimen collection, screenings, counseling and follow-up of results", ["Z01.419"], [], "well woman pelvic pap cervical screening"),
];

const CLINICAL_OPTION_SEEDS = [
  ["visit_type", "problem", "Problem / symptom visit", "Problem / symptom visit", "illness complaint acute"],
  ["visit_type", "follow_up", "Follow-up visit", "Follow-up visit", "chronic interval"],
  ["visit_type", "awv", "Medicare annual wellness visit", "Medicare annual wellness visit", "awv preventive medicare"],
  ["visit_type", "preventive", "Preventive physical", "Preventive physical", "annual cpe"],
  ["visit_type", "medication", "Medication management", "Medication management", "refill response"],
  ["information_source", "patient", "Patient", "patient", "self"], ["information_source", "subscriber", "Subscriber", "subscriber", "insured policy holder"], ["information_source", "parent", "Parent", "parent", "mother father"], ["information_source", "caregiver", "Caregiver", "caregiver", "family"], ["information_source", "interpreter", "Interpreter", "interpreter", "language"], ["information_source", "records", "Prior records", "records", "chart documents"], ["information_source", "other", "Someone else", "other", "other person"],
  ["hpi_onset", "today", "Today", "today", "new acute"], ["hpi_onset", "days", "Several days ago", "several days ago", "days"], ["hpi_onset", "weeks", "Several weeks ago", "several weeks ago", "weeks"], ["hpi_onset", "months", "Several months ago", "several months ago", "months chronic"], ["hpi_onset", "sudden", "Sudden onset", "sudden onset", "abrupt"], ["hpi_onset", "gradual", "Gradual onset", "gradual onset", "progressive"],
  ["hpi_character", "aching", "Aching", "aching", "dull"], ["hpi_character", "sharp", "Sharp", "sharp", "stabbing"], ["hpi_character", "burning", "Burning", "burning", "tingling"], ["hpi_character", "pressure", "Pressure", "pressure", "tightness"], ["hpi_character", "throbbing", "Throbbing", "throbbing", "pulsating"],
  ["hpi_frequency", "constant", "Constant", "constant", "continuous"], ["hpi_frequency", "intermittent", "Intermittent", "intermittent", "comes goes"], ["hpi_frequency", "daily", "Daily", "daily", "every day"], ["hpi_frequency", "night", "Worse at night", "worse at night", "nocturnal"],
  ["hpi_progress", "better", "Improving", "improving", "better"], ["hpi_progress", "same", "Unchanged", "unchanged", "same stable"], ["hpi_progress", "worse", "Worsening", "worsening", "worse"], ["hpi_progress", "resolved", "Resolved", "resolved", "gone"],
  ["functional_impact", "none", "No reported functional limitation", "no reported functional limitation", "none"], ["functional_impact", "sleep", "Disturbs sleep", "disturbs sleep", "sleep"], ["functional_impact", "work", "Limits work", "limits work", "occupation"], ["functional_impact", "walking", "Limits walking or mobility", "limits walking or mobility", "ambulation"], ["functional_impact", "adl", "Limits activities of daily living", "limits activities of daily living", "adl"], ["functional_impact", "exercise", "Limits exercise", "limits exercise", "activity"],
  ["family_relationship", "mother", "Mother", "mother", "maternal"], ["family_relationship", "father", "Father", "father", "paternal"], ["family_relationship", "sibling", "Sibling", "sibling", "brother sister"], ["family_relationship", "child", "Child", "child", "son daughter"], ["family_relationship", "maternal_grandparent", "Maternal grandparent", "maternal grandparent", "grandmother grandfather"], ["family_relationship", "paternal_grandparent", "Paternal grandparent", "paternal grandparent", "grandmother grandfather"],
  ["condition", "diabetes", "Diabetes mellitus", "Diabetes mellitus", "diabetes sugar"], ["condition", "hypertension", "Hypertension", "Hypertension", "high blood pressure"], ["condition", "hyperlipidemia", "Hyperlipidemia / high cholesterol", "Hyperlipidemia", "cholesterol lipids"], ["condition", "heart_disease", "Heart disease", "Heart disease", "coronary cardiac"], ["condition", "stroke", "Stroke / TIA", "Stroke / TIA", "cva cerebrovascular"], ["condition", "cancer", "Cancer", "Cancer", "malignancy tumor"], ["condition", "asthma", "Asthma", "Asthma", "respiratory"], ["condition", "depression", "Depression", "Depression", "mood"],
  ["ros_symptom", "constitutional_fever", "Fever", "fever", "temperature", "constitutional"], ["ros_symptom", "constitutional_fatigue", "Fatigue", "fatigue", "tired", "constitutional"], ["ros_symptom", "cardio_chest_pain", "Chest pain", "chest pain", "pressure", "cardiovascular"], ["ros_symptom", "cardio_palpitations", "Palpitations", "palpitations", "heartbeat", "cardiovascular"], ["ros_symptom", "resp_cough", "Cough", "cough", "respiratory", "respiratory"], ["ros_symptom", "resp_dyspnea", "Shortness of breath", "shortness of breath", "dyspnea", "respiratory"], ["ros_symptom", "gi_nausea", "Nausea", "nausea", "stomach", "gastrointestinal"], ["ros_symptom", "gi_abdominal_pain", "Abdominal pain", "abdominal pain", "belly", "gastrointestinal"], ["ros_symptom", "gu_dysuria", "Painful urination", "dysuria", "urine", "genitourinary"], ["ros_symptom", "msk_joint_pain", "Joint pain", "joint pain", "arthralgia", "musculoskeletal"], ["ros_symptom", "neuro_dizziness", "Dizziness", "dizziness", "vertigo", "neurologic"], ["ros_symptom", "psych_anxiety", "Anxiety", "anxiety", "worry", "psychiatric"], ["ros_symptom", "skin_rash", "Rash", "rash", "skin", "skin"],
  ["psychiatric_history", "anxiety", "Anxiety disorder", "Anxiety disorder", "anxiety worry panic"],
  ["psychiatric_history", "depression_history", "Depressive disorder", "Depressive disorder", "depression mood"],
  ["psychiatric_history", "bipolar", "Bipolar disorder", "Bipolar disorder", "mania mood"],
  ["psychiatric_history", "ptsd", "Post-traumatic stress disorder", "Post-traumatic stress disorder", "ptsd trauma"],
  ["psychiatric_history", "adhd", "ADHD", "ADHD", "attention hyperactivity"],
  ["psychiatric_history", "psychosis", "Psychotic disorder", "Psychotic disorder", "psychosis schizophrenia"],
  ["psychiatric_history", "substance_use", "Substance-use disorder", "Substance-use disorder", "substance alcohol drug"],
  ["psychiatric_history", "psychiatric_hospitalization", "Prior psychiatric hospitalization", "Prior psychiatric hospitalization", "inpatient hospital"],
  ["psychiatric_history", "therapy", "Prior counseling / psychotherapy", "Prior counseling / psychotherapy", "therapy counselor"],
  ["investigation_history", "cbc", "Complete blood count (CBC)", "Complete blood count (CBC)", "blood hematology"],
  ["investigation_history", "cmp", "Comprehensive metabolic panel (CMP)", "Comprehensive metabolic panel (CMP)", "chemistry liver kidney"],
  ["investigation_history", "a1c", "Hemoglobin A1c", "Hemoglobin A1c", "diabetes glucose"],
  ["investigation_history", "lipid", "Lipid panel", "Lipid panel", "cholesterol triglyceride"],
  ["investigation_history", "tsh", "Thyroid testing / TSH", "Thyroid testing / TSH", "thyroid"],
  ["investigation_history", "urinalysis", "Urinalysis", "Urinalysis", "urine dipstick"],
  ["investigation_history", "ekg", "ECG / EKG", "ECG / EKG", "cardiac electrocardiogram"],
  ["investigation_history", "xray", "X-ray", "X-ray", "radiograph imaging"],
  ["investigation_history", "ct", "CT scan", "CT scan", "computed tomography imaging"],
  ["investigation_history", "mri", "MRI", "MRI", "magnetic resonance imaging"],
  ["investigation_history", "ultrasound", "Ultrasound", "Ultrasound", "sonogram imaging"],
  ["investigation_history", "mammogram", "Mammogram", "Mammogram", "breast screening"],
  ["investigation_history", "colonoscopy", "Colonoscopy", "Colonoscopy", "colon colorectal screening"],
  ["treatment_history", "prescription_medication", "Prescription medication", "Prescription medication", "rx medicine"],
  ["treatment_history", "otc_medication", "Over-the-counter medication", "Over-the-counter medication", "otc medicine"],
  ["treatment_history", "psychotherapy", "Psychotherapy / counseling", "Psychotherapy / counseling", "therapy behavioral"],
  ["treatment_history", "physical_therapy", "Physical therapy", "Physical therapy", "pt rehabilitation"],
  ["treatment_history", "surgery", "Surgical procedure", "Surgical procedure", "operation surgery"],
  ["treatment_history", "injection", "Injection / infusion", "Injection / infusion", "shot infusion"],
  ["treatment_history", "lifestyle", "Lifestyle modification", "Lifestyle modification", "diet exercise"],
  ["treatment_history", "home_remedy", "Home remedy / self-care", "Home remedy / self-care", "home self treatment"],
] as const;

const CLINICAL_ORDER_CATALOG_SEEDS = [
  // Laboratory
  ["lab", "85025", "CBC with differential", "Hematology", "cbc complete blood count differential wbc rbc platelets", "Blood", "10"],
  ["lab", "85027", "CBC without differential", "Hematology", "cbc complete blood count", "Blood", "20"],
  ["lab", "85014", "Hematocrit", "Hematology", "hct hematocrit anemia", "Blood", "30"],
  ["lab", "85018", "Hemoglobin", "Hematology", "hgb hemoglobin anemia", "Blood", "40"],
  ["lab", "85048", "White blood cell count", "Hematology", "wbc leukocyte count", "Blood", "50"],
  ["lab", "85590", "Platelet count", "Hematology", "platelets thrombocytopenia", "Blood", "60"],
  ["lab", "85610", "Prothrombin time / INR", "Coagulation", "pt inr warfarin coagulation", "Blood", "70"],
  ["lab", "85730", "PTT / aPTT", "Coagulation", "ptt aptt coagulation heparin", "Blood", "80"],
  ["lab", "85379", "D-dimer", "Coagulation", "d-dimer clot pe dvt", "Blood", "90"],
  ["lab", "80053", "Comprehensive metabolic panel (CMP)", "Chemistry", "cmp chemistry metabolic liver kidney electrolytes", "Blood", "100"],
  ["lab", "80048", "Basic metabolic panel (BMP)", "Chemistry", "bmp basic metabolic electrolytes glucose kidney", "Blood", "110"],
  ["lab", "80069", "Renal function panel", "Chemistry", "renal kidney bun creatinine egfr", "Blood", "120"],
  ["lab", "80076", "Hepatic function panel", "Chemistry", "hepatic liver lft alt ast bilirubin", "Blood", "130"],
  ["lab", "80061", "Lipid panel", "Chemistry", "lipid cholesterol ldl hdl triglyceride", "Blood", "140"],
  ["lab", "83036", "Hemoglobin A1c", "Diabetes", "a1c hba1c diabetes glucose control", "Blood", "150"],
  ["lab", "82947", "Glucose, blood", "Diabetes", "glucose fasting blood sugar diabetes", "Blood", "160"],
  ["lab", "82951", "Glucose tolerance test", "Diabetes", "gtt glucose tolerance diabetes", "Blood", "170"],
  ["lab", "83525", "Insulin", "Diabetes", "insulin diabetes", "Blood", "180"],
  ["lab", "84443", "TSH", "Endocrine", "tsh thyroid stimulating hormone", "Blood", "190"],
  ["lab", "84439", "Free T4", "Endocrine", "free t4 thyroxine thyroid", "Blood", "200"],
  ["lab", "84481", "Free T3", "Endocrine", "free t3 triiodothyronine thyroid", "Blood", "210"],
  ["lab", "84403", "Testosterone, total", "Endocrine", "testosterone hormone", "Blood", "220"],
  ["lab", "82533", "Cortisol", "Endocrine", "cortisol adrenal", "Blood", "230"],
  ["lab", "82306", "Vitamin D, 25-hydroxy", "Vitamins / minerals", "vitamin d 25 oh deficiency", "Blood", "240"],
  ["lab", "82607", "Vitamin B12", "Vitamins / minerals", "b12 cobalamin deficiency", "Blood", "250"],
  ["lab", "82746", "Folate", "Vitamins / minerals", "folate folic acid", "Blood", "260"],
  ["lab", "82728", "Ferritin", "Vitamins / minerals", "ferritin iron stores", "Blood", "270"],
  ["lab", "83540", "Iron", "Vitamins / minerals", "serum iron", "Blood", "280"],
  ["lab", "84450", "AST (SGOT)", "Chemistry", "ast sgot liver", "Blood", "290"],
  ["lab", "84460", "ALT (SGPT)", "Chemistry", "alt sgpt liver", "Blood", "300"],
  ["lab", "84100", "Phosphorus", "Chemistry", "phosphorus phosphate", "Blood", "310"],
  ["lab", "83735", "Magnesium", "Chemistry", "magnesium mg", "Blood", "320"],
  ["lab", "84550", "Uric acid", "Chemistry", "uric acid gout", "Blood", "330"],
  ["lab", "82150", "Amylase", "Chemistry", "amylase pancreas", "Blood", "340"],
  ["lab", "83690", "Lipase", "Chemistry", "lipase pancreas", "Blood", "350"],
  ["lab", "84484", "Troponin", "Cardiac", "troponin cardiac mi acs", "Blood", "360"],
  ["lab", "83880", "BNP / NT-proBNP", "Cardiac", "bnp nt-probnp heart failure", "Blood", "370"],
  ["lab", "86140", "C-reactive protein (CRP)", "Inflammation", "crp inflammation", "Blood", "380"],
  ["lab", "86141", "High-sensitivity CRP", "Inflammation", "hs-crp cardiac risk", "Blood", "390"],
  ["lab", "85652", "ESR (sed rate)", "Inflammation", "esr sedimentation rate inflammation", "Blood", "400"],
  ["lab", "86038", "ANA", "Immunology", "ana antinuclear antibody autoimmune", "Blood", "410"],
  ["lab", "86431", "Rheumatoid factor", "Immunology", "rheumatoid factor ra", "Blood", "420"],
  ["lab", "84153", "PSA, total", "Oncology / urology", "psa prostate screening", "Blood", "430"],
  ["lab", "87389", "HIV Ag/Ab combination", "Infectious disease", "hiv antigen antibody", "Blood", "440"],
  ["lab", "87340", "Hepatitis B surface antigen", "Infectious disease", "hbsag hepatitis b", "Blood", "450"],
  ["lab", "86803", "Hepatitis C antibody", "Infectious disease", "hcv hepatitis c", "Blood", "460"],
  ["lab", "86480", "QuantiFERON / TB interferon-gamma", "Infectious disease", "quantiferon tb tuberculosis igra", "Blood", "470"],
  ["lab", "87040", "Blood culture", "Microbiology", "blood culture bacteremia sepsis", "Blood", "480"],
  ["lab", "87880", "Rapid strep A", "Microbiology", "rapid strep throat", "Swab", "490"],
  ["lab", "87070", "Throat culture", "Microbiology", "throat culture pharyngitis", "Swab", "500"],
  ["lab", "87400", "Influenza A/B antigen", "Microbiology", "flu influenza rapid", "Swab", "510"],
  ["lab", "87635", "SARS-CoV-2 (COVID-19) PCR", "Microbiology", "covid pcr coronavirus naat", "Swab", "520"],
  ["lab", "87426", "SARS-CoV-2 (COVID-19) antigen", "Microbiology", "covid antigen rapid", "Swab", "530"],
  ["lab", "81001", "Urinalysis, complete", "Urinalysis", "ua urinalysis dipstick microscopic", "Urine", "540"],
  ["lab", "81003", "Urinalysis, automated", "Urinalysis", "ua automated urine", "Urine", "550"],
  ["lab", "87086", "Urine culture", "Urinalysis", "urine culture uti", "Urine", "560"],
  ["lab", "82043", "Urine microalbumin", "Urinalysis", "microalbumin albuminuria kidney", "Urine", "570"],
  ["lab", "81025", "Urine pregnancy (hCG)", "Urinalysis", "pregnancy urine hcg", "Urine", "580"],
  ["lab", "84702", "Serum hCG, quantitative", "Endocrine", "pregnancy serum hcg quantitative", "Blood", "590"],
  ["lab", "82274", "Fecal occult blood / FIT", "GI", "fit occult blood stool colon screening", "Stool", "600"],
  ["lab", "87045", "Stool culture", "GI", "stool culture diarrhea", "Stool", "610"],
  ["lab", "87324", "C. difficile toxin", "GI", "c diff clostridium difficile", "Stool", "620"],
  ["lab", "88175", "Pap test / cervical cytology", "Women's health", "pap smear cytology cervical", "Cytology", "630"],
  ["lab", "86900", "ABO blood typing", "Blood bank", "abo blood type", "Blood", "640"],
  ["lab", "86901", "Rh (D) typing", "Blood bank", "rh blood type", "Blood", "650"],
  ["lab", "86850", "Antibody screen", "Blood bank", "antibody screen type and screen", "Blood", "660"],
  // Imaging
  ["imaging", "71046", "Chest X-ray, 2 views", "X-ray", "cxr chest radiograph two view", "X-ray", "10"],
  ["imaging", "71045", "Chest X-ray, 1 view", "X-ray", "cxr chest radiograph one view", "X-ray", "20"],
  ["imaging", "74018", "Abdomen X-ray, 1 view", "X-ray", "abdominal xray kub", "X-ray", "30"],
  ["imaging", "74019", "Abdomen X-ray, 2 views", "X-ray", "abdominal xray", "X-ray", "40"],
  ["imaging", "72040", "Cervical spine X-ray", "X-ray", "c-spine cervical xray", "X-ray", "50"],
  ["imaging", "72100", "Lumbar spine X-ray", "X-ray", "l-spine lumbar xray back", "X-ray", "60"],
  ["imaging", "73030", "Shoulder X-ray", "X-ray", "shoulder radiograph", "X-ray", "70"],
  ["imaging", "73502", "Hip X-ray", "X-ray", "hip radiograph", "X-ray", "80"],
  ["imaging", "73560", "Knee X-ray", "X-ray", "knee radiograph", "X-ray", "90"],
  ["imaging", "73610", "Ankle X-ray", "X-ray", "ankle radiograph", "X-ray", "100"],
  ["imaging", "73630", "Foot X-ray", "X-ray", "foot radiograph", "X-ray", "110"],
  ["imaging", "73130", "Hand X-ray", "X-ray", "hand radiograph", "X-ray", "120"],
  ["imaging", "77067", "Screening mammogram, bilateral", "Mammography", "mammogram screening breast", "Mammography", "130"],
  ["imaging", "77066", "Diagnostic mammogram, bilateral", "Mammography", "mammogram diagnostic breast", "Mammography", "140"],
  ["imaging", "77080", "DEXA bone density, axial", "Bone density", "dexa dxa osteoporosis bone density", "DEXA", "150"],
  ["imaging", "70450", "CT head without contrast", "CT", "ct head brain noncontrast", "CT", "160"],
  ["imaging", "70460", "CT head with contrast", "CT", "ct head brain contrast", "CT", "170"],
  ["imaging", "70486", "CT maxillofacial without contrast", "CT", "ct sinus face maxillofacial", "CT", "180"],
  ["imaging", "71250", "CT chest without contrast", "CT", "ct chest thorax noncontrast", "CT", "190"],
  ["imaging", "71260", "CT chest with contrast", "CT", "ct chest thorax contrast", "CT", "200"],
  ["imaging", "72125", "CT cervical spine without contrast", "CT", "ct c-spine cervical", "CT", "210"],
  ["imaging", "72131", "CT lumbar spine without contrast", "CT", "ct l-spine lumbar", "CT", "220"],
  ["imaging", "74176", "CT abdomen/pelvis without contrast", "CT", "ct abdomen pelvis noncontrast", "CT", "230"],
  ["imaging", "74177", "CT abdomen/pelvis with contrast", "CT", "ct abdomen pelvis contrast", "CT", "240"],
  ["imaging", "74178", "CT abdomen/pelvis without then with contrast", "CT", "ct abdomen pelvis with and without", "CT", "250"],
  ["imaging", "70551", "MRI brain without contrast", "MRI", "mri brain head noncontrast", "MRI", "260"],
  ["imaging", "70553", "MRI brain without and with contrast", "MRI", "mri brain contrast", "MRI", "270"],
  ["imaging", "72141", "MRI cervical spine without contrast", "MRI", "mri c-spine cervical", "MRI", "280"],
  ["imaging", "72148", "MRI lumbar spine without contrast", "MRI", "mri l-spine lumbar back", "MRI", "290"],
  ["imaging", "72156", "MRI cervical spine without and with contrast", "MRI", "mri c-spine contrast", "MRI", "300"],
  ["imaging", "72158", "MRI lumbar spine without and with contrast", "MRI", "mri l-spine contrast", "MRI", "310"],
  ["imaging", "73221", "MRI upper extremity joint without contrast", "MRI", "mri shoulder elbow wrist joint", "MRI", "320"],
  ["imaging", "73721", "MRI lower extremity joint without contrast", "MRI", "mri knee hip ankle joint", "MRI", "330"],
  ["imaging", "76536", "Ultrasound, soft tissues of head and neck (thyroid)", "Ultrasound", "ultrasound thyroid neck", "Ultrasound", "340"],
  ["imaging", "76700", "Ultrasound abdomen, complete", "Ultrasound", "ultrasound abdomen complete", "Ultrasound", "350"],
  ["imaging", "76705", "Ultrasound abdomen, limited", "Ultrasound", "ultrasound abdomen limited", "Ultrasound", "360"],
  ["imaging", "76770", "Ultrasound retroperitoneal, complete", "Ultrasound", "ultrasound kidney renal aorta", "Ultrasound", "370"],
  ["imaging", "76856", "Ultrasound pelvis, non-obstetric", "Ultrasound", "ultrasound pelvis gynecologic", "Ultrasound", "380"],
  ["imaging", "76830", "Ultrasound transvaginal", "Ultrasound", "ultrasound tvus transvaginal", "Ultrasound", "390"],
  ["imaging", "76805", "Ultrasound obstetric, complete", "Ultrasound", "ultrasound pregnancy obstetric", "Ultrasound", "400"],
  ["imaging", "93880", "Duplex scan of extracranial arteries (carotid)", "Vascular", "carotid duplex ultrasound", "Ultrasound", "410"],
  ["imaging", "93970", "Duplex scan of extremity veins, bilateral", "Vascular", "venous duplex dvt ultrasound legs", "Ultrasound", "420"],
  ["imaging", "93971", "Duplex scan of extremity veins, unilateral", "Vascular", "venous duplex unilateral", "Ultrasound", "430"],
  ["imaging", "93306", "Echocardiogram, transthoracic complete with Doppler", "Cardiology imaging", "echo tte echocardiogram heart", "Echo", "440"],
  ["imaging", "93308", "Echocardiogram, transthoracic limited", "Cardiology imaging", "echo limited tte", "Echo", "450"],
  ["imaging", "93350", "Stress echocardiography", "Cardiology imaging", "stress echo cardiac", "Echo", "460"],
  ["imaging", "78452", "Myocardial perfusion imaging, multiple studies", "Cardiology imaging", "nuclear stress mpi cardiac", "Nuclear", "470"],
  ["imaging", "74230", "Swallowing function / modified barium swallow", "Fluoroscopy", "swallow study mbs fluoroscopy", "Fluoroscopy", "480"],
  ["imaging", "74240", "Upper GI series", "Fluoroscopy", "upper gi barium series", "Fluoroscopy", "490"],
  ["imaging", "74270", "Barium enema", "Fluoroscopy", "barium enema colon", "Fluoroscopy", "500"],
] as const;

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let coreSchemaReady = false;
let coreSchemaInitialization: Promise<void> | null = null;

export async function ensureCoreSchema() {
  if (coreSchemaReady) return;
  if (coreSchemaInitialization) return coreSchemaInitialization;
  coreSchemaInitialization = initializeCoreSchema().catch((error) => {
    coreSchemaInitialization = null;
    throw error;
  });
  return coreSchemaInitialization;
}

async function initializeCoreSchema() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  const db = env.DB;
  await runD1Batches(db, [
    db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
      id text PRIMARY KEY NOT NULL,
      legal_name text NOT NULL,
      dba_name text,
      organization_npi text,
      onboarding_completed_at text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS facilities (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      code text NOT NULL,
      facility_type text NOT NULL,
      npi text,
      clia_number text,
      phone text,
      email text,
      timezone text DEFAULT 'America/New_York' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS practice_settings (
      organization_id text PRIMARY KEY NOT NULL,
      scheduler_slot_minutes text DEFAULT '15' NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS service_locations (
      id text PRIMARY KEY NOT NULL,
      facility_id text NOT NULL,
      name text NOT NULL,
      place_of_service_code text NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text,
      city text NOT NULL,
      state text NOT NULL,
      postal_code text NOT NULL,
      is_primary text DEFAULT 'yes' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      full_name text NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      password_salt text NOT NULL,
      role text DEFAULT 'administrator' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      last_login_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      token_hash text NOT NULL,
      expires_at text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS providers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      provider_code text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      credentials text,
      npi text,
      taxonomy_code text,
      specialty text NOT NULL,
      email text,
      phone text,
      is_billing text DEFAULT 'no' NOT NULL,
      is_rendering text DEFAULT 'yes' NOT NULL,
      is_supervising text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_licenses (
      id text PRIMARY KEY NOT NULL,
      provider_id text NOT NULL,
      state text NOT NULL,
      license_number text NOT NULL,
      expiration_date text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_facility_assignments (
      id text PRIMARY KEY NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      is_primary text DEFAULT 'yes' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS referring_providers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      credentials text,
      npi text,
      taxonomy_code text,
      specialty text NOT NULL,
      organization_name text,
      email text,
      phone text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payers (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      payer_id text NOT NULL,
      eligibility_payer_id text,
      claim_filing_indicator text DEFAULT 'CI' NOT NULL,
      payer_type text DEFAULT 'Commercial' NOT NULL,
      clearinghouse_route text,
      phone text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      status text DEFAULT 'active' NOT NULL,
      response_days text DEFAULT '12' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS insurance_plans (
      id text PRIMARY KEY NOT NULL,
      payer_id text NOT NULL,
      name text NOT NULL,
      plan_type text DEFAULT 'PPO' NOT NULL,
      default_group_number text,
      timely_filing_days text DEFAULT '90' NOT NULL,
      requires_referral text DEFAULT 'no' NOT NULL,
      requires_authorization text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patients (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      account_number text NOT NULL,
      first_name text NOT NULL,
      middle_name text,
      last_name text NOT NULL,
      suffix text,
      date_of_birth text NOT NULL,
      sex text DEFAULT 'unknown' NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text,
      city text NOT NULL,
      state text NOT NULL,
      postal_code text NOT NULL,
      phone text,
      email text,
      marital_status text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_coverages (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      plan_id text NOT NULL,
      coverage_type text DEFAULT 'health' NOT NULL,
      priority text DEFAULT 'unassigned' NOT NULL,
      member_id text NOT NULL,
      group_number text,
      relationship text DEFAULT 'self' NOT NULL,
      subscriber_first_name text NOT NULL,
      subscriber_last_name text NOT NULL,
      subscriber_date_of_birth text,
      subscriber_sex text,
      subscriber_address_line_1 text,
      subscriber_city text,
      subscriber_state text,
      subscriber_postal_code text,
      effective_date text,
      termination_date text,
      property_casualty_claim_number text,
      accident_date text,
      accident_state text,
      adjuster_name text,
      adjuster_phone text,
      adjuster_email text,
      adjuster_fax text,
      claim_address_line_1 text,
      claim_city text,
      claim_state text,
      claim_postal_code text,
      coverage_limit text,
      amount_used text DEFAULT '0.00' NOT NULL,
      authorization_number text,
      accept_assignment text DEFAULT 'yes' NOT NULL,
      release_of_information text DEFAULT 'yes' NOT NULL,
      assignment_of_benefits text DEFAULT 'yes' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (plan_id) REFERENCES insurance_plans(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_legal_responsibilities (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      responsibility_type text NOT NULL,
      balance_role text DEFAULT 'final_balance' NOT NULL,
      organization_name text,
      attorney_name text,
      case_number text,
      lop_number text,
      signed_date text,
      received_date text,
      effective_date text,
      termination_date text,
      authorized_amount text,
      settlement_status text DEFAULT 'open' NOT NULL,
      lien_status text DEFAULT 'not_recorded' NOT NULL,
      phone text,
      email text,
      fax text,
      address_line_1 text,
      city text,
      state text,
      postal_code text,
      notes text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_documents (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      patient_id text NOT NULL,
      coverage_id text,
      claim_id text,
      category text NOT NULL,
      document_side text DEFAULT 'none' NOT NULL,
      title text NOT NULL,
      original_file_name text NOT NULL,
      object_key text NOT NULL,
      content_type text NOT NULL,
      file_size text NOT NULL,
      service_date text,
      analysis_status text DEFAULT 'not_analyzed' NOT NULL,
      analysis_json text,
      analysis_model text,
      analyzed_at text,
      analyzed_by text,
      status text DEFAULT 'active' NOT NULL,
      uploaded_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS billing_responsibility_profiles (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      profile_name text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      effective_from text NOT NULL,
      effective_to text,
      verification_status text DEFAULT 'unverified' NOT NULL,
      guarantor_type text DEFAULT 'patient' NOT NULL,
      guarantor_name text,
      patient_billing_hold text DEFAULT 'no' NOT NULL,
      reason text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS responsibility_sources (
      id text PRIMARY KEY NOT NULL,
      profile_id text NOT NULL,
      sequence text NOT NULL,
      role text NOT NULL,
      source_type text NOT NULL,
      coverage_id text,
      source_name text NOT NULL,
      activation_condition text,
      status text DEFAULT 'pending' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS responsibility_profile_history (
      id text PRIMARY KEY NOT NULL,
      profile_id text NOT NULL,
      action text NOT NULL,
      snapshot text NOT NULL,
      reason text,
      changed_by text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eligibility_checks (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      coverage_id text NOT NULL,
      date_of_service text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      copay_amount text DEFAULT '0.00' NOT NULL,
      deductible_remaining text DEFAULT '0.00' NOT NULL,
      coinsurance_percent text DEFAULT '0' NOT NULL,
      reference_number text,
      response_summary text,
      response_details text,
      checked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eligibility_update_history (
      id text PRIMARY KEY NOT NULL,
      eligibility_check_id text NOT NULL,
      patient_id text NOT NULL,
      coverage_id text NOT NULL,
      address_choice text NOT NULL,
      before_snapshot text NOT NULL,
      response_snapshot text NOT NULL,
      applied_snapshot text NOT NULL,
      reason text NOT NULL,
      changed_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (eligibility_check_id) REFERENCES eligibility_checks(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS appointments (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      patient_id text NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      start_at text NOT NULL,
      end_at text NOT NULL,
      appointment_type text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      reason text,
      status text DEFAULT 'scheduled' NOT NULL,
      eligibility_status text DEFAULT 'pending' NOT NULL,
      flow_status text DEFAULT 'not_arrived' NOT NULL,
      room_name text,
      flow_status_at text,
      arrived_at text,
      checked_in_at text,
      waiting_at text,
      roomed_at text,
      ready_for_provider_at text,
      consultation_started_at text,
      consultation_ended_at text,
      checked_out_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS visit_flow_events (
      id text PRIMARY KEY NOT NULL,
      appointment_id text NOT NULL,
      from_status text NOT NULL,
      to_status text NOT NULL,
      room_name text,
      note text,
      changed_by_user_id text,
      changed_by_name text NOT NULL,
      occurred_at text NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS encounters (
      id text PRIMARY KEY NOT NULL,
      appointment_id text,
      patient_id text NOT NULL,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      referring_provider_id text,
      date_of_service text NOT NULL,
      billing_context text DEFAULT 'routine' NOT NULL,
      template_key text DEFAULT 'general_soap' NOT NULL,
      subjective_items_json text DEFAULT '[]' NOT NULL,
      chief_complaint text,
      history_of_present_illness text,
      review_of_systems text,
      physical_exam text,
      assessment text,
      treatment_plan text,
      follow_up_instructions text,
      vitals text DEFAULT '{}' NOT NULL,
      allergies_reviewed text DEFAULT 'no' NOT NULL,
      medications_reviewed text DEFAULT 'no' NOT NULL,
      clinical_note text,
      coding_assist_json text DEFAULT '{}' NOT NULL,
      diagnosis_codes text DEFAULT '[]' NOT NULL,
      claim_data_snapshot text DEFAULT '{}' NOT NULL,
      procedure_codes text DEFAULT '[]' NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      signed_at text,
      signed_by_user_id text,
      signed_by_name text,
      ready_to_bill_at text,
      last_saved_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id),
      FOREIGN KEY (referring_provider_id) REFERENCES referring_providers(id),
      FOREIGN KEY (signed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS encounter_events (
      id text PRIMARY KEY NOT NULL,
      encounter_id text NOT NULL,
      action text NOT NULL,
      status_from text,
      status_to text NOT NULL,
      changed_by_user_id text,
      changed_by_name text NOT NULL,
      occurred_at text NOT NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS diagnosis_code_master (
      id text PRIMARY KEY NOT NULL,
      code text NOT NULL,
      description text NOT NULL,
      code_set text DEFAULT 'ICD-10-CM' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clinical_order_catalog (
      id text PRIMARY KEY NOT NULL,
      order_type text NOT NULL,
      code text NOT NULL,
      name text NOT NULL,
      category text DEFAULT 'General' NOT NULL,
      keywords text DEFAULT '' NOT NULL,
      specimen_or_modality text DEFAULT '' NOT NULL,
      sort_order text DEFAULT '100' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clinical_content_items (
      id text PRIMARY KEY NOT NULL,
      section text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      keywords text DEFAULT '' NOT NULL,
      specialty text DEFAULT 'All specialties' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      sort_order text DEFAULT '100' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS subjective_library_items (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      item_type text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      keywords text DEFAULT '' NOT NULL,
      specialty text DEFAULT 'All specialties' NOT NULL,
      associated_complaints text DEFAULT '[]' NOT NULL,
      scope text DEFAULT 'personal' NOT NULL,
      approval_status text DEFAULT 'draft' NOT NULL,
      created_by_user_id text,
      created_by_name text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clinical_option_master (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      option_group text NOT NULL,
      code text NOT NULL,
      label text NOT NULL,
      value text NOT NULL,
      parent_code text,
      keywords text DEFAULT '' NOT NULL,
      specialty text DEFAULT 'All specialties' NOT NULL,
      source text DEFAULT 'PRACX curated' NOT NULL,
      version text DEFAULT '2026.1' NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      sort_order text DEFAULT '100' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS practice_services (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      category text NOT NULL,
      specialty text DEFAULT 'All specialties' NOT NULL,
      procedure_code text,
      suggested_diagnosis_codes text DEFAULT '[]' NOT NULL,
      documentation_prompts text DEFAULT '[]' NOT NULL,
      keywords text DEFAULT '' NOT NULL,
      effective_date text NOT NULL,
      termination_date text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS visit_note_templates (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL,
      category text NOT NULL,
      specialty text DEFAULT 'Primary Care' NOT NULL,
      template_json text DEFAULT '{}' NOT NULL,
      suggested_diagnosis_codes text DEFAULT '[]' NOT NULL,
      suggested_procedure_codes text DEFAULT '[]' NOT NULL,
      keywords text DEFAULT '' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clinical_orders (
      id text PRIMARY KEY NOT NULL,
      encounter_id text NOT NULL,
      patient_id text NOT NULL,
      provider_id text NOT NULL,
      order_type text NOT NULL,
      code text,
      name text NOT NULL,
      instructions text,
      priority text DEFAULT 'routine' NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      ordered_by_user_id text,
      ordered_by_name text NOT NULL,
      ordered_at text NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (ordered_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clinical_order_results (
      id text PRIMARY KEY NOT NULL,
      order_id text NOT NULL,
      encounter_id text NOT NULL,
      patient_id text NOT NULL,
      result_type text NOT NULL,
      result_status text DEFAULT 'final' NOT NULL,
      summary text NOT NULL,
      result_data text,
      abnormal_flag text DEFAULT 'unknown' NOT NULL,
      review_status text DEFAULT 'pending' NOT NULL,
      resulted_at text NOT NULL,
      created_by_user_id text,
      created_by_name text NOT NULL,
      reviewed_at text,
      reviewed_by_user_id text,
      reviewed_by_name text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (order_id) REFERENCES clinical_orders(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_medications (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      encounter_id text,
      source_order_id text,
      medication_name text NOT NULL,
      rx_norm_code text,
      dose text,
      route text,
      frequency text,
      instructions text,
      status text DEFAULT 'active' NOT NULL,
      start_date text,
      end_date text,
      prescribed_by_user_id text,
      prescribed_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (source_order_id) REFERENCES clinical_orders(id),
      FOREIGN KEY (prescribed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_allergies (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      encounter_id text,
      allergy_type text DEFAULT 'drug' NOT NULL,
      substance text NOT NULL,
      reaction text,
      severity text DEFAULT 'unknown' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      onset_date text,
      source text,
      notes text,
      recorded_by_user_id text,
      recorded_by_name text NOT NULL,
      reviewed_at text,
      reviewed_by_user_id text,
      reviewed_by_name text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_problems (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      code text,
      description text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      onset_date text,
      resolved_date text,
      severity text DEFAULT '' NOT NULL,
      notes text,
      recorded_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_history_items (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      history_type text NOT NULL,
      title text NOT NULL,
      details text,
      onset_year text,
      status text DEFAULT 'active' NOT NULL,
      recorded_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_immunizations (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      vaccine_name text NOT NULL,
      cvx_code text,
      administered_on text NOT NULL,
      dose_number text,
      site text,
      route text,
      lot_number text,
      manufacturer text,
      status text DEFAULT 'completed' NOT NULL,
      notes text,
      administered_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_flowsheet_entries (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      encounter_id text,
      metric_key text NOT NULL,
      metric_label text NOT NULL,
      value text NOT NULL,
      unit text,
      recorded_at text NOT NULL,
      notes text,
      recorded_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_care_checklist_items (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      item_key text NOT NULL,
      label text NOT NULL,
      category text DEFAULT 'preventive' NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      due_date text,
      completed_at text,
      notes text,
      updated_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patient_recalls (
      id text PRIMARY KEY NOT NULL,
      patient_id text NOT NULL,
      reason text NOT NULL,
      due_date text NOT NULL,
      priority text DEFAULT 'routine' NOT NULL,
      status text DEFAULT 'open' NOT NULL,
      notes text,
      created_by_name text NOT NULL,
      completed_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS refill_requests (
      id text PRIMARY KEY NOT NULL,
      medication_id text NOT NULL,
      patient_id text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      requested_by text NOT NULL,
      requested_at text NOT NULL,
      notes text,
      decided_by_user_id text,
      decided_by_name text,
      decided_at text,
      decision_notes text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (medication_id) REFERENCES patient_medications(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (decided_by_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procedure_codes (
      id text PRIMARY KEY NOT NULL,
      code text NOT NULL,
      description text NOT NULL,
      code_set text DEFAULT 'CPT' NOT NULL,
      default_charge text DEFAULT '0.00' NOT NULL,
      default_place_of_service text DEFAULT '11' NOT NULL,
      requires_authorization text DEFAULT 'no' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fee_schedules (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      payer_id text,
      name text NOT NULL,
      effective_date text NOT NULL,
      termination_date text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fee_schedule_items (
      id text PRIMARY KEY NOT NULL,
      fee_schedule_id text NOT NULL,
      procedure_code_id text NOT NULL,
      allowed_amount text NOT NULL,
      modifier text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (fee_schedule_id) REFERENCES fee_schedules(id),
      FOREIGN KEY (procedure_code_id) REFERENCES procedure_codes(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS medicare_fee_codes (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      code_set text DEFAULT 'CPT' NOT NULL,
      code text NOT NULL,
      description text NOT NULL,
      medicare_allowed text NOT NULL,
      default_charge text NOT NULL,
      charge_override text DEFAULT 'no' NOT NULL,
      source text DEFAULT 'upload' NOT NULL,
      updated_by text,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      UNIQUE (organization_id, code_set, code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      claim_number text NOT NULL,
      patient_id text NOT NULL,
      encounter_id text,
      coverage_id text,
      payer_id text,
      provider_id text NOT NULL,
      facility_id text NOT NULL,
      referring_provider_id text,
      insurance_type_code text,
      other_plan_indicator text,
      employment_related text,
      auto_accident_related text,
      auto_accident_state text,
      other_accident_related text,
      claim_condition_codes text DEFAULT '[]' NOT NULL,
      other_claim_id_qualifier text,
      other_claim_id text,
      condition_date_qualifier text,
      condition_date text,
      other_date_qualifier text,
      other_date text,
      referring_provider_qualifier text,
      referring_other_id_qualifier text,
      referring_other_id text,
      additional_claim_info_qualifier text,
      additional_claim_info text,
      unable_to_work_from text,
      unable_to_work_to text,
      hospitalization_from text,
      hospitalization_to text,
      outside_lab_indicator text,
      outside_lab_charges text,
      prior_authorization_number text,
      federal_tax_id_type text,
      federal_tax_id_number text,
      patient_signature_on_file text,
      patient_signature_date text,
      insured_signature_on_file text,
      provider_signature_on_file text,
      provider_signature_date text,
      service_facility_other_id_qualifier text,
      service_facility_other_id text,
      billing_provider_other_id_qualifier text,
      billing_provider_other_id text,
      icd_indicator text DEFAULT '0' NOT NULL,
      diagnosis_codes text DEFAULT '[]' NOT NULL,
      bill_frequency_code text,
      original_reference_number text,
      date_of_service text NOT NULL,
      transaction_date text NOT NULL,
      payment_date text,
      posting_date text,
      first_billed_date text,
      last_billed_date text,
      status text DEFAULT 'draft' NOT NULL,
      lifecycle_status text DEFAULT 'new' NOT NULL,
      workflow_status text DEFAULT 'needs_scrub' NOT NULL,
      scrubber_status text DEFAULT 'not_run' NOT NULL,
      scrubber_messages text DEFAULT '[]' NOT NULL,
      last_scrubbed_at text,
      scrub_result text,
      scrub_rules_checked text DEFAULT '[]' NOT NULL,
      scrub_error_count text DEFAULT '0' NOT NULL,
      scrubbed_by_user_id text,
      scrubbed_by_name text,
      total_charge text DEFAULT '0.00' NOT NULL,
      total_paid text DEFAULT '0.00' NOT NULL,
      total_adjustment text DEFAULT '0.00' NOT NULL,
      patient_responsibility text DEFAULT '0.00' NOT NULL,
      submission_mode text DEFAULT 'file' NOT NULL,
      submission_method text DEFAULT 'unassigned' NOT NULL,
      routed_at text,
      printed_at text,
      mailed_at text,
      mailed_by_name text,
      mail_method text,
      mail_tracking_number text,
      clearinghouse_trace text,
      generation_id text,
      generated_at text,
      generated_by_user_id text,
      generated_by_name text,
      claim_format text,
      generation_result text,
      generated_transaction_ref text,
      batch_id text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id),
      FOREIGN KEY (coverage_id) REFERENCES patient_coverages(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id),
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (facility_id) REFERENCES facilities(id),
      FOREIGN KEY (referring_provider_id) REFERENCES referring_providers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_lines (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      line_number text NOT NULL,
      procedure_code text NOT NULL,
      modifiers text,
      diagnosis_pointers text DEFAULT 'A' NOT NULL,
      units text DEFAULT '1' NOT NULL,
      charge_amount text NOT NULL,
      place_of_service text DEFAULT '11' NOT NULL,
      rendering_npi text,
      emergency_indicator text,
      rendering_other_id_qualifier text,
      rendering_other_id text,
      epsdt_reason_code text,
      epsdt_indicator text,
      family_planning_indicator text,
      supplemental_qualifier text,
      supplemental_information text,
      ndc_code text,
      ndc_unit_qualifier text,
      ndc_quantity text,
      ndc_unit_price text,
      service_date_from text NOT NULL,
      service_date_to text NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_correction_history (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      action text DEFAULT 'save' NOT NULL,
      change_scope text DEFAULT 'claim_only' NOT NULL,
      reason text,
      before_snapshot text NOT NULL,
      after_snapshot text NOT NULL,
      changed_by_user_id text NOT NULL,
      changed_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_correction_history_claim_idx ON claim_correction_history (claim_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_workflow_events (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      previous_status text,
      new_status text NOT NULL,
      action text NOT NULL,
      reason text,
      error_information text,
      actor_user_id text,
      actor_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_workflow_events_claim_idx ON claim_workflow_events (claim_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_batches (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      batch_number text NOT NULL,
      payer_id text,
      batch_type text DEFAULT 'edi' NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      claim_count text DEFAULT '0' NOT NULL,
      total_charge text DEFAULT '0.00' NOT NULL,
      edi_file_name text,
      edi_file_path text,
      edi_content text,
      proof_file_name text,
      proof_file_path text,
      proof_content text,
      clearinghouse_response text,
      transmitted_at text,
      transmitted_by_name text,
      created_by_user_id text,
      created_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS claim_batches_org_number_unique ON claim_batches (organization_id, batch_number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_batches_status_idx ON claim_batches (organization_id, status, batch_type)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_batch_members (
      id text PRIMARY KEY NOT NULL,
      batch_id text NOT NULL,
      claim_id text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES claim_batches(id),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS claim_batch_member_unique ON claim_batch_members (batch_id, claim_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_batch_members_claim_idx ON claim_batch_members (claim_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_transmission_logs (
      id text PRIMARY KEY NOT NULL,
      batch_id text NOT NULL,
      transmission_time text NOT NULL,
      clearinghouse_response text,
      status text DEFAULT 'sent' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES claim_batches(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_transmission_logs_batch_idx ON claim_transmission_logs (batch_id, transmission_time)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_configuration_values (
      id text PRIMARY KEY NOT NULL,
      category text NOT NULL,
      code text NOT NULL,
      display_name text NOT NULL,
      internal_guidance text,
      source text DEFAULT 'NUCC 1500 v13.0 7/25' NOT NULL,
      is_official text DEFAULT 'yes' NOT NULL,
      payer_id text,
      effective_date text,
      termination_date text,
      status text DEFAULT 'active' NOT NULL,
      created_by text,
      updated_by text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_configuration_history (
      id text PRIMARY KEY NOT NULL,
      configuration_id text NOT NULL,
      action text NOT NULL,
      before_snapshot text,
      after_snapshot text NOT NULL,
      changed_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (configuration_id) REFERENCES claim_configuration_values(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_responsibility_snapshots (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      profile_id text,
      billing_context text NOT NULL,
      profile_snapshot text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id),
      FOREIGN KEY (profile_id) REFERENCES billing_responsibility_profiles(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payment_entries (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      payment_number text NOT NULL,
      payer_id text,
      remittance_id text,
      payment_amount text DEFAULT '0.00' NOT NULL,
      offset_amount text DEFAULT '0.00' NOT NULL,
      refund_amount text DEFAULT '0.00' NOT NULL,
      incentive_amount text DEFAULT '0.00' NOT NULL,
      other_adjustments text DEFAULT '0.00' NOT NULL,
      payment_total_effective text DEFAULT '0.00' NOT NULL,
      payment_method text DEFAULT 'Check' NOT NULL,
      reference_number text,
      payment_date text NOT NULL,
      posting_date text,
      notes text,
      payment_status text DEFAULT 'pending' NOT NULL,
      claim_count text DEFAULT '0' NOT NULL,
      posted_claim_count text DEFAULT '0' NOT NULL,
      claim_paid_total text DEFAULT '0.00' NOT NULL,
      auto_post_result text,
      error_message text,
      reconciliation_status text DEFAULT 'pending' NOT NULL,
      created_by_user_id text,
      created_by_name text NOT NULL,
      posted_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS payment_entries_org_number_unique ON payment_entries (organization_id, payment_number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS payment_entries_status_idx ON payment_entries (organization_id, payment_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS payment_entries_payer_idx ON payment_entries (payer_id, payment_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_payments (
      id text PRIMARY KEY NOT NULL,
      payment_id text NOT NULL,
      claim_id text NOT NULL,
      allowed_amount text DEFAULT '0.00' NOT NULL,
      paid_amount text DEFAULT '0.00' NOT NULL,
      adjustment_amount text DEFAULT '0.00' NOT NULL,
      patient_responsibility text DEFAULT '0.00' NOT NULL,
      denial_code text,
      posting_status text DEFAULT 'pending' NOT NULL,
      error_message text,
      posted_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payment_id) REFERENCES payment_entries(id),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS claim_payments_payment_claim_unique ON claim_payments (payment_id, claim_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_payments_claim_idx ON claim_payments (claim_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_payments_status_idx ON claim_payments (payment_id, posting_status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_payment_service_lines (
      id text PRIMARY KEY NOT NULL,
      payment_id text NOT NULL,
      claim_payment_id text NOT NULL,
      claim_line_id text,
      procedure_code text NOT NULL,
      service_date text NOT NULL,
      units text DEFAULT '1' NOT NULL,
      charge_amount text DEFAULT '0.00' NOT NULL,
      allowed_amount text DEFAULT '0.00' NOT NULL,
      paid_amount text DEFAULT '0.00' NOT NULL,
      adjustment_amount text DEFAULT '0.00' NOT NULL,
      patient_responsibility text DEFAULT '0.00' NOT NULL,
      denial_code text,
      eob_page text,
      next_action text,
      posting_status text DEFAULT 'pending' NOT NULL,
      error_message text,
      posted_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payment_id) REFERENCES payment_entries(id),
      FOREIGN KEY (claim_payment_id) REFERENCES claim_payments(id),
      FOREIGN KEY (claim_line_id) REFERENCES claim_lines(id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS claim_payment_service_line_unique ON claim_payment_service_lines (payment_id, claim_payment_id, procedure_code, service_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_payment_service_line_payment_idx ON claim_payment_service_lines (payment_id, posting_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS claim_payment_service_line_claim_idx ON claim_payment_service_lines (claim_payment_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payment_logs (
      id text PRIMARY KEY NOT NULL,
      payment_id text NOT NULL,
      claim_id text,
      action_type text NOT NULL,
      message text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payment_id) REFERENCES payment_entries(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS payment_logs_payment_idx ON payment_logs (payment_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS remittances (
      id text PRIMARY KEY NOT NULL,
      payer_id text,
      trace_number text NOT NULL,
      payment_date text NOT NULL,
      posting_date text,
      amount text NOT NULL,
      source text DEFAULT '835_file' NOT NULL,
      status text DEFAULT 'received' NOT NULL,
      processed_status text DEFAULT 'pending' NOT NULL,
      file_name text,
      file_path text,
      payment_entry_id text,
      unmatched_json text DEFAULT '[]' NOT NULL,
      parse_warnings_json text DEFAULT '[]' NOT NULL,
      error_message text,
      raw_835 text,
      received_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      posted_at text,
      processed_at text,
      FOREIGN KEY (payer_id) REFERENCES payers(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reconciliation_logs (
      id text PRIMARY KEY NOT NULL,
      payment_id text NOT NULL,
      previous_total_effective text DEFAULT '0.00' NOT NULL,
      previous_total_posted text DEFAULT '0.00' NOT NULL,
      previous_difference text DEFAULT '0.00' NOT NULL,
      new_total_effective text DEFAULT '0.00' NOT NULL,
      new_total_posted text DEFAULT '0.00' NOT NULL,
      new_difference text DEFAULT '0.00' NOT NULL,
      corrected_by_user_id text,
      corrected_by_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (payment_id) REFERENCES payment_entries(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS reconciliation_logs_payment_idx ON reconciliation_logs (payment_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payments (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      remittance_id text,
      payment_type text NOT NULL,
      payer_name text,
      amount text DEFAULT '0.00' NOT NULL,
      adjustment_amount text DEFAULT '0.00' NOT NULL,
      adjustment_reason text,
      reference_number text,
      transaction_date text NOT NULL,
      payment_date text NOT NULL,
      posting_date text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES claims(id),
      FOREIGN KEY (remittance_id) REFERENCES remittances(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ledger_transactions (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      patient_id text NOT NULL,
      claim_id text,
      transaction_type text NOT NULL,
      source text NOT NULL,
      amount text NOT NULL,
      description text NOT NULL,
      reference_number text,
      date_of_service text,
      transaction_date text NOT NULL,
      payment_date text,
      posting_date text NOT NULL,
      first_billed_date text,
      last_billed_date text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reconsiderations (
      id text PRIMARY KEY NOT NULL,
      claim_id text NOT NULL,
      method text DEFAULT 'fax' NOT NULL,
      destination text,
      reason text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      attachment_name text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      sent_at text,
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      integration_type text NOT NULL,
      vendor_name text NOT NULL,
      source_system text,
      mode text DEFAULT 'file' NOT NULL,
      status text DEFAULT 'needs_credentials' NOT NULL,
      endpoint text,
      last_tested_at text,
      last_test_status text,
      last_test_message text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS integration_credentials (
      id text PRIMARY KEY NOT NULL,
      integration_id text NOT NULL,
      field_key text NOT NULL,
      is_secret text DEFAULT 'yes' NOT NULL,
      plain_value text,
      cipher_text text,
      iv text,
      last_four text,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (integration_id) REFERENCES integrations(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS integration_entity_links (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      source_system text NOT NULL,
      entity_type text NOT NULL,
      external_id text NOT NULL,
      internal_id text NOT NULL,
      label text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS integration_credential_unique ON integration_credentials (integration_id, field_key)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS integration_entity_link_unique ON integration_entity_links (organization_id, source_system, entity_type, external_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS integration_entity_link_internal_idx ON integration_entity_links (entity_type, internal_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS integration_inbound_events (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      integration_id text,
      source_system text NOT NULL,
      source_label text NOT NULL,
      event_type text NOT NULL,
      external_id text,
      patient_name_external text,
      patient_dob_external text,
      matched_patient_id text,
      status text DEFAULT 'pending' NOT NULL,
      reason_code text,
      reason_detail text,
      payload_summary text,
      payload_json text,
      validation_json text,
      applied_patient_id text,
      applied_coverage_id text,
      applied_appointment_id text,
      applied_encounter_id text,
      applied_at text,
      received_at text NOT NULL,
      resolved_at text,
      resolved_by_name text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (integration_id) REFERENCES integrations(id),
      FOREIGN KEY (matched_patient_id) REFERENCES patients(id),
      FOREIGN KEY (applied_patient_id) REFERENCES patients(id),
      FOREIGN KEY (applied_coverage_id) REFERENCES patient_coverages(id),
      FOREIGN KEY (applied_appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (applied_encounter_id) REFERENCES encounters(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS inbound_events_org_status_idx ON integration_inbound_events (organization_id, status, received_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS inbound_events_source_idx ON integration_inbound_events (organization_id, source_system)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS integration_sync_events (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      direction text NOT NULL,
      event_type text NOT NULL,
      claim_id text,
      claim_number text,
      external_ref text,
      status text DEFAULT 'pending' NOT NULL,
      summary text NOT NULL,
      occurred_at text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS sync_events_org_direction_idx ON integration_sync_events (organization_id, direction, occurred_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sync_events_claim_idx ON integration_sync_events (claim_id)"),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS facilities_org_code_unique ON facilities (organization_id, code)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS facilities_org_status_idx ON facilities (organization_id, status)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS service_locations_facility_idx ON service_locations (facility_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_unique ON auth_sessions (token_hash)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS providers_org_code_unique ON providers (organization_id, provider_code)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS providers_npi_unique ON providers (npi)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS providers_org_status_idx ON providers (organization_id, status)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS provider_license_unique ON provider_licenses (provider_id, state, license_number)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS provider_license_provider_idx ON provider_licenses (provider_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS provider_facility_unique ON provider_facility_assignments (provider_id, facility_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS provider_facility_provider_idx ON provider_facility_assignments (provider_id)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS referring_providers_npi_unique ON referring_providers (npi)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS referring_providers_org_status_idx ON referring_providers (organization_id, status)",
    ),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS payers_org_payer_id_unique ON payers (organization_id, payer_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS patients_org_account_unique ON patients (organization_id, account_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS procedure_codes_code_unique ON procedure_codes (code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claims_org_number_unique ON claims (organization_id, claim_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS remittances_trace_unique ON remittances (trace_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS claims_org_status_idx ON claims (organization_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ledger_org_posting_idx ON ledger_transactions (organization_id, posting_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_profile_patient_dos_idx ON billing_responsibility_profiles (patient_id, billing_context, effective_from)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS responsibility_source_sequence_unique ON responsibility_sources (profile_id, sequence)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_source_profile_idx ON responsibility_sources (profile_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS responsibility_history_profile_idx ON responsibility_profile_history (profile_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_responsibility_snapshot_unique ON claim_responsibility_snapshots (claim_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_documents_patient_idx ON patient_documents (patient_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_documents_coverage_idx ON patient_documents (coverage_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS visit_flow_appointment_time_idx ON visit_flow_events (appointment_id, occurred_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS encounter_events_encounter_time_idx ON encounter_events (encounter_id, occurred_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS diagnosis_code_master_code_unique ON diagnosis_code_master (code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS clinical_order_catalog_type_code_unique ON clinical_order_catalog (order_type, code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS clinical_order_catalog_type_status_idx ON clinical_order_catalog (order_type, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS clinical_content_section_status_idx ON clinical_content_items (section, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS subjective_library_org_type_status_idx ON subjective_library_items (organization_id, item_type, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS subjective_library_creator_status_idx ON subjective_library_items (created_by_user_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS clinical_option_org_group_code_unique ON clinical_option_master (organization_id, option_group, code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS clinical_option_group_status_idx ON clinical_option_master (option_group, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS practice_services_org_status_idx ON practice_services (organization_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS practice_services_org_name_unique ON practice_services (organization_id, name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS visit_note_templates_org_status_idx ON visit_note_templates (organization_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS visit_note_templates_org_name_unique ON visit_note_templates (organization_id, name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS clinical_orders_encounter_idx ON clinical_orders (encounter_id, order_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS clinical_order_results_order_time_idx ON clinical_order_results (order_id, resulted_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_medications_patient_status_idx ON patient_medications (patient_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS patient_medications_source_order_unique ON patient_medications (source_order_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_allergies_patient_status_idx ON patient_allergies (patient_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_problems_patient_status_idx ON patient_problems (patient_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_history_patient_type_idx ON patient_history_items (patient_id, history_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_immunizations_patient_date_idx ON patient_immunizations (patient_id, administered_on)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_flowsheet_patient_metric_idx ON patient_flowsheet_entries (patient_id, metric_key, recorded_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS patient_care_checklist_patient_key_unique ON patient_care_checklist_items (patient_id, item_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_care_checklist_patient_status_idx ON patient_care_checklist_items (patient_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS patient_recalls_patient_status_due_idx ON patient_recalls (patient_id, status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS refill_requests_patient_status_idx ON refill_requests (patient_id, status)"),
  ]);

  try {
    await db
      .prepare("ALTER TABLE organizations ADD COLUMN onboarding_completed_at text")
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) throw error;
  }

  for (const statement of [
    "ALTER TABLE remittances ADD COLUMN posting_date text",
    "ALTER TABLE integrations ADD COLUMN source_system text",
    "ALTER TABLE integrations ADD COLUMN last_tested_at text",
    "ALTER TABLE integrations ADD COLUMN last_test_status text",
    "ALTER TABLE integrations ADD COLUMN last_test_message text",
    "ALTER TABLE integration_inbound_events ADD COLUMN payload_json text",
    "ALTER TABLE integration_inbound_events ADD COLUMN validation_json text",
    "ALTER TABLE integration_inbound_events ADD COLUMN applied_patient_id text",
    "ALTER TABLE integration_inbound_events ADD COLUMN applied_coverage_id text",
    "ALTER TABLE integration_inbound_events ADD COLUMN applied_appointment_id text",
    "ALTER TABLE integration_inbound_events ADD COLUMN applied_encounter_id text",
    "ALTER TABLE integration_inbound_events ADD COLUMN applied_at text",
    "ALTER TABLE appointments ADD COLUMN billing_context text DEFAULT 'routine' NOT NULL",
    "ALTER TABLE appointments ADD COLUMN flow_status text DEFAULT 'not_arrived' NOT NULL",
    "ALTER TABLE appointments ADD COLUMN room_name text",
    "ALTER TABLE appointments ADD COLUMN flow_status_at text",
    "ALTER TABLE appointments ADD COLUMN arrived_at text",
    "ALTER TABLE appointments ADD COLUMN checked_in_at text",
    "ALTER TABLE appointments ADD COLUMN waiting_at text",
    "ALTER TABLE appointments ADD COLUMN roomed_at text",
    "ALTER TABLE appointments ADD COLUMN ready_for_provider_at text",
    "ALTER TABLE appointments ADD COLUMN consultation_started_at text",
    "ALTER TABLE appointments ADD COLUMN consultation_ended_at text",
    "ALTER TABLE appointments ADD COLUMN checked_out_at text",
    "ALTER TABLE encounters ADD COLUMN billing_context text DEFAULT 'routine' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN template_key text DEFAULT 'general_soap' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN subjective_items_json text DEFAULT '[]' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN history_of_present_illness text",
    "ALTER TABLE encounters ADD COLUMN review_of_systems text",
    "ALTER TABLE encounters ADD COLUMN physical_exam text",
    "ALTER TABLE encounters ADD COLUMN assessment text",
    "ALTER TABLE encounters ADD COLUMN treatment_plan text",
    "ALTER TABLE encounters ADD COLUMN follow_up_instructions text",
    "ALTER TABLE encounters ADD COLUMN vitals text DEFAULT '{}' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN allergies_reviewed text DEFAULT 'no' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN medications_reviewed text DEFAULT 'no' NOT NULL",
    "ALTER TABLE encounters ADD COLUMN signed_by_user_id text",
    "ALTER TABLE encounters ADD COLUMN signed_by_name text",
    "ALTER TABLE encounters ADD COLUMN last_saved_at text",
    "ALTER TABLE encounters ADD COLUMN coding_assist_json text DEFAULT '{}' NOT NULL",
    "ALTER TABLE eligibility_checks ADD COLUMN response_details text",
    "ALTER TABLE patient_coverages ADD COLUMN coverage_type text DEFAULT 'health' NOT NULL",
    "ALTER TABLE patient_coverages ADD COLUMN property_casualty_claim_number text",
    "ALTER TABLE patient_coverages ADD COLUMN accident_date text",
    "ALTER TABLE patient_coverages ADD COLUMN accident_state text",
    "ALTER TABLE patient_coverages ADD COLUMN adjuster_name text",
    "ALTER TABLE patient_coverages ADD COLUMN adjuster_phone text",
    "ALTER TABLE patient_coverages ADD COLUMN adjuster_email text",
    "ALTER TABLE patient_coverages ADD COLUMN adjuster_fax text",
    "ALTER TABLE patient_coverages ADD COLUMN claim_address_line_1 text",
    "ALTER TABLE patient_coverages ADD COLUMN claim_city text",
    "ALTER TABLE patient_coverages ADD COLUMN claim_state text",
    "ALTER TABLE patient_coverages ADD COLUMN claim_postal_code text",
    "ALTER TABLE patient_coverages ADD COLUMN coverage_limit text",
    "ALTER TABLE patient_coverages ADD COLUMN amount_used text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE patient_coverages ADD COLUMN authorization_number text",
    "ALTER TABLE patient_documents ADD COLUMN analysis_status text DEFAULT 'not_analyzed' NOT NULL",
    "ALTER TABLE patient_documents ADD COLUMN analysis_json text",
    "ALTER TABLE patient_documents ADD COLUMN analysis_model text",
    "ALTER TABLE patient_documents ADD COLUMN analyzed_at text",
    "ALTER TABLE patient_documents ADD COLUMN analyzed_by text",
    "ALTER TABLE claims ADD COLUMN insurance_type_code text",
    "ALTER TABLE claims ADD COLUMN other_plan_indicator text",
    "ALTER TABLE claims ADD COLUMN employment_related text",
    "ALTER TABLE claims ADD COLUMN auto_accident_related text",
    "ALTER TABLE claims ADD COLUMN auto_accident_state text",
    "ALTER TABLE claims ADD COLUMN other_accident_related text",
    "ALTER TABLE claims ADD COLUMN claim_condition_codes text DEFAULT '[]' NOT NULL",
    "ALTER TABLE claims ADD COLUMN other_claim_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN other_claim_id text",
    "ALTER TABLE claims ADD COLUMN condition_date_qualifier text",
    "ALTER TABLE claims ADD COLUMN condition_date text",
    "ALTER TABLE claims ADD COLUMN other_date_qualifier text",
    "ALTER TABLE claims ADD COLUMN other_date text",
    "ALTER TABLE claims ADD COLUMN referring_provider_qualifier text",
    "ALTER TABLE claims ADD COLUMN referring_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN referring_other_id text",
    "ALTER TABLE claims ADD COLUMN additional_claim_info_qualifier text",
    "ALTER TABLE claims ADD COLUMN additional_claim_info text",
    "ALTER TABLE claims ADD COLUMN unable_to_work_from text",
    "ALTER TABLE claims ADD COLUMN unable_to_work_to text",
    "ALTER TABLE claims ADD COLUMN hospitalization_from text",
    "ALTER TABLE claims ADD COLUMN hospitalization_to text",
    "ALTER TABLE claims ADD COLUMN outside_lab_indicator text",
    "ALTER TABLE claims ADD COLUMN outside_lab_charges text",
    "ALTER TABLE claims ADD COLUMN prior_authorization_number text",
    "ALTER TABLE claims ADD COLUMN federal_tax_id_type text",
    "ALTER TABLE claims ADD COLUMN federal_tax_id_number text",
    "ALTER TABLE claims ADD COLUMN patient_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN patient_signature_date text",
    "ALTER TABLE claims ADD COLUMN insured_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN provider_signature_on_file text",
    "ALTER TABLE claims ADD COLUMN provider_signature_date text",
    "ALTER TABLE claims ADD COLUMN service_facility_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN service_facility_other_id text",
    "ALTER TABLE claims ADD COLUMN billing_provider_other_id_qualifier text",
    "ALTER TABLE claims ADD COLUMN billing_provider_other_id text",
    "ALTER TABLE claims ADD COLUMN icd_indicator text DEFAULT '0' NOT NULL",
    "ALTER TABLE claims ADD COLUMN diagnosis_codes text DEFAULT '[]' NOT NULL",
    "ALTER TABLE claims ADD COLUMN claim_data_snapshot text DEFAULT '{}' NOT NULL",
    "ALTER TABLE claims ADD COLUMN bill_frequency_code text",
    "ALTER TABLE claims ADD COLUMN original_reference_number text",
    "ALTER TABLE claims ADD COLUMN submission_method text DEFAULT 'unassigned' NOT NULL",
    "ALTER TABLE claims ADD COLUMN routed_at text",
    "ALTER TABLE claims ADD COLUMN printed_at text",
    "ALTER TABLE claims ADD COLUMN mailed_at text",
    "ALTER TABLE claims ADD COLUMN mailed_by_name text",
    "ALTER TABLE claims ADD COLUMN mail_method text",
    "ALTER TABLE claims ADD COLUMN mail_tracking_number text",
    "ALTER TABLE claims ADD COLUMN workflow_status text DEFAULT 'needs_scrub' NOT NULL",
    "ALTER TABLE claims ADD COLUMN last_scrubbed_at text",
    "ALTER TABLE claims ADD COLUMN scrub_result text",
    "ALTER TABLE claims ADD COLUMN scrub_rules_checked text DEFAULT '[]' NOT NULL",
    "ALTER TABLE claims ADD COLUMN scrub_error_count text DEFAULT '0' NOT NULL",
    "ALTER TABLE claims ADD COLUMN scrubbed_by_user_id text",
    "ALTER TABLE claims ADD COLUMN scrubbed_by_name text",
    "ALTER TABLE claims ADD COLUMN generation_id text",
    "ALTER TABLE claims ADD COLUMN generated_at text",
    "ALTER TABLE claims ADD COLUMN generated_by_user_id text",
    "ALTER TABLE claims ADD COLUMN generated_by_name text",
    "ALTER TABLE claims ADD COLUMN claim_format text",
    "ALTER TABLE claims ADD COLUMN generation_result text",
    "ALTER TABLE claims ADD COLUMN generated_transaction_ref text",
    "ALTER TABLE claims ADD COLUMN batch_id text",
    "ALTER TABLE payment_entries ADD COLUMN offset_amount text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN refund_amount text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN incentive_amount text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN other_adjustments text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN payment_total_effective text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN reconciliation_status text DEFAULT 'pending' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN posting_date text",
    "ALTER TABLE payment_entries ADD COLUMN method_details text",
    "ALTER TABLE payment_entries ADD COLUMN payer_type text DEFAULT 'payer' NOT NULL",
    "ALTER TABLE payment_entries ADD COLUMN patient_id text",
    "ALTER TABLE payment_entries ADD COLUMN encounter_id text",
    "ALTER TABLE payment_entries ADD COLUMN service_date text",
    "ALTER TABLE payment_entries ADD COLUMN payment_purpose text",
    "ALTER TABLE payments ADD COLUMN payment_entry_id text",
    "ALTER TABLE ledger_transactions ADD COLUMN payment_entry_id text",
    "ALTER TABLE claims ADD COLUMN remaining_balance text DEFAULT '0.00' NOT NULL",
    "ALTER TABLE claims ADD COLUMN lifecycle_status text DEFAULT 'new' NOT NULL",
    "ALTER TABLE claims ADD COLUMN follow_up_status text DEFAULT '' NOT NULL",
    "ALTER TABLE payers ADD COLUMN response_days text DEFAULT '12' NOT NULL",
    "ALTER TABLE remittances ADD COLUMN processed_status text DEFAULT 'pending' NOT NULL",
    "ALTER TABLE remittances ADD COLUMN file_name text",
    "ALTER TABLE remittances ADD COLUMN file_path text",
    "ALTER TABLE remittances ADD COLUMN payment_entry_id text",
    "ALTER TABLE remittances ADD COLUMN unmatched_json text DEFAULT '[]' NOT NULL",
    "ALTER TABLE remittances ADD COLUMN parse_warnings_json text DEFAULT '[]' NOT NULL",
    "ALTER TABLE remittances ADD COLUMN error_message text",
    "ALTER TABLE remittances ADD COLUMN processed_at text",
    "ALTER TABLE claim_lines ADD COLUMN rendering_other_id_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN rendering_other_id text",
    "ALTER TABLE claim_lines ADD COLUMN emergency_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN epsdt_reason_code text",
    "ALTER TABLE claim_lines ADD COLUMN epsdt_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN family_planning_indicator text",
    "ALTER TABLE claim_lines ADD COLUMN supplemental_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN supplemental_information text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_code text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_unit_qualifier text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_quantity text",
    "ALTER TABLE claim_lines ADD COLUMN ndc_unit_price text",
  ]) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate column name")) throw error;
    }
  }

  await db.prepare("CREATE INDEX IF NOT EXISTS claims_submission_queue_idx ON claims (organization_id, submission_method, status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claims_workflow_status_idx ON claims (organization_id, workflow_status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claims_lifecycle_status_idx ON claims (organization_id, lifecycle_status)").run();
  await db.prepare(`UPDATE claims SET lifecycle_status = CASE
    WHEN CAST(remaining_balance AS REAL) <= 0.009 AND (status = 'paid' OR workflow_status = 'submitted') THEN 'closed'
    WHEN status = 'denied' THEN 'denied_pri'
    WHEN workflow_status = 'submitted' OR status IN ('submitted', 'accepted', 'rejected', 'partially_paid') THEN 'sent_to_pri'
    WHEN workflow_status IN ('needs_scrub', 'scrubbing', 'error', 'ready_to_bill', 'generating', 'generated') THEN 'bill_to_pri'
    ELSE lifecycle_status
  END
  WHERE lifecycle_status = 'new' OR lifecycle_status IS NULL OR lifecycle_status = ''`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_workflow_events (
    id text PRIMARY KEY NOT NULL,
    claim_id text NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    action text NOT NULL,
    reason text,
    error_information text,
    actor_user_id text,
    actor_name text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_workflow_events_claim_idx ON claim_workflow_events (claim_id, created_at)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_batches (
    id text PRIMARY KEY NOT NULL,
    organization_id text NOT NULL,
    batch_number text NOT NULL,
    payer_id text,
    batch_type text DEFAULT 'edi' NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    claim_count text DEFAULT '0' NOT NULL,
    total_charge text DEFAULT '0.00' NOT NULL,
    edi_file_name text,
    edi_file_path text,
    edi_content text,
    proof_file_name text,
    proof_file_path text,
    proof_content text,
    clearinghouse_response text,
    transmitted_at text,
    transmitted_by_name text,
    created_by_user_id text,
    created_by_name text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (payer_id) REFERENCES payers(id)
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_batches_org_number_unique ON claim_batches (organization_id, batch_number)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_batches_status_idx ON claim_batches (organization_id, status, batch_type)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_batch_members (
    id text PRIMARY KEY NOT NULL,
    batch_id text NOT NULL,
    claim_id text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES claim_batches(id),
    FOREIGN KEY (claim_id) REFERENCES claims(id)
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_batch_member_unique ON claim_batch_members (batch_id, claim_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_batch_members_claim_idx ON claim_batch_members (claim_id)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_transmission_logs (
    id text PRIMARY KEY NOT NULL,
    batch_id text NOT NULL,
    transmission_time text NOT NULL,
    clearinghouse_response text,
    status text DEFAULT 'sent' NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES claim_batches(id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_transmission_logs_batch_idx ON claim_transmission_logs (batch_id, transmission_time)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claims_batch_idx ON claims (batch_id)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS payment_entries (
    id text PRIMARY KEY NOT NULL,
    organization_id text NOT NULL,
    payment_number text NOT NULL,
    payer_id text,
    remittance_id text,
    payment_amount text DEFAULT '0.00' NOT NULL,
    offset_amount text DEFAULT '0.00' NOT NULL,
    refund_amount text DEFAULT '0.00' NOT NULL,
    incentive_amount text DEFAULT '0.00' NOT NULL,
    other_adjustments text DEFAULT '0.00' NOT NULL,
    payment_total_effective text DEFAULT '0.00' NOT NULL,
    payment_method text DEFAULT 'Check' NOT NULL,
    reference_number text,
    payment_date text NOT NULL,
    posting_date text,
    notes text,
    payment_status text DEFAULT 'pending' NOT NULL,
    claim_count text DEFAULT '0' NOT NULL,
    posted_claim_count text DEFAULT '0' NOT NULL,
    claim_paid_total text DEFAULT '0.00' NOT NULL,
    auto_post_result text,
    error_message text,
    reconciliation_status text DEFAULT 'pending' NOT NULL,
    created_by_user_id text,
    created_by_name text NOT NULL,
    posted_at text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (payer_id) REFERENCES payers(id)
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS payment_entries_org_number_unique ON payment_entries (organization_id, payment_number)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS payment_entries_status_idx ON payment_entries (organization_id, payment_status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS payment_entries_payer_idx ON payment_entries (payer_id, payment_date)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_payments (
    id text PRIMARY KEY NOT NULL,
    payment_id text NOT NULL,
    claim_id text NOT NULL,
    allowed_amount text DEFAULT '0.00' NOT NULL,
    paid_amount text DEFAULT '0.00' NOT NULL,
    adjustment_amount text DEFAULT '0.00' NOT NULL,
    patient_responsibility text DEFAULT '0.00' NOT NULL,
    denial_code text,
    posting_status text DEFAULT 'pending' NOT NULL,
    error_message text,
    posted_at text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payment_entries(id),
    FOREIGN KEY (claim_id) REFERENCES claims(id)
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_payments_payment_claim_unique ON claim_payments (payment_id, claim_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_payments_claim_idx ON claim_payments (claim_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_payments_status_idx ON claim_payments (payment_id, posting_status)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS claim_payment_service_lines (
    id text PRIMARY KEY NOT NULL,
    payment_id text NOT NULL,
    claim_payment_id text NOT NULL,
    claim_line_id text,
    procedure_code text NOT NULL,
    service_date text NOT NULL,
    units text DEFAULT '1' NOT NULL,
    charge_amount text DEFAULT '0.00' NOT NULL,
    allowed_amount text DEFAULT '0.00' NOT NULL,
    paid_amount text DEFAULT '0.00' NOT NULL,
    adjustment_amount text DEFAULT '0.00' NOT NULL,
    patient_responsibility text DEFAULT '0.00' NOT NULL,
    denial_code text,
    eob_page text,
    next_action text,
    posting_status text DEFAULT 'pending' NOT NULL,
    error_message text,
    posted_at text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payment_entries(id),
    FOREIGN KEY (claim_payment_id) REFERENCES claim_payments(id),
    FOREIGN KEY (claim_line_id) REFERENCES claim_lines(id)
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claim_payment_service_line_unique ON claim_payment_service_lines (payment_id, claim_payment_id, procedure_code, service_date)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_payment_service_line_payment_idx ON claim_payment_service_lines (payment_id, posting_status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS claim_payment_service_line_claim_idx ON claim_payment_service_lines (claim_payment_id)").run();
  for (const table of ["claim_payments", "claim_payment_service_lines"]) {
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN adjustment_details text`).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS payment_logs (
    id text PRIMARY KEY NOT NULL,
    payment_id text NOT NULL,
    claim_id text,
    action_type text NOT NULL,
    message text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payment_entries(id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS payment_logs_payment_idx ON payment_logs (payment_id, created_at)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id text PRIMARY KEY NOT NULL,
    payment_id text NOT NULL,
    previous_total_effective text DEFAULT '0.00' NOT NULL,
    previous_total_posted text DEFAULT '0.00' NOT NULL,
    previous_difference text DEFAULT '0.00' NOT NULL,
    new_total_effective text DEFAULT '0.00' NOT NULL,
    new_total_posted text DEFAULT '0.00' NOT NULL,
    new_difference text DEFAULT '0.00' NOT NULL,
    corrected_by_user_id text,
    corrected_by_name text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payment_entries(id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS reconciliation_logs_payment_idx ON reconciliation_logs (payment_id, created_at)").run();
  try {
    await db.prepare(`UPDATE payment_entries
      SET payment_total_effective = printf('%.2f',
        COALESCE(CAST(payment_amount AS REAL), 0)
        + COALESCE(CAST(offset_amount AS REAL), 0)
        + COALESCE(CAST(refund_amount AS REAL), 0)
        + COALESCE(CAST(incentive_amount AS REAL), 0)
        + COALESCE(CAST(other_adjustments AS REAL), 0)
      )
      WHERE payment_total_effective IS NULL OR payment_total_effective = ''`).run();
  } catch {
    // payment_entries may not exist yet on first boot before create
  }
  try {
    await db.prepare(`UPDATE claims
      SET remaining_balance = printf('%.2f',
        MAX(0,
          COALESCE(CAST(total_charge AS REAL), 0)
          - COALESCE(CAST(total_paid AS REAL), 0)
          - COALESCE(CAST(total_adjustment AS REAL), 0)
        )
      )
      WHERE remaining_balance IS NULL OR remaining_balance = ''`).run();
  } catch {
    // claims column may not exist yet
  }

  await db.prepare(`UPDATE claims
    SET workflow_status = CASE
      WHEN status IN ('submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed') THEN 'submitted'
      WHEN status = 'scrub_error' OR scrubber_status = 'errors' THEN 'error'
      WHEN scrubber_status = 'clean' OR status = 'ready' THEN
        CASE
          WHEN generation_id IS NOT NULL AND status NOT IN ('submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed') THEN 'generated'
          ELSE 'ready_to_bill'
        END
      ELSE 'needs_scrub'
    END
    WHERE workflow_status IS NULL OR workflow_status = ''`).run();
  await db.prepare(`UPDATE claims
    SET workflow_status = 'generated'
    WHERE generation_id IS NOT NULL
      AND workflow_status = 'ready_to_bill'
      AND status NOT IN ('submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed')`).run();
  await db.prepare(`UPDATE claims
    SET workflow_status = 'submitted'
    WHERE status IN ('submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed')
      AND workflow_status != 'submitted'`).run();
  await db.prepare(`UPDATE claims
    SET workflow_status = 'error'
    WHERE (status = 'scrub_error' OR scrubber_status = 'errors')
      AND workflow_status NOT IN ('error', 'submitted')`).run();
  await db.prepare(`UPDATE claims
    SET workflow_status = 'ready_to_bill'
    WHERE scrubber_status = 'clean'
      AND status = 'ready'
      AND generation_id IS NULL
      AND workflow_status IN ('needs_scrub', 'scrubbing')`).run();

  await db.prepare(`UPDATE claims
    SET submission_method = CASE WHEN submission_mode = 'paper' THEN 'paper' ELSE 'electronic' END
    WHERE submission_method = 'unassigned'
      AND status IN ('submitted', 'accepted', 'rejected', 'denied', 'paid', 'appealed')`).run();

  await db.prepare(`UPDATE claims
    SET diagnosis_codes = COALESCE((SELECT diagnosis_codes FROM encounters WHERE encounters.id = claims.encounter_id), '[]')
    WHERE encounter_id IS NOT NULL AND (diagnosis_codes IS NULL OR diagnosis_codes = '[]')`).run();

  await db
    .prepare("UPDATE billing_responsibility_profiles SET verification_status = 'unverified' WHERE verification_status = 'reported'")
    .run();

  await db.prepare(`UPDATE appointments SET flow_status = CASE status
    WHEN 'arrived' THEN 'arrived'
    WHEN 'checked_in' THEN 'waiting'
    WHEN 'in_room' THEN 'roomed'
    WHEN 'completed' THEN 'checked_out'
    ELSE flow_status END
    WHERE flow_status = 'not_arrived' AND status IN ('arrived', 'checked_in', 'in_room', 'completed')`).run();

  // Demo clinical-flow records were useful during early UI development, but must
  // never reappear in a real practice workspace. Remove previously seeded rows
  // using their reserved identifiers before normal bootstrap data is loaded.
  await runD1Batches(db, [
    db.prepare("UPDATE encounters SET status = 'void' WHERE id LIKE 'enc_apt_demo_%' OR appointment_id LIKE 'apt_demo_%'"),
    db.prepare("UPDATE appointments SET status = 'cancelled', flow_status = 'not_arrived' WHERE id LIKE 'apt_demo_%'"),
    db.prepare("UPDATE patients SET status = 'inactive' WHERE id LIKE 'pat_demo_%'"),
  ]);

  await runD1Batches(db, [
    db.prepare(`INSERT OR IGNORE INTO organizations
      (id, legal_name, dba_name, organization_npi, status)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(
        "org_pracx_health",
        "PRACX Health Network, PLLC",
        "PRACX Care",
        "1487926305",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO practice_settings
      (organization_id, scheduler_slot_minutes)
      VALUES (?, ?)`)
      .bind("org_pracx_health", "15"),
    db.prepare(`INSERT OR IGNORE INTO facilities
      (id, organization_id, name, code, facility_type, npi, phone, timezone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "fac_midtown",
        "org_pracx_health",
        "Midtown Medical Center",
        "MIDTOWN",
        "Medical office",
        "1487926313",
        "(212) 555-0184",
        "America/New_York",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO facilities
      (id, organization_id, name, code, facility_type, npi, phone, timezone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "fac_riverside",
        "org_pracx_health",
        "Riverside Specialty Clinic",
        "RIVER",
        "Independent clinic",
        "1487926321",
        "(201) 555-0132",
        "America/New_York",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO service_locations
      (id, facility_id, name, place_of_service_code, address_line_1, city, state, postal_code, is_primary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "loc_midtown_main",
        "fac_midtown",
        "Main service location",
        "11",
        "315 Madison Avenue",
        "New York",
        "NY",
        "10017",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO service_locations
      (id, facility_id, name, place_of_service_code, address_line_1, city, state, postal_code, is_primary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "loc_riverside_main",
        "fac_riverside",
        "Riverside service location",
        "49",
        "820 River Road",
        "Edgewater",
        "NJ",
        "07020",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO users
      (id, full_name, email, password_hash, password_salt, role, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "usr_local_admin",
        "PRACX Administrator",
        "admin@pracx.local",
        "21f5a05f501dae8cfecbde9a357ecd72007a51ffc8f6175a3b7232d1bd548eb6",
        "e854d6d680c1f397d8f0ea37b8c470f1",
        "administrator",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO providers
      (id, organization_id, provider_code, first_name, last_name, credentials, npi, taxonomy_code, specialty, email, phone, is_billing, is_rendering, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "prv_maya_chen",
        "org_pracx_health",
        "CHEN01",
        "Maya",
        "Chen",
        "MD",
        "1487926404",
        "207Q00000X",
        "Family Medicine",
        "maya.chen@pracx.local",
        "(212) 555-0148",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO provider_licenses
      (id, provider_id, state, license_number, expiration_date, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        "lic_maya_ny",
        "prv_maya_chen",
        "NY",
        "298541",
        "2027-08-31",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO provider_facility_assignments
      (id, provider_id, facility_id, is_primary)
      VALUES (?, ?, ?, ?)`)
      .bind("pfa_maya_midtown", "prv_maya_chen", "fac_midtown", "yes"),
    db.prepare(`INSERT OR IGNORE INTO referring_providers
      (id, organization_id, first_name, last_name, credentials, npi, taxonomy_code, specialty, organization_name, phone, fax, city, state, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "ref_adrian_cole",
        "org_pracx_health",
        "Adrian",
        "Cole",
        "MD",
        "1487926412",
        "207R00000X",
        "Internal Medicine",
        "Hudson Primary Care",
        "(201) 555-0120",
        "(201) 555-0121",
        "Hoboken",
        "NJ",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO payers
      (id, organization_id, name, payer_id, eligibility_payer_id, claim_filing_indicator, payer_type, clearinghouse_route, phone, fax, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pay_aetna",
        "org_pracx_health",
        "Aetna",
        "60054",
        "60054",
        "CI",
        "Commercial",
        "Stedi",
        "(800) 624-0756",
        "(859) 455-8650",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO payers
      (id, organization_id, name, payer_id, eligibility_payer_id, claim_filing_indicator, payer_type, clearinghouse_route, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pay_medicare",
        "org_pracx_health",
        "Medicare",
        "00882",
        "00882",
        "MB",
        "Medicare",
        "Stedi",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO insurance_plans
      (id, payer_id, name, plan_type, default_group_number, timely_filing_days, requires_referral, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("plan_aetna_choice", "pay_aetna", "Aetna Choice POS II", "POS", "GRP44591", "90", "no", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO insurance_plans
      (id, payer_id, name, plan_type, timely_filing_days, requires_referral, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("plan_medicare_partb", "pay_medicare", "Medicare Part B", "Federal", "365", "no", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO patients
      (id, organization_id, account_number, first_name, middle_name, last_name, date_of_birth, sex, address_line_1, city, state, postal_code, phone, email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pat_olivia_martin",
        "org_pracx_health",
        "PX100001",
        "Olivia",
        "R",
        "Martin",
        "1986-04-17",
        "female",
        "114 East 38th Street",
        "New York",
        "NY",
        "10016",
        "(917) 555-0162",
        "olivia.martin@example.test",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patients
      (id, organization_id, account_number, first_name, last_name, date_of_birth, sex, address_line_1, city, state, postal_code, phone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pat_noah_wilson",
        "org_pracx_health",
        "PX100002",
        "Noah",
        "Wilson",
        "1954-11-02",
        "male",
        "88 Riverside Drive",
        "New York",
        "NY",
        "10024",
        "(646) 555-0198",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patient_coverages
      (id, patient_id, plan_id, priority, member_id, group_number, relationship, subscriber_first_name, subscriber_last_name, subscriber_date_of_birth, subscriber_sex, effective_date, accept_assignment, release_of_information, assignment_of_benefits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "cov_olivia_aetna",
        "pat_olivia_martin",
        "plan_aetna_choice",
        "primary",
        "W245801144",
        "GRP44591",
        "self",
        "Olivia",
        "Martin",
        "1986-04-17",
        "female",
        "2026-01-01",
        "yes",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO patient_coverages
      (id, patient_id, plan_id, priority, member_id, relationship, subscriber_first_name, subscriber_last_name, subscriber_date_of_birth, subscriber_sex, effective_date, accept_assignment, release_of_information, assignment_of_benefits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "cov_noah_medicare",
        "pat_noah_wilson",
        "plan_medicare_partb",
        "primary",
        "1EG4TE5MK73",
        "self",
        "Noah",
        "Wilson",
        "1954-11-02",
        "male",
        "2020-11-01",
        "yes",
        "yes",
        "yes",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO billing_responsibility_profiles
      (id, patient_id, profile_name, billing_context, effective_from, verification_status, guarantor_type, guarantor_name, patient_billing_hold, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsp_olivia_routine_2026",
        "pat_olivia_martin",
        "2026 routine medical",
        "routine",
        "2026-01-01",
        "verified",
        "patient",
        "Olivia Martin",
        "no",
        "Active commercial coverage confirmed for routine medical services.",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_sources
      (id, profile_id, sequence, role, source_type, coverage_id, source_name, activation_condition, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsrc_olivia_aetna",
        "rsp_olivia_routine_2026",
        "1",
        "primary",
        "insurance",
        "cov_olivia_aetna",
        "Aetna Choice POS II",
        "Bill first for routine services within the effective range.",
        "ready",
      ),
    db.prepare(`INSERT OR IGNORE INTO billing_responsibility_profiles
      (id, patient_id, profile_name, billing_context, effective_from, verification_status, guarantor_type, guarantor_name, patient_billing_hold, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsp_noah_routine_2026",
        "pat_noah_wilson",
        "Medicare routine medical",
        "routine",
        "2026-01-01",
        "unverified",
        "patient",
        "Noah Wilson",
        "no",
        "Current working order is unverified; COB confirmation remains due.",
        "active",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_sources
      (id, profile_id, sequence, role, source_type, coverage_id, source_name, activation_condition, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "rsrc_noah_medicare",
        "rsp_noah_routine_2026",
        "1",
        "primary",
        "insurance",
        "cov_noah_medicare",
        "Medicare Part B",
        "Bill after confirming Medicare Secondary Payer status.",
        "pending",
      ),
    db.prepare(`INSERT OR IGNORE INTO responsibility_profile_history
      (id, profile_id, action, snapshot, reason, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        "rhist_olivia_created",
        "rsp_olivia_routine_2026",
        "created",
        '{"billingContext":"routine","effectiveFrom":"2026-01-01","primary":"Aetna Choice POS II","guarantor":"Olivia Martin"}',
        "Initial responsibility profile",
        "PRACX Administrator",
      ),
    db.prepare(`INSERT OR IGNORE INTO eligibility_checks
      (id, patient_id, coverage_id, date_of_service, status, copay_amount, deductible_remaining, coinsurance_percent, reference_number, response_summary, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "elig_olivia_0728",
        "pat_olivia_martin",
        "cov_olivia_aetna",
        "2026-07-28",
        "eligible",
        "30.00",
        "420.00",
        "20",
        "ELG7845221",
        "Active medical coverage; specialist copay $30.",
        "2026-07-28T08:15:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO appointments
      (id, organization_id, patient_id, provider_id, facility_id, start_at, end_at, appointment_type, reason, status, eligibility_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "apt_olivia_followup",
        "org_pracx_health",
        "pat_olivia_martin",
        "prv_maya_chen",
        "fac_midtown",
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:30:00.000Z",
        "Office follow-up",
        "Hypertension follow-up",
        "completed",
        "eligible",
      ),
    db.prepare(`INSERT OR IGNORE INTO appointments
      (id, organization_id, patient_id, provider_id, facility_id, start_at, end_at, appointment_type, reason, status, eligibility_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "apt_noah_awv",
        "org_pracx_health",
        "pat_noah_wilson",
        "prv_maya_chen",
        "fac_midtown",
        "2026-07-29T14:00:00.000Z",
        "2026-07-29T14:45:00.000Z",
        "Annual wellness",
        "Medicare annual wellness visit",
        "confirmed",
        "pending",
      ),
    ...uniqueDiagnosisCodeSeeds().map(([id, code, description]) => db.prepare(`INSERT OR IGNORE INTO diagnosis_code_master
      (id, code, description, code_set, status) VALUES (?, ?, ?, 'ICD-10-CM', 'active')`).bind(id, code, description)),
    ...CLINICAL_ORDER_CATALOG_SEEDS.map(([orderType, code, name, category, keywords, specimenOrModality, sortOrder]) => db.prepare(`INSERT OR IGNORE INTO clinical_order_catalog
      (id, order_type, code, name, category, keywords, specimen_or_modality, sort_order, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(`ordcat_${orderType}_${code}`, orderType, code, name, category, keywords, specimenOrModality, sortOrder)),
    ...[
      ["cc_hpi_onset", "hpi", "Symptom timeline", "Symptoms began [onset] and have been [improving / worsening / unchanged].", "onset duration timeline symptoms", "All specialties", "10"],
      ["cc_hpi_quality", "hpi", "Location and quality", "Symptoms are located at [site] and described as [quality], with severity [0–10].", "location quality severity pain", "All specialties", "20"],
      ["cc_hpi_factors", "hpi", "Aggravating and relieving factors", "Symptoms are aggravated by [factor] and relieved by [factor]. Associated symptoms include [symptoms].", "aggravating relieving associated symptoms", "All specialties", "30"],
      ["cc_hpi_followup", "hpi", "Chronic-condition follow-up", "Since the last visit, symptoms and home measurements have been reviewed along with adherence and treatment tolerance.", "follow up chronic adherence home readings", "Primary Care", "40"],
      ["cc_ros_constitutional", "ros", "Constitutional", "Constitutional: Denies fever, chills or unintentional weight change.", "constitutional fever chills weight", "All specialties", "10"],
      ["cc_ros_cardio", "ros", "Cardiovascular", "Cardiovascular: Denies chest pain, palpitations, syncope or peripheral edema.", "cardiac cardiovascular chest pain palpitations edema", "Primary Care", "20"],
      ["cc_ros_respiratory", "ros", "Respiratory", "Respiratory: Denies cough, wheezing or shortness of breath.", "respiratory cough wheezing dyspnea", "Primary Care", "30"],
      ["cc_ros_neuro", "ros", "Neurologic", "Neurologic: Denies new weakness, numbness, dizziness or severe headache.", "neurologic weakness numbness dizziness headache", "All specialties", "40"],
      ["cc_exam_general", "exam", "General appearance", "General: Alert, oriented and in no acute distress.", "general appearance alert oriented distress", "All specialties", "10"],
      ["cc_exam_cardio", "exam", "Cardiovascular examination", "Cardiovascular: Regular rate and rhythm; no clinically apparent peripheral edema.", "cardiovascular heart rhythm edema", "Primary Care", "20"],
      ["cc_exam_lungs", "exam", "Respiratory examination", "Respiratory: Normal effort; lungs clear to auscultation bilaterally.", "respiratory lungs auscultation", "Primary Care", "30"],
      ["cc_exam_msk", "exam", "Musculoskeletal examination", "Musculoskeletal: [site] range of motion, tenderness, strength and neurovascular status assessed.", "musculoskeletal range motion tenderness strength", "Orthopedics", "40"],
      ["cc_assessment_stable", "assessment", "Stable chronic condition", "[Condition] is chronic and stable on the current treatment plan.", "assessment stable chronic condition", "All specialties", "10"],
      ["cc_assessment_not_controlled", "assessment", "Condition not at goal", "[Condition] is not yet at goal; contributing factors and treatment options were reviewed.", "assessment uncontrolled not at goal", "All specialties", "20"],
      ["cc_plan_continue", "plan", "Continue current therapy", "Continue current treatment. Medication adherence, expected benefit and relevant precautions were reviewed.", "continue treatment medication counseling", "All specialties", "10"],
      ["cc_plan_monitor", "plan", "Monitoring plan", "Monitor [measurement / symptom] and maintain a written log for review at follow-up.", "monitor log measurement follow up", "All specialties", "20"],
      ["cc_plan_lifestyle", "plan", "Lifestyle counseling", "Nutrition, activity, sleep and condition-specific risk-reduction strategies were discussed.", "lifestyle nutrition activity counseling", "Primary Care", "30"],
      ["cc_followup_routine", "follow_up", "Routine follow-up", "Return in [interval] for reassessment, or earlier for new or worsening symptoms.", "return interval routine follow up", "All specialties", "10"],
      ["cc_followup_precautions", "follow_up", "Return precautions", "Seek urgent evaluation for [warning symptoms]. The patient verbalized understanding of the plan.", "precautions urgent warning symptoms", "All specialties", "20"],
      ["cc_note_shared_decision", "additional_note", "Shared decision-making", "Options, expected benefits, material risks and alternatives were discussed; the patient participated in the decision.", "shared decision risk benefit alternatives", "All specialties", "10"],
    ].map(([id, section, title, content, keywords, specialty, sortOrder]) => db.prepare(`INSERT OR IGNORE INTO clinical_content_items
      (id, section, title, content, keywords, specialty, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`).bind(id, section, title, content, keywords, specialty, sortOrder)),
    ...[
      ["subj_complaint_htn", "complaint", "Hypertension follow-up", "Hypertension follow-up", "hypertension blood pressure bp", "Primary Care"],
      ["subj_complaint_refill", "complaint", "Medication refill", "Medication refill and treatment monitoring", "refill medication follow up", "Primary Care"],
      ["subj_complaint_awv", "complaint", "Annual wellness visit", "Medicare annual wellness visit", "awv annual wellness preventive", "Primary Care"],
      ["subj_complaint_sinus", "complaint", "Sinus congestion", "Sinus congestion with associated upper-respiratory symptoms", "sinus congestion uri", "Primary Care"],
      ["subj_hpi_interval", "hpi", "Interval follow-up", "Since the last visit, symptoms, home measurements, medication adherence and treatment tolerance were reviewed.", "interval follow up adherence", "Primary Care"],
      ["subj_hpi_acute", "hpi", "Acute symptom history", "Symptoms began [onset], are located at [site], are described as [quality], and have been [improving / worsening / unchanged]. Severity is [0–10].", "acute onset duration severity", "All specialties"],
      ["subj_hpi_medication", "hpi", "Medication follow-up", "The patient reports [adherence], [benefit / no benefit], and [adverse effects / no adverse effects] with the current regimen.", "medication response adverse effects", "All specialties"],
    ].map(([id, itemType, title, content, keywords, specialty]) => db.prepare(`INSERT OR IGNORE INTO subjective_library_items
      (id, organization_id, item_type, title, content, keywords, specialty, associated_complaints, scope, approval_status, created_by_user_id, created_by_name, status)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, '[]', 'practice', 'published', 'usr_local_admin', 'PRACX Administrator', 'active')`).bind(id, itemType, title, content, keywords, specialty)),
    ...CLINICAL_OPTION_SEEDS.map(([optionGroup, code, label, optionValue, keywords, parentCode]) => db.prepare(`INSERT OR IGNORE INTO clinical_option_master
      (id, organization_id, option_group, code, label, value, parent_code, keywords, specialty, source, version, metadata_json, sort_order, status)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, ?, 'All specialties', 'PRACX curated starter', '2026.1', '{}', '100', 'active')`)
      .bind(`com_${optionGroup}_${code}`, optionGroup, code, label, optionValue, parentCode || null, keywords)),
    ...[
      ["svc_established_office", "Established patient office visit", "Evaluation & management", "Primary Care", "99213", '["I10","E11.9","E78.5"]', '["Record the reason for the encounter","Document relevant history and findings","State each assessed problem and its status","Document the care plan and follow-up","Select the E/M level only after reviewing MDM or time"]', "office follow up established evaluation management", "2026-01-01"],
      ["svc_hypertension_followup", "Hypertension follow-up", "Chronic care", "Primary Care", "99213", '["I10"]', '["Record interval blood-pressure history and home readings","Document medication adherence and adverse effects","Record today’s blood pressure and relevant examination","State control status and management plan"]', "blood pressure hypertension bp follow up", "2026-01-01"],
      ["svc_diabetes_followup", "Diabetes follow-up", "Chronic care", "Primary Care", "99213", '["E11.9"]', '["Record glucose trend and relevant laboratory review","Document medication adherence and adverse effects","Assess complications and preventive care needs","State control status and management plan"]', "diabetes glucose a1c follow up", "2026-01-01"],
      ["svc_annual_wellness", "Subsequent annual wellness visit", "Preventive", "Primary Care", "G0439", '["Z00.00"]', '["Complete and document the health-risk assessment","Review medical and family history","Assess cognition, function, mood and safety","Create or update the written prevention plan","Confirm payer and frequency requirements"]', "annual wellness preventive medicare awv", "2026-01-01"],
      ["svc_ecg", "12-lead electrocardiogram", "Diagnostic", "Cardiology", "93000", '[]', '["Document the clinical indication","Record tracing acquisition and interpretation","Document findings and resulting plan","Confirm whether the billed code includes tracing, interpretation, or both"]', "ecg ekg electrocardiogram tracing interpretation", "2026-01-01"],
      ["svc_uri_visit", "Acute respiratory symptom visit", "Acute care", "Primary Care", "99213", '["J06.9"]', '["Document onset, severity and associated symptoms","Record respiratory and constitutional findings","Address red flags and testing considered","Document treatment and return precautions"]', "cough cold uri respiratory acute", "2026-01-01"],
      ["svc_low_back_pain", "Low-back pain evaluation", "Musculoskeletal", "Primary Care", "99213", '["M54.50"]', '["Document onset, mechanism, location and neurologic symptoms","Record relevant examination and red-flag assessment","Document conservative treatment, orders and precautions","State the follow-up plan"]', "back pain lumbar musculoskeletal", "2026-01-01"],
      ["svc_ccm", "Chronic care management", "Care management", "Primary Care", "99490", '[]', '["Confirm qualifying chronic conditions and consent","Maintain a comprehensive care plan","Record staff time and furnished services","Confirm payer-specific eligibility and frequency rules"]', "chronic care management ccm care plan", "2026-01-01"],
    ].map(([id, name, category, specialty, procedureCode, diagnosisCodes, prompts, keywords, effectiveDate]) => db.prepare(`INSERT OR IGNORE INTO practice_services
      (id, organization_id, name, category, specialty, procedure_code, suggested_diagnosis_codes, documentation_prompts, keywords, effective_date, status)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(id, name, category, specialty, procedureCode, diagnosisCodes, prompts, keywords, effectiveDate)),
    ...VISIT_NOTE_TEMPLATE_SEEDS.map((template) => db.prepare(`INSERT OR IGNORE INTO visit_note_templates
      (id, organization_id, name, category, specialty, template_json, suggested_diagnosis_codes, suggested_procedure_codes, keywords, status)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
        template.id,
        template.name,
        template.category,
        template.specialty,
        template.templateJson,
        template.diagnosisCodes,
        template.procedureCodes,
        template.keywords,
      )),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_99213", "99213", "Office/outpatient visit, established patient", "CPT", "145.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_93000", "93000", "Electrocardiogram with interpretation", "CPT", "85.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) 
      .bind("proc_g0439", "G0439", "Annual wellness visit, subsequent", "HCPCS", "225.00", "11", "no", "active"),
    db.prepare(`INSERT OR IGNORE INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("proc_99490", "99490", "Chronic care management, first 20 minutes", "CPT", "95.00", "11", "no", "active"),
    ...RPM_CODE_MASTER.map((rpm) => db.prepare(`INSERT INTO procedure_codes
      (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
      VALUES (?, ?, ?, 'CPT', '0.00', '11', 'no', 'active')
      ON CONFLICT(code) DO UPDATE SET description = excluded.description, code_set = excluded.code_set, status = 'active'`)
      .bind(`proc_${rpm.code}`, rpm.code, rpm.description)),
    db.prepare(`INSERT OR IGNORE INTO fee_schedules
      (id, organization_id, payer_id, name, effective_date, status)
      VALUES (?, ?, ?, ?, ?, 'active')`)
      .bind(RPM_MEDICARE_REFERENCE.scheduleId, "org_pracx_health", RPM_MEDICARE_REFERENCE.payerId, RPM_MEDICARE_REFERENCE.name, RPM_MEDICARE_REFERENCE.effectiveDate),
    ...RPM_CODE_MASTER.map((rpm) => db.prepare(`INSERT OR IGNORE INTO fee_schedule_items
      (id, fee_schedule_id, procedure_code_id, allowed_amount)
      SELECT ?, ?, id, ? FROM procedure_codes WHERE code = ?`)
      .bind(`fsi_medicare_rpm_${rpm.code}`, RPM_MEDICARE_REFERENCE.scheduleId, rpm.medicareReferenceFee, rpm.code)),
    db.prepare(`INSERT OR IGNORE INTO fee_schedules
      (id, organization_id, payer_id, name, effective_date, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("fs_aetna_2026", "org_pracx_health", "pay_aetna", "Aetna 2026 Contract", "2026-01-01", "active"),
    db.prepare(`INSERT OR IGNORE INTO fee_schedule_items
      (id, fee_schedule_id, procedure_code_id, allowed_amount)
      VALUES (?, ?, ?, ?)`)
      .bind("fsi_aetna_99213", "fs_aetna_2026", "proc_99213", "112.50"),
    db.prepare(`INSERT OR IGNORE INTO fee_schedule_items
      (id, fee_schedule_id, procedure_code_id, allowed_amount)
      VALUES (?, ?, ?, ?)`)
      .bind("fsi_aetna_93000", "fs_aetna_2026", "proc_93000", "62.00"),
    db.prepare(`INSERT OR IGNORE INTO encounters
      (id, appointment_id, patient_id, provider_id, facility_id, referring_provider_id, date_of_service, chief_complaint, clinical_note, diagnosis_codes, procedure_codes, status, signed_at, ready_to_bill_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "enc_olivia_0728",
        "apt_olivia_followup",
        "pat_olivia_martin",
        "prv_maya_chen",
        "fac_midtown",
        "ref_adrian_cole",
        "2026-07-28",
        "Blood pressure follow-up",
        "Blood pressure improving. Continue medication and home monitoring.",
        '["I10"]',
        '["99213"]',
        "ready_to_bill",
        "2026-07-28T10:35:00.000Z",
        "2026-07-28T10:36:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO claims
      (id, organization_id, claim_number, patient_id, encounter_id, coverage_id, payer_id, provider_id, facility_id, referring_provider_id, date_of_service, transaction_date, posting_date, first_billed_date, last_billed_date, status, scrubber_status, scrubber_messages, total_charge, total_paid, total_adjustment, patient_responsibility, submission_mode, clearinghouse_trace)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "clm_100001",
        "org_pracx_health",
        "CLM100001",
        "pat_olivia_martin",
        "enc_olivia_0728",
        "cov_olivia_aetna",
        "pay_aetna",
        "prv_maya_chen",
        "fac_midtown",
        "ref_adrian_cole",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "accepted",
        "clean",
        "[]",
        "145.00",
        "82.50",
        "32.50",
        "30.00",
        "test",
        "CH202607280001",
      ),
    db.prepare(`INSERT OR IGNORE INTO claim_responsibility_snapshots
      (id, claim_id, profile_id, billing_context, profile_snapshot)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(
        "crs_clm_100001",
        "clm_100001",
        "rsp_olivia_routine_2026",
        "routine",
        '{"profileName":"2026 routine medical","effectiveFrom":"2026-01-01","primary":"Aetna Choice POS II","guarantor":"Olivia Martin","patientBillingHold":"no"}',
      ),
    db.prepare(`INSERT OR IGNORE INTO claim_lines
      (id, claim_id, line_number, procedure_code, diagnosis_pointers, units, charge_amount, place_of_service, rendering_npi, service_date_from, service_date_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("cline_100001_1", "clm_100001", "1", "99213", "A", "1", "145.00", "11", "1487926404", "2026-07-28", "2026-07-28"),
    db.prepare(`INSERT OR IGNORE INTO remittances
      (id, payer_id, trace_number, payment_date, amount, source, status, raw_835, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "era_aetna_0728",
        "pay_aetna",
        "EFT78442026",
        "2026-07-28",
        "82.50",
        "835_test",
        "posted",
        "ISA*00*          *00*          *ZZ*AETNA          *ZZ*PRACX          *260728*1200*^*00501*000000001*0*T*:~",
        "2026-07-28T12:20:00.000Z",
      ),
    db.prepare(`INSERT OR IGNORE INTO payments
      (id, claim_id, remittance_id, payment_type, payer_name, amount, adjustment_amount, adjustment_reason, reference_number, transaction_date, payment_date, posting_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "pmt_clm100001",
        "clm_100001",
        "era_aetna_0728",
        "insurance",
        "Aetna",
        "82.50",
        "32.50",
        "CO-45 Contractual obligation",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_charge_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "charge",
        "EMR",
        "145.00",
        "99213 Office visit",
        "CLM100001",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, payment_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_payment_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "insurance_payment",
        "ERA 835",
        "-82.50",
        "Aetna insurance payment",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (id, organization_id, patient_id, claim_id, transaction_type, source, amount, description, reference_number, date_of_service, transaction_date, payment_date, posting_date, first_billed_date, last_billed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "txn_adjustment_100001",
        "org_pracx_health",
        "pat_olivia_martin",
        "clm_100001",
        "adjustment",
        "ERA 835",
        "-32.50",
        "CO-45 Contractual adjustment",
        "EFT78442026",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
        "2026-07-28",
      ),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_clearinghouse", "org_pracx_health", "clearinghouse", "Not selected", "file", "needs_credentials"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_eligibility", "org_pracx_health", "eligibility_270_271", "Test responder", "test", "configured"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_era", "org_pracx_health", "era_835", "File import", "file", "configured"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_lab", "org_pracx_health", "laboratory_results", "Local result entry", "test", "needs_credentials"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_imaging", "org_pracx_health", "imaging_results", "Local result entry", "test", "needs_credentials"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("int_eprescribe", "org_pracx_health", "e_prescribing", "Local medication workflow", "test", "needs_credentials"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status, endpoint)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind("int_ehr_elation", "org_pracx_health", "ehr_elation", "Elation", "test", "configured", "https://app.elationemr.com/api"),
    db.prepare("UPDATE integrations SET source_system = 'elation' WHERE id = 'int_ehr_elation' AND (source_system IS NULL OR source_system = '')"),
    db.prepare(`INSERT OR IGNORE INTO integrations
      (id, organization_id, integration_type, vendor_name, mode, status, endpoint)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind("int_stedi", "org_pracx_health", "stedi_edi", "Stedi", "test", "configured", "https://api.stedi.com"),
  ]);

  // Spec is Elation ↔ PRACX ↔ Stedi only — remove earlier multi-EHR demo connectors.
  await runD1Batches(db, [
    db.prepare("DELETE FROM integration_inbound_events WHERE id LIKE 'ibe_%' OR source_system IN ('athena', 'ecw', 'office_ally')"),
    db.prepare("DELETE FROM integration_sync_events WHERE id LIKE 'ise_%'"),
    db.prepare("DELETE FROM integrations WHERE id IN ('int_ehr_athena', 'int_ehr_ecw', 'int_clearinghouse') OR integration_type IN ('ehr_athena', 'ehr_ecw')"),
    db.prepare("UPDATE payers SET clearinghouse_route = 'Stedi' WHERE clearinghouse_route = 'Office Ally'"),
  ]);

  const inboundSeeds: Array<[string, string | null, string, string, string, string, string, string, string | null, string, string | null, string | null, string, string]> = [
    ["ibe_elation_ok_1", "int_ehr_elation", "elation", "Elation", "patient_demographics", "ELA-PT-10021", "Ava Brooks", "1991-03-12", "smp_pat_ava", "accepted", null, null, "Patient demographics pulled from Elation into PRACX", "2026-08-24T12:05:00.000Z"],
    ["ibe_elation_ok_2", "int_ehr_elation", "elation", "Elation", "encounter", "ELA-ENC-8821", "Liam Ortiz", "1978-09-04", "smp_pat_liam", "accepted", null, null, "Encounter + ICD/CPT accepted; claim draft ready", "2026-08-24T12:18:00.000Z"],
    ["ibe_elation_ins", "int_ehr_elation", "elation", "Elation", "insurance", "ELA-INS-2201", "Ethan Patel", "1965-06-30", "smp_pat_ethan", "accepted", null, null, "Payer / member / group mapped to PRACX coverage", "2026-08-24T12:22:00.000Z"],
    ["ibe_elation_name", "int_ehr_elation", "elation", "Elation", "patient_demographics", "ELA-PT-10088", "Ava Brook", "1991-03-12", null, "unmatched", "name_mismatch", "Elation name “Ava Brook” did not match PRACX patient Ava Brooks (DOB matched).", "Held in middle — not accepted into claim build", "2026-08-24T13:02:00.000Z"],
    ["ibe_elation_hold", "int_ehr_elation", "elation", "Elation", "encounter", "ELA-ENC-4410", "Mia Nguyen", "1988-12-21", "smp_pat_mia", "held", "payload_incomplete", "Encounter arrived without diagnosis codes; waiting before claim create.", "Not yet accepted into Claim prep", "2026-08-24T13:40:00.000Z"],
    ["ibe_elation_pending", "int_ehr_elation", "elation", "Elation", "insurance", "ELA-INS-2299", "Sofia Reyes", "1999-01-18", "smp_pat_sofia", "pending", "manual_review", "Member ID format differs from Aetna plan on file.", "Pending billing review before claim link", "2026-08-24T14:10:00.000Z"],
    ["ibe_elation_dob", "int_ehr_elation", "elation", "Elation", "patient_demographics", "ELA-PT-10110", "Olivia Martin", "1986-04-18", null, "unmatched", "dob_mismatch", "Name matched Olivia Martin but Elation DOB 1986-04-18 ≠ PRACX DOB 1986-04-17.", "Identity conflict — not accepted", "2026-08-24T15:05:00.000Z"],
    ["ibe_stedi_ack", "int_stedi", "stedi", "Stedi", "acknowledgement_277ca", "STEDI-ACK-9001", null, null, null, "accepted", null, null, "277CA acknowledgement received for SMP-SUBMITTED", "2026-08-24T16:05:00.000Z"],
    ["ibe_stedi_era", "int_stedi", "stedi", "Stedi", "era_835", "STEDI-ERA-4411", null, null, null, "accepted", null, null, "835 ERA paid status ingested into PRACX payment posting", "2026-08-24T16:40:00.000Z"],
    ["ibe_stedi_pending", "int_stedi", "stedi", "Stedi", "acknowledgement_999", "STEDI-999-1102", null, null, null, "pending", "ack_parse_review", "999 acknowledgement received; mapping to claim batch pending.", "In middle queue before claim status update", "2026-08-24T17:10:00.000Z"],
  ];

  await runD1Batches(db, inboundSeeds.map((row) =>
    db.prepare(`INSERT OR IGNORE INTO integration_inbound_events
      (id, organization_id, integration_id, source_system, source_label, event_type, external_id, patient_name_external, patient_dob_external, matched_patient_id, status, reason_code, reason_detail, payload_summary, received_at)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...row)));

  const syncSeeds: Array<[string, string, string, string | null, string | null, string | null, string, string, string]> = [
    ["ise_ela_pull_1", "elation_to_pracx", "encounter_pull", "smp_clm_needs_scrub", "SMP-NEEDS-SCRUB", "ELA-ENC-8821", "success", "Pulled encounter from Elation and linked claim draft", "2026-08-24T12:19:00.000Z"],
    ["ise_pracx_create", "pracx_to_elation", "claim_created", "smp_clm_needs_scrub", "SMP-NEEDS-SCRUB", "ELA-ENC-8821", "success", "Pushed Claim Created status back to Elation", "2026-08-24T12:20:00.000Z"],
    ["ise_stedi_submit", "pracx_to_stedi", "claim_submit_837", "smp_clm_submitted", "SMP-SUBMITTED", "STEDI-BATCH-001", "success", "Submitted 837 to Stedi with batch reference", "2026-08-24T15:30:00.000Z"],
    ["ise_elation_submitted", "pracx_to_elation", "claim_submitted", "smp_clm_submitted", "SMP-SUBMITTED", "ELA-ENC-9910", "success", "Pushed Claim Submitted status to Elation", "2026-08-24T15:31:00.000Z"],
    ["ise_stedi_ack", "stedi_to_pracx", "acknowledgement_277ca", "smp_clm_submitted", "SMP-SUBMITTED", "STEDI-ACK-9001", "success", "Stedi acknowledgement accepted in PRACX", "2026-08-24T16:05:00.000Z"],
    ["ise_elation_ack", "pracx_to_elation", "claim_acknowledged", "smp_clm_submitted", "SMP-SUBMITTED", "STEDI-ACK-9001", "success", "Pushed Claim Acknowledged (number/date/time) to Elation", "2026-08-24T16:06:00.000Z"],
    ["ise_stedi_era", "stedi_to_pracx", "era_paid", "smp_clm_submitted", "SMP-SUBMITTED", "STEDI-ERA-4411", "success", "ERA paid amounts applied in PRACX", "2026-08-24T16:40:00.000Z"],
    ["ise_elation_paid", "pracx_to_elation", "claim_paid", "smp_clm_submitted", "SMP-SUBMITTED", "STEDI-ERA-4411", "pending", "Pushing Claim Paid (payment date / amount / balance) to Elation", "2026-08-24T16:41:00.000Z"],
    ["ise_elation_mismatch", "elation_to_pracx", "patient_match", null, null, "ELA-PT-10088", "error", "Name mismatch blocked claim creation — not pushed to Stedi", "2026-08-24T13:02:30.000Z"],
    ["ise_stedi_999_hold", "stedi_to_pracx", "acknowledgement_999", "smp_clm_edi", "SMP-EDI-BATCH", "STEDI-999-1102", "pending", "999 acknowledgement waiting claim-batch mapping", "2026-08-24T17:10:00.000Z"],
  ];

  await runD1Batches(db, syncSeeds.map((row) =>
    db.prepare(`INSERT OR IGNORE INTO integration_sync_events
      (id, organization_id, direction, event_type, claim_id, claim_number, external_ref, status, summary, occurred_at)
      VALUES (?, 'org_pracx_health', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...row)));

  await runD1Batches(db, CLAIM_CONFIGURATION_DEFAULTS.map((item) =>
    db.prepare(`INSERT OR IGNORE INTO claim_configuration_values
      (id, category, code, display_name, internal_guidance, source, is_official, effective_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `official:${item.category}:${item.code}`,
        item.category,
        item.code,
        item.displayName,
        item.guidance,
        "NUCC 1500 v13.0 7/25",
        "yes",
        item.effectiveDate || "2025-07-01",
        "active",
      )));

  coreSchemaReady = true;
}
