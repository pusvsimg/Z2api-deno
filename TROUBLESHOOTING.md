# 🔧 故障排查指南

完整的问题诊断和解决方案。

---

## 🏥 健康检查

### 检查服务状态

访问健康检查端点：

```bash
curl https://your-worker.workers.dev/health
```

**正常输出**：
```json
{
  "status": "ok",
  "service": "OpenAI to Z.ai Proxy (Cloudflare Workers)",
  "timestamp": "2025-09-30T12:00:00.000Z",
  "config": {
    "anon_token_enabled": true,
    "upstream_token_configured": true,
    "downstream_key_configured": true,
    "debug_mode": false
  }
}
```

**检查项**：
- ✅ `upstream_token_configured: true` 或 `anon_token_enabled: true`
- ✅ `downstream_key_configured: true`

---

## 🐛 常见错误及解决方案

### 错误 1: 502 Upstream error

#### 症状
```json
{
  "error": {
    "message": "Upstream API error: 401 Unauthorized",
    "type": "upstream_error",
    "code": 401
  }
}
```

#### 原因
上游 Z.ai API 认证失败

#### 解决方案

**方案 A: 使用匿名 Token（推荐）**
```bash
# 确保启用
wrangler secret put ANON_TOKEN_ENABLED
# 输入: true

wrangler deploy
```

**方案 B: 使用固定 Token**
```bash
# 设置有效的 Z.ai token
wrangler secret put UPSTREAM_TOKEN
# 粘贴您的 token

wrangler deploy
```

**方案 C: 获取新 Token**

1. 访问 https://chat.z.ai
2. 登录账号
3. 按 F12 打开开发者工具
4. Application -> Cookies -> 复制 `token` 值
5. 或 Network -> 找到请求 -> Headers -> Authorization

---

### 错误 2: 401 Invalid API key

#### 症状
```
Invalid API key
```

#### 原因
客户端使用的 API Key 与 `DOWNSTREAM_KEY` 不匹配

#### 解决方案

**检查配置**：
```bash
wrangler secret list
# 应该看到 DOWNSTREAM_KEY
```

**重新设置**：
```bash
wrangler secret put DOWNSTREAM_KEY
# 输入新的 key: sk-new-key-123

wrangler deploy
```

**客户端配置**：确保使用相同的 key

---

### 错误 3: 模型列表为空

#### 症状
```json
{
  "object": "list",
  "data": []
}
```

#### 原因
无法从上游获取模型列表

#### 解决方案

**1. 检查配置**：
```bash
curl https://your-worker.workers.dev/health
```

**2. 启用调试**：
```toml
# wrangler.toml
DEBUG_MODE = "true"
```

**3. 查看日志**：
```bash
wrangler tail
```

**4. 检查 Token**：确保 UPSTREAM_TOKEN 有效或匿名 token 可用

---

### 错误 4: 思考内容不显示

#### 症状
在 Cherry Studio 中看不到思考内容

#### 原因
1. 配置为 `strip` 模式
2. 客户端不支持 `reasoning_content`
3. 部署未更新

#### 解决方案

**确认配置**：
```toml
# wrangler.toml
THINK_TAGS_MODE = "show"
```

**重新部署**：
```bash
wrangler deploy
```

**检查客户端**：
- ✅ Cherry Studio - 完美支持
- ✅ LobeChat - 支持
- ⚠️ NextChat - 可能不支持
- ⚠️ 其他客户端 - 视情况而定

**测试命令**：
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

---

### 错误 5: 思考内容卡顿

#### 症状
思考过程显示断断续续，有明显停顿

#### 可能原因

1. **上游 API 响应延迟**（最常见）
2. 内容过滤导致丢失
3. 网络延迟
4. 客户端渲染性能

#### 诊断步骤

**步骤 1: 对比官网**
```
访问 https://chat.z.ai
发送相同消息
观察思考内容展开速度
```
- 如果官网也卡 → 上游问题
- 如果只有代理卡 → 继续诊断

**步骤 2: 启用调试模式**
```toml
# wrangler.toml
DEBUG_MODE = "true"
THINK_TAGS_MODE = "show"
```

```bash
wrangler deploy
wrangler tail
```

**步骤 3: 发送测试消息并观察日志**

**正常日志**：
```
[DEBUG] [Thinking] 原始: 分析用户... -> 处理后: 分析用户...
[DEBUG] [Thinking] 已发送 chunk，长度: 15
[DEBUG] [Thinking] 原始: 输入... -> 处理后: 输入...
[DEBUG] [Thinking] 已发送 chunk，长度: 8
```

**异常日志**（导致卡顿）：
```
[DEBUG] [Thinking] 原始: \n> \n -> 处理后: 
[DEBUG] [Thinking] 内容为空，跳过发送  ← 内容被过滤！
```

#### 解决方案

**临时方案**：禁用思考内容
```toml
THINK_TAGS_MODE = "strip"
```

**永久方案**：
1. 代码已优化（v4.0），减少过滤
2. 使用固定 Token 减少网络延迟
3. 如果是上游问题，无法在代理层面解决

---

## 🔍 调试工具

### 1. 启用详细日志

**Cloudflare Workers**：
```bash
# 修改 wrangler.toml
DEBUG_MODE = "true"

# 部署
wrangler deploy

# 查看实时日志
wrangler tail
```

