// 项目级背景的读写：加载（带 token 防项目切换竞态）+ 150ms 防抖保存 + 挂起快照 flush。
// 从设置卡抽出的纯持久化层，不含任何 UI 状态。
// 机制说明见 docs/details/架构/界面背景机制-v2.md
import type { ComputedRef, Ref } from 'vue'
import {
  BACKGROUND_TARGETS,
  BACKGROUND_THEMES,
  normalizeProjectConfig,
  type BackgroundProjectConfig,
  type BackgroundScope,
  type BackgroundTarget,
  type BackgroundTheme,
} from '@worldsea/style-kit'
import {
  cleanupProjectBackgroundOrphans,
  deleteProjectBackground,
  readProjectBackground,
  resolveProjectBackgroundAssets,
  writeProjectBackground,
} from '@worldsea/entity-core/core'

interface PersistDeps {
  projectDir: ComputedRef<string | null | undefined>
  scope: Ref<BackgroundScope>
  projectConfig: Ref<BackgroundProjectConfig | null | undefined>
  setProjectConfig: (config: BackgroundProjectConfig | null) => void
  setTargetSrcs: (target: BackgroundTarget, next: { light?: string; dark?: string }, scope: BackgroundScope) => void
  markMissing: (target: BackgroundTarget, theme: BackgroundTheme, scope: BackgroundScope) => void
  flushGlobal: () => void
}

export function useBackgroundProjectPersist(deps: PersistDeps) {
  const { projectDir, scope, projectConfig, setProjectConfig, setTargetSrcs, markMissing, flushGlobal } = deps

  // ── 加载：本地 token 防项目切换竞态 ──
  let loadToken = 0

  /** 作废在途加载：用户操作产生新状态后，旧加载不得再回写配置/运行时态 */
  function invalidateProjectLoad() {
    loadToken++
  }

  async function reloadProject() {
    const token = ++loadToken
    const dir = projectDir.value
    if (!dir) {
      setProjectConfig(null)
      if (scope.value === 'project') scope.value = 'global'
      return
    }
    try {
      const raw = await readProjectBackground(dir)
      if (token !== loadToken) return
      const config = normalizeProjectConfig(raw)
      if (!config) { setProjectConfig(null); return }
      const refs: Array<{ target: BackgroundTarget; theme: BackgroundTheme; path: string }> = []
      for (const t of BACKGROUND_TARGETS) {
        const cfg = config.targets[t]
        if (!cfg) continue
        for (const theme of BACKGROUND_THEMES) {
          if (cfg.paths[theme]) refs.push({ target: t, theme, path: cfg.paths[theme] })
        }
      }
      const { srcs, missing: miss } = await resolveProjectBackgroundAssets(dir, refs)
      if (token !== loadToken) return
      setProjectConfig(config)
      for (const t of BACKGROUND_TARGETS) {
        if (!config.targets[t]) continue
        setTargetSrcs(t, { light: srcs[t]?.light ?? '', dark: srcs[t]?.dark ?? '' }, 'project')
        for (const theme of BACKGROUND_THEMES) if (miss[t]?.[theme]) markMissing(t, theme, 'project')
      }
    } catch (err) {
      console.warn('[background] 设置卡加载项目背景失败:', err)
    }
  }

  // ── 保存 ──
  interface ProjectSaveSnapshot { dir: string; config: BackgroundProjectConfig | null }
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave: ProjectSaveSnapshot | null = null

  /** 当前项目配置的深拷贝；无自定义目标返回 null（表示删除配置文件） */
  function projectSnapshot(): BackgroundProjectConfig | null {
    const config = projectConfig.value
    if (!config || !Object.keys(config.targets).length) return null
    return JSON.parse(JSON.stringify(config)) as BackgroundProjectConfig
  }

  /** 配置里引用的项目相对路径；供孤儿清理保留在用图片 */
  function referencedPaths(config: BackgroundProjectConfig): string[] {
    const refs: string[] = []
    for (const target of Object.values(config.targets)) {
      if (!target) continue
      for (const theme of BACKGROUND_THEMES) {
        const rel = target.paths[theme]
        if (rel) refs.push(rel)
      }
    }
    return refs
  }

  function writeProjectSnapshot(snap: ProjectSaveSnapshot) {
    if (snap.config) {
      const config = snap.config
      // 写配置成功后清理未被引用的项目图片；清理内部吞错，不影响保存链路
      void writeProjectBackground(snap.dir, config)
        .then(() => cleanupProjectBackgroundOrphans(snap.dir, referencedPaths(config)))
        .catch((err) => {
          console.warn('[background] 保存项目背景失败:', err)
        })
    } else {
      // 项目回到全跟随全局：删配置后清空残留图片
      void deleteProjectBackground(snap.dir).then(() => cleanupProjectBackgroundOrphans(snap.dir, []))
    }
  }

  /** 立即落盘；未指定目录时取当前项目，先取消挂起快照以免旧快照后到覆盖 */
  function persistProjectNow(dir = projectDir.value ?? undefined) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    pendingSave = null
    if (!dir) return
    writeProjectSnapshot({ dir, config: projectSnapshot() })
  }

  /** 150ms 防抖：调度即捕获快照，定时器触发时不再读当前项目状态 */
  function scheduleProjectSave() {
    if (saveTimer) clearTimeout(saveTimer)
    const dir = projectDir.value
    if (!dir) return
    pendingSave = { dir, config: projectSnapshot() }
    saveTimer = setTimeout(() => {
      saveTimer = null
      const snap = pendingSave
      pendingSave = null
      if (snap) writeProjectSnapshot(snap)
    }, 150)
  }

  /** 落盘挂起快照（不读当前状态）：切项目/卸载前调用，防止旧配置写进新项目 */
  function flushPendingProjectSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const snap = pendingSave
    pendingSave = null
    if (snap) writeProjectSnapshot(snap)
  }

  function persistNow() {
    if (scope.value === 'project') persistProjectNow()
    else flushGlobal()
  }

  function schedulePersist() {
    if (scope.value === 'project') scheduleProjectSave()
  }

  return {
    invalidateProjectLoad,
    reloadProject,
    persistProjectNow,
    scheduleProjectSave,
    flushPendingProjectSave,
    persistNow,
    schedulePersist,
  }
}
