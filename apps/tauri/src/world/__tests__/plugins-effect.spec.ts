/**
 * 阶段 2 · 真实插件冒烟：10 个 `kind: 'utility'` 插件在 **`ctx.effect` 路径**下的登记与回卷。
 *
 * 【为什么选这 10 个】它们的 `index.ts` 不 import `.vue`（组件都走 `defineAsyncComponent` 懒加载），
 * 因而可被 vitest 直接导入而不触起重依赖（`FieldMatrixView.vue` 那类会超时，见 tree.spec 文件头注）。
 * 覆盖了「单 overlay」「多 overlay」「带 menu」「带 shortcutId」四种登记形态。
 *
 * 【测什么】这是**真插件**而非形态复刻——验证 `createPluginApi(id, ctx)` 的 tracked() 在真实
 * 插件代码上不改变行为（登记进真源、pluginId 正确、卸载全撤）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'
import { Context } from '@deepseek-ai/cordis'

import { createPluginApi } from '../api'

import { manifest as batchEditManifest, apply as applyBatchEdit } from '../plugins/batch-edit'
import { manifest as dataToolsManifest, apply as applyDataTools } from '../plugins/data-tools'
import { manifest as docExportManifest, apply as applyDocExport } from '../plugins/doc-export'
import { manifest as entityToolsManifest, apply as applyEntityTools } from '../plugins/entity-tools'
import { manifest as importExportManifest, apply as applyImportExport } from '../plugins/import-export'
import { manifest as searchManifest, apply as applySearch } from '../plugins/search'
import { manifest as settingsManifest, apply as applySettings } from '../plugins/settings'
import { manifest as templatesManifest, apply as applyTemplates } from '../plugins/templates'
import { manifest as themeEditorManifest, apply as applyThemeEditor } from '../plugins/theme-editor'
import { manifest as versionHistoryManifest, apply as applyVersionHistory } from '../plugins/version-history'

afterEach(() => {
  pluginAPI.clearOverlays()
})

/** 10 个可在 vitest 直接导入的真实插件。 */
const CASES = [
  { name: 'batch-edit', manifest: batchEditManifest, apply: applyBatchEdit, overlays: ['batch-edit'] },
  { name: 'data-tools', manifest: dataToolsManifest, apply: applyDataTools, overlays: ['trash', 'artifacts', 'consistency'] },
  { name: 'doc-export', manifest: docExportManifest, apply: applyDocExport, overlays: ['doc-export'] },
  { name: 'entity-tools', manifest: entityToolsManifest, apply: applyEntityTools, overlays: ['custom-rel-type', 'entity-template'] },
  { name: 'import-export', manifest: importExportManifest, apply: applyImportExport, overlays: ['import-export'] },
  { name: 'search', manifest: searchManifest, apply: applySearch, overlays: ['search'] },
  { name: 'settings', manifest: settingsManifest, apply: applySettings, overlays: ['settings'] },
  { name: 'templates', manifest: templatesManifest, apply: applyTemplates, overlays: ['template'] },
  { name: 'theme-editor', manifest: themeEditorManifest, apply: applyThemeEditor, overlays: ['theme-editor'] },
  { name: 'version-history', manifest: versionHistoryManifest, apply: applyVersionHistory, overlays: ['version'] },
] as const

describe('阶段 2 · 真实插件走 ctx.effect（冒烟）', () => {
  it.each(CASES)('$name：装载登记 overlay，拆 fiber 后全部回卷', async ({ name, manifest, apply, overlays }) => {
    const app = new Context()
    const fiber = app.plugin({
      name: manifest.id,
      inject: [],
      apply: (inner) => apply(inner as never, createPluginApi(manifest.id, inner as never)),
    })
    await fiber

    const registered = pluginAPI.getOverlays()
    expect(registered.map(o => o.id).sort(), `${name} 应登记 ${overlays.length} 个 overlay`)
      .toEqual([...overlays].sort())
    for (const overlay of registered) {
      expect(overlay.pluginId, `${name} 的 ${overlay.id} 归属应为插件 id`).toBe(manifest.id)
      expect(overlay.component, `${name} 的 ${overlay.id} 应携带组件`).toBeTruthy()
    }

    await fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(pluginAPI.getOverlays(), `${name} 卸载后应全部回卷`).toHaveLength(0)
    await app.fiber.dispose()
  })
})

describe('阶段 2 · 同一插件装/卸 3 轮（真启停背靠背）', () => {
  it('official.data-tools 反复启停不泄漏', async () => {
    const app = new Context()
    const { manifest, apply } = { manifest: dataToolsManifest, apply: applyDataTools }

    for (let round = 0; round < 3; round++) {
      const fiber = app.plugin({
        name: manifest.id,
        inject: [],
        apply: (inner) => apply(inner as never, createPluginApi(manifest.id, inner as never)),
      })
      await fiber
      expect(pluginAPI.getOverlays(), `第 ${round + 1} 轮装载后应有 3 个`).toHaveLength(3)

      await fiber.dispose()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(pluginAPI.getOverlays(), `第 ${round + 1} 轮卸载后应为空`).toHaveLength(0)
    }

    await app.fiber.dispose()
  })
})

describe('阶段 2 · effect 路径的独有价值：不依赖 runPluginCleanups', () => {
  /**
   * 这条锁的是**根本差异**，不是等价性。
   *
   * 旧 cleanup 表路径：撤销由 `runPluginCleanups(id)` 手动触发——**忘了调就泄漏**。
   * 新 effect 路径：撤销挂在 fiber 上，`fiber.dispose()` 即回卷——**无「忘记调用」的失败模式**。
   *
   * 故此处**刻意不调用 `runPluginCleanups`**，只 `fiber.dispose()`：
   * 只有 effect 路径能通过；cleanup 表路径必然留下幽灵 overlay。
   * （这是第一轮反证意外暴露的：回退到不传 ctx 后 11 例全红，失败原因正是「卸载后应全部回卷 but got 1」。）
   */
  it('只 fiber.dispose()、不调 runPluginCleanups —— 真实插件仍应完全回卷', async () => {
    const app = new Context()
    const fiber = app.plugin({
      name: settingsManifest.id,
      inject: [],
      apply: (inner) => applySettings(inner as never, createPluginApi(settingsManifest.id, inner as never)),
    })
    await fiber
    expect(pluginAPI.getOverlays().map(o => o.id)).toEqual(['settings'])

    // 关键：不调 runPluginCleanups(settingsManifest.id)
    await fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(
      pluginAPI.getOverlays(),
      'effect 挂在 fiber 上，fiber.dispose() 必须完成回卷（cleanup 表路径此处会泄漏）',
    ).toHaveLength(0)

    await app.fiber.dispose()
  })
})
