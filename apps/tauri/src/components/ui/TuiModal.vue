<script setup lang="ts">
/**
 * TuiModal：Tauri 端弹窗基座（统一交互与视觉）
 *
 * 提供：遮罩模糊 + 缩放/淡入过渡、Esc 关闭、点击遮罩关闭（可关）、
 * 打开时自动聚焦面板（键盘可达）。所有弹窗（模型配置 / 确认框 / 导入导出）
 * 统一走本组件，消除各弹窗样式与行为分叉。
 * 详细why请见 docs/details/注释/tauri/components/TuiModal.md
 */
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = withDefaults(
  defineProps<{
    /** 是否显示（v-model 语义，由父级控制） */
    show: boolean
    /** 弹窗标题（header 插槽存在时不渲染） */
    title?: string
    /** 面板宽度档位 */
    size?: 'sm' | 'md' | 'lg'
    /** 点击遮罩是否关闭（默认 true） */
    maskClosable?: boolean
    /** 是否显示右上角关闭按钮（默认 true） */
    closable?: boolean
  }>(),
  { title: '', size: 'md', maskClosable: true, closable: true },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open'): void
}>()

const panelEl = ref<HTMLElement | null>(null)
/** 打开弹窗前的焦点元素：关闭后还原，保证键盘/鼠标操作位置不丢失 */
let returnFocusEl: HTMLElement | null = null

/* ── 多弹窗并发管理（批次90 5.1）──
   模块级计数器 + 打开栈：每个实例唯一 id；仅栈顶弹窗响应 Esc/Tab，
   避免一次 Esc 关闭全部弹窗、多个弹窗 aria-labelledby 指向同一标题。 */
let modalSeq = 0
const openStack: number[] = []
const instanceId = ++modalSeq
const instanceLabelId = `tui-modal-title-${instanceId}`

/** 当前实例是否栈顶（最后打开的弹窗） */
const isTop = () => openStack[openStack.length - 1] === instanceId

function onKeydown(e: KeyboardEvent) {
  if (!props.show || !isTop()) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  // 焦点陷阱：Tab 在弹窗内可聚焦元素间循环，避免焦点逃逸到背景页面
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

// 打开时挂载 Esc 监听并聚焦面板；关闭时移除
watch(
  () => props.show,
  (show) => {
    if (show) {
      emit('open')
      // 记录打开前的焦点元素（若焦点在弹窗内则向上找最近非弹窗元素）
      const ae = document.activeElement
      if (ae && !panelEl.value?.contains(ae)) returnFocusEl = ae as HTMLElement | null
      // 入栈：本实例成为栈顶
      if (!openStack.includes(instanceId)) openStack.push(instanceId)
      window.addEventListener('keydown', onKeydown)
      // 聚焦首个可交互控件（input/select/button）；无则聚焦面板（批次90 1.3）
      nextTick(() => {
        const first =
          panelEl.value?.querySelector<HTMLElement>(
            'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
          ) ?? panelEl.value
        first?.focus({ preventScroll: true })
      })
    } else {
      window.removeEventListener('keydown', onKeydown)
      // 出栈
      const i = openStack.indexOf(instanceId)
      if (i >= 0) openStack.splice(i, 1)
      // 关闭后还原焦点到打开前位置（Esc/遮罩/取消按钮等关闭路径统一还原）
      returnFocusEl?.focus?.({ preventScroll: true })
      returnFocusEl = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="tui-modal">
      <div v-if="show" class="tui-modal-mask" @mousedown.self="onMaskClick">
        <div
          ref="panelEl"
          class="tui-modal"
          :class="`tui-modal--${size}`"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? instanceLabelId : undefined"
          aria-describedby="tui-modal-desc"
          tabindex="-1"
        >
          <header v-if="$slots.header || title" class="tui-modal__header">
            <slot name="header">
              <h2 :id="instanceLabelId" class="tui-modal__title">{{ title }}</h2>
            </slot>
            <button v-if="closable" class="tui-modal__close" aria-label="关闭" @click="emit('close')">
              <WsIcon name="close" :size="14" :stroke-width="1.7" />
            </button>
          </header>

          <div id="tui-modal-desc" class="tui-modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="tui-modal__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tui-modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  padding: 24px;
}
.tui-modal {
  outline: none;
  display: flex;
  flex-direction: column;
  max-width: 92vw;
  max-height: 86vh;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.tui-modal--sm { width: 380px; }
.tui-modal--md { width: 460px; }
.tui-modal--lg { width: 600px; }

.tui-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px var(--spacing-modal-x, 20px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tui-modal__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-modal__close {
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
.tui-modal__close:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}
/* 按压反馈（批次89） */
.tui-modal__close:active {
  transform: scale(var(--press-scale));
}

.tui-modal__body {
  padding: 16px var(--spacing-modal-x, 20px);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.tui-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px var(--spacing-modal-x, 20px);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* 过渡：遮罩淡入 + 面板轻微上浮缩放（大动效用 --dur-lg，批次90 4.2 启用层级令牌） */
.tui-modal-enter-active,
.tui-modal-leave-active {
  transition: opacity var(--dur-lg) var(--ease);
}
.tui-modal-enter-active .tui-modal,
.tui-modal-leave-active .tui-modal {
  transition: transform var(--dur-lg) var(--ease-out), opacity var(--dur-lg) var(--ease);
}
.tui-modal-enter-from,
.tui-modal-leave-to {
  opacity: 0;
}
.tui-modal-enter-from .tui-modal,
.tui-modal-leave-to .tui-modal {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
/* 减弱动态偏好：面板去掉位移/缩放，保留淡入；遮罩本为纯淡入无需处理（Emil 可访问性规则） */
:root[data-anim-overlays='off'] .tui-modal-enter-active .tui-modal,
:root[data-anim-overlays='off'] .tui-modal-leave-active .tui-modal {
  transition: opacity var(--dur-lg) var(--ease);
}
:root[data-anim-overlays='off'] .tui-modal-enter-from .tui-modal,
:root[data-anim-overlays='off'] .tui-modal-leave-to .tui-modal {
  transform: none;
}
</style>
