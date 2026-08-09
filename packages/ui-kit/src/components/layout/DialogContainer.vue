<template>
  <Teleport to="body">
    <Transition name="ws-scale-fade">
      <div v-if="state.show" class="dialog-overlay" @click.self="cancel">
        <div class="dialog-box" ref="dialogBoxRef" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">
          <div class="dialog-header">
            <h3 id="dialog-title">{{ state.title }}</h3>
          </div>
          <div class="dialog-body">
            <p>{{ state.message }}</p>
            <input
              v-if="state.mode === 'prompt'"
              v-model="state.inputValue"
              class="dialog-input"
              :placeholder="state.inputPlaceholder"
              @keyup.enter="ok"
              ref="inputRef"
            />
          </div>
          <div class="dialog-actions">
            <button v-if="state.mode !== 'alert'" class="btn-secondary" @click="cancel">取消</button>
            <button class="btn-primary" @click="ok">{{ state.mode === 'confirm' ? '确定' : state.mode === 'alert' ? '知道了' : '确定' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, nextTick, ref, onBeforeUnmount } from 'vue'
import { useDialog } from '@worldsmith/ui-kit'

const { state, doResolve } = useDialog()
const inputRef = ref<HTMLInputElement>()
const dialogBoxRef = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null

function ok() {
  if (state.value.mode === 'confirm') doResolve(true)
  else if (state.value.mode === 'alert') doResolve(null)
  else doResolve(state.value.inputValue)
}

function cancel() {
  if (state.value.mode === 'confirm') doResolve(false)
  else doResolve(null)
}

// 焦点陷阱：Tab 仅在弹窗内循环 + Esc 关闭
function onKeydown(e: KeyboardEvent) {
  if (!state.value.show) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    cancel()
    return
  }
  if (e.key === 'Tab') {
    const box = dialogBoxRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(() => state.value.show, (v) => {
  if (v) {
    previousFocus = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown)
    nextTick(() => {
      if (state.value.mode === 'prompt') {
        inputRef.value?.focus()
      } else {
        const box = dialogBoxRef.value
        if (box) {
          const focusable = box.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          focusable?.focus()
        }
      }
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    if (previousFocus) {
      previousFocus.focus()
      previousFocus = null
    }
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
}
.dialog-box {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; min-width: 300px; max-width: 440px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.3);
}
.dialog-header h3 { margin: 0 0 12px; font-size: var(--font-size-md); color: var(--color-primary); }
.dialog-body p { margin: 0 0 12px; font-size: var(--font-size-sm); color: var(--color-text-tertiary); line-height: 1.5; }
.dialog-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-tertiary); color: var(--text);
  font-size: var(--font-size-sm); outline: none; box-sizing: border-box;
}
.dialog-input:focus { border-color: var(--accent); }
.dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.btn-secondary { padding: 7px 16px; background: var(--bg-tertiary); color: #888; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); }
.btn-primary { padding: 7px 16px; background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); }
.btn-secondary:hover { background: var(--color-border); }
.btn-primary:hover { background: var(--color-primary-active); }

</style>