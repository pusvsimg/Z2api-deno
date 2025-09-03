/**
 * Deno: OpenAI to Z.ai Proxy
 *
 * 这是从 Cloudflare Worker 版本转换而来的 Deno 脚本。
 * 它整合了所有功能：严格的 OpenAI 格式匹配和动态模型列表获取。
 *
 * 如何运行:
 * 1. (可选) 创建一个 `.env` 文件来管理你的密钥:
 *    DOWNSTREAM_KEY="sk-your-key"
 *    UPSTREAM_TOKEN="your-upstream-token-here"
 *    ANON_TOKEN_ENABLED="true"
 *    THINK_TAGS_MODE="strip"
 *    PORT="8000"
 *
 * 2. 运行脚本 (需要 Deno v1.33+):
 *    deno run --allow-net --allow-env deno_proxy.ts
 *
 *    如果你使用了 .env 文件, Deno 会自动加载它。
 *    或者，你可以通过命令行设置环境变量:
 *    PORT=8080 DOWNSTREAM_KEY="sk-123" deno run --allow-net --allow-env deno_proxy.ts
 */

// ================= Configuration ==================
// 建议使用环境变量来设置这些值。脚本会优先使用环境变量。

// 上游 Z.ai API 地址
const UPSTREAM_URL = "https://chat.z.ai/api/chat/completions";
// 下游客户端鉴权的 key (环境变量: DOWNSTREAM_KEY)
const DOWNSTREAM_KEY =  "123456";
// 上游 API 的备用 token (环境变量: UPSTREAM_TOKEN)
const UPSTREAM_TOKEN =  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjA2ODkwYTFlLTlhNGMtNDgxYS05ZDUxLWJhNjg0ZjZhMjg5ZiIsImVtYWlsIjoiR3Vlc3QtMTc1NjQxNjAxNjAzOEBndWVzdC5jb20ifQ.Pcy5W9cmaRdUrojk79CWQdrj4c03tdBzEmV9BH5rQKwFvKRG0BkBBxmqE5GgwLGBde3Y26FVVfV1A7UtrBSFGQ";
// 是否开启调试模式
const DEBUG_MODE =  false;
// 思考内容处理策略: "strip" | "think" | "raw" (环境变量: THINK_TAGS_MODE)
const THINK_TAGS_MODE =  "strip";
// 是否启用匿名 token (环境变量: ANON_TOKEN_ENABLED)
const ANON_TOKEN_ENABLED_STR = "true";
const ANON_TOKEN_ENABLED = ANON_TOKEN_ENABLED_STR !== undefined ? ANON_TOKEN_ENABLED_STR === 'true' : true;
// ================================================

const ORIGIN_BASE = "https://chat.z.ai";
const SYSTEM_FINGERPRINT = "fp_generated_by_proxy_deno"; // 静态系统指纹

// 伪装的前端头部信息
const FAKE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  "Accept": "application/json, text/event-stream",
  "Accept-Language": "zh-CN, en-US",
  "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Microsoft Edge\";v=\"139\", \"Chromium\";v=\"139\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "X-FE-Version": "prod-fe-1.0.70",
  "Origin": ORIGIN_BASE,
};

function debugLog(...args: any[]) {
  if (DEBUG_MODE) {
    console.log("[DEBUG]", ...args);
  }
}