**Deno Deploy**：
```bash
# 设置环境变量
DEBUG_MODE=true

# 运行
deno run --allow-net --allow-env index.ts

# 或在 Deploy Dashboard 设置
```

### 2. 测试脚本

**测试模型列表**：
```bash
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

**测试流式对话**：
```bash
curl -N https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

**测试非流式对话**：
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

---

## ⚡ 性能优化

### 1. 使用固定 Token

避免每次请求都获取匿名 token：

```bash
wrangler secret put UPSTREAM_TOKEN
# 粘贴有效的 Z.ai token

# 禁用匿名 token
# wrangler.toml
ANON_TOKEN_ENABLED = "false"
```

**效果**：减少 100-300ms 延迟

### 2. 使用自定义域名

Cloudflare Workers 自定义域名性能更好：

1. Dashboard -> Worker -> Triggers
2. Add Custom Domain
3. 输入域名：`api.yourdomain.com`
4. 配置 DNS

**效果**：减少冷启动时间

### 3. 禁用思考内容

如果不需要思考过程：

```toml
THINK_TAGS_MODE = "strip"
```

**效果**：减少数据传输和渲染开销

---

## 📊 监控和日志

### Cloudflare Workers

**实时日志**：
```bash
wrangler tail
```

**Dashboard 查看**：
1. 进入 Worker 页面
2. 点击 Logs 标签
3. 实时查看请求和错误

### Deno Deploy

**Dashboard 日志**：
1. 进入项目页面
2. 点击 Logs 标签
3. 查看实时日志和错误

**本地运行**：
```bash
# 终端会显示所有日志
DEBUG_MODE=true deno run --allow-net --allow-env index.ts
```

---

## 🔐 安全建议

### 1. 保护 API Key

- ✅ 使用强随机密钥
- ✅ 定期轮换密钥
- ✅ 不要在代码中硬编码
- ✅ 使用 Secrets 管理敏感信息

### 2. 限制访问

**Cloudflare Workers**：
- 使用 WAF 规则限制 IP
- 设置速率限制
- 启用 Bot Fight Mode

**Deno Deploy**：
- 在代码中添加 IP 白名单
- 实现速率限制逻辑

### 3. 监控异常

- 定期查看日志
- 监控请求量
- 设置告警（Cloudflare 付费功能）

---

## 🧪 测试清单

部署前检查：

- [ ] `DOWNSTREAM_KEY` 已设置
- [ ] `UPSTREAM_TOKEN` 已设置或 `ANON_TOKEN_ENABLED=true`
- [ ] `THINK_TAGS_MODE` 已配置（strip 或 show）
- [ ] 已运行 `wrangler deploy` 或重新部署 Deno
- [ ] `/health` 端点返回正常
- [ ] `/v1/models` 返回模型列表
- [ ] `/v1/chat/completions` 可以正常对话
- [ ] 思考内容按预期显示（如果使用 show 模式）

---

## 💡 性能基准

### 典型延迟（ms）

| 操作 | Deno Deploy | Cloudflare Workers |
|------|------------|-------------------|
| 模型列表 | 200-400ms | 150-300ms |
| 首个 token | 500-800ms | 400-600ms |
| 流式响应 | 50-100ms/token | 30-80ms/token |
| 匿名 token 获取 | 200-400ms | 150-300ms |

### 优化建议

| 场景 | 建议 |
|------|------|
| 高并发 | Cloudflare Workers + 固定 Token |
| 个人使用 | Deno Deploy + 匿名 Token |
| 需要思考内容 | show 模式 + Cherry Studio |
| 追求速度 | strip 模式 + 固定 Token |

---

## 📞 获取帮助

### 启用调试模式

```toml
# wrangler.toml 或环境变量
DEBUG_MODE = "true"
THINK_TAGS_MODE = "show"
```

### 收集信息

提交 Issue 时请提供：

1. **错误信息**（完整的错误响应）
2. **配置信息**（`/health` 端点的输出）
3. **日志信息**（`wrangler tail` 的输出）
4. **复现步骤**（如何触发问题）
5. **环境信息**：
   - 部署平台（Cloudflare/Deno）
   - 客户端名称和版本
   - 请求示例

### 自助排查

按以下顺序检查：

1. ✅ 检查 `/health` 端点
2. ✅ 查看部署日志
3. ✅ 启用 DEBUG_MODE
4. ✅ 测试 curl 命令
5. ✅ 对比官网速度
6. ✅ 检查环境变量配置
7. ✅ 查看本文档的常见问题

---

## 🔄 重新部署

### 完整重置流程

**Cloudflare Workers**：
```bash
# 1. 删除所有 secrets
wrangler secret delete DOWNSTREAM_KEY
wrangler secret delete UPSTREAM_TOKEN

# 2. 重新设置
wrangler secret put DOWNSTREAM_KEY
wrangler secret put UPSTREAM_TOKEN

# 3. 重新部署
wrangler deploy

# 4. 测试
curl https://your-worker.workers.dev/health
```

**Deno Deploy**：
```bash
# 1. 在 Dashboard 清除所有环境变量
# 2. 重新设置环境变量
# 3. 重新部署（或删除项目重新创建）
# 4. 测试
```

---

## 📖 相关文档

- [README.md](README.md) - 项目总览
- [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md) - 详细部署指南

---

**最后更新**: 2025-09-30  
**版本**: v4.0