<template>
  <Teleport to="body">
    <div v-if="visible" class="sfp-overlay" @click.self="$emit('close')">
      <div ref="dialogRef" class="sfp-panel" role="dialog" aria-modal="true" aria-labelledby="sfp-title" tabindex="-1">
        <div class="sfp-header">
          <h3 id="sfp-title">✨ AI 智能填充预览</h3>
          <label class="sfp-mode-toggle">
            <span class="sfp-mode-label">{{ includeExisting ? '含已有字段优化' : '仅空字段' }}</span>
            <input
              type="checkbox"
              :checked="includeExisting"
              @change="$emit('toggleIncludeExisting', ($event.target as HTMLInputElement).checked)"
              class="sfp-mode-switch"
            />
          </label>
          <button class="sfp-close" @click="$emit('close')" aria-label="关闭预览">✕</button>
        </div>
        <div class="sfp-body">
          <div class="sfp-columns">
            <div class="sfp-col">
              <div class="sfp-col-label">当前值</div>
              <div v-for="key in fieldKeys" :key="'cur-' + key" class="sfp-cell">
                <span class="sfp-field-label">{{ fieldLabels[key] || key }}</span>
                <span class="sfp-field-value sfp-current">{{ truncate(currentFields[key] || '—') }}</span>
              </div>
            </div>
            <div class="sfp-divider"></div>
            <div class="sfp-col">
              <div class="sfp-col-label">AI 建议</div>
              <div v-for="key in fieldKeys" :key="'sug-' + key" class="sfp-cell" :class="{ 'sfp-accepted': accepted.has(key), 'sfp-rejected': rejected.has(key) }">
                <span class="sfp-field-label">{{ fieldLabels[key] || key }}</span>
                <span class="sfp-field-value sfp-suggestion">{{ truncate(suggestions[key] || '—') }}</span>
                <div class="sfp-actions">
                  <button class="sfp-action sfp-accept" :class="{ active: accepted.has(key) }" @click="$emit('accept', key)" title="接受" :aria-label="`接受 ${fieldLabels[key] || key} 的建议`" :aria-pressed="accepted.has(key)">✓</button>
                  <button class="sfp-action sfp-reject" :class="{ active: rejected.has(key) }" @click="$emit('reject', key)" title="拒绝" :aria-label="`拒绝 ${fieldLabels[key] || key} 的建议`" :aria-pressed="rejected.has(key)">✕</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="sfp-footer">
          <button class="sfp-btn sfp-btn-accept-all" @click="$emit('acceptAll')">全部接受</button>
          <button class="sfp-btn sfp-btn-reject-all" @click="$emit('rejectAll')">全部拒绝</button>
          <div class="sfp-footer-spacer"></div>
          <button class="sfp-btn sfp-btn-apply" @click="$emit('apply')">应用已接受</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps<{
  visible: boolean
  currentFields: Record<string, string>
  suggestions: Record<string, string>
  fieldLabels: Record<string, string>
  accepted: Set<string>
  rejected: Set<string>
  includeExisting: boolean  // V2: 是否包含已有字段优化
}>()

const emit = defineEmits<{
  close: []
  accept: [key: string]
  reject: [key: string]
  acceptAll: []
  rejectAll: []
  apply: []
  toggleIncludeExisting: [value: boolean]  // V2: 模式切换
}>()

const fieldKeys = computed(() => Object.keys(props.suggestions))

