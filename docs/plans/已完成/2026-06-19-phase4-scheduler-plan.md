# Phase 4 实施计划：周期管理（ArchiveScheduler）

> **创建时间**：2026-06-19
> **状态**：已完成（ArchiveScheduler 已实现于 `packages/memory-archive/src/scheduler/ArchiveScheduler.ts`）
> **依据**：设计文档第 6 节、7.4 节，待定问题清单 P15/P16/P17/P18
> **前置条件**：Phase 1-3 已完成（框架核心 + worldsmith 集成 + UI 面板与优化）

---

## 一、背景与目标

### 1.1 问题

设计文档 Phase 3（周期管理）在实际开发中被跳过，直接做了 Phase 4（UI 面板与优化）。
导致记忆库缺少自动化运维能力：

- **无限增长**：无衰减评分和自动清理，钩子只增不减
- **向量缺失无法补全**：embedding 失败的钩子永远没有向量
- **检索质量下降**：无同主题合并去重，重复钩子干扰检索
- **无运维能力**：无任务日志、无失败恢复、无 meta.json 统计

### 1.2 目标

实现设计文档第 6 节规划的天/周/月三级周期任务自动化：

- **日任务**：补全缺失向量 + 生成日索引 + 更新访问统计快照
- **周任务**：同主题钩子聚类合并去重 + 生成周索引（P18 幂等性）
- **月任务**：衰减评分 + 硬删除过期钩子 + 清理孤儿文件 + 清理过期索引 + 重算向量防漂移

### 1.3 设计原则

- **复用现有基础设施**：rwLock、decay、StorageAdapter 索引接口、事件系统
- **最小侵入**：ArchiveManager 新增 startScheduler/stopScheduler，不改动归档/检索流程
- **可中断**：长任务分批执行，每批检查 interruptFlag
- **幂等性**：P18 决策，周任务合并前检查 status，已 deprecated 跳过
- **失败恢复**：P18 决策，任务日志 + 失败队列 + meta.json 重建

---

## 二、任务分解

### p4-1：MetaStorage 与任务日志基础设施

**目标**：实现 meta.json 读写和任务日志记录，为三级任务提供基础设施。

**新增文件**：
- `packages/memory-archive/src/scheduler/MetaStorage.ts` — meta.json 读写 + 任务日志

**MetaStorage 职责**：
```typescript
export class MetaStorage {
  constructor(storage: StorageAdapter, fs: FsOperations, basePath: string)

  // meta.json 读写
  async loadMeta(): Promise<ArchiveMeta>
  async saveMeta(meta: ArchiveMeta): Promise<void>
  // P18：meta.json 损坏时从 hooks/ 重建
  async rebuildMetaFromHooks(): Promise<ArchiveMeta>

  // 任务日志（P18：保留 30 天）
  async appendTaskLog(log: TaskLogEntry): Promise<void>
  async loadTaskLogs(dateRange?: { start: number; end: number }): Promise<TaskLogEntry[]>
  async cleanExpiredLogs(): Promise<number> // 删除 30 天前的日志
}

// 任务日志条目（P18 新增）
export interface TaskLogEntry {
  taskName: 'daily' | 'weekly' | 'monthly'
  startTime: number
  endTime: number
  status: 'success' | 'failed' | 'partial'
  failedStep?: string
  error?: string
  processedCount?: number
}
```

**实现要点**：
- meta.json 路径：`{basePath}/meta.json`
- 任务日志路径：`{basePath}/logs/{YYYY-MM-DD}.json`（每日一个文件，数组追加）
- `rebuildMetaFromHooks`：遍历 hooks/ 目录，重新计算 totalHooks/totalFiles/totalStorageBytes
- `cleanExpiredLogs`：删除 30 天前的日志文件
- meta.json 不存在时返回默认值（不抛错）

**依赖**：StorageAdapter（已实现）、FsOperations（已实现）

---

### p4-2：ArchiveScheduler 核心实现

**目标**：实现调度器类，含天/周/月三个方法，使用 rwLock + 分批执行 + 可中断。

**新增文件**：
- `packages/memory-archive/src/scheduler/ArchiveScheduler.ts`

