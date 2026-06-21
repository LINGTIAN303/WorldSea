<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="smooth-caret"
      :class="[variantClass, { 'smooth-caret--typing': isTyping }]"
      :style="caretStyle"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'

const settingsStore = useSettingsStore()

const visible = ref(false)
const isTyping = ref(false)
const caretX = ref(0)
const caretY = ref(0)
const caretH = ref(20)

let currentInput: HTMLInputElement | HTMLTextAreaElement | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let styleEl: HTMLStyleElement | null = null

const variantClass = computed(() => `smooth-caret--${settingsStore.smoothCaretVariant}`)

const caretStyle = computed(() => ({
  transform: `translate(${caretX.value}px, ${caretY.value}px)`,
  height: `${caretH.value}px`,
  transition: settingsStore.smoothCaretEnabled
    ? `transform ${settingsStore.smoothCaretDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1), height ${settingsStore.smoothCaretDuration}ms ease`
    : 'none',
}))

function injectTransparentCaret() {
  if (styleEl) return
  styleEl = document.createElement('style')
  styleEl.id = 'smooth-caret-override'
  styleEl.textContent = `
    input.smooth-caret-active,
    textarea.smooth-caret-active,
    [contenteditable="true"].smooth-caret-active {
      caret-color: transparent !important;
    }
  `
  document.head.appendChild(styleEl)
}

function removeTransparentCaret() {
  if (styleEl) {
    styleEl.remove()
    styleEl = null
  }
  document.querySelectorAll('.smooth-caret-active').forEach(el => {
    el.classList.remove('smooth-caret-active')
  })
}

function measureCaretPos(el: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number; h: number } {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const pos = el.selectionStart ?? 0

  const pl = parseFloat(style.paddingLeft) || 0
  const pt = parseFloat(style.paddingTop) || 0
  const pr = parseFloat(style.paddingRight) || 0
  const bl = parseFloat(style.borderLeftWidth) || 0
  const bt = parseFloat(style.borderTopWidth) || 0
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const isInput = el instanceof HTMLInputElement

  const contentW = el.clientWidth - pl - pr

  const mirror = document.createElement('div')
  const baseCSS = `
    position:absolute;top:-9999px;left:-9999px;visibility:hidden;
    font:${style.font};letter-spacing:${style.letterSpacing};
    text-transform:${style.textTransform};word-spacing:${style.wordSpacing};
    box-sizing:border-box;
  `

  if (isInput) {
    mirror.style.cssText = baseCSS + `white-space:nowrap;`
  } else {
    mirror.style.cssText = baseCSS + `
      white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;
      width:${contentW}px;line-height:${lh}px;
      padding-left:${style.paddingLeft};padding-right:${style.paddingRight};
    `
  }

  const textBefore = el.value.substring(0, pos)
  const textAfter = el.value.substring(pos)

  mirror.appendChild(document.createTextNode(textBefore))

  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)

  if (!isInput) {
    mirror.appendChild(document.createTextNode(textAfter))
    const trail = document.createElement('br')
    mirror.appendChild(trail)
  }

  document.body.appendChild(mirror)

  const markerTop = marker.offsetTop
  const markerLeft = marker.offsetLeft
  const markerH = marker.offsetHeight || lh

  mirror.remove()

  let x: number
  let y: number
  let h: number

  if (isInput) {
    const visibleX = Math.min(markerLeft, contentW - 2)
    x = rect.left + bl + pl + Math.max(0, visibleX)
    y = rect.top + bt + pt
    h = lh
  } else {
    x = rect.left + bl + markerLeft - el.scrollLeft
    y = rect.top + bt + pt + markerTop - el.scrollTop
    h = lh
  }

  return { x, y, h }
}

function updateCaret() {
  if (!currentInput || !settingsStore.smoothCaretEnabled) return
  try {
    const p = measureCaretPos(currentInput)
    if (isNaN(p.x) || isNaN(p.y)) return
    caretX.value = p.x
    caretY.value = p.y
    caretH.value = p.h
  } catch {
    // silent
  }
}

function onTyping() {
  isTyping.value = true
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => { isTyping.value = false }, 200)
}

let scrollAncestors: Array<HTMLElement | typeof window> = []

