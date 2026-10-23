import json
import logging
import re
from typing import Any, Dict, Optional
import httpx
from backend.app.config import settings

logger = logging.getLogger("idler.agent")


class ModelClientException(Exception):
    pass


def extract_json_from_text(raw_text: str) -> Dict[str, Any]:
    """
    Extracts and parses a JSON object from model response text.
    Handles Markdown code fences (```json ... ```) and conversational wrapping.
    """
    text = raw_text.strip()
    if not text:
        raise ValueError("Model returned empty text response")

    # If wrapped in markdown code fences, extract the inner content
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    # Locate the outer JSON curly braces
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        return json.loads(candidate)

    return json.loads(text)


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
                return extract_json_from_text(raw_response)
        except httpx.ConnectError as e:
            raise ModelClientException(f"Could not connect to Ollama at {self.base_url}: {e}")
        except httpx.TimeoutException as e:
            raise ModelClientException(f"Ollama request timed out after {self.timeout_seconds}s: {e}")
        except (json.JSONDecodeError, ValueError) as e:
            raise ModelClientException(f"Model returned malformed JSON: {e}")


class MockFallbackModelClient(ModelClient):
    """
    Deterministic rule-based model client used when Ollama is unavailable
    or for offline testing. Can accept pre-configured response dictionaries or raw text.
    """

    def __init__(
        self,
        response_data: Optional[Dict[str, Any]] = None,
        raw_response_text: Optional[str] = None,
    ):
        self.response_data = response_data
        self.raw_response_text = raw_response_text

    async def generate_json(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        if self.raw_response_text is not None:
            return extract_json_from_text(self.raw_response_text)
        if self.response_data is not None:
            return self.response_data
        return {
            "summary": "Rule-based housekeeping plan organizing files into typed folders",
            "actions": []
        }
