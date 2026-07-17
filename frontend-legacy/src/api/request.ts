export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Request failed', code: 'UNKNOWN' } }));
    throw new ApiError(
      body.error?.message || 'Request failed',
      res.status,
      body.error?.code || 'UNKNOWN',
      body.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
