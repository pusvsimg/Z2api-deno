/**
 * Cloudflare Workers: OpenAI to Z.ai Proxy
 *
 * 这是适配 Cloudflare Workers 平台的代理服务。
 * 它整合了所有功能：严格的 OpenAI 格式匹配和动态模型列表获取。
 *
 * 如何部署:
 * 1. 在 Cloudflare Dashboard 中创建一个新的 Worker
 * 2. 将此代码粘贴到 Worker 编辑器中
 * 3. 在 Worker 设置中配置环境变量（Settings -> Variables）:
 *    DOWNSTREAM_KEY="sk-your-key"              (必需)
 *    UPSTREAM_TOKEN="your-upstream-token"      (可选，如果启用匿名token可留空)
 *    ANON_TOKEN_ENABLED="true"                 (可选，默认true)
 *    THINK_TAGS_MODE="show"                    (可选，可选值: strip/show)
 *      - strip: 完全不显示思考内容（默认）
 *      - show: 显示思考内容（使用 reasoning_content 字段，Cherry Studio 等客户端原生支持）
 *    DEBUG_MODE="false"                        (可选，默认false)
 * 
 * 注意：思考内容通过 reasoning_content 字段发送，客户端会自动特殊渲染（类似 OpenAI o1 模型）
 *
 */

// ================= Configuration ==================
const UPSTREAM_URL = "https://chat.z.ai/api/chat/completions";
const ORIGIN_BASE = "https://chat.z.ai";
const SYSTEM_FINGERPRINT = "fp_generated_by_proxy_cf"; // 静态系统指纹

// 伪装的前端头部信息（2025-09-30 更新至最新版本）
// 注意：X-Signature 是动态生成的签名字段，需要在每次请求时单独处理
const FAKE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "zh-CN",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "X-FE-Version": "prod-fe-1.0.94",
  "Origin": ORIGIN_BASE,
};

// ================= Helper Functions ==================

function debugLog(env, ...args) {
  const DEBUG_MODE = env.DEBUG_MODE === 'true';
  if (DEBUG_MODE) {
    console.log("[DEBUG]", ...args);
  }
}

/**
 * 生成 X-Signature 请求签名
 * Z.ai 使用这个签名来验证请求的有效性
 * @param {string} body - 请求体（JSON 字符串）
 * @returns {Promise<string>} - SHA-256 哈希值（十六进制）
 */
