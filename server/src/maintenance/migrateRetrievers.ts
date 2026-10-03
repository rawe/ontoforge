/** Explicit retriever-only migration. Dry-run connects without adapter boot DDL. */
import { pathToFileURL } from "node:url";
import { settings } from "../config.js";
import { KEY_PATTERN, MAX_ONTOLOGY_KEY_LENGTH } from "../core/schemas.js";
import { ValidationError, StoreError } from "../core/exceptions.js";

export function safeMigrationFailure(error: unknown): { status: string; code: string } {
  if (error instanceof ValidationError) {
    if (error.details?.code === "RETRIEVER_STORAGE_INCOMPATIBLE") return { status: "incompatible", code: "RETRIEVER_STORAGE_INCOMPATIBLE" };
    if (error.details?.code === "RETRIEVER_MIGRATION_REQUIRED") return { status: "failed", code: "RETRIEVER_MIGRATION_REQUIRED" };
  }
  return { status: "failed", code: error instanceof StoreError ? "STORAGE_ERROR" : "MIGRATION_FAILED" };
}

export interface MigrationOptions { apply: boolean; ontologyKeys: string[]; all: boolean }
export function parseMigrationOptions(args: string[]): MigrationOptions {
  const result: MigrationOptions = { apply: false, ontologyKeys: [], all: false };
  let explicitMode: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply" || arg === "--dry-run") {
      if (explicitMode) throw new Error("Choose exactly one migration mode.");
      explicitMode = arg; result.apply = arg === "--apply";
    } else if (arg === "--all") result.all = true;
    else if (arg === "--ontology") {
      const key = args[++i];
      if (!key || !KEY_PATTERN.test(key) || key.length > MAX_ONTOLOGY_KEY_LENGTH) throw new Error("Invalid --ontology key.");
      if (!result.ontologyKeys.includes(key)) result.ontologyKeys.push(key);
    } else throw new Error("Use --dry-run or --apply and --ontology KEY (repeatable), or --all.");
  }
  if (result.all === Boolean(result.ontologyKeys.length)) throw new Error("Select --all or one or more --ontology keys.");
  return result;
}

export async function migrateRetrievers(options: MigrationOptions): Promise<{ backend: string; mode: string; results: { ontologyKey: string; status: string; code?: string }[] }> {
  const results: { ontologyKey: string; status: string; code?: string }[] = [];
  const choose = (keys: string[]) => {
    const selected = options.all ? keys : options.ontologyKeys;
    if (selected.some(key => !keys.includes(key))) throw new Error("A selected ontology is not registered; no migration was started.");
    return selected;
  };
  if (settings.DB_BACKEND === "postgres") {
    const db = await import("../adapters/postgres/errors.js");
    const storage = await import("../adapters/postgres/retrieverStorage.js");
    const registry = await import("../adapters/postgres/registry.js");
    await db.initPool();
    try {
      const bindings = await registry.listOntologyBindings();
      for (const key of choose(bindings.map(binding => binding.key))) {
        const namespace = bindings.find(binding => binding.key === key)!.namespace;
        try {
          const status = options.apply ? await storage.ensureRetrieverStorage(namespace) :
            await db.withTransaction(q => storage.inspectRetrieverStorage(q, namespace), "READ COMMITTED", namespace);
          results.push({ ontologyKey: key, status, ...(status === "incompatible" ? { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } : {}) });
        } catch (error) { results.push({ ontologyKey: key, ...safeMigrationFailure(error) }); }
      }
    } finally { await db.closePool(); }
  } else if (settings.DB_BACKEND === "neo4j") {
    const db = await import("../adapters/neo4j/driver.js");
    const storage = await import("../adapters/neo4j/retrieverStorage.js");
    const registry = await import("../adapters/neo4j/registry.js");
    const driver = await db.initDriver({ ensureConstraints: false });
    try {
      const ontologies = await new registry.Neo4jOntologyRegistry(driver).listOntologies();
      for (const key of choose(ontologies.map(row => String(row.key)))) {
        try {
          const status = options.apply ? await storage.ensureRetrieverStorage(driver) : await storage.inspectRetrieverStorage(driver);
          results.push({ ontologyKey: key, status, ...(status === "incompatible" ? { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } : {}) });
        } catch (error) { results.push({ ontologyKey: key, ...safeMigrationFailure(error) }); }
      }
    } finally { await db.closeDriver(); }
  } else throw new Error("Unsupported storage backend.");
  return { backend: settings.DB_BACKEND, mode: options.apply ? "apply" : "dry-run", results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = await migrateRetrievers(parseMigrationOptions(process.argv.slice(2)));
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.results.some(row => row.status === "failed" || row.status === "incompatible")) process.exitCode = 1;
  } catch {
    console.error("Retriever migration could not run. Check arguments and the configured database; no automatic retry.");
    process.exitCode = 1;
  }
}
