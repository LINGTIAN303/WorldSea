# perf-kit 实施方案

> 创建时间：2026-06-16
> 状态：**包已建成，Phase 1 核心 store 改造、Phase 2 渲染节流、Phase 3 全部落地（含 loadByPage 的 DB 分页）；Phase 4 全局优化待排期**（2026-08-04 复核）

> **2026-08-04 复核（实际状态）**：
> - ✅ `packages/perf-kit` 包已创建，已实现并导出：`useShallowRefMap` / `useShallowArray` / `createDebouncedStorage` / `createBatchIpc` / `watchDebounced` / `rafThrottle` / `useStreamingRenderer`
> - ✅ **Phase 1 store 浅引用改造已落地**：`entityStore` / `fileStore` / `trashStore` / `relationStore` 均已改用 `useShallowArray` / `useShallowRefMap`（其中 relationStore 已于 2026-08-04 补齐，替代旧的深响应式 `ref` + `.filter()` 整体替换）
> - ✅ **Phase 2 渲染节流已落地**：`watchDebounced` / `rafThrottle` / `useStreamingRenderer` 均已实现；`AgentMessageList` 用 `watchDebounced` + 窗口化（useMessageWindowing）；`useAgentEvents` 用 `useShallowArray`；`AgentMessageBubble` 经拆分后的 `NormalMessageBubble` / `DeepMessageArea` 均走 `useMarkdownRender` 的 `useStreamingRenderer` 做 rAF 节流
> - ✅ **Phase 3 全部落地**：`createBatchIpc`（批量并发写，替代串行 await）；`ProjectFS` 导出已用 `createBatchIpc` 批量写入；`database.ts` v5 已加 `updatedAt` 索引 + 回填 upgrade；`entityStore.importBatch` 已用 Dexie `bulkPut`；`AgentChat`（useChatPanel/useChatSettings）已用 `createDebouncedStorage`
> - ✅ **Phase 3.6 `entityStore.loadByPage` DB 分页已落地（PERF-09，2026-08-04）**：`StorageBackend` 新增 `loadEntitiesPage` + 共享 `paginateEntitiesInMemory`；Web 端无 type 筛选 + `updatedAt`/`name` 排序走 Dexie 索引分页（`table.orderBy` + `reverse` + `offset/limit`），避免全量加载；带 type 筛选或 `createdAt` 排序（无索引）回退全量+JS 排序；Tauri/File 端回退全量+JS 排序
> - ⚠️ 与计划差异：IO 层实现为 `batchIpc`（未做独立的 `bulkDb`/`paginatedQuery` 工具，`bulkPut` 已内联在生产中）；`batchedUpdates`/`idleRaf` 未实现
> - ❌ **剩余待办**：Phase 4 全局优化（deep watch 替换 / search 索引 / 虚拟滚动 / 脏矩形 / WASM Transferable / batchedUpdates / idleRaf）

## 一、背景与目标

项目存在 22 个性能问题（详见项目记忆 PERF-01 ~ PERF-22），根因归结为 3 个"元凶"：
1. **响应式过度**（12 个问题）：`ref` 深度代理大对象、`deep: true` watch 泛滥、数组整体替换
2. **串行 I/O + 缺少批量接口**（7 个问题）：逐条 DB 操作、逐条 IPC、JS 层全量排序
3. **缺少渲染节流**（3 个问题）：流式输出每 token 都 DOM 更新、RAF 不暂停

目标：创建 `@worldsmith/perf-kit` 包，提供工具函数系统性解决上述问题。

## 二、包结构

