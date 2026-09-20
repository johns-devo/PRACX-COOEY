/** Account-receivable lifecycle. Claim prep is only the generation worklist for Bill/Rebill statuses. */

export const CLAIM_PARTIES = ["pri", "sec", "ter", "patient"] as const;
export type ClaimParty = (typeof CLAIM_PARTIES)[number];

export const CLAIM_LIFECYCLE_STATUSES = [
  "new",
  "bill_to_pri",
  "sent_to_pri",
  "paid_pri",
  "denied_pri",
  "rebill_to_pri",
  "rebilled_pri",
  "bill_to_sec",
  "sent_to_sec",
  "paid_sec",
  "denied_sec",
  "rebill_to_sec",
  "rebilled_sec",
  "bill_to_ter",
  "sent_to_ter",
  "paid_ter",
  "denied_ter",
  "rebill_to_ter",
  "rebilled_ter",
  "bill_to_patient",
  "sent_to_patient",
  "paid_patient",
  "denied_patient",
  "closed",
  "voided",
] as const;

export type ClaimLifecycleStatus = (typeof CLAIM_LIFECYCLE_STATUSES)[number];

export const CLAIM_LIFECYCLE_LABELS: Record<ClaimLifecycleStatus, string> = {
  new: "New",
  bill_to_pri: "Bill to Pri",
  sent_to_pri: "Claim sent to Pri",
  paid_pri: "Paid (Pri)",
  denied_pri: "Denied (Pri)",
  rebill_to_pri: "Rebill to Pri",
  rebilled_pri: "Claim rebilled (Pri)",
  bill_to_sec: "Bill to Sec",
  sent_to_sec: "Claim sent to Sec",
  paid_sec: "Paid (Sec)",
  denied_sec: "Denied (Sec)",
  rebill_to_sec: "Rebill to Sec",
  rebilled_sec: "Claim rebilled (Sec)",
  bill_to_ter: "Bill to Ter",
  sent_to_ter: "Claim sent to Ter",
  paid_ter: "Paid (Ter)",
  denied_ter: "Denied (Ter)",
  rebill_to_ter: "Rebill to Ter",
  rebilled_ter: "Claim rebilled (Ter)",
  bill_to_patient: "Bill to Patient",
  sent_to_patient: "Claim sent to Patient",
  paid_patient: "Paid (Patient)",
  denied_patient: "Denied (Patient)",
  closed: "Claim closed",
  voided: "Voided",
};

const BILL_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "bill_to_pri",
  sec: "bill_to_sec",
  ter: "bill_to_ter",
  patient: "bill_to_patient",
};

const SENT_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "sent_to_pri",
  sec: "sent_to_sec",
  ter: "sent_to_ter",
  patient: "sent_to_patient",
};

const REBILL_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "rebill_to_pri",
  sec: "rebill_to_sec",
  ter: "rebill_to_ter",
  patient: "bill_to_patient",
};

const REBILLED_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "rebilled_pri",
  sec: "rebilled_sec",
  ter: "rebilled_ter",
  patient: "sent_to_patient",
};

const PAID_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "paid_pri",
  sec: "paid_sec",
  ter: "paid_ter",
  patient: "paid_patient",
};

const DENIED_STATUS: Record<ClaimParty, ClaimLifecycleStatus> = {
  pri: "denied_pri",
  sec: "denied_sec",
  ter: "denied_ter",
  patient: "denied_patient",
};

export function isClaimLifecycleStatus(value: string | null | undefined): value is ClaimLifecycleStatus {
  return (CLAIM_LIFECYCLE_STATUSES as readonly string[]).includes(String(value || ""));
}

export function partyFromLifecycle(status: string | null | undefined): ClaimParty | null {
  const value = String(status || "");
  if (value.includes("patient")) return "patient";
  if (value.includes("ter")) return "ter";
  if (value.includes("sec")) return "sec";
  if (value.includes("pri")) return "pri";
  return null;
}

/** Claim prep lists only statuses that need a file or statement generated this cycle. */
export function isLifecycleOnClaimPrep(status: string | null | undefined): boolean {
  const value = String(status || "");
  return value.startsWith("bill_to_") || value.startsWith("rebill_to_");
}

export function lifecycleAfterQueue(current?: string | null): ClaimLifecycleStatus {
  const party = partyFromLifecycle(current);
  if (current && current.startsWith("rebill_to_") && party) return current as ClaimLifecycleStatus;
  if (current && current.startsWith("bill_to_") && party) return current as ClaimLifecycleStatus;
  if (party === "sec") return "bill_to_sec";
  if (party === "ter") return "bill_to_ter";
  if (party === "patient") return "bill_to_patient";
  return "bill_to_pri";
}

export function lifecycleAfterSend(current?: string | null): ClaimLifecycleStatus {
  const party = partyFromLifecycle(current) || "pri";
  if (String(current || "").startsWith("rebill_to_") || String(current || "").startsWith("rebilled_")) {
    return REBILLED_STATUS[party];
  }
  return SENT_STATUS[party];
}

