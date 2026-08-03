# 记忆库框架设计 - 待定问题清单

> 本文档记录在设计讨论过程中识别的待定问题，后续统一处理。
> 创建时间：2026-06-17
> 关联设计文档：`2026-06-17-memory-archive-framework-design.md`
> 处理状态：全部已处理（2026-06-17）

---

## 问题清单与结论

### P1 - 模块划分粒度是否合适？

**来源**：第 2 节确认时提出
**状态**：✅ 已处理
**结论**：保持当前划分，但做一处调整

**决策**：
- **保留** HookBuilder 和 MemoryFileWriter 分离：两者职责不同（构建元数据 vs 写文件），分离便于测试和复用
- **保留** RecallEngine 不拆分：检索和加载片段是同一检索流程的两步，拆分会增加调用复杂度
- **调整** scheduler 下的三个 Task 改为 ArchiveScheduler 的方法（runDaily/runWeekly/runMonthly），而非独立类：三级任务共享 storage/embedding/hooksCache 依赖，合并为方法减少类数量和依赖注入成本

**影响**：包结构中 `scheduler/` 下仅保留 `ArchiveScheduler.ts`，删除 DailyTask/WeeklyTask/MonthlyTask 三个文件

---

### P2 - 三个适配器接口的方法是否覆盖了需求？

**来源**：第 2 节确认时提出
**状态**：✅ 已处理
**结论**：补充 4 个方法，新增 ConfigAdapter 接口

**决策**：
- **StorageAdapter 补充**：
  - `listMemoryFiles(): Promise<{id: string, size: number}[]>` — 月任务清理未引用文件需要
  - `getStorageStats(): Promise<{totalHooks: number, totalFiles: number, totalBytes: number}>` — UI 统计需要
- **AgentBridge 补充**：
  - `isStreaming(): boolean` — 归档前需确认非流式状态（P11 风险点）
  - `onArchiveComplete?(callback: (result: ArchiveResult) => void): void` — 可选，宿主监听归档完成
- **injectHookSummary 返回类型**：保持 string，足够使用
- **新增 ConfigAdapter 接口**：管理配置持久化（load/save），宿主可选实现，框架内置默认 localStorage 实现

**影响**：接口契约扩展，worldsmith 侧 PiAiAgentBridge 需实现 isStreaming()

---

### P3 - worldsmith 侧适配器的位置是否合理？

**来源**：第 2 节确认时提出
**状态**：✅ 已处理
**结论**：调整位置，与现有代码组织一致

**决策**：
- **PiAiAgentBridge** 放在 `worldsmith-agent/src/archive/PiAiAgentBridge.ts`（保持原方案，因为它是归档专属逻辑，不属于通用 bridge）
- **archive-tools.ts** 放在 `worldsmith-agent/src/archive/archive-tools.ts`（保持原方案）
- **初始化逻辑** 集成到 `bridge.ts` 的 `initArchive()` 方法，而非独立 `archive-init.ts`（减少文件数量，与现有 ensureAgent 等初始化方法一致）
- **不放在** `worldsmith-agent/src/tools/archive/`：因为 PiAiAgentBridge 不是工具，是适配器

**影响**：worldsmith-agent/src/archive/ 下仅 3 个文件（PiAiAgentBridge.ts / archive-tools.ts / index.ts）

---

### P4 - Hook 的字段是否完整？有无遗漏？

**来源**：第 3 节确认时提出
**状态**：✅ 已处理
**结论**：补充 5 个字段

**决策**：在 Hook 接口中补充以下字段：
- `tags: string[]` — 用户/Agent 手动标签（区别于自动 keywords），默认空数组
- `importance: number` — 重要性评分 0-1，归档时由 LLM 标注（可选，默认 0.5），影响衰减权重
- `relatedHookIds: string[]` — 关联钩子（周任务合并时建立），默认空数组
- `source: 'threshold' | 'session_end' | 'manual'` — 归档触发源，用于审计
- `version: string` — 钩子格式版本（默认 '1.0'），便于未来迁移
- `customMetadata?: Record<string, unknown>` — 宿主扩展字段（如 worldsmith 可存 entityIds）
- `deprecatedAt?: number` — 标记 deprecated 的时间戳（月任务硬删除判定需要）
- `summaryMethod: 'llm' | 'rule' | 'none'` — 摘要生成方式（P10 降级策略需要）

