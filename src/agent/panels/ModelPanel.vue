<template>
  <div class="sub-panel">
    <template v-if="embedded">
      <div class="settings-row">
        <span class="sp-row-label">供应商模式</span>
        <select v-model="settingsStore.aiProviderMode" class="settings-select" aria-label="供应商模式">
          <option value="cloud">云端 API</option>
          <option value="local">本地模型</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <template v-if="settingsStore.aiProviderMode === 'cloud'">
        <div class="settings-row">
          <span class="sp-row-label">供应商</span>
          <div class="provider-list">
            <button v-for="p in cloudProviderOptions" :key="p.value"
              class="provider-list-item" :class="{ active: settingsStore.aiCloudProvider === p.value }"
              @click="onCloudProviderChange({ target: { value: p.value } } as any)"
              :title="p.label"
            >
              <img :src="p.iconUrl" class="provider-list-icon" alt="" />
              <span class="provider-list-label">{{ p.label }}</span>
            </button>
          </div>
        </div>
        <div class="settings-row">
          <span class="sp-row-label">模型</span>
          <template v-if="currentProviderModels.length > 0">
            <select :value="settingsStore.aiCloudModel" @change="onCloudModelChange" class="settings-select">
              <option v-for="m in currentProviderModels" :key="m.id" :value="m.id">{{ m.name }}{{ getModelInfo(m.id)?.supportsVision ? ' (视觉)' : '' }}</option>
            </select>
          </template>
          <template v-else>
            <input type="text" class="settings-input" v-model="settingsStore.aiCloudModel" placeholder="模型 ID" />
          </template>
        </div>
        <div class="settings-row">
          <span class="sp-row-label">API Key</span>
          <input type="password" class="settings-input" v-model="cloudApiKeyLocal" placeholder="sk-..." />
        </div>
      </template>
      <template v-if="settingsStore.aiProviderMode === 'local'">
        <div class="settings-row">
          <span class="sp-row-label">端点 URL</span>
          <input type="text" class="settings-input" v-model="settingsStore.aiLocalEndpoint" placeholder="http://localhost:11434" />
        </div>
        <div class="settings-row">
          <span class="sp-row-label">API 类型</span>
          <select v-model="settingsStore.aiLocalType" class="settings-select" aria-label="API 类型">
            <option value="ollama">Ollama</option>
            <option value="lm-studio">LM Studio</option>
            <option value="vllm">vLLM</option>
            <option value="llama-cpp">llama.cpp</option>
          </select>
        </div>
        <div class="settings-row">
          <span class="sp-row-label">模型 ID</span>
          <input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" />
        </div>
      </template>
      <template v-if="settingsStore.aiProviderMode === 'custom'">
        <div v-if="settingsStore.customProviders.length > 0" class="settings-section">
          <div class="sp-section-label">已配置的自定义供应商</div>
          <div
            v-for="cp in settingsStore.customProviders"
            :key="cp.id"
            class="cp-item"
            :class="{ active: isCustomProviderActive(cp) }"
            @click="onSelectCustomProvider(cp)"
          >
            <span class="cp-name">{{ cp.name || cp.baseUrl }}</span>
            <span class="cp-model">{{ cp.modelId }}</span>
            <button class="cp-delete" @click.stop="onDeleteCustomProvider(cp.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
          </div>
        </div>
        <div class="settings-row">
          <span class="sp-row-label">Base URL</span>
          <input type="text" class="settings-input" v-model="settingsStore.aiCustomBaseUrl" placeholder="https://api.example.com/v1" />
        </div>
        <div class="settings-row">
          <span class="sp-row-label">API 类型</span>
          <select v-model="settingsStore.aiCustomType" class="settings-select" aria-label="API 类型">
            <option value="openai-compatible">OpenAI 兼容</option>
            <option value="anthropic-compatible">Anthropic 兼容</option>
          </select>
        </div>
        <div class="settings-row">
          <span class="sp-row-label">模型 ID</span>
          <div class="cp-model-field">
            <select v-if="fetchedModels.length > 0" v-model="settingsStore.aiCustomModel" class="settings-select">
              <option value="" disabled>选择模型</option>
              <option v-for="m in fetchedModels" :key="m" :value="m">{{ m }}</option>
            </select>
            <input v-else type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" />
            <button class="cp-fetch-btn" @click="emit('fetch-models')" :disabled="!canFetchModels || fetchingModels" :title="fetchError || '拉取模型列表'">
              <WsIcon :name="fetchingModels ? 'loading' : 'refresh'" size="xs" />
            </button>
          </div>
        </div>
        <div v-if="fetchError" class="cp-fetch-error">{{ fetchError }}</div>
        <div class="settings-row">
          <span class="sp-row-label">API Key</span>
          <input type="password" class="settings-input" v-model="customApiKeyLocal" placeholder="sk-..." />
        </div>
        <button class="cp-save-btn" @click="onSaveCustomProvider" :disabled="!settingsStore.aiCustomBaseUrl">保存当前配置</button>
      </template>
      <div class="settings-hint">供应商配置影响 AI 助手的后端连接，切换后下次对话生效</div>
      <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
    </template>
    <div v-if="!embedded" class="settings-section">
      <div class="settings-label">模型切换</div>
      <template v-if="settingsStore.aiProviderMode === 'cloud'">
        <div class="settings-row">
          <template v-if="currentProviderModels.length > 0">
            <select :value="currentModelId" @change="onModelSelectChange" class="settings-select" aria-label="模型切换">
              <option v-for="m in currentProviderModels" :key="m.id" :value="m.id">{{ m.name }}{{ getModelInfo(m.id)?.supportsVision ? ' (视觉)' : '' }}</option>
            </select>
          </template>
          <template v-else>
            <input type="text" class="settings-input" :value="currentModelId" @change="onModelSelectChange" placeholder="模型 ID" />
          </template>
        </div>
        <div class="settings-hint">当前供应商: {{ currentProviderLabel }}，切换供应商请前往供应商面板</div>
      </template>
      <template v-else-if="settingsStore.aiProviderMode === 'local'">
        <div class="settings-row">
          <input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" />
        </div>
        <div class="settings-hint">本地模型通过供应商面板配置端点，此处填写模型 ID</div>
      </template>
      <template v-else>
        <div class="settings-row">
          <input type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" />
        </div>
        <div class="settings-hint">自定义模型通过供应商面板配置 Base URL，此处填写模型 ID</div>
      </template>
    </div>
    <div class="settings-section">
      <div class="settings-label">温度 (Temperature)</div>
      <div class="settings-row">
        <input type="range" min="0" :max="maxTemperature" :value="temperature" @input="onTemperatureChange" class="settings-slider" />
        <span class="settings-value">{{ (temperature / 100).toFixed(2) }}</span>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">最大输出 (Max Tokens)</div>
      <div class="settings-row">
        <input type="range" min="1024" :max="maxOutputTokens" step="1024" :value="maxTokens" @input="onMaxTokensChange" class="settings-slider" />
        <span class="settings-value">{{ maxTokens }}</span>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">上下文长度</div>
      <div class="settings-row">
        <input type="range" min="4096" :max="maxContextLength" step="1024" :value="contextLength" @input="onContextLengthChange" class="settings-slider" />
        <span class="settings-value">{{ formatTokens(contextLength) }}</span>
      </div>
      <div class="settings-hint">最大 {{ formatTokens(maxContextLength) }}</div>
    </div>
    <div class="settings-section">
      <div class="settings-label">AI 人格预设</div>
      <div class="settings-row">
        <select :value="personaPreset" @change="onPersonaChange" class="settings-select">
          <option value="default">默认助手</option>
          <option value="creative">创意写手</option>
          <option value="analyst">严谨分析师</option>
          <option value="storyteller">故事叙述者</option>
        </select>
      </div>
    </div>
    <div v-if="!embedded" class="settings-section">
      <div class="settings-label">回答模式</div>
      <div class="chat-mode-grid">
        <button
          v-for="m in chatModes"
          :key="m.value"
          type="button"
          class="chat-mode-card"
          :class="{ active: chatMode === m.value, locked: lockedChatMode !== null }"
          :disabled="lockedChatMode !== null"
          @click="onChatModeClick(m.value)"
        >
          <span class="chat-mode-icon"><WsIcon :name="m.icon" size="sm" /></span>
          <span class="chat-mode-text">
            <span class="chat-mode-label">{{ m.label }}</span>
            <span class="chat-mode-desc">{{ m.desc }}</span>
          </span>
        </button>
      </div>
      <div v-if="lockedChatMode !== null" class="settings-hint"><WsIcon name="lock" size="xs" /> 当前会话已锁定为「{{ chatModes?.find(m => m.value === lockedChatMode)?.label || lockedChatMode }}」模式，新建会话后可切换</div>
      <div v-else class="settings-hint">每次发送消息时使用的回答模式，与顶栏下拉框一致</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getDefaultModelId, getModelInfo, getModelsByProvider, getAllProviderManifests, getProviderLabelMap } from '@worldsmith/agent-runtime'
