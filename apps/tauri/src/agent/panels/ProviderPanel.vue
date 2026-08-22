<template>
  <div class="sub-panel">
    <div class="settings-row">
      <span class="sp-row-label">供应商模式</span>
      <TuiSelect :model-value="settingsStore.aiProviderMode" :options="providerModeOptions" aria-label="供应商模式" @update:model-value="settingsStore.aiProviderMode = $event" />
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
          <TuiSelect :model-value="settingsStore.aiCloudModel" :options="currentProviderModelOptions" placeholder="选择模型" @update:model-value="onCloudModelChange" />
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
        <TuiSelect :model-value="settingsStore.aiLocalType" :options="localTypeOptions" aria-label="API 类型" @update:model-value="settingsStore.aiLocalType = $event" />
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
        <TuiSelect :model-value="settingsStore.aiCustomType" :options="customTypeOptions" aria-label="API 类型" @update:model-value="settingsStore.aiCustomType = $event" />
      </div>
      <div class="settings-row">
        <span class="sp-row-label">模型 ID</span>
        <div class="cp-model-field">
          <TuiSelect v-if="props.fetchedModels.length > 0" :model-value="settingsStore.aiCustomModel" :options="fetchedModelsOptions" placeholder="选择模型" @update:model-value="settingsStore.aiCustomModel = $event" />
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
      <TuiSelect :model-value="settingsStore.agentBackend" :options="agentBackendOptions" aria-label="Agent 后端" @update:model-value="settingsStore.agentBackend = $event" />
    </div>
    <div v-if="settingsStore.agentBackend === 'rust'" class="settings-hint rust-hint">
      Rust 模式：深度模式/长任务/A2UI/编排状态栏/终端/子 Agent 均已支持
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiSelect from '../../components/ui/TuiSelect.vue'
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

// ── TuiSelect 选项集（替代原生 select，与配置层其它面板统一） ──
const providerModeOptions = [
  { value: 'cloud', label: '云端 API' },
  { value: 'local', label: '本地模型' },
  { value: 'custom', label: '自定义' },
]
const localTypeOptions = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'lm-studio', label: 'LM Studio' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'llama-cpp', label: 'llama.cpp' },
]
const customTypeOptions = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic-compatible', label: 'Anthropic 兼容' },
]
const agentBackendOptions = [
  { value: 'ts', label: 'TS（默认）' },
  { value: 'rust', label: 'Rust（实验性）' },
]
/** 当前供应商的模型选项（cloud 模式下展示，含视觉标记） */
const currentProviderModelOptions = computed(() =>
  currentProviderModels.value.map((m) => ({
    value: m.id,
    label: `${m.name}${getModelInfo(m.id)?.supportsVision ? ' (视觉)' : ''}`,
  })),
)
/** 自定义供应商拉取到的模型选项 */
const fetchedModelsOptions = computed(() =>
  (props.fetchedModels ?? []).map((m) => ({ value: m, label: m })),
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

function onCloudModelChange(modelId: string): void {
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
