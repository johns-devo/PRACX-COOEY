import { and, eq, gt } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../db";
import { authSessions, users } from "../db/schema";

export const SESSION_COOKIE = "pracx_session";
const SESSION_HOURS = 8;
const PBKDF2_ITERATIONS = 120_000;

export type LocalUser = {
  id: string;
  fullName: string;
  email: string;
  role: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function passwordHash(password: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}

function safeMatch(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function authenticateLocalUser(email: string, password: string) {
  await ensureCoreSchema();
  const normalizedEmail = email.trim().toLowerCase();
  const [record] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.email, normalizedEmail), eq(users.status, "active")))
    .limit(1);

  if (!record) return null;
  const candidate = await passwordHash(password, record.passwordSalt);
  if (!safeMatch(candidate, record.passwordHash)) return null;

  await getDb()
    .update(users)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(users.id, record.id));

  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    role: record.role,
  } satisfies LocalUser;
}

export async function createLocalSession(userId: string) {
  await ensureCoreSchema();
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const hashed = await tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  await getDb().insert(authSessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashed,
    expiresAt: expiresAt.toISOString(),
  });

  return { token, expiresAt };
}

export async function getLocalUserByToken(token: string | undefined | null) {
  if (!token) return null;
  await ensureCoreSchema();
  const hashed = await tokenHash(token);
  const [record] = await getDb()
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, hashed),
        gt(authSessions.expiresAt, new Date().toISOString()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  if (!record) return null;
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    role: record.role,
  } satisfies LocalUser;
}

export async function destroyLocalSession(token: string | undefined | null) {
  if (!token) return;
  await ensureCoreSchema();
  await getDb()
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, await tokenHash(token)));
}

export function readSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const item of cookieHeader.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function getLocalUserFromRequest(request: Request) {
  return getLocalUserByToken(readSessionToken(request));
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function expiredSessionCookie(secure: boolean) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
