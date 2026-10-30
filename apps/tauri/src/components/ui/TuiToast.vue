<script setup lang="ts">
/**
 * TuiToast：全局 Toast 渲染器（右下角堆叠，弱提示风格）
 *
 * 依赖 useTuiToast 模块级单例；在 App 根组件挂载一次即可全局生效。
 * 视觉：白色玻璃卡片 + 左侧语义色条，克制的淡入/滑入过渡。
 * 详细why请见 docs/details/注释/tauri/components/TuiToast.md
 */
import { useTuiToast } from './useTuiToast'
import { WsIcon } from '@worldsea/ui-kit'

const { toasts, dismiss } = useTuiToast()

/** 类型 → 图标 + 色条类 */
const ICONS: Record<string, string> = {
  success: 'check',
  info: 'info',
  warn: 'warning',
  error: 'close',
}
</script>

<template>
  <Teleport to="body">
    <div class="tui-toast" role="status" aria-live="polite">
      <TransitionGroup name="ws-slide-up">
        <div v-for="t in toasts" :key="t.id" class="tui-toast__item" :class="`is-${t.type}`">
          <span class="tui-toast__icon"><WsIcon :name="ICONS[t.type]" :size="13" :stroke-width="1.7" /></span>
          <span class="tui-toast__msg">{{ t.msg }}</span>
          <button class="tui-toast__close" aria-label="关闭" @click="dismiss(t.id)">
            <WsIcon name="close" :size="12" :stroke-width="1.7" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.tui-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 420px;
}
.tui-toast__item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  background: var(--sf-overlay-bg);
  backdrop-filter: var(--sf-overlay-filter, none);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  border: 1px solid var(--sf-overlay-edge);
  box-shadow: var(--sf-overlay-shadow), inset 0 1px 0 var(--sf-highlight);
  font-size: var(--fs-md);
  color: var(--text-primary);
  position: relative;
  overflow: hidden;
}
/* 左侧语义色条：弱而清晰的类型指示 */
.tui-toast__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: var(--radius-pill);
}
.tui-toast__item.is-success::before { background: var(--success); }
.tui-toast__item.is-info::before { background: var(--info); }
.tui-toast__item.is-warn::before { background: var(--warning); }
.tui-toast__item.is-error::before { background: var(--danger); }

.tui-toast__icon {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--text-secondary);
}
.tui-toast__item.is-success .tui-toast__icon { color: var(--success); }
.tui-toast__item.is-info .tui-toast__icon { color: var(--info); }
.tui-toast__item.is-warn .tui-toast__icon { color: var(--warning); }
.tui-toast__item.is-error .tui-toast__icon { color: var(--danger); }

.tui-toast__msg {
  flex: 1;
  line-height: 1.45;
  word-break: break-word;
}
.tui-toast__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.tui-toast__close:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
/* 按压反馈（批次89） */
.tui-toast__close:active {
  transform: scale(var(--sf-press-scale, var(--press-scale)));
}

</style>
