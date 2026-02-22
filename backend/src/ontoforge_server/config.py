from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env"}

    DB_URI: str = "bolt://localhost:7687"
    DB_USER: str = "neo4j"
    DB_PASSWORD: str = "ontoforge_dev"
    SERVER_MODE: str = "model"
    PORT: int = 8000


settings = Settings()