async function generateSignature(body) {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

function handleCors() {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  return new Response(null, { status: 204, headers });
}

function applyCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

// ================= Token Management ==================

async function getAnonymousToken() {
  const reqHeaders = { ...FAKE_HEADERS };
  delete reqHeaders.Accept;
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

async function getAuthToken(env) {
  const ANON_TOKEN_ENABLED = env.ANON_TOKEN_ENABLED !== 'false'; // 默认启用
  let authToken = env.UPSTREAM_TOKEN || "";
  
  if (ANON_TOKEN_ENABLED) {
    try {
      const anonToken = await getAnonymousToken();
      authToken = anonToken;
      debugLog(env, "匿名 token 获取成功");
    } catch (err) {
      debugLog(env, "匿名 token 获取失败，回退固定 token:", err.message);
      // 如果匿名token失败且没有备用token，抛出错误
      if (!authToken) {
        throw new Error("无法获取认证 token：匿名 token 获取失败，且未配置 UPSTREAM_TOKEN");
      }
    }
  } else if (!authToken) {
    throw new Error("未配置 UPSTREAM_TOKEN 且匿名 token 已禁用");
  }
  
  return authToken;
}

// ================= API Handlers ==================

async function handleModels(request, env) {
  let authToken;
  try {
    authToken = await getAuthToken(env);
  } catch (err) {
    debugLog(env, "Token 获取失败 (models):", err.message);
    // 对于 models 端点，返回空列表而不是错误
    const responseData = {
      object: "list",
      data: [],
    };
    const response = new Response(JSON.stringify(responseData), {
      headers: { "Content-Type": "application/json" },
    });
    return applyCors(response);
  }

  const headers = {
    ...FAKE_HEADERS,
    "Accept": "application/json",
    "Authorization": `Bearer ${authToken}`,
    "Referer": `${ORIGIN_BASE}/`,
    "Cookie": `token=${authToken}`,
  };

  let responseData;
  try {
    debugLog(env, "正在从上游获取模型列表:", 'https://chat.z.ai/api/models');
    const upstreamResponse = await fetch('https://chat.z.ai/api/models', { headers });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      debugLog(env, `上游 models API 返回错误: ${upstreamResponse.status}`, errorBody);
      throw new Error(`上游 models API 返回状态 ${upstreamResponse.status}`);
    }

    const upstreamJson = await upstreamResponse.json();

    // 将上游响应转换为 OpenAI 格式
    const transformedModels = upstreamJson.data.map((model) => ({
      id: model.id,
      object: "model",
      created: model.created_at,
      owned_by: model.owned_by,
    }));

    responseData = {
      object: "list",
      data: transformedModels,
    };

  } catch (error) {
    debugLog(env, "获取或处理上游模型列表失败:", error);
    // 返回空列表作为备用方案
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

async function handleChatCompletions(request, env) {
  debugLog(env, "收到 chat completions 请求");

  // 验证下游 API Key
  const authHeader = request.headers.get("Authorization") || "";
  const apiKey = authHeader.replace("Bearer ", "");
  const DOWNSTREAM_KEY = env.DOWNSTREAM_KEY || "";

  if (apiKey !== DOWNSTREAM_KEY) {
    debugLog(env, "无效的 API key:", apiKey);
    return applyCors(new Response("Invalid API key", { status: 401 }));
  }
  debugLog(env, "API key 验证通过");

  // 解析请求体
  let openaiReq;
  try {
    openaiReq = await request.json();
  } catch (e) {
    debugLog(env, "JSON 解析失败:", e);
    return applyCors(new Response("Invalid JSON", { status: 400 }));
  }
  debugLog(env, `请求解析成功 - 模型: ${openaiReq.model}, 流式: ${openaiReq.stream}`);

  // 构建上游请求
  const chatID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const upstreamReq = {
    stream: true, // 总是从上游以流式获取，便于统一处理
    chat_id: chatID,
    id: `${Date.now()}`,
    model: openaiReq.model,
    messages: openaiReq.messages.map((msg) => ({
      role: msg.role === 'developer' ? 'system' : msg.role,
      content: msg.content
    })),
    params: {},
    features: { enable_thinking: true },
    background_tasks: { title_generation: false, tags_generation: false },
  };

  // 获取认证 token
  let authToken;
  try {
    authToken = await getAuthToken(env);
  } catch (err) {
    debugLog(env, "Token 获取失败:", err.message);
    const errorResponse = {
      error: {
        message: err.message,
        type: "authentication_error",
        code: "no_valid_token"
      }
    };
    return applyCors(new Response(JSON.stringify(errorResponse), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));
  }

  // 调用上游 API
  const upstreamResponse = await callUpstream(upstreamReq, chatID, authToken, env);

  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    debugLog(env, `上游错误: ${upstreamResponse.status}`, errorBody);
    
    // 返回更详细的错误信息
    const errorResponse = {
      error: {
        message: `Upstream API error: ${upstreamResponse.status} ${upstreamResponse.statusText}`,
        type: "upstream_error",
        code: upstreamResponse.status,
        details: errorBody.substring(0, 500) // 限制长度避免泄露过多信息
      }
    };
    return applyCors(new Response(JSON.stringify(errorResponse), { 
      status: 502,
      headers: { "Content-Type": "application/json" }
    }));
  }

  // 根据客户端需求返回流式或非流式响应
  if (openaiReq.stream) {
    const stream = processUpstreamStream(upstreamResponse.body, openaiReq, env);
    const response = new Response(stream, {
      headers: { 
        "Content-Type": "text/event-stream", 
        "Cache-Control": "no-cache", 
        "Connection": "keep-alive" 
      }
    });
    return applyCors(response);
  } else {
    const fullContent = await collectFullResponse(upstreamResponse.body, env);
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
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
        completion_tokens_details: { 
          reasoning_tokens: 0, 
          audio_tokens: 0, 
          accepted_prediction_tokens: 0, 
          rejected_prediction_tokens: 0 
        }
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

async function callUpstream(upstreamReq, refererChatID, authToken, env) {
  const reqBody = JSON.stringify(upstreamReq);
  debugLog(env, "上游请求体:", reqBody);

  // 生成 X-Signature（基于请求体的 SHA-256 哈希）
  const signature = await generateSignature(reqBody);
  debugLog(env, "生成签名:", signature);

  const headers = {
    ...FAKE_HEADERS,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
    "Referer": `${ORIGIN_BASE}/c/${refererChatID}`,
    "Cookie": `token=${authToken}`,
    "X-Signature": signature, // 添加签名头
  };

  return fetch(UPSTREAM_URL, { method: "POST", headers, body: reqBody });
}

// ================= Stream Processing ==================

function processUpstreamStream(upstreamBody, openaiReq, env) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  const includeUsage = openaiReq.stream_options && openaiReq.stream_options.include_usage === true;
  
  // 累积思考内容
  let thinkingContent = '';
  let thinkingStarted = false;

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
        try {
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
                choices: [],
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
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.substring(6);
            if (!dataStr) continue;

            try {
              const upstreamData = JSON.parse(dataStr);
              if (upstreamData.error || (upstreamData.data && upstreamData.data.error)) {
                debugLog(env, "上游错误:", upstreamData.error || upstreamData.data.error);
                continue;
              }

              // 处理 delta_content 或 edit_content
              if (upstreamData.data) {
                const phase = upstreamData.data.phase;
                const mode = env.THINK_TAGS_MODE || "strip";
                
                // thinking 阶段：使用 reasoning_content 字段流式发送
                if (phase === "thinking") {
                  const deltaContent = upstreamData.data.delta_content || "";
                  
                  if (deltaContent && mode !== "strip") {
                    // 清理思考内容中的标签和引用符号
                    let processedContent = cleanThinkingContent(deltaContent);
                    
                    debugLog(env, `[Thinking] 原始: ${deltaContent.substring(0, 50)}... -> 处理后: ${processedContent.substring(0, 50)}...`);
                    
                    // 只要内容不为空就发送
                    if (processedContent !== "") {
                      const chunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: modelIdentifier,
                        system_fingerprint: SYSTEM_FINGERPRINT,
                        choices: [{ 
                          index: 0, 
                          delta: { reasoning_content: processedContent },
                          logprobs: null, 
                          finish_reason: null 
                        }],
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                      debugLog(env, `[Thinking] 已发送 chunk，长度: ${processedContent.length}`);
                    } else {
                      debugLog(env, `[Thinking] 内容为空，跳过发送`);
                    }
                  }
                }
                // answer 阶段：只处理 delta_content（参考 Go 版本）
                else if (phase === "answer") {
                  const deltaContent = upstreamData.data.delta_content || "";
                  const editContent = upstreamData.data.edit_content || "";
                  
                  // 处理初始的 edit_content（只处理一次，提取答案开头）
                  if (!thinkingStarted && editContent) {
                    thinkingStarted = true;
                    debugLog(env, `[Answer] 处理 edit_content，长度: ${editContent.length}`);
                    
                    // 使用正则提取 </details> 后的内容
                    const parts = editContent.split(/<\/details>/);
                    if (parts.length > 1) {
                      const initialAnswer = parts[1].trim();
                      if (initialAnswer) {
                        debugLog(env, `[Answer] 发送初始答案: ${initialAnswer.substring(0, 50)}...`);
                        const chunk = {
                          id: `chatcmpl-${Date.now()}`,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelIdentifier,
                          system_fingerprint: SYSTEM_FINGERPRINT,
                          choices: [{ index: 0, delta: { content: initialAnswer }, logprobs: null, finish_reason: null }],
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                      }
                    }
                  }
                  
                  // 处理后续的 delta_content（直接发送）
                  if (deltaContent) {
                    debugLog(env, `[Answer] 发送 delta: ${deltaContent}`);
                    const chunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: modelIdentifier,
                      system_fingerprint: SYSTEM_FINGERPRINT,
                      choices: [{ index: 0, delta: { content: deltaContent }, logprobs: null, finish_reason: null }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }
              }

              if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === "done")) {
                continue;
              }
            } catch (e) {
              debugLog(env, "SSE 数据解析失败:", dataStr, e);
            }
          }
          return pump();
        } catch (error) {
          debugLog(env, "流处理错误:", error);
          controller.error(error);
        }
      }
      await pump();
    },
  });
}

