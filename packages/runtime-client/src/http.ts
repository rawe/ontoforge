import type { OntoForgeErrorCode, Filters } from './types.js';
import { OntoForgeError } from './errors.js';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Internal HTTP request helper. Handles JSON serialization, error parsing,
 * and wrapping failures into `OntoForgeError`.
 */
export async function httpRequest<T>(
  fetchFn: FetchFn,
  url: string,
  options?: RequestOptions,
): Promise<T> {
  let response: Response;

  try {
    response = await fetchFn(url, {
      method: options?.method ?? 'GET',
      headers: options?.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : undefined,
      body: options?.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
    });
  } catch (err) {
    throw new OntoForgeError(
      err instanceof Error ? err.message : 'Network request failed',
      0,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let code: OntoForgeErrorCode = 'UNKNOWN';
    let message = 'Request failed';
    let details: Record<string, unknown> | undefined;

    try {
      const body = await response.json() as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (body.error) {
        code = (body.error.code as OntoForgeErrorCode) ?? 'UNKNOWN';
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      // Response body wasn't JSON — keep defaults.
    }

    throw new OntoForgeError(message, response.status, code, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query string helpers
// ---------------------------------------------------------------------------

export function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
  filters?: Filters,
  arrayParams?: Record<string, string[] | undefined>,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      parts.push(`filter.${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }

  if (arrayParams) {
    for (const [key, values] of Object.entries(arrayParams)) {
      if (values) {
        for (const v of values) {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
        }
      }
    }
  }

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
