<template>
  <Teleport to="body">
    <Transition name="ws-scale-fade">
      <!-- center：全屏遮罩 + 居中；bottom：对话区底部输入栏上方（可遮住输入栏，不阻断其他区域） -->
      <div
        v-if="state.show"
        class="ws-confirm-overlay"
        :class="`ws-confirm-overlay--${state.position}`"
        @click.self="doCancel"
      >
        <div
          class="ws-confirm"
          :class="[`ws-confirm--${state.position}`, { 'ws-confirm--docked': !!dockedStyle }]"
          :style="dockedStyle"
          ref="confirmRef"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descId"
        >
          <div class="ws-confirm__icon" :class="`ws-confirm__icon--${state.type}`">
            <WsIcon :name="iconName" size="md" />
          </div>
          <div class="ws-confirm__text">
            <h3 :id="titleId" class="ws-confirm__title">{{ state.title }}</h3>
            <p v-if="state.description" :id="descId" class="ws-confirm__desc">{{ state.description }}</p>
            <!-- 可选复选框（如「同时回滚文件」，W 批）：结果经 useConfirm.confirmWithCheckbox 读回 -->
            <label v-if="state.checkboxLabel" class="ws-confirm__check">
              <input type="checkbox" v-model="state.checkboxChecked" />
              <span>{{ state.checkboxLabel }}</span>
            </label>
          </div>
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
            <TuiButton
              :variant="state.type === 'danger' ? 'danger' : 'primary'"
              size="sm"
              @click="onConfirmClick"
            >{{ armed && state.armedConfirmText ? state.armedConfirmText : state.confirmText }}</TuiButton>
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
import { useDockPanelRect } from '@/composables/useDockPanelRect'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'

const { state, doConfirm, doCancel, doNeutral } = useConfirm()
const confirmRef = ref<HTMLElement | null>(null)

// ── 二段式确认键（state.armedConfirmText 提供时启用，2026-10-02）──
// 第一击仅「武装」（文案切为武装态），第二击才真正确认——把「确认 + 二次确认」两连弹
// 合并为单弹窗。武装态约 3 秒无操作自动解除，防误触；弹窗每次打开/关闭都重置。
const ARMED_RESET_MS = 3000
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null

function disarm() {
  armed.value = false
  if (armTimer) {
    clearTimeout(armTimer)
    armTimer = null
  }
}

function onConfirmClick() {
  if (state.value.armedConfirmText && !armed.value) {
    armed.value = true
    armTimer = setTimeout(disarm, ARMED_RESET_MS)
    return
  }
  disarm()
  doConfirm()
}

/** bottom 模式停靠输入栏（宽度跟随 + 底边对齐；center 模式不受影响） */
const { dockedStyle } = useDockPanelRect(
  computed(() => state.value.show && state.value.position === 'bottom'),
)

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
  disarm()
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.ws-confirm-overlay {
  position: fixed;
  inset: var(--titlebar-height, 32px) 0 0 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  backdrop-filter: blur(var(--sf-overlay-blur));
  -webkit-backdrop-filter: blur(var(--sf-overlay-blur));
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
  background: var(--sf-modal-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-lg) * var(--sf-radius-scale));
  box-shadow: var(--sf-overlay-shadow);
  backdrop-filter: blur(var(--sf-overlay-blur));
  padding: 24px;
  min-width: 320px;
  max-width: 420px;
  text-align: center;
}

.ws-confirm--bottom {
  pointer-events: auto; /* 面板本身可交互 */
}

/* 文本块包裹：center 模式 display:contents 让 h3/p 仍按原块级流布局（视觉零变化） */
.ws-confirm__text {
  display: contents;
}

/* ── bottom 模式停靠态（2026-09-20 走查后改版）：条状面板，宽度跟随输入栏、底边对齐可覆盖输入栏 ── */
.ws-confirm--docked {
  position: absolute; /* overlay 为 fixed inset:0 → absolute 即视口坐标 */
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  min-width: 0;
  max-width: none;
  padding: 14px 16px;
  border-radius: var(--radius-2xl);
  text-align: left;
}

.ws-confirm--docked .ws-confirm__text {
  display: block;
  flex: 1;
  min-width: 0;
}

.ws-confirm--docked .ws-confirm__icon {
  width: 32px;
  height: 32px;
  margin: 0;
  flex-shrink: 0;
}

.ws-confirm--docked .ws-confirm__title {
  font-size: var(--fs-md);
  margin: 0 0 4px;
}

.ws-confirm--docked .ws-confirm__desc {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}

.ws-confirm--docked .ws-confirm__actions {
  justify-content: flex-end;
  flex-shrink: 0;
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

/* 可选复选框（如「同时回滚文件」）：左对齐置于描述与按钮之间 */
.ws-confirm__check {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  margin: -8px 0 16px;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.ws-confirm__check input {
  accent-color: var(--accent);
  cursor: pointer;
}
.ws-confirm--docked .ws-confirm__check {
  margin: 4px 0 0;
}

.ws-confirm__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

</style>