export function lifecycleAfterRebill(current?: string | null): ClaimLifecycleStatus | null {
  const party = partyFromLifecycle(current);
  if (!party || party === "patient") return party === "patient" ? "bill_to_patient" : null;
  if (!String(current || "").startsWith("denied_")) return null;
  return REBILL_STATUS[party];
}

/** Follow-up resubmit after the payer window: denied, sent, or already rebilled. */
export function lifecycleAfterFollowUpRebill(current?: string | null): ClaimLifecycleStatus | null {
  const party = partyFromLifecycle(current);
  if (!party || party === "patient") return party === "patient" ? "bill_to_patient" : null;
  const value = String(current || "");
  if (value.startsWith("denied_") || value.startsWith("sent_") || value.startsWith("rebilled_")) return REBILL_STATUS[party];
  return null;
}

export function nextPartyAfterPaid(input: {
  party: ClaimParty;
  hasSecondary: boolean;
  hasTertiary: boolean;
}): ClaimParty | "closed" {
  if (input.party === "pri" && input.hasSecondary) return "sec";
  if ((input.party === "pri" || input.party === "sec") && input.hasTertiary) return "ter";
  if (input.party !== "patient") return "patient";
  return "closed";
}

export function lifecycleAfterAdjudication(input: {
  current?: string | null;
  denied: boolean;
  remaining: number;
  hasSecondary: boolean;
  hasTertiary: boolean;
}): ClaimLifecycleStatus {
  const party = partyFromLifecycle(input.current) || "pri";
  if (input.denied) return DENIED_STATUS[party];
  if (input.remaining <= 0.009) return "closed";
  const next = nextPartyAfterPaid({
    party,
    hasSecondary: input.hasSecondary,
    hasTertiary: input.hasTertiary,
  });
  if (next === "closed") return "closed";
  return BILL_STATUS[next];
}

export function deriveClaimLifecycle(claim: {
  lifecycleStatus?: string | null;
  workflowStatus?: string | null;
  status?: string | null;
  remainingBalance?: string | number | null;
  firstBilledDate?: string | null;
  lastBilledDate?: string | null;
  batchId?: string | null;
}): ClaimLifecycleStatus {
  if (isClaimLifecycleStatus(claim.lifecycleStatus)) return claim.lifecycleStatus;
  const remaining = Number(claim.remainingBalance || 0);
  const financial = String(claim.status || "").toLowerCase();
  const workflow = String(claim.workflowStatus || "").toLowerCase();
  if (financial === "voided" || financial === "cancelled") return "voided";
  if (remaining <= 0.009 && (financial === "paid" || workflow === "submitted")) return "closed";
  if (financial === "denied") return "denied_pri";
  if (workflow === "submitted" || financial === "submitted" || financial === "accepted" || financial === "rejected") {
    return "sent_to_pri";
  }
  if (["needs_scrub", "scrubbing", "error", "ready_to_bill", "generating", "generated"].includes(workflow)) {
    return "bill_to_pri";
  }
  return claim.firstBilledDate || claim.lastBilledDate ? "sent_to_pri" : "new";
}

export function paidStatusForParty(party: ClaimParty): ClaimLifecycleStatus {
  return PAID_STATUS[party];
}

export function billStatusForParty(party: ClaimParty): ClaimLifecycleStatus {
  return BILL_STATUS[party];
}

const PARTY_ORDER: Record<ClaimParty, number> = { pri: 0, sec: 1, ter: 2, patient: 3 };

export const CLAIM_PARTY_LABELS: Record<ClaimParty, string> = {
  pri: "Primary",
  sec: "Secondary",
  ter: "Tertiary",
  patient: "Patient",
};

export type PartySlotStatus = "not_billed" | "billing" | "sent" | "paid" | "denied" | "closed" | "voided";

export const PARTY_SLOT_STATUS_LABELS: Record<PartySlotStatus, string> = {
  not_billed: "Not billed",
  billing: "Billing",
  sent: "Sent",
  paid: "Paid",
  denied: "Denied",
  closed: "Closed",
  voided: "Voided",
};

export type ClaimPartySlot = {
  party: ClaimParty;
  label: string;
  status: PartySlotStatus;
  statusLabel: string;
  present: boolean;
  current: boolean;
};

function phaseForLifecycle(status: ClaimLifecycleStatus): PartySlotStatus {
  if (status === "voided") return "voided";
  if (status === "closed") return "closed";
  if (status.startsWith("denied_")) return "denied";
  if (status.startsWith("paid_")) return "paid";
  if (status.startsWith("sent_") || status.startsWith("rebilled_")) return "sent";
  if (status.startsWith("bill_") || status.startsWith("rebill_")) return "billing";
  return "not_billed";
}

