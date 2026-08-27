<template>
  <Teleport to="body">
    <div class="ptd-overlay" @mousedown.self="emit('close')" @keydown.esc.self="emit('close')">
      <!-- ══ 左：供应商选择弹窗（独立窗口，未选时居中，选中后左移） ══ -->
      <div class="ptd-shell ptd-shell--left" :class="{ expanded }">
        <header class="ptd-header">
          <span class="ptd-title">{{ modeLabel }} · 配置</span>
          <button class="ptd-close" type="button" aria-label="关闭" @click="emit('close')">
            <WsIcon name="close" size="sm" />
          </button>
        </header>
        <div class="ptd-body">
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

          <!-- 本地：单选项 -->
          <template v-if="mode === 'local'">
            <div class="ptd-left-hint">本地模型（Ollama / LM Studio / vLLM / llama.cpp）</div>
            <div class="ptd-prov-grid">
              <button class="ptd-prov" :class="{ on: activeLocal }" @click="activeLocal = !activeLocal">
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
      </div>

      <!-- ══ 右：模型配置弹窗（独立窗口，选中供应商后从右侧滑入） ══ -->
      <Transition name="ptd-panel">
        <div v-if="expanded" class="ptd-shell ptd-shell--right">
          <div class="ptd-body">
            <!-- 云端表单 -->
            <template v-if="mode === 'cloud'">
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
            <template v-if="mode === 'local'">
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
            <template v-if="mode === 'custom'">
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
            <div class="ptd-footer">
              <span class="ptd-test" :class="testState">{{ testText }}</span>
              <span class="ptd-spacer" />
              <button class="mdl-btn" @click="resetDirty()">重置</button>
              <button class="mdl-btn mdl-btn--primary" :disabled="testing" @click="onSave">保存并测试连接</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon, toastInfo } from '@worldsmith/ui-kit'
import TuiSelect from '../../../components/ui/TuiSelect.vue'
import { useSettingsStore } from '@/stores/settingsStore'
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
const activeLocal = ref(false)
const hasSelection = computed(() =>
  props.mode === 'cloud' ? !!cloudSel.value
    : props.mode === 'local' ? activeLocal.value
    : customSelId.value !== null,
)
/** 展开态：有选中供应商时左弹窗左移 + 右弹窗滑入 */
const expanded = computed(() => hasSelection.value)

// ── 云模型 options + 文本（combobox） ──
const cloudModelOptions = computed(() => {
  const provider = settingsStore.aiCloudProvider
  if (!provider) return []
  return getAvailableModels(provider).map((m) => ({ value: m.id, label: m.name }))
})
const cloudModelText = ref(settingsStore.aiCloudModel || '')

function selectCloud(p: { id: string; label: string }): void {
  // 点击当前已选 → 收回右弹窗
  if (cloudSel.value?.id === p.id) {
    cloudSel.value = null
    return
  }
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
  // 点击当前已选 → 收回
  if (customSelId.value === cp.id) {
    customSelId.value = null
    customSel.value = null
    return
  }
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
  if (props.mode === 'cloud' && cloudSel.value) {
    settingsStore.aiCloudModel = cloudModelText.value || settingsStore.aiCloudModel
    if (cloudSel.value.id !== settingsStore.aiCloudProvider) settingsStore.aiCloudProvider = cloudSel.value.id
    emit('model-change', settingsStore.aiCloudProvider, settingsStore.aiCloudModel)
  }
  if (props.mode !== 'cloud') emit('provider-change', settingsStore.aiProviderMode, swModel.value)
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
  const ok = await testConnection()
  if (ok) {
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
/* ═══════════════════════════════════════════════
   双独立弹窗架构：左供应商弹窗 + 右模型配置弹窗
   两窗口各自有边框/阴影/圆角，之间保持间隙不相接
   ═══════════════════════════════════════════════ */

/* 弹窗尺寸常量（CSS 变量便于计算偏移） */
.ptd-overlay {
  --ptd-left-w: 280px;   /* 左弹窗宽度 */
  --ptd-right-w: 500px;  /* 右弹窗宽度 */
  --ptd-gap: 16px;       /* 两弹窗间隙 */

  position: fixed;
  inset: 0;
  z-index: var(--z-overlay, 10000);
  background: var(--overlay, rgba(0, 0, 0, 0.4));
}

/* 通用弹窗外壳 */
.ptd-shell {
  position: absolute;
  top: 50%;
  background: var(--color-surface-elevated, var(--content-bg, var(--bg, var(--color-bg-surface))));
  border: 1px solid var(--color-border, var(--border));
  border-radius: var(--radius-md, 10px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
}

/* ── 左弹窗：供应商选择 ── */
.ptd-shell--left {
  left: 50%;
  width: var(--ptd-left-w);
  transform: translate(-50%, -50%);
  transition: transform 0.3s cubic-bezier(0.22, 0.8, 0.36, 1);
  z-index: 2;
}
/* 展开态：左移 (右弹窗宽 + 间隙) / 2，让出右弹窗空间 */
.ptd-shell--left.expanded {
  transform: translate(calc(-50% - (var(--ptd-right-w) + var(--ptd-gap)) / 2), -50%);
}

/* ── 右弹窗：模型配置 ── */
.ptd-shell--right {
  left: 50%;
  width: var(--ptd-right-w);
  /* 中心偏移 = (左弹窗宽 + 间隙) / 2 */
  transform: translate(calc(-50% + (var(--ptd-left-w) + var(--ptd-gap)) / 2), -50%);
  z-index: 1;
}

/* 右弹窗滑入/滑出过渡 */
.ptd-panel-enter-active,
.ptd-panel-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.ptd-panel-enter-from,
.ptd-panel-leave-to {
  opacity: 0;
  /* 在基础位置上再向右偏 24px，模拟从右侧滑入 */
  transform: translate(calc(-50% + (var(--ptd-left-w) + var(--ptd-gap)) / 2 + 24px), -50%);
}

/* ── 弹窗头部 ── */
.ptd-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border, var(--border));
  flex-shrink: 0;
}
.ptd-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text, var(--text-color));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ptd-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm, 6px);
  color: var(--color-text-secondary, var(--text-secondary));
  cursor: pointer;
}
.ptd-close:hover {
  background: var(--color-surface, var(--hover-bg));
  color: var(--color-text, var(--text-color));
}

/* ── 弹窗内容区 ── */
.ptd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

/* ── 左弹窗：供应商列表 ── */
.ptd-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
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
.ptd-left-hint { font-size: var(--font-size-2xs, 10px); color: var(--color-text-tertiary); margin-bottom: 8px; }

/* ── 右弹窗：模型表单 ── */
.ptd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.ptd-head-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text); }
.ptd-field { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
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
.ptd-footer { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ptd-test { font-size: var(--font-size-xs); }
.ptd-test.ok { color: var(--color-success); }
.ptd-test.fail { color: var(--color-danger); }
.ptd-spacer { flex: 1; }
.mdl-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--color-border, var(--border)); background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.mdl-btn--primary { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.mdl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
