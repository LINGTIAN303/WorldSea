/**
 * 示例插件（B，2026-09-25）：把 Spike 的探针面板转正为**树的第一个插件**。
 * 演示四件事：① 清单（`manifest`）② 依赖注入（`requires: ['world.info']`）③ 按插件作用域注册视图
 * ④ 调壳能力（`cmd_theme_get`，A 批的能力桥/壳命令）。拆树时清理登记在 `registerPluginCleanup`。
 */
import { defineComponent, h, markRaw, reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'

import { worldTreeState, worldTreeContext } from '../../tree'
import type { WorldPlugin } from '../../manifest'
import { SPIKE_PANEL_MANIFEST } from './manifest'

const VIEW_ID = 'ws-world-tree-panel'

/** 视图级响应式状态（首版读全局对象 = 快照渲染，故自持 reactive）。 */
const live = reactive({
  capability: null as string | null,
  error: null as string | null,
})

const PanelView = defineComponent({
  name: 'WsWorldTreePanelView',
  setup() {
    return () => {
      const tree = worldTreeState()
      const info = (worldTreeContext()?.get('world.info', false) ?? null) as { name?: string } | null
      return h('div', { style: 'padding:24px;font:14px/1.8 system-ui,"Microsoft YaHei"' }, [
        h('h2', { style: 'margin:0 0 12px' }, 'WorldSea 树 · 示例插件'),
        h('div', `树状态：${tree.started ? 'running' : 'idle'}`),
        h('div', `已装载插件：${tree.plugins.join('、') || '（无）'}`),
        h('div', `服务注入（world.info.name）：${info?.name ?? '（未提供）'}`),
        h('div', `壳能力 cmd_theme_get → ${live.capability ?? '（未调用）'}`),
        live.error ? h('div', { style: 'color:#d13438;margin-top:8px' }, `错误：${live.error}`) : null,
        h(
          'div',
          { style: 'margin-top:12px;color:#888' },
          '此视图由第二棵树（世界语义）的插件注册；`__WS_WORLD_TREE__.dispose()` 可拆树验证反注册。',
        ),
      ])
    }
  },
})

const plugin: WorldPlugin = {
  manifest: SPIKE_PANEL_MANIFEST,
  apply(ctx, api) {
    // 依赖注入：服务由本树在装载前 provide（世界语义的自有服务）
    const info = ctx.get('world.info', false) as { name?: string } | null
    api.registerView({
      id: VIEW_ID,
      label: 'Cordis Spike',
      icon: 'bulb',
      component: markRaw(PanelView),
    })
    void invoke<string>('cmd_theme_get')
      .then(value => {
        live.capability = value
      })
      .catch((error: unknown) => {
        live.error = String(error)
      })
    console.log(`[world-tree] 插件已装载：${SPIKE_PANEL_MANIFEST.id}（info=${info?.name ?? '-'}）`)
  },
}

export default plugin
