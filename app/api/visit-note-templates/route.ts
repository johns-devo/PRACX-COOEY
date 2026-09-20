import { and, asc, eq, like, or } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { visitNoteTemplates } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (query.length < 3) return Response.json({ templates: [] });
    const pattern = `%${query.slice(0, 80)}%`;
    const rows = await getDb()
      .select({
        id: visitNoteTemplates.id,
        name: visitNoteTemplates.name,
        category: visitNoteTemplates.category,
        specialty: visitNoteTemplates.specialty,
        templateJson: visitNoteTemplates.templateJson,
        suggestedDiagnosisCodes: visitNoteTemplates.suggestedDiagnosisCodes,
        suggestedProcedureCodes: visitNoteTemplates.suggestedProcedureCodes,
      })
      .from(visitNoteTemplates)
      .where(and(
        eq(visitNoteTemplates.organizationId, DEFAULT_ORGANIZATION_ID),
        eq(visitNoteTemplates.status, "active"),
        or(
          like(visitNoteTemplates.name, pattern),
          like(visitNoteTemplates.category, pattern),
          like(visitNoteTemplates.specialty, pattern),
          like(visitNoteTemplates.keywords, pattern),
        ),
      ))
      .orderBy(asc(visitNoteTemplates.name))
      .limit(50);

    return Response.json({ templates: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to search visit-note templates." }, { status: 500 });
  }
}
