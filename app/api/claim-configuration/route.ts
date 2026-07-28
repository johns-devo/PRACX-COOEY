import { and, asc, desc, eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import {
  claimConfigurationHistory,
  claimConfigurationValues,
  payers,
} from "../../../db/schema";
import {
  CLAIM_CONFIGURATION_CATEGORIES,
} from "../../../lib/claim-configuration";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requireAdministrator(request: Request) {
  const user = await getLocalUserFromRequest(request);
  if (!user) return { error: Response.json({ error: "Authentication required." }, { status: 401 }) };
  if (user.role.toLowerCase() !== "administrator") {
    return { error: Response.json({ error: "Administrator access is required." }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    const authorization = await requireAdministrator(request);
    if ("error" in authorization) return authorization.error;
    const db = getDb();
    const [values, history, payerRows] = await Promise.all([
      db.select().from(claimConfigurationValues).orderBy(asc(claimConfigurationValues.category), asc(claimConfigurationValues.code)),
      db.select().from(claimConfigurationHistory).orderBy(desc(claimConfigurationHistory.createdAt)).limit(100),
      db.select({ id: payers.id, name: payers.name }).from(payers).where(eq(payers.organizationId, DEFAULT_ORGANIZATION_ID)).orderBy(asc(payers.name)),
    ]);
    return Response.json({
      categories: CLAIM_CONFIGURATION_CATEGORIES,
      values,
      history,
      payers: payerRows,
      currentUser: authorization.user,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load claim configuration." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const authorization = await requireAdministrator(request);
    if ("error" in authorization) return authorization.error;
    const payload = await request.json() as Record<string, unknown>;
    const action = clean(payload.action);
    const db = getDb();

    if (action === "create") {
      const category = clean(payload.category);
      const code = clean(payload.code).toUpperCase();
      const displayName = clean(payload.displayName);
      if (!Object.hasOwn(CLAIM_CONFIGURATION_CATEGORIES, category) || !code || !displayName) {
        return Response.json({ error: "Category, code and display name are required." }, { status: 400 });
      }
      const payerId = clean(payload.payerId) || null;
      const sameCode = await db.select({ payerId: claimConfigurationValues.payerId })
        .from(claimConfigurationValues)
        .where(and(eq(claimConfigurationValues.category, category), eq(claimConfigurationValues.code, code)));
      if (sameCode.some((item) => item.payerId === payerId)) {
        return Response.json({ error: "This category, code and payer combination already exists." }, { status: 409 });
      }
      const id = crypto.randomUUID();
      const record = {
        id,
        category,
        code,
        displayName,
        internalGuidance: clean(payload.internalGuidance) || null,
        source: "Practice / payer configuration",
        isOfficial: "no" as const,
        payerId,
        effectiveDate: clean(payload.effectiveDate) || null,
        terminationDate: clean(payload.terminationDate) || null,
        status: clean(payload.status) === "inactive" ? "inactive" as const : "active" as const,
        createdBy: authorization.user.id,
        updatedBy: authorization.user.id,
      };
      await db.insert(claimConfigurationValues).values(record);
      await db.insert(claimConfigurationHistory).values({
        id: crypto.randomUUID(),
        configurationId: id,
        action: "created_custom_value",
        afterSnapshot: JSON.stringify(record),
        changedBy: authorization.user.id,
      });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "update") {
      const id = clean(payload.id);
      const [existing] = await db.select().from(claimConfigurationValues).where(eq(claimConfigurationValues.id, id)).limit(1);
      if (!existing) return Response.json({ error: "Configuration value not found." }, { status: 404 });
      const isOfficial = existing.isOfficial === "yes";
      const update = {
        category: isOfficial ? existing.category : clean(payload.category) || existing.category,
        code: isOfficial ? existing.code : clean(payload.code).toUpperCase() || existing.code,
        displayName: isOfficial ? existing.displayName : clean(payload.displayName) || existing.displayName,
        internalGuidance: clean(payload.internalGuidance) || null,
        payerId: isOfficial ? null : clean(payload.payerId) || null,
        effectiveDate: clean(payload.effectiveDate) || null,
        terminationDate: clean(payload.terminationDate) || null,
        status: clean(payload.status) === "inactive" ? "inactive" as const : "active" as const,
        updatedBy: authorization.user.id,
        updatedAt: new Date().toISOString(),
      };
      await db.update(claimConfigurationValues).set(update).where(eq(claimConfigurationValues.id, id));
      await db.insert(claimConfigurationHistory).values({
        id: crypto.randomUUID(),
        configurationId: id,
        action: isOfficial ? "updated_official_controls" : "updated_custom_value",
        beforeSnapshot: JSON.stringify(existing),
        afterSnapshot: JSON.stringify({ ...existing, ...update }),
        changedBy: authorization.user.id,
      });
      return Response.json({ id });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update claim configuration.";
    const status = message.toLowerCase().includes("unique") ? 409 : 500;
    return Response.json({ error: status === 409 ? "This category, code and payer combination already exists." : message }, { status });
  }
}
