import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  dbaName: text("dba_name"),
  organizationNpi: text("organization_npi"),
  status: text("status", { enum: ["active", "inactive"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const facilities = sqliteTable(
  "facilities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    facilityType: text("facility_type").notNull(),
    npi: text("npi"),
    cliaNumber: text("clia_number"),
    phone: text("phone"),
    email: text("email"),
    timezone: text("timezone").notNull().default("America/New_York"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("facilities_org_code_unique").on(
      table.organizationId,
      table.code,
    ),
    index("facilities_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const serviceLocations = sqliteTable(
  "service_locations",
  {
    id: text("id").primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    placeOfServiceCode: text("place_of_service_code").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    isPrimary: text("is_primary", { enum: ["yes", "no"] })
      .notNull()
      .default("yes"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("service_locations_facility_idx").on(table.facilityId),
  ],
);
