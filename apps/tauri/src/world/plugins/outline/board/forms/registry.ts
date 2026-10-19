/**
 * forms/registry —— 表现形式注册表（自研，不走「槽位/组件」的页面搭建模型）
 *
 * 【为什么自研】页面搭建语义（Slot/arrangement/zoneId）与「结构表达」的大纲白板不是同一件事，
 * 套用其模型只会带来语义污染（09-15 文档 §8.8.1-2 判定）。
 *
 * 【扩展点】新增一种表现形式 = 注册一个 FormDefinition，**不需要改编辑器代码**。
 * 规格见 docs/plans/2026-09-16-大纲白板-表现形式规格.md §0.4。
 */
import type { Component } from 'vue'

/** 派生型（只呈现，编辑须回实体侧） / 就地型（可直接编辑并写回节点字段） */
export type FormKind = 'derived' | 'inline'

export interface FormConfigField {
  key: string
  label: string
  /**
   * multi-select（2026-10-19）：值为 `string[]`，面板渲染为 checkbox 组。
   * `options` 的顺序即输出顺序（固定列序，不由勾选先后决定）。
   */
  type: 'text' | 'number' | 'select' | 'boolean' | 'multi-select'
  options?: Array<{ value: string; label: string }>
  /** multi-select 专用：至少保留几项（如表格列至少 1 列），未设则不限制 */
  minSelected?: number
  default: unknown
}

export interface FormDefinition {
  /** 表现形式标识（存进布局体 Component.form） */
  form: string
  label: string
  /** WsIcon 的 name（项目禁用 emoji 图标） */
  icon: string
  kind: FormKind
  /** 形式选择菜单里的一句话说明 */
  description?: string
  /** 容器未设尺寸时的内容自适应参考高度 */
  defaultHeight: number
  defaultConfig: Record<string, unknown>
  configSchema: FormConfigField[]
  component: Component
}

const registry = new Map<string, FormDefinition>()

/** 幂等注册：重复注册同 form 直接跳过 */
export function registerForm(def: FormDefinition): void {
  if (registry.has(def.form)) return
  registry.set(def.form, def)
}

export function unregisterForm(form: string): boolean {
  return registry.delete(form)
}

export function getForm(form: string): FormDefinition | undefined {
  return registry.get(form)
}

export function getAllForms(): FormDefinition[] {
  return Array.from(registry.values())
}

export function getFormsByKind(kind: FormKind): FormDefinition[] {
  return getAllForms().filter(d => d.kind === kind)
}

/** 仅测试用：清空注册表，避免跨用例污染 */
export function clearForms(): void {
  registry.clear()
}

/**
 * 配置值克隆：数组必须复制一份。
 * 默认配置里的 `columns` 等数组若被原样返回，多个容器会共享同一引用；
 * 配置面板一旦原地修改就会污染注册表的默认值。
 */
function cloneConfigValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value
}

/**
 * 取某组件在给定配置下的**有效配置**：以 defaultConfig 打底，用组件自身 config 覆盖，
 * 并对 configSchema 声明的键做存在性兜底（用户手改 DB 缺键时不至于渲染异常）。
 */
export function resolveFormConfig(
  form: string,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const def = getForm(form)
  const base: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(def?.defaultConfig ?? {})) {
    base[k] = cloneConfigValue(v)
  }
  if (config) {
    for (const [k, v] of Object.entries(config)) {
      if (v !== undefined) base[k] = cloneConfigValue(v)
    }
  }
  for (const field of def?.configSchema ?? []) {
    if (base[field.key] === undefined) base[field.key] = cloneConfigValue(field.default)
  }
  return base
}
