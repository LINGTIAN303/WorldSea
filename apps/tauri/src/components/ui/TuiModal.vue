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
import { WsIcon, setShortcutModalActive } from '@worldsea/ui-kit'
import { createModalLayerId, isTopModalLayer, popModalLayer, pushModalLayer } from '@/composables/modalStack'

// 注册表弹窗深度守卫标记（本实例是否已入栈，防重复/泄漏）
let modalGuardActive = false

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
const instanceId = ++modalSeq
const instanceLabelId = `tui-modal-title-${instanceId}`
const layerId = createModalLayerId()

/** 当前实例是否栈顶（最后打开的弹层） */
const isTop = () => isTopModalLayer(layerId)

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
      pushModalLayer(layerId)
      window.addEventListener('keydown', onKeydown)
      // 注册表弹窗深度 +1：弹窗打开期间 view/global 层快捷键失效（modal 优先）
      if (!modalGuardActive) { setShortcutModalActive(true); modalGuardActive = true }
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
      popModalLayer(layerId)
      if (modalGuardActive) { setShortcutModalActive(false); modalGuardActive = false }
      // 关闭后还原焦点到打开前位置（Esc/遮罩/取消按钮等关闭路径统一还原）
      returnFocusEl?.focus?.({ preventScroll: true })
      returnFocusEl = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  popModalLayer(layerId)
  // 卸载时若仍在弹窗态需出栈，防止注册表弹窗深度泄漏
  if (modalGuardActive) { setShortcutModalActive(false); modalGuardActive = false }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ws-scale-fade">
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
  inset: var(--titlebar-height, 32px) 0 0 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  backdrop-filter: var(--sf-overlay-filter, none);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  padding: 24px;
}
.tui-modal {
  outline: none;
  display: flex;
  flex-direction: column;
  max-width: 92vw;
  max-height: 86vh;
  background: var(--sf-modal-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-lg) * var(--sf-radius-scale));
  box-shadow: var(--sf-overlay-shadow), inset 0 1px 0 var(--sf-highlight);
  -webkit-backdrop-filter: var(--sf-overlay-filter, none);
  backdrop-filter: var(--sf-overlay-filter, none);
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
  transform: scale(var(--sf-press-scale, var(--press-scale)));
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

</style>
