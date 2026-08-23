<template>
  <ModelDialog :title="`${modeLabel} · 配置`" :level="2" :wide="true" @close="emit('close')">
    <div class="ptd-split">
      <!-- ── 左：列表（供应商横向网格 / 本地 / 自定义） ── -->
      <div class="ptd-left">
        <!-- 云端：分类栏 + 供应商横向 3 列 -->
        <template v-if="mode === 'cloud'">
          <div class="ptd-cat-bar">
            <button
              v-for="c in CATEGORY_ORDER"
              :key="c"
              class="ptd-cat" :class="{ on: cloudCat === c }"
              @click="cloudCat = c"
            >{{ CATEGORY_LABELS[c] }}</button>
          </div>
          <div class="ptd-prov-grid">
            <button
              v-for="p in cloudProvidersOf(cloudCat)"
              :key="p.id"
              class="ptd-prov" :class="{ on: cloudSel?.id === p.id }"
              @click="selectCloud(p)"
            >
              <ProviderLogo :provider="p.id" :label="p.label" :size="22" />
              <span class="ptd-prov-name">{{ p.label }}</span>
            </button>
          </div>
        </template>

        <!-- 本地：单输入承载 -->
        <template v-if="mode === 'local'">
          <div class="ptd-left-hint">本地模型（Ollama / LM Studio / vLLM / llama.cpp）</div>
          <div class="ptd-prov-grid">
            <button class="ptd-prov" :class="{ on: true }" @click="activeLocal = true">
              <ProviderLogo provider="ollama" label="本地" :size="22" />
              <span class="ptd-prov-name">本地模型</span>
            </button>
          </div>
        </template>

        <!-- 自定义：供应商网格 + 新增 -->
        <template v-if="mode === 'custom'">
          <div class="ptd-left-hint">第三方自定义供应商</div>
          <div class="ptd-prov-grid">
            <button
              v-for="cp in settingsStore.customProviders"
              :key="cp.id"
              class="ptd-prov" :class="{ on: customSelId === cp.id }"
              @click="selectCustom(cp)"
            >
              <ProviderLogo provider="custom" :label="cp.name || 'C'" :size="22" />
              <span class="ptd-prov-name">{{ cp.name || cp.baseUrl }}</span>
            </button>
            <button class="ptd-prov ptd-prov--add" :class="{ on: customSelId === '__new__' }" @click="selectCustomNew">
              <span class="ptd-prov-plus"><WsIcon name="plus" size="sm" /></span>
              <span class="ptd-prov-name">增加供应商</span>
            </button>
          </div>
        </template>
      </div>

      <!-- ── 右：模型子面板（表单） ── -->
      <div class="ptd-right">
        <!-- 未选择 → 提示 -->
        <div v-if="!hasSelection" class="ptd-placeholder">选择左侧供应商以配置模型</div>

        <!-- 云端表单 -->
        <template v-if="hasSelection && mode === 'cloud'">
          <div class="ptd-head">
            <ProviderLogo :provider="cloudSel?.id || ''" :label="cloudSel?.label || ''" :size="26" />
            <span class="ptd-head-title">{{ cloudSel?.label }}</span>
          </div>
          <div class="ptd-field">
            <span class="sp-row-label">模型</span>
            <input class="ptd-input" list="ptd-models" :value="cloudModelText" @input="cloudModelText = ($event.target as HTMLInputElement).value" placeholder="选择或输入模型 ID" />
            <datalist id="ptd-models">
              <option v-for="m in cloudModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
            </datalist>
          </div>
          <div class="ptd-field">
            <span class="sp-row-label">API Key</span>
            <input class="ptd-input" type="password" :value="cloudApiKeyLocal" @input="cloudApiKeyLocal = ($event.target as HTMLInputElement).value" placeholder="sk-..." />
            <span class="ptd-hint">测试通过后自动清空输入（不影响已保存的模型 Key）</span>
            <button class="ptd-key-clear" type="button" @click="cloudApiKeyLocal = ''">清空</button>
          </div>
          <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="swVision" :show-thinking="true" />
        </template>

        <!-- 本地表单 -->
        <template v-if="hasSelection && mode === 'local'">
          <div class="ptd-head">
            <ProviderLogo provider="ollama" label="本地" :size="26" />
            <span class="ptd-head-title">本地模型</span>
          </div>
          <div class="ptd-field"><span class="sp-row-label">Base URL</span><input class="ptd-input" v-model="settingsStore.aiLocalEndpoint" placeholder="http://localhost:11434" /></div>
          <div class="ptd-field"><span class="sp-row-label">API 类型</span><TuiSelect :model-value="settingsStore.aiLocalType" :options="localTypeOptions" @update:model-value="settingsStore.aiLocalType = $event" /></div>
          <div class="ptd-field"><span class="sp-row-label">模型名称</span><input class="ptd-input" v-model="localName" placeholder="如 Llama 3.1" /></div>
          <div class="ptd-field"><span class="sp-row-label">模型 ID</span><input class="ptd-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" /></div>
          <div class="ptd-field ptd-col">
            <span class="sp-row-label">模型类型</span>
            <div class="ptd-radio">
              <label v-for="t in MODALITY_RADIOS" :key="t.value" class="ptd-radio-item">
                <input type="radio" :value="t.value" v-model="localKind" /><span>{{ t.label }}</span>
              </label>
            </div>
          </div>
          <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="localVision" :show-thinking="true" />
        </template>

        <!-- 自定义表单 -->
        <template v-if="hasSelection && mode === 'custom'">
          <div class="ptd-head">
            <ProviderLogo provider="custom" :label="customSel?.name || 'C'" :size="26" />
            <span class="ptd-head-title">{{ customSelName }}</span>
          </div>
          <div class="ptd-field">
            <span class="sp-row-label">API 格式</span>
            <TuiSelect :model-value="settingsStore.aiCustomType" :options="customTypeOptions" @update:model-value="settingsStore.aiCustomType = $event" />
          </div>
          <div class="ptd-field"><span class="sp-row-label">Base URL</span><input class="ptd-input" v-model="settingsStore.aiCustomBaseUrl" placeholder="https://api.example.com/v1" /></div>
          <div class="ptd-field"><span class="sp-row-label">模型名称</span><input class="ptd-input" v-model="customName" placeholder="模型显示名" /></div>
          <div class="ptd-field"><span class="sp-row-label">模型 ID</span><input class="ptd-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" /></div>
          <div class="ptd-field ptd-col">
            <span class="sp-row-label">模型类型</span>
            <div class="ptd-radio">
              <label v-for="t in MODALITY_RADIOS" :key="t.value" class="ptd-radio-item">
                <input type="radio" :value="t.value" v-model="customKind" /><span>{{ t.label }}</span>
              </label>
            </div>
          </div>
          <div class="ptd-field">
            <span class="sp-row-label">API Key</span>
            <input class="ptd-input" type="password" list="ptd-keys" :value="customApiKeyLocal" @input="customApiKeyLocal = ($event.target as HTMLInputElement).value" placeholder="sk-..." />
            <button class="ptd-key-clear" type="button" @click="customApiKeyLocal = ''">清空</button>
          </div>
          <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="customVision" :show-thinking="true" />
        </template>

        <!-- 底部操作 -->
        <div v-if="hasSelection" class="ptd-footer">
          <span class="ptd-test" :class="testState">{{ testText }}</span>
          <span class="ptd-spacer" />
          <button class="mdl-btn" @click="resetDirty()">重置</button>
          <button class="mdl-btn mdl-btn--primary" :disabled="testing" @click="onSave">保存并测试连接</button>
        </div>
      </div>
    </div>
  </ModelDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon, toastInfo } from '@worldsmith/ui-kit'
