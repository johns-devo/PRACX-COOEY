import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { medicareFeeCodes, procedureCodes } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";
import { calculatePracticeCharge } from "../../../lib/fee-calculation";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validCode = (code: string) => /^[A-Z0-9]{4,5}$/.test(code);

async function authorize(request: Request) {
  const user = await getLocalUserFromRequest(request);
  if (!user) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (user.role.toLowerCase() !== "administrator") return { response: Response.json({ error: "Administrator access is required." }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const rows = await getDb().select().from(medicareFeeCodes)
      .where(eq(medicareFeeCodes.organizationId, DEFAULT_ORGANIZATION_ID))
      .orderBy(asc(medicareFeeCodes.codeSet), asc(medicareFeeCodes.code));
    return Response.json({ rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Medicare fees." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    const action = clean(body.action);
    const now = new Date().toISOString();

    if (action === "import") {
      const inputRows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
      if (!inputRows.length || inputRows.length > 5000) return Response.json({ error: "Upload a fee file with 1–5,000 CPT/HCPCS rows." }, { status: 400 });
      let imported = 0;
      const statements: D1PreparedStatement[] = [];
      for (const row of inputRows) {
        const codeSet = clean(row.codeSet).toUpperCase() || "CPT";
        const code = clean(row.code).toUpperCase();
        const description = clean(row.description);
        const medicareAllowed = Number(row.medicareAllowed);
        if (!["CPT", "HCPCS"].includes(codeSet) || !validCode(code) || !description || !Number.isFinite(medicareAllowed) || medicareAllowed < 0 || medicareAllowed > 100000) continue;
        const calculatedCharge = calculatePracticeCharge(medicareAllowed, 150, "ten");
        statements.push(env.DB.prepare(`INSERT INTO medicare_fee_codes
          (id, organization_id, code_set, code, description, medicare_allowed, default_charge, charge_override, source, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'no', 'Medicare fee upload', ?, ?)
          ON CONFLICT(organization_id, code_set, code) DO UPDATE SET
          description = excluded.description, medicare_allowed = excluded.medicare_allowed,
          default_charge = excluded.default_charge, charge_override = 'no', source = excluded.source,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, codeSet, code, description, medicareAllowed.toFixed(2), calculatedCharge, auth.user.id, now));
        statements.push(env.DB.prepare(`INSERT INTO procedure_codes
          (id, code, description, code_set, default_charge, default_place_of_service, requires_authorization, status)
          VALUES (?, ?, ?, ?, ?, '11', 'no', 'active')
          ON CONFLICT(code) DO UPDATE SET description = excluded.description, code_set = excluded.code_set,
          default_charge = excluded.default_charge, status = 'active'`)
          .bind(`proc_fee_${codeSet}_${code}`, code, description, codeSet, calculatedCharge));
        imported += 1;
      }
      for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
      return Response.json({ imported });
    }

    if (action === "update") {
      const id = clean(body.id);
      const field = clean(body.field);
      const value = Number(body.value);
      if (!id || clean(body.value) === "" || !Number.isFinite(value) || value < 0 || value > 100000 || !["medicareAllowed", "defaultCharge"].includes(field)) {
        return Response.json({ error: "Enter a valid non-negative fee amount." }, { status: 400 });
      }
      const [existing] = await db.select().from(medicareFeeCodes)
        .where(and(eq(medicareFeeCodes.id, id), eq(medicareFeeCodes.organizationId, DEFAULT_ORGANIZATION_ID))).limit(1);
      if (!existing) return Response.json({ error: "Fee code not found." }, { status: 404 });
      const updated = field === "medicareAllowed"
        ? { medicareAllowed: value.toFixed(2), defaultCharge: calculatePracticeCharge(value, 150, "ten"), chargeOverride: "no" as const }
        : { defaultCharge: value.toFixed(2), chargeOverride: "yes" as const };
      await db.update(medicareFeeCodes).set({ ...updated, source: "Manual edit", updatedBy: auth.user.id, updatedAt: now }).where(eq(medicareFeeCodes.id, id));
      await db.update(procedureCodes).set({ defaultCharge: updated.defaultCharge }).where(and(eq(procedureCodes.code, existing.code), eq(procedureCodes.codeSet, existing.codeSet)));
      return Response.json({ updatedAt: now, ...updated });
    }

    return Response.json({ error: "Unsupported fee setup action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save Medicare fees." }, { status: 500 });
  }
}
