import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the PRACX facility workspace and durable storage", async () => {
  const [workspace, layout, schema, migration] = await Promise.all([
    readFile(new URL("../app/FacilityWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0000_eager_iron_man.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(layout, /PRACX Care Operations/);
  assert.match(workspace, /Organization & facilities/);
  assert.match(workspace, /Add facility/);
  assert.match(workspace, /Search facilities/);
  assert.match(workspace, /NPI/);
  assert.match(schema, /serviceLocations/);
  assert.match(schema, /facilities_org_code_unique/);
  assert.match(migration, /CREATE TABLE `facilities`/);
  assert.doesNotMatch(workspace, /codex-preview|SkeletonPreview/);
});
