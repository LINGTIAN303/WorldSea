/** useSubagentRust：Tauri 端子 Agent 规格管理适配器（subagent_* 命令封装），详细见 docs/details/注释/tauri/useSubagentRust.md */

import { ref } from 'vue'
import { invoke } from '../../agent/composables/transport'

// ─── 类型（与后端 SubAgentSpec 对齐，snake_case JSON 键）────────

/** 子 Agent 规格（对应 agent-runtime::supervisor::SubAgentSpec） */
export interface SubAgentSpec {
  /** 子 Agent 唯一 ID（delegate_to_sub_agent 按此引用） */
  id: string
  /** 人类可读名称 */
  name: string
  /** 能力描述（供主 Agent 的 LLM 选择时参考） */
  description: string
  /** 系统提示词（定义子 Agent 专长与行为边界） */
  system_prompt: string
  /** 工具白名单（None=继承 ToolBus 中所有工具；当前仅元数据记录） */
  tools_whitelist?: string[] | null
  /** 子 Agent 最大迭代次数（None=用 AgentLoopConfig 默认值） */
  max_iterations?: number | null
}

/** 子 Agent 实例的对外信息（对应 agent-commands::SubAgentInstanceInfo） */
export interface SubAgentInstanceInfo {
  /** 实例 id（与规格 id 一致） */
  sub_agent_id: string
  /** 子 Agent 名称（来自来源规格） */
  name: string
  /** 实例当前累积的消息条数 */
  message_count: number
  /** 实例是否正在流式执行 */
  is_streaming: boolean
}

// ─── 单例状态 ───────────────────────────────────────────────

const specs = ref<SubAgentSpec[]>([])
const busy = ref(false)
const error = ref('')
// 实例状态（按当前 activity 会话展示，切换会话时由组件刷新）
const instances = ref<SubAgentInstanceInfo[]>([])
const instancesBusy = ref(false)
const instanceMsg = ref('')

/** 刷新规格列表（幂等，供多处调用） */
async function refreshSpecs(): Promise<void> {
  try {
    specs.value = await invoke<SubAgentSpec[]>('subagent_list_specs')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// ─── 方法 ───────────────────────────────────────────────────

/** 注册一个子 Agent 规格（同名按 id 覆盖） */
async function registerSpec(spec: SubAgentSpec): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await invoke('subagent_register_spec', { spec })
    await refreshSpecs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 删除一个子 Agent 规格（按 id），返回是否删除成功 */
async function removeSpec(id: string): Promise<boolean> {
  busy.value = true
  error.value = ''
  try {
    const removed = await invoke<boolean>('subagent_remove_spec', { id })
    await refreshSpecs()
    return removed
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 导出全部规格为 JSON 字符串（备份/跨机迁移） */
async function exportSpecs(): Promise<string> {
  busy.value = true
  error.value = ''
  try {
    return await invoke<string>('subagent_export_specs')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 从 JSON 字符串导入规格（按 id 覆盖），返回导入条数 */
async function importSpecs(json: string): Promise<number> {
  busy.value = true
  error.value = ''
  try {
    const n = await invoke<number>('subagent_import_specs', { json })
    await refreshSpecs()
    return n
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 刷新指定会话的子 Agent 实例列表（展示累积上下文规模） */
async function refreshInstances(sessionId: string): Promise<void> {
  instanceMsg.value = ''
  instancesBusy.value = true
  try {
    instances.value = await invoke<SubAgentInstanceInfo[]>('subagent_list_instances', { sessionId })
  } catch (err) {
    instances.value = []
    instanceMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    instancesBusy.value = false
  }
}

/** 清空指定会话的单个子 Agent 实例（重置其累积上下文），返回是否成功移除 */
async function clearInstance(sessionId: string, subAgentId: string): Promise<boolean> {
  instanceMsg.value = ''
  instancesBusy.value = true
  try {
    const removed = await invoke<boolean>('subagent_clear_instance', { sessionId, subAgentId })
    await refreshInstances(sessionId)
    return removed
  } catch (err) {
    instanceMsg.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    instancesBusy.value = false
  }
}

/** 清空指定会话的全部子 Agent 实例（重置累积上下文），返回清空数量 */
async function clearInstances(sessionId: string): Promise<number> {
  instanceMsg.value = ''
  instancesBusy.value = true
  try {
    const n = await invoke<number>('subagent_clear_instances', { sessionId })
    await refreshInstances(sessionId)
    return n
  } catch (err) {
    instanceMsg.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    instancesBusy.value = false
  }
}

// 注：不在模块顶层调用 onMounted（模块导入时无组件实例，会触发
// "onMounted called when there is no active component instance" 警告）。
// 首次拉取规格列表由组件（SubAgentView.vue）的 onMounted 触发。

// ─── 导出 ───────────────────────────────────────────────────

export function useSubagentRust() {
  return {
    // 响应式状态（模块级单例，组件内只读使用）
    specs,
    busy,
    error,
    instances,
    instancesBusy,
    instanceMsg,
    // 方法
    refreshSpecs,
    registerSpec,
    removeSpec,
    exportSpecs,
    importSpecs,
    refreshInstances,
    clearInstance,
    clearInstances,
  }
}