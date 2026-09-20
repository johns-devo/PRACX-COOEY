import type { ClaimFieldHintData } from "../lib/cms1500";

export function ClaimFieldHint({ hint }: { hint?: ClaimFieldHintData }) {
  if (!hint) return null;
  const source = hint.box === "Internal" || hint.box === "Scrubber" || hint.box === "837P"
    ? hint.box
    : `CMS-1500 Box ${hint.box}`;
  const text = `${source} — ${hint.title}. ${hint.detail}`;
  return (
    <span
      aria-label={`Help: ${text}`}
      className={`claim-field-hint ${hint.type || "paper"}`}
      data-tooltip={text}
      role="note"
      tabIndex={0}
    >
      ?
    </span>
  );
}
