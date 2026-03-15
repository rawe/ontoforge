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
