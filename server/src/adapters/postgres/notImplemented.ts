/** The M1 stub: store methods whose operations land later (M2.5, M3, M4)
 * throw — never a silent no-op. */
export function notImplemented(method: string): never {
  throw new Error(`Not implemented on the PostgreSQL adapter yet: ${method}`);
}
