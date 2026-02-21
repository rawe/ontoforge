from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env"}

    MODEL_DB_URI: str = "bolt://localhost:7687"
    MODEL_DB_USER: str = "neo4j"
    MODEL_DB_PASSWORD: str = "ontoforge_dev"


settings = Settings()
