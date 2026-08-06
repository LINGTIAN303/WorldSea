/**
 * useSmartFillChat — Layer D 对话式协同创作 composable (V2)
 *
 * 管理小窗的打开/关闭、独立 Agent 后端、上下文注入、A2UI 渲染、回写。
 * 使用独立的 IAgentBackend，不再与主聊天共享 subBackend。
 */

import { ref, readonly, onUnmounted } from 'vue'
import type { IAgentBackend, AgentEvent, A2UIMessage } from '@agent/index'
import { createWorldSmithAgent, getToolsForSkills } from '@agent/index'
import type { ProviderConfig } from '@agent/index'
import { useEntityStore, useRelationStore, useFileStore, useSettingsStore } from '@worldsmith/entity-core'
import { loadApiKey } from '@agent/index'
import type { CloudProvider } from '@agent/index'
import { getModelInfo } from '@worldsmith/agent-runtime'
import type { TextSelectionInfo } from '@worldsmith/ui-kit'

export interface SmartFillChatContext {
  entityType?: string
  entityId?: string
  entityName?: string
  fieldKey?: string
  selectedText?: string
  pluginId?: string
}

export interface SmartFillChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function useSmartFillChat() {
  const visible = ref(false)
  const context = ref<SmartFillChatContext>({})
  const loading = ref(false)
  const messages = ref<SmartFillChatMessage[]>([])
  const a2uiSurfaceId = ref<string | null>(null)

  // 独立 Agent 后端
  let _backend: IAgentBackend | null = null
  let _providerConfig: ProviderConfig | null = null
  let _toolContext: any = null
  let _msgIdCounter = 0

  function _nextMsgId(): string {
    return `sf-msg-${++_msgIdCounter}`
  }

