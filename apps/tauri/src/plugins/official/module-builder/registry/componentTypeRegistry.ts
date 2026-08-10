import type { ComponentTypeDefinition, ComponentTypeId } from '../types/layoutSchema'

const registry = new Map<ComponentTypeId, ComponentTypeDefinition>()

export function registerComponentType(def: ComponentTypeDefinition): void {
  // 幂等注册：组件类型已存在则跳过，避免重复注册告警。
  // initializeComponentTypes() 会在插件激活与编辑器 setup 各调用一次，需可重复执行。
  if (registry.has(def.typeId)) return
  registry.set(def.typeId, def)
}

export function getComponentType(typeId: ComponentTypeId): ComponentTypeDefinition | undefined {
  return registry.get(typeId)
}

export function getAllComponentTypes(): ComponentTypeDefinition[] {
  return Array.from(registry.values())
}

export function getComponentTypesByCategory(category: string): ComponentTypeDefinition[] {
  return Array.from(registry.values()).filter(def => def.category === category)
}

export function unregisterComponentType(typeId: ComponentTypeId): boolean {
  return registry.delete(typeId)
}
