<template>
  <div class="ptd-root">
    <!-- 二级：供应商列表（云） / 模型列表（本地/自定义） -->
    <ModelDialog
      :title="modeLabel + ' · 二级'"
      :level="2"
      @close="emit('close')"
    >
      <!-- 云端 API：供应商 + 分类栏（官方API/聚合Plan/应用API） -->
      <template v-if="mode === 'cloud'">
        <div class="ptd-cat-bar">
          <button
            v-for="c in CATEGORY_ORDER"
            :key="c"
            class="ptd-cat" :class="{ on: cloudCat === c }"
            @click="cloudCat = c"
          >{{ CATEGORY_LABELS[c] }}<span class="ptd-cat-count">{{ cloudProvidersOf(c).length }}</span></button>
        </div>
        <div class="ptd-list">
          <button
            v-for="p in cloudProvidersOf(cloudCat)"
            :key="p.id"
            class="ptd-item" :class="{ active: settingsStore.aiCloudProvider === p.id }"
            @click="openCloudProvider(p)"
          >
            <span class="ptd-item-name">{{ p.label }}</span>
            <WsIcon name="chevron-right" size="xs" class="ptd-item-arw" />
          </button>
        </div>
      </template>

      <!-- 本地模型：增加模型 → 三级 -->
      <template v-if="mode === 'local'">
        <div class="ptd-list">
          <div v-if="settingsStore.aiLocalModel" class="ptd-row">
            <span class="ptd-item-name">{{ settingsStore.aiLocalModel }}</span>
            <span class="ptd-item-meta">{{ settingsStore.aiLocalType }} · {{ settingsStore.aiLocalEndpoint }}</span>
            <button class="ptd-edit" type="button" aria-label="编辑本地模型" @click="enterLocalForm()"><WsIcon name="edit" size="xs" /></button>
          </div>
          <div v-else class="ptd-empty">尚未配置本地模型</div>
        </div>
        <button class="ptd-add" @click="enterLocalForm()"><WsIcon name="plus" size="xs" />增加模型</button>
      </template>

      <!-- 第三方自定义：已有供应商 + 增加 -->
      <template v-if="mode === 'custom'">
        <div class="ptd-list">
          <div v-for="cp in settingsStore.customProviders" :key="cp.id" class="ptd-row">
            <span class="ptd-item-name">{{ cp.name || cp.baseUrl }}</span>
            <span class="ptd-item-meta">{{ cp.modelId }}</span>
            <button class="ptd-edit" type="button" @click="enterCustomForm(cp)"><WsIcon name="edit" size="xs" /></button>
            <button class="ptd-del" type="button" @click="settingsStore.removeCustomProvider(cp.id)">✕</button>
          </div>
          <div v-if="!settingsStore.customProviders.length" class="ptd-empty">尚未配置自定义供应商</div>
        </div>
        <button class="ptd-add" @click="enterCustomForm(null)"><WsIcon name="plus" size="xs" />增加供应商模型</button>
      </template>
    </ModelDialog>

    <!-- 三级：配置面板（平移从右侧进入） -->
    <Transition name="ptd-slide">
      <ModelDialog
        v-if="level3Open"
        :title="level3Title"
        :level="3"
        :show-back="true"
        @back="level3Open = false"
        @close="handleLevel3Close"
      >
        <div class="ptd-form">
          <!-- 云端三级 -->
          <template v-if="mode === 'cloud' && cloudSel">
            <div class="ptd-field"><span class="sp-row-label">供应商</span><span class="ptd-static">{{ cloudSel.label }}</span></div>
            <div class="ptd-field">
              <span class="sp-row-label">模型</span>
              <TuiSelect v-if="cloudProviderModels.length" :model-value="settingsStore.aiCloudModel" :options="cloudModelOptions" @update:model-value="onCloudModelPicked" />
              <input v-else type="text" class="settings-input" v-model="settingsStore.aiCloudModel" placeholder="模型 ID" />
            </div>
            <div class="ptd-field">
              <span class="sp-row-label">API Key</span>
              <input type="password" class="settings-input" v-model="cloudApiKeyLocal" placeholder="sk-..." />
            </div>
            <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="swVision" :show-thinking="true" />
          </template>

          <!-- 本地三级 -->
          <template v-if="mode === 'local'">
            <div class="ptd-field"><span class="sp-row-label">Base URL</span><input type="text" class="settings-input" v-model="settingsStore.aiLocalEndpoint" placeholder="http://localhost:11434" /></div>
            <div class="ptd-field"><span class="sp-row-label">API 类型</span><TuiSelect :model-value="settingsStore.aiLocalType" :options="localTypeOptions" @update:model-value="settingsStore.aiLocalType = $event" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型名称</span><input type="text" class="settings-input" v-model="localName" placeholder="如 Llama 3.1" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型 ID</span><input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型类型</span><TuiSelect :model-value="localKind" :options="localKindOptions" @update:model-value="localKind = $event" /></div>
            <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="localVision" :show-thinking="true" />
          </template>

          <!-- 第三方三级 -->
          <template v-if="mode === 'custom'">
            <div class="ptd-field"><span class="sp-row-label">API 格式</span><TuiSelect :model-value="settingsStore.aiCustomType" :options="customTypeOptions" @update:model-value="settingsStore.aiCustomType = $event" /></div>
            <div class="ptd-field"><span class="sp-row-label">Base URL</span><input type="text" class="settings-input" v-model="settingsStore.aiCustomBaseUrl" placeholder="https://api.example.com/v1" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型名称</span><input type="text" class="settings-input" v-model="customName" placeholder="模型显示名" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型 ID</span><input type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" /></div>
            <div class="ptd-field"><span class="sp-row-label">模型类型</span><TuiSelect :model-value="customKind" :options="customKindOptions" @update:model-value="customKind = $event" /></div>
            <div class="ptd-field"><span class="sp-row-label">API Key</span><input type="password" class="settings-input" v-model="customApiKeyLocal" placeholder="sk-..." /></div>
            <SessionWindowForm v-model="sw" :max-context-length="swMaxContext" :max-output-tokens="swMaxOutput" :max-temperature="swMaxTemp" :supports-vision="customVision" :show-thinking="true" />
          </template>
        </div>

        <template #footer>
          <span class="ptd-test" :class="testState">{{ testText }}</span>
          <span class="ptd-spacer" />
          <button class="mdl-btn" @click="handleLevel3Close">取消</button>
          <button class="mdl-btn mdl-btn--primary" :disabled="testing" @click="onReset">重置</button>
          <button class="mdl-btn mdl-btn--primary" :disabled="testing" @click="onSave">保存并测试连接</button>
        </template>
      </ModelDialog>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiSelect from '../../../components/ui/TuiSelect.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import ModelDialog from './ModelDialog.vue'
