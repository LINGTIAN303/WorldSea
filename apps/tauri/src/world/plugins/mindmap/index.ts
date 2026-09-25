/**
 * 「思维导图」插件（C，2026-09-25）：从官方芽 `official.mindmap` **迁入第二棵树**的第一个真芽。
 *
 * 迁移口径（见 docs/plans/2026-09-25-C-迁真芽-mindmap批计划.md）：
 * - 身份 = **`official.mindmap`**（C2 走查修正：与其余 25 芽同口径——芽面板即插件启停台账，
 *   故加回清单行；C 批曾用 `ws.mindmap` 并离开清单，那是当时的临时口径）；
 * - 视图注册走**作用域化插件 API**（`api.registerView`）——`pluginId` 恒为 `official.mindmap`，
 *   且卸载时由 API 自动反注册；
 * - 代理能力 = `capabilities.ts` 的 5 条 `world.mindmap.*`，经 A 批能力桥暴露（acl=[main]），
 *   随插件装载登记、随清理撤登记（拆树可证）。
 * - 依赖：`MindmapView` 用 entity-core / ui-kit / plugin-sdk（产品级共享服务，合法依赖，无需切分）。
 */
import { markRaw } from 'vue'

import type { WorldPlugin } from '../../manifest'
import MindmapView from './MindmapView.vue'
import { WORLD_MINDMAP_CAPABILITIES } from './capabilities'
import { MINDMAP_MANIFEST } from './manifest'

const VIEW_ID = 'mindmap'

const plugin: WorldPlugin = {
  manifest: MINDMAP_MANIFEST,
  apply(_ctx, api) {
    api.registerView({
      id: VIEW_ID,
      label: '思维导图',
      icon: 'mindmap',
      component: markRaw(MindmapView),
    })
    void api.capabilities.register(WORLD_MINDMAP_CAPABILITIES).catch((error: unknown) => {
      console.error('[world-tree] 能力登记失败（mindmap）：', error)
    })
  },
}

export default plugin