**类结构**：
```typescript
export class ArchiveScheduler {
  constructor(options: {
    storage: StorageAdapter
    embeddingAdapter: EmbeddingAdapter
    llmAdapter: LlmAdapter
    metaStorage: MetaStorage
    rwLock: ReadWriteLock
    config: ArchiveConfig
    projectId: string
    getHooks: () => Hook[]                    // 读取 hooksCache 快照
    updateHook: (hook: Hook) => Promise<void> // 保存并更新缓存
    deleteHookAndFile: (hookId: string) => Promise<void>
  })

  // 生命周期
  start(): void    // setInterval 每小时检查
  stop(): void     // 清除 timer
  interrupt(): void // 设置 interruptFlag

  // 三级任务（P1 决策：合并为方法）
  runDaily(): Promise<TaskLogEntry>
  runWeekly(): Promise<TaskLogEntry>
  runMonthly(): Promise<TaskLogEntry>

  // 补执行（P18：超过 3 次只执行最近 1 次）
  async catchUp(): Promise<void>
}
```

**runDaily 流程**（P15 调整后）：
```
Step 1: 补全缺失向量（shared 锁）
  - for hook in hooks where embedding == null && summaryMethod != 'none':
      if embeddingAdapter.isReady():
        hook.embedding = await embed(hook.summary)
        await updateHook(hook)
  - 分批执行（每批 50 个，批间释放锁 100ms）

Step 2: 生成当日索引（exclusive 锁）
  - todayHooks = hooks.filter(h => isSameDay(h.createdAt, now))
  - if todayHooks.length == 0: 跳过
  - summary = llmAdapter.summarize(...) 或规则提取
  - embedding = await embed(summary)
  - keywords = 聚合 todayHooks 的 keywords
  - 保存 ArchiveIndex 到 indices/daily/{today}.json
  - 更新 hook.dailyIndexId（P18：钩子补全后立即设置）

Step 3: 更新访问统计快照
  - meta.dailyStats[today] = { accessCount, newHooks }
  - saveMeta(meta)
```

**runWeekly 流程**（P15 调整后）：
```
Step 1: 识别同主题钩子组（exclusive 锁，分批执行）
  - recentHooks = hooks.filter(h => createdAt within 7 days && status == 'active')
  - 按 keywords Jaccard 相似度 > 0.5 聚类
  - 输出：HookGroup[]

Step 2: 合并去重（P18 幂等性检查）
  - for group in hookGroups:
      跳过已 deprecated 的钩子（P18 决策）
      选择组内 decayScore 最高的钩子作为"主钩子"
      其他钩子标记 status='deprecated' + deprecatedAt
      主钩子.keywords = union(group.keywords)
      主钩子.relatedHookIds = group.otherIds
      主钩子.summary = llmAdapter.summarize(合并摘要)
      重新生成主钩子向量
      保存主钩子，更新其他钩子状态
  - 注意：不删除记忆文件，仅标记钩子 deprecated

Step 3: 生成周索引
  - week = getISOWeek(now)
  - 生成周索引摘要 + 向量
  - 保存 indices/weekly/{week}.json
  - 更新 hook.weeklyIndexId
```

**runMonthly 流程**（P15 调整后）：
```
Step 1: 衰减评分（exclusive 锁，分批执行）
  - for hook in hooks where status == 'active':
      if hook.pinned: 跳过（P16 决策）
      hook.decayScore = calculateDecayScore(hook, now, decayParams)
      if shouldDeprecate(hook, decayScore, params):
        hook.status = 'deprecated'
        hook.deprecatedAt = now
      await updateHook(hook)

Step 2: 硬删除过期 deprecated 钩子
  - for hook in hooks where status == 'deprecated':
      if shouldHardDelete(hook, now, params):
        if not isReferencedByIndex(hook):
          try: await deleteHookAndFile(hook.id)
          catch: meta.failedDeletions.push(hook.fileId)  // P18 失败队列

Step 3: 清理未引用的记忆文件（孤儿文件）
  - referencedFileIds = hooks.map(h => h.fileId)
  - allFiles = storage.listMemoryFiles()
  - orphanFiles = allFiles.filter(f => !referencedFileIds.includes(f.id))
  - 删除孤儿文件

Step 4: 清理过期索引
  - 保留最近 90 天的日索引
  - 保留最近 12 周的周索引

Step 5: 重算向量防漂移（P15 从周任务移入）
  - 检测 embedding 维度是否变化（对比 config.embedding.dimension）
  - if 维度不匹配 or config.forceRebuild:
      for hook in hooks where status == 'active':
        hook.embedding = await embed(hook.summary)
        await updateHook(hook)
  - emit('archive:vectors-rebuilt')

Step 6: 更新 meta.json
  - lastMonthlyCleanup = now
  - totalHooks/totalFiles/totalStorageBytes = storage.getStorageStats()
  - 清理 failedDeletions 中已成功的项
  - cleanExpiredLogs()
```

