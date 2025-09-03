# Z2API-Deno: OpenAI to Z.ai 代理

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

这是一个基于 Deno 的轻量级代理服务，它将 [Z.ai](https://chat.z.ai/) 的 API 转换为与 OpenAI API 完全兼容的格式。这使得任何支持 OpenAI 的客户端或应用都可以无缝对接到 Z.ai 的模型服务。

[![Deploy with Deno](https://deno.com/deno-deploy-button.svg)](https://dash.deno.com/new?url=https://raw.githubusercontent.com/james-6-23/Z2api-deno/main/index.ts)

## ✨ 功能特性

- **OpenAI 格式兼容**: 完全模拟 `/v1/chat/completions` 和 `/v1/models` 接口，支持流式和非流式响应。
- **动态模型列表**: 自动从上游获取并转换模型列表，确保客户端看到的是最新的可用模型。
- **匿名 Token 策略**: 智能获取临时匿名 Token 来访问上游服务，有效避免因固定 Token 请求频率过高而被限制。
- **环境变量配置**: 所有关键配置均通过环境变量设置，方便在 Deno Deploy 或其他环境中部署。
- **CORS 支持**: 内置 CORS 处理，允许任何来源的前端应用直接调用。
- **调试模式**: 可选的调试模式，方便开发者追踪请求和响应的详细信息。

## 🚀 一键部署

你可以使用下面的按钮将此项目一键部署到 Deno Deploy 的免费服务器上。

[![Deploy with Deno](https://camo.githubusercontent.com/3bd1addadda204b1103c7989b704101b8c31d0760f803c72c93f805ff502012b/68747470733a2f2f64656e6f2e6c616e642f6c6f676f2e737667)](https://dash.deno.com/new?url=https://raw.githubusercontent.com/james-6-23/Z2api-deno/main/index.ts)

点击按钮后，你会被引导至 Deno Deploy 的创建页面。项目创建成功后，请务必在项目的 **Settings > Environment Variables** 中设置必要的环境变量。

## ⚙️ 环境变量

为了让代理正常工作，你需要在部署环境（如 Deno Deploy）中配置以下环境变量：

| 变量名 | 是否必须 | 描述 | 默认值 |
| :--- | :---: | :--- | :--- |
| `DOWNSTREAM_KEY` | **是** | 用于下游客户端（如 NextChat）鉴权的 API Key。格式建议为 `sk-xxxxxxxx`。 | `sk-your-key` |
| `UPSTREAM_TOKEN` | 否 | 备用的上游 Z.ai API 访问令牌。当匿名 Token 获取失败时会使用此令牌。 | `your-upstream-token-here` |
| `ANON_TOKEN_ENABLED` | 否 | 是否启用匿名 Token 策略。强烈建议保持开启 (`true`) 以提高稳定性。 | `true` |
| `THINK_TAGS_MODE` | 否 | 对 Z.ai 返回的思考过程（`<thinking>` 标签）的处理策略。`strip` 表示移除，`think` 表示保留为 `<think>` 标签。 | `strip` |
| `DEBUG_MODE` | 否 | 是否开启调试模式。开启后会在控制台输出详细的日志信息。 | `false` |

## 💻 本地运行与开发

如果你想在本地环境中运行或进行二次开发，请按照以下步骤操作：

1.  **安装 Deno**:
    确保你已经安装了 [Deno](https://deno.land/manual/getting_started/installation) (版本 >= 1.33)。

2.  **克隆项目**:
    ```bash
    git clone https://github.com/james-6-23/Z2api-deno.git
    cd Z2api-deno
    ```

3.  **创建 `.env` 文件** (可选):
    为了方便管理密钥，你可以在项目根目录创建一个 `.env` 文件，并填入你的配置：
    ```env
    DOWNSTREAM_KEY="sk-123456"
    UPSTREAM_TOKEN="your-z.ai-token"
    ANON_TOKEN_ENABLED="true"
    ```

4.  **运行脚本**:
    执行以下命令来启动服务。Deno 会自动加载 `.env` 文件中的环境变量。
    ```bash
    deno run --allow-net --allow-env index.ts
    ```

    服务默认会在 `http://localhost:8000` 上运行。
