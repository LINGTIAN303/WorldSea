<script setup lang="ts">
/**
 * WsLoadingOverlay：R3 区域遮罩（scope=content 内容区 / scope=panel 弹窗内部）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed, nextTick, ref, watch } from 'vue'
import WsStageRoute from './WsStageRoute.vue'
import type { LoadingStage, LoadingStatus } from './types'

const props = withDefaults(
  defineProps<{
    show: boolean
    scope?: 'content' | 'panel'
    title?: string
    successTitle?: string
    errorTitle?: string
    stages: LoadingStage[]
    current: number
    status?: LoadingStatus
    /** 目标说明（如「目标：群岛档案」） */
    target?: string
    /** 失败原因 */
    error?: string
    successText?: string
    successDetail?: string
    errorText?: string
    cancellable?: boolean
    /** 错误态是否提供「关闭」；局部画布失败时关闭会留下空白，故只留重试 */
    closable?: boolean
  }>(),
  {
    scope: 'content',
    title: '正在处理',
    successTitle: '已完成',
    errorTitle: '处理失败',
    status: 'loading',
    target: '',
    error: '',
    successText: '',
    successDetail: '',
    errorText: '无法完成操作',
    cancellable: false,
    closable: true,
  },
)

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'cancel'): void
  (e: 'close'): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const retryEl = ref<HTMLButtonElement | null>(null)

const isError = computed(() => props.status === 'error')
const isSuccess = computed(() => props.status === 'success')
const currentIndex = computed(() => Math.min(Math.max(0, props.current), Math.max(0, props.stages.length - 1)))
const currentStage = computed<LoadingStage | null>(() => props.stages[currentIndex.value] ?? null)
const count = computed(() => {
  const total = Math.max(1, props.stages.length)
  return isSuccess.value ? `${total} / ${total}` : `${currentIndex.value + 1} / ${total}`
})
const heading = computed(() => {
  if (isSuccess.value) return props.successTitle
  if (isError.value) return props.errorTitle
  return props.title
})
const fullText = computed(() => {
  if (isSuccess.value) return props.successText || props.successTitle
  if (isError.value) return props.errorText
  return currentStage.value?.full ?? props.title
})
const detail = computed(() => {
  if (isSuccess.value) return props.successDetail
  if (isError.value) return props.error
  return currentStage.value?.detail ?? ''
})

async function focusForState(): Promise<void> {
  if (!props.show) return
  await nextTick()
  if (props.status === 'error') retryEl.value?.focus()
  else rootEl.value?.focus()
}

watch(() => props.show, (show) => { if (show) void focusForState() }, { flush: 'post' })
watch(() => props.status, () => { void focusForState() }, { flush: 'post' })
</script>

<template>
  <Transition name="ws-loading">
    <div
      v-if="show"
      ref="rootEl"
      class="ws-loading-overlay"
      :class="[`is-${scope}`, { 'is-error': isError, 'is-success': isSuccess }]"
      role="status"
      aria-live="polite"
      :aria-label="heading"
      tabindex="-1"
      @click.stop
    >
      <div class="ws-loading-panel" :class="{ 'is-error': isError }">
        <div class="ws-loading-panel__head">
          <div class="ws-loading-panel__heading">
            <h3 class="ws-loading-panel__title">{{ heading }}</h3>
            <p class="ws-loading-panel__full">{{ fullText }}</p>
          </div>
          <span class="ws-loading-panel__count">{{ count }}</span>
        </div>

        <p class="ws-loading-panel__detail">{{ detail }}</p>

        <WsStageRoute :stages="stages" :current="currentIndex" :status="status" />

        <div class="ws-loading-panel__foot">
          <span class="ws-loading-panel__target">{{ target }}</span>
          <div v-if="isError || cancellable" class="ws-loading-panel__actions">
            <template v-if="isError">
              <button ref="retryEl" type="button" class="is-primary" @click="emit('retry')">重试</button>
              <button v-if="closable" type="button" @click="emit('close')">关闭</button>
            </template>
            <button v-else type="button" @click="emit('cancel')">取消</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ws-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-loading, 1500);
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--loading-scrim, color-mix(in srgb, var(--bg-app, #fafaf9) 80%, transparent));
  -webkit-backdrop-filter: blur(var(--loading-scrim-blur, 2px));
  backdrop-filter: blur(var(--loading-scrim-blur, 2px));
  outline: none;
}

.ws-loading-overlay.is-panel {
  background: var(--loading-scrim-local, color-mix(in srgb, var(--bg-surface, #ffffff) 62%, transparent));
}

.ws-loading-panel {
  width: min(480px, calc(100% - 24px));
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.ws-loading-overlay.is-panel .ws-loading-panel {
  width: min(420px, calc(100% - 24px));
}

.ws-loading-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ws-loading-panel__heading { min-width: 0; }

.ws-loading-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary, #1f2328);
}

.ws-loading-panel.is-error .ws-loading-panel__title {
  color: var(--warning, #d97706);
}

.ws-loading-panel__count {
  padding-top: 2px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-muted, #9ca3af);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.ws-loading-panel__full {
  margin: 5px 0 0;
  max-width: 100%;
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--loading-accent, var(--accent, #4f46e5));
}

.ws-loading-panel.is-error .ws-loading-panel__full {
  color: var(--warning, #d97706);
}

.ws-loading-panel__full::after {
  content: '';
  display: block;
  width: 100%;
  height: 1px;
  margin-top: 6px;
  background: currentColor;
  opacity: 0.35;
}

.ws-loading-panel__detail {
  min-height: 15px;
  margin: 7px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary, #6b7280);
}

.ws-loading-panel__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
  font-size: 9.5px;
  color: var(--text-muted, #9ca3af);
}

.ws-loading-panel__target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-loading-panel__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.ws-loading-panel__actions button {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border-strong, #d9d9de);
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font-size: 10px;
  cursor: pointer;
}

.ws-loading-panel__actions button:hover {
  border-color: var(--accent, #4f46e5);
  color: var(--accent, #4f46e5);
}

.ws-loading-panel__actions button.is-primary {
  border-color: transparent;
  background: var(--warning, #d97706);
  color: var(--on-accent, #ffffff);
}

.ws-loading-panel__actions button.is-primary:hover {
  color: var(--on-accent, #ffffff);
  opacity: 0.9;
}

/* 过渡：只做淡入淡出（无卡片，不做位移/缩放） */
.ws-loading-enter-active,
.ws-loading-leave-active,
.ws-loading-enter-active .ws-loading-panel,
.ws-loading-leave-active .ws-loading-panel {
  transition: opacity var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

.ws-loading-enter-from,
.ws-loading-leave-to,
.ws-loading-enter-from .ws-loading-panel,
.ws-loading-leave-to .ws-loading-panel {
  opacity: 0;
}

:root[data-reduce-motion='on'] .ws-loading-enter-active,
:root[data-reduce-motion='on'] .ws-loading-leave-active,
:root[data-reduce-motion='on'] .ws-loading-enter-active .ws-loading-panel,
:root[data-reduce-motion='on'] .ws-loading-leave-active .ws-loading-panel {
  transition-duration: 0.01ms;
}
</style>
