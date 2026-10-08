/**
 * 产品壳启动装配（C2，2026-09-25）。
 *
 * 历史：本文件前身是 `bootstrap.ts`（芽启动装配：预注册类型 → 装 viewHook → 逐个 activate 官方芽 →
 * 登记 worldview 芽表）。25 个官方芽**全部迁入第二棵树**后，那些职责分别归：
 * - **装载/注册** → `@/world`（树的装载器 + 作用域插件 API + 真启停）；
 * - **worldview 芽表** → `installWorldTree()`；
 * - 这里只剩**产品壳自身**的两件：① 视图生命周期同步装配 ② 首屏默认视图。
 */
import { useEntityStore, useRelationStore } from '@worldsea/entity-core/stores'
import { entitySchemaRegistry, getFileStorageBackend } from '@worldsea/entity-core/core'
import { invoke } from '@tauri-apps/api/core'

import { installViewSynchronizer } from './viewSync'
import { readLastViewId, useUIStore } from '../stores/uiStore'
import { resolveDefaultViewId, visibleViewsInSidebarOrder } from '../ui/layout/sidebar/viewOrder'

export interface BootstrapOptions {
  /** 跳过「默认选中首个视图」：切项目重播种时不应打断当前视图选择 */
  skipDefaultView?: boolean
}

/** D2-b（2026-09-27）：能力桥变更通知的消费端——Agent 经能力桥改动产品域数据后，
 *  实体/关系 store 重载（防抖合并连续变更）→「Agent 改完工作台即见」。
 *  事件由 `shell/capabilities.ts` 伺服在 mutates 能力成功后派发；幂等：模块级只挂一次
 *  （bootstrapShell 会被切项目重播种重复调用）。 */
let capabilityMutationListenerInstalled = false
function installCapabilityMutationListener(): void {
  if (capabilityMutationListenerInstalled) return
  capabilityMutationListenerInstalled = true
  let timer: number | null = null
  window.addEventListener('ws-capability-mutated', () => {
    if (timer !== null) clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void useEntityStore().loadAll()
      void useRelationStore().loadAll()
    }, 300)
  })
}

/** D2-c（2026-09-28）：schema 快照导出——把运行时实体类型注册表序列化到
 *  `<projectDir>/worlddata/.worldsea/schema-snapshot.json`（`.worldsea/` 被 FsWatcher 忽略，
 *  写快照不抖 UI）。消费方 = dsh 内置插件 `dsh-plugin-worldsea` 的 world_schema_get 与写类轻校验。
 *  失败只留日志（快照缺席时插件的写操作会 fail loud 提示先开一次工作台）。 */
async function exportSchemaSnapshot(): Promise<void> {
  try {
    // D3-a：快照策略门（产品域设置 `snapshotExport`；`off` = 不导出——插件写校验将 fail loud）。
    // 读取失败（浏览器预览等）→ null → 按缺省 auto 继续。
    const prefs = await invoke<{ snapshotExport?: string } | null>('cmd_product_prefs_get').catch(() => null)
    if (prefs?.snapshotExport === 'off') return
    const fsb = getFileStorageBackend()
    if (!fsb?.isReady || !fsb.projectDir) return
    const types = Object.fromEntries(
      entitySchemaRegistry.getAll().map(schema => [schema.typeKey, {
        typeKey: schema.typeKey,
        label: schema.label,
        fields: schema.fields,
        required: schema.fields.filter(field => field.required).map(field => field.key),
      }]),
    )
    // ★ projectDir 已是实体根（<工作区>/worlddata，entityDirOf 口径）——快照直接落其
    //   `.worldsea/` 子目录（watcher 忽略）；此前误再拼一层 worlddata 造成双重嵌套。
    const path = `${fsb.projectDir.replace(/\\/g, '/')}/.worldsea/schema-snapshot.json`
    await invoke('cmd_fs_write', {
      path,
      content: JSON.stringify({ generatedAt: new Date().toISOString(), types }, null, 2),
      createDirs: true,
    })
  } catch (err) {
    console.warn('[boot] schema 快照导出失败（插件 world_schema_get 将不可用，直到下次成功导出）:', err)
  }
}

export async function bootstrapShell(opts?: BootstrapOptions): Promise<void> {
  // 视图生命周期装配：真源（pluginAPI）派发 → pluginStore（侧栏）+ uiStore 顺序 自动镜像
  // （幂等；树插件与官方芽注册都走这一条路径）
  installViewSynchronizer()
  // D2-b：能力桥变更通知消费端（幂等挂一次）——Agent 改完工作台即见
  installCapabilityMutationListener()

  // 首屏默认视图：优先恢复上次视图（`worldsea_last_view`），否则侧栏首项——与侧栏渲染 /
  // Ctrl+↑/↓ 同走 `viewOrder` 单一口径（旧实现取注册序 `views[0]`＝装载器字典序，
  // `apparel` 恰排第一 → 首屏恒「服饰/装备」；2026-10-09 修）。切项目重播种时跳过。
  const uiStore = useUIStore()
  if (!opts?.skipDefaultView && !uiStore.currentView) {
    const views = visibleViewsInSidebarOrder()
    const target = views.find(view => view.id === resolveDefaultViewId(views, readLastViewId()))
    if (target) {
      uiStore.setView(target.id)
      uiStore.viewComponent = target.component
    }
  }

  // D2-c：schema 快照导出（此刻实体类型注册已就绪；切项目重播种同样走到，快照随项目更新）
  void exportSchemaSnapshot()
}
