<template>
  <div class="space-agent-settings">
    <div class="panel-header">
      <h3 class="panel-title">Agent 设置</h3>
      <button class="panel-close-btn" @click="emit('close')" title="关闭">✕</button>
    </div>
    <div class="panel-body">
      <AgentSettingsPanel
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
        :chat-mode="activeChatMode"
        :chat-modes="CHAT_MODES"
        :locked-chat-mode="lockedChatMode"
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
        @chat-mode-change="onChatModeChange"
        @search-engine-change="onSearchEngineChange"
        @search-apikey-change="onSearchApiKeyChange"
        @toggle-skill="onToggleSkill"
        @toggle-mcp="onToggleMcp"
        @add-mcp="onAddMcp"
        @remove-mcp="onRemoveMcp"
        @open-terminal="openTerminal"
        @api-key-change="onApiKeyChange"
        @provider-change="onProviderChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useAgent } from '../../agent/composables/useAgent'
import type { ChatMode } from '../../agent/composables/useAgent'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSpaceStore } from '../stores/space-store'
import { useMcpConnections } from '../../agent/composables/useMcpConnections'
import { getAllSkills, toggleSkill, storeApiKey, loadApiKey, removeApiKey } from '@agent/index'
import { getModelInfo, calculateCost, getThinkingLevels } from '../../agent/modelRegistry'
import AgentSettingsPanel from '../../agent/AgentSettingsPanel.vue'
import type { ThinkingLevel, MCPConnectionConfig, SkillMeta } from '@agent/index'

const emit = defineEmits<{ close: [] }>()

const {
  totalUsage, cumulativeUsage, cacheHitRate,
  updateThinkingLevel, updateModel, refreshSearchConfig,
  openTerminal,
  activeChatMode, lockedChatMode, setChatMode,
} = useAgent()

const settingsStore = useSettingsStore()
const spaceStore = useSpaceStore()
const { connections: mcpConnections, addConnection, removeConnection, toggleConnection, ensureLoaded: ensureMcpLoaded } = useMcpConnections()

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

const CHAT_MODES = [
  { value: 'normal', icon: 'chat', label: '快问快答', desc: '快答为主，按需调用工具' },
  { value: 'deep', icon: 'brain', label: '深度思考', desc: '深度推理 + 工具验证 + 结构化推理链' },
  { value: 'explore', icon: 'search', label: '知识探索', desc: '知识库 → 联网搜索 → 项目数据 → 模型知识' },
  { value: 'task', icon: 'play', label: '任务执行', desc: '自主规划 + 连续执行 + 验证重试，动手把事做完' },
]

function onChatModeChange(mode: string): void {
  if (lockedChatMode.value !== null) return
  setChatMode(mode as ChatMode)
  spaceStore.setChatMode(mode as ChatMode)
}

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

watch([() => settingsStore.aiCloudModel, () => settingsStore.aiCloudProvider], async ([newModel, newProvider]) => {
  if (newModel === currentModelId.value && newProvider === currentProvider.value) return
  try { await onModelChange(newProvider, newModel) } catch {}
})

function onTemperatureChange(val: number) {
  temperature.value = val
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, val, maxTokens.value, contextLength.value)
  saveAgentSettings()
}

function onMaxTokensChange(val: number) {
  maxTokens.value = val
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, temperature.value, val, contextLength.value)
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
  const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(provider)
  let contextWindow = isCustom ? 1048576 : 128000
  let maxOut = isCustom ? 65536 : 8192
  if (info) {
    contextWindow = info.contextLength
    maxOut = info.maxOutputTokens
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
  await updateModel(provider, modelId, undefined, apiKey || undefined, temperature.value, maxTokens.value, contextWindow, maxOut)
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
  await refreshSearchConfig()
}

function onSearchApiKeyChange(key: string): void {
  searchApiKey.value = key
  saveSearchConfig()
}

async function onApiKeyChange(provider: string, apiKey: string): Promise<void> {
  if (provider === 'custom') {
    if (settingsStore.aiProviderMode === 'custom') {
      await updateModel(settingsStore.aiCustomType, settingsStore.aiCustomModel, settingsStore.aiCustomBaseUrl, apiKey || undefined, temperature.value, maxTokens.value, contextLength.value)
    }
  } else {
    if (settingsStore.aiProviderMode === 'cloud' && settingsStore.aiCloudProvider === provider) {
      await updateModel(provider, currentModelId.value, undefined, apiKey || undefined, temperature.value, maxTokens.value)
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
  } catch {}
}

async function onToggleMcp(serverId: string): Promise<void> {
  await toggleConnection(serverId)
}

async function onRemoveMcp(serverId: string): Promise<void> {
  await removeConnection(serverId)
}

async function saveSearchConfig(): Promise<void> {
  try {
    localStorage.setItem('agent_search_config', JSON.stringify({ engine: searchEngine.value }))
  } catch {}
  if (searchApiKey.value) {
    await storeApiKey('search_' + searchEngine.value, searchApiKey.value)
  } else {
    await removeApiKey('search_' + searchEngine.value)
  }
  await refreshSearchConfig()
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
      currentModelId.value = cfg.modelId || 'deepseek-chat'
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
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-left: 1px solid var(--color-border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
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
  border-radius: 4px;
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
  overflow-y: auto;
}
</style>
