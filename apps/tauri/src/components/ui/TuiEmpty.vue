<script setup lang="ts">
/**
 * TuiEmpty：统一空状态（图标徽标 + 主文案 + 副文案 + 插槽）
 * 视觉语言与对话区空状态一致：bg-muted 圆角徽标 + accent 色弱化图标 + text-secondary 主文案 + text-muted 副文案。
 * 详细why请见 docs/details/注释/tauri/components/TuiEmpty.md
 */
import TuiIcon from './TuiIcon.vue'

withDefaults(
  defineProps<{
    /** 图标名（TuiIcon 集合） */
    icon?: string
    /** 主文案 */
    title?: string
    /** 副文案（纯文本；含 code 等富文本时用默认插槽替代） */
    hint?: string
    /** 紧凑模式（窄面板/列表内嵌）：缩小徽标与间距 */
    compact?: boolean
    /** 撑满模式（独立内容区空状态）：flex:1 垂直居中 */
    fill?: boolean
  }>(),
  { icon: 'info', title: '', hint: '', compact: false, fill: false },
)
</script>

<template>
  <div class="tui-empty" :class="{ compact, fill }">
    <div v-if="icon" class="tui-empty-mark">
      <TuiIcon :name="icon" :size="compact ? 20 : 26" :stroke-width="1.5" />
    </div>
    <p v-if="title" class="tui-empty-title">{{ title }}</p>
    <p v-if="hint" class="tui-empty-hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.tui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  text-align: center;
}
.tui-empty.fill {
  flex: 1;
  min-height: 100%;
}
.tui-empty-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--bg-muted);
  /* 图标弱化色：浅色灰调可辨（--empty-icon #c7cad3），深色 accent 弱化（批次87 #14：修复浅色近隐形） */
  color: var(--empty-icon);
  margin-bottom: 14px;
}
.tui-empty.compact {
  padding: 16px 12px;
}
.tui-empty.compact .tui-empty-mark {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  margin-bottom: 10px;
}
.tui-empty-title {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 4px;
}
.tui-empty-hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--lh-base);
  max-width: 320px;
}
</style>
