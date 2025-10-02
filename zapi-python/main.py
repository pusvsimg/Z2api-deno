import asyncio
import hashlib
import json
import os
import time
from typing import AsyncGenerator, Dict, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse


UPSTREAM_URL = "https://chat.z.ai/api/chat/completions"
ORIGIN_BASE = "https://chat.z.ai"
SYSTEM_FINGERPRINT = "fp_generated_by_proxy_cf"

FAKE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "X-FE-Version": "prod-fe-1.0.94",
    "Origin": ORIGIN_BASE,
}


def get_config() -> Dict[str, str]:
    return {
        "DOWNSTREAM_KEY": os.getenv("DOWNSTREAM_KEY", ""),
        "UPSTREAM_TOKEN": os.getenv("UPSTREAM_TOKEN", ""),
        "ANON_TOKEN_ENABLED": os.getenv("ANON_TOKEN_ENABLED", "true"),
        "THINK_TAGS_MODE": os.getenv("THINK_TAGS_MODE", "strip"),
        "DEBUG_MODE": os.getenv("DEBUG_MODE", "false"),
    }


def debug_log(cfg: Dict[str, str], *args: object) -> None:
    if cfg["DEBUG_MODE"].lower() == "true":
        print("[DEBUG]", *args)


async def generate_signature(body: str) -> str:
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    return digest