import { getProviderIconUrl } from '../../assets/providerIcons'

const props = defineProps<{
  embedded: boolean
  currentModelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  personaPreset: string
  chatMode: string
  chatModes: Array<{ value: string; icon: string; label: string; desc: string }>
  lockedChatMode: string | null
  cloudApiKey: string
  customApiKey: string
  fetchedModels: string[]
  fetchingModels: boolean
  fetchError: string
  canFetchModels: boolean
}>()

const emit = defineEmits<{
  'update:temperature': [value: number]
  'update:maxTokens': [value: number]
  'update:contextLength': [value: number]
  'update:personaPreset': [value: string]
  'update:cloudApiKey': [value: string]
  'update:customApiKey': [value: string]
  'model-change': [provider: string, modelId: string]
  'chat-mode-change': [mode: string]
  'provider-change': [provider: string, modelId: string]
  'fetch-models': []
}>()

const settingsStore = useSettingsStore()

// 通过 computed 写入器实现 v-model 双向绑定到父组件的 ref
const cloudApiKeyLocal = computed({
  get: () => props.cloudApiKey,
  set: (v) => emit('update:cloudApiKey', v),
})
const customApiKeyLocal = computed({
  get: () => props.customApiKey,
  set: (v) => emit('update:customApiKey', v),
})

