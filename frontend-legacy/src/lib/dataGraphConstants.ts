/** Hard cap on total entities in the working set (canvas). */
export const MAX_WORKING_SET = 200;

/** Max entities loaded per type in a single bulk-add or auto-refresh. */
export const PER_TYPE_LIMIT = 50;

/** Max relations fetched per relation type. */
export const RELATION_CAP = 200;

/** Auto-refresh polling interval in milliseconds. */
export const REFRESH_INTERVAL = 7000;
