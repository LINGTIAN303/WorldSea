/**
 * 壳侧能力桥 · 产品域一侧（A，2026-09-25）。
 *
 * 角色（见 docs/plans/2026-09-25-双Cordis-DA批计划.md §二）：**product** = 世界语义提供方。
 * 本模块做三件事：
 * ① 安装伺服入口 `__WORLDSEA_CAPABILITY_CALL__`（壳在**本窗口** eval 派发调用）；
 * ② 把声明登记到壳（`cmd_capability_register`）——provider 由壳按窗口 label 判定，不可冒名；
 * ③ 对外提供**公开注册面** `registerWorldCapabilities`：WorldSea 树的芽（后续 B/C 批）注册自己的
 *    能力就是调它，禁区（ACL/超时/审计）都留在壳里，不在芽里各写一套。
 *
 * 非 Tauri 环境（浏览器预览 / 旧壳）静默跳过——能力桥是壳内设施。
 */
import { invoke } from '@tauri-apps/api/core'
import { entitySchemaRegistry, getProjectManager, pluginAPI, storage } from '@worldsea/entity-core'
import type { Entity, Relation } from '@worldsea/entity-core'

export interface WorldCapabilityParam {
  name: string
  description?: string
  required?: boolean
}

export interface WorldCapability {
  /** 「命名空间.名」小写点分（如 `world.views.list`）；与 agent 侧 `agent.*` 分域 */
  id: string
  summary: string
  params?: WorldCapabilityParam[]
  /** 可调用方窗口 label（`main` = Agent 面）。空数组 = 无人可调；本窗直读本地，不必过桥调自己 */
  acl: string[]
  /** D2-a（2026-09-27）：是否改产品域状态——true 则执行成功后派 `ws-capability-mutated`
   *  页面事件（detail.id = 能力 id），各 store 监听刷新 → Agent 改完工作台即见（能力桥边界 #6） */
  mutates?: boolean
  handler(args: Record<string, unknown>): unknown | Promise<unknown>
}

const handlers = new Map<string, WorldCapability['handler']>()
const mutators = new Set<string>()
let serving = false

function hasShellBridge(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function'
}

function reply(callId: string, ok: boolean, result: unknown, error: string | null): void {
  void invoke('cmd_capability_result', { callId, ok, result, error }).catch((err: unknown) => {
    console.warn('[worldsea-capability] 回执失败：', err)
  })
}

/** 伺服：查本地 handler → 执行 → 回执（缺 handler / 抛错都**立即**回执，不让调用方白等超时）。
 *  mutates 能力执行成功后派页面变更事件（D2-a：Agent 改完工作台即见）。 */
