/** RPM starter master. Medicare amounts are national non-facility reference averages, not locality-specific guarantees. */
export const RPM_CODE_MASTER = [
  { code: "99453", description: "RPM device setup and patient education", component: "Setup", period: "One-time per episode", medicareReferenceFee: "21.71" },
  { code: "99445", description: "RPM device supply, 2–15 data days in 30 days", component: "Device supply", period: "30-day period", medicareReferenceFee: "52.11" },
  { code: "99454", description: "RPM device supply, 16+ data days in 30 days", component: "Device supply", period: "30-day period", medicareReferenceFee: "52.11" },
  { code: "99470", description: "RPM treatment management, first 10 minutes", component: "Treatment management", period: "Calendar month", medicareReferenceFee: "26.05" },
  { code: "99457", description: "RPM treatment management, first 20 minutes", component: "Treatment management", period: "Calendar month", medicareReferenceFee: "51.77" },
  { code: "99458", description: "RPM treatment management, each additional 20 minutes", component: "Add-on time", period: "Calendar month · add-on", medicareReferenceFee: "41.42" },
] as const;

export const RPM_MEDICARE_REFERENCE = {
  scheduleId: "fs_medicare_rpm_2026",
  name: "2026 Medicare RPM National Average Reference · Non-facility",
  payerId: "pay_medicare",
  effectiveDate: "2026-01-01",
  source: "https://www.thoroughcare.net/blog/remote-patient-monitoring-billing-rules",
  caveat: "Reference estimate only; actual MPFS amount varies by locality, setting, provider status and payer processing.",
};
