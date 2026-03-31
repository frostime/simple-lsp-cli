# Skill: simple-lsp-cli — Code Intelligence via LSP

## Overview

`simple-lsp-cli`（别名 `slsp`）是一个 CLI 工具，通过 Language Server Protocol 提供代码智能能力。你可以用它获取类型信息、跳转定义、查找引用、获取诊断错误、代码补全等。

**所有输出为结构化 JSON**，可直接解析。位置参数均为 **1-based**（第 1 行第 1 列 = 文件开头）。

**支持语言**：Python（.py）、TypeScript（.ts/.tsx）、JavaScript（.js/.jsx/.mjs/.cjs）

## 前置条件

使用前确保对应的 Language Server 已安装：

```bash
# 检查
which pyright-langserver        # Python
which typescript-language-server # TS/JS
```

若未安装：
```bash
npm install -g pyright
npm install -g typescript typescript-language-server
```

## 核心命令速查

### 1. `diagnostics` — 获取文件错误和警告

**场景**：修改文件后检查是否有语法/类型错误、代码审查、定位问题。

```bash
slsp diagnostics -f <file>
```

输出示例：
```json
{
  "success": true,
  "command": "diagnostics",
  "file": "/project/src/main.py",
  "result": [
    {
      "severity": "error",
      "message": "Argument of type \"str\" cannot be assigned to parameter \"count\" of type \"int\"",
      "range": { "start": { "line": 15, "character": 10 }, "end": { "line": 15, "character": 18 } },
      "source": "Pyright"
    }
  ]
}
```

**解读**：`result` 为诊断数组。空数组 `[]` 表示文件无问题。severity 为 error / warning / info / hint。

### 2. `hover` — 获取类型信息和文档

**场景**：理解一个变量/函数/类的类型，查看文档字符串。

```bash
slsp hover -f <file> -l <line> -c <col>
```

输出关键字段：
- `result.contents`：类型签名或文档的 Markdown 文本
- `result.range`：符号的位置范围

**用途**：当你需要知道某个标识符的类型或函数签名时使用。

### 3. `definition` — 跳转到定义

**场景**：找到函数/类/变量的定义位置，理解实现细节。

```bash
slsp definition -f <file> -l <line> -c <col>
```

输出关键字段：
- `result.file`：定义所在文件的绝对路径
- `result.range`：定义的精确位置

**注意**：结果可能是数组（多个候选定义），也可能是单个对象。

### 4. `references` — 查找所有引用

**场景**：重命名前评估影响范围、理解符号的使用模式。

```bash
slsp references -f <file> -l <line> -c <col>
```

输出为 Location 数组，每项含 `file` 和 `range`。

### 5. `symbols` — 文档符号结构

**场景**：快速了解文件的代码结构（类、函数、变量列表），导航大文件。

```bash
slsp symbols -f <file>
```

输出为树形结构，每个符号含 `name`、`kind`（Class/Function/Variable/...）、`range`，以及可能的 `children`。

### 6. `completion` — 补全建议

**场景**：在写代码时获取补全选项。

```bash
slsp completion -f <file> -l <line> -c <col>
```

输出 `result.items` 数组，每项含 `label`、`kind`、`detail`。

### 7. `rename` — 重命名符号

**场景**：安全地跨文件重命名。

```bash
slsp rename -f <file> -l <line> -c <col> --new-name <newName>
```

输出 `result.edits` 数组，描述需要修改的文件和位置。**注意：此命令只返回编辑描述，不会自动修改文件**，你需要自行应用。

### 8. `format` — 格式化

```bash
slsp format -f <file>
```

输出 TextEdit 数组。同样只返回编辑描述。

### 9. `signature-help` — 函数参数提示

```bash
slsp signature-help -f <file> -l <line> -c <col>
```

在函数调用的括号内使用，返回参数列表和文档。

### 10. `code-actions` — 代码操作

```bash
slsp code-actions -f <file> -l <line> -c <col>
```

返回可用的快速修复、重构操作等。

## Daemon 模式（强烈推荐）