function serve(callId: string, id: string, args: Record<string, unknown> | null): void {
  const handler = handlers.get(id)
  if (!handler) {
    reply(callId, false, null, `CAPABILITY_UNKNOWN: 本窗口（工作台）未登记 ${id}`)
    return
  }
  Promise.resolve()
    .then(() => handler(args ?? {}))
    .then(result => {
      reply(callId, true, result === undefined ? null : result, null)
      if (mutators.has(id)) {
        window.dispatchEvent(new CustomEvent('ws-capability-mutated', { detail: { id } }))
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      reply(callId, false, null, message)
    })
}

function installServer(): void {
  if (serving) return
  serving = true
  ;(globalThis as { __WORLDSEA_CAPABILITY_CALL__?: typeof serve }).__WORLDSEA_CAPABILITY_CALL__ = serve
}

/**
 * 登记一组能力到壳（幂等：同 id 重复登记 = 覆盖，开发期热重载友好）。
 * 只登记**声明**（id/summary/params/acl）；handler 留在本页，壳不经手参数与结果之外的东西。
 */
export async function registerWorldCapabilities(caps: WorldCapability[]): Promise<void> {
  if (!hasShellBridge()) return
  installServer()
  for (const cap of caps) {
    handlers.set(cap.id, cap.handler)
    if (cap.mutates) mutators.add(cap.id)
    else mutators.delete(cap.id)
  }
  const decls = caps.map(cap => ({
    id: cap.id,
    summary: cap.summary,
    params: (cap.params ?? []).map(param => ({
      name: param.name,
      description: param.description ?? '',
      required: param.required ?? false,
    })),
    acl: cap.acl,
  }))
  const count = await invoke<number>('cmd_capability_register', { decls })
  console.log(`[worldsea-capability] 已登记 ${count} 条（provider=workspace）`)
}

/**
 * 撤登记一组能力（C 批，2026-09-25）：拆树/卸插件时收口声明面——壳侧只认**登记方窗口**撤自己的
 * （混入他人能力整批拒）；本地 handler 同步移除（撤后即便有迟到的调用派发也报「未登记」）。
 */
export async function unregisterWorldCapabilities(ids: string[]): Promise<number> {
  for (const id of ids) handlers.delete(id)
  if (!hasShellBridge()) return 0
  const count = await invoke<number>('cmd_capability_unregister', { ids })
  console.log(`[worldsea-capability] 已撤登记 ${count} 条（provider=workspace）`)
  return count
}

/** 实体列表瘦身：只回身份三件，字段负载走 world.entity.get（防大载荷过桥，能力桥边界 #4）。 */
function slimEntity(entity: Entity): { id: string; type: string; name: string } {
  return { id: entity.id, type: entity.type, name: entity.name }
}

/** 参数守卫（fail loud——错误码 WORLD_* 前缀，与壳侧 CAPABILITY_* 区分层级）。 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`WORLD_BAD_ARGS: ${field} 必填（非空字符串）`)
  return value
}

/**
 * 首批内建能力（真语义，非占位）：
 * - `world.views.list`：Agent 发现创作面的入口（读 `pluginAPI` **真源**，与视图生命周期同源）；
 * - `world.project.current`：Agent 判断「在给谁干活」的上下文（D2 §1.1：项目 = dsh 工作区，dirPath 即项目宇宙）；
 * - D2-b（2026-09-27）：**schema 驱动的产品域数据面**（批计划 §2.1）——`world.schema.get` 从运行时
 *   `entitySchemaRegistry` 动态出 schema（零手写零漂移），实体/关系 CRUD 走 `storage` 真数据层
 *   （与工作台各 store 同链路，带产品域校验）；mutates 能力执行成功后伺服派 `ws-capability-mutated`
 *   → 各 store 监听刷新，Agent 改完工作台即见（能力桥边界 #6 的页面内闭环）。
 */
export const WORLD_BUILTIN_CAPABILITIES: WorldCapability[] = [
  {
    id: 'world.views.list',
    summary: '当前创作面（芽视图）清单：id / 标题 / 归属芽 / 工具条模式',
    acl: ['main'],
    handler: () =>
      pluginAPI.getViews().map(view => ({
        id: view.id,
        label: view.label,
        pluginId: view.pluginId ?? null,
        toolbar: view.toolbar ?? 'bar',
      })),
  },
  {
    id: 'world.project.current',
    summary: '当前项目（id / 名称 / 目录；项目 = dsh 工作区，dirPath 即该项目数据宇宙的根）',
    acl: ['main'],
    handler: async () => {
      const manager = getProjectManager()
      const id = manager.getCurrentProjectId()
      const info = id ? await manager.getCurrentProject() : undefined
      return { id: id ?? null, name: info?.name ?? null, dirPath: info?.dirPath ?? null, isDefault: info?.isDefault ?? null }
    },
  },
  {
    id: 'world.project.list',
    summary: '项目清单（项目 = dsh 工作区，同源）：id / 名称 / 目录 path',
    acl: ['main'],
    handler: () => invoke('cmd_dsh_workspace_list'),
  },
  {
    id: 'world.schema.get',
    summary: '实体类型的字段 schema（typeKey/label/字段/必填/关联）；组装实体数据前先取 schema',
    params: [{ name: 'type', description: '实体类型 typeKey（如 character）；省略 = 返回全部类型的 schema', required: false }],
    acl: ['main'],
    handler: args => {
      const type = typeof args.type === 'string' && args.type.trim() ? args.type.trim() : null
      if (type === null) return entitySchemaRegistry.getAll()
      const schema = entitySchemaRegistry.get(type)
      if (!schema) throw new Error(`WORLD_SCHEMA_UNKNOWN: 未登记的实体类型 ${type}（type 参数省略可拿全部类型清单）`)
      return schema
    },
  },
  {
    id: 'world.entity.list',
    summary: '实体清单（瘦身：id/type/name）；type 省略 = 全部。字段详情用 world.entity.get',
    params: [{ name: 'type', description: '按实体类型过滤（typeKey）；省略 = 全部', required: false }],
    acl: ['main'],
    handler: async args => {
      const type = typeof args.type === 'string' && args.type.trim() ? args.type.trim() : null
      const entities = type ? await storage.getEntitiesByType(type) : await storage.getAllEntities()
      return entities.map(slimEntity)
    },
  },
  {
    id: 'world.entity.get',
    summary: '实体完整数据（含 properties 字段与 facets）',
    params: [{ name: 'id', description: '实体 id', required: true }],
    acl: ['main'],
    handler: async args => {
      const entity = await storage.getEntity(requireString(args.id, 'id'))
      if (!entity) throw new Error(`WORLD_ENTITY_UNKNOWN: 实体不存在（${String(args.id)}）`)
      return entity
    },
  },
  {
    id: 'world.entity.put',
    summary: '新建实体；先 world.schema.get 拿该类型字段 schema 再组装 properties',
    params: [{ name: 'entity', description: '{type, name, description?, properties?, tags?}；id 省略自动生成', required: true }],
    acl: ['main'],
    mutates: true,
    handler: async args => {
      const raw = (args.entity ?? null) as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') throw new Error('WORLD_BAD_ARGS: entity 必须是对象')
      const type = requireString(raw.type, 'entity.type')
      const name = requireString(raw.name, 'entity.name')
      if (!entitySchemaRegistry.get(type)) throw new Error(`WORLD_SCHEMA_UNKNOWN: 未登记的实体类型 ${type}（先 world.schema.get）`)
      const now = new Date().toISOString()
      const entity: Entity = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : crypto.randomUUID(),
        type,
        name,
        description: typeof raw.description === 'string' ? raw.description : '',
        properties: raw.properties && typeof raw.properties === 'object' ? (raw.properties as Record<string, unknown>) : {},
        tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
        createdAt: now,
        updatedAt: now,
      }
      await storage.putEntity(entity)
      return { id: entity.id, type: entity.type, name: entity.name }
    },
  },
  {
    id: 'world.entity.update',
    summary: '按 id 局部更新实体（changes 只传要改的字段）',
    params: [
      { name: 'id', description: '实体 id', required: true },
      { name: 'changes', description: '要改的字段（name/description/properties/tags…）', required: true },
    ],
    acl: ['main'],
    mutates: true,
    handler: async args => {
      const id = requireString(args.id, 'id')
      if (!args.changes || typeof args.changes !== 'object') throw new Error('WORLD_BAD_ARGS: changes 必须是对象')
      await storage.updateEntity(id, args.changes as Partial<Entity>)
      return { id }
    },
  },
  {
    id: 'world.entity.delete',
    summary: '按 id 删除实体（不可恢复，谨慎）',
    params: [{ name: 'id', description: '实体 id', required: true }],
    acl: ['main'],
    mutates: true,
    handler: async args => {
      const id = requireString(args.id, 'id')
      await storage.deleteEntity(id)
      return { id }
    },
  },
  {
    id: 'world.relation.list',
    summary: '关系清单；entityId 给定 = 与该实体相关的关系，省略 = 全部',
    params: [{ name: 'entityId', description: '按实体过滤（返回与它相关的关系）', required: false }],
    acl: ['main'],
    handler: async args => {
      const entityId = typeof args.entityId === 'string' && args.entityId.trim() ? args.entityId.trim() : null
      return entityId ? await storage.getRelationsByEntity(entityId) : await storage.getAllRelations()
    },
  },
  {
    id: 'world.relation.put',
    summary: '新建实体间关系（sourceId/targetId = 实体 id）',
    params: [{ name: 'relation', description: '{type, sourceId, targetId, label?, properties?}；id 与时间戳自动生成', required: true }],
    acl: ['main'],
    mutates: true,
    handler: async args => {
      const raw = (args.relation ?? null) as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') throw new Error('WORLD_BAD_ARGS: relation 必须是对象')
      const relation: Relation = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : crypto.randomUUID(),
        type: requireString(raw.type, 'relation.type'),
        sourceId: requireString(raw.sourceId, 'relation.sourceId'),
        targetId: requireString(raw.targetId, 'relation.targetId'),
        label: typeof raw.label === 'string' ? raw.label : undefined,
        properties: raw.properties && typeof raw.properties === 'object' ? (raw.properties as Record<string, unknown>) : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await storage.putRelation(relation)
      return { id: relation.id }
    },
  },
  {
    id: 'world.relation.delete',
    summary: '按 id 删除关系',
    params: [{ name: 'id', description: '关系 id', required: true }],
    acl: ['main'],
    mutates: true,
    handler: async args => {
      const id = requireString(args.id, 'id')
      await storage.deleteRelation(id)
      return { id }
    },
  },
]

/** 工作台窗入口调用：登记内建能力（失败只留日志——能力面缺席不应拖垮页面）。 */
export function installWorldCapabilities(): void {
  void registerWorldCapabilities(WORLD_BUILTIN_CAPABILITIES).catch((error: unknown) => {
    console.error('[worldsea-capability] 内建能力登记失败：', error)
  })
}
