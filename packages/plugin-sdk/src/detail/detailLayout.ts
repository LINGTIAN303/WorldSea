/**
 * 详情布局层（纯函数）：三级合并 + 归一。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 *
 * 合并规则取**整表替换**（某一级没给 = 继承上一级），不做字段级深合并：
 * 用户覆写的是「这一类实体的详情长什么样」，而不是「在芽默认的第 3 位插一个字段」——
 * 深合并会让三层来源交织后无法解释，也让设置面板无法如实回显。
 */

export interface DetailGroup {
  key: string
  label: string
  fieldKeys: string[]
}

export interface DetailLayout {
  groups: DetailGroup[]
  /** 字段的展示顺序（同时也是分组成员的组内顺序基准） */
  order: string[]
  /** 隐藏的字段 key */
  hidden: string[]
  /** L2 内容形态 id（批次 1b 起有实效） */
  contentForm: string
  /** L2 形态的配置：只按当前形态的 configSchema 取用，缺键由注册表兜默认值 */
  contentConfig: Record<string, unknown>
}

/** 布局层的局部声明——三级来源都只给得出这几项 */
export type LayoutSource = Partial<Omit<DetailLayout, 'groups'>> & { groups?: DetailGroup[] }

export const DEFAULT_CONTENT_FORM = 'grouped'

/** 未分组字段的归处（芽只声明分组时，漏在组外的字段不会被吞） */
export const OTHER_GROUP: DetailGroup = { key: '__other', label: '其它', fieldKeys: [] }

/** 按 order 重排并补齐：只保留可用字段，缺失的按可用顺序追加在后 */
export function normalizeOrder(requested: string[] | undefined, available: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const key of requested ?? []) {
    if (!available.includes(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  for (const key of available) {
    if (!seen.has(key)) out.push(key)
  }
  return out
}

/** 分组成员归一：剔未知 key、去重、按 order 排；未入组的字段补进「其它」 */
export function normalizeGroups(groups: DetailGroup[] | undefined, order: string[]): DetailGroup[] {
  const assigned = new Set<string>()
  const out: DetailGroup[] = []
  for (const g of groups ?? []) {
    const keys: string[] = []
    for (const key of order) {
      if (!g.fieldKeys.includes(key) || assigned.has(key)) continue
      assigned.add(key)
      keys.push(key)
    }
    if (!g.key || !keys.length) continue
    out.push({ key: g.key, label: g.label || g.key, fieldKeys: keys })
  }
  const rest = order.filter(k => !assigned.has(k))
  if (rest.length) out.push({ ...OTHER_GROUP, fieldKeys: rest })
  return out
}

/**
 * 三级合并：芽默认 ⊕ 用户按类型覆写 ⊕ 抽屉即时态（后者优先）。
 * `available` 是当前实体类型可用的字段全集，用于把已失效的 key 与新增的字段都归位。
 */
export function resolveLayout(
  available: string[],
  sproutDefault?: LayoutSource,
  userOverride?: LayoutSource,
  liveState?: LayoutSource,
): DetailLayout {
  const order = normalizeOrder(
    liveState?.order ?? userOverride?.order ?? sproutDefault?.order,
    available,
  )
  const hiddenSrc = liveState?.hidden ?? userOverride?.hidden ?? sproutDefault?.hidden ?? []
  const visible = order.filter(k => !hiddenSrc.includes(k))
  const groupsSrc = liveState?.groups ?? userOverride?.groups ?? sproutDefault?.groups
  return {
    groups: normalizeGroups(groupsSrc, visible),
    order,
    hidden: hiddenSrc.filter(k => available.includes(k)),
    contentForm: liveState?.contentForm ?? userOverride?.contentForm
      ?? sproutDefault?.contentForm ?? DEFAULT_CONTENT_FORM,
    contentConfig: liveState?.contentConfig ?? userOverride?.contentConfig
      ?? sproutDefault?.contentConfig ?? {},
  }
}
