import type { OntoForgeErrorCode, ErrorDetails } from './types.js';

/**
 * Error thrown by the OntoForge runtime client.
 *
 * Wraps both API error responses and network failures into a single,
 * typed error class with a machine-readable `code` for programmatic handling.
 */
export class OntoForgeError extends Error {
  /** HTTP status code (0 for network errors). */
  readonly status: number;

  /** Machine-readable error code. */
  readonly code: OntoForgeErrorCode;

  /** Optional structured details (e.g. field-level validation errors). */
  readonly details?: ErrorDetails;

  constructor(
    message: string,
    status: number,
    code: OntoForgeErrorCode,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'OntoForgeError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
