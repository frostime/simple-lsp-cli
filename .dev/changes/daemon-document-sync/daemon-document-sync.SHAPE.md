---
status: accepted
---

# Daemon Document Synchronization

## Shape

Daemon 会跨 CLI 调用复用同一个 `LspClient`。当前客户端只在首次访问文件时发送 `textDocument/didOpen`，因此磁盘文件被外部工具修改后，language server 继续使用旧的打开文档。修复应由 `LspClient` 在每次请求前负责确认文档内容同步，而不是让 daemon 或 CLI 分别维护文件状态。

推荐保留现有请求调用路径，并把现有 `openFile()` 的职责扩展为“打开或同步文件”。客户端为每个 URI 保存当前文本和 LSP version；文件内容未变化时不发送通知，变化时根据当前会话在 `initialize` 中协商到的 `textDocumentSync` 能力发送正确的 `didChange`，同时使该 URI 的旧诊断失效。`didOpen`、`didClose` 和回退行为也必须服从服务器声明的生命周期能力；不能把 `didClose` + `didOpen` 当作无条件的兼容手段。

同步能力的具体编码属于 `src/lsp-client.ts` 的局部实现，不在本 SHAPE 中预先规定函数签名。需要避免只依赖 mtime，也不能无条件假设所有服务器都接受 full-document change。

## Predicted Diff

```text
src/
└── lsp-client.ts
    modify  +80-140/-20-40  preserve request wrappers; replace the URI set with per-document
                             state, capability-aware lifecycle/change handling, content comparison,
                             versioning, position encoding, and diagnostic freshness tracking

test/
└── integration/
    └── daemon-sync.test.mjs
        create  +180-300       deterministic fake-server coverage for session reuse, numeric and
                               options-object sync capabilities, lifecycle fallback/error behavior,
                               diagnostics freshness, empty publications, and same-URI overlap
```

No change is predicted for `src/daemon.ts` or `src/cli.ts`: they already preserve the session boundary and route every request through `LspClient`. No new synchronization module is justified unless the protocol handling grows beyond this client-local responsibility.

## Ownership And Coordination

- `SessionPool` continues to own client lifetime only.
- `LspClient` owns document state, LSP document versions, synchronization notifications, and the freshness boundary for diagnostics.
- The request methods continue to call the single file-entry method, so hover, definition, completion, rename, code actions, symbols, formatting, and diagnostics all receive the same synchronization behavior.
- `diagnosticsMap` must not satisfy a request with a pre-change cached result. If a publication carries a version, a known older version must be rejected. If it omits a version, the client can invalidate the old local cache and wait for a subsequent publication, but must treat freshness as best-effort because arrival order cannot prove causal version. Empty publications are valid fresh results and must clear old diagnostics.
- The same-URI synchronization transition (read snapshot, compare state, advance version, update local state, and emit the synchronization notification) must not be split by an `await`. The current synchronous file read and notification path can preserve this invariant without adding a mutex; if implementation introduces asynchronous I/O, it must add per-URI serialization instead.

## Protocol Alternatives

### Recommended: capability-aware synchronization

Interpret the server's `textDocumentSync` returned by the current `initialize` response:

- Numeric `Full` or `Incremental`: use the corresponding document lifecycle and change mode used by the built-in servers.
- Options object with `openClose: true` and `change: Full` or `Incremental`: send lifecycle notifications and the declared change format.
- Options object with `openClose: true` but no usable change mode: `didClose` + `didOpen` may be used as a bounded compatibility fallback because the server explicitly accepts lifecycle ownership.
- `None`, missing synchronization capability, or an options object that does not permit the needed lifecycle: do not invent document notifications. Return an explicit synchronization error for operations that require a current client-managed snapshot rather than silently returning a potentially stale result.

For incremental mode, use one ranged replacement covering the previous document instead of implementing a general diff. The client currently does not negotiate another position encoding, so make UTF-16 explicit in initialize and compute end positions in UTF-16 code units. If future position-encoding negotiation is added, this assumption must be revisited.

Advertise `publishDiagnostics.versionSupport: true` only together with handling for versioned publications. Versioned publications can be compared with the current document version; unversioned publications remain best-effort after local cache invalidation.

This preserves the LSP document lifecycle and avoids restarting server-side document state on every external edit while refusing to claim synchronization where the server contract does not permit it.

### Compatibility fallback: `didClose` + `didOpen`

This is not a universal fallback. It is limited to a server that explicitly permits open/close lifecycle notifications. It resets the server's open-document state and may trigger more indexing or diagnostics work, so it remains a compatibility path rather than the default.

## Tests

The fake server should expose enough protocol behavior to make the contract observable without depending on an installed language server:

- first request for a file sends one `didOpen` with version `1`;
- repeated request without a disk change sends no document-change notification;
- numeric `Full` and `Incremental` capabilities select the expected change shape;
- options-object `openClose: true` selects lifecycle notifications, while no safe lifecycle produces the explicit unsupported-sync behavior;
- after an external edit, the next request sends a newer version and the new text;
- incremental whole-document replacement handles ASCII, multiline text, missing trailing newline, and non-BMP characters;
- versioned old diagnostics are rejected, versioned empty diagnostics clear the result, and unversioned publications exercise the best-effort path;
- two overlapping requests for the same URI do not duplicate or reuse a document version;
- two separate CLI invocations use the same daemon session.

The existing real-server integration test may remain as smoke coverage, but it should not be the only regression test because server availability and server-specific file watching would make the stale-content assertion nondeterministic.

## Acceptance Boundary

The accepted boundary is: disk content is the source of truth for each request snapshot; `LspClient` negotiates and stores document synchronization capability once per LSP session; capability-aware synchronization is the normal path; `didClose` + `didOpen` is only a lifecycle-permitted compatibility fallback; and the client must not silently reuse a pre-change diagnostic cache. Versioned diagnostics receive a strong version comparison guarantee; unversioned diagnostics receive cache invalidation plus best-effort freshness only.

A runtime probe of the built-in and configured servers may verify exact capability shapes and notification ordering before implementation. Current local evidence shows TypeScript and Pyright advertise numeric Incremental synchronization, while Rust Analyzer, TexLab, Svelte language server, and Pylsp advertise options objects with `openClose: true` and Incremental change. The initial standalone Pylsp probe timed out, but the project's own `LspClient` startup path successfully negotiated `{ change: 2, openClose: true, save: { includeText: true } }`; the timeout was a probe limitation, not a server capability finding. The probe does not reopen ownership or responsibility decisions. Persistent cross-session capability snapshots, production trial notifications, general diff computation, and config-level synchronization overrides remain out of scope unless implementation evidence changes the contract.
