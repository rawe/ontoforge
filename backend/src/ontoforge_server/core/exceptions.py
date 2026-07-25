import uuid


class OntoForgeError(Exception):
    """Base exception for OntoForge."""


class NotFoundError(OntoForgeError):
    """Raised when a requested resource is not found."""


class ConflictError(OntoForgeError):
    """Raised when an operation conflicts with existing state."""


class ValidationError(OntoForgeError):
    """Raised when request or business logic validation fails."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.details = details


class CascadeRequiredError(OntoForgeError):
    """Raised when a schema change would break scoped ontologies and cascade is not enabled."""

    def __init__(self, message: str, affected_ontologies: list[str]):
        super().__init__(message)
        self.affected_ontologies = affected_ontologies


class StoreError(OntoForgeError):
    """Raised when the persistence adapter fails in a way no domain exception describes.

    The adapter raises this instead of letting a database failure escape the
    persistence port (port contract rule 4, ``core/ports.py``). It deliberately
    carries no storage detail: the originating exception is chained as
    ``__cause__`` and logged by the adapter against ``error_id``, which is the
    only thing the client receives that ties its response to that log entry.
    Nothing vendor-specific reaches the caller (decision 010).
    """

    def __init__(
        self,
        message: str = "A storage operation failed",
        error_id: str | None = None,
    ):
        super().__init__(message)
        self.error_id = error_id or uuid.uuid4().hex[:8]
