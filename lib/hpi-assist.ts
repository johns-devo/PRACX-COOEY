/** Common speech-to-text mishearings → clinical terms. Order matters (longer / more specific first). */
const ASR_MEDICAL_CORRECTIONS: Array<[RegExp, string]> = [
  [/\basian came with\b/gi, "patient came with"],
  [/\ba asian came with\b/gi, "a patient came with"],
  [/\bthe asian came with\b/gi, "the patient came with"],
  [/\basian presents with\b/gi, "patient presents with"],
  [/\basian reports\b/gi, "patient reports"],
  [/\basian has\b/gi, "patient has"],
  [/\basian is having\b/gi, "patient is having"],
  [/\bmild\s+singh\b/gi, "mild wheezing"],
  [/\bhaving\s+mild\s+singh\b/gi, "having mild wheezing"],
  [/\bsingh\b/gi, "wheezing"],
  [/\bweezing\b/gi, "wheezing"],
  [/\bwhezing\b/gi, "wheezing"],
  [/\bwheezin\b/gi, "wheezing"],
  [/\bjust condition\b/gi, "chest condition"],
  [/\bjust congestion\b/gi, "chest congestion"],
  [/\bchest just\b/gi, "chest"],
  [/\bchest condition\b/gi, "chest congestion"],
  [/\bchest conditions\b/gi, "chest congestion"],
  [/\bcough in\b/gi, "coughing"],
  [/\bcoughing up\b/gi, "coughing up"],
  [/\bshortness of breadth\b/gi, "shortness of breath"],
  [/\bshort of breadth\b/gi, "short of breath"],
  [/\bsob\b/gi, "shortness of breath"],
  [/\bhigh pretension\b/gi, "hypertension"],
  [/\bhigh blood pressure\b/gi, "hypertension"],
  [/\blow blood pressure\b/gi, "hypotension"],
  [/\bdie of beaters\b/gi, "diabetes"],
  [/\bdiabetes mellitus\b/gi, "diabetes mellitus"],
  [/\bmigrane\b/gi, "migraine"],
  [/\bnieces\b/gi, "nausea"],
  [/\bnausia\b/gi, "nausea"],
  [/\bvomitting\b/gi, "vomiting"],
  [/\bdiarrhia\b/gi, "diarrhea"],
  [/\bdiarrhoea\b/gi, "diarrhea"],
  [/\bphlem\b/gi, "phlegm"],
  [/\bflug\b/gi, "flu"],
  [/\bpneumoni\b/gi, "pneumonia"],
  [/\basma\b/gi, "asthma"],
  [/\basmatha\b/gi, "asthma"],
  [/\bcopd\b/gi, "COPD"],
  [/\buri\b/gi, "upper respiratory infection"],
  [/\bhand pane\b/gi, "hand pain"],
  [/\bhead ache\b/gi, "headache"],
  [/\bsore though\b/gi, "sore throat"],
  [/\brunny knows\b/gi, "runny nose"],
  [/\bstuffy knows\b/gi, "stuffy nose"],
  [/\bpatient also having fever\b/gi, ""],
  [/\balso having fever\b/gi, ""],
  [/\balso has fever\b/gi, ""],
  [/\bpatient having fever\b/gi, "fever"],
  [/\bhaving fever\b/gi, "fever"],
  [/\bcame with\.?\s*fever\b/gi, "came with fever"],
  [/\bpresents with\.?\s*fever\b/gi, "presents with fever"],
];

const FILLERS = [
  /\b(um+|uh+|erm+|ah+|hmm+)\b[,.]?/gi,
  /\byou know\b[,.]?/gi,
  /\bkind of\b/gi,
  /\bsort of\b/gi,
  /\bbasically\b/gi,
];

export function applyAsrCorrections(input: string) {
  let text = input;
  for (const [pattern, replacement] of ASR_MEDICAL_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

function normalizeContractions(input: string) {
  return input
    .replace(/\bi\b/g, "I")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bcant\b/gi, "can't")
    .replace(/\bwont\b/gi, "won't")
    .replace(/\bdidnt\b/gi, "didn't")
    .replace(/\bhavent\b/gi, "haven't")
    .replace(/\bhasnt\b/gi, "hasn't")
    .replace(/\bisnt\b/gi, "isn't")
    .replace(/\bwasnt\b/gi, "wasn't");
}

function splitClinicalPhrases(input: string) {
  return input
    .replace(/([a-z])\.([A-Z])/g, "$1. $2")
    .split(/[.!?]+|\n+/)
    .flatMap((chunk) => chunk.split(/,(?=\s*(?:having|has|with|and|also)\b)/i))
    .map((part) => part.replace(/^[,;\s]+|[,;\s]+$/g, "").trim())
    .filter(Boolean);
}

function extractFindings(phrases: string[]) {
  const findings: string[] = [];
  const seen = new Set<string>();

  function add(finding: string) {
    const cleaned = finding.replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (!cleaned) return;
    const key = cleaned.toLowerCase().replace(/^(the\s+)?patient\s+(is\s+)?(also\s+)?(having|has|reports?|presents with|came with)\s+/i, "");
    if (!key || seen.has(key)) return;
    // Drop bare duplicate of an already captured symptom word
    if ([...seen].some((item) => item.includes(key) || key.includes(item))) {
      if (key.length <= 12 && [...seen].some((item) => item.includes(key))) return;
    }
    seen.add(key);
    findings.push(cleaned);
  }

  for (const phrase of phrases) {
    let work = phrase
      .replace(/^(the\s+)?patient\s+/i, "")
      .replace(/^(is\s+)?(also\s+)?(having|has|reports?|presents with|came with)\s+/i, "")
      .trim();
    if (!work) continue;

    // "Fever and chest congestion having mild wheezing hand pain" style blobs
    const pieces = work
      .split(/\band\b|,/i)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const piece of pieces) {
      const normalized = piece
        .replace(/^(having|has|with)\s+/i, "")
        .trim();
      if (!normalized) continue;
      add(normalized);
    }
  }

  return findings;
}

