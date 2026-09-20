import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { patientDocuments } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";
import {
  buildDocumentInterpretInstructions,
  DOCUMENT_INTERPRET_CATEGORIES,
  documentInterpretationSchema,
  formatProviderHeadsUp,
} from "../../../lib/objective-documents";

type StoredObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

type DocumentBucket = {
  get: (key: string) => Promise<StoredObject | null>;
};

const MAX_BYTES = 8 * 1024 * 1024;

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const row = part as { type?: string; text?: unknown };
      if ((row.type === "output_text" || row.type === "text") && typeof row.text === "string" && row.text.trim()) {
        return row.text.trim();
      }
    }
  }
  return "";
}

function openAiConfig() {
  const runtime = env as unknown as {
    OPENAI_API_KEY?: string;
    OPENAI_LAB_MODEL?: string;
    OPENAI_HPI_MODEL?: string;
    DOCUMENTS?: DocumentBucket;
  };
  const apiKey = String(runtime.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = String(
    runtime.OPENAI_LAB_MODEL
    || process.env.OPENAI_LAB_MODEL
    || runtime.OPENAI_HPI_MODEL
    || process.env.OPENAI_HPI_MODEL
    || "gpt-4.1-mini",
  ).trim();
  return { apiKey, model, documents: runtime.DOCUMENTS };
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });

    const payload = await request.json().catch(() => ({})) as { documentId?: unknown };
    const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
    if (!documentId) return Response.json({ error: "Choose a document to interpret." }, { status: 400 });

    const { apiKey, model, documents } = openAiConfig();
    if (!apiKey) {
      return Response.json({
        error: "AI is not configured. Add OPENAI_API_KEY to .dev.vars (local) or Worker secrets, restart the app, then tap Get AI heads-up.",
        code: "missing_openai_key",
      }, { status: 503 });
    }
    if (!documents) {
      return Response.json({
        error: "Secure document storage (DOCUMENTS) is unavailable, so AI cannot read the file.",
        code: "missing_documents_bucket",
      }, { status: 503 });
    }

    const db = getDb();
    const [document] = await db.select().from(patientDocuments).where(and(
      eq(patientDocuments.id, documentId),
      eq(patientDocuments.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(patientDocuments.status, "active"),
    )).limit(1);
    if (!document || !DOCUMENT_INTERPRET_CATEGORIES.has(document.category)) {
      return Response.json({ error: "That file is not an analyzable clinical document." }, { status: 404 });
    }

    const stored = await documents.get(document.objectKey);
    if (!stored) return Response.json({ error: "The document file is unavailable in storage." }, { status: 404 });

    const arrayBuffer = await new Response(stored.body).arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return Response.json({ error: "Document is too large for AI interpretation (max 8 MB)." }, { status: 400 });
    }

    const contentType = stored.httpMetadata?.contentType || document.contentType || "application/octet-stream";
    const fileData = encodeBase64(arrayBuffer);
    const isPdf = contentType === "application/pdf" || document.originalFileName.toLowerCase().endsWith(".pdf");
    const isImage = contentType.startsWith("image/");
    if (!isPdf && !isImage) {
      return Response.json({ error: "AI heads-up supports JPG, PNG, WebP, or PDF only." }, { status: 400 });
    }

    const fileInput = isPdf
      ? { type: "input_file", filename: document.originalFileName || "report.pdf", file_data: `data:application/pdf;base64,${fileData}` }
      : { type: "input_image", image_url: `data:${contentType};base64,${fileData}`, detail: "original" };

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 2500,
        instructions: buildDocumentInterpretInstructions(),
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Prepare a provider heads-up for the attached ${document.category.replaceAll("_", " ")} titled ${JSON.stringify(document.title)}. Return structured JSON only.`,
            },
            fileInput,
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "pracx_document_provider_headsup",
            strict: true,
            schema: documentInterpretationSchema,
          },
        },
      }),
    });

    const responseBody = await aiResponse.json() as Record<string, unknown>;
    if (!aiResponse.ok) {
      const apiError = responseBody.error && typeof responseBody.error === "object"
        ? String((responseBody.error as { message?: unknown }).message || "")
        : "";
      await db.update(patientDocuments).set({
        analysisStatus: "failed",
        analyzedAt: new Date().toISOString(),
        analyzedBy: currentUser.fullName,
      }).where(eq(patientDocuments.id, document.id));
      return Response.json({
        error: apiError || `AI could not interpret this document (model ${model}).`,
        code: "openai_error",
      }, { status: 502 });
    }

    const serialized = extractOutputText(responseBody);
    if (!serialized) {
      await db.update(patientDocuments).set({
        analysisStatus: "failed",
        analyzedAt: new Date().toISOString(),
        analyzedBy: currentUser.fullName,
      }).where(eq(patientDocuments.id, document.id));
      return Response.json({
        error: "AI returned an empty interpretation. Try Re-run AI heads-up, or a clearer photo/PDF.",
        code: "empty_ai_output",
      }, { status: 502 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      parsed = {
        reportType: document.category,
        documentDate: "",
        summary: serialized,
        headsUp: serialized.slice(0, 280),
        urgentFindings: [],
        notableValues: [],
        limitations: ["Model returned free text instead of structured JSON."],
      };
    }

    const analyzedAt = new Date().toISOString();
    const analysis = {
      reportType: String(parsed.reportType || document.category),
      documentDate: String(parsed.documentDate || ""),
      summary: String(parsed.summary || ""),
      headsUp: String(parsed.headsUp || ""),
      urgentFindings: Array.isArray(parsed.urgentFindings) ? parsed.urgentFindings : [],
      notableValues: Array.isArray(parsed.notableValues) ? parsed.notableValues : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      sourceDocumentId: document.id,
      sourceDocumentTitle: document.title,
      sourceUrl: `/api/patient-documents?id=${encodeURIComponent(document.id)}`,
      model,
      analyzedAt,
      reviewed: false,
    };

    await db.update(patientDocuments).set({
      analysisStatus: "completed",
      analysisJson: JSON.stringify(analysis),
      analysisModel: model,
      analyzedAt,
      analyzedBy: currentUser.fullName,
    }).where(eq(patientDocuments.id, document.id));

    const headsUp = formatProviderHeadsUp(JSON.stringify(analysis));
    if (!headsUp) {
      return Response.json({
        error: "AI ran but produced no usable heads-up text. Tap Re-run AI heads-up.",
        code: "empty_headsup",
        analysis,
      }, { status: 502 });
    }

    return Response.json({
      analysis,
      headsUp,
      urgent: analysis.urgentFindings.length > 0 || Boolean(analysis.headsUp.trim()),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to interpret the document.",
      code: "interpret_exception",
    }, { status: 500 });
  }
}
