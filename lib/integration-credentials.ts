import { and, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { integrationCredentials } from "../db/schema";
import { credentialFieldsFor } from "./integration-credential-fields";

export { CREDENTIAL_FIELDS, credentialFieldsFor } from "./integration-credential-fields";
export type { CredentialField } from "./integration-credential-fields";

type Db = ReturnType<typeof getDb>;

/** Non-secret status shown in the UI. Secret values are never included. */
export type CredentialStatus = {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  isSet: boolean;
  /** Present only for secrets, so staff can confirm which key is stored. */
  lastFour: string;
  /** Plaintext value for non-secret fields so they remain editable. */
  value: string;
  updatedAt: string;
};

const KEY_ENV_NAME = "INTEGRATION_CREDENTIAL_KEY";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(rawKey: string) {
  const keyBytes = fromBase64(rawKey);
  if (keyBytes.length !== 32) {
    throw new Error(`${KEY_ENV_NAME} must be a base64-encoded 32-byte key.`);
  }
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function credentialKeyConfigured(rawKey: string | undefined) {
  return typeof rawKey === "string" && rawKey.trim().length > 0;
}

export async function encryptSecret(rawKey: string, plaintext: string) {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { cipherText: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

export async function decryptSecret(rawKey: string, cipherText: string, iv: string) {
  const key = await importKey(rawKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
    key,
    fromBase64(cipherText) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export async function loadCredentialStatus(db: Db, integrationId: string, integrationType: string): Promise<CredentialStatus[]> {
  const fields = credentialFieldsFor(integrationType);
  if (!fields.length) return [];
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(eq(integrationCredentials.integrationId, integrationId));
  const byKey = new Map(rows.map((row) => [row.fieldKey, row]));

  return fields.map((field) => {
    const row = byKey.get(field.key);
    return {
      key: field.key,
      label: field.label,
      required: field.required,
      secret: field.secret,
      placeholder: field.placeholder,
      isSet: Boolean(row),
      lastFour: field.secret ? row?.lastFour || "" : "",
      value: field.secret ? "" : row?.plainValue || "",
      updatedAt: row?.updatedAt || "",
    };
  });
}

/** Required credential labels that are still missing. Empty means live-ready. */
export async function missingRequiredCredentials(db: Db, integrationId: string, integrationType: string) {
  const status = await loadCredentialStatus(db, integrationId, integrationType);
  return status.filter((field) => field.required && !field.isSet).map((field) => field.label);
}

/**
 * Upserts submitted credential values. Blank submissions are ignored so an
 * unchanged secret field in the form does not erase a stored value.
 */
export async function saveCredentials(
  db: Db,
  integrationId: string,
  integrationType: string,
  submitted: Record<string, unknown>,
  rawKey: string | undefined,
) {
  const fields = credentialFieldsFor(integrationType);
  const now = new Date().toISOString();

  for (const field of fields) {
    const raw = submitted[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;

    if (field.secret && !credentialKeyConfigured(rawKey)) {
      throw new Error(
        `${KEY_ENV_NAME} is not configured, so secrets cannot be stored securely. Set it before saving credentials.`,
      );
    }

    const encrypted = field.secret && rawKey ? await encryptSecret(rawKey, value) : null;
    const [existing] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.integrationId, integrationId),
        eq(integrationCredentials.fieldKey, field.key),
      ))
      .limit(1);

    const row = {
      integrationId,
      fieldKey: field.key,
      isSecret: (field.secret ? "yes" : "no") as "yes" | "no",
      plainValue: field.secret ? null : value,
      cipherText: encrypted?.cipherText || null,
      iv: encrypted?.iv || null,
      lastFour: field.secret ? value.slice(-4) : null,
      updatedAt: now,
    };

    if (existing) {
      await db.update(integrationCredentials).set(row).where(eq(integrationCredentials.id, existing.id));
    } else {
      await db.insert(integrationCredentials).values({ id: crypto.randomUUID(), ...row });
    }
  }
}

export type ConnectionTestResult = {
  status: "passed" | "failed" | "unsupported";
  message: string;
};

/** Adapters that expose an OAuth2 client-credentials endpoint we can genuinely verify. */
const OAUTH_TESTABLE = new Set(["ehr_fhir", "ehr_elation"]);

/**
 * Performs a real OAuth2 client-credentials token request. Adapters without a
 * verifiable handshake report `unsupported` rather than a misleading pass.
 */
export async function testConnection(
  db: Db,
  integration: { id: string; integrationType: string },
  rawKey: string | undefined,
): Promise<ConnectionTestResult> {
  const { id, integrationType } = integration;

  const missing = await missingRequiredCredentials(db, id, integrationType);
  if (missing.length) {
    return { status: "failed", message: `Missing credentials: ${missing.join(", ")}.` };
  }

  if (!OAUTH_TESTABLE.has(integrationType)) {
    return {
      status: "unsupported",
      message: "Credentials are stored, but this adapter has no automated handshake to verify them.",
    };
  }

  const tokenUrl = await readCredential(db, id, "tokenUrl", rawKey);
  const clientId = await readCredential(db, id, "clientId", rawKey);
  const clientSecret = await readCredential(db, id, "clientSecret", rawKey);
  const scope = await readCredential(db, id, "scope", rawKey);

  if (!tokenUrl) {
    return { status: "failed", message: "No OAuth token URL is configured." };
  }
  if (!clientSecret) {
    return {
      status: "failed",
      message: "Stored client secret could not be decrypted. Re-enter it, or check INTEGRATION_CREDENTIAL_KEY.",
    };
  }
  if (!tokenUrl.startsWith("https://")) {
    return { status: "failed", message: "Token URL must use https." };
  }

  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  if (scope) body.set("scope", scope);

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();

    if (!response.ok) {
      return { status: "failed", message: `Token endpoint returned ${response.status}. ${text.slice(0, 200)}` };
    }

    let token = "";
    try {
      token = String((JSON.parse(text) as Record<string, unknown>).access_token || "");
    } catch {
      return { status: "failed", message: "Token endpoint did not return JSON." };
    }
    if (!token) {
      return { status: "failed", message: "Token endpoint responded without an access_token." };
    }
    return { status: "passed", message: "Received an access token from the vendor." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: `Could not reach the token endpoint: ${message}` };
  }
}

/** Reads a decrypted credential for outbound calls. Never expose the result to a client. */
export async function readCredential(db: Db, integrationId: string, fieldKey: string, rawKey: string | undefined) {
  const [row] = await db
    .select()
    .from(integrationCredentials)
    .where(and(
      eq(integrationCredentials.integrationId, integrationId),
      eq(integrationCredentials.fieldKey, fieldKey),
    ))
    .limit(1);
  if (!row) return "";
  if (row.isSecret !== "yes") return row.plainValue || "";
  if (!row.cipherText || !row.iv || !credentialKeyConfigured(rawKey)) return "";
  return decryptSecret(rawKey as string, row.cipherText, row.iv);
}
