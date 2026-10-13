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
import { useSettingsStore } from '@worldsea/entity-core'

const settingsStore = useSettingsStore()

const visible = ref(false)
const isTyping = ref(false)
const caretX = ref(0)
const caretY = ref(0)
const caretH = ref(20)

let currentInput: HTMLInputElement | HTMLTextAreaElement | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let styleEl: HTMLStyleElement | null = null

// ===== 性能优化:mirror DOM 单例化,避免每次按键 createElement + appendChild + remove =====
// 全局复用一个 mirror 元素(首次测量时创建,组件卸载时清理),消除每次按键的 DOM 写入开销
let mirrorEl: HTMLDivElement | null = null
let mirrorMarker: HTMLSpanElement | null = null
let mirrorReady = false

// getComputedStyle 缓存:同一输入框切焦前复用样式信息,避免每次按键重复读取
interface ComputedStyleCache {
  rect: DOMRect
  pl: number
  pt: number
  pr: number
  bl: number
  bt: number
  lh: number
  contentW: number
  font: string
  letterSpacing: string
  textTransform: string
  wordSpacing: string
  paddingLeft: string
  paddingRight: string
  isInput: boolean
}
const styleCache = new WeakMap<HTMLInputElement | HTMLTextAreaElement, ComputedStyleCache>()

// rAF 合并按键:同一帧内多次按键只测量一次(配合下面 updateCaretRaf 使用)
let updateRafId: number | null = null

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

// 初始化单例 mirror 元素(首次测量时懒创建)
function ensureMirror() {
  if (mirrorReady && mirrorEl && mirrorMarker) return
  mirrorEl = document.createElement('div')
  mirrorEl.setAttribute('data-smooth-caret-mirror', '')
  // 初始定位在屏幕外,不参与可见布局
  mirrorEl.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;box-sizing:border-box;'
  mirrorMarker = document.createElement('span')
  mirrorMarker.textContent = '\u200b'
  mirrorEl.appendChild(mirrorMarker)
  document.body.appendChild(mirrorEl)
  mirrorReady = true
}

function destroyMirror() {
  if (mirrorEl) {
    mirrorEl.remove()
    mirrorEl = null
    mirrorMarker = null
    mirrorReady = false
  }
}

// 读取并缓存输入框的样式信息(focus 切换或首次测量时调用)
function refreshStyleCache(el: HTMLInputElement | HTMLTextAreaElement): ComputedStyleCache {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const cache: ComputedStyleCache = {
    rect,
    pl: parseFloat(style.paddingLeft) || 0,
    pt: parseFloat(style.paddingTop) || 0,
    pr: parseFloat(style.paddingRight) || 0,
    bl: parseFloat(style.borderLeftWidth) || 0,
    bt: parseFloat(style.borderTopWidth) || 0,
    lh: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
    contentW: 0,
    font: style.font,
    letterSpacing: style.letterSpacing,
    textTransform: style.textTransform,
    wordSpacing: style.wordSpacing,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    isInput: el instanceof HTMLInputElement,
  }
  cache.contentW = el.clientWidth - cache.pl - cache.pr
  styleCache.set(el, cache)
  return cache
}

function measureCaretPos(el: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number; h: number } {
  // 复用缓存样式;缓存命中时跳过 getComputedStyle + getBoundingClientRect + clientWidth 读取
  let cache = styleCache.get(el)
  // rect 会随滚动变化,每次都需刷新;但样式属性(font/padding/lineHeight)只在 focus 切换时变,可长期复用
  // 这里折中:每次测量都刷新 rect,但其他样式属性从缓存读
  const rect = el.getBoundingClientRect()
  if (!cache) {
    cache = refreshStyleCache(el)
  }
  // 用最新 rect 覆盖缓存中的 rect(滚动场景下 rect 会变)
  const c: ComputedStyleCache = { ...cache, rect }

  const pos = el.selectionStart ?? 0
  const { pl, pt, bl, bt, lh, contentW, font, letterSpacing, textTransform, wordSpacing, paddingLeft, paddingRight, isInput } = c

  ensureMirror()
  if (!mirrorEl || !mirrorMarker) return { x: 0, y: 0, h: lh }

  // 复用 mirror 元素,只更新 cssText(写一次)+ textContent(写一次),不再 appendChild/remove
  const baseCSS = `position:absolute;top:-9999px;left:-9999px;visibility:hidden;font:${font};letter-spacing:${letterSpacing};text-transform:${textTransform};word-spacing:${wordSpacing};box-sizing:border-box;`

  if (isInput) {
    mirrorEl.style.cssText = baseCSS + 'white-space:nowrap;'
  } else {
    mirrorEl.style.cssText = baseCSS + `white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;width:${contentW}px;line-height:${lh}px;padding-left:${paddingLeft};padding-right:${paddingRight};`
  }

  const textBefore = el.value.substring(0, pos)
  const textAfter = el.value.substring(pos)

  // 重建 mirror 的子节点:文本 + marker + (textarea 时)文本 + br
  // textContent 比 appendChild(childNodes) 更快,且 mirror 只有一个 marker,结构简单
  mirrorEl.textContent = ''
  mirrorEl.appendChild(document.createTextNode(textBefore))
  mirrorEl.appendChild(mirrorMarker)
  if (!isInput) {
    mirrorEl.appendChild(document.createTextNode(textAfter))
    mirrorEl.appendChild(document.createElement('br'))
  }

  // 关键:mirror 已经在 DOM 中(首次 ensureMirror 时 appendChild 一次),这里不再 appendChild/remove
  // 只触发一次同步布局读取(offsetTop/offsetLeft/offsetHeight)
  const markerTop = mirrorMarker.offsetTop
  const markerLeft = mirrorMarker.offsetLeft
  // markerH 仅用于 fallback,这里读取主要是为了触发同步布局(与原实现保持一致)
  void mirrorMarker.offsetHeight

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

// rAF 合并版 updateCaret:同一帧内多次调用只执行一次测量
// 切焦瞬间走同步路径(见 onSelectionChange/onFocus),按键走 rAF 合并路径
function scheduleUpdateCaret() {
  if (updateRafId !== null) return
  updateRafId = requestAnimationFrame(() => {
    updateRafId = null
    updateCaret()
  })
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
    // 静默忽略
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
      // 切焦时同步测量一次(不走 rAF,避免首帧延迟),并刷新样式缓存
      refreshStyleCache(el)
      updateCaret()
    } else {
      // 同一输入框内光标移动(方向键、点击移动),走 rAF 合并
      scheduleUpdateCaret()
    }
  } else {
    hideCaret()
  }
}

function onInput() {
  if (!currentInput) return
  onTyping()
  // 按键走 rAF 合并:同一帧内多次按键只测量一次,消除 layout thrashing
  scheduleUpdateCaret()
}

function onKeyDown(e: KeyboardEvent) {
  if (!currentInput) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
  onTyping()
  scheduleUpdateCaret()
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
      // 切焦时同步测量 + 刷新样式缓存(新输入框的样式属性首次读取并缓存)
      refreshStyleCache(el)
      updateCaret()
    } else {
      scheduleUpdateCaret()
    }
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
    // 清理该输入框的样式缓存(下次 focus 时重新读取)
    styleCache.delete(currentInput)
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
  // 清理 rAF 与单例 mirror
  if (updateRafId !== null) {
    cancelAnimationFrame(updateRafId)
    updateRafId = null
  }
  destroyMirror()
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
