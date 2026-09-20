-- Two-way Elation ↔ PRACX ↔ Stedi claim lifecycle sync log
CREATE TABLE IF NOT EXISTS integration_sync_events (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL,
  direction text NOT NULL,
  event_type text NOT NULL,
  claim_id text,
  claim_number text,
  external_ref text,
  status text DEFAULT 'pending' NOT NULL,
  summary text NOT NULL,
  occurred_at text NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (claim_id) REFERENCES claims(id)
);

CREATE INDEX IF NOT EXISTS sync_events_org_direction_idx
  ON integration_sync_events (organization_id, direction, occurred_at);

CREATE INDEX IF NOT EXISTS sync_events_claim_idx
  ON integration_sync_events (claim_id);
