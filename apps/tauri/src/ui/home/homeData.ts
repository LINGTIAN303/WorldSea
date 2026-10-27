/**
 * 首页聚合纯函数（Task 6）：输入 store 快照，输出 HomeData。
 * 口径：域归属 = manifest.domain / secondaryDomains；域卡/最近/写作只看启用芽；
 * 矩阵摘要取当前注册 Schema（不受芽启用影响）；域计数按类型去重。
 */
import { SPROUT_DOMAINS } from '@worldsea/entity-core'
import type { Entity, PluginView, Relation, SproutToggle } from '@worldsea/entity-core'
import type { WorldPlugin } from '@/world/manifest'
import type { FieldMatrixModel, FieldMatrixStats } from '@/world/plugins/field-matrix/model/types'
import type { HomeProfile } from '@/stores/homeProfileStore'

export interface TypeMeta { label: string; icon: string; pluginId?: string }
export interface HomeDataInput {
  projectName: string
  profile: HomeProfile
  entities: readonly Entity[]
  relations: readonly Relation[]
  sprouts: readonly SproutToggle[]
  plugins: readonly WorldPlugin[]
  visibleViews: readonly PluginView[]
  pluginTypes: ReadonlyMap<string, string[]>
  typeMeta: ReadonlyMap<string, TypeMeta>
  matrix: FieldMatrixModel
  preferredViewId: string | null
}
export interface HomeContinueTarget { viewId: string; label: string; icon: string }
export interface HomeDomainSprout { id: string; label: string; icon: string; viewId: string }
export interface HomeDomainRecent { id: string; name: string; type: string; updatedAt: string; viewId: string }
export interface HomeDomain {
  id: string
  label: string
  icon: string
  question: string
  entityCount: number | null
  activeSprouts: HomeDomainSprout[]
  recentEntities: HomeDomainRecent[]
  firstViewId: string | null
}
export interface HomeRecentItem {
  id: string; type: string; name: string; description: string; updatedAt: string
  typeLabel: string; icon: string; viewId: string
}
export interface HomeFeaturedBook {
  id: string; name: string; description: string; coverImage: string
  chapterCount: number; wordCount: number; viewId: string
  latestChapter: { id: string; name: string; updatedAt: string } | null
}
export interface HomeActivity {
  /** 本地日 YYYY-MM-DD → 当日有创建/最后更新的实体/关系数（同一天同一内容只计一次） */
  daily: Record<string, number>
  /** 当日实体名（按最后更新倒序，最多 3 个） */
  dayNames: Record<string, string[]>
  /** 当日涉及的关系条数（与 daily 合并计数；用于 tooltip 说明） */
  dayRelationCounts: Record<string, number>
  total: number
  activeDays: number
  maxCount: number
}
export interface HomeMatrixRow {
  type: string; label: string; sproutLabel: string
  fieldCount: number; requiredCount: number; relationTypeCount: number
}
export interface HomeSnapshot {
  entityCount: number; relationCount: number
  activeSproutCount: number; totalSproutCount: number
  fieldCount: number; outlineCount: number; manuscriptCount: number
  lastUpdatedAt: string | null
}
export interface HomeData {
  projectName: string
  profile: HomeProfile
  tagline: string
  autoTagline: string
  snapshot: HomeSnapshot
  domains: HomeDomain[]
  recent: HomeRecentItem[]
  featuredBook: HomeFeaturedBook | null
  activity: HomeActivity
  matrixRows: HomeMatrixRow[]
  matrixStats: FieldMatrixStats
  matrixRelationTypeCount: number
  matrixViewId: string | null
  continueTarget: HomeContinueTarget | null
  outlineViewId: string | null
  manuscriptViewId: string | null
}

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt)
const firstView = (pluginId: string, views: readonly PluginView[]) => views.find(v => v.pluginId === pluginId)

/** 本地日键（热力图/日历按用户本地时区切日，不按 UTC） */
function localDayKey(iso: string): string | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 创作活跃度：只依赖实体/关系的 createdAt / updatedAt（没有编辑历史）。
 * 同一内容同一天创建+更新只计一次；实体与关系用前缀区分 id。
 */