const currentProviderModels = computed(() => getModelsByProvider(settingsStore.aiCloudProvider))

const cloudProviderOptions = computed(() =>
  getAllProviderManifests().map(m => ({
    value: m.id,
    label: m.label,
    iconUrl: getProviderIconUrl(m.id),
  }))
)

const currentProviderLabel = computed(() => {
  const labels = getProviderLabelMap()
  return labels[settingsStore.aiCloudProvider] || settingsStore.aiCloudProvider
})

function onCloudProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  settingsStore.aiCloudProvider = provider
  const defaultModelId = getDefaultModelId(provider)
  if (defaultModelId) {
    settingsStore.aiCloudModel = defaultModelId
    emit('provider-change', provider, defaultModelId)
  }
}

function onCloudModelChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  settingsStore.aiCloudModel = modelId
  emit('model-change', settingsStore.aiCloudProvider, modelId)
}

function onModelSelectChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  emit('model-change', settingsStore.aiCloudProvider, modelId)
}

function onTemperatureChange(e: Event): void {
  emit('update:temperature', Number((e.target as HTMLInputElement).value))
}

function onMaxTokensChange(e: Event): void {
  emit('update:maxTokens', Number((e.target as HTMLInputElement).value))
}

function onContextLengthChange(e: Event): void {
  emit('update:contextLength', Number((e.target as HTMLInputElement).value))
}

function onPersonaChange(e: Event): void {
  emit('update:personaPreset', (e.target as HTMLSelectElement).value)
}

function onChatModeClick(mode: string): void {
  emit('chat-mode-change', mode)
}

function isCustomProviderActive(cp: { baseUrl: string; apiType: string; modelId: string }): boolean {
  return cp.baseUrl === settingsStore.aiCustomBaseUrl
    && cp.apiType === settingsStore.aiCustomType
    && cp.modelId === settingsStore.aiCustomModel
}

async function onSelectCustomProvider(cp: { baseUrl: string; apiType: string; modelId: string }): Promise<void> {
  settingsStore.aiCustomBaseUrl = cp.baseUrl
  settingsStore.aiCustomType = cp.apiType
  settingsStore.aiCustomModel = cp.modelId
  emit('provider-change', cp.apiType, cp.modelId)
}

function onDeleteCustomProvider(id: string): void {
  settingsStore.removeCustomProvider(id)
}

async function onSaveCustomProvider(): Promise<void> {
  const baseUrl = settingsStore.aiCustomBaseUrl
  if (!baseUrl) return
  const existing = settingsStore.customProviders.find(
    cp => cp.baseUrl === baseUrl && cp.apiType === settingsStore.aiCustomType
  )
  if (existing) {
    existing.modelId = settingsStore.aiCustomModel
    existing.name = deriveCustomProviderName(baseUrl)
  } else {
    settingsStore.addCustomProvider({
      name: deriveCustomProviderName(baseUrl),
      baseUrl,
      apiType: settingsStore.aiCustomType,
      modelId: settingsStore.aiCustomModel,
    })
  }
}

function deriveCustomProviderName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.hostname.replace(/^(api\.|www\.)/, '')
  } catch {
    return baseUrl
  }
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>
