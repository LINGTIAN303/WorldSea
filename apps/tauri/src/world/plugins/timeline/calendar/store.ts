/**
 * 历法持久化：项目库 project_settings（主存）+ localStorage（回退）。
 * 键按历法 id 分条，避免单条 JSON 过大；与思维导图文档同模式。
 */
import { getProjectManager } from '@worldsea/entity-core/core'
import { createSimpleCalendar, SIMPLE_CALENDAR_ID } from './defaults'
import type { Calendar } from './types'

export interface CalendarMeta {
  id: string
  name: string
  updatedAt: number
}

const LS_INDEX = 'worldsea_timeline_calendar_index'
const LS_CALENDAR_PREFIX = 'worldsea_timeline_calendar_'
const LS_ACTIVE = 'worldsea_timeline_active_calendar'
const LS_MIGRATED = 'worldsea_timeline_migrated_v1'

const DB_INDEX = 'timeline_calendar_index'
const DB_CALENDAR_PREFIX = 'timeline_calendar_'
const DB_ACTIVE = 'timeline_active_calendar'
const DB_MIGRATED = 'timeline_migrated_v1'

function getDb(): any {
  try {
    return getProjectManager().getCurrentProjectDb()
  } catch {
    return null
  }
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 配额/隐私模式：DB 为主存 */
  }
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = getDb()
  if (!db) return null
  try {
    const row = await db.table('project_settings').get(key)
    return row ? (JSON.parse(row.value) as T) : null
  } catch {
    return null
  }
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.table('project_settings').put({ key, value: JSON.stringify(value) })
  } catch {
    /* localStorage 已兜底 */
  }
}

function sanitizeMeta(value: unknown): CalendarMeta[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CalendarMeta =>
    !!item && typeof item.id === 'string' && typeof item.name === 'string',
  ).map(item => ({ id: item.id, name: item.name, updatedAt: Number(item.updatedAt) || 0 }))
}

function isCalendar(value: unknown): value is Calendar {
  return !!value && typeof value === 'object'
    && typeof (value as Calendar).id === 'string'
    && typeof (value as Calendar).name === 'string'
    && Array.isArray((value as Calendar).units)
}

export async function loadCalendarIndex(): Promise<CalendarMeta[]> {
  const fromDb = await dbGet<CalendarMeta[]>(DB_INDEX)
  if (fromDb) return sanitizeMeta(fromDb)
  return sanitizeMeta(lsGet<CalendarMeta[]>(LS_INDEX, []))
}

export async function saveCalendarIndex(index: CalendarMeta[]): Promise<void> {
  const slim = sanitizeMeta(index)
  lsSet(LS_INDEX, slim)
  await dbSet(DB_INDEX, slim)
}

export async function loadCalendar(id: string): Promise<Calendar | null> {
  const fromDb = await dbGet<Calendar>(DB_CALENDAR_PREFIX + id)
  if (isCalendar(fromDb)) return fromDb
  const local = lsGet<Calendar | null>(LS_CALENDAR_PREFIX + id, null)
  return isCalendar(local) ? local : null
}

export async function saveCalendar(calendar: Calendar): Promise<void> {
  const clean: Calendar = { ...calendar, updatedAt: Date.now() }
  lsSet(LS_CALENDAR_PREFIX + clean.id, clean)
  await dbSet(DB_CALENDAR_PREFIX + clean.id, clean)
  const index = await loadCalendarIndex()
  const next = index.filter(item => item.id !== clean.id)
  next.push({ id: clean.id, name: clean.name, updatedAt: clean.updatedAt ?? Date.now() })
  await saveCalendarIndex(next)
}

export async function removeCalendar(id: string): Promise<void> {
  if (id === SIMPLE_CALENDAR_ID) return
  lsSet(LS_CALENDAR_PREFIX + id, null)
  await dbSet(DB_CALENDAR_PREFIX + id, null)
  const index = await loadCalendarIndex()
  await saveCalendarIndex(index.filter(item => item.id !== id))
  const active = await loadActiveCalendarId()
  if (active === id) await saveActiveCalendarId(SIMPLE_CALENDAR_ID)
}

export async function loadCalendars(): Promise<Calendar[]> {
  const index = await loadCalendarIndex()
  const result: Calendar[] = []
  for (const meta of index) {
    const calendar = await loadCalendar(meta.id)
    if (calendar) result.push(calendar)
  }
  return result
}

export async function loadActiveCalendarId(): Promise<string | null> {
  const fromDb = await dbGet<string>(DB_ACTIVE)
  if (typeof fromDb === 'string') return fromDb
  const local = lsGet<string | null>(LS_ACTIVE, null)
  return typeof local === 'string' ? local : null
}

export async function saveActiveCalendarId(id: string): Promise<void> {
  lsSet(LS_ACTIVE, id)
  await dbSet(DB_ACTIVE, id)
}

/** 保证至少有一套简式历法；返回历法列表与激活 id */
export async function ensureTimelineCalendars(): Promise<{ calendars: Calendar[]; activeId: string }> {
  let calendars = await loadCalendars()
  if (calendars.length === 0) {
    const simple = createSimpleCalendar()
    await saveCalendar(simple)
    calendars = [simple]
  }
  const savedActive = await loadActiveCalendarId()
  const activeId = savedActive && calendars.some(item => item.id === savedActive)
    ? savedActive
    : calendars[0].id
  if (activeId !== savedActive) await saveActiveCalendarId(activeId)
  return { calendars, activeId }
}

export async function isLegacyMigrated(): Promise<boolean> {
  const fromDb = await dbGet<boolean>(DB_MIGRATED)
  if (fromDb === true) return true
  return lsGet<boolean>(LS_MIGRATED, false) === true
}

export async function markLegacyMigrated(): Promise<void> {
  lsSet(LS_MIGRATED, true)
  await dbSet(DB_MIGRATED, true)
}

/** 项目导出快照（ProjectFS 文件链与打包链共用）：历法全量 + 激活 id + 迁移标记。 */
export interface TimelineSettingsBundle {
  version: 1
  calendars: Calendar[]
  activeId: string | null
  migrated: boolean
}

export async function exportTimelineSettings(): Promise<TimelineSettingsBundle> {
  return {
    version: 1,
    calendars: await loadCalendars(),
    activeId: await loadActiveCalendarId(),
    migrated: await isLegacyMigrated(),
  }
}

/** 导入快照：merge 只补缺失历法，overwrite 覆盖同 id；返回写入套数。 */
export async function importTimelineSettings(
  raw: unknown,
  mode: 'merge' | 'overwrite' = 'merge',
): Promise<number> {
  const bundle = (raw && typeof raw === 'object' ? raw : {}) as Partial<TimelineSettingsBundle>
  const incoming = Array.isArray(bundle.calendars) ? bundle.calendars.filter(isCalendar) : []
  const existing = new Set((await loadCalendars()).map(calendar => calendar.id))
  let written = 0
  for (const calendar of incoming) {
    if (mode === 'merge' && existing.has(calendar.id)) continue
    await saveCalendar(calendar)
    written++
  }
  if (typeof bundle.activeId === 'string' && incoming.some(calendar => calendar.id === bundle.activeId)) {
    await saveActiveCalendarId(bundle.activeId)
  }
  if (bundle.migrated === true) await markLegacyMigrated()
  return written
}
