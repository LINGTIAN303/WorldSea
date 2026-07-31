<template>
  <Transition :name="embedded ? '' : 'ws-menu'">
    <div
      v-if="embedded || visible"
      :class="embedded ? 'agent-settings-embedded' : 'agent-settings agent-panel'"
      :style="embedded ? undefined : panelStyle"
      @mousedown.left="!embedded && onDragStart($event)"
    >
      <div v-if="!embedded" class="settings-drag-handle">
        <span class="menu-title"><WsIcon name="settings" size="sm" /> AI 助手设置</span>
        <button class="menu-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-sub-panels">
          <template v-if="embedded">
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'model' ? '' : 'model'"><WsIcon name="settings" size="xs" /> 核心</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'safety' ? '' : 'safety'"><WsIcon name="shield" size="xs" /> 安全</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'search' ? '' : 'search'"><WsIcon name="globe" size="xs" /> 搜索</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'vision' ? '' : 'vision'"><WsIcon name="eye" size="xs" /> 多模态</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'skills' ? '' : 'skills'"><WsIcon name="star" size="xs" /> Skills</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'mcp' ? '' : 'mcp'"><WsIcon name="link" size="xs" /> MCP</button>
            <button class="sub-panel-btn" :class="{ 'mode-tauri': isTauriMode, 'mode-web': !isTauriMode }" @click="settingsSubPanel = settingsSubPanel === 'terminal' ? '' : 'terminal'"><WsIcon name="keyboard" size="xs" /> 终端 <span class="mode-badge">{{ isTauriMode ? '桌面' : 'Web' }}</span></button>
          </template>
          <template v-else>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'model' ? '' : 'model'"><WsIcon name="settings" size="xs" /> 模型</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'provider' ? '' : 'provider'"><WsIcon name="link" size="xs" /> 供应商</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'safety' ? '' : 'safety'"><WsIcon name="shield" size="xs" /> 安全</button>
            <button v-if="!embedded" class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'usage' ? '' : 'usage'"><WsIcon name="dashboard" size="xs" /> 用量</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'search' ? '' : 'search'"><WsIcon name="globe" size="xs" /> 搜索</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'vision' ? '' : 'vision'"><WsIcon name="eye" size="xs" /> 多模态</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'skills' ? '' : 'skills'"><WsIcon name="star" size="xs" /> Skills</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'mcp' ? '' : 'mcp'"><WsIcon name="link" size="xs" /> MCP</button>
            <button class="sub-panel-btn" :class="{ 'mode-tauri': isTauriMode, 'mode-web': !isTauriMode }" @click="settingsSubPanel = settingsSubPanel === 'terminal' ? '' : 'terminal'"><WsIcon name="keyboard" size="xs" /> 终端 <span class="mode-badge">{{ isTauriMode ? '桌面' : 'Web' }}</span></button>
            <button v-if="!embedded" class="sub-panel-btn" @click="emit('reset-position')"><WsIcon name="outline" size="xs" /> 恢复位置</button>
          </template>
        </div>
        <Transition name="ws-slide-up" mode="out-in">
          <!-- 模型/核心面板（两种模式共用 ModelPanel，内部按 embedded 切换显示） -->
          <ModelPanel v-if="settingsSubPanel === 'model'" key="model"
            :embedded="embedded"
            :current-model-id="currentModelId"
            :temperature="temperature"
            :max-tokens="maxTokens"
            :context-length="contextLength"
            :max-context-length="maxContextLength"
            :max-output-tokens="maxOutputTokens"
            :max-temperature="maxTemperature"
            :persona-preset="personaPreset"
            :chat-mode="chatMode"
            :chat-modes="chatModes"
            :locked-chat-mode="lockedChatMode"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:temperature="emit('update:temperature', $event)"
            @update:max-tokens="emit('update:maxTokens', $event)"
            @update:context-length="emit('update:contextLength', $event)"
            @update:persona-preset="emit('update:personaPreset', $event)"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @chat-mode-change="(mode) => emit('chat-mode-change', mode)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 供应商面板（仅非 embedded） -->
          <ProviderPanel v-else-if="!embedded && settingsSubPanel === 'provider'" key="provider"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 安全面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'safety'" key="safety" class="sub-panel">
            <div class="settings-section">
              <div class="settings-row">
                <span class="settings-row-label">危险操作确认</span>
                <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
              </div>
              <div class="settings-hint">开启后 AI 删除实体/关系时需用户确认</div>
            </div>
          </div>
          <!-- 用量面板 -->
          <UsagePanel v-else-if="settingsSubPanel === 'usage'" key="usage"
            :total-usage="totalUsage"
            :calculated-cost="calculatedCost"
            :cumulative-usage="cumulativeUsage"
            :cache-hit-rate="cacheHitRate"
          />
          <!-- 搜索面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'search'" key="search" class="sub-panel">
            <div class="settings-row">
              <select :value="searchEngine" @change="onSearchEngineChange" class="settings-select">
                <option value="tavily">Tavily</option>
                <option value="serpapi">SerpAPI</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div class="settings-row" style="margin-top:6px">
              <input
                type="password"
                :value="searchApiKey"
                @input="onSearchApiKeyChange"
                placeholder="搜索 API Key"
                class="settings-input"
              />
            </div>
            <div class="settings-hint">web_search 需配置 Key；web_fetch（阅读网页）无需 Key，直接可用</div>
          </div>
          <!-- 多模态面板 -->
          <VisionPanel v-else-if="settingsSubPanel === 'vision'" key="vision" />
          <!-- Skills 面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'skills'" key="skills" class="sub-panel">
            <div class="skills-list">
              <div v-for="skill in skills" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled }">
                <span class="skill-icon"><WsIcon :name="skill.icon" size="sm" /></span>
                <div class="skill-info">
                  <span class="skill-name">{{ skill.name }}</span>
                  <span class="skill-desc">{{ skill.description }}</span>
                </div>
                <button class="skill-toggle" @click="emit('toggle-skill', skill.id)" :title="skill.enabled ? '点击禁用' : '点击启用'">
                  <WsIcon :name="skill.enabled ? 'check' : 'close'" size="xs" />
                </button>
              </div>
            </div>
            <SkillsStorePanel @skills-changed="emit('skills-changed')" />
          </div>
          <!-- MCP 面板 -->
          <McpPanel v-else-if="settingsSubPanel === 'mcp'" key="mcp"
            :mcp-connections="mcpConnections"
            @toggle-mcp="(serverId) => emit('toggle-mcp', serverId)"
            @add-mcp="(config) => emit('add-mcp', config)"
            @remove-mcp="(serverId) => emit('remove-mcp', serverId)"
          />
          <!-- 终端面板 -->
          <TerminalPanel v-else-if="settingsSubPanel === 'terminal'" key="terminal"
            @open-terminal="emit('open-terminal')"
          />
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { usePanelDrag } from './composables/usePanelDrag'
import { useSettingsStore } from '../stores/settingsStore'
import { loadApiKey, storeApiKey, removeApiKey } from '@agent/index'
import { isTauri as detectTauri } from '@agent/execution'
import SkillsStorePanel from './SkillsStorePanel.vue'
// 拆分出的子面板
import ModelPanel from './panels/ModelPanel.vue'
import ProviderPanel from './panels/ProviderPanel.vue'
import UsagePanel from './panels/UsagePanel.vue'
import VisionPanel from './panels/VisionPanel.vue'
import McpPanel from './panels/McpPanel.vue'
import TerminalPanel from './panels/TerminalPanel.vue'

