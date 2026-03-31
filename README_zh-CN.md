# simple-lsp-cli

[English](README.md)

**轻量级**的 CLI 工具，用于调用 [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) 方法。专为 AI Agent 工具调用设计。

## 特性

- **Agent 友好**：所有输出均为结构化 JSON，便于解析
- **轻量依赖**：仅依赖 `cross-spawn` + `vscode-jsonrpc`，需 Node.js ≥ 18
- **跨平台**：完整支持 Windows / macOS / Linux
- **自动检测**：根据文件扩展名自动选择语言服务器
- **Daemon 模式**：后台常驻进程，避免重复初始化，大幅加速连续调用
- **全面 LSP 覆盖**：hover / definition / references / completion / diagnostics / symbols / rename / format / code-actions / signature-help / type-definition
- **内建支持**：Python（Pyright）、TypeScript/JavaScript（typescript-language-server）

## 前置要求

> `simple-lsp-cli` **不内置语言服务器**。
> 安装本 CLI 后，你仍需要为目标语言单独安装至少一个对应的 LSP Server。

```bash
# Python（推荐 Pyright）
npm install -g pyright

# TypeScript / JavaScript
npm install -g typescript typescript-language-server

# 或者 Python 用 pylsp
pip install python-lsp-server
```

## 安装

### 作为 npm 包使用

```bash
npm install -g simple-lsp-cli
```

安装完成后可直接使用：

```bash
slsp --help
simple-lsp-cli --help
```

### 本地开发

```bash
cd simple-lsp-cli
npm install
npm run build
npm link
```

## 快速开始

```bash
slsp hover -f src/main.py -l 10 -c 5           # 类型 + 文档
slsp definition -f src/app.ts -l 42 -c 12       # 跳转到定义
slsp diagnostics -f src/main.py                  # 错误 / 警告
slsp symbols -f src/utils.ts                     # 文档符号
slsp references -f src/main.py -l 15 -c 8        # 查找引用
slsp completion -f src/main.py -l 10 -c 5        # 补全建议
slsp rename -f src/main.py -l 5 -c 8 -n newFunc  # 重命名
```

## 命令

位置参数均为 **1-based**。

### 位置类（需 `--file --line --col`）

| 命令 | 说明 |
|------|------|
| `hover` | 类型信息与文档 |
| `definition` | 跳转到定义 |
| `type-definition` | 跳转到类型定义 |
| `references` | 查找所有引用 |
| `completion` | 补全建议 |
| `signature-help` | 函数签名信息 |
| `rename` | 重命名符号（需 `--new-name`） |
| `code-actions` | 代码操作 |

### 文件类（仅需 `--file`）

| 命令 | 说明 |
|------|------|
| `diagnostics` | 错误、警告、提示 |
| `symbols` | 文档符号 |
| `format` | 格式化 |

### 管理

| 命令 | 说明 |
|------|------|
| `servers` | 列出语言服务器 |
| `daemon start` | 启动后台 daemon |
| `daemon stop` | 停止 daemon |
| `daemon status` | daemon 状态 |

## 选项

```
-f, --file <path>     目标文件（必需）
-l, --line <n>        行号（1-based）
-c, --col  <n>        列号（1-based）
-r, --root <path>     项目根目录（默认自动检测）
-s, --server <name>   强制服务器（pyright|pylsp|typescript）
-n, --new-name <name> 新名称（rename 用）
-w, --wait <ms>       诊断等待（默认 5000）
-v, --verbose         输出 LSP 日志到 stderr
```

## 输出格式

```json
{
  "success": true,
  "command": "hover",
  "file": "/abs/path/file.py",
  "position": { "line": 10, "character": 5 },
  "result": { "contents": "(variable) name: str", "range": { "..." : "..." } }
}
```

## Daemon 模式（自动管理）

首次调用任何 LSP 命令时，daemon 会自动启动，后续调用复用会话（~0.7s vs 冷启动 2-3s）。
15 分钟无活动后自动退出，无需手动管理。

```bash
slsp hover -f src/main.py -l 10 -c 5   # 自动启动 daemon
slsp hover -f src/main.py -l 20 -c 3   # 复用，快速响应
# 15 分钟后自动退出
```

手动控制仍然可用：

```bash
slsp daemon start     # 立即启动
slsp daemon status    # 查看状态 + 空闲时间
slsp daemon stop      # 立即停止
slsp hover --no-daemon -f ...  # 强制 inline 模式
```

## Agent 集成

```python
import subprocess, json

def lsp(action, file, line=None, col=None, **kw):
    cmd = ["slsp", action, "-f", file]
    if line: cmd += ["-l", str(line)]
    if col:  cmd += ["-c", str(col)]
    for k, v in kw.items():
        cmd += [f"--{k.replace('_', '-')}", str(v)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
```

## 架构

```
CLI → Daemon(可选) → LspClient → JsonRpcConnection → Language Server (stdio)
```

## License

MIT
