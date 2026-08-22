/** useRouterRust：Router Pattern 编排模式 Tauri 适配器（编排 4 模式 UI 下沉之 Router 样板）。
 *  封装 router_* 命令：配置路由目标 → 路由决策 → 结果&状态回显。
 *  与 usePlanRust 同构（模块级单例，复用 useAgentRust 的 currentSessionId）。 */

import { ref, readonly } from 'vue'
import { invoke } from './transport'
import { useAgentRust } from './useAgentRust'

// 模块级单例：复用 useAgentRust 的当前会话 ref（同一引用）
const { currentSessionId } = useAgentRust()

// ─── 类型（与后端对齐）────────

/** 路由目标（对应 agent-runtime::RouteTarget，snake_case） */
export interface RouterTarget {
  id: string
  name: string
  description: string
  keywords?: string[] | null
}

/** 路由决策结果（camelCase 回显） */
export interface RouterDecision {
  targetId: string
  targetName: string
  reason: string | null
  isFallback: boolean
}

/** Router 会话状态（camelCase 回显） */
export interface RouterState {
  targets: RouterTarget[]
  useLlm: boolean
  fallbackTargetId: string | null
  lastDecision: RouterDecision | null
}

// ─── 单例状态 ─────────

const busy = ref(false)
const error = ref('')
/** 当前会话的 Router 状态（targets/决策回显） */
const routerState = ref<RouterState | null>(null)

// ─── 方法 ─────────

/** 校验并取当前会话 */
function requireSession(): string {
  const sid = currentSessionId.value
  if (!sid) {
    error.value = '无活动会话，请先新建或切换会话'
    throw new Error(error.value)
  }
  return sid
}

/** 创建/替换路由配置（targets 非空） */
async function create(targets: RouterTarget[], useLlm: boolean, fallbackTargetId?: string | null): Promise<void> {
  const sid = requireSession()
  busy.value = true
  error.value = ''
  try {
    await invoke('router_create', { sessionId: sid, targets, useLlm, fallbackTargetId: fallbackTargetId ?? null })
    routerState.value = { targets, useLlm, fallbackTargetId: fallbackTargetId ?? null, lastDecision: null }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 执行一次路由决策 */
async function route(input: string): Promise<RouterDecision> {
  const sid = requireSession()
  busy.value = true
  error.value = ''
  try {
    const decision = await invoke<RouterDecision>('router_route', { sessionId: sid, input })
    if (routerState.value) {
      routerState.value.lastDecision = decision
    }
    return decision
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 更新路由目标 */
async function setTargets(targets: RouterTarget[], useLlm: boolean, fallbackTargetId?: string | null): Promise<void> {
  const sid = requireSession()
  busy.value = true
  error.value = ''
  try {
    await invoke('router_set_targets', { sessionId: sid, targets, useLlm, fallbackTargetId: fallbackTargetId ?? null })
    if (routerState.value) {
      routerState.value.targets = targets
      routerState.value.useLlm = useLlm
      routerState.value.fallbackTargetId = fallbackTargetId ?? null
      routerState.value.lastDecision = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 拉取当前会话 Router 状态 */
async function refreshState(): Promise<RouterState | null> {
  const sid = currentSessionId.value
  if (!sid) return null
  error.value = ''
  try {
    routerState.value = await invoke<RouterState | null>('router_get_state', { sessionId: sid })
    return routerState.value
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return null
  }
}

/** 销毁当前会话 Router 配置 */
async function destroy(): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) return
  try {
    await invoke('router_destroy', { sessionId: sid })
    routerState.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

export function useRouterRust() {
  return {
    busy: readonly(busy),
    error: readonly(error),
    routerState: readonly(routerState),
    create,
    route,
    setTargets,
    refreshState,
    destroy,
  }
}