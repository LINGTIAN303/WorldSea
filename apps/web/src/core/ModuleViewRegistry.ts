import type { CustomModule, ModuleViewConfig } from '@worldsmith/entity-core'

/** 自定义模块视图数据注册表：viewId → { module, viewConfig } */
const registry = new Map<string, { module: CustomModule; viewConfig: ModuleViewConfig }>()

export function setModuleViewData(
  viewId: string,
  data: { module: CustomModule; viewConfig: ModuleViewConfig }
) {
  registry.set(viewId, data)
}

export function getModuleViewData(
  viewId: string
): { module: CustomModule; viewConfig: ModuleViewConfig } | undefined {
  return registry.get(viewId)
}

export function removeModuleViewData(viewId: string) {
  registry.delete(viewId)
}

export function clearModuleViewData(moduleId: string) {
  const prefix = `custom.${moduleId}.`
  for (const key of registry.keys()) {
    if (key.startsWith(prefix)) registry.delete(key)
  }
}