**不补充**：
- `embeddingStale: boolean` — 改用 `embedding === null` 判断，无需额外字段

**影响**：数据模型扩展，存储格式升级，衰减算法需考虑 importance

---

### P5 - JSONL 格式是否适合记忆文件？还是用其他格式更好？

**来源**：第 3 节确认时提出
**状态**：✅ 已处理
**结论**：采用方案 B（分块 JSON 文件）

**决策**：改用分块 JSON 文件方案，理由：
1. JSONL 的字节偏移维护复杂，写入时需实时计算 offset/length，易出错
2. 分块 JSON 每块独立文件，加载即读取，无需偏移计算，实现简单
3. 文件数量多的问题可通过目录组织缓解（每个归档一个子目录）
4. 外部工具兼容性：JSON 文件比 JSONL 更通用

**新目录结构**：
```
files/
├── {fileId}/
│   ├── header.json          # 文件头元数据
│   └── chunks/
│       ├── {chunkId}.json   # 单个主题块（含完整消息）
│       └── {chunkId}.json
```

**StorageAdapter 调整**：
- `saveMemoryFile(fileId, header, chunks[])` — 一次写入所有块
- `loadMemoryFileChunk(fileId, chunkId)` — 直接读取单个 JSON 文件
- `deleteMemoryFile(fileId)` — 删除整个目录
- 移除 offset/length 字段（不再需要）

**影响**：StorageAdapter 实现简化，ChunkTitle 移除 offset/length 字段，MemoryFileWriter 逻辑简化

---

### P6 - 配置项是否覆盖了需求？

**来源**：第 3 节确认时提出
**状态**：✅ 已处理
**结论**：补充 5 个配置项

**决策**：在 ArchiveConfig 中补充：
- `embedding: { model: string, dimension: number, batchSize: number }` — embedding 配置（默认 OpenAI text-embedding-3-small, 1536维）
- `summary: { enabled: boolean, maxLength: number, method: 'llm' | 'rule' }` — 摘要配置（默认 enabled=true, maxLength=5000, method='llm'）
- `maxHooks: number` — 记忆库最大钩子数（默认 1000，达到后触发月任务提前清理）
- `maxStorageMB: number` — 存储上限 MB（默认 500，达到后触发清理）
- `exclusionPatterns: string[]` — 排除消息的正则模式（如纯工具调用结果，默认空）

**不补充**：
- `projectScope` — 框架本身不管理项目隔离，由宿主通过 projectId 区分
- `retention` — 已由 decay 配置覆盖（halfLifeDays + deleteAfterDays）

**影响**：配置模型扩展，EmbeddingAdapter 和归档流程需读取这些配置

---

### P7 - 归档的 10 步流程是否有遗漏或冗余？

**来源**：第 4 节确认时提出
**状态**：✅ 已处理
**结论**：优化为 11 步，Step 4/5 并行，新增预检查

**决策**：
- **新增 Step 0: 预检查**：检查 `AgentBridge.isStreaming() === false`、消息数量 >= 配置的 minArchiveMessages（默认 10）、磁盘空间充足
- **Step 4（摘要）和 Step 5（向量）并行执行**：`Promise.all([generateSummary(), generateEmbedding()])`，提升性能
- **Step 8（推进边界）和 Step 9（注入摘要）保持分离**：不合并，因为注入摘要失败不应回滚边界推进（边界已推进意味着消息已归档，必须注入否则 Agent 失忆）。改为：Step 8 成功后立即 Step 9，Step 9 失败则重试 3 次，仍失败则发射 `archive:inject-failed` 事件供宿主处理
- **Step 10（发射事件）保持最后**：宿主在事件中做 UI 更新，无需提前
- **不新增"归档后清理"步骤**：内存缓存由 Vue 响应式自动管理，无需手动清理

