/**
 * forms/registry —— 表现形式的**兼容门面**（2026-11-13 起委托给平台级 `formRegistry`）。
 *
 * 【为什么提升】表现形式注册表已成为平台**第 6 贡献位**
 * （`@worldsea/entity-core/core` 的 `formRegistry` + `PluginAPI.registerForm`）：
 * 它是全仓除第二棵树之外唯一一处真正的插件式扩展点——新增一种表现形式
 * 只需注册一个 FormDefinition，不必改编辑器代码。原来它是 outline 私有的，
 * 不随插件启停、外界不可见、其他插件无法复用。
 *
 * 【为什么保留本文件】两个理由：
 * 1. outline 内 11 个 form 组件都从 `./registry` 取 `resolveFormConfig`，
 *    保留导入路径可让「提升」这一步零风险落地（不改 11 个调用方）；
 * 2. 既有测试（`formRegistry.spec` / `formsRegistration.spec`）直接测本模块机制，
 *    行为必须不变。
 *
 * 【分发口径】平台 `formRegistry` 是唯一真源，本文件只做转发。
 * - 插件注册走 `api.registerForm`（带 pluginId，可随卸载回卷）；
 * - 本文件的 `registerForm` 保留给测试与「非插件上下文的内部注册」。
 */
import type { Component } from 'vue'
import { formRegistry, resolveFormConfig as resolveFromPlatform } from '@worldsea/entity-core/core'

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
  /** multi-select 专用：至少保留几项（如表格列至少 1 列），未设则不限制。 */
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

/** 幂等注册：重复注册同 form 直接跳过（转发到平台注册表）。 */
export function registerForm(def: FormDefinition): void {
  formRegistry.register(def)
}

export function unregisterForm(form: string): boolean {
  return formRegistry.unregister(form)
}

export function getForm(form: string): FormDefinition | undefined {
  return formRegistry.get(form)
}

export function getAllForms(): FormDefinition[] {
  return formRegistry.getAll()
}

export function getFormsByKind(kind: FormKind): FormDefinition[] {
  return formRegistry.getByKind(kind)
}

/** 仅测试用：清空注册表，避免跨用例污染 */
export function clearForms(): void {
  formRegistry.clear()
}

/**
 * 取某形式在给定配置下的**有效配置**：以 defaultConfig 打底，用组件自身 config 覆盖，
 * 并对 configSchema 声明的键做存在性兜底（用户手改 DB 缺键时不至于渲染异常）。
 */
export function resolveFormConfig(
  form: string,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  return resolveFromPlatform(form, config)
}
