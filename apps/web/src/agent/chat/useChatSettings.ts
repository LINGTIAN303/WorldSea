/** useChatSettings：Agent 聊天设置 state/回调/持久化（从 AgentChat 拆分，依赖注入解耦），详细见 docs/details/注释/web/agent/chat/useChatSettings.md */
import { ref, computed, type Ref } from 'vue'
import type { ThinkingLevel, SkillMeta, MCPConnectionConfig, MCPConnectionState } from '@agent/index'
import type { ChatMode } from '../composables/useAgent'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  getAllSkills, toggleSkill, storeApiKey, loadApiKey, removeApiKey,
} from '@agent/index'
import {
  getModelInfo, getThinkingLevels,
} from '@worldsmith/agent-runtime'
import { createDebouncedStorage } from '@worldsmith/perf-kit/io'

const agentStorage = createDebouncedStorage({ debounce: 100 })

/** 聊天模式定义（与原文件保持一致） */
export const CHAT_MODES = [
  { value: 'normal', icon: 'chat', label: '快问快答', desc: '快答为主，按需调用工具' },
  { value: 'deep', icon: 'brain', label: '深度思考', desc: '深度推理 + 工具验证 + 结构化推理链' },
  { value: 'explore', icon: 'search', label: '知识探索', desc: '知识库 → 联网搜索 → 项目数据 → 模型知识' },
  { value: 'task', icon: 'play', label: '任务执行', desc: '自主规划 + 连续执行 + 验证重试，动手把事做完' },
] as const

/** 供应商显示名（用于 API Key 缺失提示） */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google',
  deepseek: 'DeepSeek', groq: 'Groq', openrouter: 'OpenRouter',
  zhipu: '智谱', qwen: '通义千问', minimax: 'MiniMax', kimi: 'Kimi',
}

export interface UseChatSettingsOptions {
  /** useAgent.updateThinkingLevel */
  updateThinkingLevel: (level: ThinkingLevel) => void
  /** useAgent.updateModel（异步） */
  updateModel: (
    provider: string, modelId: string,
    baseUrl?: string, apiKey?: string,
    temperature?: number, maxTokens?: number,
    contextLength?: number, maxOutputTokens?: number,
  ) => Promise<void>
  /** useAgent.refreshSearchConfig（异步） */
  refreshSearchConfig: () => Promise<void>
  /** useAgent.activeChatMode（只读） */
  activeChatMode: Ref<ChatMode>
  /** useAgent.lockedChatMode（只读） */
  lockedChatMode: Ref<ChatMode | null>
  /** useAgent.setChatMode */
  setChatMode: (mode: ChatMode) => void
  /** useMcpConnections.connections（含 status/error 等运行态） */
  mcpConnections: Ref<MCPConnectionState[]>
  /** useMcpConnections.addConnection */
  addConnection: (config: MCPConnectionConfig) => Promise<void>
  /** useMcpConnections.removeConnection */
  removeConnection: (serverId: string) => Promise<void>
  /** useMcpConnections.toggleConnection */
  toggleConnection: (serverId: string) => Promise<void>
}