**影响**：归档流程增加预检查，性能优化（并行），注入失败有重试机制

---

### P8 - 主题分块算法的三个维度是否足够？输出类型检测规则是否合理？

**来源**：第 4 节确认时提出
**状态**：✅ 已处理
**结论**：增加工具调用链维度，输出类型检测改用 metadata 优先

**决策**：
- **新增"工具调用链"维度**：一次工具调用链（toolCall → toolResult → 可能的后续 toolCall）不拆分，作为独立块
- **输出类型检测优先级调整**：
  1. 优先使用 `msg.metadata.outputType`（若宿主提供）
  2. 其次使用 `msg.toolName`（有 toolName 则为 tool_call）
  3. 最后才用正则规则（降级方案）
- **mergeSmallChunks 策略**：合并相邻同 outputType 的小块，合并后 title 取第一个块的 title（保持锚点连续性）
- **worldsmith 侧**：PiAiAgentBridge.getCurrentMessages() 在 metadata 中携带 outputType，由 bridge.ts 在消息创建时标注

**影响**：分块质量提升，worldsmith 侧需在消息 metadata 中标注 outputType

---

### P9 - 4 个 Agent 工具是否覆盖了 Agent 的操作需求？

**来源**：第 4 节确认时提出
**状态**：✅ 已处理
**结论**：保留 4 个工具，新增 1 个，合并 1 个

**决策**：
- **保留** archive_recall / archive_load_chunk / archive_now
- **合并** archive_list 到 archive_recall：recall 支持 `mode: 'list'` 参数，返回所有钩子元数据（不排序不评分）
- **新增** archive_tag：给钩子打标签（tags 字段），Agent 可标记重要记忆
- **不新增**：
  - archive_search_in_chunk：load_chunk 返回完整块，Agent 可自行在内容中查找
  - archive_link：周任务自动建立 relatedHookIds，无需 Agent 手动
  - archive_delete：删除由月任务自动管理，Agent 不应主动删除（避免误删）
  - archive_summarize_range：超出 Agent 职责，应由周任务处理
  - archive_export：超出 Agent 职责，应由 UI 提供

**最终工具集**（4 个）：
1. `archive_recall` — 检索/列表（mode: keyword/semantic/hybrid/list）
2. `archive_load_chunk` — 加载片段
3. `archive_tag` — 打标签
4. `archive_now` — 手动归档

**影响**：工具数量保持 4 个，archive_recall 功能扩展

---

### P10 - 错误处理的降级策略是否合适？

**来源**：第 4 节确认时提出
**状态**：✅ 已处理
**结论**：补充退避重试和 summaryMethod 标记

**决策**：
- **存储失败**：保留消息不推进边界，增加退避重试（3 次，间隔 1s/2s/4s），仍失败则发射 `archive:error` 事件，标记 `archiveFailed` 状态，下次 prompt() 前重试
- **规则提取摘要**：标记 `summaryMethod: 'rule'`（已在 P4 补充字段），检索时规则摘要降权（score × 0.8）
- **embedding 失败**：不立即重试，等日任务补全（日任务 Step 2 已有补全逻辑）
- **加载片段文件不存在**：标记钩子 `status='deprecated'`，返回错误提示 Agent "该记忆已失效"
- **周期任务互斥超时**：增加 30 秒超时，超时后放弃当前周期任务，下次再执行

**影响**：错误处理更健壮，新增 summaryMethod 降权逻辑

---

### P11 - PiAiAgentBridge 的 advanceBoundary 实现是否安全？

**来源**：第 5 节确认时提出
**状态**：✅ 已处理（已验证 pi-ai 源码使用模式）
**结论**：基本安全，但需三个保护措施

