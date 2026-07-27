import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import { facilities, organizations, serviceLocations } from "../../../db/schema";

const DEFAULT_ORGANIZATION_ID = "org_pracx_health";

type FacilityPayload = {
  name?: string;
  code?: string;
  facilityType?: string;
  npi?: string;
  cliaNumber?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  status?: "active" | "inactive";
  locationName?: string;
  placeOfServiceCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function facilityError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("UNIQUE constraint failed")) {
    return { message: "A facility with this code already exists.", status: 409 };
  }
  if (message.includes("no such table")) {
    return {
      message: "Facility storage is not ready. Apply the latest database migration.",
      status: 503,
    };
  }
  return { message, status: 500 };
}

export async function GET(request: Request) {
  try {
    await ensureCoreSchema();
    const url = new URL(request.url);
    const search = clean(url.searchParams.get("search"));
    const status = clean(url.searchParams.get("status"));
    const filters = [eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID)];

    if (status === "active" || status === "inactive") {
      filters.push(eq(facilities.status, status));
    }
    if (search) {
      const pattern = `%${search}%`;
      const searchFilter = or(
        like(facilities.name, pattern),
        like(facilities.code, pattern),
        like(facilities.npi, pattern),
        like(serviceLocations.city, pattern),
      );
      if (searchFilter) filters.push(searchFilter);
    }

    const [organization] = await getDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, DEFAULT_ORGANIZATION_ID))
      .limit(1);

    const rows = await getDb()
      .select({
        id: facilities.id,
        name: facilities.name,
        code: facilities.code,
        facilityType: facilities.facilityType,
        npi: facilities.npi,
        phone: facilities.phone,
        timezone: facilities.timezone,
        status: facilities.status,
        createdAt: facilities.createdAt,
        locationName: serviceLocations.name,
        placeOfServiceCode: serviceLocations.placeOfServiceCode,
        addressLine1: serviceLocations.addressLine1,
        city: serviceLocations.city,
        state: serviceLocations.state,
        postalCode: serviceLocations.postalCode,
      })
      .from(facilities)
      .leftJoin(
        serviceLocations,
        and(
          eq(serviceLocations.facilityId, facilities.id),
          eq(serviceLocations.isPrimary, "yes"),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(facilities.name));

    const [summary] = await getDb()
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${facilities.status} = 'active' then 1 else 0 end)`,
      })
      .from(facilities)
      .where(eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID));

    return Response.json({
      organization,
      facilities: rows,
      summary: {
        total: Number(summary?.total ?? 0),
        active: Number(summary?.active ?? 0),
      },
    });
  } catch (error) {
    const detail = facilityError(error);
    return Response.json({ error: detail.message }, { status: detail.status });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    const payload = (await request.json()) as FacilityPayload;
    const required = {
      name: clean(payload.name),
      code: clean(payload.code).toUpperCase(),
      facilityType: clean(payload.facilityType),
      locationName: clean(payload.locationName),
      placeOfServiceCode: clean(payload.placeOfServiceCode),
      addressLine1: clean(payload.addressLine1),
      city: clean(payload.city),
      state: clean(payload.state).toUpperCase(),
      postalCode: clean(payload.postalCode),
    };

    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      return Response.json(
        { error: `Required fields are missing: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const npi = clean(payload.npi);
    if (npi && !/^\d{10}$/.test(npi)) {
      return Response.json(
        { error: "NPI must contain exactly 10 digits." },
        { status: 400 },
      );
    }

    if (!/^[A-Z]{2}$/.test(required.state)) {
      return Response.json(
        { error: "State must use a two-letter abbreviation." },
        { status: 400 },
      );
    }

    const facilityId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const db = getDb();

    await db.batch([
      db.insert(facilities).values({
        id: facilityId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        name: required.name,
        code: required.code,
        facilityType: required.facilityType,
        npi: npi || null,
        cliaNumber: clean(payload.cliaNumber) || null,
        phone: clean(payload.phone) || null,
        email: clean(payload.email) || null,
        timezone: clean(payload.timezone) || "America/New_York",
        status: payload.status === "inactive" ? "inactive" : "active",
      }),
      db.insert(serviceLocations).values({
        id: locationId,
        facilityId,
        name: required.locationName,
        placeOfServiceCode: required.placeOfServiceCode,
        addressLine1: required.addressLine1,
        addressLine2: clean(payload.addressLine2) || null,
        city: required.city,
        state: required.state,
        postalCode: required.postalCode,
        isPrimary: "yes",
        status: payload.status === "inactive" ? "inactive" : "active",
      }),
    ]);

    return Response.json({ id: facilityId }, { status: 201 });
  } catch (error) {
    const detail = facilityError(error);
    return Response.json({ error: detail.message }, { status: detail.status });
  }
}
