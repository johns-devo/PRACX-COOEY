export type InboundEventStatus =
  | "accepted"
  | "pending"
  | "rejected"
  | "unmatched"
  | "held"
  | "missing_integration";

export const INBOUND_STATUS_LABELS: Record<InboundEventStatus, string> = {
  accepted: "Accepted",
  pending: "Pending review",
  rejected: "Rejected",
  unmatched: "Name / identity mismatch",
  held: "Held in middle",
  missing_integration: "Missing integration",
};

export const SYNC_DIRECTIONS = [
  "elation_to_pracx",
  "pracx_to_stedi",
  "stedi_to_pracx",
  "pracx_to_elation",
] as const;

export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

export const SYNC_DIRECTION_LABELS: Record<SyncDirection, { title: string; subtitle: string }> = {
  elation_to_pracx: {
    title: "Elation → PRACX",
    subtitle: "Pull patients, encounters, insurance for claim create",
  },
  pracx_to_stedi: {
    title: "PRACX → Stedi",
    subtitle: "837 claim submit + batch / EDI references",
  },
  stedi_to_pracx: {
    title: "Stedi → PRACX",
    subtitle: "999 / 277CA acknowledgements and 835 ERA",
  },
  pracx_to_elation: {
    title: "PRACX → Elation",
    subtitle: "Claim created / submitted / acknowledged / paid / denied",
  },
};

export function summarizeInboundEvents(rows: Array<{
  status?: string | null;
  sourceSystem?: string | null;
  sourceLabel?: string | null;
  reasonCode?: string | null;
}>) {
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, { label: string; total: number; accepted: number; blocked: number }> = {};
  const reasonCounts: Record<string, number> = {};

  for (const row of rows) {
    const status = String(row.status || "pending");
    byStatus[status] = (byStatus[status] || 0) + 1;
    const source = String(row.sourceSystem || "unknown");
    if (!bySource[source]) {
      bySource[source] = {
        label: String(row.sourceLabel || source),
        total: 0,
        accepted: 0,
        blocked: 0,
      };
    }
    bySource[source].total += 1;
    if (status === "accepted") bySource[source].accepted += 1;
    else bySource[source].blocked += 1;
    if (status !== "accepted" && row.reasonCode) {
      const reason = String(row.reasonCode);
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  const accepted = byStatus.accepted || 0;
  const notAccepted = total - accepted;
  const pending = (byStatus.pending || 0) + (byStatus.held || 0);
  const unmatched = byStatus.unmatched || 0;
  const missingIntegration = byStatus.missing_integration || 0;
  const rejected = byStatus.rejected || 0;

  return {
    total,
    accepted,
    notAccepted,
    pending,
    unmatched,
    missingIntegration,
    rejected,
    acceptanceRate: total ? Math.round((accepted / total) * 1000) / 10 : 0,
    byStatus,
    bySource: Object.entries(bySource).map(([system, stats]) => ({ system, ...stats })),
    topReasons: Object.entries(reasonCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

export function summarizeSyncEvents(rows: Array<{
  direction?: string | null;
  status?: string | null;
}>) {
  const byDirection = SYNC_DIRECTIONS.map((direction) => {
    const items = rows.filter((row) => String(row.direction) === direction);
    const success = items.filter((row) => row.status === "success").length;
    const pending = items.filter((row) => row.status === "pending").length;
    const error = items.filter((row) => row.status === "error").length;
    return {
      direction,
      ...SYNC_DIRECTION_LABELS[direction],
      total: items.length,
      success,
      pending,
      error,
    };
  });

  const pendingOrError = rows.filter((row) => row.status === "pending" || row.status === "error").length;
  const success = rows.filter((row) => row.status === "success").length;

  return {
    total: rows.length,
    success,
    pendingOrError,
    byDirection,
  };
}