**验证结果**（基于 worldsmith-agent 代码库使用模式推断）：
- `state.messages` 是公开可变属性，项目已广泛使用直接赋值（clearHistory、abort 恢复、moderator 循环清空）
- pi-agent-core 未提供官方消息重置 API，直接赋值是项目认可的操作
- 但截断中间历史无先例（只有完全清空或完整恢复）

**决策**：采用"保存+截断+恢复"模式，增加三个保护：
1. **流式检查**：截断前必须确认 `isStreaming === false`，否则等待或 abort
2. **消息对完整性**：截断点必须在完整的 user↔assistant↔toolResult 对之后，不能截断在中间
3. **本地快照同步**：截断后同步更新 `this._state.messages`（bridge.ts 的本地快照）

**实现调整**：
```typescript
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
  this._state.messages = this.agent.state.messages
  // 5. 发射事件
  window.dispatchEvent(new CustomEvent('archive:boundary-advanced', {
    detail: { archivedCount: safeIndex, newBoundary: safeIndex }
  }))
}
```

**影响**：advanceBoundary 实现更安全，新增 findSafeTruncatePoint 工具函数

---

### P12 - bridge.ts 的改造点是否完整？是否有遗漏的集成点？

**来源**：第 5 节确认时提出
**状态**：✅ 已处理
**结论**：补充 5 个集成点

**决策**：在 bridge.ts 补充以下集成点：
- **abort() 处理归档状态**：abort 重建 agent 后，从 PiAiAgentBridge 恢复 archivedBoundaryIndex（PiAiAgentBridge 持久化边界索引）
- **clearHistory() 重置边界**：调用 `agentBridge.resetBoundary()` 重置 archivedBoundaryIndex 为 0
- **工具调用期间禁止归档**：归档触发检查增加 `!isToolExecuting` 条件
- **流式期间禁止归档**：归档触发检查增加 `!isStreaming` 条件（已在 P11 处理）
- **ensureAgent 重建后恢复边界**：ensureAgent() 末尾调用 `agentBridge.restoreBoundary()` 从持久化恢复

**不处理**：
- **多会话场景**：当前 worldsmith 不支持多会话并行，归档边界是会话级的，切换会话时重置
- **convertToLlm 感知边界**：不需要，convertToLlm 过滤的是 role，归档边界在 PiAiAgentBridge.getCurrentMessages 处理

**影响**：bridge.ts 改造点增加 5 处，PiAiAgentBridge 需持久化边界索引

---

### P13 - 前端 archivedBoundaryIndex 的维护方式是否可靠？

**来源**：第 5 节确认时提出
**状态**：✅ 已处理
**结论**：改用 Pinia store + 持久化

**决策**：
- **改用 Pinia store**：创建 `useArchiveStore`（Pinia），管理 `archivedBoundaryIndex`，替代 window 事件
- **持久化**：archivedBoundaryIndex 持久化到 sessionStorage（会话级，页面刷新恢复，关闭浏览器清除）
- **事件改为"返回新边界"**：归档时通过 store action `setBoundary(newIndex)` 设置，而非累加
- **消息编辑/删除同步**：如果用户删除已归档消息，archivedBoundaryIndex 相应减少（由 useAgent.ts 的 deleteMessage 处理）
- **索引错位防护**：前端 messages 数组与 Agent 内部 messages 截断后确实不同步，但 archivedBoundaryIndex 是前端数组的索引，与 Agent 内部无关，不会错位

**影响**：新增 useArchiveStore，useAgent.ts 改用 store 而非 window 事件

---

### P14 - ArchivePanel 的功能是否足够？

**来源**：第 5 节确认时提出
**状态**：✅ 已处理
**结论**：分两期实现，第一期核心功能，第二期高级功能

