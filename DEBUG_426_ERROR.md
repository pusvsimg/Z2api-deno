# 426 错误排查指南

## 错误信息
```json
{
  "detail": "您的客户端校验失败",
  "code": 426
}
```

## 诊断步骤

### 1. 启用调试模式

```bash
# Cloudflare Workers
wrangler secret put DEBUG_MODE
# 输入: true

# 查看实时日志
wrangler tail
```

### 2. 检查匿名 Token 获取

在日志中查找：
- ✅ `匿名 token 获取成功` - Token 正常
- ❌ `匿名 token 获取失败` - Token 失败，使用备用 token

### 3. 获取最新的 Z.ai Token

**方法 A: 从浏览器获取**

1. 访问 https://chat.z.ai
2. 打开开发者工具（F12）
3. 在 Console 执行：
   ```javascript
   document.cookie.split(';').find(c => c.trim().startsWith('token=')).split('=')[1]
   ```
4. 复制输出的 token

**方法 B: 从 Application 面板获取**

1. 开发者工具 -> Application 标签页
2. Storage -> Cookies -> https://chat.z.ai
3. 找到 `token` 字段，复制其值

**设置到 Workers：**
```bash
wrangler secret put UPSTREAM_TOKEN
# 粘贴上面获取的 token
```

### 4. 更新请求头版本

1. 访问 https://chat.z.ai
2. 开发者工具 -> Network 标签页
3. 发送一条测试消息
4. 找到 `/api/chat/completions` 请求
5. 查看 Request Headers，记录：
   - `X-FE-Version: prod-fe-1.x.xx` （重要！）
   - `User-Agent`
   - `sec-ch-ua`

**更新代码：**

编辑 `worker.js` 或 `index.ts`：
```javascript
const FAKE_HEADERS = {
  "X-FE-Version": "prod-fe-1.0.XX", // 替换为最新版本号
  // ... 其他头部
};
```

### 5. 测试不同配置

**测试 1: 强制使用固定 Token**
```bash
wrangler secret put ANON_TOKEN_ENABLED
# 输入: false

wrangler secret put UPSTREAM_TOKEN
# 输入: 从浏览器获取的 token
```

**测试 2: 使用匿名 Token**
```bash
wrangler secret put ANON_TOKEN_ENABLED
# 输入: true

wrangler secret delete UPSTREAM_TOKEN
```

## 常见解决方案

### 方案 A: Token 过期（80%的情况）

```bash
# 1. 从浏览器获取新 token（见上文）
# 2. 更新环境变量
wrangler secret put UPSTREAM_TOKEN

# 3. 重新部署
wrangler deploy
```

### 方案 B: 前端版本更新（15%的情况）

从浏览器获取最新 `X-FE-Version` 并更新代码。

### 方案 C: IP被限制（5%的情况）

尝试更换部署区域或使用代理。

## 验证修复

```bash
# 发送测试请求
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "测试"}],
    "stream": false
  }'
```

如果返回正常响应而不是 426 错误，说明问题已解决。

## 预防措施

1. **定期更新 Token**（建议每周）
2. **监控日志**：`wrangler tail` 查看异常
3. **保持代码更新**：关注项目 GitHub 更新
4. **配置告警**：在 Cloudflare Dashboard 设置错误告警

## 仍然无法解决？

1. 检查 Z.ai 服务状态：https://chat.z.ai
2. 提交 Issue：附带完整日志（隐藏敏感信息）
3. 尝试本地运行测试：
   ```bash
   wrangler dev
   ```
