import { ref } from 'vue'

/** 覆盖解析后的有效图标（已按项目 > 全局 > 默认合并；默认值不在此表）。 */
const effective = new Map<string, string>()

/** 版本号用于让非 Pinia 的读取方（如 entitySchemaRegistry.getIconName）建立响应式依赖。 */
export const iconOverrideVersion = ref(0)

export function sproutIconSlot(pluginId: string): string {
  return `sprout:${pluginId}`
}

export function entityTypeIconSlot(type: string): string {
  return `entityType:${type}`
}

export function domainIconSlot(id: string): string {
  return `domain:${id}`
}

/** 详情页签：entityType 传 `*` 表示跨实体类型共享的通用页。 */
export function detailTabIconSlot(entityType: string, tabId: string): string {
  return `detailTab:${entityType}:${tabId}`
}

export function regionTypeIconSlot(value: string): string {
  return `regionType:${value}`
}

/** 整体替换有效覆盖表（store 在全局/项目状态变化时调用）。 */
export function setEffectiveIconOverrides(entries: ReadonlyMap<string, string>): void {
  effective.clear()
  for (const [key, icon] of entries) effective.set(key, icon)
  iconOverrideVersion.value++
}

export function getEffectiveIconOverride(slotKey: string): string | undefined {
  void iconOverrideVersion.value
  return effective.get(slotKey)
}

export function clearEffectiveIconOverrides(): void {
  effective.clear()
  iconOverrideVersion.value++
}
