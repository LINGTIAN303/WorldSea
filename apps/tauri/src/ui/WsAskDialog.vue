<template>
  <Teleport to="body">
    <Transition name="ws-ask">
      <!-- 占位实现（2026-09-03）：与确认弹窗同位置（对话区底部输入栏上方）弹出，当前无调用方接线 -->
      <div
        v-if="state.show"
        class="ws-ask-overlay"
        @click.self="cancel"
      >
        <div class="ws-ask" role="dialog" aria-modal="true" aria-labelledby="ws-ask-title">
          <h3 id="ws-ask-title" class="ws-ask__title">{{ state.title }}</h3>
          <input
            v-model="state.value"
            class="ws-ask__input"
            :placeholder="state.placeholder"
            @keyup.enter="submit"
          />
          <div class="ws-ask__actions">
            <TuiButton variant="ghost" size="sm" @click="cancel">取消</TuiButton>
            <TuiButton variant="primary" size="sm" @click="submit">确定</TuiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useAsk } from '@worldsmith/ui-kit'
import TuiButton from '@/components/ui/TuiButton.vue'

const { state, submit, cancel } = useAsk()
</script>

<style scoped>
.ws-ask-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: none;
  pointer-events: none; /* 与确认弹窗 bottom 模式一致：不拦截其他区域操作 */
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 16px 104px; /* 底部留白 ≈ 输入栏高度，面板盖住输入栏 */
}

.ws-ask {
  pointer-events: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 20px;
  width: 420px;
  max-width: 100%;
}

.ws-ask__title {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.ws-ask__input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input, var(--bg-subtle));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  outline: none;
}

.ws-ask__input:focus {
  border-color: var(--accent);
}

.ws-ask__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 14px;
}

/* 过渡与确认弹窗 bottom 一致：淡入 + 轻微上移 */
.ws-ask-enter-active,
.ws-ask-leave-active {
  transition: opacity var(--dur-lg) var(--ease);
}
.ws-ask-enter-active .ws-ask,
.ws-ask-leave-active .ws-ask {
  transition: transform var(--dur-lg) var(--ease-out), opacity var(--dur-lg) var(--ease);
}
.ws-ask-enter-from,
.ws-ask-leave-to {
  opacity: 0;
}
.ws-ask-enter-from .ws-ask,
.ws-ask-leave-to .ws-ask {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
:root[data-anim-overlays='off'] .ws-ask-enter-active .ws-ask,
:root[data-anim-overlays='off'] .ws-ask-leave-active .ws-ask {
  transition: opacity var(--dur-lg) var(--ease);
}
:root[data-anim-overlays='off'] .ws-ask-enter-from .ws-ask,
:root[data-anim-overlays='off'] .ws-ask-leave-to .ws-ask {
  transform: none;
}
</style>
