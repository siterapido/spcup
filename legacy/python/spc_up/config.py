from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://spcup:spcup@localhost:5432/spcup"
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4"
    confianca_limiar_alta: float = 0.85
    confianca_limiar_baixa: float = 0.60
    storage_root: str = "./data/uploads"


settings = Settings()
