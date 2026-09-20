export type CredentialField = {
  key: string;
  label: string;
  required: boolean;
  /** Secret values are encrypted at rest and never returned to the client. */
  secret: boolean;
  placeholder?: string;
};

/**
 * Credentials each adapter needs before it may run in live mode. Non-secret
 * entries (endpoints, client IDs, usernames) are stored in the clear so they
 * stay visible and editable; only `secret` entries are encrypted and masked.
 */
export const CREDENTIAL_FIELDS: Record<string, CredentialField[]> = {
  ehr_fhir: [
    { key: "baseUrl", label: "FHIR base URL", required: true, secret: false, placeholder: "https://fhir.vendor.com/r4" },
    { key: "tokenUrl", label: "OAuth token URL", required: true, secret: false, placeholder: "https://vendor.com/oauth2/token" },
    { key: "clientId", label: "Client ID", required: true, secret: false },
    { key: "clientSecret", label: "Client secret", required: true, secret: true },
    { key: "scope", label: "Scope", required: false, secret: false, placeholder: "system/Patient.read system/Appointment.read" },
  ],
  ehr_elation: [
    { key: "baseUrl", label: "API base URL", required: true, secret: false, placeholder: "https://app.elationemr.com/api/2.0" },
    { key: "clientId", label: "Client ID", required: true, secret: false },
    { key: "clientSecret", label: "Client secret", required: true, secret: true },
    { key: "username", label: "Service username", required: true, secret: false },
    { key: "password", label: "Service password", required: true, secret: true },
  ],
  stedi_edi: [
    { key: "apiKey", label: "Stedi API key", required: true, secret: true },
    { key: "partnershipId", label: "Partnership ID", required: false, secret: false },
  ],
  eligibility_270_271: [
    { key: "apiKey", label: "Clearinghouse API key", required: true, secret: true },
    { key: "submitterId", label: "Submitter ID", required: true, secret: false },
  ],
  era_835: [
    { key: "sftpHost", label: "SFTP host", required: true, secret: false },
    { key: "sftpUsername", label: "SFTP username", required: true, secret: false },
    { key: "sftpPassword", label: "SFTP password or key passphrase", required: true, secret: true },
  ],
  laboratory_results: [
    { key: "baseUrl", label: "Lab interface URL", required: true, secret: false },
    { key: "apiKey", label: "Lab API key", required: true, secret: true },
  ],
  imaging_results: [
    { key: "baseUrl", label: "Imaging interface URL", required: true, secret: false },
    { key: "apiKey", label: "Imaging API key", required: true, secret: true },
  ],
  e_prescribing: [
    { key: "baseUrl", label: "e-Prescribing URL", required: true, secret: false },
    { key: "accountId", label: "Account ID", required: true, secret: false },
    { key: "apiKey", label: "e-Prescribing API key", required: true, secret: true },
  ],
  usps_address: [
    { key: "userId", label: "USPS user ID", required: true, secret: true },
  ],
  secure_email: [
    { key: "smtpHost", label: "SMTP host", required: true, secret: false },
    { key: "smtpUsername", label: "SMTP username", required: true, secret: false },
    { key: "smtpPassword", label: "SMTP password", required: true, secret: true },
  ],
};

export function credentialFieldsFor(integrationType: string): CredentialField[] {
  return CREDENTIAL_FIELDS[integrationType] || [];
}