export function claimPartySlots(input: {
  lifecycle: ClaimLifecycleStatus | string;
  hasSecondary: boolean;
  hasTertiary: boolean;
}): ClaimPartySlot[] {
  const lifecycle = isClaimLifecycleStatus(input.lifecycle) ? input.lifecycle : "new";
  const currentParty = partyFromLifecycle(lifecycle);
  const currentOrder = lifecycle === "new" ? -1 : lifecycle === "closed" || lifecycle === "voided" ? 99 : PARTY_ORDER[currentParty || "pri"];
  const currentPhase = phaseForLifecycle(lifecycle);
  return CLAIM_PARTIES.map((party) => {
    const present = party === "pri" || party === "patient" || (party === "sec" && input.hasSecondary) || (party === "ter" && input.hasTertiary);
    const order = PARTY_ORDER[party];
    let status: PartySlotStatus = "not_billed";
    if (!present) status = "not_billed";
    else if (lifecycle === "voided") status = "voided";
    else if (lifecycle === "closed") status = "closed";
    else if (order < currentOrder) status = "closed";
    else if (order > currentOrder) status = "not_billed";
    else status = currentPhase;
    return {
      party,
      label: CLAIM_PARTY_LABELS[party],
      status,
      statusLabel: present ? PARTY_SLOT_STATUS_LABELS[status] : "—",
      present,
      current: present && order === currentOrder && currentOrder >= 0 && currentOrder < 99,
    };
  });
}

export type LifecycleActionId = "rebill" | "bill_sec" | "bill_ter" | "bill_patient" | "void" | "open_prep" | "in_process" | "mark_denied";

export type LifecycleAction = {
  id: LifecycleActionId;
  label: string;
};

export function lifecycleActions(input: {
  status?: string | null;
  remaining?: number;
  hasSecondary?: boolean;
  hasTertiary?: boolean;
}): LifecycleAction[] {
  const status = String(input.status || "");
  const remaining = Number(input.remaining || 0);
  const party = partyFromLifecycle(status);
  const actions: LifecycleAction[] = [];
  if (status.startsWith("denied_")) {
    actions.push({
      id: "rebill",
      label: `Rebill to ${party === "sec" ? "Sec" : party === "ter" ? "Ter" : "Pri"}`,
    });
  }
  if (remaining > 0.009 && input.hasSecondary && party === "pri" && !status.startsWith("bill_to_sec") && !status.startsWith("sent_to_sec")) {
    actions.push({ id: "bill_sec", label: "Bill to Sec" });
  }
  if (remaining > 0.009 && input.hasTertiary && (party === "pri" || party === "sec") && !status.includes("ter") && status !== "bill_to_patient") {
    actions.push({ id: "bill_ter", label: "Bill to Ter" });
  }
  if (remaining > 0.009 && party !== "patient" && !status.startsWith("bill_to_patient") && status !== "closed" && status !== "voided") {
    actions.push({ id: "bill_patient", label: "Bill to Patient" });
  }
  if (isLifecycleOnClaimPrep(status)) actions.push({ id: "open_prep", label: "Open in Claim prep" });
  if (status !== "closed" && status !== "voided") actions.push({ id: "void", label: "Void claim" });
  return actions;
}

export function arenaFollowUpActions(input: {
  status?: string | null;
  remaining?: number;
  hasSecondary?: boolean;
  hasTertiary?: boolean;
  followUpStatus?: string | null;
}): LifecycleAction[] {
  const status = String(input.status || "");
  const followUp = String(input.followUpStatus || "");
  const party = partyFromLifecycle(status);
  const actions: LifecycleAction[] = [];
  if (followUp !== "in_process") actions.push({ id: "in_process", label: "In process to pay" });
  if (!status.startsWith("denied_") && followUp !== "denied") actions.push({ id: "mark_denied", label: "Denied" });
  if (lifecycleAfterFollowUpRebill(status)) {
    actions.push({
      id: "rebill",
      label: `Rebill to ${party === "sec" ? "Sec" : party === "ter" ? "Ter" : "Pri"}`,
    });
  }
  return [
    ...actions,
    ...lifecycleActions(input).filter((item) => item.id === "bill_sec" || item.id === "bill_ter" || item.id === "bill_patient"),
  ];
}

export function claimActivityLabel(action: string, newStatus?: string | null): string {
  const key = String(action || "").toUpperCase();
  if (key === "NOTE") return "Note";
  if (key === "REBILL") return "Rebill queued";
  if (key === "FOLLOW_UP") return "Follow-up";
  if (key === "SUBMITTED") return "Claim sent";
  if (key === "DENIED") return "Denied";
  if (key === "CLOSED") return "Closed";
  if (key === "PAYMENT_POSTED") return "Payment posted";
  if (key === "VOID") return "Voided";
  if (key === "BILL_PARTY") return CLAIM_LIFECYCLE_LABELS[(newStatus || "") as ClaimLifecycleStatus] || "Next party billed";
  if (key === "CLAIM CREATED") return "Claim created";
  if (key === "SCRUB STARTED") return "Scrub started";
  if (key === "SCRUB COMPLETED") return "Scrub completed";
  if (key === "READY_TO_BILL") return "Ready to generate";
  if (key === "ERROR") return "Scrub error";
  return action.replaceAll("_", " ") || "Update";
}
