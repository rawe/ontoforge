from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "extra": "ignore"}

    DB_URI: str = "bolt://localhost:7687"
    DB_USER: str = "neo4j"
    DB_PASSWORD: str = "ontoforge_dev"
    PORT: int = 8000

    EMBEDDING_PROVIDER: str | None = None
    EMBEDDING_MODEL: str = "nomic-embed-text"
    EMBEDDING_BASE_URL: str = "http://localhost:11434"
    EMBEDDING_API_KEY: str | None = None
    EMBEDDING_DIMENSIONS: int | None = None

    AI_PROVIDER: str | None = None
    AI_MODEL: str = "qwen3:8b"
    AI_BASE_URL: str = "http://localhost:11434"
    AI_API_KEY: str | None = None

    PUBLIC_URL: str | None = None

    RECONCILE_INTERVAL_SECONDS: int = 30
    RECONCILE_BATCH_SIZE: int = 50


settings = Settings()
