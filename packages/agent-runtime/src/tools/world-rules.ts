/**
 * WORLD.md 节奏型注入——纯逻辑层（H5 八文件体系，2026-08-30 拍板）
 *
 * 机制（用户拍板定稿）：实体写操作全局计数（非按类隔离——评估结论：严格同类在混合
 * 操作场景存在永不触发盲区），默认满 20 次触发（用户可配置 1-150），触发时把
 * WORLD.md 中与「窗口内操作过的实体类型」相关的分节合并注入（无匹配节兜底全文）。
 *
 * 本文件只含纯逻辑（分节提取 + 计数器），Tauri/文件读取/工具结果包装在
 * apps/tauri 的 worldRulesInjector.ts 胶水层。
 */

/** 触发阈值默认值与范围（用户拍板：默认 20，可配置 1-150） */
export const WORLD_RULES_TRIGGER_DEFAULT = 20
export const WORLD_RULES_TRIGGER_MIN = 1
export const WORLD_RULES_TRIGGER_MAX = 150

/** 阈值收敛（非法输入回落默认值；越界夹取到 [1,150]） */
export function clampTriggerThreshold(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return WORLD_RULES_TRIGGER_DEFAULT
  return Math.min(WORLD_RULES_TRIGGER_MAX, Math.max(WORLD_RULES_TRIGGER_MIN, n))
}

/** 标题/类型归一（小写去空白；匹配键过滤单字符，防双向 includes 单字误配） */
function normalizeHeading(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * 从 WORLD.md 内容中提取与实体类型相关的分节。
 *
 * - 按 `## 标题` 切节（一级/三级标题不参与切分，内容随所属二级节走）
 * - 标题匹配：typeKey 或显示名 label（归一化后 equals 或互相 includes，
 *   匹配键长度 ≥2 防误配；如 typeKey='character' 匹配 '## 角色' 的 label='角色'）
 * - 无任何匹配节 → 返回全文（兜底：WORLD.md 未按类型分节时注意力仍集中在文件上）
 * - content 为空 → null（调用方跳过注入）
 */
export function extractWorldRuleSections(
  content: string,
  typeKeys: string[],
  labels: string[] = [],
): string | null {
  const trimmed = content.trim()
  if (!trimmed) return null
  const keys = [...typeKeys, ...labels]
    .map(normalizeHeading)
    .filter((k) => k.length >= 2)
  if (keys.length === 0) return trimmed

  const lines = trimmed.split(/\r?\n/)
  const sections: Array<{ heading: string; body: string[] }> = []
  let current: { heading: string; body: string[] } | null = null
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line)
    if (m) {
      current = { heading: m[1].trim(), body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }

  const matched = sections.filter((s) => {
    const h = normalizeHeading(s.heading)
    return keys.some((k) => h === k || h.includes(k) || k.includes(h))
  })
  if (matched.length === 0) return trimmed
  const joined = matched
    .map((s) => `## ${s.heading}\n${s.body.join('\n').trim()}`)
    .join('\n\n')
    .trim()
  return joined || trimmed
}

/**
 * 全局计数器 + 窗口类型收集（用户拍板：全局计数，满阈值触发，窗口内类型合并注入）。
 * 每会话一个实例（会话隔离，见 worldRulesInjector.ts）。
 */
export class WorldRulesTrigger {
  private count = 0
  private readonly windowTypes = new Set<string>()
  private threshold: number

  constructor(threshold: number = WORLD_RULES_TRIGGER_DEFAULT) {
    this.threshold = clampTriggerThreshold(threshold)
  }

  /** 用户可配置阈值实时生效（每次 bump 前由胶水层同步） */
  setThreshold(n: number): void {
    this.threshold = clampTriggerThreshold(n)
  }

  get currentCount(): number {
    return this.count
  }

  /**
   * 记录一次实体写操作（成功）。
   * @returns 触发时返回窗口内操作过的类型集合（并归零计数与窗口）；未触发返回 null
   */
  bump(entityType: string): string[] | null {
    this.count += 1
    if (entityType) this.windowTypes.add(entityType)
    if (this.count >= this.threshold) {
      this.count = 0
      const types = [...this.windowTypes]
      this.windowTypes.clear()
      return types
    }
    return null
  }
}
