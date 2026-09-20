"use client";

import { useMemo, useState } from "react";
import {
  formatProviderHeadsUp,
  hasUrgentDocumentHeadsUp,
  isSameDayClinicalDocument,
  OBJECTIVE_DOCUMENT_CATEGORIES,
  OBJECTIVE_DOCUMENT_CATEGORY_LABELS,
} from "../lib/objective-documents";

type DocRow = Record<string, unknown>;

function value(row: DocRow, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "" : String(item);
}

function shortDate(input: unknown) {
  if (!input) return "—";
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function ObjectiveVisitDocuments({
  documents,
  patientId,
  dateOfService,
  onUseInterpretation,
  onRefresh,
}: {
  documents: DocRow[];
  patientId: string;
  dateOfService: string;
  onUseInterpretation: (text: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [category, setCategory] = useState("lab_result");
  const [selectedId, setSelectedId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "error" | "ok">("info");
  const [optimistic, setOptimistic] = useState<DocRow[]>([]);
  const [liveHeadsUp, setLiveHeadsUp] = useState<Record<string, string>>({});

  const sameDayDocs = useMemo(() => {
    const merged = new Map<string, DocRow>();
    for (const row of [...documents, ...optimistic]) {
      if (!patientId || value(row, "patientId") !== patientId) continue;
      if (!isSameDayClinicalDocument({
        category: value(row, "category"),
        serviceDate: value(row, "serviceDate"),
        createdAt: value(row, "createdAt"),
        status: value(row, "status") || "active",
      }, dateOfService)) continue;
      merged.set(value(row, "id"), row);
    }
    return [...merged.values()].sort((a, b) => value(b, "createdAt").localeCompare(value(a, "createdAt")));
  }, [documents, optimistic, patientId, dateOfService]);

  const selected = sameDayDocs.find((row) => value(row, "id") === selectedId) || sameDayDocs[0] || null;
  const selectedIdValue = value(selected || {}, "id");
  const selectedHeadsUp = liveHeadsUp[selectedIdValue]
    || formatProviderHeadsUp(value(selected || {}, "analysisJson"));
  const analysisReady = Boolean(selected && (value(selected, "analysisStatus") === "completed" || liveHeadsUp[selectedIdValue]) && selectedHeadsUp);
  const urgent = hasUrgentDocumentHeadsUp(value(selected || {}, "analysisJson")) || /^HEADS-UP:/m.test(selectedHeadsUp);

  function patchOptimistic(id: string, changes: DocRow) {
    setOptimistic((current) => {
      const exists = current.some((row) => value(row, "id") === id);
      if (!exists) return [{ id, patientId, ...changes }, ...current];
      return current.map((row) => (value(row, "id") === id ? { ...row, ...changes } : row));
    });
  }

  async function interpretDocument(documentId: string) {
    if (!documentId) return;
    setInterpreting(true);
    setStatusTone("info");
    setStatus("AI is reading the document for a provider heads-up…");
    try {
      const response = await fetch("/api/document-interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const payload = await response.json() as {
        analysis?: DocRow;
        headsUp?: string;
        urgent?: boolean;
        error?: string;
        code?: string;
      };
      if (!response.ok || !payload.analysis || !payload.headsUp) {
        throw new Error(payload.error || "Unable to interpret document.");
      }
      patchOptimistic(documentId, {
        analysisStatus: "completed",
        analysisJson: JSON.stringify(payload.analysis),
        analyzedAt: String(payload.analysis.analyzedAt || new Date().toISOString()),
      });
      setLiveHeadsUp((current) => ({ ...current, [documentId]: payload.headsUp || "" }));
      setSelectedId(documentId);
      setStatusTone("ok");
      setStatus(
        payload.urgent
          ? "AI heads-up ready — review urgent items before adding to the note."
          : "AI heads-up ready — verify against the original document.",
      );
      await onRefresh?.();
    } catch (reason) {
      patchOptimistic(documentId, { analysisStatus: "failed" });
      setStatusTone("error");
      setStatus(reason instanceof Error ? reason.message : "Unable to interpret document.");
    } finally {
      setInterpreting(false);
    }
  }

  async function uploadFile(file: File | undefined) {
    if (!file || !patientId) {
      setStatusTone("error");
      setStatus(patientId ? "Choose a file first." : "Select a patient before uploading.");
      return;
    }
    if (!dateOfService) {
      setStatusTone("error");
      setStatus("Set date of service before uploading same-day documents.");
      return;
    }
    setUploading(true);
    setStatusTone("info");
    setStatus("Uploading…");
    try {
      const body = new FormData();
      body.set("patientId", patientId);
      body.set("category", category);
      body.set("title", file.name);
      body.set("serviceDate", dateOfService);
      body.set("document", file);
      const response = await fetch("/api/patient-documents", { method: "POST", body });
      const payload = await response.json() as { ids?: string[]; error?: string };
      if (!response.ok || !payload.ids?.length) throw new Error(payload.error || "Unable to upload document.");
      const createdId = payload.ids[0];
      setOptimistic((current) => [
        {
          id: createdId,
          patientId,
          category,
          title: file.name,
          originalFileName: file.name,
          contentType: file.type,
          serviceDate: dateOfService,
          createdAt: new Date().toISOString(),
          status: "active",
          analysisStatus: "not_analyzed",
          analysisJson: "",
        },
        ...current,
      ]);
      setSelectedId(createdId);
      setStatus("Saved. Starting AI heads-up…");
      await onRefresh?.();
      await interpretDocument(createdId);
    } catch (reason) {
      setStatusTone("error");
      setStatus(reason instanceof Error ? reason.message : "Unable to upload document.");
    } finally {
      setUploading(false);
    }
  }

  const draftText = interpreting
    ? "Reading document with AI…"
    : analysisReady
      ? selectedHeadsUp
      : statusTone === "error" && status
        ? `AI heads-up failed:\n${status}\n\nYou can still View the document and type/dictate measurable values below, then tap Get AI heads-up again.`
        : "No AI heads-up yet. Upload a photo/PDF (AI starts automatically), or tap Get AI heads-up.";

  return (
    <div className="objective-visit-docs">
      <header>
        <strong>Same-day documents</strong>
        <small>Upload → AI heads-up for provider → verify → add to notes</small>
      </header>

      <div className="objective-visit-docs-upload">
        <select
          aria-label="Document type"
          disabled={uploading || interpreting}
          onChange={(event) => setCategory(event.target.value)}
          value={category}
        >
          {OBJECTIVE_DOCUMENT_CATEGORIES.map((key) => (
            <option key={key} value={key}>{OBJECTIVE_DOCUMENT_CATEGORY_LABELS[key]}</option>
          ))}
        </select>
        <label className={`objective-doc-capture ${uploading || interpreting || !patientId ? "disabled" : ""}`}>
          <span aria-hidden="true">📷</span>
          Photo
          <input
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={uploading || interpreting || !patientId}
            onChange={(event) => {
              const file = event.target.files?.[0];
              void uploadFile(file);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        <label className={`objective-doc-capture ${uploading || interpreting || !patientId ? "disabled" : ""}`}>
          <span aria-hidden="true">＋</span>
          Upload
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={uploading || interpreting || !patientId}
            onChange={(event) => {
              const file = event.target.files?.[0];
              void uploadFile(file);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
      </div>

      <div className="objective-visit-docs-list">
        {sameDayDocs.length ? sameDayDocs.map((row) => {
          const id = value(row, "id");
          const active = selectedIdValue === id;
          const ready = value(row, "analysisStatus") === "completed" || Boolean(liveHeadsUp[id]);
          return (
            <button
              className={active ? "active" : ""}
              key={id}
              onClick={() => setSelectedId(id)}
              type="button"
            >
              <strong>{value(row, "title") || value(row, "originalFileName") || "Document"}</strong>
              <small>
                {[
                  OBJECTIVE_DOCUMENT_CATEGORY_LABELS[value(row, "category")] || value(row, "category").replaceAll("_", " "),
                  shortDate(value(row, "serviceDate") || value(row, "createdAt")),
                  ready ? "AI heads-up ready" : value(row, "analysisStatus") === "failed" ? "AI failed — retry" : "Needs AI heads-up",
                ].filter(Boolean).join(" · ")}
              </small>
            </button>
          );
        }) : (
          <p className="objective-empty">
            No same-day labs/reports yet. Front desk upload, or doctor photo/upload here — AI will prepare a heads-up.
          </p>
        )}
      </div>

      {selected && (
        <aside className={`objective-visit-docs-review ${urgent && analysisReady ? "is-urgent" : ""}`} aria-label="Selected visit document">
          {urgent && analysisReady && (
            <div className="objective-ai-urgent" role="status">
              <strong>Provider heads-up</strong>
              <span>AI flagged items that may need prompt attention. Verify on the original document.</span>
            </div>
          )}
          <div className="objective-visit-docs-actions">
            <a
              href={`/api/patient-documents?id=${encodeURIComponent(selectedIdValue)}`}
              rel="noreferrer"
              target="_blank"
            >
              View document ↗
            </a>
            <button
              disabled={interpreting || uploading}
              onClick={() => void interpretDocument(selectedIdValue)}
              type="button"
            >
              {interpreting ? "Interpreting…" : analysisReady ? "Re-run AI heads-up" : "Get AI heads-up"}
            </button>
            <button
              onClick={() => onUseInterpretation(
                `Reviewed ${OBJECTIVE_DOCUMENT_CATEGORY_LABELS[value(selected, "category")] || "document"} (${value(selected, "title") || "untitled"}) on DOS ${dateOfService}.`,
              )}
              type="button"
            >
              Mark reviewed
            </button>
          </div>
          <label className="objective-ai-draft">
            <span>{analysisReady ? "AI heads-up for provider (draft — verify)" : "AI heads-up"}</span>
            <textarea readOnly rows={6} value={draftText} />
          </label>
          {analysisReady && (
            <button
              className="primary"
              onClick={() => onUseInterpretation(selectedHeadsUp)}
              type="button"
            >
              Add heads-up to diagnostic notes
            </button>
          )}
          <p className="objective-ai-hint">
            AI is a draft only. Confirm every value against the original before signing. If AI fails, View the report and type/dictate findings below.
          </p>
        </aside>
      )}

      {status && (
        <small className={`objective-visit-docs-status tone-${statusTone}`} role="status">
          {status}
        </small>
      )}
    </div>
  );
}
