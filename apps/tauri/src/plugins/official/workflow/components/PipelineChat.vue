<template>
  <div class="pc-chat">
    <div class="pc-header">
      <span class="pc-title">🤖 创作助手</span>
      <span class="pc-hint">描述你的需求，Agent 会帮你编排和执行</span>
    </div>

    <!-- 快捷操作 -->
    <div class="pc-quick-actions">
      <button
        v-for="action in quickActions"
        :key="action.label"
        class="pc-quick-btn"
        @click="sendQuickAction(action.prompt)"
      >
        {{ action.label }}
      </button>
    </div>

    <!-- 输入框 -->
    <div class="pc-input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="pc-input"
        :placeholder="placeholder"
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
        @keydown.enter.shift.exact="void 0"
      />
      <button
        class="pc-send-btn"
        :disabled="!inputText.trim()"
        @click="handleSend"
      >
        发送
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CreationPipeline } from '../types'

const props = defineProps<{
  pipeline: CreationPipeline | null
}>()

const emit = defineEmits<{
  'send-prompt': [prompt: string]
}>()

const inputText = ref('')

const placeholder = computed(() => {
  if (!props.pipeline) return '描述你的创作目标...'
  if (props.pipeline.status === 'running') return '当前计划正在执行中，可以输入指令调整...'
  if (props.pipeline.steps.length === 0) return '描述你想要的创作步骤，Agent 会帮你设计...'
  return '输入指令，如"添加一个角色设计步骤"、"开始执行"...'
})

const quickActions = computed(() => {
  if (!props.pipeline) {
    return [
      { label: '帮我设计创作计划', prompt: '请帮我设计一个创作计划' },
      { label: '从模板创建', prompt: '请列出可用的创作模板' },
    ]
  }

  if (props.pipeline.steps.length === 0) {
    return [
      { label: '自动设计步骤', prompt: `请为创作计划「${props.pipeline.name}」设计步骤` },
      { label: '套用模板', prompt: '请列出可用的创作模板' },
    ]
  }

  if (props.pipeline.status === 'running') {
    return [
      { label: '查看进度', prompt: `请查看创作计划「${props.pipeline.name}」的执行进度` },
      { label: '暂停执行', prompt: `请暂停创作计划「${props.pipeline.name}」的执行` },
    ]
  }

  return [
    { label: '开始执行', prompt: `请执行创作计划「${props.pipeline.name}」` },
    { label: '修改步骤', prompt: `请帮我调整创作计划「${props.pipeline.name}」的步骤` },
    { label: '添加步骤', prompt: `请在创作计划「${props.pipeline.name}」中添加新步骤` },
  ]
})

function handleSend() {
  const text = inputText.value.trim()
  if (!text) return
  sendQuickAction(text)
  inputText.value = ''
}

function sendQuickAction(prompt: string) {
  // 通过 plugin-action 通道发送给 Agent，自动激活 creation-orchestrator Skill
  window.dispatchEvent(new CustomEvent('worldsmith:agent:plugin-action', {
    detail: {
      payload: {
        prompt: `/skill:creation-orchestrator ${prompt}`,
      },
    },
  }))
  emit('send-prompt', prompt)
}
</script>

<style scoped>
.pc-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22);
  flex-shrink: 0;
}

.pc-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pc-title {
  font-size: var(--fs-md);
  font-weight: 600;
}
.pc-hint {
  font-size: var(--fs-xs);
  opacity: 0.5;
}

.pc-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pc-quick-btn {
  padding: 3px 10px;
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border, #30363d);
  background: var(--bg-tertiary, #21262d);
  color: var(--text-primary, #e6edf3);
  cursor: pointer;
  font-size: var(--fs-xs);
  transition: border-color 0.15s, background 0.15s;
}
.pc-quick-btn:hover {
  border-color: var(--primary, #58a6ff);
  background: var(--primary, #58a6ff22);
}

.pc-input-area {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.pc-input {
  flex: 1;
  padding: 8px 10px;
  border-radius: var(--radius-mid);
  border: 1px solid var(--border, #30363d);
  background: var(--bg-primary, #0d1117);
  color: var(--text-primary, #e6edf3);
  font-size: var(--fs-md);
  resize: none;
  font-family: inherit;
  line-height: 1.4;
}
.pc-input:focus {
  outline: none;
  border-color: var(--primary, #58a6ff);
}
.pc-input::placeholder {
  opacity: 0.4;
}
.pc-send-btn {
  padding: 8px 16px;
  border-radius: var(--radius-mid);
  border: none;
  background: var(--primary, #58a6ff);
  color: var(--text-on-primary, #fff);  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: 500;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.pc-send-btn:hover { opacity: 0.9; }
.pc-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
