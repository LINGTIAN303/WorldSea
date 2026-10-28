import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getProjectManager } from '../core'
import { setEffectiveIconOverrides } from '../core/iconOverrides'

export const ICON_GLOBAL_STORAGE_KEY = 'worldsea_icon_overrides_global'
export const ICON_PROJECT_SETTING_KEY = 'icon_overrides'
export const ICON_PROJECT_FALLBACK_PREFIX = 'worldsea_icon_overrides_project:'

export type IconOverrideSource = 'default' | 'global' | 'project'

export interface IconOverrideMapState {
  version: 1
  overrides: Record<string, string>
}

export interface ProjectIconOverrideState extends IconOverrideMapState {
  followGlobal: boolean
  /** 写入时间戳：项目库与分键 localStorage 回退取较新者，避免快速重启丢最后一次写入。 */
  updatedAt?: number
}

export function sanitizeOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key.trim()) continue
    if (typeof value !== 'string' || !value.trim()) continue
    out[key] = value.trim()
  }
  return out
}

export function buildEffectiveMap(
  globalState: IconOverrideMapState,
  projectState: ProjectIconOverrideState,
): Map<string, string> {
  const map = new Map<string, string>()
  if (projectState.followGlobal) {
    for (const [key, icon] of Object.entries(globalState.overrides)) map.set(key, icon)
  }
  for (const [key, icon] of Object.entries(projectState.overrides)) map.set(key, icon)
  return map
}

/** 项目库与 localStorage 回退取较新者；时间戳相同/缺失时项目库优先。 */
export function pickNewerProjectState(
  fromDb: ProjectIconOverrideState | null,
  fallback: ProjectIconOverrideState | null,
): ProjectIconOverrideState | null {
  if (!fromDb) return fallback
  if (!fallback) return fromDb
  return (fallback.updatedAt ?? 0) > (fromDb.updatedAt ?? 0) ? fallback : fromDb
}

function defaultProjectState(): ProjectIconOverrideState {
  return { version: 1, followGlobal: true, overrides: {}, updatedAt: 0 }
}

function readGlobalState(): IconOverrideMapState {
  try {
    const raw = localStorage.getItem(ICON_GLOBAL_STORAGE_KEY)
    if (!raw) return { version: 1, overrides: {} }
    const parsed = JSON.parse(raw) as { overrides?: unknown }
    return { version: 1, overrides: sanitizeOverrides(parsed?.overrides) }
  } catch {
    return { version: 1, overrides: {} }
  }
}

