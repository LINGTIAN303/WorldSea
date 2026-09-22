/**
 * 工具目录上下文（R 批 · R-0 分派基座）
 *
 * shared-ui 的行段组件不直接调 Tauri 命令：目录由 apps 侧 `useToolCatalog` 经
 * `provide(TOOL_CATALOG_KEY, catalog)` 下发，行段在 setup 里用 `useToolClass()` 取分类函数。
 * 未 provide（单测 / 独立预览 / 目录尚未就绪）→ 目录为空，纯静态规则分派（generic 兜底）。
 *
 * 设计依据：18-对话区行段渲染批草案 §5.1（三层分派）。
 */
import { inject, type InjectionKey, type Ref } from 'vue'

import { classifyTool, type ToolCatalogEntryView, type ToolClass } from './toolClassify'

export const TOOL_CATALOG_KEY: InjectionKey<
  Readonly<Ref<ReadonlyMap<string, ToolCatalogEntryView>>>
> = Symbol('ws:tool-catalog')

/** 取分类函数（工具名 → 能力类）；每条行段 setup 调用一次即可 */
export function useToolClass(): (name: string) => ToolClass {
  const catalog = inject(TOOL_CATALOG_KEY, null)
  return (name: string) => classifyTool(name, catalog?.value.get(name) ?? null)
}
