// Points the Pulumi state of an RDS instance at the new instance after a manual
// Blue/Green switchover. The provider uses the DbiResourceId (db-...) as the
// resource ID, and after the switchover the old ID belongs to <identifier>-old1.
//
//   pulumi stack export --file before.json
//   bun scripts/fix-state.ts before.json fixed.json <old db-...> <new db-...>
//   pulumi stack import --file fixed.json
import { readFileSync, writeFileSync } from "node:fs";

type Resource = {
    urn: string;
    type: string;
    id?: string;
    outputs?: Record<string, unknown>;
};

const [input, output, oldId, newId] = process.argv.slice(2);
if (!input || !output || !oldId?.startsWith("db-") || !newId?.startsWith("db-")) {
    console.error("usage: bun scripts/fix-state.ts <before.json> <fixed.json> <old db-...> <new db-...>");
    process.exit(1);
}

const state = JSON.parse(readFileSync(input, "utf8"));
const resources: Resource[] = state.deployment.resources;

const matches = resources.filter((r) => r.type === "aws:rds/instance:Instance" && r.id === oldId);
if (matches.length !== 1) {
    console.error(`Expected one aws:rds/instance:Instance with ID ${oldId}, found ${matches.length}.`);
    process.exit(1);
}

const db = matches[0]!;
db.id = newId;
db.outputs = { ...db.outputs, id: newId, resourceId: newId };
// Stale after the edit, and the next read fails while it's there
delete db.outputs.__pulumi_raw_state_delta;

// Anything else built from the old ID, such as an rds-db:connect policy, still
// points at <identifier>-old1. Stop rather than import a half-fixed state.
const stale = resources.filter((r) => JSON.stringify(r).includes(oldId));
if (stale.length > 0) {
    console.error(`Still referencing ${oldId}:\n${stale.map((r) => `  ${r.urn}`).join("\n")}`);
    process.exit(1);
}

writeFileSync(output, JSON.stringify(state, null, 2));
console.log(`${db.urn}: ${oldId} -> ${newId}. Wrote ${output}.`);