function writeGlobalState(state: IconOverrideMapState): void {
  try {
    localStorage.setItem(ICON_GLOBAL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 配额/隐私模式不可用：内存态继续，重启丢失属可接受退化
  }
}

function currentProjectId(): string | null {
  try {
    return getProjectManager().getCurrentProjectId()
  } catch {
    return null
  }
}

function projectFallbackKey(projectId: string): string {
  return `${ICON_PROJECT_FALLBACK_PREFIX}${projectId}`
}

function readProjectFallback(projectId: string | null): ProjectIconOverrideState | null {
  if (!projectId) return null
  try {
    const raw = localStorage.getItem(projectFallbackKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { followGlobal?: unknown; overrides?: unknown; updatedAt?: unknown }
    return {
      version: 1,
      followGlobal: parsed?.followGlobal !== false,
      overrides: sanitizeOverrides(parsed?.overrides),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

function writeProjectFallback(projectId: string | null, state: ProjectIconOverrideState): void {
  if (!projectId) return
  try {
    localStorage.setItem(projectFallbackKey(projectId), JSON.stringify(state))
  } catch {
    // 同上：项目库为主存，回退失败不阻断
  }
}

async function readProjectState(): Promise<ProjectIconOverrideState | null> {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    const entry = await db.table('project_settings').get(ICON_PROJECT_SETTING_KEY)
    if (!entry) return null
    const parsed = JSON.parse((entry as { value: string }).value) as {
      followGlobal?: unknown
      overrides?: unknown
      updatedAt?: unknown
    }
    return {
      version: 1,
      followGlobal: parsed?.followGlobal !== false,
      overrides: sanitizeOverrides(parsed?.overrides),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

function writeProjectState(state: ProjectIconOverrideState): void {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    void db.table('project_settings')
      .put({ key: ICON_PROJECT_SETTING_KEY, value: JSON.stringify(state) })
      .catch(() => {})
  } catch {
    // 项目库不可用时由 localStorage 分键回退兜底
  }
}

export const useIconOverrideStore = defineStore('iconOverrides', () => {
  const global = ref<IconOverrideMapState>(readGlobalState())
  const project = ref<ProjectIconOverrideState>(defaultProjectState())
  const effective = computed(() => buildEffectiveMap(global.value, project.value))

  watch(effective, map => setEffectiveIconOverrides(map), { immediate: true })

  function persistProject(): void {
    const stamped = { ...project.value, updatedAt: Date.now() }
    project.value = stamped
    writeProjectState(stamped)
    writeProjectFallback(currentProjectId(), stamped)
  }

  function persistGlobal(): void {
    writeGlobalState(global.value)
  }

  /** 项目切换/首次启动后调用：项目库与分键回退取较新者，最终默认。 */
  async function loadProjectIconOverrides(): Promise<void> {
    const fallback = readProjectFallback(currentProjectId())
    const fromDb = await readProjectState()
    project.value = pickNewerProjectState(fromDb, fallback) ?? defaultProjectState()
  }

  /** 导出当前项目的覆盖状态（导入/导出分区共用）。 */
  function exportProjectState(): ProjectIconOverrideState {
    return {
      version: 1,
      followGlobal: project.value.followGlobal,
      overrides: { ...project.value.overrides },
      updatedAt: project.value.updatedAt,
    }
  }

  /** 导入后整体替换当前项目覆盖状态（先确保 loadProjectIconOverrides 已执行）。 */
  function replaceProjectState(next: { followGlobal?: unknown; overrides?: unknown } | null | undefined): void {
    project.value = {
      version: 1,
      followGlobal: next?.followGlobal !== false,
      overrides: sanitizeOverrides(next?.overrides),
      updatedAt: Date.now(),
    }
    persistProject()
  }

  function resolve(slotKey: string, fallback: string): string {
    return effective.value.get(slotKey) ?? fallback
  }

  function sourceOf(slotKey: string): IconOverrideSource {
    if (project.value.overrides[slotKey]) return 'project'
    if (project.value.followGlobal && global.value.overrides[slotKey]) return 'global'
    return 'default'
  }

  function hasGlobal(slotKey: string): boolean {
    return Boolean(global.value.overrides[slotKey])
  }

  function setProjectIcon(slotKey: string, icon: string): void {
    if (!icon) return
    project.value = {
      ...project.value,
      overrides: { ...project.value.overrides, [slotKey]: icon },
    }
    persistProject()
  }

  function setGlobalIcon(slotKey: string, icon: string): void {
    if (!icon) return
    global.value = {
      ...global.value,
      overrides: { ...global.value.overrides, [slotKey]: icon },
    }
    persistGlobal()
  }

  /** 「应用到全局」：全局 + 本项目各落一份，保证当前项目立即生效且切独立后仍保留。 */
  function applyToGlobal(slotKey: string, icon: string): void {
    setGlobalIcon(slotKey, icon)
    setProjectIcon(slotKey, icon)
  }

  function clearProjectIcon(slotKey: string): void {
    if (!(slotKey in project.value.overrides)) return
    const overrides = { ...project.value.overrides }
    delete overrides[slotKey]
    project.value = { ...project.value, overrides }
    persistProject()
  }

  function clearGlobalIcon(slotKey: string): void {
    if (!(slotKey in global.value.overrides)) return
    const overrides = { ...global.value.overrides }
    delete overrides[slotKey]
    global.value = { ...global.value, overrides }
    persistGlobal()
  }

  /** 关闭跟随时把当前生效的全局图标快照进本项目；返回快照条数。 */
  function setFollowGlobal(next: boolean): number {
    if (next) {
      project.value = { ...project.value, followGlobal: true }
      persistProject()
      return 0
    }
    const overrides = { ...project.value.overrides }
    let snapshotted = 0
    for (const [key, icon] of Object.entries(global.value.overrides)) {
      if (key in overrides) continue
      overrides[key] = icon
      snapshotted++
    }
    project.value = { ...project.value, followGlobal: false, overrides }
    persistProject()
    return snapshotted
  }

  /** 清除本项目全部覆盖；跟随开启时回落到全局，关闭时回落到默认。 */
  function resetProjectIcons(): void {
    project.value = { ...project.value, overrides: {} }
    persistProject()
  }

  /** 「回到芽默认」：清空本项目覆盖并停止跟随全局。 */
  function resetToDefaults(): void {
    project.value = { ...project.value, followGlobal: false, overrides: {} }
    persistProject()
  }

  function clearGlobalIcons(): void {
    global.value = { ...global.value, overrides: {} }
    persistGlobal()
  }

  return {
    global,
    project,
    effective,
    loadProjectIconOverrides,
    exportProjectState,
    replaceProjectState,
    resolve,
    sourceOf,
    hasGlobal,
    setProjectIcon,
    setGlobalIcon,
    applyToGlobal,
    clearProjectIcon,
    clearGlobalIcon,
    setFollowGlobal,
    resetProjectIcons,
    resetToDefaults,
    clearGlobalIcons,
  }
})
