class OntoForgeError(Exception):
    """Base exception for OntoForge."""


class NotFoundError(OntoForgeError):
    """Raised when a requested resource is not found."""


class ConflictError(OntoForgeError):
    """Raised when an operation conflicts with existing state."""


class ValidationError(OntoForgeError):
    """Raised when request or business logic validation fails."""
