# 426 错误快速修复脚本 (PowerShell)

Write-Host "🔧 Z2API 426 错误修复工具" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# 检查是否安装 wrangler
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 错误: 未安装 wrangler" -ForegroundColor Red
    Write-Host "请运行: npm install -g wrangler" -ForegroundColor Yellow
    exit 1
}

Write-Host "📋 选择修复方案：" -ForegroundColor Green
Write-Host "1. 更新 UPSTREAM_TOKEN（推荐）"
Write-Host "2. 启用调试模式"
Write-Host "3. 测试匿名 Token"
Write-Host "4. 重新部署"
Write-Host "5. 查看实时日志"
Write-Host ""
$choice = Read-Host "请选择 (1-5)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "📝 请按以下步骤获取新 Token：" -ForegroundColor Yellow
        Write-Host "1. 访问 https://chat.z.ai"
        Write-Host "2. 打开开发者工具 (F12)"
        Write-Host "3. 在 Console 执行："
        Write-Host "   document.cookie.split(';').find(c => c.trim().startsWith('token=')).split('=')[1]" -ForegroundColor Cyan
        Write-Host "4. 复制输出的 token"
        Write-Host ""
        Write-Host "现在将打开设置 token 的界面..." -ForegroundColor Green
        Start-Sleep -Seconds 2
        wrangler secret put UPSTREAM_TOKEN
    }
    "2" {
        Write-Host "🐛 启用调试模式..." -ForegroundColor Yellow
        "true" | wrangler secret put DEBUG_MODE
        Write-Host "✅ 调试模式已启用" -ForegroundColor Green
        Write-Host "💡 使用 'wrangler tail' 查看实时日志" -ForegroundColor Cyan
    }
    "3" {
        Write-Host "🔄 启用匿名 Token..." -ForegroundColor Yellow
        "true" | wrangler secret put ANON_TOKEN_ENABLED
        Write-Host "✅ 匿名 Token 已启用" -ForegroundColor Green
        Write-Host ""
        Write-Host "🚀 重新部署以应用更改..." -ForegroundColor Yellow
        wrangler deploy
    }
    "4" {
        Write-Host "🚀 重新部署..." -ForegroundColor Yellow
        wrangler deploy
    }
    "5" {
        Write-Host "📊 启动实时日志监控..." -ForegroundColor Yellow
        Write-Host "提示: 按 Ctrl+C 退出" -ForegroundColor Gray
        Write-Host ""
        wrangler tail
    }
    default {
        Write-Host "❌ 无效选择" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "✅ 操作完成！" -ForegroundColor Green
Write-Host ""
Write-Host "🧪 常用测试命令：" -ForegroundColor Cyan
Write-Host "  wrangler tail              # 查看实时日志"
Write-Host "  wrangler deploy            # 重新部署"
Write-Host "  wrangler secret list       # 查看已配置的密钥"
Write-Host ""
Write-Host "📖 详细文档: DEBUG_426_ERROR.md" -ForegroundColor Yellow
