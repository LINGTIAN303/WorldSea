<template>
  <div class="ai-sidebar" :class="{ open: visible }">
    <div class="ai-header">
      <span class="ai-title"><WsIcon name="profile" size="sm" /> AI 辅助</span>
      <button class="ai-close" @click="$emit('close')" aria-label="关闭">✕</button>
    </div>

    <div class="ai-actions">
      <button class="ai-btn" @click="runAI('continue')" :disabled="loading"><WsIcon name="edit" size="xs" /> 续写</button>
      <button class="ai-btn" @click="runAI('polish')" :disabled="loading"><WsIcon name="magic" size="xs" /> 润色</button>
      <button class="ai-btn" @click="runAI('dialogue')" :disabled="loading"><WsIcon name="manuscript" size="xs" /> 角色对话</button>
      <button class="ai-btn" @click="runAI('analyze')" :disabled="loading"><WsIcon name="dashboard" size="xs" /> 情节分析</button>
      <button class="ai-btn" @click="runAI('check')" :disabled="loading"><WsIcon name="search" size="xs" /> 世界观检查</button>
    </div>

    <div v-if="loading" class="ai-loading">
      <span class="ai-spinner"></span>
      <span>AI 思考中...</span>
    </div>

    <div v-if="result && !loading" class="ai-result">
      <div class="ai-result-header">
        <span class="ai-mode-label">{{ modeLabel }}</span>
      </div>
      <div class="ai-result-body">{{ result }}</div>
      <div class="ai-result-actions">
        <button class="btn-primary btn-sm" @click="adoptResult">采纳</button>
        <button class="btn-secondary btn-sm" @click="regenerate">重新生成</button>
        <button class="btn-secondary btn-sm" @click="result = ''">放弃</button>
      </div>
    </div>

    <div v-if="!result && !loading" class="ai-hint">
      <p>选中文字后点击功能按钮，AI 将根据上下文辅助写作。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useAgent } from '@/agent/composables/useAgent'
import { useEntityStore } from '@worldsmith/entity-core'

const props = defineProps<{
  visible: boolean
  chapterContent: string
  chapterTitle: string
  selectedText: string
}>()

const emit = defineEmits<{
  close: []
  adopt: [text: string]
}>()

const agent = useAgent()
const es = useEntityStore()
const loading = ref(false)
const result = ref('')
const currentMode = ref('continue')

const modeLabel = computed(() => {
  const labels: Record<string, string> = {
    continue: '续写',
    polish: '润色',
    dialogue: '角色对话',
    analyze: '情节分析',
    check: '世界观检查',
  }
  return labels[currentMode.value] || ''
})

function buildPrompt(mode: string): string {
  const content = props.selectedText || props.chapterContent
  const title = props.chapterTitle
  const mentionIds = extractMentionIds(props.chapterContent)
  const entityContext = buildEntityContext(mentionIds)

  const prompts: Record<string, string> = {
    continue: `你是一位小说写作助手。请根据以下内容续写，保持风格和语气一致：\n\n章节：${title}\n${entityContext}\n当前内容：\n${content.slice(-2000)}\n\n请续写约300字：`,
    polish: `你是一位小说编辑。请对以下文字进行润色，提升文学性但保持原意：\n\n${props.selectedText || content.slice(-1000)}`,
    dialogue: `你是一位小说对话专家。请根据以下角色信息和场景，生成符合角色性格的对话：\n\n${entityContext}\n场景：${content.slice(-1000)}`,
    analyze: `你是一位小说评论家。请分析以下章节的情节结构、节奏和伏笔：\n\n章节：${title}\n${content.slice(-3000)}`,
    check: `你是一位世界观审核员。请检查以下内容是否与已有设定矛盾：\n\n${entityContext}\n章节内容：${content.slice(-2000)}`,
  }
  return prompts[mode] || ''
}

function extractMentionIds(html: string): string[] {
  const regex = /data-id="([^"]+)"/g
  const ids: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1])
  }
  return ids
}

function buildEntityContext(ids: string[]): string {
  if (ids.length === 0) return ''
  const entities = ids
    .map(id => es.entityMap.get(id))
    .filter(Boolean)
    .map(e => `- ${e!.name}（${e!.type}）`)
    .join('\n')
  return entities ? `涉及实体：\n${entities}` : ''
}

async function runAI(mode: string) {
  currentMode.value = mode
  loading.value = true
  result.value = ''
  try {
    const prompt = buildPrompt(mode)
    await agent.sendMessage(prompt)
    // sendMessage 返回 void，结果通过 messages 流式更新，取最后一条 assistant 消息
    const msgs = agent.messages.value
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
    result.value = lastAssistant?.content || 'AI 未返回结果'
  } catch (err) {
    result.value = `AI 请求失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

function adoptResult() {
  if (result.value) {
    emit('adopt', result.value)
    result.value = ''
  }
}

function regenerate() {
  runAI(currentMode.value)
}

defineExpose({ runAI })
</script>

<style scoped>
.ai-sidebar {
  width: 0;
  overflow: hidden;
  border-left: 0 solid var(--border-color);
  background: var(--card-bg);
  display: flex;
  flex-direction: column;
  transition: width 0.2s, border-left-width 0.2s;
  flex-shrink: 0;
}
.ai-sidebar.open { width: 320px; border-left-width: 1px; }

.ai-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.ai-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); }
.ai-close {
  width: 24px; height: 24px; border: none; background: transparent;
  cursor: pointer; font-size: var(--font-size-base); color: var(--text-secondary);
  border-radius: var(--radius-xs); display: flex; align-items: center; justify-content: center;
}
.ai-close:hover { background: var(--hover-bg); }

.ai-actions {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px;
  border-bottom: 1px solid var(--border-light); flex-shrink: 0;
}
.ai-btn {
  padding: 5px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm);
  cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s;
}
.ai-btn:hover { background: var(--hover-bg); border-color: var(--primary); }
.ai-btn:disabled { opacity: 0.5; cursor: default; }

.ai-loading {
  display: flex; align-items: center; gap: 8px; padding: 16px 12px;
  color: var(--text-secondary); font-size: var(--font-size-sm);
}
.ai-spinner {
  width: 16px; height: 16px; border: 2px solid var(--border-color);
  border-top-color: var(--primary); border-radius: 50%;
  animation: ws-spin 0.6s linear infinite;
}


.ai-result { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.ai-result-header { padding: 8px 12px; flex-shrink: 0; }
.ai-mode-label {
  font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--primary);
  background: var(--primary-light); padding: 2px 8px; border-radius: var(--radius-xs);
}
.ai-result-body {
  flex: 1; overflow-y: auto; padding: 0 12px 12px;
  font-size: var(--font-size-sm); line-height: 1.7; white-space: pre-wrap;
  color: var(--text-color);
}
.ai-result-actions {
  display: flex; gap: 8px; padding: 8px 12px;
  border-top: 1px solid var(--border-light); flex-shrink: 0;
}

.ai-hint {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 20px; text-align: center;
}
.ai-hint p { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0; line-height: 1.6; }
</style>
