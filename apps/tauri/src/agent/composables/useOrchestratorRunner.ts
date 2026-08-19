/** useOrchestratorRunner：ToT/GoT/Supervisor 共享的编排图运行工厂（Rust 编排 4 模式 UI 下沉之 2-4）。
 *  封装 `orchestrator_run_tot/got/supervisor` 命令：会话校验 + invoke + 结果/错误回显。
 *  各模式 composable（useToTRust/useGoTRust/useSupervisorRust）经本工厂构造，避免重复三份样板。
 *  实时事件（思维树/委派进度）未单独映射前端通道，使用最终 `OrchestratorResult` 展示终态。 */

import { ref, readonly, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useAgentRust } from './useAgentRust'

// 模块级单例：复用 useAgentRust 的当前会话 ref（同一引用）
const { currentSessionId } = useAgentRust()

/** Rust OrchestratorResult 镜像（status 为 snake_case 序列化） */
export interface OrchestratorResult {
  status: 'completed' | 'aborted' | 'error' | 'timeout'
  finalMessage: string | null
  iterations: number
  error: string | null
  finalState: Record<string, unknown>
}

export interface OrchestratorRunner {
  busy: Readonly<Ref<boolean>>
  error: Readonly<Ref<string>>
  result: Readonly<Ref<OrchestratorResult | null>>
  /** 运行编排图；返回结果，失败或结果含 error 时抛错（错误写入 error ref） */
  run: (input: string, options?: Record<string, unknown>) => Promise<OrchestratorResult>
  /** 清空结果/错误 */
  reset: () => void
}

/** 创建一个编排图运行器（按 Tauri 命令名绑定对应模式） */
export function createOrchestratorRunner(command: string): OrchestratorRunner {
  const busy = ref(false)
  const error = ref('')
  const result = ref<OrchestratorResult | null>(null)

  function requireSession(): string {
    const sid = currentSessionId.value
    if (!sid) {
      error.value = '无活动会话，请先新建或切换会话'
      throw new Error(error.value)
    }
    return sid
  }

  async function run(input: string, options?: Record<string, unknown>): Promise<OrchestratorResult> {
    const sid = requireSession()
    busy.value = true
    error.value = ''
    result.value = null
    try {
      const res = await invoke<OrchestratorResult>(command, { sessionId: sid, input, options: options ?? null })
      result.value = res
      // 编排图"完成但内部失败"：invoke 不抛错，显式反映 error 到 UI
      if (res.error) {
        error.value = res.error
        throw new Error(res.error)
      }
      return res
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      busy.value = false
    }
  }

  function reset(): void {
    error.value = ''
    result.value = null
  }

  return { busy: readonly(busy), error: readonly(error), result: readonly(result), run, reset }
}