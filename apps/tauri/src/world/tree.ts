/**
 * 第二棵树（世界语义）的装配（B/C2，2026-09-25）。
 *
 * 口径（双 Cordis 三条判定线，见 docs/plans/2026-09-25-双Cordis-Spike批计划.md §一）：
 * - 本树只长**世界语义**（实体/芽/编辑器/视图）；**不许**长 session / turn / tool-loop / sandbox
 *   （需要这些去调 dsh，或经壳能力桥）。
 * - 与 dsh 的树**对等**：各自的服务命名空间、各自的生命周期；交界一律走**壳**（能力桥 / 仅应用级面）。
 * - 依赖 = 自 vendor 的 cordis 4.0.4（`./vendor/README.md`），**不依赖 `dsh/` 目录**。
 *
 * 生命周期：`startWorldTree()` 建 Context → `provide` 本树服务 → 装载插件（清单校验 + 依赖预检 +
 * 失败隔离 + **启停过滤**，见 `./loader.ts`）→ 逐个 `ctx.plugin()`；`disposeWorldTree()` 全拆。
 * **真启停（C2）**：`setPluginEnabled(id, enabled)` 动态装/卸单个插件——装走 `loadPlugin`，
 * 卸走「插件清理 → fiber dispose」（实体/关系类型不注销，沿用旧语义）。
 * 句柄镜像到 `globalThis.__WS_WORLD_TREE__`（探针友好，JSON 安全）。
 */
import { Context } from '@deepseek-ai/cordis'
import type { CordisContext, CordisFiberLike } from '@deepseek-ai/cordis'

import { getFileStorageBackend, pluginAPI } from '@worldsea/entity-core'

import { createPluginApi } from './api'
import { collectExternalPlugins, externalDomain } from './external'
import { collectWorldPlugins, type LoadReport } from './loader'
import type { WorldPlugin } from './manifest'
import { runPluginCleanups } from './registry'

/** 本树提供的服务（`requires` 预检的**权威名单**；新增服务 = 这里登记 + 下面 provide）。 */
export const WORLD_SERVICES: readonly string[] = ['world.info']

export interface WorldTreeState {
  started: boolean
  /** 已装载插件 id（按装载顺序） */
  plugins: string[]
  /** 校验通过但被芽启停关掉（未装载） */
  skipped: string[]
  /** 被拒条目（清单非法 / 依赖缺失 / 导入失败）——不静默 */
  rejected: LoadReport['rejected']
  error: string | null
}

export interface WorldTreeHandle extends WorldTreeState {
  dispose(): void
  /** 真启停（探针/开发用；应用侧走 `setPluginEnabled`） */
  enable(id: string): boolean
  disable(id: string): boolean
}

export interface StartOptions {
  /** 注入装载结果（**测试/开发接缝**：跳过 `collectWorldPlugins` 的真图导入） */
  plugins?: WorldPlugin[]
  /** 启停过滤（应用侧注入 `settingsStore.isActive`；缺省 = 全启用） */
  isEnabled?: (id: string) => boolean
}

const state: WorldTreeState = { started: false, plugins: [], skipped: [], rejected: [], error: null }
/** 通过校验的全部插件（含未启用）——真启停从这里取 */
const available = new Map<string, WorldPlugin>()
const fibers = new Map<string, CordisFiberLike>()
let ctx: CordisContext | null = null
const drops: Array<() => void> = []

/* ─── 外部插件（运行时来源）记账 ─── */
/** 外部插件 id 集（reload 只动这一圈，内置不碰） */
const externalIds = new Set<string>()
/** id → 源码指纹（重对账「变更即重装」的对比基准） */
const externalCodes = new Map<string, string>()
/** 外部被拒条目（含文件路径，管理界面展示） */
let externalRejected: Array<{ id: string; file: string; reason: string }> = []
/** 启停过滤（应用侧注入 `isViewVisible`；缺省 = 全启用）——reload 与起树共用 */
let isEnabledFn: (id: string) => boolean = () => true
/** 外部插件目录的数据根（worlddata 根；测试可覆写） */
let projectDirProvider: () => string | null | undefined = () => getFileStorageBackend()?.projectDir ?? null