import TuiSelect from '../../../components/ui/TuiSelect.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import ModelDialog from './ModelDialog.vue'
import SessionWindowForm, { type SessionWindow } from './SessionWindowForm.vue'
import { addSavedModel } from './savedModels'
import ProviderLogo from './ProviderLogo.vue'
import {
  getCloudProviderViews, CATEGORY_LABELS, CATEGORY_ORDER,
  getAvailableModels, type ProviderCategory,
} from './model-classify'
import { modelSupportsVision, buildModelsEndpoint } from '@worldsmith/agent-runtime'

const props = withDefaults(defineProps<{
  mode: 'cloud' | 'local' | 'custom'
  currentModelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  chatMode: string
  chatModes: Array<{ value: string; icon: string; label: string; desc: string }>
  lockedChatMode: string | null
  cloudApiKey: string
  customApiKey: string
  fetchedModels: string[]
  fetchingModels: boolean
  fetchError: string
  canFetchModels: boolean
}>(), {
  lockedChatMode: null,
})

const emit = defineEmits<{
  close: []
  'update:temperature': [value: number]
  'update:maxTokens': [value: number]
  'update:contextLength': [value: number]
  'update:cloudApiKey': [value: string]
  'update:customApiKey': [value: string]
  'model-change': [provider: string, modelId: string]
  'provider-change': [provider: string, modelId: string]
}>()

