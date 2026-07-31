<template>
  <!-- 列表视图 -->
  <div v-if="mode === 'list'" class="ap-list">
    <div v-if="hooks.length === 0" class="ap-empty">暂无记忆钩子</div>
    <div
      v-for="hook in hooks"
      :key="hook.id"
      class="ap-hook-card"
      :class="{ pinned: hook.pinned }"
      @click="emit('open-detail', hook.id)"
    >
      <div class="ap-hook-header">
        <WsIcon
          :name="hook.pinned ? 'star' : 'star-outline'"
          size="xs"
          :class="{ 'ap-pinned-icon': hook.pinned }"
          @click.stop="emit('toggle-pin', hook)"
        />
        <span class="ap-hook-date">{{ formatDate(hook.createdAt) }}</span>
        <span class="ap-hook-tokens">{{ hook.tokenCount.toLocaleString() }} tok</span>
        <span class="ap-hook-status" :class="`ap-status-${hook.status}`">{{ statusLabel(hook.status) }}</span>
      </div>
      <div class="ap-hook-summary">{{ hook.summary || '(无摘要)' }}</div>
      <div v-if="hook.keywords.length > 0 || hook.tags.length > 0" class="ap-hook-tags">
        <span v-for="kw in hook.keywords.slice(0, 3)" :key="kw" class="ap-kw">{{ kw }}</span>
        <span v-for="tag in hook.tags.slice(0, 3)" :key="tag" class="ap-tag">{{ tag }}</span>
      </div>
    </div>
  </div>

  <!-- 详情视图 -->
  <div v-else-if="mode === 'detail'" class="ap-detail">
    <div v-if="!selectedHook" class="ap-empty">未选择钩子</div>
    <template v-else>
      <div class="ap-detail-meta">
        <div class="ap-meta-row">
          <span class="ap-meta-label">ID</span>
          <span class="ap-meta-value ap-mono">{{ selectedHook.id }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">创建时间</span>
          <span class="ap-meta-value">{{ formatDateTime(selectedHook.createdAt) }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">来源</span>
          <span class="ap-meta-value">{{ sourceLabel(selectedHook.source) }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">摘要方式</span>
          <span class="ap-meta-value">{{ selectedHook.summaryMethod }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">Tokens</span>
          <span class="ap-meta-value">{{ selectedHook.tokenCount.toLocaleString() }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">消息范围</span>
          <span class="ap-meta-value">{{ selectedHook.messageRange.start }} - {{ selectedHook.messageRange.end }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">访问次数</span>
          <span class="ap-meta-value">{{ selectedHook.accessCount }} (主动 {{ selectedHook.activeAccessCount }})</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">最后访问</span>
          <span class="ap-meta-value">{{ selectedHook.lastAccessedAt ? formatDateTime(selectedHook.lastAccessedAt) : '从未' }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">衰减评分</span>
          <span class="ap-meta-value">{{ selectedHook.decayScore.toFixed(3) }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">重要性</span>
          <span class="ap-meta-value">{{ selectedHook.importance.toFixed(2) }}</span>
        </div>
        <div class="ap-meta-row">
          <span class="ap-meta-label">状态</span>
          <span class="ap-meta-value ap-status" :class="`ap-status-${selectedHook.status}`">{{ statusLabel(selectedHook.status) }}</span>
        </div>
      </div>

      <!-- 摘要全文 -->
      <div class="ap-section">
        <div class="ap-section-label">摘要</div>
        <div class="ap-summary-full">{{ selectedHook.summary || '(无摘要)' }}</div>
      </div>

      <!-- 主题块列表 -->
      <div class="ap-section">
        <div class="ap-section-label">主题块 ({{ selectedHook.chunkTitles.length }})</div>
        <div class="ap-chunks">
          <div
            v-for="chunk in selectedHook.chunkTitles"
            :key="chunk.chunkId"
            class="ap-chunk-item"
            @click="emit('open-chunk', chunk.chunkId)"
          >
            <WsIcon name="folder-open" size="xs" />
            <div class="ap-chunk-info">
              <div class="ap-chunk-title">{{ chunk.title }}</div>
              <div class="ap-chunk-meta">
                <span :class="`ap-type-${chunk.outputType}`">{{ chunk.outputType }}</span>
                <span>{{ chunk.tokenCount.toLocaleString() }} tok</span>
              </div>
              <div class="ap-chunk-anchor">{{ chunk.userMessageAnchor }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 关键词 -->
      <div v-if="selectedHook.keywords.length > 0" class="ap-section">
        <div class="ap-section-label">关键词</div>
        <div class="ap-tags-wrap">
          <span v-for="kw in selectedHook.keywords" :key="kw" class="ap-kw">{{ kw }}</span>
        </div>
      </div>

      <!-- 标签（可编辑） -->
      <div class="ap-section">
        <div class="ap-section-label">标签</div>
        <div class="ap-tags-wrap">
          <span v-for="tag in selectedHook.tags" :key="tag" class="ap-tag ap-tag-removable">
            {{ tag }}
            <button class="ap-tag-remove" @click.stop="emit('remove-tag', tag)">✕</button>
          </span>
          <input
            :value="newTagInput"
            class="ap-tag-input"
            placeholder="+ 添加标签"
            @input="emit('update:newTagInput', ($event.target as HTMLInputElement).value)"
            @keydown.enter="emit('add-tag')"
          />
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="ap-detail-actions">
        <button class="ap-action-btn" @click="emit('toggle-pin', selectedHook)">
          <WsIcon :name="selectedHook.pinned ? 'star' : 'star-outline'" size="xs" />
          {{ selectedHook.pinned ? '取消置顶' : '置顶' }}
        </button>
        <button class="ap-action-btn ap-danger" @click="emit('confirm-delete')">
          <WsIcon name="delete" size="xs" /> 删除
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * HookListView - 钩子列表 + 详情视图
 *
 * 从 ArchivePanel.vue 拆分。纯 UI 组件：
 * - 列表模式（mode='list'）：展示所有钩子卡片
 * - 详情模式（mode='detail'）：展示选中钩子的详细信息
 *
 * 所有状态和操作由父组件管理，通过 props/emits 交互。
 */
import WsIcon from '../../ui/WsIcon.vue'
import type { Hook } from '@worldsmith/memory-archive'
import { formatDate, formatDateTime, statusLabel, sourceLabel } from './utils'

defineProps<{
  /** 当前模式：list=列表，detail=详情 */
  mode: 'list' | 'detail'
  /** 所有钩子列表（list 模式用） */
  hooks: Hook[]
  /** 当前选中的钩子（detail 模式用） */
  selectedHook: Hook | null
  /** 新标签输入值（detail 模式用，v-model） */
  newTagInput: string
}>()

const emit = defineEmits<{
  /** 点击钩子卡片，请求打开详情 */
  'open-detail': [hookId: string]
  /** 切换置顶状态 */
  'toggle-pin': [hook: Hook]
  /** 添加标签 */
  'add-tag': []
  /** 移除标签 */
  'remove-tag': [tag: string]
  /** 确认删除（二次点击触发） */
  'confirm-delete': []
  /** 打开 chunk 查看器 */
  'open-chunk': [chunkId: string]
  /** 新标签输入双向绑定 */
  'update:newTagInput': [value: string]
}>()
</script>

<style scoped>
/* 列表视图 */
.ap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-hook-card {
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  transition: border-color 0.15s;
}
.ap-hook-card:hover {
  border-color: var(--agent-primary, #6c5ce7);
}
.ap-hook-card.pinned {
  border-color: var(--agent-warning, #fdcb6e);
  background: rgba(253, 203, 110, 0.05);
}

.ap-hook-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  margin-bottom: 4px;
}

.ap-pinned-icon { color: var(--agent-warning, #fdcb6e); }

.ap-hook-date {
  color: var(--agent-text-tertiary, #666);
}

.ap-hook-tokens {
  color: var(--agent-text-secondary, #aaa);
  margin-left: auto;
}

.ap-hook-status {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
}
.ap-status-active { background: rgba(100, 200, 100, 0.2); color: #6c8; }
.ap-status-deprecated { background: rgba(200, 100, 100, 0.2); color: #c68; }
.ap-status-pending_delete { background: rgba(200, 100, 100, 0.3); color: #f88; }

.ap-hook-summary {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary, #aaa);
  line-height: 1.4;
  max-height: 60px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.ap-hook-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.ap-kw, .ap-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.ap-kw { background: rgba(108, 92, 231, 0.2); color: var(--agent-text, #e0e0e0); }
.ap-tag { background: rgba(100, 149, 237, 0.2); color: #6cf; }

/* 详情视图 */
.ap-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ap-detail-meta {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.08));
  border-radius: var(--agent-radius-sm, 8px);
  padding: 10px 12px;
}

.ap-meta-row {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  font-size: var(--font-size-xs);
}

.ap-meta-label {
  color: var(--agent-text-tertiary, #666);
  min-width: 72px;
}

.ap-meta-value {
  color: var(--agent-text, #e0e0e0);
  flex: 1;
  word-break: break-all;
}

.ap-mono { font-family: var(--agent-font-mono, monospace); font-size: 11px; }

.ap-status {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
}

.ap-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ap-summary-full {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary, #aaa);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.15);
  padding: 8px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  max-height: 200px;
  overflow-y: auto;
}

.ap-chunks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-chunk-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
}
.ap-chunk-item:hover { border-color: var(--agent-primary, #6c5ce7); }

.ap-chunk-info { flex: 1; min-width: 0; }

.ap-chunk-title {
  font-size: var(--font-size-xs);
  color: var(--agent-text, #e0e0e0);
  font-weight: var(--font-weight-medium);
}

.ap-chunk-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
}

.ap-type-text { color: #6cf; }
.ap-type-tool_call { color: var(--agent-warning, #fdcb6e); }
.ap-type-entity_op { color: #6c8; }
.ap-type-code { color: #a6c; }
.ap-type-analysis { color: #6cc; }
.ap-type-creative { color: #c6c; }

.ap-chunk-anchor {
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ap-tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.ap-tag-removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ap-tag-remove {
  background: none;
  border: none;
  color: var(--agent-text-tertiary, #666);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
}
.ap-tag-remove:hover { color: var(--agent-danger, #e57373); }

.ap-tag-input {
  background: transparent;
  border: 1px dashed var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  width: 100px;
  outline: none;
  font-family: var(--agent-font, sans-serif);
}
.ap-tag-input:focus { border-color: var(--agent-primary, #6c5ce7); border-style: solid; }

.ap-detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.ap-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: var(--agent-font, sans-serif);
}
.ap-action-btn:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }
.ap-action-btn.ap-danger { color: var(--agent-danger, #e57373); border-color: var(--agent-danger, #e57373); }
.ap-action-btn.ap-danger:hover { background: rgba(229, 115, 115, 0.1); }

.ap-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}
</style>
