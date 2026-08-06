# pi-backend-memory-accessor.ts 详细注释文档（packages/agent-runtime/orchestrator）

> 来源：`packages/agent-runtime/src/orchestrator/pi-backend-memory-accessor.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-40 行）

```
PiBackendMemoryAccessor — 将 worldsmith-agent 的 localStorage KV 记忆系统
适配为 MemoryAccessor 接口（阶段 0.7）

核心职责：
1. 适配 MemoryAccessor 接口（agent-core 定义）
2. 包装现有 memory.ts 的 recallMemory/formatMemoryForPrompt 函数
3. 实现 KV 模型 → MemoryRecallResult 格式转换
4. 归档：localStorage KV 模型没有归档概念，archive 返回 null

三层架构位置：
  编排框架层（Orchestrator/Node/Edge）
  Agent loop 层（ReAct/Plan/Reflection）
  LLM 通信层（pi-agent-core）
  记忆系统（memory-archive / localStorage KV）← 本类在此层，适配编排框架的接口

阶段 0.7：实现为对 localStorage KV 记忆的包装
阶段 1：替换为对 Rust memory 模块的 Tauri invoke 包装

使用示例：

```ts
import { PiBackendMemoryAccessor } from './pi-backend-memory-accessor'

const accessor = new PiBackendMemoryAccessor()

// 在 Orchestrator 启动时注入到 NodeContext.memory
const ctx: NodeContext = {
  state,
  emit,
  isAborted,
  waitIfPaused,
  backend,
  memory: accessor, // ← 注入
  log,
}

// 之后 MemoryNode 即可通过 ctx.memory.recall() 检索
```
```

## 注释块 2（原文件第 54-65 行）

```
KV 模型 → MemoryRecallResult 适配器

字段映射：
- key → hookId（KV 模型无 hook 概念，用 key 替代）
- value → summary
- tags → keywords / tags
- accessCount → accessCount
- timestamp → createdAt
- 无匹配字段 → score（用 accessCount 加权计算）
- 无匹配字段 → matchedFields（默认 ['keyword']）
```