const settingsStore = useSettingsStore()

// 运行模式（按钮栏 mode-badge 用）
const isTauriMode = computed(() => detectTauri())

// ── cloudApiKey / customApiKey 共享状态 ──
// 保留在父组件，因为 onMounted/watch 中有 storeApiKey/removeApiKey 副作用，
// 通过 v-model 传递给 ModelPanel 和 ProviderPanel
const cloudApiKey = ref('')
const customApiKey = ref('')
let skipCustomKeyEmit = false

const customKeyStoreId = computed(() => settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl))

onMounted(async () => {
  cloudApiKey.value = await loadApiKey(settingsStore.aiCloudProvider)
  skipCustomKeyEmit = true
  customApiKey.value = await loadApiKey(customKeyStoreId.value)
  await nextTick()
  skipCustomKeyEmit = false
})

watch(cloudApiKey, async (v) => {
  if (v) {
    await storeApiKey(settingsStore.aiCloudProvider, v)
  } else {
    await removeApiKey(settingsStore.aiCloudProvider)
  }
  emit('api-key-change', settingsStore.aiCloudProvider, v)
})

watch(customApiKey, async (v) => {
  if (v) {
    await storeApiKey(customKeyStoreId.value, v)
  } else {
    await removeApiKey(customKeyStoreId.value)
  }
  if (!skipCustomKeyEmit) {
    emit('api-key-change', 'custom', v)
  }
})
watch(() => settingsStore.aiCloudProvider, async (provider) => {
  cloudApiKey.value = await loadApiKey(provider)
})
watch(customKeyStoreId, async (newId, oldId) => {
  if (newId === oldId) return
  const currentKey = customApiKey.value
  if (currentKey && oldId) {
    await storeApiKey(oldId, currentKey)
  }
  skipCustomKeyEmit = true
  customApiKey.value = await loadApiKey(newId)
  await nextTick()
  skipCustomKeyEmit = false
})