const settingsStore = useSettingsStore()

const MODE_TITLE: Record<string, string> = { cloud: '云端 API', local: '本地模型', custom: '第三方自定义' }
const modeLabel = computed(() => MODE_TITLE[props.mode] ?? props.mode)

// ── 分类 ──
const cloudCat = ref<ProviderCategory>('official')
const cloudProviders = computed(() => getCloudProviderViews())
function cloudProvidersOf(cat: ProviderCategory) { return cloudProviders.value.filter((p) => p.category === cat) }

// ── 选择状态 ──
const cloudSel = ref<{ id: string; label: string } | null>(null)
const customSelId = ref<string | null>(null)
const customSel = ref<{ id: string; name: string; baseUrl: string; apiType: string; modelId: string } | null>(null)
const activeLocal = ref(true)
const hasSelection = computed(() =>
  props.mode === 'cloud' ? !!cloudSel.value
    : props.mode === 'local' ? activeLocal.value
    : customSelId.value !== null,
)

// ── 云模型 options + 文本（combobox） ──
const cloudModelOptions = computed(() => {
  const provider = settingsStore.aiCloudProvider
  if (!provider) return []
  return getAvailableModels(provider).map((m) => ({ value: m.id, label: m.name }))
})
const cloudModelText = ref(settingsStore.aiCloudModel || '')

function selectCloud(p: { id: string; label: string }): void {
  const changed = settingsStore.aiCloudProvider !== p.id
  settingsStore.aiCloudProvider = p.id
  cloudSel.value = p
  if (changed && getAvailableModels(p.id)[0]) {
    settingsStore.aiCloudModel = getAvailableModels(p.id)[0].id
  }
  cloudModelText.value = settingsStore.aiCloudModel || ''
  cloudApiKeyLocal.value = props.cloudApiKey || ''
}
function selectCustom(cp: { id: string; name: string; baseUrl: string; apiType: string; modelId: string }): void {
  customSel.value = cp
  customSelId.value = cp.id
  settingsStore.aiCustomBaseUrl = cp.baseUrl
  settingsStore.aiCustomType = cp.apiType as any
  settingsStore.aiCustomModel = cp.modelId
  customName.value = cp.name
  customApiKeyLocal.value = props.customApiKey || ''
}
function selectCustomNew(): void {
  customSel.value = null
  customSelId.value = '__new__'
  customName.value = ''
  settingsStore.aiCustomBaseUrl = ''
  settingsStore.aiCustomModel = ''
}
const customSelName = computed(() => customSel.value?.name || (customSelId.value === '__new__' ? '新增供应商' : '自定义供应商'))

