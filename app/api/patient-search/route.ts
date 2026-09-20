import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { patients } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (query.length < 3) return Response.json({ patients: [] });
    const pattern = `%${query.slice(0, 80)}%`;
    const match = or(
      like(patients.firstName, pattern),
      like(patients.middleName, pattern),
      like(patients.lastName, pattern),
      like(patients.accountNumber, pattern),
      like(patients.phone, pattern),
      like(patients.dateOfBirth, pattern),
      sql`${patients.firstName} || ' ' || ${patients.lastName} like ${pattern}`,
    );

    const rows = await getDb()
      .select({
        id: patients.id,
        accountNumber: patients.accountNumber,
        firstName: patients.firstName,
        middleName: patients.middleName,
        lastName: patients.lastName,
        dateOfBirth: patients.dateOfBirth,
        phone: patients.phone,
      })
      .from(patients)
      .where(and(
        eq(patients.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(patients.status, "active"),
        match,
      ))
      .orderBy(asc(patients.lastName), asc(patients.firstName))
      .limit(12);

    return Response.json({ patients: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to search patients." }, { status: 500 });
  }
}