async function collectFullResponse(upstreamBody, env) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let thinkingContent = '';
  let answerContent = '';
  const mode = env.THINK_TAGS_MODE || "strip";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.substring(6);
      if (!dataStr) continue;

      try {
        const upstreamData = JSON.parse(dataStr);
        if (upstreamData.data) {
          const phase = upstreamData.data.phase;
          const deltaContent = upstreamData.data.delta_content || "";
          
          // thinking 阶段：累积思考内容
          if (phase === "thinking") {
            if (deltaContent && mode !== "strip") {
              const cleaned = cleanThinkingContent(deltaContent);
              if (cleaned) {
                thinkingContent += cleaned;
              }
            }
          }
          // answer 阶段：累积答案内容
          else if (phase === "answer") {
            if (deltaContent) {
              const cleaned = cleanAnswerContent(deltaContent, env);
              if (cleaned) {
                answerContent += cleaned;
              }
            }
          }
        }
        
        if (upstreamData.data && (upstreamData.data.done || upstreamData.data.phase === "done")) {
          try { await reader.cancel(); } catch {}
          // 对于非流式响应，只返回答案内容（思考内容在流式中通过 reasoning_content 字段发送）
          return answerContent;
        }
      } catch (e) {
        debugLog(env, "非流式响应解析错误", e);
      }
    }
  }
  
  // 对于非流式响应，只返回答案内容
  return answerContent;
}

