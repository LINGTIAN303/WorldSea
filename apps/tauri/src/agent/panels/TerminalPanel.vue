<template>
  <div class="sub-panel">
    <div class="settings-section">
      <div class="settings-label">本地终端</div>
      <div class="settings-hint">
        Tauri 桌面模式通过原生 PTY 调用本地终端（terminal_* 命令），无需额外服务。
      </div>
    </div>
    <div class="terminal-embed">
      <TerminalView />
    </div>
  </div>
</template>

<script setup lang="ts">
import TerminalView from '@/terminal/components/TerminalView.vue'
</script>

<style scoped>
.sub-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-label {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.settings-hint {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}

.terminal-embed {
  height: 360px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
</style>
