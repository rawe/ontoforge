/** Lens-local retriever persistence; transfer is one managed write transaction. */
import type { Session, ManagedTransaction } from "neo4j-driver";
import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import type { Row } from "../../core/ports.js";
import { convertNeo4jProperties } from "./temporal.js";
function row(raw: Row): Row {
  const value = convertNeo4jProperties(raw);
  let config: unknown = value.configJson;
  try {
    config = JSON.parse(String(value.configJson));
  }
  catch { /* Preserve malformed stored configuration. */ }
  delete value.configJson;
  delete value.ownerLensId;
  return { ...value, config };
}
export async function list(session: Session, lensId: string): Promise<Row[]> {
  const result = await session.run(`MATCH (:Ontology {lensId:$lensId})-[:_HAS_RETRIEVER]->(r:_RetrieverConfig)
    RETURN r {.*} AS retriever ORDER BY r.name,r.key`, { lensId });
  return result.records.map(record => row(record.get("retriever") as Row));
}
async function lock(tx: ManagedTransaction, ids: string[]): Promise<void> {
  // A no-op property assignment acquires the owner write lock without new data.
  const result = await tx.run(`MATCH (l:Ontology) WHERE l.lensId IN $ids
    WITH l ORDER BY l.lensId SET l.lensId=l.lensId RETURN l.lensId AS id`, { ids: [...new Set(ids)] });
  if(result.records.length !== new Set(ids).size)
    throw new NotFoundError("Source or target lens not found");
}
export async function upsert(session: Session, lensId: string, id: string, key: string, name: string, description: string | null, configVersion: number, config: unknown, createOnly: boolean): Promise<[
  Row,
  boolean
]> {
  return session.executeWrite(async (tx) => {
    await lock(tx, [lensId]);
    if(createOnly && (await tx.run("MATCH (r:_RetrieverConfig {ownerLensId:$lensId,key:$key}) RETURN r", { lensId, key })).records.length)
      throw new ConflictError(`Retriever '${key}' already exists in the target lens`);
    const result = await tx.run(`MATCH (l:Ontology {lensId:$lensId})
      MERGE (r:_RetrieverConfig {ownerLensId:$lensId,key:$key})
      ON CREATE SET r.retrieverConfigId=$id,r.createdAt=datetime()
      SET r.name=$name,r.description=$description,r.configVersion=$configVersion,r.configJson=$configJson,r.updatedAt=datetime()
      MERGE (l)-[:_HAS_RETRIEVER]->(r)
      RETURN r {.*} AS retriever,r.retrieverConfigId=$id AS created`, { lensId, id, key, name, description, configVersion, configJson: JSON.stringify(config) });
    return [row(result.records[0]!.get("retriever") as Row), result.records[0]!.get("created") as boolean];
  });
}
export async function remove(session: Session, lensId: string, key: string): Promise<boolean> {
  return session.executeWrite(async (tx) => {
    await lock(tx, [lensId]);
    const result = await tx.run(`MATCH (:Ontology {lensId:$lensId})-[:_HAS_RETRIEVER]->(r:_RetrieverConfig {key:$key})
      DETACH DELETE r RETURN count(r) AS deleted`, { lensId, key });
    return Number(result.records[0]?.get("deleted")) > 0;
  });
}
export async function transfer(session: Session, sourceLensId: string, sourceKey: string, targetLensId: string, targetKey: string, copyId: string | null, expectedConfig: string): Promise<Row> {
  return session.executeWrite(async (tx) => {
    await lock(tx, [sourceLensId, targetLensId]);
    const source = await tx.run(`MATCH (:Ontology {lensId:$sourceLensId})-[:_HAS_RETRIEVER]->(r:_RetrieverConfig {key:$sourceKey}) RETURN r {.*} AS retriever`, { sourceLensId, sourceKey });
    if(source.records.length) {
      const value = row(source.records[0]!.get("retriever") as Row);
      if(JSON.stringify([value.configVersion, value.config]) !== expectedConfig)
        throw new ConflictError("Source retriever changed; reload before transfer");
    }
    if(!source.records.length)
      throw new NotFoundError(`Retriever '${sourceKey}' not found`);
    if((await tx.run("MATCH (r:_RetrieverConfig {ownerLensId:$targetLensId,key:$targetKey}) RETURN r", { targetLensId, targetKey })).records.length)
      throw new ConflictError(`Retriever '${targetKey}' already exists in the target lens`);
    const params = { sourceLensId, sourceKey, targetLensId, targetKey, copyId };
    const result = copyId
      ? await tx.run(`MATCH (:Ontology {lensId:$sourceLensId})-[:_HAS_RETRIEVER]->(r:_RetrieverConfig {key:$sourceKey}), (target:Ontology {lensId:$targetLensId})
          CREATE (target)-[:_HAS_RETRIEVER]->(copy:_RetrieverConfig)
          SET copy=r,copy.retrieverConfigId=$copyId,copy.ownerLensId=$targetLensId,copy.key=$targetKey,copy.createdAt=datetime(),copy.updatedAt=datetime()
          RETURN copy {.*} AS retriever`, params)
      : await tx.run(`MATCH (:Ontology {lensId:$sourceLensId})-[edge:_HAS_RETRIEVER]->(r:_RetrieverConfig {key:$sourceKey}), (target:Ontology {lensId:$targetLensId})
          DELETE edge SET r.ownerLensId=$targetLensId,r.key=$targetKey,r.updatedAt=datetime()
          CREATE (target)-[:_HAS_RETRIEVER]->(r) RETURN r {.*} AS retriever`, params);
    return row(result.records[0]!.get("retriever") as Row);
  });
}
