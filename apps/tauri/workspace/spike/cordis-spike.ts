/**
 * 双 Cordis Spike（2026-09-25）：在**工作台页**里跑起第二棵 Cordis 树，验四件事：
 *  ① 与 dsh 的树并存（不同页面环境 → 全局/样式/DOM/事件互不污染）
 *  ② 一个「芽」按插件模型装载（name / inject / config / 生命周期清理）
 *  ③ 插件**注册进现有产品壳**（entity-core `pluginStore.registerView` → 侧栏实时出现入口）
 *  ④ 插件调**壳能力**（Tauri IPC，受工作台窗 ACL 约束：此处用 `cmd_theme_get`）
 *
 * 验收探针（均可 JSON 化，不含循环引用）：
 *  - `globalThis.__WS_CORDIS_SPIKE__`：{ started, plugins, capability, error, disposed, dispose() }
 *  - `globalThis.__WS_CORDIS_SPIKE_CTX__` / `__WS_CORDIS_SPIKE_PLUGIN__`：句柄原件（调试用）
 *
 * 依赖口径：**相对引用** dsh 树内 vendored 的 `@deepseek-ai/cordis`（4.0.4 = 上游 cordis 副本，MIT）
 * ——Spike 不新增依赖、不碰 dsh 树；正式化时改 npm `cordis@4.0.4` 或自 vendor（见批计划）。
 * 类型面：跨树引用构建产物，故在本文内自声明最小接口（`// @ts-ignore` 一处）。
 */
// @ts-ignore —— 跨树引用 vendored cordis 产物（spike 专用）
import { Context } from '../../../../dsh/vendor/cordis/lib/index.js'
import { invoke } from '@tauri-apps/api/core'
import { defineComponent, h, markRaw, reactive } from 'vue'

import { usePluginStore } from '@worldsea/entity-core'
import { useUIStore } from '@/stores/uiStore'

/** cordis 侧最小接口（只声明本 spike 用到的面）。 */
interface CordisFiberLike {
  dispose?: () => unknown
}
interface CordisCtx {
  plugin(plugin: CordisPlugin, config?: Record<string, unknown>): CordisFiberLike | void
  provide(name: string, value: unknown): () => void
  get(name: string, strict?: boolean): unknown
  effect?(execute: () => () => void, label?: string): unknown
}
interface CordisPlugin {
  name: string
  inject?: string[]
  apply(ctx: CordisCtx, config?: Record<string, unknown>): void
}

export interface CordisSpikeState {
  started: boolean
  plugins: string[]
  capability: string | null
  error: string | null
  disposed: boolean
  dispose(): void
}

const VIEW_ID = 'ws-cordis-spike'

/** 模块级响应式状态：插件写、视图读（首版用全局对象是快照渲染，会停在「未调用」）。 */
const live = reactive({
  started: false,
  plugins: [] as string[],
  capability: null as string | null,
  error: null as string | null,
  disposed: false,
})

/** 把响应式状态镜像到全局（探针用；保持 JSON 安全）。 */
function mirror(): void {
  const handle = (globalThis as { __WS_CORDIS_SPIKE__?: CordisSpikeState }).__WS_CORDIS_SPIKE__
  if (!handle) return
  handle.started = live.started
  handle.plugins = [...live.plugins]
  handle.capability = live.capability
  handle.error = live.error
  handle.disposed = live.disposed
}

/** Spike 视图：注册进产品壳后，点侧栏「Cordis Spike」即可看到。 */
const SpikeView = defineComponent({
  name: 'WsCordisSpikeView',
  setup() {
    return () =>
      h('div', { style: 'padding:24px;font:14px/1.8 system-ui,"Microsoft YaHei"' }, [
        h('h2', { style: 'margin:0 0 12px' }, 'Cordis Spike · 第二棵树'),
        h('div', `树状态：${live.started ? 'running' : 'idle'}${live.disposed ? '（已拆除）' : ''}`),
        h('div', `已装载插件：${live.plugins.join('、') || '（无）'}`),
        h('div', `壳能力 cmd_theme_get → ${live.capability ?? '（未调用）'}`),
        h(
          'div',
          `服务注入（greeting）：${String((globalThis as { __WS_CORDIS_GREETING__?: unknown }).__WS_CORDIS_GREETING__ ?? '（未提供）')}`,
        ),
        live.error ? h('div', { style: 'color:#d13438;margin-top:8px' }, `错误：${live.error}`) : null,
        h(
          'div',
          { style: 'margin-top:12px;color:#888' },
          '此视图由第二棵 Cordis 树注册；探针可调 __WS_CORDIS_SPIKE__.dispose() 拆除它。',
        ),
      ])
  },
})