```
packages/perf-kit/
  package.json
  tsconfig.build.json
  vite.config.ts
  src/
    index.ts
    reactive/
      index.ts
      shallowRefMap.ts       # Map 索引 + shallowRef，增量更新
      shallowArray.ts        # 数组浅操作（splice/直接修改 + triggerRef）
      watchDebounced.ts      # deep watch 自动 debounce
      batchedUpdates.ts      # 批量更新合并
    io/
      index.ts
      batchedWrite.ts        # 合并写入（收集 → 一次 IPC/DB 操作）
      bulkDb.ts              # Dexie bulkAdd/bulkPut 封装
      debouncedStorage.ts    # localStorage 防抖持久化
      paginatedQuery.ts      # DB 层排序分页
    render/
      index.ts
      rafThrottle.ts         # RAF 合并更新
      streamingRenderer.ts   # 流式输出合并渲染
      idleRaf.ts             # 空闲 RAF 管理
```

## 三、API 设计

### 3.1 reactive/shallowRefMap.ts

```ts
/**
 * 维护一个 shallowRef<Map> 索引，支持增量更新。
 * 替代 computed(() => new Map(...)) 模式，避免每次重建。
 */
export function useShallowRefMap<K, V>(): {
  map: ShallowRef<Map<K, V>>
  set: (key: K, value: V) => void
  delete: (key: K) => void
  replaceAll: (entries: Iterable<[K, V]>) => void
  get: (key: K) => V | undefined
  has: (key: K) => boolean
}
```

内部维护一个普通 Map，操作后调用 `triggerRef(map)` 通知 Vue 更新，不重建 Map。

### 3.2 reactive/shallowArray.ts

```ts
/**
 * shallowRef 数组操作工具，避免 .filter()/.map() 创建新数组。
 * 直接修改原数组 + triggerRef，减少响应式开销。
 */
export function useShallowArray<T extends Record<string, any>>(
  keyField: keyof T & string
): {
  items: ShallowRef<T[]>
  setAll: (newItems: T[]) => void
  push: (item: T) => void
  removeById: (id: T[keyof T]) => void
  updateById: (id: T[keyof T], changes: Partial<T>) => void
  indexOf: (id: T[keyof T]) => number
  findById: (id: T[keyof T]) => T | undefined
}
```

`removeById` 用 splice，`updateById` 用 `Object.assign(items[idx], changes)` + triggerRef。

### 3.3 reactive/watchDebounced.ts

```ts
/**
 * 防抖 watch，替代 watch(..., { deep: true })。
 * 在指定时间内多次触发只执行一次回调。
 */
export function watchDebounced<T>(
  source: WatchSource<T>,
  callback: (newVal: T, oldVal: T | undefined) => void,
  options?: {
    deep?: boolean
    debounce?: number       // 防抖时间（ms），默认 50
    leading?: boolean       // 是否首次立即执行，默认 false
    immediate?: boolean
  }
): WatchStopHandle
```

### 3.4 reactive/batchedUpdates.ts

```ts
export interface BatchItem<T> {
  id: string
  changes: Partial<T>
}

/**
 * 批量更新合并器。在同一个微任务/宏任务周期内收集多次更新，
 * 合并为一次回调执行。
 */
export function createUpdateBatcher<T>(
  handler: (batch: BatchItem<T>[]) => void,
  options?: {
    flushMode?: 'nextTick' | 'raf' | 'timeout'  // 默认 nextTick
    timeout?: number                              // 默认 16
  }
): {
  queue: (id: string, changes: Partial<T>) => void
  flush: () => void
  cancel: () => void
}
```

### 3.5 io/batchedWrite.ts

```ts
/**
 * 合并写入器。收集多次写入操作，合并为一次批量执行。
 */
export function createBatchedWriter<T>(
  options: {
    write: (items: T[]) => Promise<void>
    serialize?: (key: string, value: string) => T
    maxBatchSize?: number          // 默认 50
    autoFlushInterval?: number     // 0 = 不自动刷出
  }
): {
  add: (key: string, value: string) => void
  flush: () => Promise<void>
  pending: number
}
```

### 3.6 io/bulkDb.ts

