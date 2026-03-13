from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    anthropic_api_key: str = ""
    database_url: str = "sqlite:///./data/school_monitor.db"
    poll_interval_hours: int = 6
    oauthlib_insecure_transport: str = "1"

    class Config:
        env_file = ".env"
        extra = "ignore"

    def model_post_init(self, __context):
        """Re-read .env values for any keys that are blank in the environment.

        The shell or IDE may export empty-string overrides (e.g. ANTHROPIC_API_KEY='')
        which pydantic-settings honours over the .env file.  We detect blank values
        and replace them with whatever is in .env so the app always has real credentials.
        """
        import os
        from pathlib import Path
        env_file = Path(__file__).parent / ".env"
        if not env_file.exists():
            return
        env_values: dict[str, str] = {}
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env_values[k.strip()] = v.strip()

        for field in ("anthropic_api_key", "google_client_id", "google_client_secret"):
            if not getattr(self, field):
                env_key = field.upper()
                if env_values.get(env_key):
                    object.__setattr__(self, field, env_values[env_key])


settings = Settings()