function publish(): WorldTreeHandle {
  const handle: WorldTreeHandle = {
    started: state.started,
    plugins: [...state.plugins],
    skipped: [...state.skipped],
    rejected: [...state.rejected],
    error: state.error,
    dispose: disposeWorldTree,
    enable: (id: string) => setPluginEnabled(id, true),
    disable: (id: string) => setPluginEnabled(id, false),
  }
  ;(globalThis as { __WS_WORLD_TREE__?: WorldTreeHandle }).__WS_WORLD_TREE__ = handle
  return handle
}

/** 当前状态快照（探针/诊断）。 */
export function worldTreeState(): WorldTreeState {
  return {
    started: state.started,
    plugins: [...state.plugins],
    skipped: [...state.skipped],
    rejected: [...state.rejected],
    error: state.error,
  }
}

/** 通过校验的全部插件清单（含未启用；应用侧据此登记 worldview 芽名等）。 */
export function availablePlugins(): WorldPlugin[] {
  return [...available.values()]
}

/** 装载单个插件（供起树与真启停共用）。 */
function loadPlugin(plugin: WorldPlugin): void {
  if (!ctx || fibers.has(plugin.manifest.id)) return
  const id = plugin.manifest.id
  const fiber = ctx.plugin(
    {
      name: id,
      inject: plugin.manifest.requires ?? [],
      apply: (inner) => plugin.apply(inner, createPluginApi(id)),
    },
    { manifest: plugin.manifest },
  )
  fibers.set(id, fiber)
  state.plugins.push(id)
}

/** 卸载单个插件（插件清理 → fiber dispose；实体/关系类型不注销）。 */
export function unloadPlugin(id: string): boolean {
  if (!fibers.has(id)) return false
  runPluginCleanups(id)
  try {
    void fibers.get(id)?.dispose()
  } catch (error) {
    console.error(`[world-tree] 拆 fiber 抛错（${id}，已隔离）：`, error)
  }
  fibers.delete(id)
  state.plugins = state.plugins.filter(entry => entry !== id)
  console.log(`[world-tree] 已卸载插件：${id}`)
  publish()
  return true
}

/**
 * 真启停（C2）：芽清单开关 → 动态装/卸。
 * @returns 是否产生了装载状态变化（未装载的插件被关掉 = false）
 */
export function setPluginEnabled(id: string, enabled: boolean): boolean {
  if (!state.started) return false
  const plugin = available.get(id)
  if (!plugin) return false
  if (enabled) {
    if (fibers.has(id)) return false
    loadPlugin(plugin)
    state.skipped = state.skipped.filter(entry => entry !== id)
    console.log(`[world-tree] 已装载插件（启停开）：${id}`)
    publish()
    return true
  }
  const removed = unloadPlugin(id)
  if (removed && !state.skipped.includes(id)) {
    state.skipped.push(id)
    publish() // 让句柄快照含最新 skipped（卸载内部已 publish 过一次）
  }
  return removed
}

