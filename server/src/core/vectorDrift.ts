/**
 * What an operator is told when a semantic index no longer matches the
 * configured embedding model.
 *
 * A vector index fixes its width when it is created, so changing the
 * embedding model leaves indexes that reject every vector the new model
 * produces. Detecting that is each adapter's own business — the catalog
 * read and the physical naming differ per engine — but the *report* is
 * contract-visible and must not: every backend says the same thing in
 * the same words, and says it in the vocabulary of the API — by entity
 * type, by document property, by search scope — never by a physical
 * index name, a vendor, or a statement.
 *
 * That is why the words live here, above the adapters, and only the
 * words: nothing in this module knows how an index is found, named, or
 * dropped.
 */

/** The semantic index of one entity type. */
export function entityTypeScope(entityTypeKey: string): string {
  return `entity type '${entityTypeKey}'`;
}

/** The chunk index of one document property. */
export function documentPropertyScope(entityTypeKey: string, propertyKey: string): string {
  return `document property '${propertyKey}' on entity type '${entityTypeKey}'`;
}

/** The cross-type entity index. */
export const ALL_ENTITY_TYPES_SCOPE = "search across all entity types";

/** The saved-query description index. */
export const SAVED_QUERY_SCOPE = "saved-query descriptions";

/**
 * Report a width mismatch the caller will not repair.
 *
 * An index holds no vectors of its own — they live in the store's own
 * column, and a drop leaves every one of them where it was. What a drop
 * costs is the search: it stays down until every vector has been
 * regenerated at the new width, which is one model call per stored item
 * and so the operator's call to make. The startup and per-type create
 * paths therefore only say what they found and point at the one endpoint
 * that makes it. A mismatch report never fails the ensure.
 */
export function reportWidthMismatch(
  describes: string,
  existingWidth: number,
  configuredWidth: number,
): void {
  console.warn(
    `The semantic index for ${describes} holds ${existingWidth}-dimensional ` +
      `vectors, but the configured embedding model produces ${configuredWidth}. ` +
      "Semantic search over it fails until the widths agree. Run " +
      "POST /api/ontologies/{ontologyKey}/model/rebuild-embeddings on the " +
      "ontology holding it to recreate it at the model's width and " +
      "regenerate its vectors.",
  );
}

/**
 * Announce a repair. Only the rebuild path reaches this, and there the
 * drop has to come first: while an index of the old width stands, a
 * vector of the new one cannot be stored at all, so there is no order in
 * which the vectors could be regenerated underneath it. The index is
 * built again, at the model's width, once they have been.
 */
export function reportWidthRecreate(
  describes: string,
  existingWidth: number,
  configuredWidth: number,
): void {
  console.info(
    `Recreating the semantic index for ${describes} at ${configuredWidth} ` +
      `dimensions (was ${existingWidth}) to match the configured embedding model; ` +
      "it is built again once this rebuild has regenerated its vectors.",
  );
}

/**
 * Report an ontology whose semantic indexes could not be brought into
 * line with the configured model while the server was starting.
 *
 * Startup reports and carries on. The one thing that leaves indexes
 * unbuildable is a rebuild that did not finish — it leaves vectors of
 * mixed width behind — and refusing to boot over that would take away
 * the server the operator needs in order to run the rebuild again.
 *
 * The underlying failure is deliberately not repeated here: it is a
 * storage detail, and this module speaks only the vocabulary of the API.
 */
export function reportEnsureFailed(ontologyKey: string): void {
  console.warn(
    `The semantic indexes of ontology '${ontologyKey}' could not be brought ` +
      "up to the width of the configured embedding model, so semantic " +
      "search over it fails. An unfinished rebuild leaves exactly this " +
      "behind. Run POST /api/ontologies/{ontologyKey}/model/rebuild-embeddings " +
      "on it to regenerate its vectors and build its indexes.",
  );
}
