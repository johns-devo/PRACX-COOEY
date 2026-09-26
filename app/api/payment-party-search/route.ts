import { and, eq, like, or, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { claims, patients, payers } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

export async function GET(request: Request) {
  if (!(await getLocalUserFromRequest(request))) return Response.json({ error: "Authentication required." }, { status: 401 });
  await ensureCoreSchema();
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() || "";
  if (query.length < 2) return Response.json({ results: [] });
  const pattern = `%${query.slice(0, 80)}%`;
  const db = getDb();
  if (params.get("type") === "patient") {
    const results = await db.selectDistinct({ id: patients.id, label: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}`, identifier: patients.accountNumber, dateOfBirth: patients.dateOfBirth })
      .from(patients).leftJoin(claims, and(eq(claims.patientId, patients.id), eq(claims.organizationId, DEFAULT_ORGANIZATION_ID)))
      .where(and(eq(patients.organizationId, DEFAULT_ORGANIZATION_ID), or(like(patients.id, pattern), like(patients.accountNumber, pattern), sql`${patients.firstName} || ' ' || ${patients.lastName} like ${pattern}`, like(claims.claimNumber, pattern), like(claims.id, pattern))))
      .limit(20);
    return Response.json({ results });
  }
  const results = await db.select({ id: payers.id, label: payers.name, identifier: payers.payerId }).from(payers)
    .where(and(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID), or(like(payers.name, pattern), like(payers.payerId, pattern), like(payers.id, pattern)))).limit(20);
  return Response.json({ results });
}
