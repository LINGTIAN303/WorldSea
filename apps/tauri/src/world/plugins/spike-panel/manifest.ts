/**
 * 示例插件清单（**轻数据**：不含视图 import）。
 */
import type { WorldPluginManifest } from '../../manifest'

export const SPIKE_PANEL_MANIFEST: WorldPluginManifest = {
  id: 'ws.spike.panel',
  name: 'Cordis Spike',
  version: '1.0.0',
  description: '第二棵树的示例插件：注册一个自检面板视图，并调用一个壳能力',
  requires: ['world.info'],
}
