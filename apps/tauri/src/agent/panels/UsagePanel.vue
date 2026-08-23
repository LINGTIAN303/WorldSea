<template>
  <div class="sub-panel">
    <div class="usage-section-title">当前会话</div>
    <div class="usage-grid">
      <div class="usage-item">
        <span class="usage-value">{{ totalUsage.requestCount }}</span>
        <span class="usage-label">请求数</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">{{ formatTokens(totalUsage.inputTokens + totalUsage.cacheReadTokens + totalUsage.cacheWriteTokens) }}</span>
        <span class="usage-label">输入 Token</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">{{ formatTokens(totalUsage.outputTokens) }}</span>
        <span class="usage-label">输出 Token</span>
      </div>
      <div class="usage-item" :class="{ 'usage-cache-hit': cacheHitRate > 0 }">
        <span class="usage-value">{{ formatTokens(totalUsage.cacheReadTokens) }}</span>
        <span class="usage-label">缓存命中 ({{ cacheHitRate }}%)</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">{{ formatTokens(totalUsage.cacheWriteTokens) }}</span>
        <span class="usage-label">缓存写入</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">${{ calculatedCost.total.toFixed(4) }}</span>
        <span class="usage-label">总费用</span>
      </div>
      <div v-if="calculatedCost.savedByCache > 0" class="usage-item usage-saved">
        <span class="usage-value">-${{ calculatedCost.savedByCache.toFixed(4) }}</span>
        <span class="usage-label">缓存节省</span>
      </div>
    </div>
    <div class="usage-section-title">累计 (所有会话)</div>
    <div class="usage-grid">
      <div class="usage-item">
        <span class="usage-value">{{ cumulativeUsage.requestCount }}</span>
        <span class="usage-label">请求数</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">{{ formatTokens(cumulativeUsage.inputTokens + cumulativeUsage.cacheReadTokens + cumulativeUsage.cacheWriteTokens) }}</span>
        <span class="usage-label">输入 Token</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">{{ formatTokens(cumulativeUsage.outputTokens) }}</span>
        <span class="usage-label">输出 Token</span>
      </div>
      <div class="usage-item">
        <span class="usage-value">${{ cumulativeUsage.totalCost.toFixed(4) }}</span>
        <span class="usage-label">总费用</span>
      </div>
      <div v-if="cumulativeUsage.savedByCache > 0" class="usage-item usage-saved">
        <span class="usage-value">-${{ cumulativeUsage.savedByCache.toFixed(4) }}</span>
        <span class="usage-label">缓存节省</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  totalUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  calculatedCost: { inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; total: number; savedByCache: number }
  cumulativeUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  cacheHitRate: number
}>()

// Token 数量格式化（K/M 简写）
function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>

<style scoped>
.sub-panel { padding: 8px 0; }
.usage-section-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary, var(--agent-text-tertiary));
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--color-border, var(--agent-border));
}
.usage-section-title:first-child { margin-top: 0; }
.usage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.usage-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 6px 4px; border-radius: var(--radius-mid, 8px);
  background: var(--color-surface, var(--agent-hover-bg));
  border: 1px solid var(--color-border, var(--agent-border));
}
.usage-value {
  font-size: var(--font-size-base); font-weight: var(--font-weight-semibold);
  color: var(--color-primary, var(--agent-primary));
  font-family: var(--font-mono, var(--font-mono, ui-monospace, monospace));
}
.usage-label {
  font-size: var(--font-size-xs); color: var(--color-text-tertiary, var(--agent-text-tertiary));
  margin-top: 2px; text-align: center;
}
.usage-saved .usage-value { color: var(--color-success, #16a34a); }
.usage-cache-hit .usage-value { color: var(--color-success, #16a34a); }
</style>
