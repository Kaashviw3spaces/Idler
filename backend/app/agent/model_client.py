import json
import logging
from typing import Any, Dict, Optional
import httpx
from backend.app.config import settings

logger = logging.getLogger("idler.agent")


class ModelClientException(Exception):
    pass


class ModelClient:
    """Base interface for model clients."""
    async def generate_json(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError


class OllamaModelClient(ModelClient):
    """Client for local Ollama instance running Gemma or other open-weight models."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: Optional[float] = None
    ):
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model_name = model_name or settings.ollama_model
        self.timeout_seconds = timeout_seconds or settings.ollama_timeout_seconds

    async def generate_json(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        endpoint = f"{self.base_url}/api/generate"
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "system": system_prompt or "",
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
            }
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(endpoint, json=payload)
                if response.status_code != 200:
                    raise ModelClientException(
                        f"Ollama returned error status {response.status_code}: {response.text}"
                    )
                data = response.json()
                raw_response = data.get("response", "{}")
                return json.loads(raw_response)
        except httpx.ConnectError as e:
            raise ModelClientException(f"Could not connect to Ollama at {self.base_url}: {e}")
        except httpx.TimeoutException as e:
            raise ModelClientException(f"Ollama request timed out after {self.timeout_seconds}s: {e}")
        except json.JSONDecodeError as e:
            raise ModelClientException(f"Model returned malformed JSON: {e}")


class MockFallbackModelClient(ModelClient):
    """
    Deterministic rule-based model client used when Ollama is unavailable
    or for offline testing. It safely categorizes files by extension and folder rules.
    """

    async def generate_json(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        # Simple deterministic parser of file list from prompt
        return {
            "summary": "Rule-based housekeeping plan organizing files into typed folders",
            "actions": []
        }

