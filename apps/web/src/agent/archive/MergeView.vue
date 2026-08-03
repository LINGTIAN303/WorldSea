<template>
  <div class="ap-merge">
    <div class="ap-merge-header">
      <span class="ap-merge-count">待合并 ({{ mergeGroups.length }} 组)</span>
      <div v-if="mergeGroups.length > 0" class="ap-merge-actions">
        <button class="ap-merge-confirm-all" @click="confirmAllMerges" :disabled="mergeLoading">
          全部确认合并
        </button>
      </div>
    </div>
    <div v-if="mergeLoading" class="ap-empty">加载中...</div>
    <div v-else-if="mergeGroups.length === 0" class="ap-empty">暂无待合并项</div>
    <div v-else class="ap-merge-list">
      <div
        v-for="(group, idx) in mergeGroups"
        :key="group.mainHook.id"
        class="ap-merge-group"
      >
        <div class="ap-merge-group-header">
          <span class="ap-merge-group-title">组 {{ idx + 1 }}</span>
          <span class="ap-merge-group-count">{{ group.pendingHooks.length }} 项待合并</span>
          <button class="ap-merge-confirm-btn" @click="confirmOneMerge(group.mainHook.id)" :disabled="mergeLoading">
            确认合并
          </button>
        </div>
        <div class="ap-merge-main">
          <div class="ap-merge-label">主钩子（保留）</div>
          <div class="ap-merge-hook-card ap-merge-main-card">
            <div class="ap-merge-hook-summary">{{ group.mainHook.summary || '(无摘要)' }}</div>
            <div class="ap-merge-hook-meta">
              <span>{{ formatDate(group.mainHook.createdAt) }}</span>
              <span>{{ group.mainHook.tokenCount.toLocaleString() }} tok</span>
              <span>衰减 {{ group.mainHook.decayScore.toFixed(2) }}</span>
            </div>
            <div v-if="group.mainHook.keywords.length > 0" class="ap-merge-keywords">
              <span v-for="kw in group.mainHook.keywords.slice(0, 5)" :key="kw" class="ap-kw">{{ kw }}</span>
            </div>
          </div>
        </div>
        <div class="ap-merge-pending">
          <div class="ap-merge-label">待合并钩子（将标记为已淘汰）</div>
          <div
            v-for="ph in group.pendingHooks"
            :key="ph.id"
            class="ap-merge-hook-card ap-merge-pending-card"
          >
            <div class="ap-merge-hook-summary">{{ ph.summary || '(无摘要)' }}</div>
            <div class="ap-merge-hook-meta">
              <span>{{ formatDate(ph.createdAt) }}</span>
              <span>{{ ph.tokenCount.toLocaleString() }} tok</span>
              <span>衰减 {{ ph.decayScore.toFixed(2) }}</span>
            </div>
            <div v-if="ph.keywords.length > 0" class="ap-merge-keywords">
              <span v-for="kw in ph.keywords.slice(0, 5)" :key="kw" class="ap-kw">{{ kw }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MergeView - 待合并钩子管理视图
 *
 * 从 ArchivePanel.vue 拆分。自包含合并状态和逻辑：
 * - 加载待合并组
 * - 确认单组合并
 * - 确认全部合并
 *
 * 通过 emit 'merged' 通知父组件刷新主钩子列表。
 */
import { ref, onMounted, watch } from 'vue'
import { useMemoryArchive } from '../../memory-archive'
import { toastError } from '@/composables/useToast'
import { formatDate } from './utils'
import type { Hook } from '@worldsmith/memory-archive'

const emit = defineEmits<{
  /** 合并完成后，通知父组件刷新主列表 */
  merged: []
  /** 待合并组数量变化（用于 tab badge 显示） */
  'count-change': [count: number]
}>()

const memoryArchive = useMemoryArchive()

// ===== 待合并状态 =====
interface MergeGroup {
  mainHook: Hook
  pendingHooks: Hook[]
}
const mergeGroups = ref<MergeGroup[]>([])
const mergeLoading = ref(false)

/** 加载待合并组 */
async function loadMergeGroups(): Promise<void> {
  mergeLoading.value = true
  try {
    mergeGroups.value = memoryArchive.getPendingMergeGroups()
  } catch (err) {
    console.warn('[MergeView] 加载待合并组失败:', err)
    mergeGroups.value = []
  } finally {
    mergeLoading.value = false
  }
}

/** 确认单组合并 */
async function confirmOneMerge(_mainHookId: string): Promise<void> {
  mergeLoading.value = true
  try {
    // 由于 confirmMerge 会合并所有 pending_merge，这里先记录当前组数
    const beforeCount = mergeGroups.value.length
    const mergedCount = await memoryArchive.confirmMerge()
    emit('merged')
    await loadMergeGroups()
    console.log(`[MergeView] 合并完成: ${mergedCount} 组（之前 ${beforeCount} 组）`)
  } catch (err) {
    console.warn('[MergeView] 确认合并失败:', err)
    toastError('确认合并失败')
  } finally {
    mergeLoading.value = false
  }
}

/** 确认全部合并 */
async function confirmAllMerges(): Promise<void> {
  mergeLoading.value = true
  try {
    const mergedCount = await memoryArchive.confirmMerge()
    emit('merged')
    await loadMergeGroups()
    console.log(`[MergeView] 全部合并完成: ${mergedCount} 组`)
  } catch (err) {
    console.warn('[MergeView] 全部合并失败:', err)
    toastError('全部合并失败')
  } finally {
    mergeLoading.value = false
  }
}

// 数量变化时通知父组件（用于 tab badge）
watch(mergeGroups, (val) => {
  emit('count-change', val.length)
}, { immediate: true })

// 挂载时自动加载（v-if 切换会重新挂载，等同于原 watch subPanel==='merge' 的效果）
onMounted(loadMergeGroups)
</script>

<style scoped>
/* H5.3 待合并视图 */
.ap-merge {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ap-merge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}
.ap-merge-count {
  font-weight: 600;
  color: var(--agent-text-primary, #e4e4e7);
}
.ap-merge-actions {
  display: flex;
  gap: 6px;
}
.ap-merge-confirm-all,
.ap-merge-confirm-btn {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--agent-primary, #6c5ce7);
  background: rgba(108, 92, 231, 0.15);
  color: var(--agent-primary, #6c5ce7);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
}
.ap-merge-confirm-all:hover:not(:disabled),
.ap-merge-confirm-btn:hover:not(:disabled) {
  background: rgba(108, 92, 231, 0.25);
}
.ap-merge-confirm-all:disabled,
.ap-merge-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ap-merge-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-merge-group {
  padding: 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}
.ap-merge-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ap-merge-group-title {
  font-weight: 600;
  font-size: 12px;
  color: var(--agent-text-primary, #e4e4e7);
}
.ap-merge-group-count {
  font-size: 11px;
  color: var(--agent-text-muted, #71717a);
}
.ap-merge-main,
.ap-merge-pending {
  margin-bottom: 6px;
}
.ap-merge-label {
  font-size: 10px;
  color: var(--agent-text-muted, #71717a);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ap-merge-hook-card {
  padding: 8px;
  border-radius: var(--agent-radius-sm, 6px);
  margin-bottom: 4px;
}
.ap-merge-main-card {
  background: rgba(108, 92, 231, 0.08);
  border: 1px solid rgba(108, 92, 231, 0.2);
}
.ap-merge-pending-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.15));
  opacity: 0.8;
}
.ap-merge-hook-summary {
  font-size: 12px;
  color: var(--agent-text-primary, #e4e4e7);
  margin-bottom: 4px;
  line-height: 1.4;
}
.ap-merge-hook-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--agent-text-muted, #71717a);
}
.ap-merge-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 4px;
}
.ap-kw {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(108, 92, 231, 0.2);
  color: var(--agent-text, #e0e0e0);
}
.ap-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}
</style>
