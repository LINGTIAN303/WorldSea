import type { ComponentTypeDefinition, ComponentTypeId } from '../types/layoutSchema'

const registry = new Map<ComponentTypeId, ComponentTypeDefinition>()

export function registerComponentType(def: ComponentTypeDefinition): void {
  if (registry.has(def.typeId)) {
    console.warn(`[ComponentTypeRegistry] 重复注册组件类型: ${def.typeId}`)
  }
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
