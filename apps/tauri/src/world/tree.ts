/**
 * 第二棵树（世界语义）的装配（B，2026-09-25）。
 *
 * 口径（双 Cordis 三条判定线，见 docs/plans/2026-09-25-双Cordis-Spike批计划.md §一）：
 * - 本树只长**世界语义**（实体/芽/编辑器/视图）；**不许**长 session / turn / tool-loop / sandbox
 *   （需要这些去调 dsh，或经壳能力桥）。
 * - 与 dsh 的树**对等**：各自的服务命名空间、各自的生命周期；交界一律走**壳**（能力桥 / 仅应用级面）。
 * - 依赖 = 自 vendor 的 cordis 4.0.4（`./vendor/README.md`），**不依赖 `dsh/` 目录**。
 *
 * 生命周期：`startWorldTree()` 建 Context → `provide` 本树服务 → 装载插件（清单校验 + 依赖预检 +
 * 失败隔离，见 `./loader.ts`）→ 逐个 `ctx.plugin()`；`disposeWorldTree()` 执行插件清理 → 拆 fiber →
 * 撤服务。句柄镜像到 `globalThis.__WS_WORLD_TREE__`（探针友好，JSON 安全）。
 */
import { Context } from '@deepseek-ai/cordis'
import type { CordisContext, CordisFiberLike } from '@deepseek-ai/cordis'

import { collectWorldPlugins, type LoadReport } from './loader'
import type { WorldPlugin } from './manifest'
import { runPluginCleanups } from './registry'

/** 本树提供的服务（`requires` 预检的**权威名单**；新增服务 = 这里登记 + 下面 provide）。 */
export const WORLD_SERVICES: readonly string[] = ['world.info']

export interface WorldTreeState {
  started: boolean
  /** 已装载插件 id（按装载顺序） */
  plugins: string[]
  /** 被拒条目（清单非法 / 依赖缺失 / 导入失败）——不静默 */
  rejected: LoadReport['rejected']
  error: string | null
}

export interface WorldTreeHandle extends WorldTreeState {
  dispose(): void
}

const state: WorldTreeState = { started: false, plugins: [], rejected: [], error: null }
let ctx: CordisContext | null = null
const fibers: CordisFiberLike[] = []
const drops: Array<() => void> = []

function publish(): WorldTreeHandle {
  const handle: WorldTreeHandle = {
    started: state.started,
    plugins: [...state.plugins],
    rejected: [...state.rejected],
    error: state.error,
    dispose: disposeWorldTree,
  }
  ;(globalThis as { __WS_WORLD_TREE__?: WorldTreeHandle }).__WS_WORLD_TREE__ = handle
  return handle
}

/** 当前状态快照（探针/诊断）。 */
export function worldTreeState(): WorldTreeState {
  return { started: state.started, plugins: [...state.plugins], rejected: [...state.rejected], error: state.error }
}

/** 启动第二棵树（幂等：已启动则直接返回句柄）。
 * @param options.plugins 注入装载结果（**测试/开发接缝**：跳过 `collectWorldPlugins` 的真图导入） */
export async function startWorldTree(options?: { plugins?: WorldPlugin[] }): Promise<WorldTreeHandle> {
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
      ? { accepted: options.plugins, report: { loaded: options.plugins.map(p => p.manifest.id), rejected: [] } }
      : await collectWorldPlugins([...WORLD_SERVICES])
    state.rejected = report.rejected
    for (const plugin of accepted) {
      const fiber = context.plugin(
        {
          name: plugin.manifest.id,
          inject: plugin.manifest.requires ?? [],
          apply: (inner, config) => plugin.apply(inner, config),
        },
        // 配置随插件走（与 cordis 的 config 校验解耦：清单已校验，这里只透传）
        { manifest: plugin.manifest },
      )
      fibers.push(fiber)
      state.plugins.push(plugin.manifest.id)
    }
    state.started = true
    console.log(
      `[world-tree] 已启动：装载 ${state.plugins.length} 个插件（${state.plugins.join(' / ') || '无'}）；` +
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
  for (const id of [...state.plugins]) runPluginCleanups(id)
  for (const fiber of fibers.splice(0)) {
    try {
      void fiber.dispose()
    } catch (error) {
      console.error('[world-tree] 拆 fiber 抛错（已隔离）：', error)
    }
  }
  for (const drop of drops.splice(0)) {
    try {
      drop()
    } catch (error) {
      console.error('[world-tree] 撤服务抛错（已隔离）：', error)
    }
  }
  ctx = null
  state.started = false
  state.plugins = []
  console.log('[world-tree] 已拆除')
  publish()
}

/** 树上下文（插件/诊断用；未启动时为 null）。 */
export function worldTreeContext(): CordisContext | null {
  return ctx
}
