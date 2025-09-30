# Z2API: OpenAI to Z.ai 代理服务

> [!CAUTION]
> **免责声明**
>
> **本项目仅供学习和技术研究使用，不保证其合法性、安全性、准确性和有效性。**
>
> **请勿在任何生产环境中使用。对于使用本项目所造成的任何直接或间接损失，项目作者不承担任何责任。**
>
> **所有通过本代理服务的请求和响应内容均由上游服务提供，本项目不存储、不修改、不审查任何传输的数据。**
>
> **请在遵守相关法律法规的前提下使用本项目。任何非法使用均与项目作者无关。**

这是一个轻量级代理服务，将 [Z.ai](https://chat.z.ai/) 的 API 转换为与 OpenAI API 完全兼容的格式。支持任何 OpenAI 客户端无缝对接 Z.ai 的模型服务。

**提供两个版本：**
- 🦕 **Deno 版本** (`index.ts`) - 适合 Deno Deploy 部署
- ⚡ **Cloudflare Workers 版本** (`worker.js`) - 适合 Cloudflare Workers 部署

---

## 📑 目录

- [功能特性](#-功能特性)
- [快速部署](#-快速部署)
  - [Cloudflare Workers 部署](#cloudflare-workers-部署推荐)
  - [Deno Deploy 部署](#deno-deploy-部署)
- [环境变量配置](#️-环境变量配置)
- [思考内容展示](#-思考内容展示)
- [客户端使用示例](#-客户端使用示例)
- [本地开发](#-本地开发)
- [故障排查](#-故障排查)
- [更新日志](#-更新日志)

---

## ✨ 功能特性

- ✅ **OpenAI 完全兼容**: 支持 `/v1/chat/completions` 和 `/v1/models` 接口
- ✅ **思考内容支持**: 使用 `reasoning_content` 字段（OpenAI o1 标准），Cherry Studio 原生渲染
- ✅ **流式 + 非流式**: 同时支持两种响应模式
- ✅ **动态模型列表**: 自动从上游获取最新可用模型
- ✅ **匿名 Token**: 智能获取临时 Token，避免频率限制
- ✅ **CORS 支持**: 允许任何前端应用直接调用
- ✅ **环境变量配置**: 灵活的配置管理
- ✅ **调试模式**: 详细日志追踪

---

## 🚀 快速部署

### Cloudflare Workers 部署（推荐）

#### 前置要求
- Node.js 16+ 或 npm
- Cloudflare 账号（免费）

#### 部署步骤

**1. 安装 Wrangler**
```bash
npm install -g wrangler
```

**2. 登录 Cloudflare**
```bash
wrangler login
```
浏览器会打开，登录您的 Cloudflare 账号

**3. 克隆项目**
```bash
git clone https://github.com/your-repo/Z2api-deno.git
cd Z2api-deno
```

**4. 配置 Secrets**
```bash
# 必需：客户端认证密钥
wrangler secret put DOWNSTREAM_KEY
# 输入: sk-your-secure-key-123

# 可选：Z.ai 备用 token
wrangler secret put UPSTREAM_TOKEN
# 输入: 您的 Z.ai token（可留空，会自动获取匿名 token）
```

**5. 配置环境变量**

编辑 `wrangler.toml`：
```toml
[vars]
ANON_TOKEN_ENABLED = "true"   # 启用匿名 token
THINK_TAGS_MODE = "show"      # show=显示思考内容 / strip=不显示
DEBUG_MODE = "false"          # 生产环境关闭调试
```

**6. 部署**
```bash
wrangler deploy
```

成功后显示：
```
✨ Published openai-to-zai-proxy
   https://openai-to-zai-proxy.your-subdomain.workers.dev
```

**7. 测试**
```bash
curl https://openai-to-zai-proxy.your-subdomain.workers.dev/health
```

#### 自定义域名

**添加域名**：
1. Worker 设置 → Triggers → Add Custom Domain
2. 输入域名：`api.yourdomain.com`
3. 按照提示配置 DNS

---

### Deno Deploy 部署

[![Deploy with Deno](https://deno.com/deno-deploy-button.svg)](https://dash.deno.com/new?url=https://raw.githubusercontent.com/james-6-23/Z2api-deno/main/index.ts)

部署后在 Settings → Environment Variables 配置：
```
DOWNSTREAM_KEY = sk-your-key-123
THINK_TAGS_MODE = show
ANON_TOKEN_ENABLED = true
DEBUG_MODE = false
```

---

## ⚙️ 环境变量配置

### 配置项说明

| 变量名 | 必需 | 说明 | 默认值 |
|--------|:----:|------|--------|
| `DOWNSTREAM_KEY` | ✅ | 客户端 API Key（格式：`sk-xxx`） | - |
| `UPSTREAM_TOKEN` | ❌ | Z.ai 备用 Token | - |
| `ANON_TOKEN_ENABLED` | ❌ | 启用匿名 Token | `true` |
| `THINK_TAGS_MODE` | ❌ | 思考内容模式：`strip`(不显示) / `show`(显示) | `strip` |
| `DEBUG_MODE` | ❌ | 调试模式 | `false` |

### 配置方式

**Cloudflare Workers**:
```bash
# Secrets（加密变量）
wrangler secret put DOWNSTREAM_KEY
wrangler secret put UPSTREAM_TOKEN

# Environment Variables（公开变量，在 wrangler.toml 中）
[vars]
ANON_TOKEN_ENABLED = "true"
THINK_TAGS_MODE = "show"
DEBUG_MODE = "false"
```

**Deno Deploy**:
在 Dashboard → Settings → Environment Variables 中配置

---

## 💭 思考内容展示

本代理服务支持 GLM-4 等模型的思考过程展示（类似 OpenAI o1）。

### 配置方式

```bash
# 显示思考内容（推荐 Cherry Studio 用户）
THINK_TAGS_MODE=show

# 不显示思考内容（默认）
THINK_TAGS_MODE=strip
```

### 技术实现

使用标准 `reasoning_content` 字段传输思考内容：

```json
// thinking 阶段
{
  "choices": [{
    "delta": {"reasoning_content": "分析用户输入..."}
  }]
}

// answer 阶段
{
  "choices": [{
    "delta": {"content": "你好！很高兴见到你..."}
  }]
}
```

### Cherry Studio 渲染效果

使用 `show` 模式时：
- ✅ 自动渲染为思考框
- ✅ 实时流式展开（打字机效果）
- ✅ 可折叠/展开
- ✅ 与答案内容清晰分离

---

## 📱 客户端使用示例

### Cherry Studio

1. **添加服务商**: 选择 "OpenAI"
2. **API 地址**: `https://your-worker.workers.dev`
3. **API Key**: `sk-your-key-123`
4. **启用思考**: 设置 `THINK_TAGS_MODE=show`

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-key-123",
    base_url="https://your-worker.workers.dev/v1"
)

# 流式请求
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

for chunk in stream:
    delta = chunk.choices[0].delta
    
    # 思考内容（如果启用 show 模式）
    if hasattr(delta, 'reasoning_content'):
        print(f"💭 {delta.reasoning_content}", end='')
    
    # 答案内容
    if delta.content:
        print(delta.content, end='')
```

### Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk-your-key-123',
  baseURL: 'https://your-worker.workers.dev/v1'
});

const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: '你好' }],
  stream: true
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.reasoning_content) console.log('💭', delta.reasoning_content);
  if (delta?.content) console.log(delta.content);
}
```

### curl

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key-123" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

---

## 💻 本地开发

### Deno 版本

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/Z2api-deno.git
cd Z2api-deno

# 2. 创建 .env 文件（可选）
cat > .env << EOF
DOWNSTREAM_KEY=sk-123456
UPSTREAM_TOKEN=your-zai-token
ANON_TOKEN_ENABLED=true
THINK_TAGS_MODE=show
DEBUG_MODE=false
EOF

# 3. 运行
deno run --allow-net --allow-env index.ts
```

服务运行在 `http://localhost:8000`

### Cloudflare Workers 版本

```bash
# 1. 安装依赖
npm install

# 2. 创建 .dev.vars 文件（本地密钥）
cat > .dev.vars << EOF
DOWNSTREAM_KEY=sk-test-key
UPSTREAM_TOKEN=your-test-token
ANON_TOKEN_ENABLED=true
THINK_TAGS_MODE=show
DEBUG_MODE=true
EOF

# 3. 本地运行
npm run dev

# 服务运行在 http://localhost:8787

# 4. 部署到生产
npm run deploy
```

---

## 🔄 平台对比

| 特性 | Deno Deploy | Cloudflare Workers |
|------|-------------|-------------------|
| **免费额度** | 100万请求/月 | 10万请求/天 |
| **冷启动** | 快 | 极快 |
| **全球分布** | ✅ | ✅ |
| **部署难度** | ⭐⭐⭐⭐⭐（一键） | ⭐⭐⭐⭐（CLI） |
| **CPU 时间** | 无限制 | 免费版 10ms |
| **自定义域名** | ✅ | ✅ |
| **推荐场景** | 个人使用 | 高并发生产环境 |

---

## 🐛 故障排查

### 健康检查

访问健康检查端点：

```bash
curl https://your-worker.workers.dev/health
```

**正常输出**：
```json
{
  "status": "ok",
  "service": "OpenAI to Z.ai Proxy",
  "timestamp": "2025-09-30T12:00:00.000Z",
  "config": {
    "anon_token_enabled": true,
    "upstream_token_configured": true,
    "downstream_key_configured": true,
    "debug_mode": false
  }
}
```

### 常见问题

#### 502 Upstream error

**原因**: 上游 Z.ai API 认证失败

**解决**:
```bash
# 方案 A: 使用匿名 Token（推荐）
wrangler secret put ANON_TOKEN_ENABLED
# 输入: true
wrangler deploy

# 方案 B: 使用固定 Token
wrangler secret put UPSTREAM_TOKEN
# 粘贴您的 Z.ai token
wrangler deploy
```

**获取 Token**:
1. 访问 https://chat.z.ai
2. 登录账号
3. 按 F12 打开开发者工具
4. Application → Cookies → 复制 `token` 值

#### 401 Invalid API key

**原因**: 客户端 API Key 与 DOWNSTREAM_KEY 不匹配

**解决**:
```bash
wrangler secret list  # 查看已配置的 secrets

wrangler secret put DOWNSTREAM_KEY
# 输入新的 key: sk-new-key-123

wrangler deploy
```

#### 思考内容不显示

**检查**:
1. 确认 `THINK_TAGS_MODE=show`
2. 确认已重新部署
3. 确认客户端支持 `reasoning_content` 字段（Cherry Studio、LobeChat 支持）

**测试命令**:
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }' | grep "reasoning_content"
```

#### 思考内容卡顿

**诊断步骤**:

1. **对比官网**: 访问 https://chat.z.ai 发送相同消息，观察思考内容展开速度
   - 如果官网也卡 → 上游问题
   - 如果只有代理卡 → 继续诊断

2. **启用调试模式**:
```bash
# 修改 wrangler.toml
DEBUG_MODE = "true"

wrangler deploy
wrangler tail
```

3. **观察日志**:
```
[DEBUG] [Thinking] 原始: 分析用户... -> 处理后: 分析用户...
[DEBUG] [Thinking] 已发送 chunk，长度: 15
```

**解决方案**:
- 使用固定 Token 减少网络延迟
- 如果是上游问题，无法在代理层面解决
- 临时方案：禁用思考内容 `THINK_TAGS_MODE=strip`

### 调试工具

**启用详细日志**:
```bash
# Cloudflare Workers
DEBUG_MODE = "true"  # 在 wrangler.toml 中
wrangler deploy
wrangler tail  # 查看实时日志

# Deno Deploy
DEBUG_MODE=true deno run --allow-net --allow-env index.ts
```

**测试脚本**:
```bash
# 测试模型列表
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer sk-your-key"

# 测试流式对话
curl -N https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 性能优化

**1. 使用固定 Token**
```bash
wrangler secret put UPSTREAM_TOKEN
# 粘贴有效的 Z.ai token

# 在 wrangler.toml 中
ANON_TOKEN_ENABLED = "false"
```
**效果**: 减少 100-300ms 延迟

**2. 使用自定义域名**
Cloudflare Workers 自定义域名性能更好
**效果**: 减少冷启动时间

**3. 禁用思考内容**
```toml
THINK_TAGS_MODE = "strip"
```
**效果**: 减少数据传输和渲染开销

### 监控和日志

**Cloudflare Workers**:
```bash
wrangler tail  # 实时日志
# 或在 Dashboard → Worker → Logs 查看
```

**Deno Deploy**:
在 Dashboard → Logs 标签查看实时日志

### 安全建议

1. **保护 API Key**
   - ✅ 使用强随机密钥
   - ✅ 定期轮换密钥
   - ✅ 不要在代码中硬编码
   - ✅ 使用 Secrets 管理敏感信息

2. **限制访问**
   - Cloudflare: 使用 WAF 规则限制 IP、设置速率限制
   - Deno: 在代码中添加 IP 白名单、实现速率限制

3. **监控异常**
   - 定期查看日志
   - 监控请求量
   - 设置告警

### 测试清单

部署前检查：

- [ ] `DOWNSTREAM_KEY` 已设置
- [ ] `UPSTREAM_TOKEN` 已设置或 `ANON_TOKEN_ENABLED=true`
- [ ] `THINK_TAGS_MODE` 已配置（strip 或 show）
- [ ] 已运行 `wrangler deploy` 或重新部署 Deno
- [ ] `/health` 端点返回正常
- [ ] `/v1/models` 返回模型列表
- [ ] `/v1/chat/completions` 可以正常对话
- [ ] 思考内容按预期显示（如果使用 show 模式）

### 性能基准

**典型延迟（ms）**:

| 操作 | Deno Deploy | Cloudflare Workers |
|------|------------|-------------------|
| 模型列表 | 200-400ms | 150-300ms |
| 首个 token | 500-800ms | 400-600ms |
| 流式响应 | 50-100ms/token | 30-80ms/token |
| 匿名 token 获取 | 200-400ms | 150-300ms |

**优化建议**:

| 场景 | 建议 |
|------|------|
| 高并发 | Cloudflare Workers + 固定 Token |
| 个人使用 | Deno Deploy + 匿名 Token |
| 需要思考内容 | show 模式 + Cherry Studio |
| 追求速度 | strip 模式 + 固定 Token |

---

## 📊 更新日志

### v4.1.0（当前版本）- 2025-09-30

> 🚨 **重要**: 此版本修复了 426 客户端校验失败错误

**紧急修复**:
- 🔧 修复 426 错误：`{"detail":"您的客户端校验失败","code":426}`
- ✅ 更新 X-FE-Version: `1.0.70` → `1.0.94`
- ✅ 新增 X-Signature 签名验证机制
- ✅ 更新请求头至 Chrome 140 标准
- ✅ 同步 Deno 和 Workers 版本

**技术细节**:
```javascript
// 新增 X-Signature 生成（基于请求体的 SHA-256 哈希）
async function generateSignature(body) {
  const hash = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**升级方法**:
```bash
# Cloudflare Workers
wrangler deploy

# Deno Deploy
git push origin main
```

### v4.0.0 - 2025-09-30

**重大改进**:
- 🎉 采用 OpenAI o1 标准 `reasoning_content` 字段
- ✅ 简化配置：只有 strip/show 两个模式
- ✅ 修复思考内容卡顿问题
- ✅ Deno 和 Workers 版本完全同步
- ✅ 参考 Go 版本优化实现
- ✅ 更好的客户端兼容性

**技术细节**:
- 使用 `reasoning_content` 字段传输思考内容
- 使用 `content` 字段传输答案内容
- 优化流式处理逻辑，减少过滤延迟
- 添加详细调试日志

---

## 📚 相关资源

- [Z.ai 官网](https://chat.z.ai/)
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
- [Deno Deploy](https://deno.com/deploy/docs)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cherry Studio](https://github.com/kangfenmao/cherry-studio)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License

---

**最后更新**: 2025-09-30  
**当前版本**: v4.1.0