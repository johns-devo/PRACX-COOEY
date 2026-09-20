import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPartySlots,
  deriveClaimLifecycle,
  isLifecycleOnClaimPrep,
  lifecycleActions,
  lifecycleAfterAdjudication,
  lifecycleAfterQueue,
  lifecycleAfterRebill,
  lifecycleAfterSend,
} from "../lib/claim-lifecycle.ts";

test("queues New claims into Bill to Pri", () => {
  assert.equal(lifecycleAfterQueue("new"), "bill_to_pri");
  assert.equal(lifecycleAfterQueue("rebill_to_sec"), "rebill_to_sec");
});

test("send and rebill follow the same party loop", () => {
  assert.equal(lifecycleAfterSend("bill_to_pri"), "sent_to_pri");
  assert.equal(lifecycleAfterSend("rebill_to_pri"), "rebilled_pri");
  assert.equal(lifecycleAfterSend("bill_to_sec"), "sent_to_sec");
  assert.equal(lifecycleAfterRebill("denied_pri"), "rebill_to_pri");
  assert.equal(lifecycleAfterRebill("denied_sec"), "rebill_to_sec");
  assert.equal(lifecycleAfterRebill("sent_to_pri"), null);
});

test("paid remainder moves Pri → Sec → Ter → Patient → Closed", () => {
  assert.equal(lifecycleAfterAdjudication({
    current: "sent_to_pri",
    denied: false,
    remaining: 80,
    hasSecondary: true,
    hasTertiary: false,
  }), "bill_to_sec");
  assert.equal(lifecycleAfterAdjudication({
    current: "rebilled_sec",
    denied: false,
    remaining: 40,
    hasSecondary: true,
    hasTertiary: true,
  }), "bill_to_ter");
  assert.equal(lifecycleAfterAdjudication({
    current: "sent_to_ter",
    denied: false,
    remaining: 20,
    hasSecondary: true,
    hasTertiary: true,
  }), "bill_to_patient");
  assert.equal(lifecycleAfterAdjudication({
    current: "sent_to_pri",
    denied: false,
    remaining: 0,
    hasSecondary: true,
    hasTertiary: false,
  }), "closed");
  assert.equal(lifecycleAfterAdjudication({
    current: "sent_to_pri",
    denied: true,
    remaining: 145,
    hasSecondary: true,
    hasTertiary: false,
  }), "denied_pri");
});

test("Claim prep only lists Bill/Rebill worklist statuses", () => {
  assert.equal(isLifecycleOnClaimPrep("bill_to_pri"), true);
  assert.equal(isLifecycleOnClaimPrep("rebill_to_sec"), true);
  assert.equal(isLifecycleOnClaimPrep("sent_to_pri"), false);
  assert.equal(isLifecycleOnClaimPrep("closed"), false);
});

test("derives a lifecycle for claims that predate the column", () => {
  assert.equal(deriveClaimLifecycle({ workflowStatus: "needs_scrub", status: "draft" }), "bill_to_pri");
  assert.equal(deriveClaimLifecycle({ workflowStatus: "submitted", status: "submitted", remainingBalance: "230" }), "sent_to_pri");
  assert.equal(deriveClaimLifecycle({ workflowStatus: "submitted", status: "paid", remainingBalance: "0" }), "closed");
});

test("payer slots follow Pri / Sec / Patient independently of next action", () => {
  const denied = claimPartySlots({ lifecycle: "denied_pri", hasSecondary: true, hasTertiary: false });
  assert.equal(denied.find((slot) => slot.party === "pri")?.status, "denied");
  assert.equal(denied.find((slot) => slot.party === "sec")?.status, "not_billed");
  assert.equal(denied.find((slot) => slot.party === "sec")?.present, true);
  assert.equal(denied.find((slot) => slot.party === "ter")?.present, false);
  const next = claimPartySlots({ lifecycle: "bill_to_sec", hasSecondary: true, hasTertiary: false });
  assert.equal(next.find((slot) => slot.party === "pri")?.status, "closed");
  assert.equal(next.find((slot) => slot.party === "sec")?.status, "billing");
  assert.equal(next.find((slot) => slot.party === "sec")?.current, true);
});

test("actions only offer legal next moves", () => {
  const denied = lifecycleActions({ status: "denied_pri", remaining: 145, hasSecondary: true, hasTertiary: false }).map((item) => item.id);
  assert.ok(denied.includes("rebill"));
  assert.ok(denied.includes("bill_sec"));
  assert.ok(denied.includes("void"));
  const billed = lifecycleActions({ status: "bill_to_pri", remaining: 145, hasSecondary: false }).map((item) => item.id);
  assert.ok(billed.includes("open_prep"));
  assert.ok(!billed.includes("rebill"));
});
