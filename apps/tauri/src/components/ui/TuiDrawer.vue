<script setup lang="ts">
/**
 * TuiDrawer：Tauri 端统一侧滑抽屉（替代 WsDrawer，纳入 Tui 体系）
 *
 * 提供：遮罩模糊 + 侧向滑入过渡、Esc 关闭、点击遮罩关闭（可关）、
 * 打开时聚焦面板并做焦点陷阱（键盘可达）。placement 支持 left/right。
 * 视觉与全局令牌一致，reduced-motion 下退化为温和淡入。
 * 详细why请见 docs/details/注释/tauri/components/TuiDrawer.md
 */
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon, setShortcutModalActive } from '@worldsmith/ui-kit'

// 注册表弹窗深度守卫标记（本实例是否已入栈，防重复/泄漏）
let modalGuardActive = false

const props = withDefaults(
  defineProps<{
    /** 是否显示（v-model 语义，由父级控制） */
    show: boolean
    /** 抽屉标题（header 插槽存在时不渲染） */
    title?: string
    /** 滑出侧：left / right */
    placement?: 'left' | 'right'
    /** 面板宽度档位 */
    size?: 'sm' | 'md' | 'lg'
    /** 点击遮罩是否关闭（默认 true） */
    maskClosable?: boolean
    /** 是否显示右上角关闭按钮（默认 true） */
    closable?: boolean
  }>(),
  { title: '', placement: 'right', size: 'md', maskClosable: true, closable: true },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const panelEl = ref<HTMLElement | null>(null)
/** 打开前的焦点元素：关闭后还原，保证键盘/鼠标操作位置不丢失 */
let returnFocusEl: HTMLElement | null = null

/** 焦点陷阱：Tab 在抽屉内可聚焦元素间循环，避免焦点逃逸到背景页面 */
function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'Tab') {
    const panel = panelEl.value
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

function onMaskClick() {
  if (props.maskClosable) emit('close')
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      const ae = document.activeElement
      if (ae && !panelEl.value?.contains(ae)) returnFocusEl = ae as HTMLElement | null
      window.addEventListener('keydown', onKeydown)
      // 注册表弹窗深度 +1：弹窗打开期间 view/global 层快捷键失效（modal 优先）
      if (!modalGuardActive) { setShortcutModalActive(true); modalGuardActive = true }
      nextTick(() => {
        const first =
          panelEl.value?.querySelector<HTMLElement>(
            'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
          ) ?? panelEl.value
        first?.focus({ preventScroll: true })
      })
    } else {
      window.removeEventListener('keydown', onKeydown)
      if (modalGuardActive) { setShortcutModalActive(false); modalGuardActive = false }
      returnFocusEl?.focus?.({ preventScroll: true })
      returnFocusEl = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  // 卸载时若仍在弹窗态需出栈，防止注册表弹窗深度泄漏
  if (modalGuardActive) { setShortcutModalActive(false); modalGuardActive = false }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="tui-drawer-mask">
      <div v-if="show" class="tui-drawer-mask" @mousedown.self="onMaskClick"></div>
    </Transition>
    <Transition :name="`tui-drawer-${placement}`">
      <div
        v-if="show"
        ref="panelEl"
        :class="['tui-drawer', `tui-drawer--${placement}`, `tui-drawer--${size}`]"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <header class="tui-drawer__header">
          <slot name="header">
            <h2 class="tui-drawer__title">{{ title }}</h2>
          </slot>
          <button v-if="closable" class="tui-drawer__close" aria-label="关闭" @click="emit('close')">
            <WsIcon name="close" :size="14" :stroke-width="1.7" />
          </button>
        </header>

        <div class="tui-drawer__body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="tui-drawer__footer">
          <slot name="footer" />
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tui-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
}
.tui-drawer {
  position: fixed;
  top: 0;
  height: 100vh;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
  outline: none;
}
.tui-drawer--right {
  right: 0;
  border-left: 1px solid var(--border);
}
.tui-drawer--left {
  left: 0;
  border-right: 1px solid var(--border);
}
.tui-drawer--sm { width: 320px; }
.tui-drawer--md { width: 480px; }
.tui-drawer--lg { width: 640px; }

.tui-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px var(--spacing-modal-x, 20px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tui-drawer__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-drawer__close {
  flex-shrink: 0;
  width: var(--icon-btn-lg);
  height: var(--icon-btn-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.tui-drawer__close:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.tui-drawer__close:active {
  transform: scale(var(--press-scale));
}

.tui-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px var(--spacing-modal-x, 20px);
  min-height: 0;
}
.tui-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px var(--spacing-modal-x, 20px);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* 遮罩：淡入淡出 */
.tui-drawer-mask-enter-active,
.tui-drawer-mask-leave-active {
  transition: opacity var(--dur-base) var(--ease);
}
.tui-drawer-mask-enter-from,
.tui-drawer-mask-leave-to {
  opacity: 0;
}

/* 面板：从触发侧滑入，仅动 transform（GPU 加速） */
.tui-drawer-right-enter-active,
.tui-drawer-right-leave-active,
.tui-drawer-left-enter-active,
.tui-drawer-left-leave-active {
  transition: transform var(--dur-base) var(--ease-out);
}
.tui-drawer-right-enter-from,
.tui-drawer-right-leave-to {
  transform: translateX(100%);
}
.tui-drawer-left-enter-from,
.tui-drawer-left-leave-to {
  transform: translateX(-100%);
}
/* 减弱动态偏好：去掉位移动画，保留淡入（Emil 可访问性规则） */
:root[data-anim-overlays='off'] .tui-drawer-right-enter-active,
:root[data-anim-overlays='off'] .tui-drawer-right-leave-active,
:root[data-anim-overlays='off'] .tui-drawer-left-enter-active,
:root[data-anim-overlays='off'] .tui-drawer-left-leave-active {
  transition: opacity var(--dur-base) var(--ease);
}
:root[data-anim-overlays='off'] .tui-drawer-right-enter-from,
:root[data-anim-overlays='off'] .tui-drawer-right-leave-to,
:root[data-anim-overlays='off'] .tui-drawer-left-enter-from,
:root[data-anim-overlays='off'] .tui-drawer-left-leave-to {
  transform: none;
  opacity: 0;
}
</style>