**分批执行工具方法**（P17 决策）：
```typescript
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
```

**调度逻辑**：
```typescript
private async checkAndRun(): Promise<void> {
  const now = Date.now()
  const meta = await this.metaStorage.loadMeta()

  // 日任务：每天 dailyHour 点执行
  if (shouldRunDaily(meta.lastDailyRun, now, this.config.scheduler.dailyHour)) {
    await this.runDailyWithLog()
  }

  // 周任务：每周 weeklyDay 执行
  if (shouldRunWeekly(meta.lastWeeklyRun, now, this.config.scheduler.weeklyDay)) {
    await this.runWeeklyWithLog()
  }

  // 月任务：每月 monthlyDay 执行
  if (shouldRunMonthly(meta.lastMonthlyRun, now, this.config.scheduler.monthlyDay)) {
    await this.runMonthlyWithLog()
  }
}
```

**Jaccard 相似度工具**（周任务聚类用）：
```typescript
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  if (union.size === 0) return 0
  return intersection.size / union.size
}
```

**依赖**：p4-1（MetaStorage）、rwLock（已实现）、decay（已实现）、StorageAdapter（已实现）

---

### p4-3：ArchiveManager 集成 Scheduler

**目标**：在 ArchiveManager 中集成 ArchiveScheduler，提供 startScheduler/stopScheduler API。

**修改文件**：
- `packages/memory-archive/src/core/ArchiveManager.ts`

**改动点**：
1. 构造函数新增 `metaStorage: MetaStorage` 和 `scheduler: ArchiveScheduler`（内部创建）
2. `init()` 末尾：根据 `config.scheduler.enabled` 自动 `startScheduler()`
3. 新增 `startScheduler()` / `stopScheduler()` / `interruptScheduler()` 方法
4. 新增 `getMeta(): Promise<ArchiveMeta>` 方法（供 UI 查看统计）
5. 新增 `runDailyNow()` / `runWeeklyNow()` / `runMonthlyNow()` 方法（手动触发，供 UI）
6. `dispose()` 中调用 `stopScheduler()`
7. 暴露 scheduler 的事件转发（task:success/task:failed）

**关键代码**：
```typescript
// ArchiveManager 构造函数新增
this.metaStorage = new MetaStorage(options.storage, options.fs, basePath)
this.scheduler = new ArchiveScheduler({
  storage: options.storage,
  embeddingAdapter: options.embeddingAdapter,
  llmAdapter: options.llmAdapter,
  metaStorage: this.metaStorage,
  rwLock: this.rwLock,
  config: this.config,
  projectId: options.projectId,
  getHooks: () => [...this.hooksCache],
  updateHook: async (hook) => {
    await this.opts.storage.saveHook(hook)
    this.hooksCache = this.hooksCache.map(h => h.id === hook.id ? hook : h)
  },
  deleteHookAndFile: async (hookId) => {
    await this.deleteHook(hookId)
  },
})

// init() 末尾
if (this.config.scheduler.enabled) {
  this.scheduler.start()
}

// 新增方法
startScheduler(): void { this.scheduler.start() }
stopScheduler(): void { this.scheduler.stop() }
interruptScheduler(): void { this.scheduler.interrupt() }
async getMeta(): Promise<ArchiveMeta> { return this.metaStorage.loadMeta() }
async runDailyNow(): Promise<TaskLogEntry> { return this.scheduler.runDaily() }
async runWeeklyNow(): Promise<TaskLogEntry> { return this.scheduler.runWeekly() }
async runMonthlyNow(): Promise<TaskLogEntry> { return this.scheduler.runMonthly() }
```

