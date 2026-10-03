/** Internal retriever-only constraints: no new reserved domain type keys. */
import type { Driver } from "neo4j-driver";
import { ValidationError } from "../../core/exceptions.js";
import { runSession } from "./errors.js";

export const RETRIEVER_CONSTRAINTS = [
  "CREATE CONSTRAINT retriever_config_id_unique IF NOT EXISTS FOR (r:_RetrieverConfig) REQUIRE r.retrieverConfigId IS UNIQUE",
  "CREATE CONSTRAINT retriever_config_owner_key_unique IF NOT EXISTS FOR (r:_RetrieverConfig) REQUIRE (r.ownerLensId, r.key) IS UNIQUE",
] as const;
const expected: Record<string, string[]> = {
  retriever_config_id_unique: ["retrieverConfigId"],
  retriever_config_owner_key_unique: ["ownerLensId", "key"],
};

export async function inspectRetrieverStorage(driver: Driver): Promise<"missing" | "ready" | "incompatible"> {
  return runSession(driver, async session => {
    const result = await session.run("SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties");
    const rows = result.records.filter(record => String(record.get("name")) in expected);
    if (rows.some(row => row.get("type") !== "UNIQUENESS" || row.get("entityType") !== "NODE" ||
      JSON.stringify(row.get("labelsOrTypes")) !== JSON.stringify(["_RetrieverConfig"]) ||
      JSON.stringify(row.get("properties")) !== JSON.stringify(expected[String(row.get("name"))]))) return "incompatible";
    return rows.length === Object.keys(expected).length ? "ready" : "missing";
  });
}

export async function checkRetrieverStorageReady(driver: Driver): Promise<void> {
  const status = await inspectRetrieverStorage(driver);
  if (status !== "ready") {
    throw new ValidationError(status === "incompatible" ? "Existing retriever storage is incompatible; no automatic repair." : "Retriever storage requires the targeted migration; existing ontology data is unchanged.", { code: status === "incompatible" ? "RETRIEVER_STORAGE_INCOMPATIBLE" : "RETRIEVER_MIGRATION_REQUIRED" });
  }
}

/** Constraint DDL cannot share a transaction with graph writes; this step writes no nodes. */
export async function ensureRetrieverStorage(driver: Driver): Promise<"created" | "unchanged"> {
  const before = await inspectRetrieverStorage(driver);
  if (before === "incompatible") await checkRetrieverStorageReady(driver);
  if (before === "ready") return "unchanged";
  await runSession(driver, async session => {
    for (const statement of RETRIEVER_CONSTRAINTS) await session.run(statement);
  });
  await checkRetrieverStorageReady(driver);
  return "created";
}
