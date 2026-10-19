/**
 * 芽语义域（R1/R2，2026-10-20）。
 *
 * 8 域是开放集合：新增域在本表登记 id / label / question，再在芽 manifest 声明 domain。
 * 本表是**域层**单一真源；芽归域在各自 manifest，不在此表重复。
 */
export interface SproutDomain {
  id: string
  label: string
  /** 域的核心问题（设置/侧栏解释文案用） */
  question: string
}

export const SPROUT_DOMAINS = [
  { id: 'geo', label: '地理与场所', question: '世界在哪里、由哪些地点构成' },
  { id: 'life', label: '生命与族群', question: '谁生活在这个世界、有哪些生命形态' },
  { id: 'society', label: '社会与文明', question: '他们如何组织、交流、冲突' },
  { id: 'knowledge', label: '知识与规则', question: '世界运行依赖哪些设定、规则与力量体系' },
  { id: 'goods', label: '物产与造物', question: '世界里有哪些物品、装备与造物' },
  { id: 'time', label: '时间与事件', question: '世界发生了什么、按什么顺序发生' },
  { id: 'narrative', label: '叙事与文本', question: '如何把世界组织成可写的文本' },
  { id: 'tool', label: '推演与工具', question: '用什么工具观察、推演、编排' },
] as const satisfies readonly SproutDomain[]

export type SproutDomainId = (typeof SPROUT_DOMAINS)[number]['id']

const DOMAIN_BY_ID = new Map<string, SproutDomain>(SPROUT_DOMAINS.map(domain => [domain.id, domain]))

export function isSproutDomain(id: string): boolean {
  return DOMAIN_BY_ID.has(id)
}

export function getSproutDomain(id: string): SproutDomain | undefined {
  return DOMAIN_BY_ID.get(id)
}
