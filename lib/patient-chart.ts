export const CHART_SECTIONS = [
  { id: "facesheet", label: "Facesheet" },
  { id: "history", label: "History" },
  { id: "problems", label: "Problems" },
  { id: "medications", label: "Medications" },
  { id: "immunizations", label: "Immunizations" },
  { id: "allergies", label: "Allergies" },
  { id: "vitals", label: "Vitals" },
  { id: "notes", label: "Notes" },
  { id: "labs", label: "Labs/Studies" },
  { id: "flowsheets", label: "Flowsheets" },
  { id: "demographics", label: "Demographics" },
  { id: "account", label: "Account" },
  { id: "checklist", label: "Care Checklist" },
  { id: "documents", label: "Documents" },
  { id: "recall", label: "Recall" },
] as const;

export type ChartSectionId = (typeof CHART_SECTIONS)[number]["id"];

export const DEFAULT_CARE_CHECKLIST = [
  { itemKey: "allergies_reviewed", label: "Allergies reconciled", category: "safety" },
  { itemKey: "medications_reviewed", label: "Medications reconciled", category: "safety" },
  { itemKey: "advance_directive", label: "Advance directive on file", category: "administrative" },
  { itemKey: "annual_wellness", label: "Annual wellness / CPE due", category: "preventive" },
  { itemKey: "colon_cancer_screen", label: "Colorectal cancer screening", category: "preventive" },
  { itemKey: "breast_cancer_screen", label: "Breast cancer screening", category: "preventive" },
  { itemKey: "cervical_cancer_screen", label: "Cervical cancer screening", category: "preventive" },
  { itemKey: "depression_screen", label: "Depression screening (PHQ)", category: "behavioral" },
  { itemKey: "fall_risk", label: "Fall risk assessment", category: "safety" },
  { itemKey: "immunizations_up_to_date", label: "Immunizations up to date", category: "preventive" },
] as const;

export const FLOWSHEET_METRICS = [
  { key: "weight", label: "Weight", unit: "lb" },
  { key: "bmi", label: "BMI", unit: "kg/m²" },
  { key: "systolic", label: "Systolic BP", unit: "mmHg" },
  { key: "diastolic", label: "Diastolic BP", unit: "mmHg" },
  { key: "pulse", label: "Pulse", unit: "bpm" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "temperature", label: "Temperature", unit: "°F" },
  { key: "glucose", label: "Glucose", unit: "mg/dL" },
  { key: "a1c", label: "A1c", unit: "%" },
] as const;

export function isChartSectionId(value: string): value is ChartSectionId {
  return CHART_SECTIONS.some((section) => section.id === value);
}
