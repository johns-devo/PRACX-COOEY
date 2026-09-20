import { getLocalUserFromRequest } from "../../../lib/auth";
import { buildHpiPolishPrompt, polishHpiLocally } from "../../../lib/hpi-assist";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractOutputText(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") {
        return String((part as { text: string }).text).trim();
      }
    }
  }
  if (typeof response.output_text === "string") return response.output_text.trim();
  return "";
}

async function polishWithOpenAi(text: string, complaint: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_HPI_MODEL || process.env.OPENAI_LAB_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: buildHpiPolishPrompt(text, complaint),
    }),
  });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, unknown>;
  const polished = extractOutputText(body);
  return polished || null;
}

export async function POST(request: Request) {
  if (!(await getLocalUserFromRequest(request))) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { text?: unknown; complaint?: unknown; action?: unknown };
  const action = clean(payload.action) || "polish";
  const text = clean(payload.text);
  const complaint = clean(payload.complaint);
  if (action !== "polish") return Response.json({ error: "Unsupported action." }, { status: 400 });
  if (!text) return Response.json({ error: "HPI text is required." }, { status: 400 });
  if (text.length > 8000) return Response.json({ error: "HPI text is too long to polish." }, { status: 400 });

  try {
    const aiText = await polishWithOpenAi(text, complaint);
    if (aiText) return Response.json({ text: aiText, source: "ai" });
  } catch {
    /* Fall back to local polish when the model is unavailable. */
  }

  return Response.json({ text: polishHpiLocally(text, complaint), source: "local" });
}