LSP 服务器初始化需要 1-2 秒。如果你要对同一项目执行多次操作，**务必先启动 daemon**：

```bash
# 开始工作前
slsp daemon start

# ... 执行多次 LSP 操作（几乎无延迟）...

# 工作完成后
slsp daemon stop
```

检查 daemon 状态：
```bash
slsp daemon status
```

如果 daemon 未运行，命令会自动回退到单次模式（较慢但不影响正确性）。

## 常用工作流

### 工作流 1：诊断并修复（最常用）

```bash
# 1. 启动 daemon
slsp daemon start

# 2. 获取诊断
slsp diagnostics -f src/main.py

# 3. 对每个错误，用 hover 查看上下文
slsp hover -f src/main.py -l <error_line> -c <error_col>

# 4. 必要时跳转到定义查看实现
slsp definition -f src/main.py -l <line> -c <col>

# 5. 修改代码后再次诊断验证
slsp diagnostics -f src/main.py

# 6. 完成，关闭 daemon
slsp daemon stop
```

### 工作流 2：理解陌生代码

```bash
slsp daemon start

# 1. 先看文件结构
slsp symbols -f src/module.py

# 2. hover 关键符号了解类型
slsp hover -f src/module.py -l 25 -c 10

# 3. 跳转到定义深入
slsp definition -f src/module.py -l 25 -c 10

# 4. 查找引用了解使用方式
slsp references -f src/module.py -l 25 -c 10

slsp daemon stop
```

### 工作流 3：安全重构

```bash
slsp daemon start

# 1. 找到要重命名的符号的所有引用
slsp references -f src/main.py -l 12 -c 5

# 2. 获取重命名编辑方案
slsp rename -f src/main.py -l 12 -c 5 --new-name betterName

# 3. 应用编辑后验证无错
slsp diagnostics -f src/main.py

slsp daemon stop
```

## 最佳实践

1. **多次操作一定要开 daemon**：单次操作时可以不开，但连续操作时 daemon 是必须的。
2. **修改文件后重新执行 diagnostics**：LSP 服务在 inline 模式下每次重新读取文件，确保结果是最新的。
3. **位置参数是 1-based**：即代码编辑器里显示的行列号可以直接使用。
4. **错误时检查 success 字段**：所有命令的输出都有 `success: true/false`，失败时 `error` 字段有原因。
5. **用 --root 指定根目录**：如果自动检测不准确（比如 monorepo），手动指定项目根。
6. **用 --server 切换后端**：Python 同时支持 `pyright`（默认，类型检查更严格）和 `pylsp`（功能更丰富）。

## 错误处理

如果命令失败，输出为：

```json
{
  "success": false,
  "command": "hover",
  "error": "Cannot start \"pyright-langserver\": spawn pyright-langserver ENOENT\nHint: install it first, e.g.  npm i -g pyright"
}
```

常见错误及处理：
- `ENOENT`：语言服务器未安装，按提示安装
- `timed out`：服务器响应超慢，用 `--wait` 增加超时
- `No server for .xxx files`：不支持的文件类型

## 使用 shell 调用的封装函数

### Bash

```bash
lsp() {
  local action="$1"; shift
  slsp "$action" "$@" 2>/dev/null
}

# 用法
lsp diagnostics -f src/main.py | jq '.result[] | select(.severity == "error")'
```

### Python

```python
import subprocess, json

def lsp(action: str, file: str, line: int = None, col: int = None, **kw) -> dict:
    cmd = ["slsp", action, "-f", file]
    if line is not None: cmd += ["-l", str(line)]
    if col is not None:  cmd += ["-c", str(col)]
    for k, v in kw.items():
        cmd += [f"--{k.replace('_', '-')}", str(v)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return json.loads(proc.stdout)
```

### Node.js（直接使用库 API）

```typescript
import { LspClient, SERVER_REGISTRY, simplify } from "simple-lsp-cli";

const client = new LspClient({
  server: SERVER_REGISTRY.pyright,
  rootPath: "/path/to/project",
});

await client.start();
console.log(simplify(await client.hover("src/main.py", 9, 4))); // 库 API 是 0-based
await client.stop();
```