```ts
/**
 * Dexie 批量操作工具，替代逐条 add/update。
 */
export function createBulkOp<T, K>(
  table: Dexie.Table<T, K>,
  options?: { batchSize?: number }  // 默认 500
): {
  add: (item: T) => void
  update: (key: K, changes: Partial<T>) => void
  put: (item: T) => void
  flush: () => Promise<void>
  pending: number
}

/** 一次性批量导入 */
export async function bulkImport<T, K>(
  table: Dexie.Table<T, K>,
  items: T[],
  options?: { batchSize?: number; skipClone?: boolean }  // skipClone 默认 true
): Promise<void>
```

### 3.7 io/debouncedStorage.ts

```ts
/**
 * localStorage 防抖写入。同一 key 在防抖窗口内多次写入只执行最后一次。
 * 读取时优先返回内存中最新值。
 */
export function createDebouncedStorage(options?: {
  debounce?: number  // 默认 100
}): {
  set: (key: string, value: any) => void
  get: <T = any>(key: string) => T | null
  remove: (key: string) => void
  flush: () => void
  cancel: () => void
}
```

### 3.8 io/paginatedQuery.ts

```ts
/**
 * Dexie DB 层排序分页查询，替代 JS 层全量排序。
 */
export async function paginatedQuery<T, K>(
  table: Dexie.Table<T, K>,
  options: {
    filter?: (table: Dexie.Table<T, K>) => Dexie.Collection<T, K>
    sortBy?: string
    sortDir?: 'asc' | 'desc'
    offset: number
    limit: number
  }
): Promise<{ items: T[]; total: number }>
```

### 3.9 render/rafThrottle.ts

```ts
/**
 * RAF 节流器。确保回调最多每帧执行一次。
 */
export function createRafThrottle(): {
  schedule: (callback: () => void) => void
  cancel: () => void
  readonly pending: boolean
}
```

### 3.10 render/streamingRenderer.ts

```ts
/**
 * 流式渲染管理器。将高频 SSE 内容更新合并为低频 DOM 更新。
 */
export function useStreamingRenderer(options: {
  renderInterval?: number  // 默认 50
  onRender: (fullContent: string) => void
}): {
  append: (chunk: string) => void
  finalize: () => void
  reset: () => void
  readonly content: string
}
```

### 3.11 render/idleRaf.ts

```ts
/**
 * 空闲 RAF 管理器。有交互时运行动画循环，空闲后自动暂停。
 */
export function createIdleRaf(options?: {
  idleTimeout?: number  // 默认 3000
}): {
  start: (tick: (dt: number) => void) => void
  stop: () => void
  notifyActive: () => void
  readonly running: boolean
}
```

## 四、分阶段实施计划

### Phase 1：基础设施（搭建包 + 改造 entityStore/fileStore/trashStore）

| 步骤 | 内容 | 解决问题 | 验证标准 |
|------|------|----------|----------|
| 1.1 | 创建 `packages/perf-kit/` 包骨架 | — | pnpm install 无报错 |
| 1.2 | 实现 `shallowRefMap` | PERF-01, 02 | 单元测试通过 |
| 1.3 | 实现 `shallowArray` | PERF-03, 19, 20 | 单元测试通过 |
| 1.4 | 改造 `entityStore` | PERF-01, 02, 03, 20 | 增删改查功能正常 |
| 1.5 | 改造 `fileStore` | PERF-06, 19 | 文件操作功能正常 |
| 1.6 | 改造 `trashStore` | PERF-07 | 回收站功能正常 |

### Phase 2：渲染节流（解决流式输出卡顿）

| 步骤 | 内容 | 解决问题 |
|------|------|----------|
| 2.1 | 实现 `watchDebounced` | PERF-04, 15 |
| 2.2 | 实现 `rafThrottle` | PERF-04 |
| 2.3 | 实现 `streamingRenderer` | PERF-04, 18 |
| 2.4 | 改造 `AgentMessageList` | PERF-04 |
| 2.5 | 改造 `useAgentEvents` | PERF-05 |
| 2.6 | 改造 `AgentMessageBubble` | PERF-18 |

