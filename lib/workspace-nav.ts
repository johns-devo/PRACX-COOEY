/** Shared sidebar navigation for operations, billing, and client PRACX workspaces. */

import { isPracxStandalone } from "./app-surface";

export type WorkspaceVariant = "operations" | "billing" | "pracx";

export type WorkspaceNavItem = {
  label: string;
  href: string;
  key: string;
  section?: string;
};

export function workspaceBasePath(variant: WorkspaceVariant) {
  if (variant === "pracx") return isPracxStandalone() ? "" : "/pracx";
  if (variant === "billing") return "/billing";
  return "";
}

export function isBillingStyleWorkspace(variant: WorkspaceVariant) {
  return variant === "billing" || variant === "pracx";
}

export function workspaceNavItems(variant: WorkspaceVariant): WorkspaceNavItem[] {
  const base = workspaceBasePath(variant);
  if (isBillingStyleWorkspace(variant)) {
    if (variant === "pracx") {
      return [
        { label: "Dashboard", href: `${base}/dashboard` || "/dashboard", key: "dashboard", section: "Workspace" },
        { label: "Patients", href: `${base}/patients` || "/patients", key: "patients", section: "Workspace" },
        { label: "Claims", href: `${base}/claim-inquiry` || "/claim-inquiry", key: "claim_inquiry", section: "Revenue cycle" },
        { label: "Payments", href: `${base}/payments` || "/payments", key: "payments", section: "Revenue cycle" },
        { label: "Collection Arena", href: `${base}/collections` || "/collections", key: "collections", section: "Revenue cycle" },
        { label: "Reports & analytics", href: `${base}/reports` || "/reports", key: "reports", section: "Revenue cycle" },
      ];
    }
    return [
      { label: "Patients", href: `${base}/patients`, key: "patients", section: "Workspace" },
      { label: "Claims", href: `${base}/claim-inquiry`, key: "claim_inquiry", section: "Revenue cycle" },
      { label: "Payments", href: `${base}/payments`, key: "payments", section: "Revenue cycle" },
      { label: "Collection Arena", href: `${base}/collections`, key: "collections", section: "Revenue cycle" },
      { label: "Reports & analytics", href: `${base}/reports`, key: "reports", section: "Revenue cycle" },
    ];
  }
  return [
    { label: "Dashboard", href: "/dashboard", key: "dashboard" },
    { label: "Patients", href: "/patients", key: "patients" },
    { label: "Scheduler", href: "/scheduler", key: "scheduler" },
    { label: "Eligibility", href: "/eligibility", key: "eligibility" },
    { label: "Clinical", href: "/clinical", key: "clinical" },
    { label: "Chart", href: "/chart", key: "chart" },
    { label: "Claims", href: "/claim-inquiry", key: "claim_inquiry" },
    { label: "Collection Arena", href: "/collections", key: "collections" },
    { label: "Payments", href: "/payments", key: "payments" },
    { label: "Reports", href: "/reports", key: "reports" },
  ];
}

export function workspaceConfigLinks(variant: WorkspaceVariant, isAdmin: boolean) {
  const base = workspaceBasePath(variant);
  const setupHref = base ? `${base}/setup` : "/setup";
  const claimConfigHref = base ? `${base}/setup/claim-configuration` : "/setup/claim-configuration";
  const links = [
    { label: "Practice setup", href: setupHref, key: "setup" },
    ...(isAdmin
      ? [{ label: "Fee setup", href: base ? `${base}/setup/fee-setup` : "/setup/fee-setup", key: "fee_setup" }]
      : []),
    ...(isAdmin
      ? [{ label: "Claim configuration", href: claimConfigHref, key: "claim_configuration" }]
      : []),
  ];
  links.push({
    label: "Integrations",
    href: base ? `${base}/integrations` : "/integrations",
    key: "integrations",
  });
  return links;
}

export function workspaceBrand(variant: WorkspaceVariant) {
  if (variant === "pracx") {
    return isPracxStandalone()
      ? { title: "PRACX", subtitle: "Billing & integrations" }
      : { title: "PRACX", subtitle: "Client billing · Integrations first" };
  }
  if (variant === "billing") return { title: "PRACX", subtitle: "Billing workspace" };
  return { title: "PRACX", subtitle: "Care operations" };
}

export function workspaceHomePath(variant: WorkspaceVariant) {
  if (variant === "pracx") return `${workspaceBasePath("pracx")}/dashboard` || "/dashboard";
  if (variant === "billing") return "/billing/patients";
  return "/dashboard";
}

export function setupTabHref(variant: WorkspaceVariant, path: string) {
  const base = workspaceBasePath(variant);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalized;
  if (normalized === "/setup") return `${base}/setup`;
  if (normalized.startsWith("/setup/")) return `${base}${normalized}`;
  return `${base}${normalized}`;
}