const dialogRef = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'Tab') {
    const box = dialogRef.value
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

watch(() => props.visible, (v) => {
  if (v) {
    previousFocus = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const box = dialogRef.value
      if (box) {
        const focusable = box.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        focusable?.focus()
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

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}
</script>

<style scoped>
.sfp-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  animation: sfp-fade-in 0.2s ease-out;
}
@keyframes sfp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.sfp-panel {
  background: var(--glass-bg, var(--modal-bg, var(--color-bg-surface)));
  border: 1px solid var(--glass-border, var(--border-color, var(--border)));
  border-radius: var(--radius-xl, 12px);
  padding: 24px;
  width: 680px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.3));
  backdrop-filter: blur(var(--glass-blur, 12px));
  animation: sfp-slide-in 0.3s ease-out;
}
@keyframes sfp-slide-in {
  from { transform: translateX(40px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.sfp-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}
.sfp-header h3 {
  margin: 0;
  font-size: var(--font-size-lg, 16px);
  color: var(--accent, var(--color-primary));
}
.sfp-mode-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 12px;
}
.sfp-mode-label {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-secondary);
}
.sfp-mode-switch {
  appearance: none;
  width: 32px;
  height: 18px;
  background: var(--bg-tertiary, var(--color-bg-elevated));
  border-radius: 9px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.sfp-mode-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: transform 0.2s, background 0.2s;
}
.sfp-mode-switch:checked {
  background: var(--accent, var(--color-primary));
}
.sfp-mode-switch:checked::after {
  transform: translateX(14px);
  background: var(--color-text-inverse, #fff);
}
.sfp-close {
  background: none;
  border: none;
  font-size: var(--font-size-lg, 16px);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
}
.sfp-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
.sfp-body {
  margin-bottom: 16px;
}
.sfp-columns {
  display: flex;
  gap: 0;
}
.sfp-col {
  flex: 1;
  min-width: 0;
}
.sfp-col-label {
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  color: var(--text-secondary);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, var(--border));
  margin-bottom: 8px;
}
.sfp-divider {
  width: 1px;
  background: var(--border-color, var(--border));
  margin: 0 16px;
}
.sfp-cell {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.15s;
}
.sfp-cell:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.04));
}
.sfp-cell.sfp-accepted {
  background: color-mix(in srgb, var(--color-success, #22c55e) 10%, transparent);
}
.sfp-cell.sfp-rejected {
  background: color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent);
  opacity: 0.6;
}
.sfp-field-label {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-tertiary, rgba(255, 255, 255, 0.4));
  min-width: 60px;
  flex-shrink: 0;
  padding-top: 2px;
}
.sfp-field-value {
  flex: 1;
  font-size: var(--font-size-sm, 13px);
  min-width: 0;
  word-break: break-word;
}
.sfp-current {
  color: var(--text-secondary, rgba(255, 255, 255, 0.5));
}
.sfp-suggestion {
  color: var(--text-color);
  border-left: 2px solid var(--accent, var(--color-primary));
  padding-left: 6px;
}
.sfp-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.sfp-cell:hover .sfp-actions {
  opacity: 1;
}
.sfp-action {
  background: none;
  border: 1px solid var(--border-color, var(--border));
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--font-size-xs, 11px);
  padding: 2px 6px;
  color: var(--text-secondary);
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.sfp-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.sfp-action.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--color-text-inverse, #fff);
}
.sfp-accept.active {
  background: var(--color-success, #22c55e);
  border-color: var(--color-success, #22c55e);
}
.sfp-reject.active {
  background: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}
.sfp-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sfp-footer-spacer {
  flex: 1;
}
.sfp-btn {
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-sm, 13px);
  border: 1px solid var(--border-color, var(--border));
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.sfp-btn-accept-all {
  background: color-mix(in srgb, var(--color-success, #22c55e) 10%, transparent);
  color: var(--color-success, #22c55e);
  border-color: var(--color-success, #22c55e);
}
.sfp-btn-accept-all:hover {
  background: var(--color-success, #22c55e);
  color: #fff;
}
.sfp-btn-reject-all {
  background: var(--bg-tertiary, var(--color-bg-elevated));
  color: var(--text-secondary);
}
.sfp-btn-reject-all:hover {
  background: var(--border);
}
.sfp-btn-apply {
  background: var(--accent-bg, color-mix(in srgb, var(--color-primary, #6366f1) 12%, transparent));
  color: var(--accent, var(--color-primary));
  border-color: var(--accent, var(--color-primary));
}
.sfp-btn-apply:hover {
  background: var(--accent, var(--color-primary));
  color: var(--color-text-inverse, #fff);
}
</style>
