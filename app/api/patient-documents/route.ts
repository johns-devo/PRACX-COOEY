import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { patientCoverages, patientDocuments, patients } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

type StoredObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

type DocumentBucket = {
  put: (
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) => Promise<unknown>;
  get: (key: string) => Promise<StoredObject | null>;
  delete: (key: string) => Promise<void>;
};

const DOCUMENT_CATEGORIES = new Set([
  "insurance_card",
  "hcfa_form",
  "medical_record",
  "accident_letter",
  "primary_eob",
  "secondary_eob",
  "referral",
  "authorization",
  "lab_result",
  "other",
]);
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_SIZE = 12 * 1024 * 1024;

function clean(value: FormDataEntryValue | string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function documentsBucket() {
  const bucket = (env as unknown as { DOCUMENTS?: DocumentBucket }).DOCUMENTS;
  if (!bucket) {
    throw new Error("Secure patient document storage is not available. Restart the local site or redeploy after enabling the DOCUMENTS storage binding.");
  }
  return bucket;
}

function safeExtension(file: File) {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return known[file.type] || "bin";
}

function validateFile(file: File) {
  if (!file.size) return "The selected file is empty.";
  if (file.size > MAX_FILE_SIZE) return "Each document must be 12 MB or smaller.";
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) return "Upload a JPG, PNG, WebP or PDF document.";
  return "";
}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });

    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "Document ID is required." }, { status: 400 });

    const [record] = await getDb()
      .select()
      .from(patientDocuments)
      .where(and(
        eq(patientDocuments.id, id),
        eq(patientDocuments.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(patientDocuments.status, "active"),
      ))
      .limit(1);
    if (!record) return Response.json({ error: "Document not found." }, { status: 404 });

    const object = await documentsBucket().get(record.objectKey);
    if (!object) return Response.json({ error: "The stored document file is unavailable." }, { status: 404 });

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || record.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.originalFileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to open document." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });

    const formData = await request.formData();
    const patientId = clean(formData.get("patientId"));
    const coverageId = clean(formData.get("coverageId"));
    const claimId = clean(formData.get("claimId"));
    const category = clean(formData.get("category"));
    const suppliedTitle = clean(formData.get("title"));
    const serviceDate = clean(formData.get("serviceDate"));
    if (!patientId || !DOCUMENT_CATEGORIES.has(category)) {
      return Response.json({ error: "Patient and document category are required." }, { status: 400 });
    }

    const db = getDb();
    const [patient] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.organizationId, DEFAULT_ORGANIZATION_ID)))
      .limit(1);
    if (!patient) return Response.json({ error: "Patient not found." }, { status: 404 });

    if (coverageId) {
      const [coverage] = await db
        .select({ id: patientCoverages.id })
        .from(patientCoverages)
        .where(and(eq(patientCoverages.id, coverageId), eq(patientCoverages.patientId, patientId)))
        .limit(1);
      if (!coverage) return Response.json({ error: "The selected insurance policy does not belong to this patient." }, { status: 400 });
    }

    const candidates: Array<{ file: File; side: "front" | "back" | "none" }> = [];
    if (category === "insurance_card") {
      const front = formData.get("front");
      const back = formData.get("back");
      if (front instanceof File && front.size) candidates.push({ file: front, side: "front" });
      if (back instanceof File && back.size) candidates.push({ file: back, side: "back" });
      if (!coverageId) return Response.json({ error: "Choose the insurance policy for this card." }, { status: 400 });
    } else {
      const document = formData.get("document");
      if (document instanceof File && document.size) candidates.push({ file: document, side: "none" });
    }
    if (!candidates.length) return Response.json({ error: "Choose at least one file to upload." }, { status: 400 });

    for (const candidate of candidates) {
      const validationError = validateFile(candidate.file);
      if (validationError) return Response.json({ error: validationError }, { status: 400 });
    }

    const bucket = documentsBucket();
    const created: string[] = [];
    for (const candidate of candidates) {
      const id = crypto.randomUUID();
      const objectKey = `${DEFAULT_ORGANIZATION_ID}/patients/${patientId}/${id}.${safeExtension(candidate.file)}`;
      await bucket.put(objectKey, candidate.file.stream(), {
        httpMetadata: { contentType: candidate.file.type },
        customMetadata: { patientId, category, documentSide: candidate.side },
      });
      try {
        await db.insert(patientDocuments).values({
          id,
          organizationId: DEFAULT_ORGANIZATION_ID,
          patientId,
          coverageId: coverageId || null,
          claimId: claimId || null,
          category,
          documentSide: candidate.side,
          title: suppliedTitle || (category === "insurance_card" ? `Insurance card — ${candidate.side}` : candidate.file.name),
          originalFileName: candidate.file.name,
          objectKey,
          contentType: candidate.file.type,
          fileSize: String(candidate.file.size),
          serviceDate: serviceDate || null,
          status: "active",
          uploadedBy: currentUser.fullName,
        });
        created.push(id);
      } catch (error) {
        await bucket.delete(objectKey);
        throw error;
      }
    }

    return Response.json({ ids: created, count: created.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save patient document." }, { status: 500 });
  }
}
