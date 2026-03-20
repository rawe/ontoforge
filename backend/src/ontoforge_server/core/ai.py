import logging
from dataclasses import dataclass

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ontoforge_server.config import settings

logger = logging.getLogger(__name__)


@dataclass
class AgentConfig:
    key: str
    name: str
    description: str | None
    system_prompt: str | None
    tools: list[str] | None  # None = all available


@dataclass
class SavedQueryParameter:
    name: str
    description: str
    data_type: str


@dataclass
class StepConfig:
    name: str
    type: str  # "cypher" or "semantic_search"
    cypher: str | None = None
    entity_type_key: str | None = None
    query: str | None = None
    limit: int | None = None
    min_score: float | None = None
    bindings: dict[str, str] | None = None


@dataclass
class SavedQueryConfig:
    key: str
    name: str
    description: str
    steps: list[StepConfig]
    parameters: list[SavedQueryParameter]


DEFAULT_AGENT_CONFIG = AgentConfig(
    key="_default",
    name="Knowledge Assistant",
    description=None,
    system_prompt=None,
    tools=None,
)

_model: Model | None = None


def _create_model(provider: str, model_name: str, base_url: str) -> Model:
    if provider == "ollama":
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(
                base_url=f"{base_url.rstrip('/')}/v1",
            ),
        )
    if provider == "openai":
        api_key = settings.AI_API_KEY
        if not api_key:
            raise ValueError("AI_API_KEY is required for the openai provider")
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(
                base_url=f"{base_url.rstrip('/')}/v1",
                api_key=api_key,
            ),
        )
    raise ValueError(f"Unknown AI provider: '{provider}'")


def init_ai_model() -> None:
    global _model
    if not settings.AI_PROVIDER:
        logger.info("AI_PROVIDER not set — AI endpoints disabled")
        return
    _model = _create_model(
        settings.AI_PROVIDER,
        settings.AI_MODEL,
        settings.AI_BASE_URL,
    )
    logger.info(
        "AI model initialized: %s (%s via %s)",
        settings.AI_MODEL,
        settings.AI_PROVIDER,
        settings.AI_BASE_URL,
    )


def get_ai_model() -> Model | None:
    return _model
