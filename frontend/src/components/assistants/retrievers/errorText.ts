import { ApiError } from '@/api/http'

/** An error with its server details, for inline display next to the action that failed. */
export const errorText = (error: unknown) =>
  error instanceof ApiError && error.details ? `${error.message}\n${JSON.stringify(error.details, null, 2)}` : error instanceof Error ? error.message : 'Retriever operation failed.'
