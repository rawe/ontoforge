/**
 * Fetch wrapper + query-string builders for the OntoForge server.
 *
 * Every error answers in one envelope: `{"error": {"code", "message",
 * "details"?}}`. Anything else is reported as a bare `HTTP_ERROR`.
 * 204 responses resolve to `undefined`.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Per-field validation errors (`details.fields`), if present. */
  get fieldErrors(): Record<string, string> | undefined {
    const fields = this.details?.fields
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      return fields as Record<string, string>
    }
    return undefined
  }

  /** Ontologies affected by a `CASCADE_REQUIRED` conflict, if present. */
  get affectedOntologies(): string[] | undefined {
    const affected = this.details?.affectedOntologies
    return Array.isArray(affected) ? (affected as string[]) : undefined
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return new ApiError(res.status, 'HTTP_ERROR', `${res.status} ${res.statusText}`)
  }
  if (body && typeof body === 'object') {
    const envelope = (body as { error?: unknown }).error
    if (envelope && typeof envelope === 'object') {
      const e = envelope as {
        code?: string
        message?: string
        details?: Record<string, unknown>
      }
      return new ApiError(
        res.status,
        e.code ?? 'HTTP_ERROR',
        e.message ?? `${res.status} ${res.statusText}`,
        e.details,
      )
    }
  }
  return new ApiError(res.status, 'HTTP_ERROR', `${res.status} ${res.statusText}`)
}

export async function request<T>(
  path: string,
  init?: Omit<RequestInit, 'body'> & { body?: unknown },
): Promise<T> {
  const { body, headers, ...rest } = init ?? {}
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ------------------------------ query strings ------------------------------ */

export type FilterOp = 'gt' | 'gte' | 'lt' | 'lte' | 'contains'

/**
 * Filter conditions, keyed by property. A bare value means equality; use
 * `{op, value}` for operator filters — serialized as `filter.{key}__{op}`.
 */
export type FilterMap = Record<
  string,
  string | number | boolean | { op: FilterOp; value: string | number | boolean }
>

export type QueryParamValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | FilterMap
  | undefined
  | null

/**
 * Build a query string. Conventions:
 * - arrays are serialized as repeated params (e.g. `fields=a&fields=b`)
 * - a `filter` object becomes `filter.{key}` / `filter.{key}__{op}` params
 * - `undefined` / `null` values are skipped
 * - returns `""` or a string starting with `?`
 */
export function buildQuery(params?: object): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, QueryParamValue][]) {
    if (value === undefined || value === null) continue
    if (key === 'filter' && typeof value === 'object' && !Array.isArray(value)) {
      for (const [prop, cond] of Object.entries(value as FilterMap)) {
        if (cond === undefined || cond === null) continue
        if (typeof cond === 'object') {
          search.append(`filter.${prop}__${cond.op}`, String(cond.value))
        } else {
          search.append(`filter.${prop}`, String(cond))
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs === '' ? '' : `?${qs}`
}