function attachScrollListeners() {
  detachScrollListeners()
  if (!currentInput) return
  let el: HTMLElement | null = currentInput.parentElement
  while (el) {
    const style = getComputedStyle(el)
    const overflowY = style.overflowY
    const overflowX = style.overflowX
    if (
      overflowY === 'auto' || overflowY === 'scroll' ||
      overflowX === 'auto' || overflowX === 'scroll'
    ) {
      el.addEventListener('scroll', onScroll)
      scrollAncestors.push(el)
    }
    el = el.parentElement
  }
  currentInput.addEventListener('scroll', onScroll)
  scrollAncestors.push(currentInput)
  window.addEventListener('scroll', onScroll)
  scrollAncestors.push(window)
}

function detachScrollListeners() {
  for (const target of scrollAncestors) {
    target.removeEventListener('scroll', onScroll)
  }
  scrollAncestors = []
}

function onSelectionChange() {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el !== currentInput) {
      if (currentInput) currentInput.classList.remove('smooth-caret-active')
      currentInput = el
      el.classList.add('smooth-caret-active')
      visible.value = true
      attachScrollListeners()
    }
    requestAnimationFrame(() => updateCaret())
  } else {
    hideCaret()
  }
}

function onInput() {
  if (!currentInput) return
  onTyping()
  requestAnimationFrame(() => updateCaret())
}

function onKeyDown(e: KeyboardEvent) {
  if (!currentInput) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
  onTyping()
  requestAnimationFrame(() => updateCaret())
}

function onFocus(e: Event) {
  const el = e.target
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (currentInput && currentInput !== el) {
      currentInput.classList.remove('smooth-caret-active')
    }
    if (currentInput !== el) {
      currentInput = el
      el.classList.add('smooth-caret-active')
      visible.value = true
      attachScrollListeners()
    }
    requestAnimationFrame(() => updateCaret())
  }
}

function onBlur(e: Event) {
  const el = e.target
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.classList.remove('smooth-caret-active')
    if (el === currentInput) {
      hideCaret()
    }
  }
}

function hideCaret() {
  visible.value = false
  isTyping.value = false
  if (currentInput) {
    currentInput.classList.remove('smooth-caret-active')
    detachScrollListeners()
    currentInput = null
  }
}

let scrollRafScheduled = false

function onScroll() {
  if (!currentInput || scrollRafScheduled) return
  scrollRafScheduled = true
  requestAnimationFrame(() => {
    scrollRafScheduled = false
    updateCaret()
  })
}

onMounted(() => {
  if (settingsStore.smoothCaretEnabled) {
    injectTransparentCaret()
  }
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('input', onInput as EventListener)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('focus', onFocus, true)
  document.addEventListener('blur', onBlur, true)
})

onBeforeUnmount(() => {
  removeTransparentCaret()
  detachScrollListeners()
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('input', onInput as EventListener)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('focus', onFocus, true)
  document.removeEventListener('blur', onBlur, true)
  if (typingTimer) clearTimeout(typingTimer)
})

watch(() => settingsStore.smoothCaretEnabled, (enabled) => {
  if (enabled) {
    injectTransparentCaret()
  } else {
    removeTransparentCaret()
    hideCaret()
  }
})
</script>

<style scoped>
.smooth-caret {
  position: fixed;
  left: 0;
  top: 0;
  width: 2px;
  pointer-events: none;
  z-index: 99999;
  will-change: transform, opacity;
  border-radius: 1px;
  background: var(--accent, #a78bfa);
  box-shadow: 0 0 3px var(--accent, #a78bfa), 0 0 8px rgba(167, 139, 250, 0.3);
  animation: ws-caret-pulse 1.2s ease-in-out infinite;
}

.smooth-caret--line {
  width: 2px;
  border-radius: 1px;
}

.smooth-caret--block {
  width: 8px;
  border-radius: 2px;
  opacity: 0.6;
}

.smooth-caret--underline {
  width: 8px;
  height: 2px !important;
  border-radius: 1px;
}

.smooth-caret--beam {
  width: 2px;
  box-shadow:
    0 0 4px var(--accent, #a78bfa),
    0 0 12px rgba(167, 139, 250, 0.4),
    0 0 20px rgba(167, 139, 250, 0.15);
}

.smooth-caret--typing {
  animation: ws-caret-typing 0.15s ease-out;
  transition: none !important;
}


</style>
