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
import { getProjectManager, pluginAPI } from '@worldsea/entity-core'

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
  handler(args: Record<string, unknown>): unknown | Promise<unknown>
}

const handlers = new Map<string, WorldCapability['handler']>()
let serving = false

function hasShellBridge(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function'
}

function reply(callId: string, ok: boolean, result: unknown, error: string | null): void {
  void invoke('cmd_capability_result', { callId, ok, result, error }).catch((err: unknown) => {
    console.warn('[worldsea-capability] 回执失败：', err)
  })
}

/** 伺服：查本地 handler → 执行 → 回执（缺 handler / 抛错都**立即**回执，不让调用方白等超时）。 */
function serve(callId: string, id: string, args: Record<string, unknown> | null): void {
  const handler = handlers.get(id)
  if (!handler) {
    reply(callId, false, null, `CAPABILITY_UNKNOWN: 本窗口（工作台）未登记 ${id}`)
    return
  }
  Promise.resolve()
    .then(() => handler(args ?? {}))
    .then(result => reply(callId, true, result === undefined ? null : result, null))
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
  for (const cap of caps) handlers.set(cap.id, cap.handler)
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

/**
 * 首批内建能力（真语义，非占位）：
 * - `world.views.list`：Agent 发现创作面的入口（读 `pluginAPI` **真源**，与视图生命周期同源）；
 * - `world.project.current`：Agent 判断「在给谁干活」的上下文。
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
    summary: '当前项目（id 与名称）',
    acl: ['main'],
    handler: async () => {
      const manager = getProjectManager()
      const id = manager.getCurrentProjectId()
      const info = id ? await manager.getCurrentProject() : undefined
      return { id: id ?? null, name: info?.name ?? null }
    },
  },
]

/** 工作台窗入口调用：登记内建能力（失败只留日志——能力面缺席不应拖垮页面）。 */
export function installWorldCapabilities(): void {
  void registerWorldCapabilities(WORLD_BUILTIN_CAPABILITIES).catch((error: unknown) => {
    console.error('[worldsea-capability] 内建能力登记失败：', error)
  })
}
