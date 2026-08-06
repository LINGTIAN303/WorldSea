<template>
  <div class="ap-stats">
    <div class="ap-stat-item">
      <div class="ap-stat-label">钩子总数</div>
      <div class="ap-stat-value">{{ stats.totalHooks }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">总 Tokens</div>
      <div class="ap-stat-value">{{ stats.totalTokens.toLocaleString() }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">置顶钩子</div>
      <div class="ap-stat-value">{{ stats.pinnedCount }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">活跃钩子</div>
      <div class="ap-stat-value">{{ stats.activeCount }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">淘汰钩子</div>
      <div class="ap-stat-value">{{ stats.deprecatedCount }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">平均重要性</div>
      <div class="ap-stat-value">{{ stats.avgImportance.toFixed(2) }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">平均衰减</div>
      <div class="ap-stat-value">{{ stats.avgDecay.toFixed(3) }}</div>
    </div>
    <div class="ap-stat-item">
      <div class="ap-stat-label">LLM 摘要数</div>
      <div class="ap-stat-value">{{ stats.llmSummaryCount }}</div>
    </div>
    <!-- H3.5 新增统计项 -->
    <div class="ap-stat-item ap-stat-highlight">
      <div class="ap-stat-label">总访问次数</div>
      <div class="ap-stat-value">{{ stats.totalAccessCount }}</div>
    </div>
    <div class="ap-stat-item ap-stat-highlight">
      <div class="ap-stat-label">主动检索次数</div>
      <div class="ap-stat-value">{{ stats.totalActiveAccess }}</div>
    </div>
    <div v-if="metaInfo" class="ap-stat-item ap-stat-highlight">
      <div class="ap-stat-label">存储占用</div>
      <div class="ap-stat-value">{{ formatBytes(metaInfo.totalStorageBytes) }}</div>
    </div>
    <div v-if="stats.orphanCount > 0" class="ap-stat-item ap-stat-warn">
      <div class="ap-stat-label">孤儿钩子</div>
      <div class="ap-stat-value">{{ stats.orphanCount }}</div>
    </div>
    <div v-if="stats.trashedCount > 0" class="ap-stat-item ap-stat-warn">
      <div class="ap-stat-label">回收站钩子</div>
      <div class="ap-stat-value">{{ stats.trashedCount }}</div>
    </div>
    <div v-if="stats.pendingMergeCount > 0" class="ap-stat-item ap-stat-warn">
      <div class="ap-stat-label">待合并钩子</div>
      <div class="ap-stat-value">{{ stats.pendingMergeCount }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** StatsView：记忆库统计视图（从 ArchivePanel 拆分，stats/metaInfo 由父组件传入），详细见 docs/details/注释/web/agent/archive/StatsView.md */
import { formatBytes } from './utils'
import type { ArchiveMeta } from '@worldsmith/memory-archive'

/** 统计数据结构（与父组件 stats computed 返回值一致） */
export interface ArchiveStats {
  totalHooks: number
  totalTokens: number
  pinnedCount: number
  activeCount: number
  deprecatedCount: number
  avgImportance: number
  avgDecay: number
  llmSummaryCount: number
  totalAccessCount: number
  totalActiveAccess: number
  orphanCount: number
  trashedCount: number
  pendingMergeCount: number
}

defineProps<{
  /** 统计数据 */
  stats: ArchiveStats
  /** 记忆库元数据（用于显示存储占用，可为 null） */
  metaInfo: ArchiveMeta | null
}>()
</script>

<style scoped>
.ap-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ap-stat-item {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  padding: 10px 12px;
}

/* H3.5 新增统计项样式 */
.ap-stat-highlight {
  border-color: var(--agent-primary, rgba(108, 92, 231, 0.3));
  background: rgba(108, 92, 231, 0.08);
}
.ap-stat-warn {
  border-color: var(--agent-warning, rgba(243, 156, 18, 0.4));
  background: rgba(243, 156, 18, 0.08);
}

.ap-stat-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  margin-bottom: 4px;
}

.ap-stat-value {
  font-size: var(--font-size-lg);
  color: var(--agent-text, #e0e0e0);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font-mono, monospace);
}
</style>
