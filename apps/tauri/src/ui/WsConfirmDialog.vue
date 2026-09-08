<template>
  <Teleport to="body">
    <Transition name="ws-confirm">
      <!-- center：全屏遮罩 + 居中；bottom：对话区底部输入栏上方（可遮住输入栏，不阻断其他区域） -->
      <div
        v-if="state.show"
        class="ws-confirm-overlay"
        :class="`ws-confirm-overlay--${state.position}`"
        @click.self="doCancel"
      >
        <div
          class="ws-confirm"
          :class="`ws-confirm--${state.position}`"
          ref="confirmRef"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descId"
        >
          <div class="ws-confirm__icon" :class="`ws-confirm__icon--${state.type}`">
            <WsIcon :name="iconName" size="md" />
          </div>
          <h3 :id="titleId" class="ws-confirm__title">{{ state.title }}</h3>
          <p v-if="state.description" :id="descId" class="ws-confirm__desc">{{ state.description }}</p>
          <div class="ws-confirm__actions">
            <TuiButton variant="ghost" size="sm" @click="doCancel">{{ state.cancelText }}</TuiButton>
            <!-- 可选第三键（中性选项，如「取消(跳过)」）：仅 HITL 等三选场景渲染 -->
            <TuiButton v-if="state.neutralText" variant="ghost" size="sm" @click="doNeutral">{{ state.neutralText }}</TuiButton>
            <!-- 附加动作（如「添加白名单并放行」）：点击先执行 run()，随后按放行处理 -->
            <TuiButton
              v-for="(a, i) in state.extraActions"
              :key="i"
              variant="ghost"
              size="sm"
              @click="runExtraAction(a)"
            >{{ a.label }}</TuiButton>
            <TuiButton :variant="state.type === 'danger' ? 'danger' : 'primary'" size="sm" @click="doConfirm">{{ state.confirmText }}</TuiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useConfirm } from '@worldsea/plugin-sdk'
import type { ConfirmExtraAction } from '@worldsea/ui-kit'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { WsIcon } from '@worldsea/ui-kit'
import TuiButton from '@/components/ui/TuiButton.vue'

const { state, doConfirm, doCancel, doNeutral } = useConfirm()
const confirmRef = ref<HTMLElement | null>(null)

const titleId = 'ws-confirm-title'
const descId = 'ws-confirm-desc'

const iconName = computed(() => {
  const map: Record<string, string> = { info: 'search', warning: 'warning', danger: 'close' }
  return map[state.value.type] || 'search'
})

/** 附加动作：先执行 run()，随后按「放行」关闭并 resolve true；run 抛错则保持弹窗
 *  （由调用方负责提示，用户可重试/取消——失败不得被当作成功关闭，如「保存并继续」保存失败） */
async function runExtraAction(action: ConfirmExtraAction): Promise<void> {
  try {
    await action.run()
  } catch (err) {
    console.warn('[WsConfirmDialog] 附加动作执行失败，保持弹窗:', err)
    return
  }
  doConfirm()
}

const { activate, deactivate } = useFocusTrap(confirmRef, {
  active: computed(() => state.value.show),
  restoreFocus: true,
  escapeDeactivates: true,
  onEscape: () => doCancel(),
})

watch(() => state.value.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.ws-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* bottom 模式：对话区底部输入栏上方弹出——无遮罩/不拦截其他区域，仅面板浮于输入栏位置 */
.ws-confirm-overlay--bottom {
  background: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  pointer-events: none; /* 允许点击穿透，不阻挡消息区/侧栏等其他区域操作 */
  align-items: flex-end;
  justify-content: center;
  padding: 0 16px 104px; /* 底部留白 ≈ 输入栏高度，面板盖住输入栏 */
}

.ws-confirm {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  min-width: 320px;
  max-width: 420px;
  text-align: center;
}

.ws-confirm--bottom {
  pointer-events: auto; /* 面板本身可交互 */
}

.ws-confirm__icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}
.ws-confirm__icon--info { background: var(--accent-soft); color: var(--info); }
.ws-confirm__icon--warning { background: var(--warning-soft); color: var(--warning); }
.ws-confirm__icon--danger { background: var(--danger-soft); color: var(--danger); }

.ws-confirm__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.ws-confirm__desc {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin: 0 0 20px;
  line-height: var(--lh-md);
  white-space: pre-line;
}

.ws-confirm__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* 过渡：遮罩淡入 + 面板轻微缩放（与 TuiModal 一致） */
.ws-confirm-enter-active,
.ws-confirm-leave-active {
  transition: opacity var(--dur-lg) var(--ease);
}
.ws-confirm-enter-active .ws-confirm,
.ws-confirm-leave-active .ws-confirm {
  transition: transform var(--dur-lg) var(--ease-out), opacity var(--dur-lg) var(--ease);
}
.ws-confirm-enter-from,
.ws-confirm-leave-to {
  opacity: 0;
}
.ws-confirm-enter-from .ws-confirm,
.ws-confirm-leave-to .ws-confirm {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
/* 减弱动态偏好：去掉位移/缩放，保留淡入（Emil 可访问性规则） */
:root[data-anim-overlays='off'] .ws-confirm-enter-active .ws-confirm,
:root[data-anim-overlays='off'] .ws-confirm-leave-active .ws-confirm {
  transition: opacity var(--dur-lg) var(--ease);
}
:root[data-anim-overlays='off'] .ws-confirm-enter-from .ws-confirm,
:root[data-anim-overlays='off'] .ws-confirm-leave-to .ws-confirm {
  transform: none;
}
</style>
