/**
 * 「思维导图」插件（C，2026-09-25）：从官方芽 `official.mindmap` **迁入第二棵树**的第一个真芽。
 *
 * 迁移口径（见 docs/plans/2026-09-25-C-迁真芽-mindmap批计划.md）：
 * - 身份 = `ws.mindmap`（离开官方芽清单 → 设置面板不再有该启停行；侧栏可见性由
 *   `isViewVisible` 的「清单外→显示」接管）；
 * - 视图注册走**作用域原语**（`registerViewFor`）——`pluginId` 恒为 `ws.mindmap`；
 * - 代理能力 = `capabilities.ts` 的 5 条 `world.mindmap.*`，经 A 批能力桥暴露（acl=[main]）；
 *   随插件装载登记、随清理撤登记（拆树可证）。
 * - 依赖：`MindmapView` 用 entity-core / ui-kit / plugin-sdk（产品级共享服务，合法依赖，无需切分）。
 */
import { markRaw } from 'vue'

import { registerPluginCleanup, registerViewFor, unregisterViewFor } from '../../registry'
import { unregisterWorldCapabilities, registerWorldCapabilities } from '@/shell/capabilities'
import type { WorldPlugin } from '../../manifest'
import MindmapView from './MindmapView.vue'
import { WORLD_MINDMAP_CAPABILITIES } from './capabilities'
import { MINDMAP_MANIFEST } from './manifest'

const PLUGIN_ID = MINDMAP_MANIFEST.id
const VIEW_ID = 'mindmap'
const CAPABILITY_IDS = WORLD_MINDMAP_CAPABILITIES.map(capability => capability.id)

const plugin: WorldPlugin = {
  manifest: MINDMAP_MANIFEST,
  apply() {
    registerViewFor(PLUGIN_ID, {
      id: VIEW_ID,
      label: '思维导图',
      icon: 'mindmap',
      component: markRaw(MindmapView),
    })
    void registerWorldCapabilities(WORLD_MINDMAP_CAPABILITIES).catch((error: unknown) => {
      console.error('[world-tree] 能力登记失败（mindmap）：', error)
    })
    registerPluginCleanup(PLUGIN_ID, () => {
      unregisterViewFor(PLUGIN_ID, VIEW_ID)
      void unregisterWorldCapabilities(CAPABILITY_IDS).catch((error: unknown) => {
        console.error('[world-tree] 能力撤登记失败（mindmap）：', error)
      })
    })
  },
}

export default plugin