/** 启动第二棵树（幂等：已启动则直接返回句柄）。 */
export async function startWorldTree(options?: StartOptions): Promise<WorldTreeHandle> {
  if (state.started) return publish()
  isEnabledFn = options?.isEnabled ?? (() => true)
  try {
    const context = new Context()
    ctx = context
    drops.push(
      context.provide('world.info', {
        name: 'WorldSea',
        tree: 'world',
        mode: 'browser',
      }),
    )
    const { accepted, report } = options?.plugins
      ? {
          accepted: options.plugins,
          report: {
            loaded: options.plugins.map(p => p.manifest.id),
            skipped: [] as string[],
            rejected: [] as LoadReport['rejected'],
          },
        }
      : await collectWorldPlugins([...WORLD_SERVICES], { isEnabled: options?.isEnabled })

    available.clear()
    for (const plugin of accepted) available.set(plugin.manifest.id, plugin)

    // 外部来源并入（目录缺失 = 空集不算错；id 撞内置 = 拒，先到者生效）
    const external = await collectExternalPlugins(projectDirProvider())
    externalCodes.clear()
    externalIds.clear()
    externalRejected = external.rejected
    for (const plugin of external.plugins) {
      const id = plugin.manifest.id
      if (available.has(id)) {
        const entry = external.rejected.find(item => item.id === id)
        const file = entry?.file ?? `${id}.js`
        externalRejected.push({ id, file, reason: 'id 与已装载插件冲突（先到者生效）' })
        continue
      }
      available.set(id, plugin)
      externalIds.add(id)
      externalCodes.set(id, external.codes.get(id) ?? '')
    }

    const enabled = new Set(report.loaded)
    // utility 插件常驻装载（批5：manifest.kind 声明，不受启停过滤——「内置插件常驻」对齐 dsh 内置语义）
    const forceLoad = (id: string) => available.get(id)?.manifest.kind === 'utility'
    for (const plugin of accepted) {
      if (enabled.has(plugin.manifest.id) || forceLoad(plugin.manifest.id)) loadPlugin(plugin)
    }
    // 外部插件装载（启停过滤口径与内置一致；utility 常驻；关掉的进 skipped）
    const externalSkipped: string[] = []
    for (const id of externalIds) {
      if (isEnabledFn(id) || forceLoad(id)) loadPlugin(available.get(id)!)
      else externalSkipped.push(id)
    }
    // isEnabled 过滤可能把 utility 记进 skipped（loader 层无 kind 语义）——常驻者从 skipped 剔除
    state.skipped = [...report.skipped, ...externalSkipped].filter(id => !forceLoad(id))
    state.rejected = report.rejected
    state.started = true
    console.log(
      `[world-tree] 已启动：装载 ${state.plugins.length} 个插件（跳过 ${state.skipped.length}）= ${state.plugins.join(' / ') || '无'}；` +
        `服务=${WORLD_SERVICES.join(' / ')}；内置被拒 ${state.rejected.length}；外部 ${externalIds.size}（被拒 ${externalRejected.length}）`,
    )
    if (state.rejected.length > 0) console.warn('[world-tree] 被拒插件：', state.rejected)
    if (externalRejected.length > 0) console.warn('[world-tree] 外部被拒：', externalRejected)
  } catch (error) {
    state.error = String(error)
    console.error('[world-tree] 启动失败：', error)
  }
  return publish()
}

/** 外部插件重对账报告。 */
export interface ExternalReloadReport {
  /** 新装载（目录里新出现的插件且启用） */
  added: string[]
  /** 代码变更 → 卸了重装 */
  updated: string[]
  /** 文件消失 → 已卸载 */
  removed: string[]
  /** 代码未变（不动） */
  unchanged: string[]
  /** 本次收集被拒条目（覆盖上次） */
  rejected: Array<{ id: string; file: string; reason: string }>
}

/**
 * 外部插件重对账（watcher 热装载/管理界面「重载」/项目切换共用）：
 * diff 目录 vs 现状——新增装载、消失卸载、变更重装（卸+装）；内置插件不碰。
 */
