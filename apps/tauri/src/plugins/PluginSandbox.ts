import type { PluginPermission, PluginManifest } from '@worldsmith/entity-core/types'
import { KNOWN_PERMISSIONS } from '@worldsmith/entity-core/types'
import { OFFICIAL_PLUGIN_IDS } from './plugin-manifest'

type PermissionName = string

const PERMISSION_API_MAP: Record<PermissionName, string[]> = {
  'storage:read': ['getEntities', 'getRelations', 'getEntity', 'getViews', 'kvGet', 'kvGetAll'],
  'storage:write': ['putEntity', 'updateEntity', 'deleteEntity', 'putRelation', 'updateRelation', 'deleteRelation', 'kvSet'],
  'entities:read': ['getEntities', 'getEntity'],
  'entities:write': ['putEntity', 'updateEntity', 'deleteEntity', 'importEntities'],
  'relations:read': ['getRelations'],
  'relations:write': ['putRelation', 'updateRelation', 'deleteRelation', 'importRelations'],
  'schema:register': ['registerEntityType', 'registerRelationType', 'registerEntityV2', 'registerFacet', 'registerRelationV2'],
  'hooks:register': ['registerHook', 'runHooks'],
  'views:register': ['registerView'],
  'network:fetch': [],
  'clipboard:access': [],
  'notifications:send': [],
}

/**
 * 官方插件默认权限 — 仅当 manifest 未声明任何权限时作为回退。
 * 注意：官方插件仍需在 manifest 中显式声明权限以获得完整权限。
 */
const DEFAULT_OFFICIAL_PERMISSIONS: PermissionName[] = [
  'storage:read',
  'entities:read',
  'relations:read',
  'schema:register',
  'hooks:register',
  'views:register',
]

/**
 * 敏感属性黑名单 — 防止原型链污染攻击
 * 这些属性名在 Proxy get handler 中将被拦截，即使 allowedMethods 中不包含
 */
const DANGEROUS_PROPERTY_BLACKLIST: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

export class PluginSandbox {
  private allowedMethods: Set<string>
  private pluginId: string
  private permissions: Set<PermissionName>

  constructor(pluginId: string, permissions: PermissionName[]) {
    this.pluginId = pluginId
    this.permissions = new Set(permissions)
    this.allowedMethods = new Set()

    for (const perm of permissions) {
      const methods = PERMISSION_API_MAP[perm]
      if (methods) {
        for (const m of methods) {
          this.allowedMethods.add(m)
        }
      }
    }
  }

  static createSafeAPI(
    api: Record<string, unknown>,
    manifest: PluginManifest,
  ): Record<string, unknown> {
    const isOfficial = OFFICIAL_PLUGIN_IDS.has(manifest.id)
    const manifestPermissions = manifest.permissions?.map(p => p.name) ?? []

    // 官方插件也必须从 manifest 中显式声明权限
    // 仅当 manifest 完全未声明权限时回退到默认集（向后兼容）
    let permissions: PermissionName[]
    if (manifestPermissions.length > 0) {
      permissions = manifestPermissions
    } else if (isOfficial) {
      console.warn(
        `[Sandbox] 官方插件 "${manifest.id}" 未在 manifest 中声明权限，使用默认权限集。` +
        `建议在 manifest 中显式声明所需权限。`,
      )
      permissions = DEFAULT_OFFICIAL_PERMISSIONS
    } else {
      permissions = []
    }

    const sandbox = new PluginSandbox(manifest.id, permissions)

    return new Proxy(api, {
      get(target, prop: string) {
        // 黑名单检查 — 阻止原型链污染攻击
        if (DANGEROUS_PROPERTY_BLACKLIST.has(prop)) {
          console.warn(
            `[Sandbox] 插件 "${manifest.id}" 尝试访问敏感属性 "${prop}"，已拦截`,
          )
          return undefined
        }

        if (!sandbox.allowedMethods.has(prop)) {
          console.warn(
            `[Sandbox] 插件 "${manifest.id}" 尝试访问未授权 API: "${prop}"` +
            ` (需要声明对应 permission)`,
          )
          return () => {
            throw new Error(
              `[Sandbox] 权限不足: 插件 "${manifest.id}" 未声明访问 "${prop}" 的权限`,
            )
          }
        }

        const value = target[prop]
        if (typeof value === 'function') {
          return sandbox.wrapFunction(prop, value.bind(target))
        }
        return value
      },
      set() {
        console.warn(`[Sandbox] 插件 "${manifest.id}" 尝试修改 API 对象，已拦截`)
        return false
      },
      // 阻止通过 has/in 检查探测内部属性
      has(_target, prop: string) {
        if (DANGEROUS_PROPERTY_BLACKLIST.has(prop)) return false
        return sandbox.allowedMethods.has(prop as string)
      },
    })
  }

  private wrapFunction(methodName: string, fn: Function): Function {
    const self = this
    return function (this: unknown, ...args: unknown[]) {
      // 权限已在 Proxy get handler 中校验，此处直接执行
      try {
        return fn.apply(this, args)
      } catch (e) {
        console.error(`[Sandbox] 插件 "${self.pluginId}" 调用 ${methodName} 出错:`, e)
        throw e
      }
    }
  }

  hasPermission(name: PermissionName): boolean {
    return this.permissions.has(name)
  }

  getPermissions(): PermissionName[] {
    return Array.from(this.permissions)
  }
}

export function validatePluginPermissions(
  permissions: PluginPermission[],
): { unknown: string[]; valid: string[] } {
  const known = new Set(KNOWN_PERMISSIONS)
  const unknown: string[] = []
  const valid: string[] = []
  for (const p of permissions) {
    if (known.has(p.name as any)) {
      valid.push(p.name)
    } else {
      unknown.push(p.name)
    }
  }
  return { unknown, valid }
}
