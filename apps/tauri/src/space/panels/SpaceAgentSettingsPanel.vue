<template>
  <div class="space-agent-settings">
    <div class="panel-header">
      <h3 class="panel-title">Agent 设置</h3>
      <button class="panel-close-btn" @click="emit('close')" title="关闭"><WsIcon name="close" size="sm" /></button>
    </div>
    <div class="panel-body">
      <AgentSettingsPanel
        ref="agentSettingsRef"
        :visible="true"
        :position="{ x: 0, y: 0 }"
        :dragged="false"
        :current-provider="currentProvider"
        :current-model-id="currentModelId"
        :temperature="temperature"
        :max-tokens="maxTokens"
        :context-length="contextLength"
        :max-context-length="maxContextLengthForModel"
        :max-output-tokens="maxOutputTokensForModel"
        :max-temperature="maxTemperatureForModel"
        :persona-preset="personaPreset"
        :thinking-level="thinkingLevel"
        :thinking-levels="THINKING_LEVELS"
        :total-usage="totalUsage"
        :calculated-cost="calculatedCost"
        :cumulative-usage="cumulativeUsage"
        :cache-hit-rate="cacheHitRate"
        :search-engine="searchEngine"
        :search-api-key="searchApiKey"
        :skills="skills"
        :mcp-connections="mcpConnectionsList"
        embedded
        @close="emit('close')"
        @update:temperature="onTemperatureChange"
        @update:max-tokens="onMaxTokensChange"
        @update:context-length="(v: number) => { contextLength = v; saveAgentSettings() }"
        @update:persona-preset="onPersonaChange"
        @model-change="onModelChange"
        @thinking-level-change="onThinkingLevelChange"
        @search-engine-change="onSearchEngineChange"
        @search-apikey-change="onSearchApiKeyChange"
        @toggle-skill="onToggleSkill"
        @toggle-mcp="onToggleMcp"
        @add-mcp="onAddMcp"
        @remove-mcp="onRemoveMcp"
        @open-terminal="openTerminal"
        @api-key-change="onApiKeyChange"
        @provider-change="onProviderChange"
        @security-level-change="onSecurityLevelChange"
        @card-change="(i) => emit('card-change', i)"
      />
      <!-- H5 八文件体系（2026-08-30 拍板）：规则卡片面板——八文件统一编辑入口（WORLDSMITH 只读/MEMORY 说明卡） -->
      <RulesPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useAgent } from '@/agent/composables/useAgent'
import { useSettingsStore } from '@/stores/settingsStore'
import { useMcpConnections } from '@worldsmith/shared-composables/agent/useMcpConnections'
import { toastError } from '@/composables/useToast'
import { getAllSkills, toggleSkill, storeApiKey, loadApiKey, removeApiKey } from '@agent/index'
import { getModelInfo, calculateCost, getThinkingLevels } from '@worldsmith/agent-runtime'
import AgentSettingsPanel from '@/agent/AgentSettingsPanel.vue'
import RulesPanel from './RulesPanel.vue'
import type { ThinkingLevel, MCPConnectionConfig, SkillMeta } from '@agent/index'

const emit = defineEmits<{ close: []; 'card-change': [index: number] }>()

// 透传叠放翻卡：供主设置左列标题点击翻卡（SettingsDialog 调用）
const agentSettingsRef = ref<InstanceType<typeof AgentSettingsPanel> | null>(null)
defineExpose({
  goToCard: (i: number) => agentSettingsRef.value?.goToCard(i),
})

// Tauri 端 useAgent = useAgentRust（Rust Agent 后端适配器）
const {
  totalUsage,
  updateThinkingLevel,
  updateModel,
  setSecurityLevel,
} = useAgent()

const settingsStore = useSettingsStore()
// 注入 useAgentRust（提供 getMCPConnections/addMCPConnection/removeMCPConnection 本地管理）
const { connections: mcpConnections, addConnection, removeConnection, toggleConnection, ensureLoaded: ensureMcpLoaded } = useMcpConnections({ getAgent: () => useAgent() })

const mcpConnectionsList = computed(() => mcpConnections.value)

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

// 三模式移除（2026-08-31）：无模式选择器，普通会话统一 normal；group-chat 由会话类型承载
// Tauri 端聊天模式按会话隔离（viewState 权威）；Rust 端无锁定概念，lockedChatMode 恒为 null

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

const calculatedCost = computed(() => {
  return calculateCost(
    currentModelId.value,
    totalUsage.value.inputTokens,
    totalUsage.value.outputTokens,
    totalUsage.value.cacheReadTokens,
    totalUsage.value.cacheWriteTokens,
  )
})

// Tauri 端累计用量即 totalUsage（Rust send_message 携带会话累计值）；缓存命中率暂无后端数据
const cumulativeUsage = computed(() => totalUsage.value)
const cacheHitRate = computed(() => 0)

watch([() => settingsStore.aiCloudModel, () => settingsStore.aiCloudProvider], async ([newModel, newProvider]) => {
  if (newModel === currentModelId.value && newProvider === currentProvider.value) return
  try { await onModelChange(newProvider, newModel) } catch {}
})

// Rust updateModel 签名：(provider, modelId, baseUrl?, apiKey?, contextWindow?, maxTokens?, temperature?, topP?, topK?, thinkingMode?)
/** 读取当前模型挂载的会话窗口参数（localStorage：`agent_session_window` + 模型级 `agent_model_params_<modelId>`） */
function loadSessionWindow(modelId: string): { topP?: number; topK?: number; thinking?: boolean } {
  try {
    const w = JSON.parse(localStorage.getItem('agent_session_window') || '{}')
    const m = JSON.parse(localStorage.getItem(`agent_model_params_${modelId}`) || '{}')
    const src = { ...w, ...m }
    return {
      topP: src.topP != null ? src.topP : 100,
      topK: src.topK != null ? src.topK : 40,
      thinking: src.thinking ?? false,
    }
  } catch {
    return { topP: 100, topK: 40, thinking: false }
  }
}