### Phase 3：I/O 批量化（解决导入/导出慢）

| 步骤 | 内容 | 解决问题 |
|------|------|----------|
| 3.1 | 实现 `batchedWrite` | PERF-11 |
| 3.2 | 实现 `bulkDb` | PERF-12, 14 |
| 3.3 | 实现 `paginatedQuery` | PERF-09 |
| 3.4 | 实现 `debouncedStorage` | PERF-07, 21 |
| 3.5 | 改造 `ProjectFS` | PERF-11, 12 |
| 3.6 | 改造 `entityStore.loadByPage` | PERF-09 |
| 3.7 | 改造 `database.ts` v5 迁移 | PERF-14 |
| 3.8 | 改造 `AgentChat` localStorage | PERF-21 |

### Phase 4：全局优化 + 低优先级修复

| 步骤 | 内容 | 解决问题 |
|------|------|----------|
| 4.1 | 实现 `batchedUpdates` | PERF-03 |
| 4.2 | 实现 `idleRaf` | PERF-22 |
| 4.3 | 全局替换 30+ 处 deep watch | PERF-15 |
| 4.4 | entityStore.add 对 import 跳过 clone | PERF-13 |
| 4.5 | entityStore.search → Dexie 索引查询 | PERF-08 |
| 4.6 | KanbanView 虚拟滚动 | PERF-10 |
| 4.7 | Canvas 脏矩形优化 | PERF-16 |
| 4.8 | WASM Worker Transferable | PERF-17 |

## 五、entityStore 改造示例

### Before

```ts
const entities = ref<Entity[]>([])

const entityMap = computed(() => {
  const map = new Map<string, Entity>()
  for (const e of entities.value) map.set(e.id, e)
  return map
})

// update
entities.value[idx] = { ...entities.value[idx], ...changes }

// remove
entities.value = entities.value.filter((e) => e.id !== id)
```

### After

```ts
import { useShallowArray, useShallowRefMap } from '@worldsmith/perf-kit'

const { items: entities, setAll, push, removeById, updateById, findById } = useShallowArray<Entity>('id')
const { map: entityMap, set: mapSet, delete: mapDel, replaceAll: mapReplaceAll } = useShallowRefMap<string, Entity>()

function syncIndex() {
  mapReplaceAll(entities.value.map(e => [e.id, e] as [string, Entity]))
}

// loadAll 后
setAll(sanitize(await storage.getAllEntities()))
syncIndex()

// add 后
push(clean)
mapSet(clean.id, clean)

// update
updateById(id, changes)
const updated = findById(id)
if (updated) mapSet(id, updated)

// remove
removeById(id)
mapDel(id)
```

## 六、风险与注意事项

1. **shallowRef 陷阱**：组件模板中直接访问 `entities.value[0].properties.name` 不再自动追踪 name 变化。必须通过 `useShallowArray` 的方法修改，确保 triggerRef 正确触发。
2. **watchDebounced 时序**：防抖可能导致 UI 更新延迟。对用户直接交互触发的 watch 用 `leading: true`，后台数据推送用默认 trailing 模式。
3. **bulkDb 事务**：Dexie bulkPut 在事务中执行，中途失败会回滚。导入场景使用 `bulkImport` 处理分批和错误恢复。
4. **向后兼容**：perf-kit 是纯工具库，不修改任何现有接口。改造渐进式——一个 store 一个 store 地替换。

## 七、包配置模板

### package.json

```json
{
  "name": "@worldsmith/perf-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./reactive": "./src/reactive/index.ts",
    "./io": "./src/io/index.ts",
    "./render": "./src/render/index.ts"
  },
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.build.json --noEmit"
  },
  "peerDependencies": {
    "vue": "^3.4",
    "dexie": "^4.0"
  }
}
```

### vite.config.ts

```ts
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: (id: string) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('src/'),
    },
  },
})
```

### tsconfig.build.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/__tests__/**", "**/*.spec.ts"]
}
```
