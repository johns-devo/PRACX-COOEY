"use client";

import { OperationsWorkspace, type OperationsModule } from "./OperationsWorkspace";
import type { LocalUser } from "../lib/auth";
import type { WorkspaceVariant } from "../lib/workspace-nav";

/** Billing-style workspace (patients, claims, payments, reports + configuration). */
export function BillingWorkspace({
  currentUser,
  module,
  variant = "billing",
}: {
  currentUser: LocalUser;
  module: OperationsModule;
  variant?: Extract<WorkspaceVariant, "billing" | "pracx">;
}) {
  return <OperationsWorkspace currentUser={currentUser} module={module} variant={variant} />;
}

export type { OperationsModule as BillingModule };