  /** 构建 Provider 配置 */
  async function _buildProviderConfig(): Promise<ProviderConfig> {
    const settingsStore = useSettingsStore()
    const mode = settingsStore.aiProviderMode as 'cloud' | 'local' | 'custom'

    if (mode === 'cloud') {
      const provider = settingsStore.aiCloudProvider as CloudProvider
      const apiKey = await loadApiKey(provider)
      const info = getModelInfo(settingsStore.aiCloudModel)
      return {
        mode: 'cloud',
        provider,
        modelId: settingsStore.aiCloudModel,
        apiKey,
        supportsVision: info?.supportsVision ?? false,
        contextWindow: info?.contextLength,
        maxTokens: info?.maxOutputTokens,
      } as any
    }

    if (mode === 'local') {
      return {
        mode: 'local',
        endpoint: settingsStore.aiLocalEndpoint,
        apiType: settingsStore.aiLocalType as any,
        modelId: settingsStore.aiLocalModel,
      }
    }

    const apiKey = await loadApiKey(settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl))
    const cfg: ProviderConfig = {
      mode: 'custom',
      baseUrl: settingsStore.aiCustomBaseUrl,
      apiType: settingsStore.aiCustomType as any,
      modelId: settingsStore.aiCustomModel,
      apiKey,
    }
    return cfg
  }

  /** 构建 toolContext */
  function _buildToolContext() {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    const fileStore = useFileStore()

    return {
      stores: {
        entity: entityStore,
        relation: relationStore,
        file: fileStore,
        settings: {
          getProviderConfig: () => _providerConfig,
          getSearchConfig: () => ({}),
        },
        ui: {
          confirm: async (_title: string, _message: string) => true,
        },
      },
      projectInfo: {
        name: 'WorldSmith-SmartFill',
        entityTypes: entityStore.types.map(t => t.typeKey),
        relationTypes: [],
        dirPath: null,
      },
      platform: 'web' as const,
      emitA2UI: (surfaceId: string, message: A2UIMessage) => {
        // 将 A2UI 事件通过 CustomEvent 分发给 SmartFillChat.vue
        window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:a2ui', {
          detail: { surfaceId, message },
        }))
      },
    }
  }

  /** 获取或创建独立 Agent 后端 */
  async function _ensureBackend(): Promise<IAgentBackend | null> {
    if (_backend) return _backend
    if (!_providerConfig || !_toolContext) return null

    try {
      const tools = getToolsForSkills(['smart-fill'])
      const agent = await createWorldSmithAgent({
        providerConfig: _providerConfig,
        toolContext: _toolContext,
        tools,
        projectName: 'WorldSmith-SmartFill',
      })

      agent.subscribe((event: AgentEvent) => {
        _handleAgentEvent(event)
      })

      _backend = agent
      return agent
    } catch (err) {
      console.error('[SmartFillChat] Agent 后端创建失败:', err)
      return null
    }
  }

  /** 处理 Agent 事件 */
  function _handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_end': {
        loading.value = false
        // 从最终消息中提取 assistant 回复
        if (event.messages?.length) {
          const lastMsg = event.messages.filter((m: any) => m.role === 'assistant').pop()
          if (lastMsg?.content) {
            // 检查是否已有同内容的消息（避免重复）
            const exists = messages.value.some(
              m => m.role === 'assistant' && m.content === lastMsg.content
            )
            if (!exists) {
              messages.value.push({
                id: _nextMsgId(),
                role: 'assistant',
                content: lastMsg.content,
              })
            }
          }
        }
        break
      }
      case 'message_update': {
        // 流式更新最后一条 assistant 消息
        const lastAssistant = _findLastAssistant()
        if (lastAssistant && event.content) {
          lastAssistant.content = event.content
        }
        break
      }
      case 'message_end': {
        const lastAssistant = _findLastAssistant()
        if (lastAssistant && event.content) {
          lastAssistant.content = event.content
        }
        break
      }
      case 'a2ui': {
        // A2UI 事件已通过 emitA2UI 回调分发，此处仅记录 surfaceId
        a2uiSurfaceId.value = event.surfaceId
        break
      }
      case 'error': {
        loading.value = false
        messages.value.push({
          id: _nextMsgId(),
          role: 'assistant',
          content: `错误: ${event.error?.message || String(event.error)}`,
        })
        break
      }
    }
  }

  function _findLastAssistant(): SmartFillChatMessage | undefined {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i]
    }
    return undefined
  }

  /** 打开对话小窗 */
  async function open(params: {
    entityType?: string
    entityId?: string
    entityName?: string
    fieldKey?: string
    selectedText?: string
    pluginId?: string
  }) {
    context.value = {
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName,
      fieldKey: params.fieldKey,
      selectedText: params.selectedText,
      pluginId: params.pluginId,
    }
    visible.value = true
    loading.value = false
    messages.value = []
    a2uiSurfaceId.value = null

    // 初始化 Provider 配置和 toolContext
    try {
      _providerConfig = await _buildProviderConfig()
      _toolContext = _buildToolContext()
    } catch (err) {
      console.error('[SmartFillChat] Provider 配置失败:', err)
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: 'AI 配置初始化失败，请检查设置中的 AI 供应商和 API Key 配置。',
      })
      return
    }

    // 构建初始 prompt，指示 Agent 先获取上下文
    const ctx = context.value
    const prompt = [
      `/skill:smart-fill`,
      `用户在编辑实体时打开了对话，请先调用 entity_get_context 获取实体上下文，然后与用户对话。`,
      ctx.entityType ? `实体类型：${ctx.entityType}` : '',
      ctx.entityName ? `实体名称：${ctx.entityName}` : '',
      ctx.entityId ? `实体ID：${ctx.entityId}` : '',
      ctx.fieldKey ? `字段：${ctx.fieldKey}` : '',
      ctx.selectedText ? `选中文本：「${ctx.selectedText}」` : '',
      `请基于上下文与用户对话，帮助完善设定。`,
    ].filter(Boolean).join('\n')

    // 添加欢迎消息
    if (ctx.selectedText) {
      const truncated = ctx.selectedText.length > 80 ? ctx.selectedText.slice(0, 80) + '...' : ctx.selectedText
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: `我看到了你选中的文本："${truncated}"。你想聊聊什么？比如：\n- 帮我扩写/改写这段内容\n- 为这个字段生成建议值\n- 分析这段文本与世界观的一致性`,
      })
    } else {
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: `你好！我了解当前${ctx.entityType ? `"${ctx.entityType}"类型` : ''}实体的上下文。有什么我可以帮助的？`,
      })
    }

    // 后台发送初始 prompt 给 Agent 获取上下文
    const backend = await _ensureBackend()
    if (!backend) {
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: 'AI 助手未就绪，请检查设置中的 AI 配置（供应商、模型、API Key）。',
      })
      return
    }
    loading.value = true
    try {
      await backend.prompt(prompt)
    } catch (err) {
      loading.value = false
      console.error('[SmartFillChat] 初始 prompt 失败:', err)
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: 'AI 助手启动失败，请重试或检查 AI 配置。',
      })
    }
  }

  function openFromSelection(sel: TextSelectionInfo) {
    open({
      entityType: sel.entityType,
      entityId: sel.entityId,
      selectedText: sel.text,
      fieldKey: sel.fieldKey,
    })
  }

  function close() {
    visible.value = false
    loading.value = false

    // 清理 Agent 对话历史
    if (_backend) {
      _backend.clearHistory()
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim()) return

    // 添加用户消息
    messages.value.push({
      id: _nextMsgId(),
      role: 'user',
      content: text,
    })

    loading.value = true

    const backend = await _ensureBackend()
    if (!backend) {
      loading.value = false
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: 'AI 助手未就绪，请检查设置中的 AI 配置。',
      })
      return
    }

    // 注入 /skill:smart-fill 前缀，确保后续对话轮次保持智能填充技能上下文
    const prompt = `/skill:smart-fill\n${text}`

    try {
      await backend.prompt(prompt)
    } catch (err) {
      loading.value = false
      console.error('[SmartFillChat] 发送消息失败:', err)
      messages.value.push({
        id: _nextMsgId(),
        role: 'assistant',
        content: '发送失败，请重试。',
      })
    }
  }

  /** 回写字段值到 EntityFormModal */
  function writeBack(fieldKey: string, value: string) {
    if (!fieldKey) return
    window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:write-back', {
      detail: { fieldKey, value },
    }))
  }

  // 清理
  onUnmounted(() => {
    if (_backend) {
      _backend.dispose()
      _backend = null
    }
  })

  return {
    visible: readonly(visible),
    context: readonly(context),
    loading: readonly(loading),
    messages: readonly(messages),
    a2uiSurfaceId: readonly(a2uiSurfaceId),
    open,
    openFromSelection,
    close,
    sendMessage,
    writeBack,
  }
}
