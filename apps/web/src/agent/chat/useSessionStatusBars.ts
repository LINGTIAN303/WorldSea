/** useSessionStatusBars：命令状态栏生命周期管理（Loop/ToT/GoT/MA/Supervisor，从 AgentChat 拆分，依赖注入解耦） */
import { ref, computed, watch, onUnmounted, type Ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { useLoopControlRust } from '../composables/useLoopControlRust'
import { useToTRust } from '../composables/useToTRust'
import { useGoTRust } from '../composables/useGoTRust'
import { useMultiAgentRust } from '../composables/useMultiAgentRust'
import { useSupervisorRust } from '../composables/useSupervisorRust'

/** 输入框接口（AgentInputBar 暴露的读取/清空方法） */
export interface SessionStatusInputBar {
  getInputText(): string
  setInputText(text: string): void
}

export interface UseSessionStatusBarsOptions {
  /** useAgent.activeTask（Rust 任务状态，可能为 null，仅需 taskId 字段） */
  activeTask: Ref<{ taskId?: string | null } | null>
  /** useAgent.currentSessionId（会话切换时清理各会话） */
  currentSessionId: Ref<string | null>
  /** AgentInputBar ref（/tot 等命令读取输入与清空） */
  inputBarRef: Ref<SessionStatusInputBar | undefined>
  /** useAgent.getProviderConfig（RustProviderConfig，ensureInitialized 后可用） */
  rustGetProviderConfig: () => unknown
}

export function useSessionStatusBars(options: UseSessionStatusBarsOptions) {
  const { activeTask, currentSessionId, inputBarRef, rustGetProviderConfig } = options
  const settingsStore = useSettingsStore()
  const isRustBackend = computed(() => settingsStore.agentBackend === 'rust')

  /** LoopController 生命周期管理（监听 activeTask.taskId 自动 create/destroy），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  const { create: lcCreate, destroy: lcDestroy } = useLoopControlRust()
  const loopControlTaskId = ref<string | null>(null)

  watch(
    () => activeTask.value?.taskId ?? null,
    async (newTaskId, oldTaskId) => {
      // 非 Rust 后端：跳过 Loop Control（TS 后端无此能力）
      if (!isRustBackend.value) {
        loopControlTaskId.value = null
        return
      }

      // 任务切换或结束：先销毁旧任务的 LoopController
      if (oldTaskId && oldTaskId !== newTaskId) {
        try {
          await lcDestroy(oldTaskId)
        } catch (err) {
          console.warn(`[AgentChat] LoopControl destroy 旧任务 ${oldTaskId} 失败:`, err)
        }
      }

      // 新任务出现：创建 LoopController（使用默认配置）
      if (newTaskId && newTaskId !== oldTaskId) {
        try {
          await lcCreate(newTaskId)
          loopControlTaskId.value = newTaskId
        } catch (err) {
          console.error(`[AgentChat] LoopControl create 新任务 ${newTaskId} 失败:`, err)
          loopControlTaskId.value = null
        }
      } else if (!newTaskId) {
        // 任务结束且无新任务
        loopControlTaskId.value = null
      }
    },
    { immediate: false },
  )

  onUnmounted(() => {
    // 组件卸载时清理残留的 LoopController，避免 Rust 端 registry 泄漏
    const tid = loopControlTaskId.value
    if (tid) {
      lcDestroy(tid).catch((err) => {
        console.warn(`[AgentChat] LoopControl destroy on unmount 失败:`, err)
      })
      loopControlTaskId.value = null
    }
  })

  /** ToT 会话生命周期管理（/tot 命令主动驱动，与 LoopControl 差异见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  const { create: totCreate, run: totRun, destroy: totDestroy, generateSessionId: totGenerateSessionId } = useToTRust()
  const totSessionId = ref<string | null>(null)

  /** 处理 /tot 命令：解析 `/tot <task>` 并启动 ToT 探索（流程/错误处理见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  async function handleTotCommand(): Promise<void> {
    if (!isRustBackend.value) {
      console.warn('[AgentChat] ToT 命令仅在 Rust 后端可用')
      return
    }

    // 从输入框读取完整文本（/tot <task>）并去除命令前缀
    const raw = inputBarRef.value?.getInputText() ?? ''
    const task = raw.replace(/^\/tot\s*/, '').trim()
    if (!task) {
      console.warn('[AgentChat] /tot 命令缺少任务描述')
      return
    }

    // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
    const providerConfig = rustGetProviderConfig()
    if (!providerConfig) {
      console.error('[AgentChat] ToT 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
      return
    }

    // 若已有 ToT 会话，先销毁（保证单会话）
    if (totSessionId.value) {
      await totDestroy(totSessionId.value).catch((err) => {
        console.warn('[AgentChat] 旧 ToT 会话销毁失败:', err)
      })
      totSessionId.value = null
    }

    // 创建新 ToT 会话并启动思维树探索
    const sessionId = totGenerateSessionId()
    try {
      await totCreate(sessionId, providerConfig)
      totSessionId.value = sessionId
      // 清空输入框
      inputBarRef.value?.setInputText('')
      // 启动思维树探索（异步执行，事件流会推送思维节点状态）
      void totRun(sessionId, task).catch((err) => {
        console.error(`[AgentChat] ToT 运行失败 session=${sessionId}:`, err)
      })
    } catch (err) {
      console.error('[AgentChat] ToT 创建失败:', err)
    }
  }

  // 会话切换时清理 ToT 会话（避免跨会话残留）
  watch(
    () => currentSessionId.value,
    async (newId, oldId) => {
      if (oldId && newId !== oldId && totSessionId.value) {
        await totDestroy(totSessionId.value).catch((err) => {
          console.warn('[AgentChat] ToT 会话切换清理失败:', err)
        })
        totSessionId.value = null
      }
    },
  )

  // 组件卸载时清理 ToT 会话，避免 Rust 端 registry 泄漏
  onUnmounted(() => {
    if (totSessionId.value) {
      totDestroy(totSessionId.value).catch((err) => {
        console.warn('[AgentChat] ToT 会话卸载清理失败:', err)
      })
      totSessionId.value = null
    }
  })

  /** GoT 会话生命周期管理（/got 命令驱动，多父聚合与 ToT 差异见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  const {
    create: gotCreate,
    run: gotRun,
    destroy: gotDestroy,
    generateSessionId: gotGenerateSessionId,
  } = useGoTRust()
  const gotSessionId = ref<string | null>(null)

  /** 处理 /got 命令：解析 `/got <task>` 并启动 GoT 探索（流程/错误处理见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  async function handleGotCommand(): Promise<void> {
    if (!isRustBackend.value) {
      console.warn('[AgentChat] GoT 命令仅在 Rust 后端可用')
      return
    }

    // 从输入框读取完整文本（/got <task>）并去除命令前缀
    const raw = inputBarRef.value?.getInputText() ?? ''
    const task = raw.replace(/^\/got\s*/, '').trim()
    if (!task) {
      console.warn('[AgentChat] /got 命令缺少任务描述')
      return
    }

    // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
    const providerConfig = rustGetProviderConfig()
    if (!providerConfig) {
      console.error('[AgentChat] GoT 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
      return
    }

    // 若已有 GoT 会话，先销毁（保证单会话）
    if (gotSessionId.value) {
      await gotDestroy(gotSessionId.value).catch((err) => {
        console.warn('[AgentChat] 旧 GoT 会话销毁失败:', err)
      })
      gotSessionId.value = null
    }

    // 创建新 GoT 会话并启动思维图探索
    const sessionId = gotGenerateSessionId()
    try {
      await gotCreate(sessionId, providerConfig)
      gotSessionId.value = sessionId
      // 清空输入框
      inputBarRef.value?.setInputText('')
      // 启动思维图探索（异步执行，事件流会推送思维节点/聚合状态）
      void gotRun(sessionId, task).catch((err) => {
        console.error(`[AgentChat] GoT 运行失败 session=${sessionId}:`, err)
      })
    } catch (err) {
      console.error('[AgentChat] GoT 创建失败:', err)
    }
  }

  // 会话切换时清理 GoT 会话（避免跨会话残留）
  watch(
    () => currentSessionId.value,
    async (newId, oldId) => {
      if (oldId && newId !== oldId && gotSessionId.value) {
        await gotDestroy(gotSessionId.value).catch((err) => {
          console.warn('[AgentChat] GoT 会话切换清理失败:', err)
        })
        gotSessionId.value = null
      }
    },
  )

  // 组件卸载时清理 GoT 会话，避免 Rust 端 registry 泄漏
  onUnmounted(() => {
    if (gotSessionId.value) {
      gotDestroy(gotSessionId.value).catch((err) => {
        console.warn('[AgentChat] GoT 会话卸载清理失败:', err)
      })
      gotSessionId.value = null
    }
  })

  /** Multi-Agent 会话生命周期管理（/ma 命令驱动，3 Agent Mesh 协作与差异见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  const {
    create: maCreate,
    run: maRun,
    destroy: maDestroy,
    generateSessionId: maGenerateSessionId,
  } = useMultiAgentRust()
  const maSessionId = ref<string | null>(null)

  /**
   * 构建默认 Agent specs（3 Agent Mesh 协作）
   *
   * - coordinator：协调者，分解任务并综合结果
   * - researcher：研究员，负责信息检索与分析
   * - critic：评审员，负责评审其他 Agent 的输出
   *
   * 使用 Mesh 拓扑 + Hybrid 收敛（goal_check + max_rounds=10）。
   */
  function buildDefaultAgentSpecs(task: string) {
    return [
      {
        id: 'coordinator',
        name: '协调者',
        role: 'coordinator' as const,
        description: '负责分解任务、调度其他 Agent 并综合最终结果',
        system_prompt:
          '你是一个任务协调者。你的职责是：\n' +
          '1. 理解用户任务并分解为可执行的子任务\n' +
          '2. 与研究员和评审员协作，分配子任务\n' +
          '3. 综合所有 Agent 的输出，形成最终答案\n\n' +
          '请保持简洁、结构化的输出风格。',
        tools_whitelist: null,
        max_iterations: null,
        initial_message: task,
      },
      {
        id: 'researcher',
        name: '研究员',
        role: 'researcher' as const,
        description: '负责信息检索、分析与事实核查',
        system_prompt:
          '你是一个研究专家。你的职责是：\n' +
          '1. 接收协调者分配的子任务\n' +
          '2. 进行深入分析与信息检索\n' +
          '3. 将研究结果写入共享黑板供其他 Agent 使用\n\n' +
          '请提供有依据、可验证的分析结论。',
        tools_whitelist: null,
        max_iterations: null,
        initial_message: null,
      },
      {
        id: 'critic',
        name: '评审员',
        role: 'critic' as const,
        description: '负责评审其他 Agent 的输出质量与逻辑严谨性',
        system_prompt:
          '你是一个严谨的评审者。你的职责是：\n' +
          '1. 审查研究员与协调者的输出\n' +
          '2. 指出潜在问题、逻辑漏洞或事实错误\n' +
          '3. 提出改进建议\n\n' +
          '请保持建设性、客观的评审态度。',
        tools_whitelist: null,
        max_iterations: null,
        initial_message: null,
      },
    ]
  }

  /** 处理 /ma 命令：解析 `/ma <task>` 并启动 Multi-Agent 协作（流程/错误处理见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  async function handleMultiAgentCommand(): Promise<void> {
    if (!isRustBackend.value) {
      console.warn('[AgentChat] Multi-Agent 命令仅在 Rust 后端可用')
      return
    }

    // 从输入框读取完整文本（/ma <task>）并去除命令前缀
    const raw = inputBarRef.value?.getInputText() ?? ''
    const task = raw.replace(/^\/ma\s*/, '').trim()
    if (!task) {
      console.warn('[AgentChat] /ma 命令缺少任务描述')
      return
    }

    // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
    const providerConfig = rustGetProviderConfig()
    if (!providerConfig) {
      console.error('[AgentChat] Multi-Agent 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
      return
    }

    // 若已有 MA 会话，先销毁（保证单会话）
    if (maSessionId.value) {
      await maDestroy(maSessionId.value).catch((err) => {
        console.warn('[AgentChat] 旧 MA 会话销毁失败:', err)
      })
      maSessionId.value = null
    }

    // 创建新 Multi-Agent 会话并启动协作
    const sessionId = maGenerateSessionId()
    const specs = buildDefaultAgentSpecs(task)
    try {
      await maCreate(sessionId, providerConfig, specs, {
        maxRounds: 10,
        topology: { kind: 'mesh' },
        convergenceStrategy: { kind: 'hybrid', goal_check: true, max_rounds: 10 },
      })
      maSessionId.value = sessionId
      // 清空输入框
      inputBarRef.value?.setInputText('')
      // 启动协作（异步执行，事件流会推送轮次/消息/黑板/收敛状态）
      void maRun(sessionId, task).catch((err) => {
        console.error(`[AgentChat] Multi-Agent 运行失败 session=${sessionId}:`, err)
      })
    } catch (err) {
      console.error('[AgentChat] Multi-Agent 创建失败:', err)
    }
  }

  // 会话切换时清理 MA 会话（避免跨会话残留）
  watch(
    () => currentSessionId.value,
    async (newId, oldId) => {
      if (oldId && newId !== oldId && maSessionId.value) {
        await maDestroy(maSessionId.value).catch((err) => {
          console.warn('[AgentChat] Multi-Agent 会话切换清理失败:', err)
        })
        maSessionId.value = null
      }
    },
  )

  // 组件卸载时清理 MA 会话，避免 Rust 端 registry 泄漏
  onUnmounted(() => {
    if (maSessionId.value) {
      maDestroy(maSessionId.value).catch((err) => {
        console.warn('[AgentChat] Multi-Agent 会话卸载清理失败:', err)
      })
      maSessionId.value = null
    }
  })

  /** Supervisor 会话生命周期管理（/supervisor 命令驱动，中心化调度与差异见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  const {
    create: supCreate,
    run: supRun,
    destroy: supDestroy,
    generateSessionId: supGenerateSessionId,
  } = useSupervisorRust()
  const supSessionId = ref<string | null>(null)

  /**
   * 构建默认 SubAgent specs（2 子 Agent：代码 + 文档）
   *
   * - coder：代码专家，处理代码编写、调试、重构任务
   * - writer：文档专家，处理文档撰写、翻译、润色任务
   *
   * Supervisor 会根据任务描述自动选择一个子 Agent 执行（LLM 决策）。
   */
  function buildDefaultSubAgentSpecs() {
    return [
      {
        id: 'coder',
        name: '代码专家',
        description: '处理代码编写、调试、重构、算法实现等编程任务',
        system_prompt:
          '你是一个专业的代码工程师。你的职责是：\n' +
          '1. 理解分配给你的编程任务\n' +
          '2. 编写高质量、可维护的代码\n' +
          '3. 提供必要的代码注释与说明\n\n' +
          '请保持代码简洁、结构清晰。',
      },
      {
        id: 'writer',
        name: '文档专家',
        description: '处理文档撰写、翻译、润色、说明等文字任务',
        system_prompt:
          '你是一个专业的技术文档工程师。你的职责是：\n' +
          '1. 理解分配给你的文档任务\n' +
          '2. 撰写清晰、结构化的文档\n' +
          '3. 保持专业、准确的文风\n\n' +
          '请使用 Markdown 格式输出。',
      },
    ]
  }

  /** 处理 /supervisor 命令：解析 `/supervisor <task>` 并启动 Supervisor 编排（流程/错误处理见文档），详细见 docs/details/注释/web/agent/chat/useSessionStatusBars.md */
  async function handleSupervisorCommand(): Promise<void> {
    if (!isRustBackend.value) {
      console.warn('[AgentChat] Supervisor 命令仅在 Rust 后端可用')
      return
    }

    // 从输入框读取完整文本（/supervisor <task>）并去除命令前缀
    const raw = inputBarRef.value?.getInputText() ?? ''
    const task = raw.replace(/^\/supervisor\s*/, '').trim()
    if (!task) {
      console.warn('[AgentChat] /supervisor 命令缺少任务描述')
      return
    }

    // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
    const providerConfig = rustGetProviderConfig()
    if (!providerConfig) {
      console.error('[AgentChat] Supervisor 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
      return
    }

    // 若已有 SUP 会话，先销毁（保证单会话）
    if (supSessionId.value) {
      await supDestroy(supSessionId.value).catch((err) => {
        console.warn('[AgentChat] 旧 SUP 会话销毁失败:', err)
      })
      supSessionId.value = null
    }

    // 创建新 Supervisor 会话并启动编排
    const sessionId = supGenerateSessionId()
    const specs = buildDefaultSubAgentSpecs()
    try {
      await supCreate(sessionId, providerConfig, specs, {
        maxRounds: 5,
        requireSummary: true,
      })
      supSessionId.value = sessionId
      // 清空输入框
      inputBarRef.value?.setInputText('')
      // 启动编排（异步执行，事件流会推送任务分配/子 Agent 执行/汇总结果）
      void supRun(sessionId, task).catch((err) => {
        console.error(`[AgentChat] Supervisor 运行失败 session=${sessionId}:`, err)
      })
    } catch (err) {
      console.error('[AgentChat] Supervisor 创建失败:', err)
    }
  }

  // 会话切换时清理 SUP 会话（避免跨会话残留）
  watch(
    () => currentSessionId.value,
    async (newId, oldId) => {
      if (oldId && newId !== oldId && supSessionId.value) {
        await supDestroy(supSessionId.value).catch((err) => {
          console.warn('[AgentChat] Supervisor 会话切换清理失败:', err)
        })
        supSessionId.value = null
      }
    },
  )

  // 组件卸载时清理 SUP 会话，避免 Rust 端 registry 泄漏
  onUnmounted(() => {
    if (supSessionId.value) {
      supDestroy(supSessionId.value).catch((err) => {
        console.warn('[AgentChat] Supervisor 会话卸载清理失败:', err)
      })
      supSessionId.value = null
    }
  })

  return {
    loopControlTaskId,
    totSessionId,
    gotSessionId,
    maSessionId,
    supSessionId,
    handleTotCommand,
    handleGotCommand,
    handleMultiAgentCommand,
    handleSupervisorCommand,
  }
}
