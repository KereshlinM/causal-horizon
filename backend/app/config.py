from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Causal Horizon"
    app_version: str = "0.1.0"
    app_env: str = "development"

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/causal_horizon"
    secret_key: str = "dev-secret-key"
    cors_origins: str = "http://localhost:5173"

    # Default urgency threshold for webhooks (0-100)
    alert_threshold: float = 70.0

    # Minimum observations before computing signal baselines
    min_baseline_observations: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