**ArchiveManagerOptions 调整**：
- 新增 `fs: FsOperations`（MetaStorage 需要）
- 新增 `basePath: string`（MetaStorage 需要）

**依赖**：p4-1（MetaStorage）、p4-2（ArchiveScheduler）

---

### p4-4：宿主 useMemoryArchive 集成

**目标**：在宿主 composable 中暴露 scheduler 生命周期和手动触发 API。

**修改文件**：
- `src/memory-archive/useMemoryArchive.ts`

**改动点**：
1. `init()` 中创建 ArchiveManager 时传入 `fs` 和 `basePath`（ArchiveManager 新增参数）
2. 新增返回方法：`startScheduler/stopScheduler/interruptScheduler/getMeta/runDailyNow/runWeeklyNow/runMonthlyNow`
3. `dispose()` 中调用 `stopScheduler()`
4. `switchProject()` 中 dispose 后重新 init（scheduler 自动重启）

**关键代码**：
```typescript
// init() 中创建 ArchiveManager 时传入新参数
archiveManager = new ArchiveManager({
  agentBridge,
  storage,
  embeddingAdapter,
  llmAdapter,
  projectId: projectInfo.id,
  sessionId,
  config,
  fs,           // 新增
  basePath,     // 新增
})

// 返回对象新增
return {
  // ... 现有 API

  // 周期管理（Phase 4 新增）
  startScheduler,
  stopScheduler,
  interruptScheduler,
  getMeta,
  runDailyNow,
  runWeeklyNow,
  runMonthlyNow,
}

// 新增方法实现
function startScheduler(): void {
  ensureReady()
  archiveManager!.startScheduler()
}
function stopScheduler(): void {
  if (archiveManager) archiveManager.stopScheduler()
}
function interruptScheduler(): void {
  if (archiveManager) archiveManager.interruptScheduler()
}
async function getMeta() {
  ensureReady()
  return archiveManager!.getMeta()
}
async function runDailyNow() {
  ensureReady()
  return archiveManager!.runDailyNow()
}
async function runWeeklyNow() {
  ensureReady()
  return archiveManager!.runWeeklyNow()
}
async function runMonthlyNow() {
  ensureReady()
  return archiveManager!.runMonthlyNow()
}
```

**依赖**：p4-3（ArchiveManager 集成）

---

### p4-5：UI 面板扩展（周期管理入口）

**目标**：在 ArchivePanel 的 config 子视图中添加周期管理配置和手动触发入口。

**修改文件**：
- `src/agent/ArchivePanel.vue` — 新增 "周期任务" 子视图或 config 中新增分组
- `src/agent/ArchiveConfigPanel.vue` — 新增 scheduler 配置分组

**ArchiveConfigPanel 新增配置分组**：
- scheduler.enabled（开关）
- scheduler.dailyHour（0-23）
- scheduler.weeklyDay（0-6）
- scheduler.monthlyDay（1-28）
- decay.halfLifeDays
- decay.deprecatedThreshold
- decay.deleteAfterDays
- maxHooks
- maxStorageMB

**ArchivePanel 新增功能**：
- 统计子视图新增：显示 meta.json 信息（lastDailyRun/lastWeeklyRun/lastMonthlyRun/totalStorageBytes）
- config 子视图新增"周期任务"操作区：
  - 手动执行日任务按钮
  - 手动执行周任务按钮
  - 手动执行月任务按钮
  - 中断当前任务按钮
  - 显示上次执行时间和状态

**依赖**：p4-4（宿主集成）

---

### p4-6：单元测试与集成测试

**目标**：验证周期任务正确性和失败恢复能力。

**新增测试文件**：
- `packages/memory-archive/__tests__/scheduler/MetaStorage.test.ts`
- `packages/memory-archive/__tests__/scheduler/ArchiveScheduler.test.ts`

**MetaStorage 测试用例**：
1. loadMeta — meta.json 不存在时返回默认值
2. saveMeta + loadMeta — 往返一致性
3. rebuildMetaFromHooks — 从 hooks/ 重建统计
4. appendTaskLog + loadTaskLogs — 日志追加和读取
5. cleanExpiredLogs — 删除 30 天前日志

**ArchiveScheduler 测试用例**：