**决策**：
**第一期（Phase 4 必做）**：
- 钩子列表（含日期、tokens、状态、摘要预览）
- 钩子详情查看（完整 chunkTitles、accessCount、decayScore、keywords、tags）
- 片段加载查看（ChunkViewer）
- 搜索功能（关键词搜索）
- 统计信息（钩子数、总 tokens、存储占用）
- 手动归档按钮
- 配置入口（阈值、周期开关）

**第二期（后续迭代）**：
- 时间轴视图
- 手动删除/标记钩子
- 导出归档记忆（JSON/Markdown）
- 日/周/月索引查看
- 存储管理（清理过期记忆）
- 与 KB/Memory 面板的统一入口

**影响**：Phase 4 工作量明确，高级功能延后

---

### P15 - 天/周/月任务的职责划分是否符合概念？

**来源**：第 6 节确认时提出
**状态**：✅ 已处理
**结论**：调整职责划分，符合用户概念

**决策**：
**调整后职责**：
- **日任务（索引周期）**：生成日索引 + 补全缺失向量（移除"补全无钩子文件"——归档时已保证有钩子）
- **周任务（索引整理）**：同主题合并去重 + 生成周索引（移除"重算向量防漂移"——改到月任务）
- **月任务（检索清理）**：衰减评分 + 硬删除过期钩子 + 清理未引用文件 + 清理过期索引 + **重算向量防漂移**（从周任务移入）

**理由**：
- "补全无钩子文件"是异常恢复，不应作为常规日任务，改为归档时保证原子性
- "重算向量"成本高（数百次 embedding 调用），月频更合适
- "清理过期索引"与"清理过期钩子"性质相同，放月任务统一清理

**日/周索引用途**：
- 供 Agent 的 archive_recall 检索时作为"时间维度"过滤选项
- 供 UI 的时间轴视图展示
- 周索引的 summary 可作为"本周记忆概览"注入 Agent（可选，配置控制）

**不新增季度任务**：月任务的"重算向量+深度清理"已足够，季度任务过度设计

**影响**：周期任务职责更清晰，embedding API 调用频率降低

---

### P16 - 衰减评分算法（半衰期 × 访问频次）是否合理？

**来源**：第 6 节确认时提出
**状态**：✅ 已处理
**结论**：调整算法，增加 recency 和 importance 因子

**决策**：新算法公式：
```
score = timeFactor × (0.4 + 0.3 × accessFactor + 0.3 × recencyFactor) × importanceWeight
```

**调整点**：
- **accessFactor 调整**：`log(1 + activeAccessCount) / log(10)`，其中 activeAccessCount 仅计主动检索访问（不计自动注入），accessCount=0 时 factor=0
- **新增 recencyFactor**：最近 7 天访问过加 1.0，30 天内加 0.5，否则 0
- **新增 importanceWeight**：`0.5 + importance × 0.5`（importance 来自 P4 补充的字段，默认 0.5 → weight=0.75）
- **软淘汰阈值调整**：从 0.1 调整为 0.15（避免与硬删除 90 天冲突）
- **永久保留**：新增 `pinned: boolean` 字段（在 Hook 中），pinned=true 的钩子跳过衰减，仅手动删除

**默认参数调整**：
- halfLifeDays: 30（保持）
- deprecatedThreshold: 0.15（从 0.1 调整）
- deleteAfterDays: 90（保持）

**影响**：衰减算法更精细，Hook 新增 pinned 字段，accessCount 需区分主动/自动

---

### P17 - 并发协调策略（共享 taskLock）是否会导致性能问题？

**来源**：第 6 节确认时提出
**状态**：✅ 已处理
**结论**：改用读写锁 + 分批执行

**决策**：
- **改用读写锁**：
  - 归档操作：exclusive 锁（写记忆文件+钩子）
  - 日任务：shared 锁（只读 hooks，写索引时升级为 exclusive）
  - 周/月任务：exclusive 锁（写钩子+删除文件）
  - 检索操作：无锁（读取 hooksCache 的快照）
