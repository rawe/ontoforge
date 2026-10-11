/**
 * The server's version. `package.json` is its one source; the file sits one
 * level above both `src/` (development) and `dist/` (the built image), so
 * the same relative path resolves in either.
 */

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const SERVER_VERSION: string = pkg.version;