// 清理思考内容（参考 Go 版本的 transformThinking）
function cleanThinkingContent(content) {
  if (!content) return "";
  
  // 移除 <summary>...</summary>
  content = content.replace(/<summary>.*?<\/summary>/gs, "");
  
  // 清理残留标签
  content = content.replace(/<\/thinking>/g, "");
  content = content.replace(/<Full>/g, "");
  content = content.replace(/<\/Full>/g, "");
  content = content.replace(/<details[^>]*>/g, "");
  content = content.replace(/<\/details>/g, "");
  
  // 处理引用符号（按 Go 版本逻辑）
  // 先处理开头的 "> "
  if (content.startsWith("> ")) {
    content = content.substring(2);
  }
  // 再处理换行后的 "> "
  content = content.replace(/\n> /g, "\n");
  
  // 最后 trim 移除前后空白（与 Go 版本一致）
  return content.trim();
}

function cleanAnswerContent(s, env) {
  if (!s) return "";
  
  const mode = env.THINK_TAGS_MODE || "strip";
  
  // 移除完整的 details 块（包含 reasoning）
  s = s.replace(/<details[^>]*type="reasoning"[^>]*>.*?<\/details>\s*/gs, "");
  s = s.replace(/<details[^>]*>.*?<\/details>\s*/gs, "");
  
  // 移除其他思考标签
  s = s.replace(/<summary>.*?<\/summary>/gs, "");
  s = s.replace(/<thinking>.*?<\/thinking>/gs, "");
  s = s.replace(/<\/thinking>|<Full>|<\/Full>/g, "");
  
  // 移除引用符号（thinking 阶段的残留）
  s = s.replace(/^> .*$/gm, "");
  
  // 清理多余的空行和首尾空白
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  
  return s;
}

// ================= Main Request Handler ==================

async function handleRequest(request, env) {
  const url = new URL(request.url);
  
  if (request.method === "OPTIONS") {
    return handleCors();
  }

  if (url.pathname === "/v1/models") {
    return handleModels(request, env);
  }
  
  if (url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(request, env);
  }

  // 添加健康检查和诊断端点
  if (url.pathname === "/health" || url.pathname === "/") {
    const health = {
      status: "ok",
      service: "OpenAI to Z.ai Proxy (Cloudflare Workers)",
      timestamp: new Date().toISOString(),
      config: {
        anon_token_enabled: env.ANON_TOKEN_ENABLED !== 'false',
        upstream_token_configured: !!(env.UPSTREAM_TOKEN && env.UPSTREAM_TOKEN.length > 0),
        downstream_key_configured: !!(env.DOWNSTREAM_KEY && env.DOWNSTREAM_KEY.length > 0),
        debug_mode: env.DEBUG_MODE === 'true'
      }
    };
    return applyCors(new Response(JSON.stringify(health, null, 2), {
      headers: { "Content-Type": "application/json" }
    }));
  }

  return new Response("Not Found", { status: 404 });
}

// ================= Cloudflare Workers Entry Point ==================

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("处理请求时发生错误:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};


