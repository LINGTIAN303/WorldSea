# llm 模块详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/llm/` 子目录各文件中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此（本目录按模块合并为一个文档）。
> 覆盖代码文件：`llm/mod.rs`、`llm/genai_backend.rs`、`llm/manifest.rs`、`llm/stream.rs`。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（代码文件 llm/mod.rs 第 1-17 行）

# LLM 通信层

对应 TS 版 `pi-ai` 的 `streamSimple` / `getModel` / Provider 适配层。
阶段 1.2 实现：基于 `genai` crate 封装统一 LLM 通信接口。

## 模块组织
- [`manifest`]：Provider 静态清单（16 个内置 Provider 的元数据）
- [`config`]：运行时 ProviderConfig（cloud/local/custom 三种部署模式）
- [`model`]：ModelInfo（对应 pi-ai 的 Model 结构）
- [`error`]：LLM 通信层错误
- [`genai_backend`]：基于 genai 的 NodeBackendAccessor 实现（feature = "llm-genai"）
- [`stream`]：stream_simple 等价函数 + 事件映射（feature = "llm-genai"）

## 与 TS 版差异
- worldsea 没有 SQLite provider 表，配置在前端 localStorage
- Rust 侧通过运行时注入 ProviderConfig（与 TS 版一致）
- API Key 通过 keyring 或运行时传入，不持久化到 SQLite

---

## 注释块 2（代码文件 llm/genai_backend.rs 第 1-14 行）

# GenaiBackend — 基于 genai 的 NodeBackendAccessor 实现

对应 TS 版 `pi-ai` 的核心调用逻辑（streamSimple + getModel）。
将 [`ProviderConfig`] 转换为 genai 的 `ServiceTarget`，调用
`Client::exec_chat_stream` 获取流式响应，并通过事件广播器推送流事件。

## 关键映射
| TS 侧                | Rust 侧                              |
|----------------------|--------------------------------------|
| `streamSimple`       | `GenaiBackend::prompt`               |
| `getModel`           | [`crate::llm::stream::get_model`]    |
| `ProviderConfig`     | [`super::config::ProviderConfig`]    |
| `messages` 数组      | `Arc<RwLock<Vec<OrchestratorMessage>>>` |
| `StreamEvent` 回调   | `EventEmitter` trait                 |

---

## 注释块 3（代码文件 llm/genai_backend.rs 第 586-595 行）

热切换 Provider 配置（不清空消息历史）

重建 `ProviderConfig` 并替换内部 config，保留 messages 和 steer_buffer。
对应前端 `IAgentBackend.updateModel` 接口。

# 模式切换规则
- `Cloud` → `Cloud`：更新 provider/model_id/api_key
- `Cloud` → `Custom`：传入 `base_url` 时降级为 Custom（OpenAI 兼容协议）
- `Custom` → `Custom`：保留旧 `api_type`/`context_window`/`max_tokens`
- `Local` → 不支持：返回 `Unsupported` 错误（需重建 backend）

---

## 注释块 4（代码文件 llm/manifest.rs 第 1-10 行）

# Provider 静态清单

对应 TS 版 `worldsea-agent/src/providers/provider-registry.ts`。
16 个内置 Provider 的元数据，用于解析云端 Provider 的 API 类型、BaseURL、
视觉/思考能力检测等。

## 设计说明
TS 版用闭包实现 `visionDetector`/`thinkingDetector`，
Rust 改用函数指针 `fn(&str) -> bool`（`Copy`，可作 `const` 字段）。
检测逻辑封装为独立 `fn`，便于单元测试。

---

## 注释块 5（代码文件 llm/stream.rs 第 1-18 行）

# Stream — stream_simple 与 get_model 函数

对应 TS 版 `pi-ai` 的核心导出函数：
- `streamSimple(config, messages, options)` → 异步推流 [`StreamEvent`]
- `getModel(config)` → [`ModelInfo`]

## 设计差异
TS 版用 `AsyncIterable<StreamEvent>`，Rust 版用 `tokio::sync::mpsc::Receiver<StreamEvent>`。
调用方通过 `while let Some(event) = receiver.recv().await { ... }` 消费事件。

## 事件映射
| genai 事件             | StreamEvent              |
|-----------------------|--------------------------|
| `Start`               | `StreamStart`            |
| `Chunk(text)`         | `Delta`                  |
| `ReasoningChunk(text)`| `ReasoningDelta`         |
| `ToolCallChunk(...)`  | `ToolCallDelta`（聚合）   |
| `End(usage)`          | `Usage` + `StreamEnd`    |

---

## 注释块 6（代码文件 llm/stream.rs 第 84-95 行）

stream_simple — 对应 TS 版 `streamSimple`

# 参数
- `config`：Provider 配置
- `messages`：消息历史
- `options`：调用选项

# 返回
`mpsc::Receiver<StreamEvent>` — 调用方异步消费事件

# 错误处理
内部错误通过 `StreamEvent::Error` 推送，随后推送 `StreamEvent::Complete` 关闭流。
