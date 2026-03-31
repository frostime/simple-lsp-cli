**轻量级**的 CLI 工具，用于调用 [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) 方法。专为 AI Agent 工具调用设计。

方便 Agent 调用 LSP 分析代码。

开发内容：
- 源代码: `src/`
- 内置 Agent SKILL: `skills/`

本地开发测试:
- 使用 `node dist/cli.js <command> [options]` 直接运行本地构建的 CLI，无需全局安装
- 修改代码后先 `npm run build`，再用上述方式测试
- 测试 CLI 可用性时，请在 `temp/` 下创建临时程序，避免污染 git 仓库
