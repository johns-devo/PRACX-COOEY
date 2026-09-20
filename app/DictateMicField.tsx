"use client";

import { useEffect, useRef, useState } from "react";
import { applyAsrCorrections, mergeHpiTranscript } from "../lib/hpi-assist";

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

export function DictateMicField({
  value,
  onChange,
  label,
  placeholder,
  rows = 3,
  required = false,
  polish,
  polishLabel = "Clean",
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  /** Optional local cleanup after dictation (e.g. objective polish). */
  polish?: (text: string) => string;
  polishLabel?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const valueRef = useRef(value);
  const autoPolishRef = useRef(false);

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

  function runPolish(afterDictation = false) {
    if (!polish) return;
    const current = valueRef.current.trim();
    if (!current) {
      if (!afterDictation) setStatus("Add or dictate text before cleaning.");
      return;
    }
    const next = polish(current);
    onChange(next);
    valueRef.current = next;
    setStatus(afterDictation ? "Dictation cleaned. Review before signing." : "Text cleaned. Review before signing.");
  }

  function stopListening() {
    autoPolishRef.current = Boolean(polish);
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
    autoPolishRef.current = false;
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
        const corrected = applyAsrCorrections(finalChunk.trim());
        const merged = mergeHpiTranscript(valueRef.current, corrected);
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
      autoPolishRef.current = false;
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      if (autoPolishRef.current) {
        autoPolishRef.current = false;
        runPolish(true);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setStatus("Listening… speak findings, then stop.");
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
    <div className={`dictate-mic-field ${className}`.trim()}>
      <div className="dictate-mic-toolbar">
        <span>{label}{required ? " *" : ""}</span>
        <div>
          {speechSupported && (
            <button
              aria-pressed={listening}
              className={`hpi-mic-button ${listening ? "listening" : ""}`}
              onClick={toggleMic}
              title={listening ? "Stop dictation" : `Dictate ${label}`}
              type="button"
            >
              <span aria-hidden="true">{listening ? "■" : "●"}</span>
              <em>{listening ? "Stop" : "Mic"}</em>
            </button>
          )}
          {polish && (
            <button
              className="hpi-polish-button"
              disabled={!value.trim()}
              onClick={() => runPolish(false)}
              title="Clean into short measurable sentences"
              type="button"
            >
              {polishLabel}
            </button>
          )}
        </div>
      </div>
      <textarea
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        value={value}
      />
      {interim && <p className="hpi-interim" aria-live="polite"><span>Hearing:</span> {interim}</p>}
      {(status || listening) && <small className={`hpi-narrative-status ${listening ? "live" : ""}`}>{status || "Listening…"}</small>}
    </div>
  );
}
