/**
 * governor/api.ts — GovernorAPI 实现（Web 端迁移版）
 *
 * P3-W3 从根 src/governor/api.ts 迁移，实现不变。
 *
 * 包装现有 pluginAPI，附加环境上下文。
 * 模块通过此 API 注册实体类型/视图/关系，并查询环境能力。
 *
 * 关键设计：
 * - 每次激活模块前，调用 pluginAPI.setPluginId(module.id) 设置当前插件上下文
 * - GovernorAPI 在 pluginAPI 基础上增加 env/hasCapability/module 字段
 * - 注册方法直接委托 pluginAPI，保持向后兼容
 */
import { pluginAPI } from '@worldsmith/entity-core'
import type { GovernorAPI, Environment, CapabilityTag } from './types'

/**
 * 创建 GovernorAPI 实例。
 *
 * @param moduleId 当前模块 id
 * @param moduleName 当前模块名称
 * @param moduleVersion 当前模块版本
 * @param env 当前环境快照
 * @returns GovernorAPI 实例
 */
export function createGovernorAPI(
  moduleId: string,
  moduleName: string,
  moduleVersion: string,
  env: Environment,
): GovernorAPI {
  // 设置 pluginAPI 的当前插件 id（用于注册时标记 pluginId）
  pluginAPI.setPluginId(moduleId)

  return {
    module: {
      id: moduleId,
      name: moduleName,
      version: moduleVersion,
    },
    env,
    hasCapability(tag: CapabilityTag): boolean {
      return env.capabilities.has(tag)
    },

    // ── 委托 pluginAPI 的注册方法 ──
    registerEntityV2(params) {
      pluginAPI.registerEntityV2(params as any)
    },
    registerFacet(facet) {
      pluginAPI.registerFacet(facet as any)
    },
    registerRelationV2(schema) {
      pluginAPI.registerRelationV2(schema as any)
    },
    registerView(view) {
      pluginAPI.registerView(view as any)
    },
    registerNodeType(nodeType) {
      pluginAPI.registerNodeType(nodeType as any)
    },
    registerWorkflowTemplate(template) {
      pluginAPI.registerWorkflowTemplate(template as any)
    },
    registerHook(name, fn) {
      pluginAPI.registerHook(name, fn)
    },
    getEntities(type) {
      return pluginAPI.getEntities(type) as Promise<unknown[]>
    },
    getEntity(id) {
      return pluginAPI.getEntity(id) as Promise<unknown>
    },
    getRelations(filter) {
      return pluginAPI.getRelations(filter as any) as Promise<unknown[]>
    },
  }
}