**runDaily 测试**：
1. 补全缺失向量 — embedding=null 的钩子被补全
2. embeddingAdapter 未就绪 — 跳过补全，不报错
3. 生成日索引 — 当日钩子被聚合到索引
4. 无当日钩子 — 跳过索引生成
5. 更新访问统计快照 — meta.dailyStats 更新

**runWeekly 测试**：
1. 同主题聚类 — Jaccard > 0.5 的钩子被分组
2. 合并去重 — 非主钩子标记 deprecated
3. P18 幂等性 — 已 deprecated 的钩子跳过
4. 生成周索引 — 周索引正确生成
5. 不删除记忆文件 — 仅标记钩子状态

**runMonthly 测试**：
1. 衰减评分 — active 钩子计算 decayScore
2. pinned 跳过 — pinned 钩子不衰减
3. 硬删除 — 超过 deleteAfterDays 的 deprecated 钩子被删除
4. 失败队列 — 删除失败记录到 failedDeletions
5. 清理孤儿文件 — 未引用的记忆文件被删除
6. 清理过期索引 — 90 天前的日索引、12 周前的周索引被删除
7. 重算向量 — 维度不匹配时重算

**可中断测试**：
1. interruptFlag 设置后，分批任务在当前批完成后停止

**补执行测试**（P18）：
1. 错过 1 次任务 — 补执行 1 次
2. 错过 5 次任务 — 只补执行最近 1 次

**测试方式**：
- 使用 fake timers（vitest 的 `vi.useFakeTimers()`）模拟时间推进
- Mock EmbeddingAdapter/LlmAdapter
- 使用临时目录作为 basePath（真实文件系统操作）

**依赖**：p4-1 到 p4-5 全部完成

---

## 三、实施顺序与依赖

```
p4-1 MetaStorage 与任务日志
    ↓
p4-2 ArchiveScheduler 核心实现
    ↓
p4-3 ArchiveManager 集成 Scheduler
    ↓
p4-4 宿主 useMemoryArchive 集成
    ↓
p4-5 UI 面板扩展
    ↓
p4-6 单元测试与集成测试
```

每个任务完成后立即类型检查 + 测试，确保零回归。

---

## 四、类型与导出调整

### 4.1 新增类型（types.ts）

```typescript
// 任务日志条目（P18 新增）
export interface TaskLogEntry {
  taskName: 'daily' | 'weekly' | 'monthly'
  startTime: number
  endTime: number
  status: 'success' | 'failed' | 'partial'
  failedStep?: string
  error?: string
  processedCount?: number
}
```

### 4.2 新增事件类型

```typescript
export type ArchiveEventName =
  | 'archive:complete'
  | 'archive:error'
  | 'archive:inject-failed'
  | 'archive:vectors-rebuilt'
  | 'recall:accessed'
  | 'scheduler:task-success'  // 新增
  | 'scheduler:task-failed'   // 新增
```

### 4.3 index.ts 新增导出

```typescript
// 周期管理
export { ArchiveScheduler } from './scheduler/ArchiveScheduler'
export { MetaStorage } from './scheduler/MetaStorage'
export type { TaskLogEntry } from './types'
```

---

## 五、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 长任务阻塞归档 | 中 | 高 | P17 读写锁 + 分批执行 + 可中断 |
| LLM 摘要失败 | 中 | 中 | 降级规则提取，标记 summaryMethod='rule' |
| 向量重算成本高 | 中 | 中 | 月频执行，分批，可中断 |
| meta.json 损坏 | 低 | 高 | P18 从 hooks/ 重建 |
| 周任务合并误删 | 低 | 高 | P18 幂等性检查 + 不删除文件只标记 deprecated |
| 调度器在 Tauri 关闭时未清理 | 中 | 低 | dispose() 中 stopScheduler() |

---

## 六、验收标准

1. **类型检查**：`npx vue-tsc --noEmit -p tsconfig.app.json` 零错误
2. **单元测试**：`npx vitest run --config packages/memory-archive/vitest.config.ts` 全部通过
3. **功能验收**：
   - 日任务能补全缺失向量并生成日索引
   - 周任务能合并同主题钩子并生成周索引
   - 月任务能衰减评分、清理过期钩子、重算向量
   - 手动触发按钮工作正常
   - 任务日志正确记录
   - 可中断机制有效
4. **无回归**：现有 144 个测试全部通过

---

**文档结束**