function onTemperatureChange(val: number) {
  temperature.value = val
  const sw = loadSessionWindow(currentModelId.value)
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, contextLength.value, maxTokens.value, val, sw.topP, sw.topK, sw.thinking)
  saveAgentSettings()
}

function onMaxTokensChange(val: number) {
  maxTokens.value = val
  const sw = loadSessionWindow(currentModelId.value)
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, contextLength.value, val, temperature.value, sw.topP, sw.topK, sw.thinking)
  saveAgentSettings()
}

function onPersonaChange(val: string) { personaPreset.value = val; saveAgentSettings() }

async function onModelChange(provider: string, modelId: string): Promise<void> {
  const oldModelId = currentModelId.value
  currentProvider.value = provider
  currentModelId.value = modelId
  settingsStore.aiCloudProvider = provider as any
  settingsStore.aiCloudModel = modelId
  if (settingsStore.aiProviderMode !== 'cloud') {
    settingsStore.aiProviderMode = 'cloud'
  }
  const info = getModelInfo(modelId)
  const prevInfo = getModelInfo(oldModelId)
  if (info) {
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
      try { localStorage.setItem('agent_thinking_level', 'off') } catch {}
    }
  }
  const apiKey = await loadApiKey(provider)
  const sw = loadSessionWindow(modelId)
  await updateModel(provider, modelId, undefined, apiKey || undefined, contextLength.value, maxTokens.value, temperature.value, sw.topP, sw.topK, sw.thinking)
  try {
    localStorage.setItem('agent_current_model', JSON.stringify({ provider, modelId, contextLength: contextLength.value }))
  } catch {}
  saveAgentSettings()
}

function onThinkingLevelChange(level: string): void {
  thinkingLevel.value = level as ThinkingLevel
  updateThinkingLevel(level as ThinkingLevel)
  try { localStorage.setItem('agent_thinking_level', level) } catch {}
}

// A7：切换工具安全级别 → 调用 Rust 后端（setSecurityLevel），对当前会话运行时生效
function onSecurityLevelChange(level: string): void {
  setSecurityLevel(level).catch((err: unknown) => {
    console.warn('[SpaceAgentSettings] 设置安全级别失败:', err)
  })
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
  try { localStorage.setItem('agent_search_config', JSON.stringify({ engine })) } catch {}
}

function onSearchApiKeyChange(key: string): void {
  searchApiKey.value = key
  saveSearchConfig()
}

async function onApiKeyChange(provider: string, apiKey: string): Promise<void> {
  if (provider === 'custom') {
    if (settingsStore.aiProviderMode === 'custom') {
      await updateModel(settingsStore.aiCustomType, settingsStore.aiCustomModel, settingsStore.aiCustomBaseUrl, apiKey || undefined, contextLength.value, maxTokens.value, temperature.value)
    }
  } else {
    if (settingsStore.aiProviderMode === 'cloud' && settingsStore.aiCloudProvider === provider) {
      await updateModel(provider, currentModelId.value, undefined, apiKey || undefined, contextLength.value, maxTokens.value, temperature.value)
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

async function onAddMcp(config: MCPConnectionConfig): Promise<void> {
  try {
    await addConnection(config)
  } catch (err) {
    // 激活失败必须可见（此前空 catch 吞错，预设点了没反应无法排查）
    const msg = err instanceof Error ? err.message : String(err)
    toastError(`MCP「${config.name}」激活失败：${msg}`)
    console.error('[MCP] 激活连接失败:', config.name, err)
  }
}

async function onToggleMcp(serverId: string): Promise<void> {
  await toggleConnection(serverId)
}

async function onRemoveMcp(serverId: string): Promise<void> {
  await removeConnection(serverId)
}

/** 终端面板内嵌 Tauri 原生终端（TerminalView），无需额外打开外部终端 */
function openTerminal(): void {}

async function saveSearchConfig(): Promise<void> {
  try {
    localStorage.setItem('agent_search_config', JSON.stringify({ engine: searchEngine.value }))
  } catch {}
  if (searchApiKey.value) {
    await storeApiKey('search_' + searchEngine.value, searchApiKey.value)
  } else {
    await removeApiKey('search_' + searchEngine.value)
  }
}

function saveAgentSettings(): void {
  try {
    localStorage.setItem('agent_settings', JSON.stringify({
      temperature: temperature.value,
      maxTokens: maxTokens.value,
      contextLength: contextLength.value,
      personaPreset: personaPreset.value,
    }))
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

async function loadCurrentModel(): Promise<void> {
  try {
    const raw = localStorage.getItem('agent_current_model')
    if (raw) {
      const cfg = JSON.parse(raw)
      currentProvider.value = cfg.provider || 'deepseek'
      currentModelId.value = cfg.modelId || 'deepseek-v4-flash'
      if (cfg.contextLength) contextLength.value = cfg.contextLength
    }
  } catch {}
}

onMounted(async () => {
  await loadCurrentModel()
  await loadSearchConfig()
  loadThinkingLevel()
  loadAgentSettings()
  await ensureMcpLoaded()
})
</script>

<style scoped>
.space-agent-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface-elevated);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  margin: 0;
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel-close-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.panel-body {
  flex: 1;
  /* 叠放翻卡：滚动由 AgentSettingsPanel 卡片内部接管，外层不再整体滚动 */
  overflow: hidden;
}
</style>
