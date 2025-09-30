#!/bin/bash
# 426 错误快速修复脚本

echo "🔧 Z2API 426 错误修复工具"
echo "=========================="
echo ""

# 检查是否安装 wrangler
if ! command -v wrangler &> /dev/null; then
    echo "❌ 错误: 未安装 wrangler"
    echo "请运行: npm install -g wrangler"
    exit 1
fi

echo "📋 选择修复方案："
echo "1. 更新 UPSTREAM_TOKEN（推荐）"
echo "2. 启用调试模式"
echo "3. 测试匿名 Token"
echo "4. 重新部署"
echo ""
read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo ""
        echo "📝 请按以下步骤获取新 Token："
        echo "1. 访问 https://chat.z.ai"
        echo "2. 打开开发者工具 (F12)"
        echo "3. 在 Console 执行："
        echo "   document.cookie.split(';').find(c => c.trim().startsWith('token=')).split('=')[1]"
        echo "4. 复制输出的 token"
        echo ""
        read -p "按 Enter 继续设置 token..."
        wrangler secret put UPSTREAM_TOKEN
        ;;
    2)
        echo "🐛 启用调试模式..."
        echo "true" | wrangler secret put DEBUG_MODE
        echo "✅ 调试模式已启用"
        echo "💡 使用 'wrangler tail' 查看实时日志"
        ;;
    3)
        echo "🔄 启用匿名 Token..."
        echo "true" | wrangler secret put ANON_TOKEN_ENABLED
        echo "✅ 匿名 Token 已启用"
        ;;
    4)
        echo "🚀 重新部署..."
        wrangler deploy
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "✅ 操作完成！"
echo ""
echo "🧪 测试命令："
echo "wrangler tail  # 查看日志"
echo ""
echo "📖 详细文档: DEBUG_426_ERROR.md"
