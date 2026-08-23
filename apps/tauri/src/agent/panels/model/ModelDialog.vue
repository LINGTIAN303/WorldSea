<template>
  <Teleport to="body">
    <div class="mdl-overlay" @mousedown.self="onBack" @keydown.esc="onBack">
      <div class="mdl-shell" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <header class="mdl-header">
          <button v-if="onBack || (level === 2 && showBack)" class="mdl-back" type="button" :aria-label="`返回${title}`" @click="onBack">
            <WsIcon name="chevron-left" size="sm" />
          </button>
          <span class="mdl-title">{{ title }}</span>
          <button class="mdl-close" type="button" aria-label="关闭" @click="onClose"><WsIcon name="close" size="sm" /></button>
        </header>
        <div class="mdl-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="mdl-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

const props = withDefaults(defineProps<{
  title: string
  /** 面板层级：1=一级卡片，2=二级，3=三级（用于宽度/纵深差异） */
  level?: number
  /** 主从分栏（供应商→模型）时加宽 */
  wide?: boolean
  /** 三级平移返回二级 */
  showBack?: boolean
}>(), {
  level: 1,
  wide: false,
  showBack: false,
})

const emit = defineEmits<{
  back: []
  close: []
}>()

function onBack(): void {
  if (props.level > 1) emit('back')
}
function onClose(): void {
  emit('close')
}
</script>

<style scoped>
.mdl-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay, 10000);
  background: var(--overlay, rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
}
.mdl-shell {
  display: flex;
  flex-direction: column;
  max-width: 560px;
  width: min(560px, calc(100vw - 48px));
  max-height: 78vh;
  border-radius: var(--radius-md, 10px);
  border: 1px solid var(--color-border, var(--border));
  background: var(--color-surface-elevated, var(--content-bg, var(--bg, var(--color-bg-surface))));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.mdl-shell.wide {
  max-width: 760px;
  width: min(760px, calc(100vw - 48px));
}
.mdl-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border, var(--border));
  flex-shrink: 0;
}
.mdl-back, .mdl-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm, 6px);
  color: var(--color-text-secondary, var(--text-secondary));
  cursor: pointer;
}
.mdl-back:hover, .mdl-close:hover {
  background: var(--color-surface, var(--hover-bg));
  color: var(--color-text, var(--text-color));
}
.mdl-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text, var(--text-color));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mdl-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
}
.mdl-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border, var(--border));
}
</style>