import SessionWindowForm, { type SessionWindow } from './SessionWindowForm.vue'
import {
  getCloudProviderViews, CATEGORY_LABELS, CATEGORY_ORDER,
  getAvailableModels, type ProviderCategory,
} from './model-classify'
import { modelSupportsVision } from '@worldsmith/agent-runtime'

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

// ── 云：二级分类 + 供应商 ──
const cloudCat = ref<ProviderCategory>('official')
const cloudProviders = computed(() => getCloudProviderViews())
function cloudProvidersOf(cat: ProviderCategory) {
  return cloudProviders.value.filter((p) => p.category === cat)
}
const cloudProviderModels = computed(() => {
  const provider = settingsStore.aiCloudProvider
  if (!provider) return []
  return getAvailableModels(provider)
})
const cloudModelOptions = computed(() =>
  cloudProviderModels.value.map((m) => ({ value: m.id, label: m.name })),
)

// ── 三级开合与选择 ──
const level3Open = ref(false)
const cloudSel = ref<{ id: string; label: string } | null>(null)
const testing = ref(false)
const testState = ref<'idle' | 'ok' | 'fail'>('idle')
const testText = computed(() =>
  testState.value === 'ok' ? '连接成功' : testState.value === 'fail' ? '连接失败' : '',
)

// 本地/自定义表单附加名称字段
const localName = ref('')
const localKind = ref('text')
const customName = ref('')
const customKind = ref('text')
const customEditingId = ref<string | null>(null)

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
const localKindOptions = [
  { value: 'text', label: '文本' },
  { value: 'vision', label: '视觉' },
  { value: 'multimodal', label: '全模态' },
]
const customKindOptions = localKindOptions

// 会话窗口（三级）初始值
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
const localVision = computed(() => localKind.value === 'vision' || localKind.value === 'multimodal')
const customVision = computed(() => customKind.value === 'vision' || customKind.value === 'multimodal')

const cloudApiKeyLocal = ref(props.cloudApiKey)
const customApiKeyLocal = ref(props.customApiKey)