export function useChatSettings(options: UseChatSettingsOptions) {
  const {
    updateThinkingLevel, updateModel, refreshSearchConfig,
    lockedChatMode, setChatMode,
    mcpConnections, addConnection, removeConnection, toggleConnection,
  } = options

  const settingsStore = useSettingsStore()

  const currentProvider = ref(settingsStore.aiCloudProvider)
  const currentModelId = ref(settingsStore.aiCloudModel)

  const temperature = ref(70)
  const maxTokens = ref(8192)
  const contextLength = ref(128000)
  const personaPreset = ref('default')
  const thinkingLevel = ref<ThinkingLevel>('off')
  const searchEngine = ref('tavily')
  const searchApiKey = ref('')
  const skills = ref<SkillMeta[]>(getAllSkills())

  const THINKING_LEVELS = computed(() => getThinkingLevels(currentModelId.value))

  const maxOutputTokensForModel = computed(() => {
    const info = getModelInfo(currentModelId.value)
    if (info) return info.maxOutputTokens
    const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(currentProvider.value)
    return isCustom ? 65536 : 8192
  })

  const maxContextLengthForModel = computed(() => {
    const info = getModelInfo(currentModelId.value)
    if (info) return info.contextLength
    const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(currentProvider.value)
    return isCustom ? 1048576 : 128000
  })

  const maxTemperatureForModel = computed(() => {
    const provider = currentProvider.value
    return ['anthropic', 'zhipu', 'minimax'].includes(provider) ? 100 : 200
  })

  function onChatModeChange(mode: string): void {
    if (lockedChatMode.value !== null) return
    setChatMode(mode as ChatMode)
  }

  function onTemperatureChange(val: number): void {
    temperature.value = val
    updateModel(currentProvider.value, currentModelId.value, undefined, undefined, val, maxTokens.value, contextLength.value)
    saveAgentSettings()
  }

  function onMaxTokensChange(val: number): void {
    maxTokens.value = val
    updateModel(currentProvider.value, currentModelId.value, undefined, undefined, temperature.value, val, contextLength.value)
    saveAgentSettings()
  }

  function onPersonaChange(val: string): void {
    personaPreset.value = val
    saveAgentSettings()
  }

  async function onModelChange(provider: string, modelId: string): Promise<void> {
    const oldModelId = currentModelId.value
    currentProvider.value = provider
    currentModelId.value = modelId
    settingsStore.aiCloudProvider = provider as typeof settingsStore.aiCloudProvider
    settingsStore.aiCloudModel = modelId
    if (settingsStore.aiProviderMode !== 'cloud') {
      settingsStore.aiProviderMode = 'cloud'
    }
    const info = getModelInfo(modelId)
    const prevInfo = getModelInfo(oldModelId)
    const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(provider)
    let contextWindow = isCustom ? 1048576 : 128000
    let maxOut = isCustom ? 65536 : 8192
    if (info) {
      contextWindow = info.contextLength
      maxOut = info.maxOutputTokens
      // 如果当前 contextLength 等于旧模型上限（用户未手动调低），则跟随新模型上限
      const oldMax = prevInfo?.contextLength || 128000
      if (contextLength.value >= oldMax) {
        contextLength.value = info.contextLength
      } else {
        contextLength.value = Math.min(contextLength.value, info.contextLength)
      }
      const oldMaxOut = prevInfo?.maxOutputTokens || 8192
      if (maxTokens.value >= oldMaxOut) {
        maxTokens.value = info.maxOutputTokens
      } else {
        maxTokens.value = Math.min(maxTokens.value, info.maxOutputTokens)
      }
      const maxTemp = ['anthropic', 'zhipu', 'minimax'].includes(provider) ? 100 : 200
      temperature.value = Math.min(temperature.value, maxTemp)
      const validLevels = getThinkingLevels(modelId)
      if (!validLevels.some(l => l.value === thinkingLevel.value)) {
        thinkingLevel.value = 'off'
        updateThinkingLevel('off')
        try { agentStorage.set('agent_thinking_level', 'off') } catch {}
      }
    }
    const apiKey = await loadApiKey(provider)
    if (!apiKey) {
      const { toastWarn } = await import('../../composables/useToast')
      toastWarn(`${PROVIDER_NAMES[provider] || provider} 尚未配置 API Key，请在供应商面板中填入`)
    }
    await updateModel(provider, modelId, undefined, apiKey || undefined, temperature.value, maxTokens.value, contextWindow, maxOut)
    try {
      agentStorage.set('agent_current_model', { provider, modelId, contextLength: contextLength.value })
    } catch {}
    saveAgentSettings()
  }

  function onThinkingLevelChange(level: string): void {
    thinkingLevel.value = level as ThinkingLevel
    updateThinkingLevel(level as ThinkingLevel)
    try {
      agentStorage.set('agent_thinking_level', level)
    } catch {}
  }

  async function onSearchEngineChange(engine: string): Promise<void> {
    const oldEngine = searchEngine.value

    if (searchApiKey.value) {
      await storeApiKey('search_' + oldEngine, searchApiKey.value)
    } else {
      await removeApiKey('search_' + oldEngine)
    }

    searchEngine.value = engine

    const newKey = await loadApiKey('search_' + engine)
    searchApiKey.value = newKey || ''

    try {
      agentStorage.set('agent_search_config', { engine })
    } catch {}

    await refreshSearchConfig()
  }

  function onSearchApiKeyChange(key: string): void {
    searchApiKey.value = key
    saveSearchConfig()
  }

  async function onApiKeyChange(provider: string, apiKey: string): Promise<void> {
    if (provider === 'custom') {
      if (settingsStore.aiProviderMode === 'custom') {
        await updateModel(
          settingsStore.aiCustomType,
          settingsStore.aiCustomModel,
          settingsStore.aiCustomBaseUrl,
          apiKey || undefined,
          temperature.value,
          maxTokens.value,
          contextLength.value,
        )
      }
    } else {
      if (settingsStore.aiProviderMode === 'cloud' && settingsStore.aiCloudProvider === provider) {
        await updateModel(
          provider,
          currentModelId.value,
          undefined,
          apiKey || undefined,
          temperature.value,
          maxTokens.value,
        )
      }
    }
  }

  async function onProviderChange(provider: string, modelId: string): Promise<void> {
    await onModelChange(provider, modelId)
  }

  function onToggleSkill(skillId: string): void {
    toggleSkill(skillId)
    skills.value = getAllSkills()
  }

  /** 技能商城安装/卸载后刷新技能列表 */
  function onSkillsChanged(): void {
    skills.value = getAllSkills()
  }

  async function onAddMcp(config: MCPConnectionConfig): Promise<void> {
    try {
      await addConnection(config)
      const conn = mcpConnections.value.find(c => c.id === config.id)
      if (conn?.status === 'error') {
        const { toastWarn } = await import('../../composables/useToast')
        toastWarn(`MCP 连接失败: ${conn.error || '未知错误'}`)
      }
    } catch (err) {
      const { toastWarn } = await import('../../composables/useToast')
      toastWarn(`MCP 添加失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function onToggleMcp(serverId: string): Promise<void> {
    await toggleConnection(serverId)
  }

  async function onRemoveMcp(serverId: string): Promise<void> {
    await removeConnection(serverId)
  }

  async function saveSearchConfig(): Promise<void> {
    try {
      agentStorage.set('agent_search_config', {
        engine: searchEngine.value,
      })
    } catch {}
    if (searchApiKey.value) {
      await storeApiKey('search_' + searchEngine.value, searchApiKey.value)
    } else {
      await removeApiKey('search_' + searchEngine.value)
    }
    await refreshSearchConfig()
  }

  async function loadSearchConfig(): Promise<void> {
    try {
      const raw = localStorage.getItem('agent_search_config')
      if (raw) {
        const cfg = JSON.parse(raw)
        searchEngine.value = cfg.engine || 'tavily'
      }
      const key = await loadApiKey('search_' + searchEngine.value)
      searchApiKey.value = key || ''
    } catch {}
  }

  function loadThinkingLevel(): void {
    try {
      const saved = localStorage.getItem('agent_thinking_level') as ThinkingLevel | null
      if (saved && getThinkingLevels(currentModelId.value).some(l => l.value === saved)) {
        thinkingLevel.value = saved
        updateThinkingLevel(saved)
      }
    } catch {}
  }

  function saveAgentSettings(): void {
    try {
      agentStorage.set('agent_settings', {
        temperature: temperature.value,
        maxTokens: maxTokens.value,
        contextLength: contextLength.value,
        personaPreset: personaPreset.value,
      })
    } catch {}
  }

  function loadAgentSettings(): void {
    try {
      const raw = localStorage.getItem('agent_settings')
      if (raw) {
        const s = JSON.parse(raw)
        if (s.temperature !== undefined) temperature.value = s.temperature
        if (s.maxTokens !== undefined) maxTokens.value = s.maxTokens
        if (s.contextLength !== undefined) contextLength.value = s.contextLength
        if (s.personaPreset !== undefined) personaPreset.value = s.personaPreset
      }
    } catch {}
  }

  async function loadCurrentModel(): Promise<void> {
    try {
      const raw = localStorage.getItem('agent_current_model')
      if (raw) {
        const cfg = JSON.parse(raw)
        currentProvider.value = cfg.provider || 'deepseek'
        currentModelId.value = cfg.modelId || 'deepseek-chat'
        if (cfg.contextLength) contextLength.value = cfg.contextLength
      }
      const info = getModelInfo(currentModelId.value)
      if (info && !localStorage.getItem('agent_current_model')) {
        contextLength.value = info.contextLength
      }
    } catch {}
  }

  return {
    currentProvider, currentModelId,
    temperature, maxTokens, contextLength, personaPreset, thinkingLevel,
    searchEngine, searchApiKey, skills,
    THINKING_LEVELS, CHAT_MODES,
    maxOutputTokensForModel, maxContextLengthForModel, maxTemperatureForModel,
    onChatModeChange,
    onTemperatureChange, onMaxTokensChange, onPersonaChange,
    onModelChange, onThinkingLevelChange,
    onSearchEngineChange, onSearchApiKeyChange, onApiKeyChange, onProviderChange,
    onToggleSkill, onSkillsChanged,
    onAddMcp, onToggleMcp, onRemoveMcp,
    saveSearchConfig, loadSearchConfig,
    loadThinkingLevel, saveAgentSettings, loadAgentSettings, loadCurrentModel,
  }
}

export type UseChatSettingsReturn = ReturnType<typeof useChatSettings>
