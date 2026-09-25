/**
 * forms/storylineRows —— 线索式表现形式的「行构建」纯函数
 *
 * 迁移自原独立大纲视图的「情节线索」页签（`composables/useOutlineStorylines.ts:5-15`
 * + `OutlineView.vue:91-104`）：按节点 `properties.storylines`（逗号分隔）聚合出线索行。
 * 抽成纯函数以便单测——组件只渲染，不算数。
 *
 * 与原实现的两处**有意改进**（均为输入容错，不改语义）：
 * ① 分隔符同时接受中文逗号（中文输入法下的默认逗号，原实现只认 `,` → 整串会被当成一个线索名）
 * ② 线索名排序改用 `localeCompare('zh-Hans-CN')` = **拼音序**（原实现是默认 `sort()`，按码点排，
 *    中文会得到「丙 < 乙 < 甲」这类反直觉结果）
 */
import type { NodeLike } from '../outlineDerive'
import { nodeWordCount } from './scopeNodes'

/** 线索聚合只依赖 id / name / properties，故放宽入参类型便于测试 */
export interface StorylineSourceNode extends NodeLike {
  name?: string
}

export interface StorylineRow {
  /** 线索名 */
  line: string
  /** 命中节点数 */
  count: number
  /** 命中节点字数合计 */
  wordCount: number
  nodeIds: string[]
  /** 节点显示名（空名回退「未命名节点」） */
  names: string[]
}

/** 解析「所属线索」字段：逗号（中英文）分隔 → 去空白 → 去重，保持出现顺序 */
export function parseStorylines(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,，]/)) {
    const t = part.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 范围内出现过的全部线索名（**拼音序**，稳定可预期；见测试里的排序断言） */
export function collectStorylines(nodes: StorylineSourceNode[]): string[] {
  const set = new Set<string>()
  for (const n of nodes) {
    for (const s of parseStorylines(n.properties?.storylines)) set.add(s)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 线索行：每条线索的命中节点（保持传入顺序，即语义顺序）、节点数与字数 */
export function buildStorylineRows(nodes: StorylineSourceNode[]): StorylineRow[] {
  return collectStorylines(nodes).map(line => {
    const hit = nodes.filter(n => parseStorylines(n.properties?.storylines).includes(line))
    return {
      line,
      count: hit.length,
      wordCount: hit.reduce((s, n) => s + nodeWordCount(n), 0),
      nodeIds: hit.map(n => n.id),
      names: hit.map(n => (n.name ?? '').trim() || '未命名节点'),
    }
  })
}

/** 行高估算（容器内容自适应高度的粗略参考） */
export const STORYLINE_ROW_HEIGHT = 26

export function estimateStorylineHeight(rowCount: number, maxRows = 8): number {
  return Math.min(Math.max(rowCount, 1), maxRows) * STORYLINE_ROW_HEIGHT + 8
}