/** 插件自持的清理函数（不依赖框架 effect 可达性——「拆树可证」是 Spike 的验收项）。 */
const cleanups: Array<() => void> = []

/**
 * 一个最小「芽」插件：装载时注册视图 + 读壳能力 + 记一笔；拆除时反注册并清理。
 * `inject: ['wsGreeting']` 演示依赖注入——服务由本树在装载前 provide。
 */
const spikeSprout: CordisPlugin = {
  name: 'ws-spike-sprout',
  inject: ['wsGreeting'],
  apply(ctx, config) {
    try {
      ;(globalThis as { __WS_CORDIS_GREETING__?: string }).__WS_CORDIS_GREETING__ = String(
        ctx.get('wsGreeting', false) ?? '',
      )
      const store = usePluginStore()
      store.registerView({
        id: VIEW_ID,
        label: String(config?.label ?? 'Cordis Spike'),
        icon: 'bulb',
        component: markRaw(SpikeView),
      })
      useUIStore().ensureViewInOrder(VIEW_ID)
      live.plugins.push(spikeSprout.name)
      mirror()
      // 壳能力：走 Tauri IPC（工作台窗 ACL 内的 cmd_theme_get）
      void invoke<string>('cmd_theme_get')
        .then(value => {
          live.capability = value
          mirror()
        })
        .catch(error => {
          live.error = String(error)
          mirror()
        })
      // 生命周期：拆树/卸插件时反注册视图（框架 effect 优先，本地 cleanups 兜底）。
      // ★ 产品壳目前**没有「单个视图反注册」**：`pluginAPI.unregisterView` 动的是它自己的数组，
      //   而侧栏读的是 `pluginStore.views` → 这里直接过滤 store 数组（正式化时应给 store 补一个）。
      const cleanup = () => {
        store.views = store.views.filter(view => view.id !== VIEW_ID)
        live.plugins = live.plugins.filter(name => name !== spikeSprout.name)
        mirror()
      }
      cleanups.push(cleanup)
      try {
        ctx.effect?.(() => cleanup, 'spike-sprout-cleanup')
      } catch (error) {
        // 框架 effect 不可用不影响拆树（cleanups 兜底），但留痕
        console.warn('[cordis-spike] ctx.effect 注册失败，已退回本地 cleanups：', error)
      }
    } catch (error) {
      live.error = String(error)
      mirror()
      console.error('[cordis-spike] 插件装载失败:', error)
    }
  },
}

/** 启动第二棵树（幂等：已启动则直接返回既有状态）。 */
export function startCordisSpike(config?: Record<string, unknown>): CordisSpikeState {
  const existing = (globalThis as { __WS_CORDIS_SPIKE__?: CordisSpikeState }).__WS_CORDIS_SPIKE__
  if (existing?.started && !existing.disposed) return existing
  const handle: CordisSpikeState = {
    started: false,
    plugins: [],
    capability: null,
    error: null,
    disposed: false,
    dispose: () => {
      cleanups.splice(0).forEach(run => {
        try {
          run()
        } catch (error) {
          live.error = String(error)
        }
      })
      try {
        const plugin = (globalThis as { __WS_CORDIS_SPIKE_PLUGIN__?: CordisFiberLike })
          .__WS_CORDIS_SPIKE_PLUGIN__
        if (plugin && typeof plugin.dispose === 'function') void plugin.dispose()
      } catch (error) {
        live.error = String(error)
      }
      live.disposed = true
      live.started = false
      mirror()
    },
  }
  ;(globalThis as { __WS_CORDIS_SPIKE__?: CordisSpikeState }).__WS_CORDIS_SPIKE__ = handle
  mirror()
  try {
    const ctx = new Context() as unknown as CordisCtx
    ;(globalThis as { __WS_CORDIS_SPIKE_CTX__?: unknown }).__WS_CORDIS_SPIKE_CTX__ = ctx
    // 本树自己的服务（对等树各自的服务命名空间，不与 dsh 混）
    const dropGreeting = ctx.provide('wsGreeting', '来自 WorldSea 树的问候')
    cleanups.push(dropGreeting)
    const plugin = ctx.plugin(spikeSprout, { label: String(config?.label ?? 'Cordis Spike') })
    ;(globalThis as { __WS_CORDIS_SPIKE_PLUGIN__?: unknown }).__WS_CORDIS_SPIKE_PLUGIN__ = plugin
    live.started = true
    mirror()
    console.log('[cordis-spike] 第二棵树已启动：plugin=ws-spike-sprout，view=' + VIEW_ID)
  } catch (error) {
    live.error = String(error)
    mirror()
    console.error('[cordis-spike] 启动失败:', error)
  }
  return handle
}
