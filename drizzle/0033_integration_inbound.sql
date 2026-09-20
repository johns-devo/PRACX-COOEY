-- Inbound EHR / integration queue for PRACX dashboard summaries
CREATE TABLE IF NOT EXISTS integration_inbound_events (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL,
  integration_id text,
  source_system text NOT NULL,
  source_label text NOT NULL,
  event_type text NOT NULL,
  external_id text,
  patient_name_external text,
  patient_dob_external text,
  matched_patient_id text,
  status text DEFAULT 'pending' NOT NULL,
  reason_code text,
  reason_detail text,
  payload_summary text,
  received_at text NOT NULL,
  resolved_at text,
  resolved_by_name text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (integration_id) REFERENCES integrations(id),
  FOREIGN KEY (matched_patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS inbound_events_org_status_idx
  ON integration_inbound_events (organization_id, status, received_at);

CREATE INDEX IF NOT EXISTS inbound_events_source_idx
  ON integration_inbound_events (organization_id, source_system);
