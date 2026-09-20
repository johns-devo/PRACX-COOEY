import { eq } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { practiceSettings } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

const ALLOWED_SLOT_MINUTES = new Set([10, 15, 20, 30, 60]);

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) return Response.json({ error: "Authentication required." }, { status: 401 });
    const [settings] = await getDb().select().from(practiceSettings).where(eq(practiceSettings.organizationId, DEFAULT_ORGANIZATION_ID)).limit(1);
    return Response.json({ schedulerSlotMinutes: settings?.schedulerSlotMinutes || "15" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load scheduler settings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const currentUser = await getLocalUserFromRequest(request);
    if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (currentUser.role.toLowerCase() !== "administrator") return Response.json({ error: "Administrator access is required." }, { status: 403 });
    const payload = (await request.json()) as { schedulerSlotMinutes?: string | number };
    const schedulerSlotMinutes = Number(payload.schedulerSlotMinutes);
    if (!ALLOWED_SLOT_MINUTES.has(schedulerSlotMinutes)) return Response.json({ error: "Choose a 10, 15, 20, 30 or 60 minute interval." }, { status: 400 });
    await getDb().insert(practiceSettings).values({
      organizationId: DEFAULT_ORGANIZATION_ID,
      schedulerSlotMinutes: String(schedulerSlotMinutes),
    }).onConflictDoUpdate({
      target: practiceSettings.organizationId,
      set: { schedulerSlotMinutes: String(schedulerSlotMinutes), updatedAt: new Date().toISOString() },
    });
    return Response.json({ schedulerSlotMinutes: String(schedulerSlotMinutes) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save scheduler settings." }, { status: 500 });
  }
}
