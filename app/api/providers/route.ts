import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { ensureCoreSchema, getDb } from "../../../db";
import {
  facilities,
  providerFacilityAssignments,
  providerLicenses,
  providers,
} from "../../../db/schema";
import { getLocalUserFromRequest } from "../../../lib/auth";
import { DEFAULT_ORGANIZATION_ID } from "../../../lib/onboarding";

type ProviderPayload = {
  providerCode?: string;
  firstName?: string;
  lastName?: string;
  credentials?: string;
  npi?: string;
  taxonomyCode?: string;
  specialty?: string;
  email?: string;
  phone?: string;
  facilityId?: string;
  licenseState?: string;
  licenseNumber?: string;
  licenseExpiration?: string;
  isBilling?: boolean;
  isRendering?: boolean;
  isSupervising?: boolean;
  status?: "active" | "inactive";
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("providers.npi")) return "A provider with this NPI already exists.";
  if (message.includes("providers.organization_id") || message.includes("providers.provider_code")) {
    return "A provider with this code already exists.";
  }
  return message;
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
    const filters = [eq(providers.organizationId, DEFAULT_ORGANIZATION_ID)];
    if (status === "active" || status === "inactive") filters.push(eq(providers.status, status));
    if (search) {
      const pattern = `%${search}%`;
      const searchFilter = or(
        like(providers.firstName, pattern),
        like(providers.lastName, pattern),
        like(providers.providerCode, pattern),
        like(providers.npi, pattern),
        like(providers.specialty, pattern),
      );
      if (searchFilter) filters.push(searchFilter);
    }

    const rows = await getDb()
      .select({
        id: providers.id,
        providerCode: providers.providerCode,
        firstName: providers.firstName,
        lastName: providers.lastName,
        credentials: providers.credentials,
        npi: providers.npi,
        taxonomyCode: providers.taxonomyCode,
        specialty: providers.specialty,
        email: providers.email,
        phone: providers.phone,
        isBilling: providers.isBilling,
        isRendering: providers.isRendering,
        isSupervising: providers.isSupervising,
        status: providers.status,
        facilityName: facilities.name,
        facilityId: facilities.id,
        licenseState: providerLicenses.state,
        licenseNumber: providerLicenses.licenseNumber,
        licenseExpiration: providerLicenses.expirationDate,
      })
      .from(providers)
      .leftJoin(
        providerFacilityAssignments,
        and(
          eq(providerFacilityAssignments.providerId, providers.id),
          eq(providerFacilityAssignments.isPrimary, "yes"),
        ),
      )
      .leftJoin(facilities, eq(facilities.id, providerFacilityAssignments.facilityId))
      .leftJoin(providerLicenses, eq(providerLicenses.providerId, providers.id))
      .where(and(...filters))
      .orderBy(asc(providers.lastName), asc(providers.firstName));

    const facilityOptions = await getDb()
      .select({ id: facilities.id, name: facilities.name, code: facilities.code })
      .from(facilities)
      .where(
        and(
          eq(facilities.organizationId, DEFAULT_ORGANIZATION_ID),
          eq(facilities.status, "active"),
        ),
      )
      .orderBy(asc(facilities.name));

    const [summary] = await getDb()
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${providers.status} = 'active' then 1 else 0 end)`,
        rendering: sql<number>`sum(case when ${providers.isRendering} = 'yes' then 1 else 0 end)`,
      })
      .from(providers)
      .where(eq(providers.organizationId, DEFAULT_ORGANIZATION_ID));

    return Response.json({
      providers: rows,
      facilities: facilityOptions,
      summary: {
        total: Number(summary?.total ?? 0),
        active: Number(summary?.active ?? 0),
        rendering: Number(summary?.rendering ?? 0),
      },
    });
  } catch (error) {
    return Response.json({ error: providerError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoreSchema();
    if (!(await getLocalUserFromRequest(request))) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const payload = (await request.json()) as ProviderPayload;
    const required = {
      providerCode: clean(payload.providerCode).toUpperCase(),
      firstName: clean(payload.firstName),
      lastName: clean(payload.lastName),
      specialty: clean(payload.specialty),
      npi: clean(payload.npi),
      facilityId: clean(payload.facilityId),
      licenseState: clean(payload.licenseState).toUpperCase(),
      licenseNumber: clean(payload.licenseNumber),
    };
    const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      return Response.json(
        { error: `Required fields are missing: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
    if (!/^\d{10}$/.test(required.npi)) {
      return Response.json({ error: "NPI must contain exactly 10 digits." }, { status: 400 });
    }
    if (!/^[A-Z]{2}$/.test(required.licenseState)) {
      return Response.json({ error: "License state must use two letters." }, { status: 400 });
    }

    const providerId = crypto.randomUUID();
    const db = getDb();
    await db.batch([
      db.insert(providers).values({
        id: providerId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        providerCode: required.providerCode,
        firstName: required.firstName,
        lastName: required.lastName,
        credentials: clean(payload.credentials) || null,
        npi: required.npi,
        taxonomyCode: clean(payload.taxonomyCode) || null,
        specialty: required.specialty,
        email: clean(payload.email) || null,
        phone: clean(payload.phone) || null,
        isBilling: payload.isBilling ? "yes" : "no",
        isRendering: payload.isRendering === false ? "no" : "yes",
        isSupervising: payload.isSupervising ? "yes" : "no",
        status: payload.status === "inactive" ? "inactive" : "active",
      }),
      db.insert(providerLicenses).values({
        id: crypto.randomUUID(),
        providerId,
        state: required.licenseState,
        licenseNumber: required.licenseNumber,
        expirationDate: clean(payload.licenseExpiration) || null,
        status: "active",
      }),
      db.insert(providerFacilityAssignments).values({
        id: crypto.randomUUID(),
        providerId,
        facilityId: required.facilityId,
        isPrimary: "yes",
      }),
    ]);
    return Response.json({ id: providerId }, { status: 201 });
  } catch (error) {
    const message = providerError(error);
    const status = message.includes("already exists") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
