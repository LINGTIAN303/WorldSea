/**
 * BatchEditModal 的无状态辅助（从该组件抽出，控制单文件规模）。
 * 与组件实例无关：标签串解析是纯转换，导出只依赖传入的实体列表。
 */

import type { Entity } from '@worldsea/entity-core'

/** FieldControl 的 tags 控件可能回传逗号串（用户在输入框里一次粘贴多个），归一为数组 */
export function toTagList(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  return String(val ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** 把选中实体序列化为 JSON 并触发浏览器下载 */
export function downloadEntitiesJson(items: Entity[]): void {
  const text = JSON.stringify(items, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'batch-export.json'
  a.click()
  URL.revokeObjectURL(url)
}
