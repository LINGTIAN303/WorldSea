/**
 * 芽开关 / 芽分组的持久化层（localStorage 回退 + 项目库副本）+ **芽 id 归一化小迁移**。
 *
 * 抽出于 settingsStore（2026-09-27 E6）：该文件受 400/538 行冻结基线约束，且这段逻辑与 store
 * 状态无关。本模块不持状态、不与 settingsStore 互相 import——默认清单按结构泛型传入。
 *
 * 归一化：改名/剪芽之后，历史持久化数据仍带旧 id（如 `official.workflow`）或已剪芽 id
 * （`official.module-builder`）。加载时按「别名表 → 清单外丢弃」归一，**有改动才写回**（一次性迁移）。
 */
import { getProjectManager } from '../core'

const STORAGE_KEY_PLUGINS = 'worldsea_plugin_toggles'
const STORAGE_KEY_SPROUT_GROUPS = 'worldsea_sprout_groups'

/** 旧芽 id → 现 id（改名类批次一次性归一；只增不改，条目长期留存）。 */
const SPROUT_ID_ALIASES: Record<string, string> = {
  // 2026-09-26 E5：「创作编排」由 official.workflow 改名
  'official.workflow': 'official.orchestration',
}

/** 持久化面最小形状（与 SproutToggle / SproutGroup 结构对齐）。 */
export interface PersistedSproutShape {
  id: string
  active: boolean
}
export interface PersistedGroupShape {
  id: string
  name: string
  sproutIds: string[]
}

/** 归一一条芽 id：别名映射 → 清单外丢弃（null，如已剪的 official.module-builder）。 */
function normalizeId(id: unknown, known: ReadonlySet<string>): string | null {
  if (typeof id !== 'string') return null
  const mapped = SPROUT_ID_ALIASES[id] ?? id
  return known.has(mapped) ? mapped : null
}

/** 默认清单 + 持久化开关 → 合并清单；changed = 持久化面含旧/未知 id（需写回一次）。 */
function mergeToggles<T extends PersistedSproutShape>(
  defaults: readonly T[],
  saved: unknown,
): { merged: T[]; changed: boolean } {
  const known = new Set(defaults.map(item => item.id))
  const byId = new Map<string, boolean>()
  let changed = false
  const entries = Array.isArray(saved) ? (saved as Array<{ id?: unknown; active?: unknown }>) : []
  for (const entry of entries) {
    const id = normalizeId(entry?.id, known)
    if (id) byId.set(id, entry.active === true)
    if (id !== entry?.id) changed = true
  }
  const merged = defaults.map(def => {
    const active = byId.get(def.id)
    return { ...def, active: active === undefined ? def.active : active }
  })
  return { merged, changed }
}

/** 分组集合归一（旧名映射 + 未知丢弃 + 去重）；changed = 有分组被改写。 */
function mergeGroups<T extends PersistedGroupShape>(
  groups: readonly T[],
  known: ReadonlySet<string>,
): { merged: T[]; changed: boolean } {
  let changed = false
  const merged = groups.map(group => {
    const ids: string[] = []
    let groupChanged = false
    for (const raw of group.sproutIds) {
      const id = normalizeId(raw, known)
      if (!id || ids.includes(id)) {
        groupChanged = true
        continue
      }
      if (id !== raw) groupChanged = true
      ids.push(id)
    }
    if (!groupChanged) return group
    changed = true
    return { ...group, sproutIds: ids }
  })
  return { merged, changed }
}

/** 形状过滤（非对象 / 字段类型不对的分组条目丢弃）。 */
function sanitizeGroups<T extends PersistedGroupShape>(value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (g): g is T => !!g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.sproutIds),
  )
}

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用（配额/隐私模式）→ 静默；调用方以内存态继续
  }
}

/** 项目库副本写入（项目系统未初始化时忽略——由 localStorage 兜底）。 */
function writeProject(key: string, value: unknown): void {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    db.table('project_settings').put({ key, value: JSON.stringify(value) })
  } catch {
    // 项目系统未初始化，仅存 localStorage
  }
}

async function readProject(key: string): Promise<unknown | null> {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    const entry = await db.table('project_settings').get(key)
    return entry ? JSON.parse((entry as { value: string }).value) : null
  } catch {
    return null
  }
}

/** 芽开关：localStorage 读取 + 归一（有改动即写回两处）。 */
export function loadStoredSproutToggles<T extends PersistedSproutShape>(defaults: readonly T[]): T[] {
  const saved = readStored(STORAGE_KEY_PLUGINS)
  if (!saved) return defaults.map(item => ({ ...item }))
  const { merged, changed } = mergeToggles(defaults, saved)
  if (changed) saveSproutToggles(merged)
  return merged
}

/** 芽开关写回（localStorage + 项目库副本；键名保持 plugin_toggles）。 */
export function saveSproutToggles(toggles: readonly PersistedSproutShape[]): void {
  const slim = toggles.map(item => ({ id: item.id, active: item.active }))
  writeStored(STORAGE_KEY_PLUGINS, slim)
  writeProject('plugin_toggles', slim)
}

/** 项目级芽开关（项目库为准；含归一写回；无记录 → null）。 */
export async function loadProjectSproutToggles<T extends PersistedSproutShape>(
  defaults: readonly T[],
): Promise<T[] | null> {
  const saved = await readProject('plugin_toggles')
  if (!saved) return null
  const { merged, changed } = mergeToggles(defaults, saved)
  if (changed) saveSproutToggles(merged)
  return merged
}

/** 芽分组：localStorage 读取 + 归一（有改动即写回两处）。 */
export function loadStoredSproutGroups<T extends PersistedGroupShape>(known: ReadonlySet<string>): T[] {
  const groups = sanitizeGroups<T>(readStored(STORAGE_KEY_SPROUT_GROUPS))
  const { merged, changed } = mergeGroups(groups, known)
  if (changed) saveSproutGroups(merged)
  return merged
}

/** 芽分组写回（localStorage + 项目库副本；键名保持 sprout_groups）。 */
export function saveSproutGroups(groups: readonly PersistedGroupShape[]): void {
  writeStored(STORAGE_KEY_SPROUT_GROUPS, groups)
  writeProject('sprout_groups', groups)
}

/** 项目级芽分组（项目库为准；含归一写回；无记录 → null）。 */
export async function loadProjectSproutGroups<T extends PersistedGroupShape>(
  known: ReadonlySet<string>,
): Promise<T[] | null> {
  const saved = await readProject('sprout_groups')
  if (!saved) return null
  const groups = sanitizeGroups<T>(saved)
  const { merged, changed } = mergeGroups(groups, known)
  if (changed) saveSproutGroups(merged)
  return merged
}
