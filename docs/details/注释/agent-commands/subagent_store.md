# subagent_store.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/subagent_store.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-18 行）

# 子 Agent 规格持久化（SQLite）

子 Agent 规格注册表默认只在内存（`Arc<RwLock<Vec<SubAgentSpec>>>`），应用重启后
用户在前端「子 Agent」标签页配置的规格会全部丢失。本模块提供**可选的持久化层**：
把规格以 JSON 整条写入 SQLite，启动时加载进内存注册表、注册/删除时写穿。

## 为什么用 JSON 整条存储而非逐列拆字段
`SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）已
derive `Serialize`/`Deserialize`。整条 JSON 存储让 `SubAgentSpec` 未来增删字段时**无需
任何 schema 迁移**——旧 JSON 反序列化时缺字段走 serde 默认，新 JSON 直接入库。若逐列
拆字段，每加一个字段就要跑一次 `ALTER TABLE`，维护成本高且易错。

## 架构
存储层抽象为 [`SubAgentSpecStore`] trait（可测试），SQLite 实现为
[`SqliteSubAgentSpecStore`]。`AgentCommandService` 持有一个可选的
`Option<Arc<dyn SubAgentSpecStore>>`：
- `None`（默认）：纯内存，行为与改造前完全一致（单测/无持久化场景）。
- `Some`：构造时 `load_all` 装入内存注册表，此后注册/删除写穿到 SQLite。
