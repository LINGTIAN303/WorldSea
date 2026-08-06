# lib.rs 详细注释文档（agent-memory）

> 来源：`crates/agent-memory/src/lib.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-20 行）

# MemoryAccessor 适配层（agent-memory）

以 vendor 的 `memory-center-core` 实现 [`MemoryAccessor`] trait，
让 WorldSmith Agent 通过统一接口访问 MemoryCenter 长期记忆系统。

## 映射关系

| `MemoryAccessor` 方法 | MemoryCenter 组件 | 说明 |
|---|---|---|
| `recall` | `Retriever::filter_hooks_by_keyword` | 关键词预筛选 → 摘要视图 |
| `inject` | `Retriever` 渲染 | 将召回结果渲染为 system prompt 片段 |
| `archive` | `Archiver::archive` | 冻结缓冲轮次为记忆文件 |
| `get_archive_boundary` | 内部 `boundary` 计数器 | 已归档轮次数 |
| `load_chunk` | `Retriever::retrieve_memory` | 按 hook 加载完整记忆文件 |

## 使用方式

调用方（`Orchestrator`）持续调用 [`MemoryCenterAccessor::push_turn`]
喂入对话轮次，达到阈值后调用 [`MemoryAccessor::archive`] 触发归档；
检索/注入通过 [`MemoryAccessor::recall`] 与 [`MemoryAccessor::inject`] 完成。

## 注释块 2（原文件第 40-49 行）

MemoryAccessor 适配层结构体

持有一个存储后端（默认 [`SqliteStorage`]）、一个 [`Retriever`]（检索）
与一个被互斥锁保护的 [`Archiver`]（归档缓冲）。

## 线程安全

- `archiver` 用 `tokio::sync::Mutex` 包裹：`Archiver::archive` 为 async 且取 `&mut self`，
  在 async 上下文持有锁跨 await 时需用 tokio Mutex（guard 保证 Send）。
- `injected_hooks` 用 `std::sync::Mutex` 包裹：仅同步的查/插操作，不跨 await 持有。