// ── 自定义供应商模型拉取（网络请求保留在父组件） ──
const fetchedModels = ref<string[]>([])
const fetchingModels = ref(false)
const fetchError = ref('')

const canFetchModels = computed(() => {
  return settingsStore.aiCustomBaseUrl.trim() !== ''
    && settingsStore.aiCustomType === 'openai-compatible'
    && customApiKey.value.trim() !== ''
})

async function onFetchModels(): Promise<void> {
  const baseUrl = settingsStore.aiCustomBaseUrl.replace(/\/+$/, '')
  const apiKey = customApiKey.value
  if (!baseUrl || !apiKey) return

  fetchingModels.value = true
  fetchError.value = ''
  fetchedModels.value = []

  try {
    const isRemote = /^https?:\/\//.test(baseUrl)
    let modelsUrl: string
    const fetchHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` }

    if (isRemote) {
      try {
        const url = new URL(baseUrl)
        fetchHeaders['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
        let basePath = url.pathname.replace(/\/+$/, '')
        if (!basePath) basePath = '/v1'
        modelsUrl = `/api/custom-proxy${basePath}/models`
      } catch {
        fetchError.value = '无效的 Base URL'
        return
      }
    } else {
      modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    }

    const res = await fetch(modelsUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      fetchError.value = `拉取失败: HTTP ${res.status}`
      return
    }
    const data = await res.json()
    const models: string[] = (data.data || [])
      .map((m: any) => m.id)
      .filter((id: any) => typeof id === 'string')
      .sort((a: string, b: string) => a.localeCompare(b))
    if (models.length === 0) {
      fetchError.value = '未发现可用模型'
      return
    }
    fetchedModels.value = models
  } catch (e: any) {
    fetchError.value = e.name === 'TimeoutError' ? '拉取超时' : `拉取失败: ${e.message || e}`
  } finally {
    fetchingModels.value = false
  }
}

watch(() => [settingsStore.aiCustomBaseUrl, settingsStore.aiCustomType], () => {
  fetchedModels.value = []
  fetchError.value = ''
})

const props = withDefaults(defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
  currentProvider: string
  currentModelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  personaPreset: string
  thinkingLevel: string
  thinkingLevels: Array<{ value: string; label: string; desc: string }>
  chatMode: string
  chatModes: ReadonlyArray<{ value: string; icon: string; label: string; desc: string }>
  lockedChatMode: string | null
  totalUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  calculatedCost: { inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; total: number; savedByCache: number }
  cumulativeUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  cacheHitRate: number
  searchEngine: string
  searchApiKey: string
  skills: Array<{ id: string; icon: string; name: string; description: string; enabled: boolean }>
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
  embedded?: boolean
}>(), {
  embedded: false,
  lockedChatMode: null,
})

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
  'update:temperature': [value: number]
  'update:maxTokens': [value: number]
  'update:contextLength': [value: number]
  'update:personaPreset': [value: string]
  'model-change': [provider: string, modelId: string]
  'thinking-level-change': [level: string]
  'chat-mode-change': [mode: string]
  'search-engine-change': [engine: string]
  'search-apikey-change': [key: string]
  'toggle-skill': [skillId: string]
  'skills-changed': []
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
  'reset-position': []
  'open-terminal': []
  'api-key-change': [provider: string, apiKey: string]
  'provider-change': [provider: string, modelId: string]
}>()

// 当前展开的子面板
const settingsSubPanel = ref('')

// ── 面板拖拽（仅非 embedded 模式） ──
const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  excludeSelector: '.settings-body, .menu-close-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

// ── 搜索面板事件转发（短子面板内联） ──
function onSearchEngineChange(e: Event): void {
  emit('search-engine-change', (e.target as HTMLSelectElement).value)
}

function onSearchApiKeyChange(e: Event): void {
  emit('search-apikey-change', (e.target as HTMLInputElement).value)
}
</script>

<style>
.agent-settings {
  position: fixed;
  width: 280px;
  max-height: 80vh;
  background: var(--agent-bg);
  backdrop-filter: blur(var(--agent-blur));
  border: 1px solid var(--agent-border);
  border-radius: var(--agent-radius);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
}

.agent-settings-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.agent-settings-embedded .settings-body {
  max-height: none;
  flex: 1;
}

.settings-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border);
  cursor: grab;
  user-select: none;
}

.settings-drag-handle:active { cursor: grabbing }

.menu-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.menu-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.settings-body { padding: 12px 14px; overflow-y: auto; max-height: calc(80vh - 44px); }
.settings-section { margin-bottom: 14px }
.settings-section:last-child { margin-bottom: 0 }

.settings-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  margin-bottom: 6px;
  font-family: var(--agent-font);
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-row-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  white-space: nowrap;
  font-family: var(--agent-font);
}

.sp-row-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
  font-family: var(--agent-font);
}

.settings-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.settings-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.settings-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--agent-border-color);
  border-radius: 18px;
  transition: background 0.2s;
}

.settings-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 3px;
  top: 3px;
  background: var(--color-bg-surface);
  border-radius: 50%;
  transition: transform 0.2s;
}

.settings-toggle input:checked + .settings-toggle-slider {
  background: var(--agent-primary);
}

.settings-toggle input:checked + .settings-toggle-slider::before {
  transform: translateX(14px);
}

.settings-slider {
  flex: 1;
  accent-color: var(--agent-primary);
  height: 4px;
}

.settings-value {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  min-width: 48px;
  text-align: right;
  font-family: var(--agent-font);
}

.settings-select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: 6px;
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
  cursor: pointer;
}

.settings-select:focus { border-color: var(--agent-primary) }

.settings-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: 6px;
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
}

.settings-input:focus { border-color: var(--agent-primary) }
.settings-input::placeholder { color: var(--agent-text-tertiary) }

.settings-sub-panels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid var(--agent-border);
  margin-top: 4px;
}

.sub-panel-btn {
  padding: 4px 10px;
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  background: var(--agent-hover-bg);
  color: var(--agent-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-family: var(--agent-font);
}

.sub-panel-btn:hover {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  border-color: var(--agent-primary);
}

.sub-panel {
  padding: 8px 0;
  border-top: 1px solid var(--agent-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-slide-enter-active,
.sub-slide-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
  overflow: hidden;
}

.sub-slide-enter-from,
.sub-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.sub-slide-enter-to,
.sub-slide-leave-from {
  opacity: 1;
  max-height: 500px;
}

.settings-hint {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 4px;
  font-family: var(--agent-font);
}

.settings-key {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
  font-family: var(--agent-font);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--agent-hover-bg);
  border: 1px solid transparent;
  transition: border-color 0.15s, opacity 0.15s;
}

.skill-item.disabled {
  opacity: 0.5;
}

.skill-item:hover {
  border-color: var(--agent-border);
}

.skill-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}

.skill-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.skill-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.skill-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.skill-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px;
  flex-shrink: 0;
  transition: transform 0.1s;
}

.skill-toggle:hover {
  transform: scale(1.2);
}

.mcp-list { display: flex; flex-direction: column; gap: 6px; }
.mcp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: var(--agent-hover-bg); border: 1px solid transparent; transition: border-color 0.15s, opacity 0.15s; }
.mcp-item.disabled { opacity: 0.5; }
.mcp-item:hover { border-color: var(--agent-border); }
.mcp-status { font-size: var(--font-size-xs); flex-shrink: 0; }
.mcp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mcp-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.mcp-desc { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--agent-font); }
.mcp-add-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; border-top: 1px solid var(--agent-border); }
.mcp-add-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mcp-delete-btn { background: none; border: none; cursor: pointer; font-size: var(--font-size-xs); padding: 2px 4px; opacity: 0.4; transition: opacity 0.15s; }
.mcp-delete-btn:hover { opacity: 1; }
.mcp-presets { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--agent-border); }
.mcp-presets-title { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); margin-bottom: 6px; font-family: var(--agent-font); }
.mcp-presets-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.preset-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--agent-border); background: var(--agent-hover-bg); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; min-width: 90px; }
.preset-btn:hover:not(:disabled) { border-color: var(--agent-accent); background: color-mix(in srgb, var(--agent-primary) 8%, transparent); }
.preset-btn.added { opacity: 0.4; cursor: default; }
.preset-name { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.preset-desc { font-size: var(--text-micro-font-size); color: var(--agent-text-tertiary); font-family: var(--agent-font); }

.chat-mode-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}

.chat-mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--agent-border);
  background: var(--agent-hover-bg);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
  text-align: left;
  font-family: var(--agent-font);
  color: var(--agent-text);
}

.chat-mode-card:hover:not(.active) {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.chat-mode-card.active {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  box-shadow: 0 0 0 1px var(--agent-accent) inset;
}

.chat-mode-card.locked {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-mode-card.locked:hover:not(.active) {
  border-color: var(--agent-border);
  background: var(--agent-hover-bg);
}

.chat-mode-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.chat-mode-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.chat-mode-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
}

.chat-mode-card.active .chat-mode-label {
  color: var(--agent-accent);
}

.chat-mode-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  line-height: 1.3;
}

.usage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.usage-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  border-radius: 8px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.usage-value {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-primary);
  font-family: var(--agent-font-mono);
}

.usage-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  font-family: var(--agent-font);
  margin-top: 2px;
}

.usage-saved .usage-value {
  color: var(--agent-success, #22c55e);
}

.usage-section-title {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--agent-border);
}

.usage-cache-hit .usage-value {
  color: var(--agent-success, #22c55e);
}



.mode-badge {
  display: inline-block;
  font-size: var(--text-micro-font-size);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 4px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.mode-tauri .mode-badge {
  background: rgba(46, 204, 113, 0.2);
  color: #2ecc71;
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.mode-web .mode-badge {
  background: rgba(52, 152, 219, 0.2);
  color: #3498db;
  border: 1px solid rgba(52, 152, 219, 0.3);
}

.mode-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.mode-indicator.mode-tauri {
  background: rgba(46, 204, 113, 0.1);
  border: 1px solid rgba(46, 204, 113, 0.25);
  color: #2ecc71;
}

.mode-indicator.mode-web {
  background: rgba(52, 152, 219, 0.1);
  border: 1px solid rgba(52, 152, 219, 0.25);
  color: #3498db;
}

.terminal-mode-display {
  justify-content: center;
  padding: 4px 0;
}

.settings-btn-secondary {
  background: transparent;
  border: 1px solid var(--agent-border);
  color: var(--agent-text-secondary);
}

.settings-btn-secondary:hover {
  background: rgba(231, 76, 60, 0.1);
  border-color: rgba(231, 76, 60, 0.3);
  color: #e74c3c;
}

.cli-capabilities-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cli-cap-category {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.cli-cap-category-name {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cli-cap-tool-count {
  font-size: 11px;
  color: var(--agent-text-secondary);
  background: rgba(52, 152, 219, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

.settings-btn {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--agent-border);
  border-radius: 8px;
  background: var(--agent-hover-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.settings-btn:hover {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  border-color: var(--agent-primary);
}

.sp-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-bottom: 4px;
  font-family: var(--agent-font);
}

.cp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cp-item:hover {
  background: var(--agent-hover-bg);
}

.cp-item.active {
  background: var(--agent-accent-bg);
}

.cp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.cp-model {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-delete {
  background: none;
  border: none;
  color: var(--agent-text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0 2px;
}

.cp-item:hover .cp-delete {
  opacity: 1;
}

.cp-delete:hover {
  color: var(--danger, #e74c3c);
}

.cp-save-btn {
  width: 100%;
  padding: 6px;
  margin-top: 4px;
  border: 1px dashed var(--agent-border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text);
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: border-color 0.15s;
}

.cp-save-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-model-field {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.cp-model-field .settings-select,
.cp-model-field .settings-input {
  flex: 1;
  min-width: 0;
}

.cp-fetch-btn {
  background: none;
  border: 1px solid var(--agent-border-color);
  border-radius: var(--radius-sm);
  color: var(--agent-text);
  cursor: pointer;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}

.cp-fetch-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-fetch-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cp-fetch-error {
  font-size: var(--font-size-xs);
  color: var(--danger, #e74c3c);
  padding: 2px 0 0 0;
}

.provider-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  background: var(--agent-hover-bg);
  color: var(--agent-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-size: var(--font-size-2xs, 11px);
  white-space: nowrap;
}

.provider-list-item:hover {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
  background: var(--agent-accent-bg);
}

.provider-list-item.active {
  border-color: var(--agent-primary);
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  box-shadow: 0 0 0 1px var(--agent-primary) inset;
}

.provider-list-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.provider-list-label {
  line-height: 1;
}
</style>
