import { claimFormatForChannel, deliveryChannelFromPayer, type ClaimDeliveryChannel } from "./claim-workflow";

export type BatchType = "edi" | "paper";

export function batchTypeFromChannel(channel: ClaimDeliveryChannel): BatchType {
  return channel === "electronic" ? "edi" : "paper";
}

export function batchTypeFromPayer(payer?: { clearinghouseRoute?: string | null } | null): BatchType {
  return batchTypeFromChannel(deliveryChannelFromPayer(payer));
}

export function sanitizePayerFileToken(name: string) {
  return (name || "PAYER")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "PAYER";
}

export function buildBatchFileNames(input: {
  payerName: string;
  batchNumber: string;
  batchType: BatchType;
  createdAt?: Date;
}) {
  const date = input.createdAt || new Date();
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  const token = sanitizePayerFileToken(input.payerName);
  const base = `${token}_${ymd}_${input.batchNumber}`;
  if (input.batchType === "edi") {
    return {
      ediFileName: `${base}.edi`,
      ediFilePath: `batches/${input.batchNumber}/${base}.edi`,
      proofFileName: `${base}_PROOF.txt`,
      proofFilePath: `batches/${input.batchNumber}/${base}_PROOF.txt`,
    };
  }
  return {
    ediFileName: null as string | null,
    ediFilePath: null as string | null,
    proofFileName: `${base}_PROOF.txt`,
    proofFilePath: `batches/${input.batchNumber}/${base}_PROOF.txt`,
  };
}

export function buildBatchProofText(input: {
  batchNumber: string;
  payerName: string;
  batchType: BatchType;
  claimCount: number;
  createdBy: string;
  createdAt: string;
  ediFileName?: string | null;
  transmissionStatus: string;
  transmittedAt?: string | null;
  clearinghouseResponse?: string | null;
}) {
  const created = new Date(input.createdAt);
  const dateCreated = Number.isNaN(created.getTime()) ? input.createdAt.slice(0, 10) : created.toISOString().slice(0, 10);
  const timeCreated = Number.isNaN(created.getTime()) ? input.createdAt.slice(11, 19) : created.toISOString().slice(11, 19);
  return [
    "PRACX CLAIM BATCH PROOF FILE",
    "============================",
    `Batch ID: ${input.batchNumber}`,
    `Payer Name: ${input.payerName}`,
    `Batch Type: ${input.batchType.toUpperCase()}`,
    `Date Created: ${dateCreated}`,
    `Time Created: ${timeCreated}`,
    `Number of Claims: ${input.claimCount}`,
    `Created By: ${input.createdBy}`,
    `EDI File Name: ${input.ediFileName || "N/A (paper batch)"}`,
    `Transmission Status: ${input.transmissionStatus}`,
    `Transmission Timestamp: ${input.transmittedAt || "Not transmitted"}`,
    `Clearinghouse Response: ${input.clearinghouseResponse || "None"}`,
    "",
    `Generated format hint: ${claimFormatForChannel(input.batchType === "edi" ? "electronic" : "paper")}`,
  ].join("\n");
}
