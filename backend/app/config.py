import os
from pathlib import Path
from typing import List, Union
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    app_name: str = "Idler"
    app_env: str = Field(default="development", alias="IDLER_ENV")
    host: str = Field(default="127.0.0.1", alias="IDLER_HOST")
    port: int = Field(default=8000, alias="IDLER_PORT")

    # Local AI / Ollama configuration
    ollama_base_url: str = Field(default="http://127.0.0.1:11434", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="gemma2:2b", alias="OLLAMA_MODEL")
    ollama_timeout_seconds: float = Field(default=30.0, alias="OLLAMA_TIMEOUT_SECONDS")
    use_mock_model: bool = Field(default=False, alias="IDLER_USE_MOCK_MODEL")

    # Persistence
    database_url: str = Field(default="sqlite:///./idler.db", alias="DATABASE_URL")

    # Allowed Workspaces (Security boundary)
    # Comma-separated paths or list of paths
    allowed_workspaces_raw: Union[str, List[str]] = Field(
        default="./test_workspace",
        alias="IDLER_ALLOWED_WORKSPACES"
    )

    def get_allowed_workspaces(self) -> List[Path]:
        """
        Returns resolved, absolute, canonical Path objects for all allowed workspaces.
        Workspaces are the hard boundary for all file operations.
        """
        raw = self.allowed_workspaces_raw
        if isinstance(raw, str):
            paths = [p.strip() for p in raw.split(",") if p.strip()]
        else:
            paths = list(raw)

        resolved_paths = []
        for p in paths:
            path_obj = Path(p).expanduser().resolve()
            resolved_paths.append(path_obj)
        return resolved_paths


settings = Settings()

