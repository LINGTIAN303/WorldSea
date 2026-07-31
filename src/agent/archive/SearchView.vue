<template>
  <div class="ap-search">
    <div class="ap-search-bar">
      <input
        v-model="searchQuery"
        class="ap-search-input"
        placeholder="输入关键词搜索..."
        @keydown.enter="doSearch"
      />
      <select v-model="searchMode" class="ap-search-mode">
        <option value="keyword">关键词</option>
        <option value="semantic">语义</option>
        <option value="hybrid">混合</option>
        <option value="list">列表</option>
      </select>
      <button class="ap-search-btn" @click="doSearch"><WsIcon name="search" size="xs" /></button>
    </div>
    <!-- H3.4: 搜索模式说明 -->
    <div class="ap-search-hint">
      <span v-if="searchMode === 'keyword'">关键词模式：按关键词精确匹配，适合搜索特定实体/概念</span>
      <span v-else-if="searchMode === 'semantic'">语义模式：按语义相似度匹配，需要 Embedding 模型支持</span>
      <span v-else-if="searchMode === 'hybrid'">混合模式：结合关键词和语义，效果最佳</span>
      <span v-else>列表模式：按时间倒序列出所有钩子</span>
    </div>
    <div v-if="searchLoading" class="ap-empty">搜索中...</div>
    <div v-else-if="searchResults.length === 0 && searchDone" class="ap-empty">无匹配结果</div>
    <div v-else class="ap-search-results">
      <div
        v-for="result in searchResults"
        :key="result.hook.id"
        class="ap-search-item"
        @click="emit('open-detail', result.hook.id)"
      >
        <div class="ap-search-header">
          <!-- H4.2: score 可视化条 -->
          <div class="ap-search-score-bar">
            <div class="ap-search-score-fill" :style="{ width: Math.min(100, result.score * 10) + '%' }"></div>
            <span class="ap-search-score">{{ result.score.toFixed(2) }}</span>
          </div>
          <span class="ap-hook-date">{{ formatDate(result.hook.createdAt) }}</span>
        </div>
        <div class="ap-hook-summary">{{ result.hook.summary || '(无摘要)' }}</div>
        <!-- H4.2: 匹配字段详细展示 -->
        <div v-if="result.matchedFields.length > 0" class="ap-matched">
          <span
            v-for="field in result.matchedFields"
            :key="field"
            class="ap-matched-field"
            :class="`ap-matched-${field.split(':')[0]}`"
          >{{ field }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SearchView - 记忆搜索视图
 *
 * 从 ArchivePanel.vue 拆分。自包含搜索状态和逻辑：
 * - 4 种搜索模式（keyword/semantic/hybrid/list）
 * - 搜索结果展示（含 score 可视化、匹配字段标签）
 *
 * 通过 emit 'open-detail' 通知父组件打开钩子详情。
 */
import { ref } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useMemoryArchive } from '../../memory-archive'
import { toastError } from '@/composables/useToast'
import { formatDate } from './utils'
import type { RecallMode, RecallResult } from '@worldsmith/memory-archive'

const emit = defineEmits<{
  /** 点击搜索结果，请求打开钩子详情 */
  'open-detail': [hookId: string]
}>()

const memoryArchive = useMemoryArchive()

// ===== 搜索状态 =====
const searchQuery = ref('')
const searchMode = ref<RecallMode>('hybrid')
const searchResults = ref<RecallResult[]>([])
const searchLoading = ref(false)
const searchDone = ref(false)

/** 执行搜索 */
async function doSearch(): Promise<void> {
  if (searchLoading.value) return
  searchLoading.value = true
  searchDone.value = false
  try {
    const results = await memoryArchive.recall({
      query: searchQuery.value,
      mode: searchMode.value,
      topK: 20,
    })
    searchResults.value = results
  } catch (err) {
    console.warn('[SearchView] 搜索失败:', err)
    searchResults.value = []
    toastError('搜索记忆失败')
  } finally {
    searchLoading.value = false
    searchDone.value = true
  }
}
</script>

<style scoped>
.ap-search {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ap-search-bar {
  display: flex;
  gap: 4px;
}

.ap-search-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 6px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font, sans-serif);
}
.ap-search-input:focus { border-color: var(--agent-primary, #6c5ce7); }

.ap-search-mode {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 6px 8px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font, sans-serif);
}

.ap-search-btn {
  background: var(--agent-primary, #6c5ce7);
  border: none;
  color: white;
  padding: 6px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.ap-search-btn:hover { opacity: 0.85; }

.ap-search-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-search-item {
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
}
.ap-search-item:hover { border-color: var(--agent-primary, #6c5ce7); }

.ap-search-header {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  margin-bottom: 2px;
}

.ap-hook-date {
  color: var(--agent-text-tertiary, #666);
}

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

.ap-search-score {
  color: var(--agent-warning, #fdcb6e);
  font-family: var(--agent-font-mono, monospace);
}

/* H4.2: score 可视化条 */
.ap-search-score-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  height: 4px;
  position: relative;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 2px;
  overflow: hidden;
}
.ap-search-score-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--agent-primary, #6c5ce7);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.ap-search-score-bar .ap-search-score {
  position: relative;
  z-index: 1;
  font-size: 10px;
  padding-left: 6px;
}

/* H3.4: 搜索模式说明 */
.ap-search-hint {
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary, #666);
  padding: 2px 0;
  margin-bottom: 4px;
}

/* H4.2: 匹配字段标签 */
.ap-matched-field {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 4px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(108, 92, 231, 0.15);
  color: var(--agent-text-secondary, #aaa);
}
.ap-matched-field.ap-matched-keyword {
  background: rgba(46, 204, 113, 0.15);
  color: #2ecc71;
}
.ap-matched-field.ap-matched-chunkTitle {
  background: rgba(52, 152, 219, 0.15);
  color: #3498db;
}

.ap-matched {
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
}

.ap-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}
</style>