// ── 表单字段 ──
const localName = ref('')
const localKind = ref('text')
const customName = ref('')
const customKind = ref('text')
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
const MODALITY_RADIOS = [
  { value: 'multimodal', label: '全模态' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图像' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '语音' },
]

// ── 会话窗口 ──
const sw = ref<SessionWindow>({
  contextLength: props.contextLength || props.maxContextLength,
  maxTokens: props.maxTokens || props.maxOutputTokens,
  temperature: props.temperature,
  topP: 100,
  topK: 40,
  thinking: false,
  inputImage: false,
})
const swMaxContext = computed(() => props.maxContextLength)
const swMaxOutput = computed(() => props.maxOutputTokens)
const swMaxTemp = computed(() => props.maxTemperature)
const swModel = computed(() => {
  if (props.mode === 'cloud') return settingsStore.aiCloudModel
  if (props.mode === 'local') return settingsStore.aiLocalModel
  return settingsStore.aiCustomModel
})
const swVision = computed(() => modelSupportsVision(swModel.value))
const localVision = computed(() => ['vision', 'multimodal', 'image', 'video', 'audio'].includes(localKind.value))
const customVision = computed(() => ['vision', 'multimodal', 'image', 'video', 'audio'].includes(customKind.value))

// ── API Key（本地编辑态；安全策略：不记忆明文 Key，测试通过后清空输入框但保留模型已存 Key） ──
const cloudApiKeyLocal = ref(props.cloudApiKey || '')
const customApiKeyLocal = ref(props.customApiKey || '')

// ── 测试连接 / 保存 ──
const testing = ref(false)
const testState = ref<'idle' | 'ok' | 'fail'>('idle')
const testText = computed(() =>
  testState.value === 'ok' ? '连接成功' : testState.value === 'fail' ? '连接失败' : '')

function resetDirty(): void {
  settingsStore.aiCloudModel = props.currentModelId
  testState.value = 'idle'
}

async function onSave(): Promise<void> {
  // 云：把 combobox 中的模型写入 store
  if (props.mode === 'cloud' && cloudSel.value) {
    settingsStore.aiCloudModel = cloudModelText.value || settingsStore.aiCloudModel
    if (cloudSel.value.id !== settingsStore.aiCloudProvider) settingsStore.aiCloudProvider = cloudSel.value.id
    emit('model-change', settingsStore.aiCloudProvider, settingsStore.aiCloudModel)
  }
  if (props.mode !== 'cloud') emit('provider-change', settingsStore.aiProviderMode, swModel.value)
  // P0-2：会话窗口按当前模型归档
  try {
    localStorage.setItem('agent_session_window', JSON.stringify({ ...sw.value }))
    const mid = swModel.value
    if (mid) localStorage.setItem(`agent_model_params_${mid}`, JSON.stringify({ ...sw.value }))
  } catch {}
  emit('update:temperature', sw.value.temperature)
  emit('update:maxTokens', sw.value.maxTokens)
  emit('update:contextLength', sw.value.contextLength)
  emit('update:cloudApiKey', cloudApiKeyLocal.value)
  emit('update:customApiKey', customApiKeyLocal.value)
  // P0-1：保存即测连接 + toast；P0-2 参数归档（不记忆明文 Key）
  const ok = await testConnection()
  if (ok) {
    // 测试通过 → 把当前模型写入「已保存模型」独立持久化集合
    addSavedModel({
      id: `${props.mode}-${swModel.value}`,
      mode: props.mode,
      providerId: props.mode === 'cloud' ? settingsStore.aiCloudProvider : props.mode,
      providerLabel: props.mode === 'cloud' ? (cloudSel.value?.label || settingsStore.aiCloudProvider) : (props.mode === 'local' ? '本地' : '自定义'),
      modelId: swModel.value,
      name: swModel.value,
      modality: 'text',
    })
  }
  // 安全策略：测试通过后清空 Key 输入框（模型已存 Key 不受影响）；失败亦保留输入供重试
  if (ok) {
    if (props.mode === 'cloud') cloudApiKeyLocal.value = ''
    else if (props.mode === 'custom') customApiKeyLocal.value = ''
  }
  toastInfo(ok ? '连接成功，配置已保存' : '连接失败，请检查端点与 API Key')
}

async function testConnection(): Promise<boolean> {
  testing.value = true
  testState.value = 'idle'
  try {
    if (props.mode !== 'cloud') {
      const base = props.mode === 'local' ? settingsStore.aiLocalEndpoint : settingsStore.aiCustomBaseUrl
      if (!base) { testState.value = 'fail'; return false }
      const ok = await probeJson(`${base.replace(/\/$/, '')}/v1/models`, customApiKeyLocal.value)
      testState.value = ok ? 'ok' : 'fail'
      return ok
    }
    const endpoint = buildModelsEndpoint(settingsStore.aiCloudProvider)
    if (endpoint) {
      const ok = await probeJson(endpoint, cloudApiKeyLocal.value)
      testState.value = ok ? 'ok' : 'fail'
      return ok
    }
    testState.value = 'ok'
    return true
  } catch {
    testState.value = 'fail'
    return false
  } finally {
    testing.value = false
  }
}

async function probeJson(url: string, key?: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    })
    return res.ok
  } finally {
    clearTimeout(timer)
  }
}
</script>

