<template>
  <Transition name="ws-slide-right">
    <div v-if="visible" class="mm-ai-panel">
      <div class="mm-ai-header">
        <span class="mm-ai-title"><WsIcon name="search" size="sm" /> 关系建议</span>
        <button class="mm-ai-close" @click="$emit('close')">✕</button>
      </div>

      <div v-if="loading" class="mm-ai-loading">
        <span class="mm-ai-spinner"></span> 分析中...
      </div>

      <WsEmpty v-else-if="items.length === 0" preset="no-result" description="暂无建议。点击下方按钮检测潜在关系。" />

      <div v-else class="mm-ai-list">
        <div v-for="sug in items" :key="sug.id" class="mm-ai-card" :class="sug.type">
          <div class="mm-ai-card-header">
            <span class="mm-ai-badge" :class="sug.type">
              {{ sug.type === 'missing' ? '缺失' : sug.type === 'implicit' ? '隐含' : '矛盾' }}
            </span>
            <span class="mm-ai-confidence">{{ Math.round(sug.confidence * 100) }}%</span>
            <button class="mm-ai-dismiss" @click="$emit('dismiss', sug.id)" aria-label="忽略">✕</button>
          </div>
          <div class="mm-ai-card-body">
            <span class="mm-ai-entity">{{ sug.sourceName }}</span>
            <span class="mm-ai-rel">{{ sug.relLabel }}</span>
            <span class="mm-ai-entity">{{ sug.targetName }}</span>
          </div>
          <div class="mm-ai-reason">{{ sug.reason }}</div>
          <div class="mm-ai-actions">
            <button class="mm-ai-accept" @click="$emit('accept', sug)"><WsIcon name="check" size="xs" /> 创建关系</button>
          </div>
        </div>
      </div>

      <div class="mm-ai-footer">
        <button class="mm-ai-analyze" @click="$emit('analyze')"><WsIcon name="search" size="xs" /> 快速分析</button>
        <button class="mm-ai-analyze ai" :disabled="aiAnalyzing" @click="$emit('analyze-ai')"><WsIcon name="concept" size="xs" /> AI 深度分析</button>
        <button class="mm-ai-clear" @click="$emit('clear')">清除</button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { Suggestion } from '../composables/useAISuggestions'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'

defineProps<{
  visible: boolean
  items: Suggestion[]
  loading: boolean
  aiAnalyzing: boolean
}>()

defineEmits<{
  close: []
  analyze: []
  'analyze-ai': []
  clear: []
  dismiss: [id: string]
  accept: [suggestion: Suggestion]
}>()
</script>

<style scoped>
.mm-ai-panel {
  position: absolute;
  top: 50px;
  right: 0;
  width: 280px;
  bottom: 0;
  background: var(--card-bg);
  border-left: 1px solid var(--border-color);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mm-ai-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.mm-ai-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  flex: 1;
}
.mm-ai-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px 4px;
  border-radius: 4px;
}
.mm-ai-close:hover { color: var(--text-color); background: var(--hover-bg); }
.mm-ai-loading {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
.mm-ai-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: ws-spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}

.mm-ai-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.mm-ai-card {
  background: var(--bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  transition: border-color 0.15s;
}
.mm-ai-card.missing { border-left: 3px solid var(--color-warning); }
.mm-ai-card.implicit { border-left: 3px solid var(--color-info); }
.mm-ai-card.contradiction { border-left: 3px solid var(--color-danger); }
.mm-ai-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.mm-ai-badge {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: var(--font-weight-semibold);
}
.mm-ai-badge.missing { background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning); }
.mm-ai-badge.implicit { background: color-mix(in srgb, var(--color-info) 15%, transparent); color: var(--color-info); }
.mm-ai-badge.contradiction { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger); }
.mm-ai-confidence {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-left: auto;
}
.mm-ai-dismiss {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 0 2px;
}
.mm-ai-dismiss:hover { color: var(--text-color); }
.mm-ai-card-body {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.mm-ai-entity {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-ai-rel {
  font-size: var(--font-size-xs);
  color: var(--primary);
  white-space: nowrap;
}
.mm-ai-reason {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  line-height: 1.4;
  margin-bottom: 6px;
}
.mm-ai-actions {
  display: flex;
  gap: 6px;
}
.mm-ai-accept {
  font-size: var(--font-size-xs);
  padding: 3px 10px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.mm-ai-accept:hover {
  background: var(--primary);
  color: var(--on-accent);
}
.mm-ai-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.mm-ai-analyze {
  flex: 1;
  padding: 6px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.mm-ai-analyze:hover {
  background: var(--primary);
  color: var(--on-accent);
}
.mm-ai-analyze.ai { border-color: var(--color-primary); color: var(--color-primary); }
.mm-ai-analyze.ai:hover { background: var(--color-primary); color: var(--color-text-inverse); }
.mm-ai-analyze.ai:disabled { opacity: 0.5; cursor: not-allowed; }
.mm-ai-clear {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.mm-ai-clear:hover { background: var(--hover-bg); color: var(--text-color); }

</style>
