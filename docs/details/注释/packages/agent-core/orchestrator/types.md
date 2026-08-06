# orchestrator/types.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/types.ts`
> 说明：本文件为 agent-core Orchestrator 类型定义内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-16 行）

```
/**
 * Orchestrator 类型定义 — Agent 编排框架核心抽象
 *
 * 设计参考：LangGraph 状态图 + Node/Edge 模型
 * 设计原则：
 * - 轻量：阶段 0 只做接口，不做复杂图引擎
 * - 可迁移：接口设计可直接映射到 Rust trait
 * - 兼容：事件流复用现有 AgentEvent
 * - 解耦：不依赖 pi-agent-core，可包装任何 LLM 后端
 *
 * 三层架构位置：
 *   编排框架层（ToT/GoT/Multi-Agent/Supervisor/Router/Loop）
 *   ↑ 本层提供 Node/State/Orchestrator 抽象
 *   Agent loop 层（ReAct/Plan/Reflection/Self-Refine）
 *   LLM 通信层（pi-ai/genai）
 */
```

## 注释块 2（原文件第 95-104 行）

```
/**
 * 节点执行上下文 — 传入 Node.execute 的运行时环境
 *
 * 提供：
 * - state 读写
 * - 事件发射（与现有 AgentEvent 兼容）
 * - 中断检查（支持 Loop Engineering 的中断/恢复）
 * - LLM 后端访问（节点可通过 ctx.backend 调用 LLM）
 * - 记忆访问（阶段 0.6 新增：Memory Pattern 横切）
 */
```

## 注释块 3（原文件第 132-144 行）

```
/**
 * 记忆访问器 — 节点通过此接口访问记忆系统
 *
 * 设计原则：
 * - 解耦：不直接依赖 memory-archive，接口可适配任何记忆系统
 * - 可迁移：接口设计可直接映射到 Rust trait
 * - 轻量：只暴露节点需要的核心操作（recall/inject/archive）
 *
 * 三类记忆：
 * - 短期记忆：当前会话的消息历史（state.messages，trim 策略由 ShortTermMemoryHelper 管理）
 * - 工作记忆：ReAct 循环内的观察缓冲（state.extra.workingMemory）
 * - 长期记忆：跨会话的归档记忆（通过此接口检索/注入）
 */
```

## 注释块 4（原文件第 155-164 行）

```
/**
   * 注入记忆摘要到 system prompt
   *
   * 将检索到的记忆摘要拼接到 system prompt 中，供后续 LLM 调用使用。
   * 实现层负责维护"已注入"状态，避免重复注入。
   *
   * @param results 检索结果（来自 recall）
   * @param options 注入选项
   * @returns 注入到 system prompt 的文本片段（空字符串=无注入）
   */
```

## 注释块 5（原文件第 299-312 行）

```
/**
 * 工作记忆条目 — ReAct 循环内的单次观察记录
 *
 * 与 OrchestratorMessage 的区别：
 * - OrchestratorMessage：完整对话历史，含 user/assistant/system/toolResult
 * - WorkingMemoryEntry：仅工具调用的观察结果，是 ReAct 循环内的临时缓冲
 *
 * 用途：
 * - ReAct 节点在工具调用后，将观察结果推入 workingMemory
 * - Reflection/Refine 节点可读取 workingMemory 评估工具使用质量
 * - 循环结束时，workingMemory 可合并到 messages 或丢弃
 *
 * 存储位置：state.extra.workingMemory（数组）
 */
```

## 注释块 6（原文件第 418-429 行）

```
/**
 * 节点接口 — 所有编排模式的基础构建块
 *
 * 实现示例：
 * - ReactNode：包装 pi-agent-core 的 Agent 循环
 * - PlanNode：生成任务计划
 * - ExecuteNode：逐步执行计划项
 * - ReflectionNode：评审输出
 * - RefineNode：基于评审迭代优化
 * - RouterNode：根据输入路由到不同节点
 * - SupervisorNode：分配任务给子 Agent
 */
```

## 注释块 7（原文件第 479-491 行）

```
/**
 * Orchestrator — 编排器，驱动节点图执行
 *
 * 使用方式：
 * 1. 创建 Orchestrator 实例
 * 2. 添加节点和边
 * 3. 调用 run(input) 启动
 * 4. 通过 subscribe 监听事件
 * 5. 通过 abort 中断
 *
 * 阶段 0 实现：简单的线性/条件序列执行器
 * 阶段 2 实现：完整的图执行器（支持并行/回溯）
 */
```