function buildActivity(entities: readonly Entity[], relations: readonly Relation[]): HomeActivity {
  const dailySets = new Map<string, Set<string>>()
  const mark = (iso: string, key: string) => {
    const day = localDayKey(iso)
    if (!day) return
    const set = dailySets.get(day) ?? new Set<string>()
    set.add(key)
    dailySets.set(day, set)
  }
  for (const e of entities) {
    mark(e.createdAt, `e:${e.id}`)
    mark(e.updatedAt, `e:${e.id}`)
  }
  for (const r of relations) {
    mark(r.createdAt, `r:${r.id}`)
    mark(r.updatedAt, `r:${r.id}`)
  }
  const daily: Record<string, number> = {}
  for (const [day, set] of dailySets) daily[day] = set.size

  // 当日实体名（去重、按最后更新倒序，最多 3 个）与关系条数，供 tooltip 说明
  const dayEntityMap = new Map<string, Map<string, { name: string; updatedAt: string }>>()
  for (const e of entities) {
    for (const iso of [e.createdAt, e.updatedAt]) {
      const day = localDayKey(iso)
      if (!day) continue
      const map = dayEntityMap.get(day) ?? new Map<string, { name: string; updatedAt: string }>()
      map.set(e.id, { name: e.name, updatedAt: e.updatedAt })
      dayEntityMap.set(day, map)
    }
  }
  const dayNames: Record<string, string[]> = {}
  for (const [day, map] of dayEntityMap) {
    const names = [...map.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(x => x.name)
      .filter((name, index, list) => list.indexOf(name) === index)
      .slice(0, 3)
    dayNames[day] = names
  }
  const dayRelationSets = new Map<string, Set<string>>()
  for (const r of relations) {
    for (const iso of [r.createdAt, r.updatedAt]) {
      const day = localDayKey(iso)
      if (!day) continue
      const set = dayRelationSets.get(day) ?? new Set<string>()
      set.add(r.id)
      dayRelationSets.set(day, set)
    }
  }
  const dayRelationCounts: Record<string, number> = {}
  for (const [day, set] of dayRelationSets) dayRelationCounts[day] = set.size

  const counts = Object.values(daily)
  return {
    daily,
    dayNames,
    dayRelationCounts,
    total: counts.reduce((sum, n) => sum + n, 0),
    activeDays: counts.length,
    maxCount: counts.length ? Math.max(...counts) : 0,
  }
}

function toContinueTarget(view: PluginView | undefined): HomeContinueTarget | null {
  return view ? { viewId: view.id, label: view.label, icon: view.icon } : null
}

/** 续写目标：优先用户上次的视图，失效则回落首个可见视图 */
export function resolveContinueTarget(views: readonly PluginView[], preferredId: string | null): HomeContinueTarget | null {
  const preferred = preferredId ? views.find(v => v.id === preferredId) : undefined
  return toContinueTarget(preferred ?? views[0])
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 本地日期 MM-DD */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const diff = Math.max(0, now - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  const d = new Date(then)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildHomeData(input: HomeDataInput): HomeData {
  const { entities, relations, sprouts, visibleViews, pluginTypes, typeMeta, matrix } = input
  const pluginById = new Map(input.plugins.map(p => [p.manifest.id, p.manifest]))
  const activeSprouts = sprouts.filter(s => s.active)
  const typeCounts = new Map<string, number>()
  for (const e of entities) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1)
  // 类型 → 可见视图：经 typeMeta.pluginId 找到该芽的首个可见视图
  const typeToView = (type: string): PluginView | undefined => {
    const pluginId = typeMeta.get(type)?.pluginId
    return pluginId ? firstView(pluginId, visibleViews) : undefined
  }

  const domains: HomeDomain[] = SPROUT_DOMAINS.map(domain => {
    // 归域：主域命中或副域包含；只认启用芽
    const domainSprouts = activeSprouts
      .map(sprout => ({ sprout, manifest: pluginById.get(sprout.id) }))
      .filter(({ manifest }) => manifest && (manifest.domain === domain.id || manifest.secondaryDomains?.includes(domain.id)))
    const typeSet = new Set<string>()
    const active: HomeDomainSprout[] = []
    for (const { sprout } of domainSprouts) {
      for (const type of pluginTypes.get(sprout.id) ?? []) typeSet.add(type)
      const v = firstView(sprout.id, visibleViews)
      if (v) active.push({ id: sprout.id, label: sprout.label, icon: v.icon, viewId: v.id })
    }
    // 无启用芽的域为 null（区分「未启用」与「空」）
    const entityCount = domainSprouts.length === 0
      ? null
      : [...typeSet].reduce((sum, type) => sum + (typeCounts.get(type) ?? 0), 0)
    // 先按「有可见视图」过滤再取前 2：不可跳转的类型若先占位，会挤掉后面可跳转的条目
    const recentEntities: HomeDomainRecent[] = entities
      .filter(e => typeSet.has(e.type))
      .map(entity => ({ entity, view: typeToView(entity.type) }))
      .filter((x): x is { entity: Entity; view: PluginView } => Boolean(x.view))
      .sort((a, b) => byUpdatedDesc(a.entity, b.entity))
      .slice(0, 2)
      .map(({ entity, view }) => ({
        id: entity.id, name: entity.name, type: entity.type, updatedAt: entity.updatedAt, viewId: view.id,
      }))
    const firstViewId = domainSprouts
      .map(({ sprout }) => firstView(sprout.id, visibleViews)?.id)
      .find((id): id is string => Boolean(id)) ?? null
    return {
      id: domain.id,
      label: domain.label,
      icon: domain.icon,
      question: domain.question,
      entityCount,
      activeSprouts: active,
      recentEntities,
      firstViewId,
    }
  })

  // 最近动态：只列可见类型（能跳到视图的），按 updatedAt 倒序取 10 条
  const recent: HomeRecentItem[] = entities
    .map(e => {
      const v = typeToView(e.type)
      if (!v) return null
      const meta = typeMeta.get(e.type)
      return {
        id: e.id,
        type: e.type,
        name: e.name,
        description: e.description ?? '',
        updatedAt: e.updatedAt,
        typeLabel: meta?.label ?? e.type,
        icon: meta?.icon ?? 'entity',
        viewId: v.id,
      }
    })
    .filter((x): x is HomeRecentItem => x !== null)
    .sort(byUpdatedDesc)
    .slice(0, 10)

  // 近期写作：取最近更新的书，汇总其章节数与字数；无书则退化为单篇正文
  const manuscriptView = firstView('official.manuscript', visibleViews)
  const manuscriptActive = activeSprouts.some(s => s.id === 'official.manuscript')
  let featuredBook: HomeFeaturedBook | null = null
  if (manuscriptActive && manuscriptView) {
    const book = entities.filter(e => e.type === 'book').slice().sort(byUpdatedDesc)[0]
    if (book) {
      const chapters = entities.filter(e => e.type === 'manuscript' && e.properties.bookId === book.id)
      const latest = chapters.slice().sort(byUpdatedDesc)[0]
      featuredBook = {
        id: book.id, name: book.name, description: book.description,
        coverImage: book.coverImage ?? '', chapterCount: chapters.length,
        wordCount: chapters.reduce((sum, e) => sum + (Number(e.properties.wordCount) || 0), 0),
        viewId: manuscriptView.id,
        latestChapter: latest ? { id: latest.id, name: latest.name, updatedAt: latest.updatedAt } : null,
      }
    } else {
      const m = entities.filter(e => e.type === 'manuscript').slice().sort(byUpdatedDesc)[0]
      if (m) {
        featuredBook = {
          id: m.id, name: m.name, description: m.description, coverImage: m.coverImage ?? '',
          chapterCount: 1, wordCount: Number(m.properties.wordCount) || 0, viewId: manuscriptView.id,
          latestChapter: { id: m.id, name: m.name, updatedAt: m.updatedAt },
        }
      }
    }
  }

  // 矩阵摘要：取当前注册 Schema（不受芽启用影响），字段数降序取前 8
  const matrixRows: HomeMatrixRow[] = matrix.entities
    .map(e => ({
      type: e.type,
      label: e.label,
      sproutLabel: sprouts.find(s => s.id === e.pluginId)?.label ?? pluginById.get(e.pluginId)?.name ?? e.pluginId,
      fieldCount: e.fields.length,
      requiredCount: e.fields.filter(f => f.required).length,
      relationTypeCount: matrix.relations.filter(r => r.sourceTypes.includes(e.type) || r.targetTypes.includes(e.type)).length,
    }))
    .sort((a, b) => b.fieldCount - a.fieldCount || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 8)

  const lastUpdatedAt = entities.reduce<string | null>(
    (max, e) => (!max || e.updatedAt > max ? e.updatedAt : max), null,
  )
  const snapshot: HomeSnapshot = {
    entityCount: entities.length,
    relationCount: relations.length,
    activeSproutCount: activeSprouts.length,
    totalSproutCount: sprouts.length,
    fieldCount: matrix.stats.instances,
    outlineCount: typeCounts.get('outline_node') ?? 0,
    manuscriptCount: typeCounts.get('manuscript') ?? 0,
    lastUpdatedAt,
  }
  // 空项目给引导文案；否则用统计自动生成，用户手填的 tagline 优先
  const autoTagline = snapshot.entityCount === 0
    ? '尚未填写简介'
    : `${snapshot.entityCount} 个实体 · ${snapshot.relationCount} 条关系 · ${snapshot.activeSproutCount} 个芽在运行`
  const tagline = input.profile.tagline.trim() || autoTagline
  const outlineViewId = firstView('official.outline', visibleViews)?.id ?? null

  return {
    projectName: input.projectName,
    profile: input.profile,
    tagline,
    autoTagline,
    snapshot,
    domains,
    recent,
    featuredBook,
    activity: buildActivity(entities, relations),
    matrixRows,
    matrixStats: matrix.stats,
    matrixRelationTypeCount: matrix.relations.length,
    matrixViewId: visibleViews.find(v => v.id === 'field-matrix')?.id ?? null,
    continueTarget: resolveContinueTarget(visibleViews, input.preferredViewId),
    outlineViewId,
    manuscriptViewId: manuscriptView?.id ?? null,
  }
}
