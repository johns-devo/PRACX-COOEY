import { eq, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../db";
import { facilities, organizations } from "../db/schema";

export const DEFAULT_ORGANIZATION_ID = "org_pracx_health";

export async function getOnboardingState() {
  await ensureCoreSchema();
  const [organization] = await getDb()
    .select({
      id: organizations.id,
      legalName: organizations.legalName,
      completedAt: organizations.onboardingCompletedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, DEFAULT_ORGANIZATION_ID))
    .limit(1);

  const [facilitySummary] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(facilities)
    .where(eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID));

  return {
    organization,
    completed: Boolean(organization?.completedAt),
    facilityCount: Number(facilitySummary?.count ?? 0),
  };
}

export async function completeOnboarding() {
  await ensureCoreSchema();
  const state = await getOnboardingState();
  if (state.facilityCount < 1) {
    return {
      ok: false as const,
      error: "Add at least one facility before completing initial setup.",
    };
  }

  const completedAt = new Date().toISOString();
  await getDb()
    .update(organizations)
    .set({ onboardingCompletedAt: completedAt, updatedAt: completedAt })
    .where(eq(organizations.id, DEFAULT_ORGANIZATION_ID));

  return { ok: true as const, completedAt };
}
