<template>
  <div class="swf">
    <div class="agent-set-sub">会话窗口</div>

    <div class="swf-row">
      <span class="swf-label">上下文长度</span>
      <div class="settings-row">
        <input type="range" min="4096" :max="maxContextLength" step="1024" v-model.number="d.contextLength" class="settings-slider" />
        <span class="settings-value">{{ formatTokens(d.contextLength) }}</span>
      </div>
      <div class="settings-hint">最大 {{ formatTokens(maxContextLength) }}</div>
    </div>

    <div class="swf-row">
      <span class="swf-label">输出 (Max Tokens)</span>
      <div class="settings-row">
        <input type="range" min="1024" :max="maxOutputTokens" step="1024" v-model.number="d.maxTokens" class="settings-slider" />
        <span class="settings-value">{{ d.maxTokens }}</span>
      </div>
    </div>

    <div class="swf-row">
      <span class="swf-label">温度</span>
      <div class="settings-row">
        <input type="range" min="0" :max="maxTemperature" v-model.number="d.temperature" class="settings-slider" />
        <span class="settings-value">{{ (d.temperature / 100).toFixed(2) }}</span>
      </div>
    </div>

    <div class="swf-row">
      <span class="swf-label">Top P</span>
      <div class="settings-row">
        <input type="range" min="0" max="100" v-model.number="d.topP" class="settings-slider" />
        <span class="settings-value">{{ (d.topP / 100).toFixed(2) }}</span>
      </div>
    </div>

    <div class="swf-row">
      <span class="swf-label">Top K</span>
      <div class="settings-row">
        <input type="range" min="1" max="100" v-model.number="d.topK" class="settings-slider" />
        <span class="settings-value">{{ d.topK }}</span>
      </div>
    </div>

    <template v-if="showThinking">
      <div class="swf-row">
        <span class="swf-label">思考模式</span>
        <label class="settings-toggle"><input type="checkbox" v-model="d.thinking" /><span class="settings-toggle-slider"></span></label>
      </div>
      <div class="settings-hint">开启后该模型启用推理思考</div>
    </template>

    <div class="swf-row">
      <span class="swf-label">是否输入图片</span>
      <label class="settings-toggle"><input type="checkbox" v-model="d.inputImage" :disabled="!supportsVision" /><span class="settings-toggle-slider"></span></label>
      <div v-if="!supportsVision" class="settings-hint">当前模型不支持图片理解</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

export interface SessionWindow {
  contextLength: number
  maxTokens: number
  temperature: number
  topP: number
  topK: number
  thinking: boolean
  inputImage: boolean
}

const props = withDefaults(defineProps<{
  modelValue: SessionWindow
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  supportsVision: boolean
  showThinking?: boolean
}>(), {
  showThinking: true,
})

const emit = defineEmits<{ 'update:modelValue': [v: SessionWindow] }>()

const d = reactive<SessionWindow>({ ...props.modelValue })

/** 外部（父级改 max 上限时）同步默认值不到达时，回灌 */
watch(() => props.modelValue, (v) => {
  Object.assign(d, v)
})

watch(d, (v) => emit('update:modelValue', { ...v }), { deep: true })

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>

<style scoped>
.swf { display: flex; flex-direction: column; gap: 8px; }
.swf-row { display: flex; flex-direction: column; gap: 4px; }
.swf-label { font-size: var(--font-size-sm); color: var(--color-text); }
.settings-row { display: flex; align-items: center; gap: 8px; }
.settings-slider { flex: 1; accent-color: var(--color-primary); height: 4px; }
.settings-value { font-size: var(--font-size-sm); color: var(--color-text-secondary); min-width: 48px; text-align: right; }
.settings-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.settings-toggle { position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer; flex-shrink: 0; }
.settings-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.settings-toggle-slider { position: absolute; inset: 0; background: var(--color-border, var(--agent-border-color)); border-radius: var(--radius-pill, 18px); transition: background 0.2s; }
.settings-toggle-slider::before { content: ''; position: absolute; width: 12px; height: 12px; left: 3px; top: 3px; background: var(--color-surface-elevated, var(--bg-surface)); border-radius: 50%; transition: transform 0.2s; }
.settings-toggle input:checked + .settings-toggle-slider { background: var(--color-primary); }
.settings-toggle input:checked + .settings-toggle-slider::before { transform: translateX(14px); }
.settings-toggle input:disabled + .settings-toggle-slider { opacity: 0.4; cursor: not-allowed; }
</style>