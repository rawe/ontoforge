# F02 — Request Validation Errors Bypass the Documented Error Envelope

> **Severity: Medium (code bug)** · **Effort: Small** · **Type: Code correction**

## Finding

`architecture.md` §5.1 and the API contracts promise a uniform error format
(`{"error": {"code", "message", "details"}}`) with 400 for malformed requests. The exception
handlers in `main.py` cover the domain exceptions (`NotFoundError`, `ConflictError`,
`ValidationError`, `CascadeRequiredError`) and `json.JSONDecodeError`, but **not** FastAPI's
`RequestValidationError`. A request with a missing field or wrong body shape therefore returns
FastAPI's default `{"detail": [...]}` at HTTP 422 — outside the documented envelope and with a
different status code than documented.

Additionally, two handlers that *do* exist are undocumented in `architecture.md` §7:
`CascadeRequiredError` → 409 `CASCADE_REQUIRED` and `json.JSONDecodeError` → 400 `INVALID_JSON`.

## Impact

API consumers (including the frontend, MCP clients, and the AI layer) cannot rely on a single
error shape. Generic client-side error handling that parses `error.code` silently fails for the
most common error class: malformed request bodies.

## Proposed Correction

- Add a `RequestValidationError` handler in `main.py` that maps Pydantic body/query validation
  failures into the documented envelope. Decide the status code deliberately (the docs say 400 for
  malformed requests; FastAPI convention is 422 — pick one and align the docs; see F08).
  Recommended: keep 422 with code `VALIDATION_ERROR` and a `details.fields` map, matching the
  existing domain `ValidationError` shape, and update the docs' 400-row wording accordingly.
- Document `CASCADE_REQUIRED` and `INVALID_JSON` in the exceptions table (`architecture.md` §7).

## Dependencies

None technically. The doc side lands together with F08.

## Acceptance

- A request with a missing required field returns the envelope with `error.code` and per-field
  details; frontend error toasts render it correctly.
- `architecture.md` §7 lists all five mapped error classes.