/**
 * 主请求处理器
 * @param request Deno serve 传入的请求对象
 * @returns Response 对象
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return handleCors();

  if (url.pathname === "/v1/models") {
    return handleModels(request);
  }
  if (url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(request);
  }

  return new Response("Not Found", { status: 404 });
}

function handleCors(): Response {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  return new Response(null, { status: 204, headers });
}

function applyCors(response: Response): Response {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return response;
}

async function handleModels(_request: Request): Promise<Response> {
  // Deno: 从全局配置或环境变量获取 token
  let authToken = UPSTREAM_TOKEN;
  if (ANON_TOKEN_ENABLED) {
    try {
      const anonToken = await getAnonymousToken();
      authToken = anonToken;
      debugLog("匿名 token 获取成功 (for models)");
    } catch (err) {
      debugLog("匿名 token 获取失败 (for models)，回退固定 token:", err.message);
    }
  }

  const headers = {
    ...FAKE_HEADERS,
    "Accept": "application/json", // FIX: 为此端点使用正确的 Accept 头
    "Authorization": `Bearer ${authToken}`,
    "Referer": `${ORIGIN_BASE}/`,
    "Cookie": `token=${authToken}`,
  };

  let responseData;
  try {
    debugLog("正在从上游获取模型列表:", 'https://chat.z.ai/api/models');
    const upstreamResponse = await fetch('https://chat.z.ai/api/models', { headers });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      debugLog(`上游 models API 返回错误: ${upstreamResponse.status}`, errorBody);
      throw new Error(`上游 models API 返回状态 ${upstreamResponse.status}`);
    }

    const upstreamJson = await upstreamResponse.json();

    // 将上游响应转换为 OpenAI 格式
    const transformedModels = upstreamJson.data.map((model: any) => ({
      id: model.id,
      object: "model",
      created: model.created_at, // 使用源数据中的 'created_at' 时间戳
      owned_by: model.owned_by,
    }));

    responseData = {
      object: "list",
      data: transformedModels,
    };

  } catch (error) {
    debugLog("获取或处理上游模型列表失败:", error);
    // 返回一个空列表作为备用方案，以避免客户端错误
    responseData = {
      object: "list",
      data: [],
    };
  }

  const response = new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json" },
  });
  return applyCors(response);
}


async function handleChatCompletions(request: Request): Promise<Response> {
  debugLog("收到 chat completions 请求");

  const authHeader = request.headers.get("Authorization") || "";
  const apiKey = authHeader.replace("Bearer ", "");

  // Deno: 从全局配置或环境变量获取 key
  if (apiKey !== DOWNSTREAM_KEY) {
    debugLog("无效的 API key:", apiKey);
    return applyCors(new Response("Invalid API key", { status: 401 }));
  }
  debugLog("API key 验证通过");

  let openaiReq: any;
  try {
    openaiReq = await request.json();
  } catch (e) {
    debugLog("JSON 解析失败:", e);
    return applyCors(new Response("Invalid JSON", { status: 400 }));
  }
  debugLog(`请求解析成功 - 模型: ${openaiReq.model}, 流式: ${openaiReq.stream}`);

  const chatID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const upstreamReq = {
    stream: true, // 总是从上游以流式获取，便于统一处理
    chat_id: chatID,
    id: `${Date.now()}`,
    model: openaiReq.model, // 直接使用客户端指定的模型ID
    messages: openaiReq.messages.map((msg: any) => ({
      role: msg.role === 'developer' ? 'system' : msg.role, // 角色规范化
      content: msg.content
    })),
    params: {},
    features: { enable_thinking: true },
    background_tasks: { title_generation: false, tags_generation: false },
  };

  // Deno: 从全局配置或环境变量获取 token
  let authToken = UPSTREAM_TOKEN;
  if (ANON_TOKEN_ENABLED) {
    try {
      const anonToken = await getAnonymousToken();
      authToken = anonToken;
      debugLog("匿名 token 获取成功");
    } catch (err) {
      debugLog("匿名 token 获取失败，回退固定 token:", err.message);
    }
  }

  const upstreamResponse = await callUpstream(upstreamReq, chatID, authToken);

  if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      debugLog(`上游错误: ${upstreamResponse.status}`, errorBody);
      return applyCors(new Response("Upstream error", { status: 502 }));
  }

  if (openaiReq.stream) {
    const stream = processUpstreamStream(upstreamResponse.body!, openaiReq);
    const response = new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
    });
    return applyCors(response);
  } else {
    const fullContent = await collectFullResponse(upstreamResponse.body!);
    // 构造严格匹配的非流式响应
    const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: openaiReq.model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: fullContent,
                refusal: null,
                annotations: [],
            },
            logprobs: null,
            finish_reason: "stop",
        }],
        usage: { // 填充 usage 结构
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 }
        },
        service_tier: "default",
        system_fingerprint: SYSTEM_FINGERPRINT,
    };
    const response = new Response(JSON.stringify(openaiResponse), {
        headers: { 'Content-Type': 'application/json' }
    });
    return applyCors(response);
  }
}

async function getAnonymousToken(): Promise<string> {
  const reqHeaders: Record<string, string> = { ...FAKE_HEADERS };
  delete reqHeaders.Accept; // getAnonymousToken 不需要指定 Accept
  reqHeaders.Referer = ORIGIN_BASE + "/";

  const response = await fetch(`${ORIGIN_BASE}/api/v1/auths/`, {
    method: "GET",
    headers: reqHeaders,
  });

  if (!response.ok) throw new Error(`anon token status=${response.status}`);
  const data = await response.json();
  if (!data.token) throw new Error("anon token empty");
  return data.token;
}

async function callUpstream(upstreamReq: any, refererChatID: string, authToken: string): Promise<Response> {
  const reqBody = JSON.stringify(upstreamReq);
  debugLog("上游请求体:", reqBody);

  const headers = {
    ...FAKE_HEADERS,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
    "Referer": `${ORIGIN_BASE}/c/${refererChatID}`,
    "Cookie": `token=${authToken}`,
  };

  return fetch(UPSTREAM_URL, { method: "POST", headers, body: reqBody });
}

function processUpstreamStream(upstreamBody: ReadableStream<Uint8Array>, openaiReq: any): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  const includeUsage = openaiReq.stream_options && openaiReq.stream_options.include_usage === true;

  return new ReadableStream({
    async start(controller) {
      const modelIdentifier = openaiReq.model;

      // 第一个 chunk
      const firstChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelIdentifier,
        system_fingerprint: SYSTEM_FINGERPRINT,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(firstChunk)}\n\n`));

      const reader = upstreamBody.getReader();

      async function pump() {
        const { done, value } = await reader.read();
        if (done) {
          // 流结束
          const endChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelIdentifier,
            system_fingerprint: SYSTEM_FINGERPRINT,
            choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));

          if (includeUsage) {
            const usageChunk = {
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelIdentifier,
              system_fingerprint: SYSTEM_FINGERPRINT,
              choices: [], // Usage chunk has empty choices
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.substring(6);
          if (!dataStr) continue;

          try {
            const upstreamData = JSON.parse(dataStr);
            if (upstreamData.error || (upstreamData.data && upstreamData.data.error)) {
              debugLog("上游错误:", upstreamData.error || upstreamData.data.error);
              continue; // 忽略错误块
            }

            if (upstreamData.data && upstreamData.data.delta_content) {
              let out = upstreamData.data.delta_content;
              if (upstreamData.data.phase === "thinking") {
                out = transformThinking(out);
              }
              if (out) {
                const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelIdentifier,
                    system_fingerprint: SYSTEM_FINGERPRINT,
                    choices: [{ index: 0, delta: { content: out }, logprobs: null, finish_reason: null }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            }

            if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === "done")) {
              // 上游已完成，但我们等待reader.read()的done信号来发送最终块
              // 这样可以确保所有缓冲的数据都已处理
              continue;
            }
          } catch (e) {
            debugLog("SSE 数据解析失败:", dataStr, e);
          }
        }
        return pump();
      }
      await pump();
    },
  });
}

async function collectFullResponse(upstreamBody: ReadableStream<Uint8Array>): Promise<string> {
    const reader = upstreamBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.substring(6);
            if (!dataStr) continue;

            try {
                const upstreamData = JSON.parse(dataStr);
                if (upstreamData.data && upstreamData.data.delta_content) {
                    let out = upstreamData.data.delta_content;
                    if (upstreamData.data.phase === "thinking") {
                        out = transformThinking(out);
                    }
                    if (out) fullContent += out;
                }
                if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === "done")) {
                    // deno-lint-ignore no-empty
                    try { await reader.cancel(); } catch {}
                    return fullContent;
                }
            } catch (e) {
                debugLog("非流式响应解析错误", e);
            }
        }
    }
    return fullContent;
}

function transformThinking(s: string): string {
    if (!s) return "";
    s = s.replace(/<summary>.*?<\/summary>/gs, "");
    s = s.replace(/<\/thinking>|<Full>|<\/Full>/g, "");
    s = s.trim();

    // Deno: 从全局配置获取模式
    const mode = THINK_TAGS_MODE;
    switch (mode) {
        case "think":
            s = s.replace(/<details[^>]*>/g, "<think>").replace(/<\/details>/g, "</think>");
            break;
        case "strip":
            s = s.replace(/<details[^>]*>/g, "").replace(/<\/details>/g, "");
            break;
    }

    if (s.startsWith("> ")) s = s.substring(2);
    s = s.replace(/\n> /g, "\n");
    return s.trim();
}

// ================= Deno Entry Point ==================
// Deno: 使用 Deno.serve() 启动服务器。Deno Deploy 会自动处理端口。
console.log(`OpenAI to Z.ai Proxy (Deno Version)`);
console.log(`Downstream KEY: ${DOWNSTREAM_KEY.slice(0, 5)}...`);
console.log(`Upstream Token: ${UPSTREAM_TOKEN.length > 0 ? `${UPSTREAM_TOKEN.slice(0,5)}...` : 'N/A'}`);
console.log(`Anonymous Token: ${ANON_TOKEN_ENABLED ? 'Enabled' : 'Disabled'}`);
console.log(`Debug Mode: ${DEBUG_MODE ? 'Enabled' : 'Disabled'}`);
console.log(`Starting server for Deno Deploy...`);

Deno.serve(handleRequest);
