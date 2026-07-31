<template>
  <div class="sub-panel">
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

    <!-- 阶段 2.0：Agent 后端切换（TS / Rust） -->
    <div class="settings-row agent-backend-row">
      <span class="sp-row-label">Agent 后端</span>
      <select v-model="settingsStore.agentBackend" class="settings-select" aria-label="Agent 后端">
        <option value="ts">TS（默认）</option>
        <option value="rust">Rust（实验性）</option>
      </select>
    </div>
    <div v-if="settingsStore.agentBackend === 'rust'" class="settings-hint rust-hint">
      实验性 Rust Agent：仅支持核心对话与工具调用，深度模式/长任务/A2UI/终端等高级功能暂不可用
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getDefaultModelId, getModelInfo, getModelsByProvider, getAllProviderManifests } from '@worldsmith/agent-runtime'
import { getProviderIconUrl } from '../../assets/providerIcons'

const props = defineProps<{
  cloudApiKey: string
  customApiKey: string
  fetchedModels: string[]
  fetchingModels: boolean
  fetchError: string
  canFetchModels: boolean
}>()

const emit = defineEmits<{
  'update:cloudApiKey': [value: string]
  'update:customApiKey': [value: string]
  'model-change': [provider: string, modelId: string]
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
</script>
