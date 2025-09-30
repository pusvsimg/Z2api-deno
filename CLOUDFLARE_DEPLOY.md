# ⚡ Cloudflare Workers 部署指南

完整的 Cloudflare Workers 部署说明。

---

## 📦 两种部署方式

### 方式一：Wrangler CLI（推荐）

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

**3. 配置项目**

克隆或下载项目：
```bash
git clone https://github.com/your-repo/Z2api-deno.git
cd Z2api-deno
```

**4. 设置 Secrets**
```bash
# 必需：客户端认证密钥
wrangler secret put DOWNSTREAM_KEY
# 输入: sk-your-secure-key-123

# 可选：Z.ai 备用 token
wrangler secret put UPSTREAM_TOKEN
# 输入: 您的 Z.ai token（可留空，会自动获取匿名 token）
```

**5. 配置变量**

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

---

### 方式二：Cloudflare Dashboard

#### 步骤

**1. 创建 Worker**
- 访问 https://dash.cloudflare.com/
- Workers & Pages -> Create Application -> Create Worker
- 命名：`openai-to-zai-proxy`

**2. 粘贴代码**
- 点击 Quick Edit
- 删除默认代码
- 粘贴 `worker.js` 的完整内容
- Save and Deploy

**3. 配置环境变量**
- Settings -> Variables
- **Environment Variables**（公开）：
  - `ANON_TOKEN_ENABLED` = `true`
  - `THINK_TAGS_MODE` = `show`
  - `DEBUG_MODE` = `false`

**4. 配置 Secrets**（加密）
- Settings -> Variables -> Add variable -> Encrypt
- `DOWNSTREAM_KEY` = `sk-your-key`
- `UPSTREAM_TOKEN` = `your-zai-token`（可选）

**5. 重新部署**
- 点击 Save and Deploy

---

## ⚙️ 配置说明

### Environment Variables（公开变量）

| 变量 | 值 | 说明 |
|------|---|------|
| `ANON_TOKEN_ENABLED` | `true` / `false` | 是否自动获取匿名 token |
| `THINK_TAGS_MODE` | `show` / `strip` | 思考内容显示模式 |
| `DEBUG_MODE` | `true` / `false` | 调试模式 |

### Secrets（加密变量）

| 变量 | 必需 | 说明 |
|------|:----:|------|
| `DOWNSTREAM_KEY` | ✅ | 客户端 API Key |
| `UPSTREAM_TOKEN` | ❌ | Z.ai 备用 token |

---

## 🌐 自定义域名

### 添加域名

**1. 在 Worker 设置中**
- Triggers -> Add Custom Domain
- 输入域名：`api.yourdomain.com`

**2. 配置 DNS**
按照提示添加 CNAME 记录

**3. 等待生效**
通常几分钟内生效

### 使用自定义域名

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-key",
    base_url="https://api.yourdomain.com/v1"
)
```

---

## 🔧 本地开发

### 安装依赖

```bash
npm install
```

### 创建本地配置

创建 `.dev.vars` 文件（不要提交到 Git）：
```env
DOWNSTREAM_KEY=sk-test-key-local
UPSTREAM_TOKEN=your-test-token
ANON_TOKEN_ENABLED=true
THINK_TAGS_MODE=show
DEBUG_MODE=true
```

### 本地运行

```bash
# 方式 1: 使用 npm 脚本
npm run dev

# 方式 2: 直接使用 wrangler
wrangler dev --local
```

服务运行在 `http://localhost:8787`

### 本地测试

```bash
# 测试健康检查
curl http://localhost:8787/health

# 测试模型列表
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-test-key-local"

# 测试对话
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-test-key-local" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

---

## 📊 监控

### 查看实时日志

```bash
wrangler tail
```

### 查看请求统计

Dashboard -> Worker -> Analytics

---

## 🚀 部署到生产环境

### 推荐配置

```toml
# wrangler.toml

name = "openai-to-zai-proxy"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
ANON_TOKEN_ENABLED = "true"
THINK_TAGS_MODE = "strip"        # 生产环境建议不显示思考内容
DEBUG_MODE = "false"              # 关闭调试
```

### Secrets 设置

```bash
wrangler secret put DOWNSTREAM_KEY
# 使用强随机密钥

wrangler secret put UPSTREAM_TOKEN
# 使用有效的 Z.ai token
```

### 部署

```bash
wrangler deploy
```

---

## 🔄 更新 Worker

### 更新代码

```bash
# 1. 拉取最新代码
git pull

# 2. 重新部署
wrangler deploy
```

### 更新配置

```bash
# 更新 secret
wrangler secret put DOWNSTREAM_KEY

# 更新环境变量（修改 wrangler.toml 后）
wrangler deploy
```

### 查看部署历史

```bash
wrangler deployments list
```

### 回滚到之前版本

```bash
wrangler rollback [deployment-id]
```

---

## 💰 费用说明

### 免费额度

Cloudflare Workers 免费计划：
- ✅ 10万请求/天
- ✅ 10ms CPU 时间/请求
- ✅ 无限带宽
- ✅ 全球 CDN

### 付费计划

Workers Paid ($5/月)：
- ✅ 1000万请求/月（超出 $0.50/百万）
- ✅ 50ms CPU 时间/请求
- ✅ 更多功能

**推荐**：个人使用免费版足够

---

## ❓ FAQ

### Q: 部署后多久生效？
**A**: 立即生效，全球分布约 30 秒内同步

### Q: 如何查看当前配置？
**A**: 访问 `/health` 端点

### Q: 忘记了 DOWNSTREAM_KEY 怎么办？
**A**: 重新设置：`wrangler secret put DOWNSTREAM_KEY`

### Q: 可以部署多个 Worker 吗？
**A**: 可以，修改 `wrangler.toml` 中的 `name` 即可

### Q: 如何删除 Worker？
**A**: Dashboard -> Worker -> Settings -> Delete

---

## 📚 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)
- [项目主页](README.md)
- [故障排查](TROUBLESHOOTING.md)

---

**最后更新**: 2025-09-30  
**版本**: v4.0