- **周/月任务分批执行**：每批处理 50 个钩子，批间释放锁 100ms，允许归档操作插入
- **可中断机制**：长任务每批检查 `interruptFlag`，若用户触发归档则暂停任务，归档完成后继续
- **hooksCache 竞态防护**：周期任务修改钩子时先复制再修改，修改完成后原子替换缓存引用（Copy-on-Write）

**不采用**：
- 归档与日任务完全并行：日任务写索引时仍需互斥，复杂度增加不值得

**影响**：并发性能提升，长任务可中断，实现复杂度增加

---

### P18 - 失败恢复策略是否足够健壮？

**来源**：第 6 节确认时提出
**状态**：✅ 已处理
**结论**：补充任务日志 + 失败队列 + meta.json 重建

**决策**：
- **任务执行日志**：新增 `logs/` 目录，每次任务执行记录 JSON 日志（任务名/开始时间/结束时间/状态/失败步骤/错误信息），保留 30 天
- **失败队列**：月任务删除失败的文件 ID 记录到 `meta.json.failedDeletions[]`，下次月任务重试
- **meta.json 损坏恢复**：启动时若 meta.json 解析失败，从 `hooks/` 目录扫描重建（遍历所有 hook 文件，重新计算统计信息）
- **周任务合并幂等性**：合并前检查 `hook.status`，已 deprecated 的钩子跳过，避免重复合并出错
- **长期未启动补执行**：补执行时检查"错过的任务次数"，超过 3 次则只执行最近 1 次（避免一次性跑大量任务）
- **向量重算重试**：`embeddingStale` 改为 `embedding === null && summaryMethod !== 'none'`，下次日任务 Step 2 自动补全
- **日任务 Step 1/3 不一致**：钩子补全后立即设置 `dailyIndexId`（即使索引尚未生成），日索引生成失败时下次补生成

**影响**：健壮性提升，新增 logs/ 目录和 failedDeletions 字段

---

## 处理总结

| 问题编号 | 状态 | 核心结论 |
|---------|------|---------|
| P1 | ✅ | 保持划分，scheduler 三任务合并为方法 |
| P2 | ✅ | 补充 4 个方法，新增 ConfigAdapter |
| P3 | ✅ | 保持 archive/ 目录，初始化并入 bridge.ts |
| P4 | ✅ | Hook 补充 8 个字段（tags/importance/relatedHookIds/source/version/customMetadata/deprecatedAt/summaryMethod） |
| P5 | ✅ | 改用分块 JSON 文件方案 |
| P6 | ✅ | 补充 5 个配置项（embedding/summary/maxHooks/maxStorageMB/exclusionPatterns） |
| P7 | ✅ | 优化为 11 步，新增预检查，Step4/5 并行 |
| P8 | ✅ | 新增工具调用链维度，输出类型检测 metadata 优先 |
| P9 | ✅ | 保留 4 工具，archive_list 合入 recall，新增 archive_tag |
| P10 | ✅ | 补充退避重试和 summaryMethod 降权 |
| P11 | ✅ | 基本安全，增加流式检查/消息对完整/快照同步 |
| P12 | ✅ | 补充 5 个集成点（abort/clearHistory/工具期间/流式/ensureAgent） |
| P13 | ✅ | 改用 Pinia store + sessionStorage 持久化 |
| P14 | ✅ | 分两期，第一期核心功能，第二期高级功能 |
| P15 | ✅ | 调整职责，重算向量移到月任务，移除日任务补全钩子 |
| P16 | ✅ | 新算法增加 recency 和 importance 因子，新增 pinned 字段 |
| P17 | ✅ | 改用读写锁 + 分批执行 + 可中断 |
| P18 | ✅ | 补充任务日志/失败队列/meta.json 重建/幂等性 |

---

## 记录规则

- 新发现的待定问题追加到本清单
- 已解决的问题标注状态和结论
- 每个问题记录来源、描述、评估时机、影响范围
