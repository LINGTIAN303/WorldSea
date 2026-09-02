<template>
  <ModelDialog :title="`编辑 ${model.name}`" :level="2" @close="emit('close')">
    <div class="mp-section">
      <div class="sp-row-label">上下文长度</div>
      <div class="settings-row">
        <input type="range" min="4096" :max="maxContextLength" step="1024" v-model.number="params.contextLength" class="settings-slider" />
        <span class="settings-value">{{ formatTokens(params.contextLength) }}</span>
      </div>
      <div class="settings-hint">最大 {{ formatTokens(maxContextLength) }}</div>
    </div>

    <div class="mp-section">
      <div class="sp-row-label">最大输出 (Max Tokens)</div>
      <div class="settings-row">
        <input type="range" min="1024" :max="maxOutputTokens" step="1024" v-model.number="params.maxTokens" class="settings-slider" />
        <span class="settings-value">{{ params.maxTokens }}</span>
      </div>
    </div>

    <div class="mp-section">
      <div class="sp-row-label">温度 (Temperature)</div>
      <div class="settings-row">
        <input type="range" min="0" :max="maxTemperature" v-model.number="params.temperature" class="settings-slider" />
        <span class="settings-value">{{ (params.temperature / 100).toFixed(2) }}</span>
      </div>
    </div>

    <div class="mp-section">
      <div class="sp-row-label">Top P</div>
      <div class="settings-row">
        <input type="range" min="0" max="100" v-model.number="params.topP" class="settings-slider" />
        <span class="settings-value">{{ (params.topP / 100).toFixed(2) }}</span>
      </div>
    </div>

    <div class="mp-section">
      <div class="sp-row-label">Top K</div>
      <div class="settings-row">
        <input type="range" min="1" max="100" v-model.number="params.topK" class="settings-slider" />
        <span class="settings-value">{{ params.topK }}</span>
      </div>
    </div>

    <div class="mp-section">
      <div class="sp-row-label">工具调用轮数上限 (Total Steps)</div>
      <div class="settings-row">
        <input type="range" min="1" max="500" step="1" v-model.number="params.totalSteps" class="settings-slider" />
        <span class="settings-value">{{ params.totalSteps }}</span>
      </div>
      <div class="settings-hint">模型可执行的工具调用轮数上限（1~500，默认 200）；达到上限前会提示收尾</div>
    </div>

    <div class="mp-section">
      <div class="settings-row">
        <span class="settings-row-label">思考模式</span>
        <label class="settings-toggle"><input type="checkbox" v-model="params.thinking" /><span class="settings-toggle-slider"></span></label>
      </div>
      <div class="settings-hint" v-if="!supportsThinking">当前模型不以注册表标记思考能力（可手动开启）</div>
      <div class="settings-hint" v-else>开启后该模型启用推理思考</div>
    </div>

    <div class="mp-section">
      <div class="settings-row">
        <span class="settings-row-label">是否输入图片</span>
        <label class="settings-toggle"><input type="checkbox" v-model="params.inputImage" :disabled="!supportsVision" /><span class="settings-toggle-slider"></span></label>
      </div>
      <div class="settings-hint" v-if="!supportsVision">当前模型不支持图片理解，无法启用</div>
    </div>

    <template #footer>
      <button class="mdl-btn" @click="emit('close')">取消</button>
      <button class="mdl-btn mdl-btn--primary" @click="onSave">保存</button>
    </template>
  </ModelDialog>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import ModelDialog from './ModelDialog.vue'

const props = defineProps<{
  model: { id: string; name: string }
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  modelSupportsVision: boolean
  modelSupportsThinking: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [params: ModelParams]
}>()

export interface ModelParams {
  contextLength: number
  maxTokens: number
  temperature: number
  topP: number
  topK: number
  /** 总步骤预算：工具调用轮数上限（1~500） */
  totalSteps: number
  thinking: boolean
  inputImage: boolean
}

const STORE_KEY = (id: string) => `agent_model_params_${id}`

function loadParams(): ModelParams {
  const base: ModelParams = {
    contextLength: props.maxContextLength,
    maxTokens: props.maxOutputTokens,
    temperature: 70,
    topP: 100,
    topK: 40,
    totalSteps: 200,
    thinking: false,
    inputImage: props.modelSupportsVision,
  }
  try {
    const raw = localStorage.getItem(STORE_KEY(props.model.id))
    if (raw) return { ...base, ...JSON.parse(raw) }
  } catch {}
  return base
}

const params = reactive<ModelParams>(loadParams())

const supportsVision = computed(() => props.modelSupportsVision)
const supportsThinking = computed(() => props.modelSupportsThinking)

function onSave(): void {
  try {
    localStorage.setItem(STORE_KEY(props.model.id), JSON.stringify({ ...params }))
  } catch {}
  emit('save', { ...params })
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>

<style scoped>
.mp-section { margin-bottom: 14px; }
.mp-section:last-child { margin-bottom: 0; }
.settings-row { display: flex; align-items: center; gap: 8px; }
.settings-slider { flex: 1; accent-color: var(--color-primary); height: 4px; }
.settings-value { font-size: var(--font-size-sm); color: var(--color-text-secondary); min-width: 48px; text-align: right; }
.settings-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: 4px; }
.settings-row-label { font-size: var(--font-size-sm); color: var(--color-text); white-space: nowrap; }
.settings-toggle { position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer; flex-shrink: 0; }
.settings-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.settings-toggle-slider { position: absolute; inset: 0; background: var(--color-border, var(--agent-border-color)); border-radius: var(--radius-pill, 18px); transition: background 0.2s; }
.settings-toggle-slider::before { content: ''; position: absolute; width: 12px; height: 12px; left: 3px; top: 3px; background: var(--color-surface-elevated, var(--bg-surface)); border-radius: 50%; transition: transform 0.2s; }
.settings-toggle input:checked + .settings-toggle-slider { background: var(--color-primary); }
.settings-toggle input:checked + .settings-toggle-slider::before { transform: translateX(14px); }
.settings-toggle input:disabled + .settings-toggle-slider { opacity: 0.4; cursor: not-allowed; }
.mdl-btn {
  padding: 6px 14px; border-radius: var(--radius-sm, 6px); cursor: pointer;
  border: 1px solid var(--color-border, var(--border)); background: transparent;
  color: var(--color-text-secondary); font-size: var(--font-size-sm); font-family: inherit;
}
.mdl-btn:hover { color: var(--color-text); }
.mdl-btn--primary { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.mdl-btn--primary:hover { background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
</style>