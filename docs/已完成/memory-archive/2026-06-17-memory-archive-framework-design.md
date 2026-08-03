# 记忆库框架设计文档

> **框架名称**：`@worldsmith/memory-archive`
> **版本**：1.0
> **创建时间**：2026-06-17
> **状态**：设计完成，待审核
> **关联文档**：[待定问题清单](./2026-06-17-memory-archive-pending-issues.md)（P1-P18 已全部处理）

---

## 目录

1. [框架概述与定位](#1-框架概述与定位)
2. [架构设计与包结构](#2-架构设计与包结构)
3. [数据模型与文件格式](#3-数据模型与文件格式)
4. [归档流程与检索流程](#4-归档流程与检索流程)
5. [worldsmith 集成方案](#5-worldsmith-集成方案)
6. [周期管理](#6-周期管理)
7. [实施计划与分阶段交付](#7-实施计划与分阶段交付)

---

## 1. 框架概述与定位

### 1.1 框架名称

`@worldsmith/memory-archive`（monorepo 子包，路径 `packages/memory-archive/`）

### 1.2 定位

一个**可复用的对话上下文归档与检索框架**，为 LLM Agent 提供"滑动窗口 + 归档检索"的持久记忆能力。解决长对话中上下文窗口受限的问题，通过"归档边界 + 索引钩子"机制让 Agent 在有限窗口内保持长期记忆连续性。

### 1.3 核心价值

- **对 Agent**：突破上下文窗口限制，通过钩子按需回顾已归档上下文
- **对用户**：对话历史完整保留（前端不变），无感知地享受长期记忆
- **对宿主项目**：纯逻辑层 API，存储/Embedding 内置默认实现，Agent 框架通过接口适配

### 1.4 三层记忆职责划分（worldsmith 语境）

| 层 | 现有/新增 | 职责 | 形态 |
|----|-----------|------|------|
| Memory | 现有 | 快速便利贴 | KV（localStorage） |
| KB | 现有 | 深度知识 | 文档（IndexedDB） |
| **Archive** | **新增** | **对话上下文归档** | **结构化文件（文件系统）** |

### 1.5 设计原则

1. **框架零硬依赖**：核心逻辑不依赖任何具体 Agent 框架、存储实现、embedding 提供商
2. **内置默认 + 接口可替换**：存储和 embedding 内置默认实现，AgentBridge 为必实现接口
3. **文件系统优先**：记忆文件是"完整无损原文"，存储为文件可被外部工具管理
4. **项目隔离**：每个项目独立记忆库目录，通过 `projectId` 区分
5. **渐进式采用**：宿主可选择仅用归档功能，不启用周期管理；或仅用检索，不启用自动归档

---

## 2. 架构设计与包结构

### 2.1 包结构

```
packages/memory-archive/
├── package.json                    # @worldsmith/memory-archive
├── tsconfig.json
├── src/
│   ├── index.ts                    # 公共 API 入口
│   ├── types.ts                    # 所有公共类型定义
│   ├── core/                       # 核心逻辑（零依赖）
│   │   ├── ArchiveManager.ts       # 归档管理器（核心入口）
│   │   ├── ArchiveBoundary.ts      # 归档边界管理
│   │   ├── HookBuilder.ts          # 索引钩子构建器
│   │   ├── MemoryFileWriter.ts     # 记忆文件写入（主题分块）
│   │   └── RecallEngine.ts         # 检索引擎（向量+关键词+混合）
│   ├── scheduler/                  # 周期管理
│   │   └── ArchiveScheduler.ts     # 天/周/月三级调度器（含三个方法）
│   ├── adapters/                   # 适配器接口（宿主实现）
│   │   ├── AgentBridge.ts          # Agent 框架适配接口
│   │   └── ConfigAdapter.ts        # 配置持久化接口（P2 新增）
│   ├── storage/                    # 内置存储实现
│   │   ├── StorageAdapter.ts       # 存储接口
│   │   ├── FsStorageAdapter.ts     # 文件系统实现（Tauri/Node）
│   │   └── IdbStorageAdapter.ts    # IndexedDB 回退实现（Web）
│   ├── embedding/                  # 内置 embedding 实现
│   │   ├── EmbeddingAdapter.ts     # embedding 接口
│   │   └── OpenAIEmbeddingAdapter.ts  # OpenAI 兼容默认实现
│   └── utils/                      # 工具函数
│       ├── tokenCounter.ts         # token 计数
│       ├── chunker.ts              # 主题分块算法
│       ├── decay.ts                # 衰减评分算法
│       ├── rwLock.ts               # 读写锁（P17 新增）
│       └── safeTruncate.ts         # 安全截断点查找（P11 新增）
├── __tests__/                      # 单元测试
└── README.md                       # 框架使用文档（仅框架自身）
```

> **P1 决策**：scheduler 下的三个 Task 合并为 ArchiveScheduler 的方法（runDaily/runWeekly/runMonthly），而非独立类，减少类数量和依赖注入成本。

### 2.2 模块依赖关系

```
                    ┌─────────────────────────────────┐
                    │       ArchiveManager            │  ← 宿主唯一入口
                    │  (归档/检索/边界/生命周期)       │
                    └──────┬──────────┬──────────┬────┘
                           │          │          │
              ┌────────────▼──┐  ┌────▼─────┐  ┌─▼──────────────┐
              │ HookBuilder   │  │RecallEngine│ │ArchiveScheduler│
              │ (构建钩子)    │  │(检索)     │  │(天/周/月周期)  │
              └──────┬────────┘  └────┬──────┘  └────┬───────────┘
                     │                │              │
              ┌──────▼────────────────▼──────────────▼──────────┐
              │              适配器层（依赖反转）                 │
              ├──────────────┬─────────────────┬────────────────┤
              │StorageAdapter│EmbeddingAdapter │ AgentBridge    │
              │(接口)        │(接口)           │(接口·宿主必实现)│
              └──────┬───────┘└────────┬────────┘ └──────┬─────┘
                     │                 │                 │
              ┌──────▼───────┐  ┌──────▼──────┐   ┌──────▼─────┐
              │FsStorage/    │  │OpenAIEmbed  │   │宿主实现    │
              │IdbStorage    │  │(内置默认)   │   │(如 pi-ai)  │
              │(内置默认)    │  │             │   │            │
              └──────────────┘  └─────────────┘   └────────────┘
```

### 2.3 核心模块职责

#### `ArchiveManager`（核心入口）
- 宿主通过此类操作框架，聚合所有子模块
- 提供 `archive()` / `recall()` / `getBoundary()` / `loadChunk()` 等方法
- 管理生命周期（init/start/stop）

#### `ArchiveBoundary`（归档边界）
- 维护"已归档消息索引边界"（当前会话中 Agent 可见消息的起点）
- 提供 `shouldArchive(tokenCount)` 判断是否达到阈值
- 提供 `advanceBoundary(messageIndex)` 推进边界

#### `HookBuilder`（索引钩子构建器）
- 归档时构建 `Hook` 对象（元数据 + 记忆文件引用 + 内部标题 + 关键词 + 向量）
- 调用 `chunker` 进行主题分块，提取块标题
- 调用 `EmbeddingAdapter` 生成向量

#### `RecallEngine`（检索引擎）
- 支持四种检索模式：`keyword` / `semantic` / `hybrid` / `list`（P9 决策：list 模式合入）
- 检索对象是 `Hook`（轻量），命中后返回钩子摘要
- 提供 `loadChunk(hookId, chunkId)` 按需加载记忆文件片段

#### `ArchiveScheduler`（周期调度器）
- 基于 `setInterval` + 上次执行时间戳，避免重复执行
- 天/周/月三个方法（runDaily/runWeekly/runMonthly），可单独启停
- 宿主可注入自定义触发源（如 `agent_end` 事件）
- 使用读写锁（P17 决策）替代简单互斥锁

### 2.4 适配器接口定义

```typescript
// ===== StorageAdapter（存储接口，内置默认实现） =====
export interface StorageAdapter {
  // 钩子（轻量元数据，可全部常驻内存）
  saveHook(hook: Hook): Promise<void>
  loadHook(hookId: string): Promise<Hook | null>
  loadAllHooks(): Promise<Hook[]>
  deleteHook(hookId: string): Promise<void>

  // 记忆文件（分块 JSON 文件，按需加载）
  saveMemoryFile(fileId: string, header: MemoryFileHeader, chunks: MemoryChunk[]): Promise<void>
  loadMemoryFileChunk(fileId: string, chunkId: string): Promise<MemoryChunk>
  deleteMemoryFile(fileId: string): Promise<void>
  listMemoryFiles(): Promise<{ id: string; size: number }[]>  // P2 新增

  // 索引（日/周汇总索引）
  saveIndex(index: ArchiveIndex): Promise<void>
  loadIndices(type: 'daily' | 'weekly'): Promise<ArchiveIndex[]>

  // 统计（P2 新增）
  getStorageStats(): Promise<{ totalHooks: number; totalFiles: number; totalBytes: number }>
}

// ===== EmbeddingAdapter（向量接口，内置默认实现） =====
export interface EmbeddingAdapter {
  isReady(): boolean
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

// ===== AgentBridge（Agent 框架适配，宿主必实现） =====
export interface AgentBridge {
  // 获取当前会话消息（用于归档）
  getCurrentMessages(): AgentMessageSnapshot[]
  // 获取当前上下文 token 数
  getCurrentTokenCount(): number
  // 推进归档边界（清空 Agent 内部已归档消息）
  advanceBoundary(archivedUpToIndex: number): void
  // 注入钩子摘要到 system prompt（新会话/归档后自动注入）
  injectHookSummary(hooks: Hook[]): string
  // 注册工具到 Agent（供 Agent 按需检索归档）
  registerTools(tools: ArchiveTool[]): void
  // 是否正在流式输出（P2 新增，归档前检查）
  isStreaming(): boolean
  // 归档完成回调（P2 新增，可选）
  onArchiveComplete?(callback: (result: ArchiveResult) => void): void
}

// ===== ConfigAdapter（配置持久化接口，P2 新增） =====
export interface ConfigAdapter {
  loadConfig(): Promise<ArchiveConfig | null>
  saveConfig(config: ArchiveConfig): Promise<void>
}
```

### 2.5 依赖关系

**框架自身 `package.json`**：
```json
{
  "name": "@worldsmith/memory-archive",
  "peerDependencies": {},
  "dependencies": {
    "nanoid": "^5.0.0"
  }
}
```

**worldsmith 引用方式**：
```json
{
  "dependencies": {
    "@worldsmith/memory-archive": "workspace:*"
  }
}
```

### 2.6 worldsmith 侧适配器实现位置

> **P3 决策**：PiAiAgentBridge 放在 archive/ 目录，初始化逻辑并入 bridge.ts

```
worldsmith-agent/src/archive/
├── PiAiAgentBridge.ts          # AgentBridge 的 pi-ai 实现
├── archive-tools.ts            # archive_recall/load_chunk/tag/now 工具定义
└── index.ts                    # 导出
```

---

## 3. 数据模型与文件格式

### 3.1 核心数据模型

```typescript
// ===== 索引钩子（轻量，可全部常驻内存） =====
export interface Hook {
  id: string                          // nanoid，唯一标识
  fileId: string                      // 指向记忆文件的 ID
  sessionId: string                   // 来源会话 ID
  projectId: string                   // 项目隔离
  createdAt: number                   // 归档时间戳
  tokenCount: number                  // 归档时的上下文 token 数
  messageRange: {                     // 归档的消息范围
    start: number                     // 起始消息索引（含）
    end: number                       // 结束消息索引（不含）
  }
  // 文件内部结构（主题分块标题，用于精准定位）
  chunkTitles: ChunkTitle[]
  // 关键词标签（归档时自动提取）
  keywords: string[]
  // 用户/Agent 手动标签（P4 新增，区别于自动 keywords）
  tags: string[]
  // 向量嵌入（摘要的向量，用于语义检索）
  embedding?: number[]
  // 摘要（LLM 生成，2K-5K，用于注入和检索展示）
  summary: string
  // 摘要生成方式（P4/P10 新增，检索时降权）
  summaryMethod: 'llm' | 'rule' | 'none'
  // 访问统计（用于衰减评分）
  accessCount: number                 // 总访问次数
  activeAccessCount: number           // 主动检索访问次数（P16 新增，不计自动注入）
  lastAccessedAt: number
  // 衰减状态
  decayScore: number                  // 0-1，低于阈值标记淘汰
  status: 'active' | 'deprecated' | 'pending_delete'
  deprecatedAt?: number               // P4 新增，标记 deprecated 的时间戳
  // 重要性评分（P4 新增，0-1，归档时 LLM 标注，影响衰减权重）
  importance: number                  // 默认 0.5
  // 永久保留标记（P16 新增，pinned=true 跳过衰减）
  pinned: boolean                     // 默认 false
  // 关联钩子（P4 新增，周任务合并时建立）
  relatedHookIds: string[]
  // 归档触发源（P4 新增，用于审计）
  source: 'threshold' | 'session_end' | 'manual'
  // 钩子格式版本（P4 新增，便于未来迁移）
  version: string                     // 默认 '1.0'
  // 宿主扩展字段（P4 新增，如 worldsmith 可存 entityIds）
  customMetadata?: Record<string, unknown>
  // 索引归属（日/周汇总索引引用）
  dailyIndexId?: string
  weeklyIndexId?: string
}

// 主题块标题（记忆文件内部结构索引）
// P5 决策：移除 offset/length 字段（改用分块 JSON 文件，无需偏移）
export interface ChunkTitle {
  chunkId: string                     // 块 ID，对应记忆文件内的块
  title: string                       // 主题标题（如"角色设计讨论"）
  outputType: AgentOutputType         // Agent 输出类型
  userMessageAnchor: string           // 用户消息锚点（首条用户消息摘要，50字内）
  tokenCount: number                  // 该块 token 数
}

// Agent 输出类型（分块维度之一）
export type AgentOutputType =
  | 'text'                            // 纯文本回复
  | 'tool_call'                       // 工具调用
  | 'entity_op'                       // 实体操作
  | 'code'                            // 代码生成
  | 'analysis'                        // 分析推理
  | 'creative'                        // 创意内容
  | 'other'

// ===== 记忆文件（完整无损原文，分块 JSON 文件存储） =====
// P5 决策：改用分块 JSON 文件，每个块独立文件
export interface MemoryFile {
  id: string                          // 与 Hook.fileId 对应
  header: MemoryFileHeader            // 文件头（元数据，固定小体积）
  chunks: MemoryChunk[]               // 主题块数组
}

export interface MemoryFileHeader {
  fileId: string
  projectId: string
  sessionId: string
  createdAt: number
  totalTokens: number
  totalChunks: number
  formatVersion: string               // '1.0'
  encoding: string                    // 'utf-8'
}

// 主题块（记忆文件内部的一个分块）
export interface MemoryChunk {
  chunkId: string
  title: string
  outputType: AgentOutputType
  userMessageAnchor: string
  tokenCount: number
  messages: AgentMessageSnapshot[]    // 该块包含的完整消息快照
}

// Agent 消息快照（归档时的消息快照，与具体 Agent 框架解耦）
export interface AgentMessageSnapshot {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCallId?: string
  toolName?: string
  timestamp: number
  metadata?: Record<string, unknown>  // 宿主可扩展字段（含 outputType，P8 决策）
}

// ===== 汇总索引（日/周周期产物） =====
export interface ArchiveIndex {
  id: string
  type: 'daily' | 'weekly'
  projectId: string
  periodStart: number                 // 周期开始时间戳
  periodEnd: number                   // 周期结束时间戳
  hookIds: string[]                   // 包含的钩子 ID 列表
  summary: string                     // LLM 生成的周期摘要
  keywords: string[]                  // 周期关键词聚合
  embedding?: number[]                // 周期摘要向量
  createdAt: number
}

// ===== 配置 =====
export interface ArchiveConfig {
  // 归档阈值（token 数，达到即触发归档）
  archiveThreshold: number            // 默认 400000（可配置）
  // 最小归档消息数（P7 新增，预检查用）
  minArchiveMessages: number          // 默认 10
  // 归档触发条件
  triggers: {
    onTokenThreshold: boolean         // 达到阈值触发（默认 true）
    onSessionEnd: boolean             // 会话结束触发（默认 true）
    manual: boolean                   // 用户手动触发（默认 true）
  }
  // 周期管理
  scheduler: {
    enabled: boolean                  // 是否启用周期调度（默认 true）
    dailyHour: number                 // 每日执行小时（默认 3，凌晨）
    weeklyDay: number                 // 每周执行星期（默认 0，周日）
    monthlyDay: number                // 每月执行日期（默认 1）
  }
  // 衰减配置
  decay: {
    halfLifeDays: number              // 半衰期（默认 30 天）
    deprecatedThreshold: number       // 软淘汰阈值（P16 调整为 0.15）
    deleteAfterDays: number           // 硬删除天数（默认 90 天）
  }
  // 注入策略
  injection: {
    autoInjectRecentCount: number     // 新会话自动注入最近 N 个钩子摘要（默认 2）
    maxSummaryTokens: number          // 注入摘要最大 token（默认 2000）
  }
  // 分块策略
  chunking: {
    strategy: 'topic'                 // 分块策略（当前仅 topic）
    minChunkTokens: number            // 最小块大小（默认 2000）
    maxChunkTokens: number            // 最大块大小（默认 20000）
  }
  // embedding 配置（P6 新增）
  embedding: {
    model: string                     // 默认 'text-embedding-3-small'
    dimension: number                 // 默认 1536
    batchSize: number                 // 默认 100
  }
  // 摘要配置（P6 新增）
  summary: {
    enabled: boolean                  // 默认 true
    maxLength: number                 // 默认 5000
    method: 'llm' | 'rule'            // 默认 'llm'
  }
  // 存储限制（P6 新增）
  maxHooks: number                    // 默认 1000，达到后触发月任务提前清理
  maxStorageMB: number                // 默认 500，达到后触发清理
  // 排除模式（P6 新增）
  exclusionPatterns: string[]         // 排除消息的正则模式，默认空
}
```

### 3.2 文件系统目录结构

> **P5 决策**：改用分块 JSON 文件，每个块独立文件

```
{projectDir}/.worldsmith/memory-archive/
├── hooks/                           # 索引钩子（JSON 文件，每个钩子一个文件）
│   ├── {hookId}.json
│   └── {hookId}.json
├── files/                           # 记忆文件（分块 JSON，每个归档一个目录）
│   └── {fileId}/
│       ├── header.json              # 文件头元数据
│       └── chunks/
│           ├── {chunkId}.json       # 单个主题块（含完整消息）
│           └── {chunkId}.json
├── indices/                         # 汇总索引
│   ├── daily/
│   │   ├── 2026-06-17.json
│   │   └── 2026-06-18.json
│   └── weekly/
│       ├── 2026-W25.json
│       └── 2026-W26.json
├── logs/                            # 任务执行日志（P18 新增，保留 30 天）
│   └── 2026-06-17.json
├── meta.json                        # 记忆库元数据（版本、统计、最后清理时间、失败队列）
└── config.json                      # 项目级配置覆盖（可选，缺省用默认配置）
```

### 3.3 记忆文件格式（分块 JSON）

> **P5 决策**：每个块独立 JSON 文件，无需字节偏移

**header.json**：
```json
{
  "fileId": "f_abc123",
  "projectId": "p_xyz",
  "sessionId": "s_def",
  "createdAt": 1718600000000,
  "totalTokens": 412000,
  "totalChunks": 8,
  "formatVersion": "1.0",
  "encoding": "utf-8"
}
```

**chunks/{chunkId}.json**：
```json
{
  "chunkId": "c_001",
  "title": "角色设计讨论",
  "outputType": "creative",
  "userMessageAnchor": "帮我设计一个反派角色",
  "tokenCount": 52000,
  "messages": [
    {
      "role": "user",
      "content": "帮我设计一个反派角色",
      "timestamp": 1718600001000
    },
    {
      "role": "assistant",
      "content": "好的，我来设计...",
      "timestamp": 1718600002000,
      "metadata": { "outputType": "creative" }
    },
    {
      "role": "tool",
      "toolName": "entity_create",
      "toolCallId": "tc_001",
      "content": "{\"success\":true}",
      "timestamp": 1718600002500
    }
  ]
}
```

### 3.4 钩子文件格式（JSON）

```json
{
  "id": "h_abc123",
  "fileId": "f_abc123",
  "sessionId": "s_def",
  "projectId": "p_xyz",
  "createdAt": 1718600000000,
  "tokenCount": 412000,
  "messageRange": { "start": 0, "end": 42 },
  "chunkTitles": [
    {
      "chunkId": "c_001",
      "title": "角色设计讨论",
      "outputType": "creative",
      "userMessageAnchor": "帮我设计一个反派角色",
      "tokenCount": 52000
    }
  ],
  "keywords": ["角色设计", "反派", "世界观"],
  "tags": [],
  "embedding": [0.012, -0.034, "..."],
  "summary": "本次对话围绕反派角色设计展开，用户要求设计一个反派角色...",
  "summaryMethod": "llm",
  "accessCount": 3,
  "activeAccessCount": 2,
  "lastAccessedAt": 1718686400000,
  "decayScore": 0.85,
  "status": "active",
  "importance": 0.7,
  "pinned": false,
  "relatedHookIds": [],
  "source": "threshold",
  "version": "1.0",
  "dailyIndexId": "d_20260617",
  "weeklyIndexId": "w_2026w25"
}
```

### 3.5 meta.json 格式（P18 增强）

```json
{
  "version": "1.0",
  "lastDailyRun": 1718600000000,
  "lastWeeklyRun": 1718300000000,
  "lastMonthlyRun": 1718000000000,
  "totalHooks": 42,
  "totalFiles": 38,
  "totalStorageBytes": 15728640,
  "failedDeletions": [],
  "dailyStats": {
    "2026-06-17": { "accessCount": 15, "newHooks": 3 }
  }
}
```

### 3.6 数据流转关系

```
对话上下文（Agent 内部消息）
        │
        ▼  达到阈值/会话结束/手动触发
   ┌─────────────┐
   │  Archiver   │ ── 主题分块 ──→ MemoryChunk[]
   └──────┬──────┘
          │
          ├── 写入 ──→ files/{fileId}/（分块 JSON 文件）
          │
          └── 构建 ──→ Hook（元数据+chunkTitles+keywords+embedding+summary）
                  │
                  └── 写入 ──→ hooks/{hookId}.json

   周期任务：
   Daily  → 生成 indices/daily/{date}.json + 补全缺失向量
   Weekly → 合并同主题钩子去重 + 生成 indices/weekly/{week}.json
   Monthly→ 衰减评分 + 删除过期钩子+记忆文件 + 清理过期索引 + 重算向量
```

### 3.7 与现有系统的数据边界

| 数据 | 归属 | 说明 |
|------|------|------|
| 对话消息（运行时） | 现有 `useAgent.ts` | 归档时通过 `AgentBridge.getCurrentMessages()` 读取快照 |
| 会话持久化 | 现有 `session/manager.ts` | 不改动，归档是额外行为 |
| 记忆文件 | **新增** `memory-archive/files/` | 完整原文，独立存储 |
| 索引钩子 | **新增** `memory-archive/hooks/` | 轻量元数据 |
| KB 条目 | 现有 `kb-store.ts` | 不混淆，KB 是"知识"，Archive 是"对话上下文" |
| Memory KV | 现有 `memory-internal.ts` | 不混淆，Memory 是"便利贴"，Archive 是"完整对话" |

---

## 4. 归档流程与检索流程

### 4.1 归档流程（11 步，P7 优化）

> **P7 决策**：新增 Step 0 预检查，Step 4/5 并行执行

#### 触发时机

```
┌─────────────────────────────────────────────────────────┐
│                    归档触发源                            │
├──────────────┬──────────────┬──────────────────────────┤
│ ① Token 阈值 │ ② 会话结束   │ ③ 用户手动触发           │
│ onTokenThreshold│ onSessionEnd│ manual                 │
├──────────────┼──────────────┼──────────────────────────┤
│ 每轮 prompt  │ agent_end    │ UI 按钮/快捷键           │
│ 前检查       │ 事件触发     │ 调用 archive()          │
└──────┬───────┴──────┬───────┴───────────┬──────────────┘
       │              │                   │
       └──────────────┴───────────────────┘
                      │
                      ▼
              shouldArchive() 判断
                      │
                      ▼
                 executeArchive()
```

#### 归档执行流程（executeArchive）

```
┌─────────────────────────────────────────────────────┐
│ Step 0: 预检查（P7 新增）                             │
│   ✓ AgentBridge.isStreaming() === false              │
│   ✓ 消息数量 >= config.minArchiveMessages (默认 10)  │
│   ✓ 磁盘空间充足                                      │
│   任一条件不满足则跳过归档，记录日志                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 读取待归档消息                                │
│   messages = AgentBridge.getCurrentMessages()        │
│   toArchive = messages[boundary.current : end]       │
│   应用 exclusionPatterns 过滤（P6 新增）              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 主题分块（chunker）                           │
│   四维度分块（P8 决策）：                             │
│   a) 用户消息锚点：每条新 user 消息为潜在分块点      │
│   b) Agent 输出类型：识别 outputType 变化            │
│   c) 工具调用链：toolCall→toolResult 不拆分（P8 新增）│
│   d) 大小约束：超 maxChunkTokens 强制拆分             │
│   输出：MemoryChunk[]                                │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 写入记忆文件（MemoryFileWriter）              │
│   生成 fileId = nanoid()                              │
│   构造 MemoryFileHeader                              │
│   写入分块 JSON 文件（P5 决策）：                     │
│     files/{fileId}/header.json                        │
│     files/{fileId}/chunks/{chunkId}.json              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 4 & 5: 并行生成摘要和向量（P7 优化）             │
│   Promise.all([                                       │
│     generateSummary(chunks),  // Step 4              │
│     generateEmbedding(summary) // Step 5             │
│   ])                                                  │
│                                                       │
│   Step 4 摘要生成：                                   │
│     方式 A（默认）：LLM 生成摘要                      │
│     方式 B（降级）：规则提取，标记 summaryMethod='rule'│
│     方式 C（关闭）：summary 为空，summaryMethod='none'│
│                                                       │
│   Step 5 向量生成：                                   │
│     if EmbeddingAdapter.isReady():                   │
│       embedding = await embed(summary)               │
│     else: embedding = undefined                       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 构建索引钩子（HookBuilder）                   │
│   hook = {                                           │
│     id, fileId, sessionId, projectId,                │
│     createdAt, tokenCount, messageRange,             │
│     chunkTitles, keywords, tags: [],                 │
│     embedding, summary, summaryMethod,               │
│     accessCount: 0, activeAccessCount: 0,            │
│     lastAccessedAt: now,                             │
│     decayScore: 1.0, status: 'active',               │
│     importance: 0.5, pinned: false,                  │
│     relatedHookIds: [], source, version: '1.0'       │
│   }                                                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 持久化钩子（StorageAdapter）                  │
│   await storage.saveHook(hook)                       │
│   更新内存中的 hooks 缓存                             │
│   失败则退避重试 3 次（1s/2s/4s，P10 决策）           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 推进归档边界（AgentBridge）                   │
│   AgentBridge.advanceBoundary(messages.length)       │
│   → 流式检查 + 消息对完整性 + 快照同步（P11 决策）    │
│   → Agent 内部清空已归档消息                          │
│   → 前端 messages 不变（用户仍可见完整历史）          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: 注入钩子摘要（AgentBridge）                   │
│   summaryText = AgentBridge.injectHookSummary([hook])│
│   → 将本次归档的摘要注入当前 system prompt            │
│   → 失败则重试 3 次，仍失败发射 archive:inject-failed│
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 10: 发射事件                                     │
│   emit('archive:complete', { hookId, fileId,         │
│     tokenCount, chunkCount })                        │
│   宿主可监听做后续处理（如 UI 提示）                  │
└─────────────────────────────────────────────────────┘
```

### 4.2 主题分块算法（P8 优化）

> **P8 决策**：新增工具调用链维度，输出类型检测 metadata 优先

```typescript
// 分块决策优先级：
// 1. 工具调用链（toolCall → toolResult 不拆分，P8 新增）
// 2. 用户消息锚点（新 user 消息 → 潜在新块）
// 3. Agent 输出类型变化（text → tool_call → 新块）
// 4. 块大小约束（超 maxChunkTokens 强制拆分）

function chunkMessages(
  messages: AgentMessageSnapshot[],
  config: ChunkingConfig
): MemoryChunk[] {
  const chunks: MemoryChunk[] = []
  let currentChunk: AgentMessageSnapshot[] = []
  let currentType: AgentOutputType | null = null
  let currentAnchor: string = ''
  let inToolCallChain: boolean = false  // P8 新增

  for (const msg of messages) {
    // 识别输出类型（P8 优先级：metadata > toolName > 正则）
    const msgType = detectOutputType(msg)

    // 工具调用链处理（P8 新增）
    if (msg.role === 'assistant' && msg.toolName) {
      inToolCallChain = true
    }
    if (msg.role === 'tool') {
      // toolResult 属于当前链，不拆分
      currentChunk.push(msg)
      continue
    }
    if (inToolCallChain && msg.role === 'assistant' && !msg.toolName) {
      // 工具调用链结束
      inToolCallChain = false
    }

    // 判断是否需要开新块（工具调用链中不拆分）
    const isNewUserMessage = msg.role === 'user'
    const isTypeChanged = msgType !== currentType
    const isOversized = estimateTokens(currentChunk) >= config.maxChunkTokens

    if (!inToolCallChain && 
        (isNewUserMessage || isTypeChanged || isOversized) 
        && currentChunk.length > 0) {
      chunks.push(buildChunk(currentChunk, currentAnchor, currentType))
      currentChunk = []
    }

    if (currentChunk.length === 0 && msg.role === 'user') {
      currentAnchor = truncate(msg.content, 50)
    }
    if (currentChunk.length === 0) {
      currentType = msgType
    }

    currentChunk.push(msg)
  }

  if (currentChunk.length > 0) {
    chunks.push(buildChunk(currentChunk, currentAnchor, currentType))
  }

  return mergeSmallChunks(chunks, config.minChunkTokens)
}

// P8 优化：输出类型检测优先级
function detectOutputType(msg: AgentMessageSnapshot): AgentOutputType {
  // 1. 优先使用 metadata.outputType（若宿主提供）
  if (msg.metadata?.outputType) {
    return msg.metadata.outputType as AgentOutputType
  }
  // 2. 其次使用 toolName
  if (msg.toolName) return 'tool_call'
  // 3. 最后用正则规则（降级方案）
  const content = msg.content
  if (/^```[\s\S]+```/.test(content)) return 'code'
  if (/实体|创建|修改|删除/.test(content) && msg.metadata?.entityOp) return 'entity_op'
  if (/分析|推理|因为|所以|结论/.test(content)) return 'analysis'
  if (/设计|故事|角色|场景|对话/.test(content)) return 'creative'
  return 'text'
}
```

### 4.3 检索流程

> **P9 决策**：archive_list 合入 archive_recall 的 list 模式

#### 检索模式

```typescript
type RecallMode = 'keyword' | 'semantic' | 'hybrid' | 'list'  // P9 新增 list

interface RecallParams {
  query: string                          // 检索查询（list 模式可为空）
  mode: RecallMode                       // 检索模式（默认 hybrid）
  topK?: number                          // 返回钩子数（默认 5）
  minScore?: number                      // 最低相似度（默认 0.25）
  chunkId?: string                       // 指定块加载（按需加载片段时用）
  dateRange?: { start: number; end: number }  // 时间范围过滤
  outputTypes?: AgentOutputType[]        // 输出类型过滤
}
```

#### 检索执行流程

```
Agent 调用 archive_recall 工具
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ list 模式：返回所有钩子元数据（不排序不评分）         │
│ keyword/semantic/hybrid 模式：继续以下流程           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 关键词检索（RecallEngine.keywordSearch）     │
│   评分：                                             │
│     chunkTitle 匹配 +3                               │
│     keywords 精确匹配 +4                             │
│     keywords 包含 +1                                 │
│     summary 包含 +1                                  │
│     userMessageAnchor 包含 +2                        │
│   加权：score += activeAccessCount * 0.05            │
│   规则摘要降权：score *= 0.8（P10 决策）             │
│   返回 topK 钩子                                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 语义检索（RecallEngine.semanticSearch）      │
│   if EmbeddingAdapter.isReady():                     │
│     queryVec = await embed(query)                    │
│     遍历 hooks，计算余弦相似度                        │
│     返回 score > minScore 的 topK 钩子               │
│   else: 跳过                                         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 混合合并（hybrid 模式）                       │
│   语义分 ×5 对齐关键词分量纲                          │
│   合并同 hook 取最高分                                │
│   按总分排序取 topK                                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 返回钩子摘要                                  │
│   更新 accessCount + activeAccessCount（P16 决策）   │
│   更新 lastAccessedAt                                │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 按需加载片段（Agent 决定）                    │
│   Agent 调用 archive_load_chunk：                    │
│     StorageAdapter.loadMemoryFileChunk(fileId,       │
│       chunkId)                                       │
│   → 直接读取单个 JSON 文件（P5 决策）                │
│   → 返回 MemoryChunk（含完整消息）                    │
└─────────────────────────────────────────────────────┘
```

### 4.4 Agent 工具定义（P9 决策）

> **P9 决策**：4 个工具，archive_list 合入 recall，新增 archive_tag

```typescript
// ① 检索/列表归档记忆
const archive_recall = {
  name: 'archive_recall',
  description: '检索已归档的对话上下文记忆。当需要回顾之前的对话内容时使用。',
  parameters: {
    query: { type: 'string', required: false, description: '检索查询（list 模式可空）' },
    mode: { type: 'enum', values: ['keyword', 'semantic', 'hybrid', 'list'], default: 'hybrid' },
    topK: { type: 'number', default: 5 },
    dateRange: { type: 'object', optional: true },
    outputTypes: { type: 'array', optional: true }
  }
}

// ② 加载记忆片段
const archive_load_chunk = {
  name: 'archive_load_chunk',
  description: '加载指定归档记忆的指定主题块完整内容。recall 后需要查看具体对话时使用。',
  parameters: {
    hookId: { type: 'string', required: true },
    chunkId: { type: 'string', required: true }
  }
}

// ③ 给钩子打标签（P9 新增）
const archive_tag = {
  name: 'archive_tag',
  description: '给归档记忆钩子打标签，标记重要记忆。',
  parameters: {
    hookId: { type: 'string', required: true },
    tags: { type: 'array', required: true, description: '标签列表' }
  }
}

// ④ 手动归档
const archive_now = {
  name: 'archive_now',
  description: '立即归档当前对话上下文。当对话过长需要压缩时使用。',
  parameters: {}
}
```

### 4.5 错误处理（P10 优化）

| 场景 | 处理策略 |
|------|----------|
| 归档时存储写入失败 | 退避重试 3 次（1s/2s/4s），仍失败发射 `archive:error`，标记 `archiveFailed`，下次 prompt() 前重试 |
| 归档时 LLM 摘要失败 | 降级为规则提取，标记 `summaryMethod: 'rule'`，检索时降权（score × 0.8） |
| 归档时 embedding 失败 | embedding 设为 undefined，等日任务补全 |
| 检索时无 embedding | 仅返回关键词检索结果，提示 Agent "语义检索不可用" |
| 加载片段时文件不存在 | 返回错误，标记钩子 `status='deprecated'` |
| 边界推进失败 | 回滚已写入的记忆文件和钩子，发射 `archive:error` |
| 注入摘要失败 | 重试 3 次，仍失败发射 `archive:inject-failed` |
| 周期任务互斥超时 | 30 秒超时，放弃当前周期任务，下次再执行 |

### 4.6 并发控制（P17 优化）

> **P17 决策**：改用读写锁 + 分批执行

- **归档操作**：exclusive 锁（写记忆文件+钩子）
- **日任务**：shared 锁（只读 hooks，写索引时升级为 exclusive）
- **周/月任务**：exclusive 锁（写钩子+删除文件），分批执行（每批 50 个钩子，批间释放锁 100ms）
- **检索操作**：无锁（读取 hooksCache 的快照）
- **可中断机制**：长任务每批检查 `interruptFlag`，用户触发归档时暂停任务
- **hooksCache 竞态防护**：周期任务修改钩子时 Copy-on-Write，修改完成后原子替换缓存引用

---

## 5. worldsmith 集成方案

> **实现路径说明**（2026-06-19 更新）：
> 设计文档预设集成层位于 `worldsmith-agent/src/archive/`，实际实现位于 `src/memory-archive/`。
> 这是因为 `worldsmith-agent` 是独立的 Agent 框架包，记忆库集成层属于宿主应用层，
> 放在 `src/memory-archive/` 更符合职责分离原则。
> 功能等价，路径不同。以下章节中的代码示例路径为设计预设，实际实现路径见各文件注释。

### 5.1 集成架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      worldsmith 应用层                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  AgentChat   │  │ MemoryShelf  │  │ ArchivePanel     │  │
│  │  (Vue 组件)  │  │ KnowledgeWall│  │ (新增 Vue 面板)   │  │
│  └──────┬───────┘  └──────────────┘  └────────┬─────────┘  │
│         │                                      │            │
│         │ useAgent.ts          useArchiveStore │ useArchive │
│         │   - messages         (Pinia, P13)    │ (新增)     │
│         │   - archivedBoundaryIndex            │            │
│         │                                      │            │
│  ┌──────▼──────────────────────────────────────▼────────┐  │
│  │              worldsmith-agent 包                      │  │
│  │                                                       │  │
│  │  ┌─────────────────┐  ┌──────────────────────────┐  │  │
│  │  │   bridge.ts     │  │  archive/  (新增)         │  │  │
│  │  │   - prompt()    │  │  - PiAiAgentBridge.ts     │  │  │
│  │  │   - 归档触发    │  │  - archive-tools.ts       │  │  │
│  │  │   - 钩子注入    │  │  - index.ts               │  │  │
│  │  │   - initArchive │  │                           │  │  │
│  │  └────────┬────────┘  └───────────┬──────────────┘  │  │
│  │           │                        │                  │  │
│  └───────────┼────────────────────────┼──────────────────┘  │
│              │                        │                      │
│  ┌───────────▼────────────────────────▼──────────────────┐  │
│  │       @worldsmith/memory-archive (框架包)              │  │
│  │                                                        │  │
│  │  ArchiveManager ←── FsStorageAdapter (复用项目目录)    │  │
│  │       ↑            OpenAIEmbeddingAdapter (复用配置)   │  │
│  │       │                        ↑                       │  │
│  │  AgentBridge (接口) ────────── PiAiAgentBridge (实现)  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 PiAiAgentBridge 实现（P11 优化）

> **P11 决策**：增加流式检查、消息对完整性、快照同步

```typescript
// worldsmith-agent/src/archive/PiAiAgentBridge.ts
import type { AgentBridge, Hook, AgentMessageSnapshot } from '@worldsmith/memory-archive'
import type { Agent } from '@earendil-works/pi-agent-core'
import { findSafeTruncatePoint } from '@worldsmith/memory-archive'

export class PiAiAgentBridge implements AgentBridge {
  private agent: Agent
  private archivedBoundaryIndex: number = 0
  private hookSummaryCache: string = ''

  constructor(agent: Agent) {
    this.agent = agent
  }

  getCurrentMessages(): AgentMessageSnapshot[] {
    return this.agent.state.messages
      .slice(this.archivedBoundaryIndex)
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        toolCallId: m.tool_call_id,
        toolName: m.name,
        timestamp: m.timestamp || Date.now(),
        metadata: m.metadata
      }))
  }

  getCurrentTokenCount(): number {
    return estimateTokens(this.getCurrentMessages())
  }

  isStreaming(): boolean {
    return this.agent.isStreaming === true
  }

  // P11 决策：安全截断
  advanceBoundary(archivedUpToIndex: number): void {
    // 1. 确认非流式
    if (this.agent.isStreaming) {
      throw new Error('Cannot advance boundary during streaming')
    }
    // 2. 找到安全截断点（保持消息对完整）
    const safeIndex = findSafeTruncatePoint(this.agent.state.messages, archivedUpToIndex)
    // 3. 截断
    this.agent.state.messages = this.agent.state.messages.slice(safeIndex)
    // 4. 同步本地快照
    // this._state.messages = this.agent.state.messages  // 由 bridge.ts 处理
    // 5. 持久化边界索引（P12 决策，abort 恢复用）
    sessionStorage.setItem('archive:boundary', String(safeIndex))
    this.archivedBoundaryIndex = 0  // 重置为 0，因为已截断
  }

  // P12 决策：恢复边界（ensureAgent 重建后调用）
  restoreBoundary(): void {
    const saved = sessionStorage.getItem('archive:boundary')
    if (saved) {
      this.archivedBoundaryIndex = parseInt(saved, 10) || 0
    }
  }

  // P12 决策：重置边界（clearHistory 调用）
  resetBoundary(): void {
    this.archivedBoundaryIndex = 0
    sessionStorage.removeItem('archive:boundary')
  }

  injectHookSummary(hooks: Hook[]): string {
    if (hooks.length === 0) return ''
    const text = hooks.map(h => {
      const date = new Date(h.createdAt).toLocaleString('zh-CN')
      const titles = h.chunkTitles.map(c => c.title).join(', ')
      return `### 归档记忆 ${date}\n${h.summary}\n主题块: ${titles}`
    }).join('\n\n')
    this.hookSummaryCache = text
    return `[归档记忆]\n${text}`
  }

  getHookSummaryForPrompt(): string {
    return this.hookSummaryCache
  }

  registerTools(tools: ArchiveTool[]): void {
    for (const tool of tools) {
      this.agent.registerTool(tool.name, {
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute
      })
    }
  }
}
```

### 5.3 bridge.ts 改造点（P12 优化）

> **P12 决策**：补充 5 个集成点
>
> **实现说明**（2026-06-19 更新）：
> 实际实现未修改 bridge.ts，而是通过 `src/memory-archive/useArchiveTriggers.ts` composable
> 用观察者模式（watch + setInterval + window 事件）实现 5 个触发器：
> 1. 初始化触发器：watch useAgent.isInitialized + currentProject
> 2. session_end 触发器：watch isStreaming: true→false
> 3. token 阈值触发器：setInterval 30 秒检查
> 4. 会话切换触发器：watch currentSessionId
> 5. 项目切换触发器：window 'project:switched' 事件
>
> 边界管理（abort 恢复/clearHistory 重置/ensureInitialized 恢复）通过 useAgent.ts
> 调用 `useArchiveStore()`（Pinia store + sessionStorage）实现，而非修改 bridge.ts。
> 此方案最小化对 useAgent.ts 的侵入，且功能等价。

```typescript
class CoreBackend implements IAgentBackend {
  private archiveManager: ArchiveManager | null = null
  private agentBridge: PiAiAgentBridge | null = null

  async prompt(text: string, options: PromptOptions): Promise<void> {
    // Step 0: 归档触发检查（P12 增加 !isStreaming && !isToolExecuting 条件）
    if (this.archiveManager && this.config.triggers.onTokenThreshold) {
      if (!this.agentBridge!.isStreaming() && !this.isToolExecuting) {
        const tokenCount = this.agentBridge!.getCurrentTokenCount()
        if (tokenCount >= this.config.archiveThreshold) {
          await this.archiveManager.archive({
            source: 'threshold',
            reason: `token count ${tokenCount} >= ${this.config.archiveThreshold}`
          })
        }
      }
    }

    // Step 1: 构建 system prompt，增加 [归档记忆] 区块
    let prompt = this.originalSystemPrompt
    prompt += this.buildContextInjection()
    prompt += await this.buildMemoryBlock(text)
    prompt += await this.buildKbBlock(text)
    prompt += this.agentBridge?.getHookSummaryForPrompt() || ''  // 新增
    prompt += this.buildSkillBlock()

    this.agent.state.systemPrompt = prompt
    await retryWithBackoff(() => this.agent.prompt(text))
  }

  // P12 决策：abort 处理归档状态
  async abort(): Promise<void> {
    if (this.agent) {
      const savedMessages = [...(this.agent.state?.messages || [])]
      this.agent.abort()
      if (this.unsub) this.unsub()
      this.agent = null
      this.agentInitPromise = null
      try {
        const newAgent = await this.ensureAgent()
        if (savedMessages.length > 0) {
          newAgent.state.messages = savedMessages
        }
        // P12 新增：恢复归档边界
        this.agentBridge?.restoreBoundary()
      } catch (err) {
        console.warn('[Agent] abort: failed to rebuild agent:', err)
      }
    }
  }

  // P12 决策：clearHistory 重置边界
  clearHistory(): void {
    if (this.agent) {
      this.agent.state.messages = []
    }
    this._state.messages = []
    // P12 新增：重置归档边界
    this.agentBridge?.resetBoundary()
  }

  // P12 决策：ensureAgent 重建后恢复边界
  async ensureAgent(): Promise<Agent> {
    // ... 现有逻辑 ...
    const agent = new Agent({ /* ... */ })
    // P12 新增：恢复归档边界
    this.agentBridge?.restoreBoundary()
    return agent
  }

  onAgentEnd() {
    if (this.archiveManager && this.config.triggers.onSessionEnd) {
      this.archiveManager.archive({ source: 'session_end' }).catch(err => {
        console.error('[Archive] session_end archive failed:', err)
      })
    }
  }

  async initArchive(projectId: string, projectDir: string | null) {
    const { ArchiveManager, FsStorageAdapter, OpenAIEmbeddingAdapter } =
      await import('@worldsmith/memory-archive')

    this.agentBridge = new PiAiAgentBridge(this.agent)

    const storage = projectDir
      ? new FsStorageAdapter({ basePath: `${projectDir}/.worldsmith/memory-archive` })
      : null

    this.archiveManager = new ArchiveManager({
      agentBridge: this.agentBridge,
      storage,
      embedding: new OpenAIEmbeddingAdapter({
        apiKey: getEmbeddingApiKey(),
        model: getEmbeddingModel()
      }),
      projectId,
      config: loadArchiveConfig()
    })

    await this.archiveManager.init()

    const tools = createArchiveTools(this.archiveManager)
    this.agentBridge.registerTools(tools)

    const recentHooks = await this.archiveManager.getRecentHooks(
      this.config.injection.autoInjectRecentCount
    )
    this.agentBridge.injectHookSummary(recentHooks)
  }
}
```

### 5.4 useAgent.ts 改造（P13 优化）

> **P13 决策**：改用 Pinia store + sessionStorage 持久化

```typescript
// src/stores/archiveStore.ts (新增)
import { defineStore } from 'pinia'

export const useArchiveStore = defineStore('archive', {
  state: () => ({
    archivedBoundaryIndex: parseInt(sessionStorage.getItem('archive:boundary') || '0', 10)
  }),
  actions: {
    setBoundary(index: number) {
      this.archivedBoundaryIndex = index
      sessionStorage.setItem('archive:boundary', String(index))
    },
    resetBoundary() {
      this.archivedBoundaryIndex = 0
      sessionStorage.removeItem('archive:boundary')
    }
  }
})

// useAgent.ts 改造
import { useArchiveStore } from '@/stores/archiveStore'

const archiveStore = useArchiveStore()

async function archiveNow() {
  if (!archiveManager) return
  const result = await archiveManager.archive({ source: 'manual' })
  toastSuccess(`已归档 ${result.tokenCount} tokens，生成 ${result.chunkCount} 个主题块`)
}

// 归档完成时更新边界（替代 window 事件）
archiveManager.on('archive:complete', (result) => {
  archiveStore.setBoundary(result.newBoundaryIndex)
})
```

### 5.5 AgentMessageList.vue 改造

> **实现说明**（2026-06-19 更新）：
> 设计文档预设的 `archivedMessages = messages.slice(0, boundaryIndex)` 分割方式
> 不适用于实际实现，因为 `advanceBoundary` 已删除已归档消息（messages 数组不再包含它们）。
> 实际实现采用"归档摘要折叠提示"方案：
> 1. 当 `archivedBoundaryIndex > 0` 时，在消息列表顶部显示"已归档 N 条消息"提示
> 2. 点击提示展开/收起归档摘要（从 messages 中查找 `source='memory-archive'` 的系统消息）
> 3. 提供"打开记忆库面板"按钮跳转到 ArchivePanel 查看详情
> 4. 通过 `@open-archive-panel` 事件通知父组件打开 ArchivePanel
>
> 此方案避免了与 advanceBoundary 截断消息的冲突，同时提供了良好的 UX。

```vue
<template>
  <div class="message-list">
    <div v-if="archiveStore.archivedBoundaryIndex > 0" class="archived-section">
      <div class="archived-divider">
        <button @click="showArchived = !showArchived">
          {{ showArchived ? '收起' : '展开' }}已归档消息 ({{ archiveStore.archivedBoundaryIndex }} 条)
        </button>
      </div>
      <template v-if="showArchived">
        <AgentMessageBubble
          v-for="msg in archivedMessages"
          :key="msg.id"
          :message="msg"
          :archived="true"
        />
      </template>
    </div>

    <AgentMessageBubble
      v-for="msg in activeMessages"
      :key="msg.id"
      :message="msg"
    />
  </div>
</template>

<script setup>
import { useArchiveStore } from '@/stores/archiveStore'
const archiveStore = useArchiveStore()
const showArchived = ref(false)

const archivedMessages = computed(() =>
  messages.value.slice(0, archiveStore.archivedBoundaryIndex)
)
const activeMessages = computed(() =>
  messages.value.slice(archiveStore.archivedBoundaryIndex)
)
</script>
```

### 5.6 ArchivePanel.vue（P14 分期）

> **P14 决策**：第一期核心功能，第二期高级功能

**第一期（Phase 4 必做）**：
- 钩子列表（含日期、tokens、状态、摘要预览）
- 钩子详情查看（完整 chunkTitles、accessCount、decayScore、keywords、tags）
- 片段加载查看（ChunkViewer）
- 搜索功能（关键词搜索）
- 统计信息（钩子数、总 tokens、存储占用）
- 手动归档按钮
- 配置入口（阈值、周期开关）

**第二期（后续迭代）**：
- 时间轴视图、手动删除/标记、导出、日/周/月索引查看、存储管理、统一入口

### 5.7 三层记忆协同

```
[System Prompt]
├── 身份声明 + 人格预设
├── [上下文] 项目摘要 (builder.ts)
├── [长期记忆] Memory KV (memory.ts)          ← 现有
├── [知识库] KB 条目 (kb-tools.ts)            ← 现有
├── [归档记忆] Archive 钩子摘要 (新增)         ← 新增
└── [技能] Skill 上下文
```

---

## 6. 周期管理

### 6.1 调度器架构（P1/P17 优化）

> **P1 决策**：三个 Task 合并为 ArchiveScheduler 的方法
> **P17 决策**：改用读写锁 + 分批执行

```typescript
export class ArchiveScheduler {
  private lastDailyRun: number = 0
  private lastWeeklyRun: number = 0
  private lastMonthlyRun: number = 0
  private rwLock:ReadWriteLock = new ReadWriteLock()  // P17 读写锁
  private interruptFlag: boolean = false               // P17 可中断
  private timer: NodeJS.Timeout | null = null

  start(): void {
    this.timer = setInterval(() => this.checkAndRun(), 60 * 60 * 1000)
    this.checkAndRun()  // 启动时补执行
  }

  // P17 决策：分批执行
  private async runBatched<T>(
    items: T[],
    batchSize: number,
    fn: (batch: T[]) => Promise<void>
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      if (this.interruptFlag) return  // P17 可中断
      const batch = items.slice(i, i + batchSize)
      await fn(batch)
      await new Promise(r => setTimeout(r, 100))  // 批间释放锁 100ms
    }
  }
}
```

### 6.2 日任务（索引周期）—— P15 调整

> **P15 决策**：移除"补全无钩子文件"（归档时保证原子性），保留补全缺失向量

**执行频率**：每日 1 次（默认凌晨 3 点）

```
日任务流程：
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 补全缺失的向量（shared 锁）                   │
│   for hook in hooks where hook.embedding == null:   │
│     if embedding.isReady():                         │
│       hook.embedding = await embed(hook.summary)    │
│       await storage.saveHook(hook)                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 生成当日索引（exclusive 锁）                  │
│   todayHooks = hooks.filter(h => isSameDay(h.createdAt))│
│   if todayHooks.length == 0: 跳过                    │
│   生成日索引摘要（LLM 或规则）                        │
│   生成日索引向量                                      │
│   保存：indices/daily/{today}.json                   │
│   更新 hook.dailyIndexId                             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 更新访问统计快照                              │
│   保存到 meta.json 的 dailyStats 字段                │
└─────────────────────────────────────────────────────┘
```

### 6.3 周任务（索引整理）—— P15 调整

> **P15 决策**：移除"重算向量防漂移"（改到月任务）

**执行频率**：每周 1 次（默认周日）

```
周任务流程：
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 识别同主题钩子组（exclusive 锁，分批执行）    │
│   取最近 7 天的 hooks                                │
│   按关键词相似度聚类（Jaccard > 0.5）                │
│   输出：HookGroup[]                                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 合并去重（P18 幂等性检查）                    │
│   for group in hookGroups:                          │
│     跳过已 deprecated 的钩子（P18 决策）             │
│     选择组内 decayScore 最高的钩子作为"主钩子"       │
│     其他钩子标记 status='deprecated' + deprecatedAt  │
│     主钩子.keywords = union(group.keywords)         │
│     主钩子.relatedHookIds = group.otherIds          │
│     主钩子.summary = LLM 合并摘要                    │
│     重新生成主钩子向量                               │
│     保存主钩子，更新其他钩子状态                      │
│   注意：不删除记忆文件，仅标记钩子 deprecated         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 生成周索引                                    │
│   week = getISOWeek(now)                             │
│   生成周索引摘要 + 向量                               │
│   保存：indices/weekly/{week}.json                   │
│   更新 hook.weeklyIndexId                            │
└─────────────────────────────────────────────────────┘
```

### 6.4 月任务（检索清理）—— P15 调整

> **P15 决策**：新增"重算向量防漂移"（从周任务移入）

**执行频率**：每月 1 次（默认 1 号）

```
月任务流程：
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 衰减评分（exclusive 锁，分批执行）            │
│   for hook in hooks where status='active':          │
│     if hook.pinned: 跳过（P16 决策）                 │
│     hook.decayScore = calculateDecayScore(hook, now) │
│     if hook.decayScore < deprecatedThreshold:        │
│       hook.status = 'deprecated'                     │
│       hook.deprecatedAt = now                        │
│     await storage.saveHook(hook)                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 硬删除过期 deprecated 钩子                    │
│   for hook in hooks where status='deprecated':      │
│     if (now - hook.deprecatedAt) > deleteAfterDays:  │
│       if not isReferencedByIndex(hook):              │
│         try:                                        │
│           await storage.deleteMemoryFile(hook.fileId)│
│           await storage.deleteHook(hook.id)          │
│         catch:                                      │
│           meta.failedDeletions.push(hook.fileId)     │
│           // P18 决策：失败队列，下次重试             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 清理未引用的记忆文件                          │
│   orphanFiles = files.filter(f => !referencedFileIds)│
│   删除孤儿文件                                       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 清理过期索引                                  │
│   保留最近 90 天的日索引                              │
│   保留最近 12 周的周索引                              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 重算向量防漂移（P15 从周任务移入）            │
│   检测 embedding 维度是否变化                         │
│   if 维度不匹配 or config.forceRebuild:              │
│     for hook in hooks where status='active':        │
│       hook.embedding = await embed(hook.summary)    │
│       await storage.saveHook(hook)                   │
│   发射 'archive:vectors-rebuilt' 事件                │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 更新 meta.json                                │
│   lastMonthlyCleanup = now                           │
│   totalHooks/totalFiles/totalStorageBytes            │
│   清理 failedDeletions 中已成功的项                   │
└─────────────────────────────────────────────────────┘
```

### 6.5 衰减评分算法（P16 优化）

> **P16 决策**：增加 recency 和 importance 因子，区分主动/自动访问

```typescript
export function calculateDecayScore(hook: Hook, now: number, params: DecayParams): number {
  // pinned 钩子跳过衰减（P16 决策）
  if (hook.pinned) return 1.0

  const ageDays = (now - hook.createdAt) / (24 * 60 * 60 * 1000)

  // 时间衰减因子：半衰期模型
  const timeFactor = Math.pow(0.5, ageDays / params.halfLifeDays)

  // 访问频次因子：仅计主动检索访问（P16 决策）
  const accessFactor = Math.log(1 + hook.activeAccessCount) / Math.log(10)

  // 最近访问因子（P16 新增）
  const daysSinceLastAccess = (now - hook.lastAccessedAt) / (24 * 60 * 60 * 1000)
  let recencyFactor: number
  if (daysSinceLastAccess <= 7) recencyFactor = 1.0
  else if (daysSinceLastAccess <= 30) recencyFactor = 0.5
  else recencyFactor = 0

  // 重要性权重（P16 新增）
  const importanceWeight = 0.5 + hook.importance * 0.5

  // 综合评分（P16 新公式）
  const score = timeFactor * (0.4 + 0.3 * accessFactor + 0.3 * recencyFactor) * importanceWeight
  return Math.max(0, Math.min(1, score))
}
```

### 6.6 失败恢复（P18 优化）

> **P18 决策**：补充任务日志、失败队列、meta.json 重建

| 失败场景 | 恢复策略 |
|---------|----------|
| 日任务中途失败 | 已完成步骤不回滚，下次补全剩余；钩子补全后立即设置 dailyIndexId |
| 周任务合并失败 | P18 幂等性：合并前检查 status，已 deprecated 跳过 |
| 月任务删除失败 | 记录到 meta.failedDeletions[]，下次重试 |
| 调度器崩溃重启 | 从 meta.json 恢复 lastRun 时间戳；meta.json 损坏则从 hooks/ 重建 |
| 长期未启动补执行 | P18：超过 3 次则只执行最近 1 次 |
| LLM 摘要失败 | 降级规则提取，标记 summaryMethod='rule' |
| 向量重算失败 | embedding=null，下次日任务 Step 1 补全 |
| 任务执行日志 | 新增 logs/ 目录，保留 30 天，记录任务名/时间/状态/错误 |

---

## 7. 实施计划与分阶段交付

### 7.1 分阶段交付策略

```
Phase 1: 框架核心（可独立测试）
    ↓
Phase 2: worldsmith 集成（端到端可用）
    ↓
Phase 3: 周期管理（自动化运维）
    ↓
Phase 4: UI 面板与优化（用户体验）
```

### 7.2 Phase 1：框架核心

**目标**：完成 `@worldsmith/memory-archive` 框架包的核心逻辑

**任务分解**：

| # | 任务 | 依赖 |
|----|------|------|
| 1.1 | 初始化包结构 | - |
| 1.2 | 定义 types.ts（含 P4/P5/P6 字段） | 1.1 |
| 1.3 | 定义四个适配器接口（含 P2 补充） | 1.2 |
| 1.4 | 实现 tokenCounter | 1.2 |
| 1.5 | 实现 chunker（含 P8 工具调用链） | 1.2, 1.4 |
| 1.6 | 实现 decay（含 P16 新算法） | 1.2 |
| 1.7 | 实现 rwLock（P17 读写锁） | - |
| 1.8 | 实现 safeTruncate（P11 安全截断） | 1.2 |
| 1.9 | 实现 FsStorageAdapter（P5 分块 JSON） | 1.3 |
| 1.10 | 实现 IdbStorageAdapter | 1.3 |
| 1.11 | 实现 OpenAIEmbeddingAdapter | 1.3 |
| 1.12 | 实现 ArchiveBoundary | 1.2 |
| 1.13 | 实现 HookBuilder | 1.2, 1.5, 1.11 |
| 1.14 | 实现 MemoryFileWriter（P5 分块 JSON） | 1.2, 1.9 |
| 1.15 | 实现 RecallEngine（含 P9 list 模式） | 1.2, 1.11 |
| 1.16 | 实现 ArchiveManager（11 步归档，P7 并行） | 1.12-1.15 |
| 1.17 | 编写单元测试 | 1.16 |

### 7.3 Phase 2：worldsmith 集成

**目标**：将框架集成到 worldsmith，实现端到端归档与检索

**任务分解**：

| # | 任务 | 依赖 |
|----|------|------|
| 2.1 | 创建 archive/ 目录结构 | Phase 1 |
| 2.2 | 实现 PiAiAgentBridge（含 P11 安全截断） | 2.1 |
| 2.3 | 实现 archive-tools.ts（4 工具，P9） | 2.2 |
| 2.4 | 改造 bridge.ts（含 P12 五个集成点） | 2.2, 2.3 |
| 2.5 | 创建 useArchiveStore（P13 Pinia） | - |
| 2.6 | 改造 useAgent.ts | 2.4, 2.5 |
| 2.7 | 改造 AgentMessageList.vue | 2.6 |
| 2.8 | 项目切换处理 | 2.4 |
| 2.9 | 端到端测试 | 2.8 |

### 7.4 Phase 3：周期管理

**目标**：实现天/周/月三级周期任务自动化

**任务分解**：

| # | 任务 | 依赖 |
|----|------|------|
| 3.1 | 实现 ArchiveScheduler（含 P17 读写锁） | Phase 1 |
| 3.2 | 实现 runDaily（P15 调整后） | 3.1 |
| 3.3 | 实现 runWeekly（P15 调整后） | 3.1 |
| 3.4 | 实现 runMonthly（P15 调整后） | 3.1 |
| 3.5 | 宿主事件注入 | 3.2-3.4 |
| 3.6 | 失败恢复机制（P18） | 3.5 |
| 3.7 | 集成到 worldsmith | Phase 2, 3.6 |
| 3.8 | 周期任务测试 | 3.7 |

### 7.5 Phase 4：UI 面板与优化

**目标**：提供记忆库管理 UI 和性能优化（P14 第一期）

**任务分解**：

| # | 任务 | 依赖 |
|----|------|------|
| 4.1 | 实现 ArchivePanel.vue（P14 第一期） | Phase 2 |
| 4.2 | 实现 ChunkViewer.vue | 4.1 |
| 4.3 | 配置 UI | 4.1 |
| 4.4 | 注册到面板系统 | 4.1 |
| 4.5 | 性能优化 | 4.4 |
| 4.6 | 集成测试 | 4.5 |

### 7.6 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| pi-ai state.messages 截断安全性 | 低 | 高 | P11 已验证，增加流式检查+消息对完整+快照同步 |
| 分块 JSON 文件数量多 | 低 | 低 | 每个归档一个子目录，目录组织清晰 |
| Embedding API 调用成本 | 中 | 中 | 批量调用 + 缓存 + 月任务重算（P15 调整频率） |
| 周期任务阻塞用户操作 | 中 | 中 | P17 读写锁 + 分批执行 + 可中断 |
| 前端边界索引不同步 | 中 | 高 | P13 Pinia store + sessionStorage 持久化 |
| 响应式过度影响性能 | 低 | 低 | 归档逻辑用 shallowRef，避免深度响应式 |

### 7.7 测试策略

**单元测试**（Phase 1）：
- chunker：各种消息组合的分块结果（含工具调用链）
- decay：不同时间/访问频次/importance 的评分
- FsStorageAdapter：分块 JSON 文件读写/删除/列表
- RecallEngine：四种检索模式（含 list）的结果排序
- rwLock：读写锁并发控制
- safeTruncate：安全截断点查找

**集成测试**（Phase 2-3）：
- 完整归档流程：11 步（含预检查、并行摘要/向量）
- 完整检索流程：查询 → 检索 → 加载片段
- 周期任务：模拟时间推进，验证三级任务（P15 调整后）
- 失败恢复：P18 场景验证

**端到端测试**（Phase 4）：
- 真实对话场景：长对话自动归档 + 检索回顾
- 项目切换：归档状态正确隔离
- UI 交互：面板浏览/搜索/配置

---

## 附录：P1-P18 问题结论汇总

| 编号 | 核心结论 |
|------|---------|
| P1 | 保持划分，scheduler 三任务合并为方法 |
| P2 | 补充 4 个方法，新增 ConfigAdapter |
| P3 | 保持 archive/ 目录，初始化并入 bridge.ts |
| P4 | Hook 补充 8 个字段 |
| P5 | 改用分块 JSON 文件方案 |
| P6 | 补充 5 个配置项 |
| P7 | 优化为 11 步，新增预检查，Step4/5 并行 |
| P8 | 新增工具调用链维度，输出类型检测 metadata 优先 |
| P9 | 4 工具，archive_list 合入 recall，新增 archive_tag |
| P10 | 补充退避重试和 summaryMethod 降权 |
| P11 | 基本安全，增加流式检查/消息对完整/快照同步 |
| P12 | 补充 5 个集成点 |
| P13 | 改用 Pinia store + sessionStorage 持久化 |
| P14 | 分两期，第一期核心功能 |
| P15 | 调整职责，重算向量移到月任务 |
| P16 | 新算法增加 recency 和 importance 因子，新增 pinned |
| P17 | 改用读写锁 + 分批执行 + 可中断 |
| P18 | 补充任务日志/失败队列/meta.json 重建/幂等性 |

---

**文档结束**
