import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { patientDocuments } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

type StoredObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

type DocumentBucket = {
  get: (key: string) => Promise<StoredObject | null>;
};

const DEFAULT_MODEL = "gpt-5.6-sol";
const ANALYZABLE_CATEGORIES = new Set(["lab_result", "medical_record", "pathology_report"]);

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function outputText(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") {
        return String((part as { text: string }).text);
      }
    }
  }
  return "";
}

const labAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reportType", "collectionDate", "summary", "results", "urgentFindings", "trends", "followUpQuestions", "limitations"],
  properties: {
    reportType: { type: "string" },
    collectionDate: { type: "string" },
    summary: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testName", "value", "numericValue", "unit", "referenceRange", "flag", "sourcePage", "confidence", "note"],
        properties: {
          testName: { type: "string" },
          value: { type: "string" },
          numericValue: { type: "string" },
          unit: { type: "string" },
          referenceRange: { type: "string" },
          flag: { type: "string", enum: ["normal", "high", "low", "critical_high", "critical_low", "unknown"] },
          sourcePage: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          note: { type: "string" },
        },
      },
    },
    urgentFindings: { type: "array", items: { type: "string" } },
    trends: { type: "array", items: { type: "string" } },
    followUpQuestions: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
};

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { documentId } = (await request.json()) as { documentId?: string };
    if (!documentId) return Response.json({ error: "Choose a laboratory report to analyze." }, { status: 400 });

    const runtime = env as unknown as { DOCUMENTS?: DocumentBucket; OPENAI_API_KEY?: string; OPENAI_LAB_MODEL?: string };
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "Lab analysis is installed but OPENAI_API_KEY is not configured for this environment." }, { status: 503 });
    }
    if (!runtime.DOCUMENTS) return Response.json({ error: "Secure document storage is unavailable." }, { status: 503 });

    const db = getDb();
    const [document] = await db.select().from(patientDocuments).where(and(
      eq(patientDocuments.id, documentId),
      eq(patientDocuments.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(patientDocuments.status, "active"),
    )).limit(1);
    if (!document || !ANALYZABLE_CATEGORIES.has(document.category)) {
      return Response.json({ error: "The selected file is not an analyzable laboratory or pathology report." }, { status: 404 });
    }

    const stored = await runtime.DOCUMENTS.get(document.objectKey);
    if (!stored) return Response.json({ error: "The report file is unavailable." }, { status: 404 });
    const contentType = stored.httpMetadata?.contentType || document.contentType;
    const fileData = encodeBase64(await new Response(stored.body).arrayBuffer());
    const fileInput = contentType === "application/pdf"
      ? { type: "input_file", filename: document.originalFileName, file_data: `data:application/pdf;base64,${fileData}` }
      : { type: "input_image", image_url: `data:${contentType};base64,${fileData}`, detail: "original" };
    const model = runtime.OPENAI_LAB_MODEL || DEFAULT_MODEL;

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtime.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 5000,
        instructions: "You extract laboratory report data for clinician review. Copy values, units, reference ranges, dates and source pages exactly. Never diagnose, prescribe, predict disease, invent missing values, or recommend billing. Use the report's printed flag and range; if unclear use unknown. Treat urgent findings as possible critical values requiring prompt clinician confirmation. State uncertainty and image-quality limitations.",
        input: [{ role: "user", content: [
          { type: "input_text", text: `Analyze the attached report titled ${JSON.stringify(document.title)}. Return every readable laboratory analyte. The application will attach the source document identity.` },
          fileInput,
        ] }],
        text: { format: { type: "json_schema", name: "pracx_lab_report_analysis", strict: true, schema: labAnalysisSchema } },
      }),
    });
    const responseBody = (await aiResponse.json()) as Record<string, unknown>;
    if (!aiResponse.ok) {
      const apiError = responseBody.error && typeof responseBody.error === "object" ? String((responseBody.error as { message?: unknown }).message || "") : "";
      throw new Error(apiError || "The medical document analysis service could not process this report.");
    }
    const serialized = outputText(responseBody);
    if (!serialized) throw new Error("The analysis completed without structured report data.");
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const results = Array.isArray(parsed.results) ? parsed.results.map((result) => ({
      ...(result as Record<string, unknown>),
      sourceDocumentId: document.id,
      sourceDocumentTitle: document.title,
    })) : [];
    const analysis = {
      ...parsed,
      results,
      sourceDocumentId: document.id,
      sourceDocumentTitle: document.title,
      sourceUrl: `/api/patient-documents?id=${encodeURIComponent(document.id)}`,
      model,
      analyzedAt: new Date().toISOString(),
      reviewed: false,
    };
    await db.update(patientDocuments).set({
      analysisStatus: "completed",
      analysisJson: JSON.stringify(analysis),
      analysisModel: model,
      analyzedAt: String(analysis.analyzedAt),
      analyzedBy: currentUser.fullName,
    }).where(eq(patientDocuments.id, document.id));
    return Response.json({ analysis });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to analyze the laboratory report." }, { status: 500 });
  }
}