function openCloudProvider(p: { id: string; label: string }): void {
  const changed = settingsStore.aiCloudProvider !== p.id
  settingsStore.aiCloudProvider = p.id
  cloudSel.value = p
  if (changed) {
    const defaultModel = getAvailableModels(p.id)[0]
    if (defaultModel) {
      settingsStore.aiCloudModel = defaultModel.id
      emit('provider-change', p.id, defaultModel.id)
    }
  }
  level3Open.value = true
}
function onCloudModelPicked(id: string): void {
  settingsStore.aiCloudModel = id
  emit('model-change', settingsStore.aiCloudProvider, id)
}
function enterLocalForm(): void {
  localName.value = settingsStore.aiLocalModel || ''
  level3Open.value = true
}
function enterCustomForm(cp: { id: string; name: string; baseUrl: string; apiType: string; modelId: string } | null): void {
  if (cp) {
    customEditingId.value = cp.id
    settingsStore.aiCustomBaseUrl = cp.baseUrl
    settingsStore.aiCustomType = cp.apiType as any
    settingsStore.aiCustomModel = cp.modelId
    customName.value = cp.name
  } else {
    customEditingId.value = null
  }
  level3Open.value = true
}
const level3Title = computed(() => {
  if (props.mode === 'cloud' && cloudSel.value) return `${cloudSel.value.label} · 配置`
  if (props.mode === 'local') return '本地模型 · 配置'
  return customEditingId.value ? '自定义供应商 · 编辑' : '自定义供应商 · 新增'
})
function onReset(): void {
  settingsStore.aiCloudModel = props.currentModelId
  testState.value = 'idle'
}
function onSave(): void {
  // 会话窗口落 localStorage（供后续后端传导读取）
  try {
    localStorage.setItem('agent_session_window', JSON.stringify({ ...sw.value }))
  } catch {}
  emit('update:temperature', sw.value.temperature)
  emit('update:maxTokens', sw.value.maxTokens)
  emit('update:contextLength', sw.value.contextLength)
  emit('update:cloudApiKey', cloudApiKeyLocal.value)
  emit('update:customApiKey', customApiKeyLocal.value)
  if (props.mode !== 'cloud') emit('provider-change', settingsStore.aiProviderMode, swModel.value)
  void testConnection()
}
/** 连接测试（轻量）：local/custom 探测 {base}/v1/models；cloud 暂以保存通过 */
async function testConnection(): Promise<void> {
  testing.value = true
  testState.value = 'idle'
  try {
    if (props.mode !== 'cloud') {
      const base = props.mode === 'local' ? settingsStore.aiLocalEndpoint : settingsStore.aiCustomBaseUrl
      if (!base) { testState.value = 'fail'; return }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/models`, { signal: controller.signal })
      clearTimeout(timer)
      testState.value = res.ok ? 'ok' : 'fail'
    } else {
      // 云端：无 Base URL 配置（走 manifest），本地以"已保存"标记；后端接入后改真测
      testState.value = 'ok'
    }
  } catch {
    testState.value = 'fail'
  } finally {
    testing.value = false
  }
}
function handleLevel3Close(): void {
  level3Open.value = false
  cloudSel.value = null
  testState.value = 'idle'
  emit('close')
}
</script>

<style scoped>
.ptd-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
.ptd-cat { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--color-border, var(--agent-border)); background: var(--color-surface, var(--agent-hover-bg)); color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer; }
.ptd-cat.on { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ptd-cat-count { font-size: var(--font-size-2xs, 10px); opacity: 0.7; }
.ptd-list { display: flex; flex-direction: column; gap: 4px; }
.ptd-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; background: var(--color-surface, var(--agent-hover-bg)); text-align: left; cursor: pointer; transition: border-color 0.15s; }
.ptd-item:hover { border-color: var(--color-border, var(--agent-border)); }
.ptd-item.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ptd-item-name { font-size: var(--font-size-sm); color: var(--color-text); font-weight: var(--font-weight-medium); }
.ptd-item-arw { margin-left: auto; color: var(--color-text-tertiary); }
.ptd-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; background: var(--color-surface, var(--agent-hover-bg)); }
.ptd-item-meta { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ptd-edit { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: transparent; color: var(--color-text-tertiary); cursor: pointer; border-radius: 6px; }
.ptd-edit:hover { color: var(--color-primary); }
.ptd-del { background: none; border: none; cursor: pointer; color: var(--color-text-tertiary); font-size: var(--font-size-xs); }
.ptd-del:hover { color: var(--color-danger); }
.ptd-add { margin-top: 10px; width: 100%; padding: 8px; border: 1px dashed var(--color-border, var(--agent-border-color)); border-radius: 8px; background: transparent; color: var(--color-text); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--font-size-xs); }
.ptd-add:hover { border-color: var(--color-primary); color: var(--color-primary); }
.ptd-empty { font-size: var(--font-size-xs); color: var(--color-text-tertiary); padding: 8px 0; }
.ptd-form { display: flex; flex-direction: column; gap: 10px; }
.ptd-field { display: flex; align-items: center; gap: 8px; }
.sp-row-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); min-width: 64px; flex-shrink: 0; }
.ptd-static { font-size: var(--font-size-sm); color: var(--color-text); }
.settings-input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--color-border, var(--agent-border-color)); border-radius: 6px; background: var(--color-surface, var(--agent-input-bg)); color: var(--color-text); font-size: var(--font-size-sm); outline: none; }
.settings-input:focus { border-color: var(--color-primary); }
.ptd-footer { display: flex; align-items: center; gap: 8px; }
.ptd-test { font-size: var(--font-size-xs); }
.ptd-test.ok { color: var(--color-success); }
.ptd-test.fail { color: var(--color-danger); }
.ptd-spacer { flex: 1; }
.mdl-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-border, var(--border)); background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.mdl-btn--primary { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.mdl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ptd-slide-enter-active, .ptd-slide-leave-active { transition: transform 0.25s ease, opacity 0.2s ease; }
.ptd-slide-enter-from { transform: translateX(40px); opacity: 0; }
.ptd-slide-leave-to { transform: translateX(40px); opacity: 0; }
</style>