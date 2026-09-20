"use client";

import { useEffect, useRef, useState } from "react";
import { mergeHpiTranscript } from "../lib/hpi-assist";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const scope = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

export function HpiNarrativeField({
  value,
  complaint = "",
  onChange,
}: {
  value: string;
  complaint?: string;
  onChange: (next: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState("");
  const [isPolishing, setPolishing] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognition()));
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const autoPolishAfterStopRef = useRef(false);

  async function polishHpi(options?: { afterDictation?: boolean }) {
    const current = valueRef.current.trim();
    if (!current) {
      if (!options?.afterDictation) setStatus("Add or dictate HPI text before polishing.");
      return;
    }
    setPolishing(true);
    setStatus(options?.afterDictation ? "Cleaning up dictation into clinical HPI…" : "Polishing HPI…");
    try {
      const response = await fetch("/api/hpi-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "polish", text: current, complaint }),
      });
      const body = await response.json() as { text?: string; source?: string; error?: string };
      if (!response.ok || !body.text) throw new Error(body.error || "Unable to polish HPI.");
      onChange(body.text);
      valueRef.current = body.text;
      setStatus(
        options?.afterDictation
          ? "Dictation cleaned into clinical wording. Review before signing."
          : body.source === "ai"
            ? "HPI polished. Review before signing."
            : "HPI cleaned up locally. Review before signing.",
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to polish HPI.");
    } finally {
      setPolishing(false);
    }
  }

  function stopListening() {
    autoPolishAfterStopRef.current = true;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }

  function startListening() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setStatus("Voice dictation is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    setStatus("");
    autoPolishAfterStopRef.current = false;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalChunk = "";
      let nextInterim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result.isFinal) finalChunk += `${transcript} `;
        else nextInterim += transcript;
      }
      if (finalChunk.trim()) {
        const merged = mergeHpiTranscript(valueRef.current, finalChunk.trim());
        valueRef.current = merged;
        onChange(merged);
      }
      setInterim(nextInterim.trim());
    };
    recognition.onerror = (event) => {
      const code = event.error || "unknown";
      if (code === "not-allowed") setStatus("Microphone permission was blocked.");
      else if (code === "no-speech") setStatus("No speech detected. Try again.");
      else if (code !== "aborted") setStatus("Dictation interrupted. Tap the mic to resume.");
      setListening(false);
      setInterim("");
      autoPolishAfterStopRef.current = false;
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      if (autoPolishAfterStopRef.current) {
        autoPolishAfterStopRef.current = false;
        void polishHpi({ afterDictation: true });
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setStatus("Listening… speak the patient history, then stop — wording will be cleaned automatically.");
    } catch {
      setStatus("Unable to start the microphone.");
      setListening(false);
    }
  }

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  return (
    <div className="hpi-narrative-field">
      <div className="hpi-narrative-toolbar">
        <span>Free-text HPI</span>
        <div>
          {speechSupported && (
            <button
              aria-pressed={listening}
              className={`hpi-mic-button ${listening ? "listening" : ""}`}
              onClick={toggleMic}
              title={listening ? "Stop dictation" : "Dictate HPI"}
              type="button"
            >
              <span aria-hidden="true">{listening ? "■" : "●"}</span>
              <em>{listening ? "Stop" : "Mic"}</em>
            </button>
          )}
          <button
            className="hpi-polish-button"
            disabled={isPolishing || !value.trim()}
            onClick={() => void polishHpi()}
            title="Polish into concise clinical HPI"
            type="button"
          >
            {isPolishing ? "Polishing…" : "Polish"}
          </button>
        </div>
      </div>
      <textarea
        aria-label="Free-text HPI"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Concise patient-reported narrative — or use Mic to dictate"
        rows={3}
        value={value}
      />
      {interim && <p className="hpi-interim" aria-live="polite"><span>Hearing:</span> {interim}</p>}
      {(status || listening) && <small className={`hpi-narrative-status ${listening ? "live" : ""}`}>{status || "Listening…"}</small>}
    </div>
  );
}