export async function reloadExternalPlugins(): Promise<ExternalReloadReport> {
  const report: ExternalReloadReport = { added: [], updated: [], removed: [], unchanged: [], rejected: [] }
  if (!state.started) return report
  const collect = await collectExternalPlugins(projectDirProvider())
  externalRejected = collect.rejected
  report.rejected = collect.rejected

  const nextIds = new Set(collect.plugins.map(plugin => plugin.manifest.id))
  for (const id of [...externalIds]) {
    if (nextIds.has(id)) continue
    unloadPlugin(id)
    externalIds.delete(id)
    externalCodes.delete(id)
    report.removed.push(id)
  }
  for (const plugin of collect.plugins) {
    const id = plugin.manifest.id
    if (available.has(id) && !externalIds.has(id)) {
      const entry = collect.rejected.find(item => item.id === id)
      externalRejected.push({ id, file: entry?.file ?? `${id}.js`, reason: 'id 与内置插件冲突（先到者生效）' })
      continue
    }
    const code = collect.codes.get(id) ?? ''
    if (externalCodes.has(id) && externalCodes.get(id) === code) {
      report.unchanged.push(id)
      continue
    }
    const isNew = !externalCodes.has(id) && !fibers.has(id)
    if (fibers.has(id)) unloadPlugin(id)
    available.set(id, plugin)
    externalIds.add(id)
    externalCodes.set(id, code)
    // utility 常驻装载（与 startWorldTree 同口径）
    if (isEnabledFn(id) || available.get(id)?.manifest.kind === 'utility') {
      loadPlugin(plugin)
      report[isNew ? 'added' : 'updated'].push(id)
      state.skipped = state.skipped.filter(entry => entry !== id)
    } else if (!state.skipped.includes(id)) {
      state.skipped.push(id)
    }
  }
  if (report.added.length + report.updated.length + report.removed.length > 0) {
    console.log(`[world-tree] 外部重对账：+${report.added.join('/')} ~${report.updated.join('/')} -${report.removed.join('/')}`)
  }
  publish()
  return report
}

/** 外部插件状态快照（管理界面数据源：装载态 + 被拒报告）。 */
export interface ExternalPluginState {
  id: string
  name: string
  version: string
  status: 'loaded' | 'skipped' | 'rejected'
  file: string
  reason?: string
  /** 插件身份（批5：utility = 常驻，不进 sprouts 启停） */
  kind?: 'sprout' | 'utility'
  /** 主语义域（manifest 声明；缺省 = unclassified，不默认归 tool） */
  domain?: string
  /** 副语义域 */
  secondaryDomains?: string[]
}

export function externalPluginStates(): ExternalPluginState[] {
  const states: ExternalPluginState[] = []
  for (const id of externalIds) {
    const plugin = available.get(id)
    if (!plugin) continue
    states.push({
      id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: fibers.has(id) ? 'loaded' : 'skipped',
      file: `${EXTERNAL_DIR_DISPLAY}/${id}.js`,
      kind: plugin.manifest.kind,
      domain: externalDomain(plugin.manifest),
      secondaryDomains: plugin.manifest.secondaryDomains,
    })
  }
  for (const entry of externalRejected) {
    states.push({
      id: entry.id,
      name: entry.id,
      version: '-',
      status: 'rejected',
      file: entry.file,
      reason: entry.reason,
    })
  }
  return states
}

/** 管理界面展示用相对路径（worlddata 根以下）。 */
const EXTERNAL_DIR_DISPLAY = 'worlddata/.worldsea/plugins'

/** 拆树（幂等）：插件清理 → 拆 fiber → 撤服务。 */
export function disposeWorldTree(): void {
  for (const id of [...fibers.keys()]) runPluginCleanups(id)
  pluginAPI.clearOverlays()
  for (const [id, fiber] of [...fibers.entries()]) {
    try {
      void fiber.dispose()
    } catch (error) {
      console.error(`[world-tree] 拆 fiber 抛错（${id}，已隔离）：`, error)
    }
  }
  fibers.clear()
  for (const drop of drops.splice(0)) {
    try {
      drop()
    } catch (error) {
      console.error('[world-tree] 撤服务抛错（已隔离）：', error)
    }
  }
  ctx = null
  available.clear()
  externalIds.clear()
  externalCodes.clear()
  externalRejected = []
  state.started = false
  state.plugins = []
  state.skipped = []
  console.log('[world-tree] 已拆除')
  publish()
}

/** 树上下文（插件/诊断用；未启动时为 null）。 */
export function worldTreeContext(): CordisContext | null {
  return ctx
}

/** 测试接缝：覆写外部插件目录的数据根（null 恢复默认 = FileStorageBackend.projectDir）。 */
export function setExternalProjectDirProvider(fn: (() => string | null | undefined) | null): void {
  projectDirProvider = fn ?? (() => getFileStorageBackend()?.projectDir ?? null)
}