async def get_anonymous_token(client: httpx.AsyncClient) -> str:
    headers = {k: v for k, v in FAKE_HEADERS.items() if k != "Accept"}
    headers["Referer"] = f"{ORIGIN_BASE}/"
    resp = await client.get(f"{ORIGIN_BASE}/api/v1/auths/", headers=headers, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    token = data.get("token")
    if not token:
        raise RuntimeError("anon token empty")
    return token


async def get_auth_token(client: httpx.AsyncClient, cfg: Dict[str, str]) -> str:
    anon_enabled = cfg["ANON_TOKEN_ENABLED"].lower() != "false"
    token = cfg["UPSTREAM_TOKEN"]
    if anon_enabled:
        try:
            token = await get_anonymous_token(client)
            debug_log(cfg, "anonymous token acquired")
        except Exception as exc:
            debug_log(cfg, "anonymous token failed", repr(exc))
            if not token:
                raise RuntimeError("no valid upstream token")
    elif not token:
        raise RuntimeError("UPSTREAM_TOKEN required when anonymous disabled")
    return token


async def fetch_models(client: httpx.AsyncClient, cfg: Dict[str, str]) -> Dict[str, object]:
    try:
        token = await get_auth_token(client, cfg)
    except Exception as exc:
        debug_log(cfg, "model token error", repr(exc))
        return {"object": "list", "data": []}

    headers = {
        **FAKE_HEADERS,
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Referer": f"{ORIGIN_BASE}/",
        "Cookie": f"token={token}",
    }

    try:
        resp = await client.get("https://chat.z.ai/api/models", headers=headers, timeout=30)
        resp.raise_for_status()
        upstream = resp.json()
        transformed = [
            {
                "id": item.get("id"),
                "object": "model",
                "created": item.get("created_at"),
                "owned_by": item.get("owned_by"),
            }
            for item in upstream.get("data", [])
        ]
        return {"object": "list", "data": transformed}
    except Exception as exc:
        debug_log(cfg, "model fetch error", repr(exc))
        return {"object": "list", "data": []}


async def call_upstream(client: httpx.AsyncClient, payload: Dict[str, object], chat_id: str, token: str, cfg: Dict[str, str]) -> httpx.Response:
    body = json.dumps(payload, ensure_ascii=False)
    signature = await generate_signature(body)
    headers = {
        **FAKE_HEADERS,
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "Referer": f"{ORIGIN_BASE}/c/{chat_id}",
        "Cookie": f"token={token}",
        "X-Signature": signature,
    }
    debug_log(cfg, "upstream body", body)
    return await client.post(UPSTREAM_URL, headers=headers, content=body, timeout=None)


def clean_thinking_content(content: str) -> str:
    if not content:
        return ""
    content = content.replace("<summary>", "").replace("</summary>", "")
    content = content.replace("</thinking>", "")
    content = content.replace("<Full>", "").replace("</Full>", "")
    content = content.replace("<details>", "").replace("</details>", "")
    if content.startswith("> "):
        content = content[2:]
    content = content.replace("\n> ", "\n")
    return content.strip()


def clean_answer_content(content: str, mode: str) -> str:
    if not content:
        return ""
    content = content.replace("<summary>", "").replace("</summary>", "")
    content = content.replace("<thinking>", "").replace("</thinking>", "")
    content = content.replace("<Full>", "").replace("</Full>", "")
    content = content.replace("<details type=\"reasoning\">", "")
    content = content.replace("<details>", "").replace("</details>", "")
    content = content.replace("\n> ", "\n")
    if content.startswith("> "):
        content = content[2:]
    content = content.replace("\n\n\n", "\n\n")
    return content.strip()


async def stream_to_openai(upstream: httpx.Response, request_payload: Dict[str, object], cfg: Dict[str, str]) -> AsyncGenerator[bytes, None]:
    buffer = ""
    thinking_sent = False
    mode = cfg["THINK_TAGS_MODE"].lower()
    include_usage = (
        isinstance(request_payload.get("stream_options"), dict)
        and request_payload["stream_options"].get("include_usage") is True
    )
    model_identifier = request_payload.get("model")

    first_chunk = {
        "id": f"chatcmpl-{int(time.time()*1000)}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model_identifier,
        "system_fingerprint": SYSTEM_FINGERPRINT,
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "logprobs": None, "finish_reason": None}],
    }
    yield f"data: {json.dumps(first_chunk, ensure_ascii=False)}\n\n".encode("utf-8")

    async for chunk in upstream.aiter_text():
        buffer += chunk
        lines = buffer.split("\n")
        buffer = lines.pop()
        for line in lines:
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if not data_str:
                continue
            try:
                payload = json.loads(data_str)
            except json.JSONDecodeError:
                debug_log(cfg, "sse parse fail", data_str[:200])
                continue
            data = payload.get("data") or {}
            phase = data.get("phase")
            if phase == "thinking" and mode != "strip":
                delta = data.get("delta_content") or ""
                cleaned = clean_thinking_content(delta)
                if cleaned:
                    sse = {
                        "id": f"chatcmpl-{int(time.time()*1000)}",
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model_identifier,
                        "system_fingerprint": SYSTEM_FINGERPRINT,
                        "choices": [
                            {"index": 0, "delta": {"reasoning_content": cleaned}, "logprobs": None, "finish_reason": None}
                        ],
                    }
                    yield f"data: {json.dumps(sse, ensure_ascii=False)}\n\n".encode("utf-8")
            elif phase == "answer":
                edit = data.get("edit_content") or ""
                delta = data.get("delta_content") or ""
                if edit and not thinking_sent:
                    thinking_sent = True
                    parts = edit.split("</details>")
                    if len(parts) > 1:
                        initial = parts[1].strip()
                        if initial:
                            sse = {
                                "id": f"chatcmpl-{int(time.time()*1000)}",
                                "object": "chat.completion.chunk",
                                "created": int(time.time()),
                                "model": model_identifier,
                                "system_fingerprint": SYSTEM_FINGERPRINT,
                                "choices": [
                                    {"index": 0, "delta": {"content": initial}, "logprobs": None, "finish_reason": None}
                                ],
                            }
                            yield f"data: {json.dumps(sse, ensure_ascii=False)}\n\n".encode("utf-8")
                if delta:
                    sse = {
                        "id": f"chatcmpl-{int(time.time()*1000)}",
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model_identifier,
                        "system_fingerprint": SYSTEM_FINGERPRINT,
                        "choices": [
                            {"index": 0, "delta": {"content": delta}, "logprobs": None, "finish_reason": None}
                        ],
                    }
                    yield f"data: {json.dumps(sse, ensure_ascii=False)}\n\n".encode("utf-8")
            if data.get("done") or phase == "done":
                end_chunk = {
                    "id": f"chatcmpl-{int(time.time()*1000)}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model_identifier,
                    "system_fingerprint": SYSTEM_FINGERPRINT,
                    "choices": [{"index": 0, "delta": {}, "logprobs": None, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(end_chunk, ensure_ascii=False)}\n\n".encode("utf-8")
                if include_usage:
                    usage_chunk = {
                        "id": f"chatcmpl-{int(time.time()*1000)}",
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model_identifier,
                        "system_fingerprint": SYSTEM_FINGERPRINT,
                        "choices": [],
                        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    }
                    yield f"data: {json.dumps(usage_chunk, ensure_ascii=False)}\n\n".encode("utf-8")
                yield b"data: [DONE]\n\n"
                return


async def collect_full_response(upstream: httpx.Response, cfg: Dict[str, str]) -> str:
    buffer = ""
    mode = cfg["THINK_TAGS_MODE"].lower()
    answer = []
    async for chunk in upstream.aiter_text():
        buffer += chunk
        lines = buffer.split("\n")
        buffer = lines.pop()
        for line in lines:
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if not data_str:
                continue
            try:
                payload = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            data = payload.get("data") or {}
            phase = data.get("phase")
            delta = data.get("delta_content") or ""
            if phase == "answer" and delta:
                answer.append(clean_answer_content(delta, mode))
            if data.get("done") or phase == "done":
                return "".join(answer)
    return "".join(answer)


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/")
async def health() -> JSONResponse:
    cfg = get_config()
    payload = {
        "status": "ok",
        "service": "OpenAI to Z.ai Proxy (Python)",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "anon_token_enabled": cfg["ANON_TOKEN_ENABLED"].lower() != "false",
            "upstream_token_configured": bool(cfg["UPSTREAM_TOKEN"]),
            "downstream_key_configured": bool(cfg["DOWNSTREAM_KEY"]),
            "debug_mode": cfg["DEBUG_MODE"].lower() == "true",
        },
    }
    return JSONResponse(payload)


@app.get("/v1/models")
async def models() -> JSONResponse:
    cfg = get_config()
    async with httpx.AsyncClient() as client:
        result = await fetch_models(client, cfg)
        return JSONResponse(result)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Response:
    cfg = get_config()
    auth_header = request.headers.get("authorization", "")
    api_key = auth_header.replace("Bearer ", "")
    if api_key != cfg["DOWNSTREAM_KEY"]:
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    chat_id = f"{int(time.time()*1000)}-{os.urandom(3).hex()}"
    upstream_req = {
        "stream": True,
        "chat_id": chat_id,
        "id": str(int(time.time()*1000)),
        "model": payload.get("model"),
        "messages": [
            {
                "role": "system" if msg.get("role") == "developer" else msg.get("role"),
                "content": msg.get("content"),
            }
            for msg in payload.get("messages", [])
        ],
        "params": {},
        "features": {"enable_thinking": True},
        "background_tasks": {"title_generation": False, "tags_generation": False},
    }

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            token = await get_auth_token(client, cfg)
        except Exception as exc:
            raise HTTPException(status_code=401, detail={"message": str(exc), "type": "authentication_error"})

        upstream_resp = await call_upstream(client, upstream_req, chat_id, token, cfg)
        if upstream_resp.status_code >= 400:
            body = upstream_resp.text[:500]
            raise HTTPException(
                status_code=502,
                detail={
                    "message": f"Upstream API error: {upstream_resp.status_code} {upstream_resp.reason_phrase}",
                    "type": "upstream_error",
                    "code": upstream_resp.status_code,
                    "details": body,
                },
            )

        if payload.get("stream"):
            generator = stream_to_openai(upstream_resp, payload, cfg)
            return StreamingResponse(generator, media_type="text/event-stream")

        content = await collect_full_response(upstream_resp, cfg)
        response_payload = {
            "id": f"chatcmpl-{int(time.time()*1000)}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": payload.get("model"),
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content,
                        "refusal": None,
                        "annotations": [],
                    },
                    "logprobs": None,
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "prompt_tokens_details": {"cached_tokens": 0, "audio_tokens": 0},
                "completion_tokens_details": {
                    "reasoning_tokens": 0,
                    "audio_tokens": 0,
                    "accepted_prediction_tokens": 0,
                    "rejected_prediction_tokens": 0,
                },
            },
            "service_tier": "default",
            "system_fingerprint": SYSTEM_FINGERPRINT,
        }
        return JSONResponse(response_payload)


__all__ = ["app"]
