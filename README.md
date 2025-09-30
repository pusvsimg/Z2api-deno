# Z2API: OpenAI to Z.ai 代理服务

> [!IMPORTANT]
> **🚨 紧急更新 (2025-09-30)**: 已修复 426 客户端校验失败错误
> 
> Z.ai 更新了验证机制，所有用户需要**立即重新部署**以修复 426 错误。
> 
> **快速修复**: 
> - Cloudflare Workers: `wrangler deploy`
> - Deno Deploy: `git push origin main`
> 
> **详细说明**: [QUICK_FIX.md](QUICK_FIX.md) | [完整文档](FIX_426_COMPLETE.md)

---

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

### 选项 1: Cloudflare Workers（推荐）

**3 步完成部署**：

```bash
# 1. 安装并登录
npm install -g wrangler
wrangler login

# 2. 配置密钥
wrangler secret put DOWNSTREAM_KEY
# 输入: sk-your-key-123

# 3. 部署
wrangler deploy
```

部署完成后获得：`https://your-worker.workers.dev`

**详细指南**: [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md)

---

### 选项 2: Deno Deploy（一键部署）

[![Deploy with Deno](https://deno.com/deno-deploy-button.svg)](https://dash.deno.com/new?url=https://raw.githubusercontent.com/james-6-23/Z2api-deno/main/index.ts)

部署后在 Settings -> Environment Variables 配置：
```
DOWNSTREAM_KEY = sk-your-key-123
THINK_TAGS_MODE = show
```

---

## ⚙️ 环境变量配置

| 变量名 | 必需 | 说明 | 默认值 |
|--------|:----:|------|--------|
| `DOWNSTREAM_KEY` | ✅ | 客户端 API Key（格式：`sk-xxx`） | - |
| `UPSTREAM_TOKEN` | ❌ | Z.ai 备用 Token | - |
| `ANON_TOKEN_ENABLED` | ❌ | 启用匿名 Token | `true` |
| `THINK_TAGS_MODE` | ❌ | 思考内容模式：`strip`(不显示) / `show`(显示) | `strip` |
| `DEBUG_MODE` | ❌ | 调试模式 | `false` |

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
EOF

# 3. 本地运行
npm run dev

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

### 常见问题

#### 502 Upstream error

**原因**: 上游 Z.ai API 认证失败

**解决**:
```bash
# 设置有效的 UPSTREAM_TOKEN
wrangler secret put UPSTREAM_TOKEN

# 或启用匿名 token
ANON_TOKEN_ENABLED=true
```

#### 401 Invalid API key

**原因**: 客户端 API Key 与 DOWNSTREAM_KEY 不匹配

**解决**: 确保客户端使用的 key 与配置的 DOWNSTREAM_KEY 一致

#### 思考内容不显示

**检查**:
1. 确认 `THINK_TAGS_MODE=show`
2. 确认已重新部署
3. 确认客户端支持 `reasoning_content` 字段（Cherry Studio、LobeChat 支持）

#### 思考内容卡顿

**诊断**:
```bash
# 启用调试模式
DEBUG_MODE=true

# 查看日志
wrangler tail  # Cloudflare
# 或查看 Deno Deploy 日志
```

**详细排查**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 📊 版本更新记录

### v4.1.0（当前版本）- 2025-09-30

> 🚨 **重要**: 此版本修复了 426 客户端校验失败错误，所有用户需要立即更新！

**紧急修复**:
- 🔧 修复 426 错误：`{"detail":"您的客户端校验失败","code":426}`
- ✅ 更新 X-FE-Version: `1.0.70` → `1.0.94`
- ✅ 新增 X-Signature 签名验证机制
- ✅ 更新请求头至 Chrome 140 标准
- ✅ 同步 Deno 和 Workers 版本

**修复内容**:
```javascript
// 新增 X-Signature 生成（基于请求体的 SHA-256 哈希）
async function generateSignature(body) {
  const hash = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**部署说明**: 查看 [QUICK_FIX.md](QUICK_FIX.md) 或 [FIX_426_COMPLETE.md](FIX_426_COMPLETE.md)

---

### v4.0 - 2025-09-30

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

## 📄 许可证

MIT License

---

## 📖 文档导航

- 📘 **README.md**（本文档）- 项目总览和快速开始
- 📗 **CLOUDFLARE_DEPLOY.md** - Cloudflare Workers 详细部署指南
- 📙 **TROUBLESHOOTING.md** - 故障排查和性能优化