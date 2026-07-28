import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { referringProviders } from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

type ReferringPayload = {
  firstName?: string;
  lastName?: string;
  credentials?: string;
  npi?: string;
  taxonomyCode?: string;
  specialty?: string;
  organizationName?: string;
  email?: string;
  phone?: string;
  fax?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  status?: "active" | "inactive";
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const url = new URL(request.url);
    const search = clean(url.searchParams.get("search"));
    const status = clean(url.searchParams.get("status"));
    const filters = [eq(referringProviders.organizationId, DEFAULT_ORGANIZATION_ID)];
    if (status === "active" || status === "inactive") {
      filters.push(eq(referringProviders.status, status));
    }
    if (search) {
      const pattern = `%${search}%`;
      const searchFilter = or(
        like(referringProviders.firstName, pattern),
        like(referringProviders.lastName, pattern),
        like(referringProviders.npi, pattern),
        like(referringProviders.specialty, pattern),
        like(referringProviders.organizationName, pattern),
      );
      if (searchFilter) filters.push(searchFilter);
    }

    const rows = await getDb()
      .select()
      .from(referringProviders)
      .where(and(...filters))
      .orderBy(asc(referringProviders.lastName), asc(referringProviders.firstName));

    const [summary] = await getDb()
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${referringProviders.status} = 'active' then 1 else 0 end)`,
      })
      .from(referringProviders)
      .where(eq(referringProviders.organizationId, DEFAULT_ORGANIZATION_ID));

    return Response.json({
      providers: rows,
      summary: {
        total: Number(summary?.total ?? 0),
        active: Number(summary?.active ?? 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load referring providers.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const payload = (await request.json()) as ReferringPayload;
    const firstName = clean(payload.firstName);
    const lastName = clean(payload.lastName);
    const specialty = clean(payload.specialty);
    const npi = clean(payload.npi);
    if (!firstName || !lastName || !specialty || !npi) {
      return Response.json(
        { error: "First name, last name, specialty and NPI are required." },
        { status: 400 },
      );
    }
    if (!/^\d{10}$/.test(npi)) {
      return Response.json({ error: "NPI must contain exactly 10 digits." }, { status: 400 });
    }
    const state = clean(payload.state).toUpperCase();
    if (state && !/^[A-Z]{2}$/.test(state)) {
      return Response.json({ error: "State must use a two-letter abbreviation." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await getDb().insert(referringProviders).values({
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      firstName,
      lastName,
      credentials: clean(payload.credentials) || null,
      npi,
      taxonomyCode: clean(payload.taxonomyCode) || null,
      specialty,
      organizationName: clean(payload.organizationName) || null,
      email: clean(payload.email) || null,
      phone: clean(payload.phone) || null,
      fax: clean(payload.fax) || null,
      addressLine1: clean(payload.addressLine1) || null,
      city: clean(payload.city) || null,
      state: state || null,
      postalCode: clean(payload.postalCode) || null,
      status: payload.status === "inactive" ? "inactive" : "active",
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save referring provider.";
    const duplicate = message.includes("referring_providers.npi");
    return Response.json(
      { error: duplicate ? "A referring provider with this NPI already exists." : message },
      { status: duplicate ? 409 : 500 },
    );
  }
}
