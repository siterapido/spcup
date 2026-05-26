"""OpenRouter client for structured PDF extraction."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any

import httpx

from spc_up.config import settings

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT_SECONDS = 60.0
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1.0

_EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cpf": {"type": "string", "description": "CPF digits only, 11 characters"},
        "nome": {"type": "string", "description": "Counterparty name from the document"},
        "valor": {"type": "number", "description": "Transaction amount in BRL"},
        "data": {"type": "string", "description": "Transaction date in YYYY-MM-DD format"},
        "direcao": {
            "type": "string",
            "enum": ["ENTRADA", "SAIDA"],
            "description": "ENTRADA for credits, SAIDA for debits",
        },
    },
    "required": ["cpf", "nome", "valor", "data", "direcao"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "You extract structured bank transaction data from Brazilian financial PDF documents. "
    "Return only the requested JSON fields. Use ENTRADA for credits and SAIDA for debits. "
    "Normalize CPF to digits only."
)


def _encode_pdf(path: Path) -> str:
    data = path.read_bytes()
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:application/pdf;base64,{encoded}"


def _build_payload(path: Path) -> dict[str, Any]:
    pdf_path = Path(path)
    return {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Extract the main transaction from this PDF: cpf, nome, valor, "
                            "data (YYYY-MM-DD), and direcao (ENTRADA or SAIDA)."
                        ),
                    },
                    {
                        "type": "file",
                        "file": {
                            "filename": pdf_path.name,
                            "file_data": _encode_pdf(pdf_path),
                        },
                    },
                ],
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "pdf_transaction",
                "strict": True,
                "schema": _EXTRACTION_SCHEMA,
            },
        },
    }


def _parse_response_body(body: dict[str, Any]) -> dict[str, Any]:
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("OpenRouter response missing message content") from exc

    if isinstance(content, dict):
        return content

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("OpenRouter response content is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise ValueError("OpenRouter response JSON must be an object")
    return parsed


def extract_structured_from_pdf(path: str | Path, *, client: httpx.Client | None = None) -> dict[str, Any]:
    """Extract structured transaction fields from a PDF via OpenRouter."""
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured")

    pdf_path = Path(path)
    if not pdf_path.is_file():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    payload = _build_payload(pdf_path)

    last_error: Exception | None = None
    owns_client = client is None
    http = client or httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS)

    try:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = http.post(OPENROUTER_URL, headers=headers, json=payload)
                response.raise_for_status()
                return _parse_response_body(response.json())
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt == MAX_RETRIES:
                    break
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
    finally:
        if owns_client:
            http.close()

    assert last_error is not None
    raise last_error
