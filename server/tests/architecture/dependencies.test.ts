/**
 * The module dependency rule, as a source scan:
 *
 * - `src/assistants/` is a technical module beneath the contexts. It
 *   imports only itself, `core/`, Node built-ins and the engine libraries
 *   (LangChain, LangGraph, zod) — never Fastify, `access/`, `auth/`,
 *   `modeling/`, `runtime/` or `mcp/`.
 * - Everything else reaches it only through `assistants/index.ts`.
 * - Runtime never imports modeling.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

/** Every `.ts` file below `dir`, as a path relative to `src/`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [relative(SRC, path)] : [];
  });
}

/** The module specifiers a source file imports or re-exports, static or dynamic. */
function specifiers(file: string): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  return [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!);
}

/** A relative specifier as a path relative to `src/`; null for a package. */
function target(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return relative(SRC, resolve(SRC, dirname(file), specifier));
}

const within = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/** Every import of a file under `from` (all of `src/` without it) that
 * `allowed` refuses, as "file → specifier". */
function offenders(from: string | null, allowed: (file: string, specifier: string) => boolean): string[] {
  return sources(SRC)
    .filter((file) => from === null || within(file, from))
    .flatMap((file) => specifiers(file).filter((s) => !allowed(file, s)).map((s) => `${file} → ${s}`));
}

const ENGINE_PACKAGES = /^(node:|@langchain\/|langchain(\/|$)|zod(\/|$))/;

describe("module dependencies", () => {
  it("assistants import only themselves, core, Node built-ins and the engine libraries", () => {
    expect(offenders("assistants", (file, specifier) => {
      const path = target(file, specifier);
      if (path === null) return ENGINE_PACKAGES.test(specifier);
      return within(path, "assistants") || within(path, "core");
    })).toEqual([]);
  });

  it("everything else reaches assistants only through its index", () => {
    expect(offenders(null, (file, specifier) => {
      if (within(file, "assistants")) return true;
      const path = target(file, specifier);
      return path === null || !within(path, "assistants") || path === "assistants/index.js";
    })).toEqual([]);
  });

  it("runtime never imports modeling", () => {
    expect(offenders("runtime", (file, specifier) => {
      const path = target(file, specifier);
      return path === null || !within(path, "modeling");
    })).toEqual([]);
  });
});
