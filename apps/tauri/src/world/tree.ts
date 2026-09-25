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

import { createPluginApi } from './api'
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

    const enabled = new Set(report.loaded)
    for (const plugin of accepted) {
      if (enabled.has(plugin.manifest.id)) loadPlugin(plugin)
    }
    state.skipped = [...report.skipped]
    state.rejected = report.rejected
    state.started = true
    console.log(
      `[world-tree] 已启动：装载 ${state.plugins.length} 个插件（跳过 ${state.skipped.length}）= ${state.plugins.join(' / ') || '无'}；` +
        `服务=${WORLD_SERVICES.join(' / ')}；被拒 ${state.rejected.length}`,
    )
    if (state.rejected.length > 0) console.warn('[world-tree] 被拒插件：', state.rejected)
  } catch (error) {
    state.error = String(error)
    console.error('[world-tree] 启动失败：', error)
  }
  return publish()
}

/** 拆树（幂等）：插件清理 → 拆 fiber → 撤服务。 */
export function disposeWorldTree(): void {
  for (const id of [...fibers.keys()]) runPluginCleanups(id)
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
