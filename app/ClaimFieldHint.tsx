import type { ClaimFieldHintData } from "../lib/cms1500";

export function ClaimFieldHint({ hint }: { hint?: ClaimFieldHintData }) {
  if (!hint) return null;
  const text = `${hint.title}. ${hint.detail}`;
  return (
    <span
      aria-label={`CMS-1500 ${hint.box}: ${text}`}
      className={`claim-field-hint ${hint.type || "paper"}`}
      data-tooltip={text}
      role="note"
      tabIndex={0}
      title={text}
    >
      {hint.box === "Internal" || hint.box === "Scrubber" || hint.box === "837P"
        ? hint.box
        : `CMS ${hint.box}`}
    </span>
  );
}
