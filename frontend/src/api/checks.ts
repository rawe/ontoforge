/** The shape checks every stream reader shares: a value is what the server promised, or the event is malformed. */

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export const text = (value: unknown): value is string => typeof value === 'string'
export const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || check(value)