<style scoped>
.ptd-split { display: flex; gap: 12px; height: 100%; min-height: 320px; }
.ptd-left {
  width: 220px; flex-shrink: 0;
  border-right: 1px solid var(--color-border, var(--agent-border));
  padding-right: 12px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
}
.ptd-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; }
.ptd-cat {
  padding: 3px 9px; border-radius: 999px; border: 1px solid var(--color-border, var(--agent-border));
  background: var(--color-surface, var(--agent-hover-bg)); color: var(--color-text-secondary);
  font-size: var(--font-size-2xs, 10px); cursor: pointer;
}
.ptd-cat.on { border-color: var(--color-primary); color: var(--color-primary); }
.ptd-prov-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ptd-prov {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 4px; text-align: center; cursor: pointer;
  border: 1px solid var(--color-border, var(--agent-border)); border-radius: 10px;
  background: var(--color-surface, var(--agent-hover-bg));
  transition: border-color 0.15s, background 0.15s;
}
.ptd-prov:hover { border-color: var(--color-primary); }
.ptd-prov.on { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ptd-prov-name { font-size: var(--font-size-2xs, 10px); color: var(--color-text-secondary); }
.ptd-prov--add { border-style: dashed; color: var(--color-text-tertiary); }
.ptd-prov-plus { display: flex; }
.ptd-left-hint { font-size: var(--font-size-2xs, 10px); color: var(--color-text-tertiary); }

.ptd-right { flex: 1; min-width: 0; overflow-y: auto; padding-right: 2px; display: flex; flex-direction: column; gap: 10px; }
.ptd-placeholder { color: var(--color-text-tertiary); font-size: var(--font-size-xs); margin: auto; }
.ptd-head { display: flex; align-items: center; gap: 8px; }
.ptd-head-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text); }
.ptd-field { display: flex; align-items: center; gap: 8px; }
.ptd-field.ptd-col { flex-direction: column; align-items: flex-start; }
.sp-row-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); min-width: 64px; flex-shrink: 0; }
.ptd-input {
  flex: 1; min-width: 0; padding: 5px 8px;
  border: 1px solid var(--color-border, var(--agent-border-color)); border-radius: 6px;
  background: var(--color-surface, var(--agent-input-bg)); color: var(--color-text);
  font-size: var(--font-size-sm); outline: none;
}
.ptd-input:focus { border-color: var(--color-primary); }
.ptd-hint { font-size: var(--font-size-2xs, 10px); color: var(--color-text-tertiary); }
.ptd-key-clear { background: none; border: none; color: var(--color-text-tertiary); cursor: pointer; font-size: var(--font-size-xs); flex-shrink: 0; }
.ptd-key-clear:hover { color: var(--color-primary); }
.ptd-radio { display: flex; flex-wrap: wrap; gap: 8px; }
.ptd-radio-item { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); color: var(--color-text); cursor: pointer; }
.ptd-footer { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.ptd-test { font-size: var(--font-size-xs); }
.ptd-test.ok { color: var(--color-success); }
.ptd-test.fail { color: var(--color-danger); }
.ptd-spacer { flex: 1; }
.mdl-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-border, var(--border)); background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.mdl-btn--primary { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.mdl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>