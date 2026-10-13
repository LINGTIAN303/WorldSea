import type { Component } from 'vue'
import { DEFAULT_CONTENT_FORM } from './detailLayout'
import GroupedForm from './forms/GroupedForm.vue'
import TableForm from './forms/TableForm.vue'
import NarrativeForm from './forms/NarrativeForm.vue'
import SummaryForm from './forms/SummaryForm.vue'
import TimelineForm from './forms/TimelineForm.vue'

/**
 * L2 内容形态注册表：同一份字段数据在容器里**怎么编排**。范式沿用大纲白板 `FormDefinition`，两处有意差别：
 * ①形态件**在仓内注册**而非芽运行时注册——芽只改 `detailLayout.contentForm` 这个 id（否则「用户可选的形态」
 * 会变成「代码里长出来的形态」）；②只有 `configSchema` 无并行 `defaultConfig`，默认值由 schema `default` 派生（两份配置迟早漂移，fieldType 三套命名是前车之鉴）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */

/** derived＝只呈现（编辑时回落分组式）；inline＝可就地编辑 */
export type ContentFormKind = 'derived' | 'inline'

export interface ContentConfigField {
  key: string
  label: string
  type: 'boolean' | 'number' | 'select'
  options?: { value: string; label: string }[]
  default: unknown
}

export interface ContentFormDefinition {
  /** 形态 id，存进 `DetailLayout.contentForm` */
  form: string
  label: string
  /** WsIcon 的 name（项目禁用 emoji 图标） */
  icon: string
  kind: ContentFormKind
  /** 选择器 title 与设置 Tab 里的一句话说明 */
  description: string
  component: Component
  configSchema: ContentConfigField[]
}

const registry = new Map<string, ContentFormDefinition>()

/** 幂等注册：重复注册同 id 直接跳过（与大纲白板一致） */
export function registerContentForm(def: ContentFormDefinition): void {
  if (registry.has(def.form)) return
  registry.set(def.form, def)
}

export function getContentForm(form: string): ContentFormDefinition | undefined {
  return registry.get(form)
}

/** 注册顺序即选择器顺序 */
export function allContentForms(): ContentFormDefinition[] {
  return Array.from(registry.values())
}

/** 该形态的默认配置（由 configSchema 派生，不留第二份） */
export function defaultContentConfig(form: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of registry.get(form)?.configSchema ?? []) out[f.key] = f.default
  return out
}

/**
 * 有效配置：默认打底，存储里的**已定义值**覆盖。
 * 缺键时按 schema 兜底，多出来的未知键原样留着（属别的形态或旧数据，不在此消费）。
 */
export function resolveContentConfig(
  form: string,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const out = defaultContentConfig(form)
  if (config) {
    for (const [k, v] of Object.entries(config)) {
      if (v !== undefined) out[k] = v
    }
  }
  return out
}

/**
 * 本次实际渲染的形态：未注册的 id 也要有东西可渲染，派生型在编辑态回分组式。
 * 编辑走的是同一套行内单轨，派生型只做呈现，不承载写入。
 */
export function activeContentForm(form: string, editing: boolean): string {
  const def = registry.get(form)
  if (!def) return DEFAULT_CONTENT_FORM
  if (editing && def.kind === 'derived') return DEFAULT_CONTENT_FORM
  return def.form
}

const BUILT_IN_FORMS: ContentFormDefinition[] = [
  {
    form: 'grouped',
    label: '分组式',
    icon: 'list',
    kind: 'inline',
    description: '按芽声明的分组逐行编辑——唯一可就地改值的形态',
    component: GroupedForm,
    configSchema: [],
  },
  {
    form: 'table',
    label: '表格式',
    icon: 'table',
    kind: 'derived',
    description: '字段/值两列通读，适合字段多而短的设定资料',
    component: TableForm,
    configSchema: [],
  },
  {
    form: 'narrative',
    label: '段落式',
    icon: 'book',
    kind: 'derived',
    description: '长文本合并成篇，适合人物志、地点纪这类文档型实体',
    component: NarrativeForm,
    configSchema: [
      { key: 'includeDescription', label: '并入描述段', type: 'boolean', default: true },
    ],
  },
  {
    form: 'summary',
    label: '摘要式',
    icon: 'tag',
    kind: 'derived',
    description: '短字段压成属性标签，一屏看全关键设定',
    component: SummaryForm,
    configSchema: [
      { key: 'maxChips', label: '最多属性数', type: 'number', default: 14 },
      { key: 'showExcerpt', label: '显示正文摘录', type: 'boolean', default: true },
    ],
  },
  {
    form: 'timeline',
    label: '时间轴式',
    icon: 'timeline',
    kind: 'derived',
    description: '聚合日期字段成时间轴，适合有始有终的实体',
    component: TimelineForm,
    configSchema: [
      { key: 'includeCreatedAt', label: '含创建时间', type: 'boolean', default: false },
    ],
  },
]

for (const def of BUILT_IN_FORMS) registerContentForm(def)
