# bridge.ts 详细注释文档（packages/agent-runtime）

> 来源：`packages/agent-runtime/src/bridge.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-23 行）

```
# bridge.ts — 阶段 2.0 批次3 重写

## 历史
- 阶段 1.x：本文件实现 `CoreBackend` 类，桥接 pi-ai 的 `streamSimple` 实现 Agent 循环
- 阶段 2.0 批次3（本次）：移除 `CoreBackend` 类和 pi-ai 依赖，
  Agent 循环已由 Rust 端 `agent_runtime::AgentLoop` 接管

## 保留内容
仅保留从 `bridge-types.ts` 的类型重新导出，避免外部引用断裂：
- `IAgentBackend` 接口（被 useAgentRust.ts 等实现）
- `AgentEvent` / `AgentEventListener` 等事件类型
- `PromptOptions` / `AgentConfig` 等配置类型

## 功能退化说明
`CoreBackend` 类已删除。以下功能受影响：
- 群聊（useGroupChat.ts 直接 `new CoreBackend(...)`）→ 运行时抛错
- Smart Fill（useSmartFillChat.ts 通过 createWorldSeaAgent 间接依赖）→ 运行时抛错
- Agent 私聊（AgentPrivateChat.vue 通过 createWorldSeaAgent）→ 运行时抛错

这是"接受功能退化，直接删除"决策的预期行为。
后续可在 Rust 端实现多 Agent 实例管理，恢复群聊等能力。
```
