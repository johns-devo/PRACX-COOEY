import { getLocalUserFromRequest } from "../../../lib/auth";

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

type NpiResult = {
  number?: string;
  basic?: Record<string, unknown>;
  taxonomies?: Array<Record<string, unknown>>;
  addresses?: Array<Record<string, unknown>>;
};

export async function GET(request: Request) {
  if (!(await getLocalUserFromRequest(request))) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const state = clean(url.searchParams.get("state")).toUpperCase();
  if (query.length < 2) return Response.json({ results: [] });
  if (state && !/^[A-Z]{2}$/.test(state)) return Response.json({ error: "State must use a two-letter abbreviation." }, { status: 400 });

  const params = new URLSearchParams({ version: "2.1", enumeration_type: "NPI-1", limit: "10" });
  if (/^\d{10}$/.test(query)) params.set("number", query);
  else {
    const normalized = query.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (normalized.length > 1) {
      params.set("first_name", `${normalized[0]}*`);
      params.set("last_name", `${normalized.slice(1).join(" ")}*`);
    } else params.set("last_name", `${normalized[0]}*`);
  }
  if (state) params.set("state", state);

  try {
    const response = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`NPI Registry returned ${response.status}.`);
    const body = await response.json() as { results?: NpiResult[]; Errors?: Array<{ description?: string }> };
    const results = (body.results || []).map((row) => {
      const basic = row.basic || {};
      const taxonomy = (row.taxonomies || []).find((item) => item.primary === true) || row.taxonomies?.[0] || {};
      const address = (row.addresses || []).find((item) => item.address_purpose === "LOCATION") || row.addresses?.[0] || {};
      return {
        npi: row.number || "", firstName: clean(basic.first_name), lastName: clean(basic.last_name),
        credentials: clean(basic.credential), taxonomyCode: clean(taxonomy.code),
        specialty: clean(taxonomy.desc) || "Referring provider", organizationName: "",
        phone: clean(address.telephone_number), addressLine1: clean(address.address_1),
        city: clean(address.city), state: clean(address.state), postalCode: clean(address.postal_code),
        enumerationStatus: clean(basic.status), source: "NPPES",
      };
    });
    return Response.json({ results, source: "CMS NPI Registry v2.1" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to search the NPI Registry." }, { status: 502 });
  }
}
