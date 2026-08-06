# pi-backend-accessor.ts 详细注释文档（packages/agent-runtime/orchestrator）

> 来源：`packages/agent-runtime/src/orchestrator/pi-backend-accessor.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-17 行）

```
PiBackendAccessor — 将 CoreBackend（pi-agent-core 包装）适配为 NodeBackendAccessor

核心职责：
1. 适配 prompt 签名：CoreBackend.prompt 返回 void → NodeBackendAccessor.prompt 返回 string
   通过临时订阅 backend 事件，捕获 message_end 的 content 作为返回值
2. 事件转发：将 CoreBackend 的 AgentEvent 通过 relay 函数注入 Orchestrator 事件流
3. 消息管理：委托 getRuntimeMessages/setRuntimeMessages/trimContext 给 CoreBackend

三层架构位置：
  编排框架层（Orchestrator/Node/Edge）
  Agent loop 层（ReAct/Plan/Reflection）
  LLM 通信层（pi-agent-core）← PiBackendAccessor 在此层之上，适配编排框架的接口

阶段 0：包装 CoreBackend（TS）
阶段 1：替换为包装 Rust genai 的 Tauri invoke（接口不变，只换实现）
```

## 注释块 2（原文件第 43-53 行）

```
调用 LLM 并返回最终响应文本

内部流程：
1. 临时订阅 backend 事件（捕获 message_end 和 agent_end）
2. 调用 backend.prompt（返回 void）
3. 等待 agent_end 事件
4. 返回最后一条 message_end 的 content

注意：事件已通过构造时的持久订阅转发给 Orchestrator，这里只需捕获响应
```

## 注释块 3（原文件第 152-161 行）

```
将 PromptCallOptions 转换为 CoreBackend 的 PromptOptions

阶段 0 简化映射：
- images → options.images
- thinkingLevel → 通过 updateThinkingLevel 设置（在 prompt 前已处理）
- temperature/maxTokens → 暂不支持（需通过 updateModel，开销大，留到后续）
- systemPromptOverride → 暂不支持（需重建 agent）
- toolsOverride → 暂不支持（工具集在 agent 初始化时固定）
```
