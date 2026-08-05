/**
 * # useSubagentRust — Tauri 端子 Agent 规格管理适配器
 *
 * 通过 Tauri `invoke` 调用 Rust 命令层中的 `subagent_*` 命令，把后端
 * `AgentCommandService` 的子 Agent 规格管理能力（`crates/agent-commands/src/lib.rs`）
 * 暴露为前端可直接调用的方法：查看 / 注册（同名按 id 覆盖） / 删除规格。
 *
 * 规格注册表在后端跨会话共享（`Arc<RwLock<Vec<SubAgentSpec>>>`），因此
 * 前端这里注册的规格，对**所有**会话的主 Agent 都立即可见（`list_sub_agents` /
 * `delegate_to_sub_agent`）。
 *
 * ## 参数契约
 * 后端 `subagent_register_spec` 直接反序列化 `SubAgentSpec`（agent-runtime 类型，
 * 字段为 snake_case：`system_prompt` / `tools_whitelist` / `max_iterations`）。
 * Tauri v2 仅对顶层命令参数做 camelCase 转换，嵌套结构体按 serde 字段名匹配，
 * 因此前端传入对象需使用 snake_case 键名。
 *
 * ## 状态设计
 * 模块级单例（与 useTerminalRust / useAgentRust 一致），多次调用返回同一份
 * 响应式状态与方法，避免多组件各自维护规格列表。
 */

import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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

// ─── 单例状态 ───────────────────────────────────────────────

const specs = ref<SubAgentSpec[]>([])
const busy = ref(false)
const error = ref('')

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
    // 方法
    refreshSpecs,
    registerSpec,
    removeSpec,
    exportSpecs,
    importSpecs,
  }
}