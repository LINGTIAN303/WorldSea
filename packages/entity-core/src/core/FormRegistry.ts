/**
 * 表现形式注册表（**平台级第 6 贡献位**，2026-11-13 从 `outline` 私有实现提升）。
 *
 * 「表现形式」= 画布上一个节点用什么样的可视化呈现（标题式 / 卡片式 / 表格式 / 树式…）。
 * 每个形式有自己的 configSchema（可配置项）与 component（渲染组件）。
 *
 * 为什么提升为平台贡献位：`outline` 早在 2026-09 就实现了这一套（`board/forms/registry.ts`），
 * 注释原文写着「新增一种表现形式 = 注册一个 FormDefinition，**不需要改编辑器代码**」——
 * 形态完全正确，但它是私有的：不随插件启停、外界看不见、其他插件无法复用。
 * 提升后与 view / overlay / entityType / relationType / facet / capability 并列，
 * 成为第六个「插件向平台注册一个可撤销的东西」的贡献位。
 *
 * 设计口径与 view/overlay 一致：
 * - **真源 + 订阅**：`getForms()` 给真源数组，`onFormChange()` 供显示侧镜像；
 * - **幂等**：同 id 重复注册跳过（先到者生效），不抛错——插件重载是常态；
 * - **可卸载回卷**：插件的 form 随插件卸载撤登记（走 `unregisterFormsByPlugin`）。
 */

import type { Component } from 'vue'

/** 表现形式类型：派生型（只呈现，编辑须回实体侧）/ 就地型（可直接编辑并写回节点字段）。 */
export type FormKind = 'derived' | 'inline'

/** 表现形式的一项可配置字段（渲染成配置面板里的一个控件）。 */
export interface FormConfigField {
  key: string
  label: string
  /**
   * `multi-select`（2026-10-19）：值为 `string[]`，渲染为 checkbox 组。
   * `options` 顺序即输出顺序（固定列序，不由勾选先后决定）。
   */
  type: 'text' | 'number' | 'select' | 'boolean' | 'multi-select'
  options?: Array<{ value: string; label: string }>
  /** `multi-select` 专用：至少保留几项（如表格列至少 1 列），未设则不限制。 */
  minSelected?: number
  default: unknown
}

/** 一个表现形式的完整定义。 */
export interface FormDefinition {
  /** 表现形式标识（存进布局体 `Component.form`） */
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
  /** 登记它的插件 id（由 `PluginAPI` 在注册时回填，用于按插件卸载回卷）。 */
  pluginId?: string
}

/** 表现形式生命周期变更（真源派发；显示侧据此镜像）。 */
export interface FormChange {
  kind: 'registered' | 'unregistered'
  form: FormDefinition
}

export type FormChangeListener = (change: FormChange) => void

/**
 * 表现形式注册表。
 *
 * 用**类**而非模块级 Map：便于测试隔离（每个用例新建实例），且与
 * `entity-core` 的其他 registry（`RelationshipRegistry` 等）风格一致。
 */
class FormRegistry {
  private readonly forms = new Map<string, FormDefinition>()
  private readonly listeners = new Set<FormChangeListener>()

  /**
   * 幂等注册：同 `form` 已存在则跳过（先到者生效）。
   *
   * **例外：认领** —— 已存在的那条若尚未归属任何插件（`pluginId` 空），而本次带
   * `pluginId` 来注册，则把归属补上（不重复派发事件）。这是「先由内部注册表建好、
   * 再由插件正式认领」这一路径所必需的：`outline` 的 `initializeForms()` 先把 11 种
   * 形式写进注册表（供组件读取），随后 `apply` 经 `api.registerForm` 认领它们，
   * 使卸载时能按插件精确回卷。若不认领，幂等规则会让这些形式永远无主、卸载撤不掉。
   */
  register(def: FormDefinition): void {
    const existing = this.forms.get(def.form)
    if (existing) {
      if (existing.pluginId === undefined && def.pluginId !== undefined) {
        existing.pluginId = def.pluginId
      }
      return
    }
    this.forms.set(def.form, def)
    this.notify({ kind: 'registered', form: def })
  }

  unregister(form: string): boolean {
    const found = this.forms.get(form)
    if (!found) return false
    this.forms.delete(form)
    this.notify({ kind: 'unregistered', form: found })
    return true
  }

  /**
   * 撤掉某插件登记的全部表现形式（插件卸载时调用）。
   * @returns 实际撤掉的条数
   */
  unregisterByPlugin(pluginId: string): number {
    const doomed = [...this.forms.values()].filter(def => def.pluginId === pluginId)
    for (const def of doomed) this.unregister(def.form)
    return doomed.length
  }

  get(form: string): FormDefinition | undefined {
    return this.forms.get(form)
  }

  /** 真源数组（调用方不得改动返回数组的内容；需要副本自行展开）。 */
  getAll(): FormDefinition[] {
    return [...this.forms.values()]
  }

  getByKind(kind: FormKind): FormDefinition[] {
    return this.getAll().filter(def => def.kind === kind)
  }

  /** 订阅表现形式生命周期，返回退订函数。 */
  onChange(listener: FormChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 清空（测试隔离用；逐条派发反注册事件）。 */
  clear(): void {
    const doomed = [...this.forms.values()]
    this.forms.clear()
    for (const def of doomed) this.notify({ kind: 'unregistered', form: def })
  }

  /** 派发变更（监听器抛错逐个隔离，不影响登记/反注册本身）。 */
  private notify(change: FormChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (error) {
        console.error('[FormRegistry] 表现形式变更监听器抛错（已隔离）:', error)
      }
    }
  }
}

/** 全局唯一的表现形式注册表（与 entity-core 其他 registry 同口径：单例）。 */
export const formRegistry = new FormRegistry()

/**
 * 取某形式在给定配置下的**有效配置**：以 `defaultConfig` 打底，用容器自身 config 覆盖，
 * 并对 `configSchema` 声明的键做存在性兜底（用户手改 DB 缺键时不至于渲染异常）。
 */
export function resolveFormConfig(
  form: string,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const def = formRegistry.get(form)
  const base: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(def?.defaultConfig ?? {})) {
    base[key] = cloneConfigValue(value)
  }
  if (config) {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) base[key] = cloneConfigValue(value)
    }
  }
  for (const field of def?.configSchema ?? []) {
    if (base[field.key] === undefined) base[field.key] = cloneConfigValue(field.default)
  }
  return base
}

/**
 * 配置值克隆：数组必须复制一份。
 * 默认配置里的 `columns` 等数组若被原样返回，多个容器会共享同一引用；
 * 配置面板一旦原地修改就会污染注册表的默认值。
 */
function cloneConfigValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value
}
