<template>
  <!-- [⑥] 会话错误行：红线 StateDot + 标题 + message + 可选 code。data 来自 activity log error 项派生 -->
  <div v-if="error" class="error-row" role="status">
    <span class="error-dot" />
    <div class="error-copy">
      <span class="error-title">会话出错</span>
      <span class="error-message">{{ error.message }}</span>
      <!-- A5 收尾（2026-09-17）：结构化提示（可重试 / 服务端建议等待），来自流通道 error 字段 -->
      <span v-if="retryHint" class="error-hint">{{ retryHint }}</span>
    </div>
    <code v-if="error.code" class="error-code">{{ error.code }}</code>
  </div>
</template>

<script setup lang="ts">
/** 由外部 ActivityLog 的 error 项派生传入（type=error） */
export interface ErrorRowItem {
  message: string
  code?: string
  timestamp?: number
}

defineProps<{
  error: ErrorRowItem | null
  /** A5 收尾：终态错误结构化提示（如「瞬时性故障，可重试；服务端建议约 5 秒后重试」） */
  retryHint?: string
}>()
</script>

<style scoped>
.error-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--danger, #ef4444);
  background: color-mix(in srgb, var(--danger, #ef4444) 6%, transparent);
  border-radius: 6px;
  font-size: var(--font-size-xs);
}
.error-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  flex-shrink: 0;
}
.error-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.error-title {
  font-weight: 600;
  color: var(--danger, #ef4444);
}
.error-message {
  color: var(--agent-text-secondary, inherit);
}
.error-hint {
  color: var(--warning, #f59e0b);
  font-size: var(--font-size-2xs, 11px);
}
.error-code {
  flex-shrink: 0;
  font-family: monospace;
  font-size: var(--font-size-2xs);
  color: var(--danger, #ef4444);
}
</style>