function toClinicalFinding(finding: string) {
  const lower = finding.toLowerCase();
  if (lower === "fever") return "fever";
  if (lower.includes("wheez")) return finding.toLowerCase().includes("mild") ? "mild wheezing" : "wheezing";
  if (lower.includes("chest")) return lower.includes("congestion") ? "chest congestion" : finding.toLowerCase();
  if (lower.includes("hand pain")) return "hand pain";
  return finding.charAt(0).toLowerCase() + finding.slice(1);
}

function joinFindings(findings: string[]) {
  const items = findings.map(toClinicalFinding);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Rewrites rough / ASR-garbled dictation into a concise clinical HPI.
 * Corrects common medical mishearings; does not invent new diagnoses or exam findings.
 */
export function polishHpiLocally(input: string, complaint = "") {
  let text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  for (const pattern of FILLERS) text = text.replace(pattern, " ");
  text = applyAsrCorrections(text);
  text = normalizeContractions(text);
  text = text.replace(/\s+/g, " ").replace(/\s+([,;:.])/g, "$1").trim();

  const phrases = splitClinicalPhrases(text);
  let findings = extractFindings(phrases);

  if (complaint) {
    const complaintKey = complaint.toLowerCase().trim();
    if (complaintKey && !findings.some((item) => item.toLowerCase().includes(complaintKey) || complaintKey.includes(item.toLowerCase()))) {
      // Keep complaint as context only when dictation is empty of substance
      if (!findings.length) findings = [complaint];
    }
  }

  if (findings.length) {
    const body = joinFindings(findings);
    let narrative = `The patient presents with ${body}.`;
    narrative = narrative.replace(/\bpresents with fever, ([^,]+), and fever\b/i, "presents with fever, $1");
    narrative = narrative.replace(/\bpresents with fever and fever\b/i, "presents with fever");
    return narrative;
  }

  // Fallback: light sentence cleanup when we cannot chunk findings
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => {
      let next = sentence.replace(/^(asian|patient)\b/i, "The patient");
      if (!/^the patient\b/i.test(next) && /^(came|presents|reports|has|having)\b/i.test(next)) {
        next = `The patient ${next.charAt(0).toLowerCase()}${next.slice(1)}`;
      }
      return next.charAt(0).toUpperCase() + next.slice(1);
    });

  text = sentences.join(" ").trim();
  if (text && !/[.!?]$/.test(text)) text = `${text}.`;
  return text;
}

export function mergeHpiTranscript(current: string, transcript: string) {
  const next = String(transcript || "").trim();
  if (!next) return String(current || "");
  const base = String(current || "").trim();
  if (!base) return next;
  if (base.toLowerCase().includes(next.toLowerCase())) return base;
  return `${base}${/[.!?]$/.test(base) ? " " : ". "}${next}`;
}

export function buildHpiPolishPrompt(text: string, complaint = "") {
  return [
    "You are an experienced outpatient clinician rewriting speech-to-text HPI dictation.",
    "The mic often mishears medical words. Apply clinical common sense to recover the intended meaning.",
    "",
    "Typical ASR fixes (examples, not exhaustive):",
    "- Asian / a Asian → patient (when describing who presented)",
    "- Singh / weezing → wheezing",
    "- just condition → chest condition / chest congestion",
    "- breadth → breath",
    "- pane → pain",
    "",
    "Rules:",
    "- Produce one concise History of Present Illness paragraph in proper medical wording.",
    "- Prefer: \"The patient presents with …\"",
    "- Correct likely medical mishearings using context; do not invent symptoms that were not implied.",
    "- Deduplicate repeated items (e.g. fever mentioned twice).",
    "- Keep only patient-reported history; no exam, assessment, plan, or vitals.",
    "- If a chief complaint is provided, use it only to disambiguate wording, not to add new problems.",
    "- Return plain text only.",
    complaint ? `Chief complaint context: ${complaint}` : "",
    "",
    "Raw dictation / ASR text:",
    text,
  ].filter(Boolean).join("\n");
}
