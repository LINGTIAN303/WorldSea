# orchestrator/nodes/react-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/react-node.ts`
> 说明：本文件为 agent-core ReactNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-27 行）

```
/**
 * ReactNode — ReAct 模式编排节点
 *
 * 设计理念：
 * - 单次 execute = 一次 backend.prompt 调用 = 一次完整 ReAct 循环
 *   （LLM 内部自主完成"思考→工具调用→观察→继续思考"直至回复用户）
 * - 节点本身不实现循环，循环逻辑由 LLM + 工具调用驱动
 * - 多轮 ReAct（如基于观察结果继续）通过编排图的边实现：
 *   ReactNode → 条件边（检查完成度）→ ReactNode（再次执行）
 *
 * 占位符支持（promptTemplate 中）：
 * - {{input}}：用户原始输入（state.input）
 * - {{lastMessage}}：state.messages 最后一条消息内容
 * - {{plan}}：state.plan 的 JSON 摘要（Plan-and-Execute 联动时用）
 * - {{workingMemory}}：工作记忆格式化文本（阶段 0.7 新增，启用 workingMemory 时可用）
 *
 * 工作记忆集成（阶段 0.7 新增）：
 * - 启用后，execute 完成时从本次新增的 messages 中提取 toolResult 作为工作记忆条目
 * - 支持在下次 execute 时通过 {{workingMemory}} 占位符注入到 prompt
 * - 完成时（status=done）可选合并工作记忆到 messages 作为摘要
 * - 与 WorkingMemoryHelper 配合，提供观察缓冲+容量控制+合并能力
 *
 * 与 pi-agent-core 的关系：
 * - 阶段 0：backend 由 PiBackendAccessor 实现（包装 CoreBackend.prompt）
 * - 阶段 1：backend 由 Rust genai 的 Tauri invoke 包装实现
 * - ReactNode 本身不关心 backend 的具体实现
 */
```
