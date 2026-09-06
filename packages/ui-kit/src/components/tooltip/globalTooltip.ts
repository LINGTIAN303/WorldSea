/**
 * globalTooltip — 浏览器原生 title 提示的全局接管（统一样式浮层）
 *
 * 原理（方案 A，2026-09-06 拍板）：启用后先全量扫描再以 MutationObserver 监听 DOM，
 * 凡元素带 `title` 属性 → 摘除属性并转存为 `data-ws-tip`（原生提示从此不再触发）；
 * 悬停命中采用「pointermove + rAF 节流 + elementFromPoint 几何命中」——
 * 不依赖事件 target，因此 disabled 按钮（事件被吞但几何命中仍在）同样生效。
 * 键盘可达：focusin 立即显示（无延迟）、focusout 隐藏；显示期间在锚上挂 aria-describedby。
 *
 * 覆盖：静态/动态 title、disabled 按钮、焦点可达元素。
 * 豁免：iframe 的 title（无障碍名，本就不渲染视觉提示，保留原生语义）；
 *       带 data-ws-tip-native 的元素（逃生舱，保留原生行为）。
 * 主题：浮层以文字色为底、面板色为字（明暗主题自然反色），遵循 prefers-reduced-motion。
 * 注意：摘除 title 后 `el.title` 读取为空——确需原生语义的元素挂 data-ws-tip-native。
 */

const TIP_ATTR = 'data-ws-tip'
const KEYS_ATTR = 'data-ws-tip-keys'
const NATIVE_KEEP_ATTR = 'data-ws-tip-native'
const TIP_ID = 'ws-global-tooltip'
const STYLE_ID = 'ws-global-tooltip-style'
const DELAY_MS = 300
const EDGE = 8

let enabled = false
let observer: MutationObserver | null = null
let tipEl: HTMLDivElement | null = null
let anchor: Element | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let rafId: number | null = null
let lastPointer = { x: 0, y: 0 }

const TOOLTIP_CSS = `
.ws-global-tooltip {
  position: fixed;
  z-index: 14000;
  max-width: 320px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--color-text, #1f1f1f);
  color: var(--color-bg-surface, #fff);
  font-size: var(--font-size-xs, 12px);
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  opacity: 0;
  transition: opacity 0.12s ease;
}
/* 键位块（data-ws-tip-keys）：与文字同行、右置弱化 */
.ws-global-tooltip .ws-tip-kbd {
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}
.ws-global-tooltip.ws-show { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .ws-global-tooltip { transition: none; }
}
`

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = TOOLTIP_CSS
  document.head.appendChild(style)
}

function ensureTip(): HTMLDivElement {
  if (tipEl) return tipEl
  tipEl = document.createElement('div')
  tipEl.className = 'ws-global-tooltip'
  tipEl.id = TIP_ID
  tipEl.setAttribute('role', 'tooltip')
  document.body.appendChild(tipEl)
  return tipEl
}

/** 单元素摘除：title → data-ws-tip；显示中的锚实时同步文案 */
function stripElement(el: Element): void {
  if (el.tagName === 'IFRAME') return
  if (el.hasAttribute(NATIVE_KEEP_ATTR)) return
  const t = el.getAttribute('title')
  if (t == null || t === '') return
  el.setAttribute(TIP_ATTR, t)
  el.removeAttribute('title')
  if (el === anchor) renderTip(el)
}

function stripPass(root: ParentNode): void {
  const els = (root as Element).querySelectorAll?.('[title]')
  if (els) els.forEach(stripElement)
}

function onMutation(muts: MutationRecord[]): void {
  for (const m of muts) {
    if (m.type === 'attributes') {
      const el = m.target as Element
      if (el.getAttribute('title')) stripElement(el)
    } else {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          stripElement(n as Element)
          stripPass(n as Element)
        }
      }
    }
  }
}

function renderTip(el: Element): void {
  const tip = ensureTip()
  // 文字 + 快捷键块（data-ws-tip-keys，如 "Ctrl+N"）：DOM 拼接而非 innerHTML，防注入
  tip.textContent = ''
  tip.append(document.createTextNode(el.getAttribute(TIP_ATTR) || ''))
  const keys = el.getAttribute(KEYS_ATTR)
  if (keys) {
    const kbd = document.createElement('kbd')
    kbd.className = 'ws-tip-kbd'
    kbd.textContent = keys
    tip.append(kbd)
  }
  // 先置于原点测量，再按锚矩形定位：优先上方，空间不足翻下方，水平钳位视口
  tip.style.left = '0px'
  tip.style.top = '0px'
  const rect = el.getBoundingClientRect()
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  let left = rect.left + rect.width / 2 - tw / 2
  left = Math.min(Math.max(EDGE, left), window.innerWidth - tw - EDGE)
  let top = rect.top - th - 8
  if (top < EDGE) top = rect.bottom + 8
  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.round(top)}px`
}

function show(el: Element, immediate = false): void {
  if (anchor === el) return
  hide()
  anchor = el
  const open = (): void => {
    if (anchor !== el) return
    renderTip(el)
    const tip = ensureTip()
    tip.classList.add('ws-show')
    el.setAttribute('aria-describedby', TIP_ID)
  }
  if (immediate) open()
  else showTimer = setTimeout(open, DELAY_MS)
}

function hide(): void {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (anchor) {
    anchor.removeAttribute('aria-describedby')
    anchor = null
  }
  tipEl?.classList.remove('ws-show')
}

/** 几何命中：每帧一次 elementFromPoint + closest，天然覆盖 disabled 按钮 */
function hitTestAt(x: number, y: number): void {
  if (anchor && !anchor.isConnected) hide()
  const hit = document.elementFromPoint(x, y)
  const el = (hit?.closest(`[${TIP_ATTR}]`) as Element | null) ?? null
  if (el === anchor) return
  if (el) show(el)
  else hide()
}

function onPointerMove(e: PointerEvent): void {
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    hitTestAt(lastPointer.x, lastPointer.y)
  })
}

function onFocusIn(e: FocusEvent): void {
  const el = (e.target as Element | null)?.closest?.(`[${TIP_ATTR}]`) as Element | null
  if (el) show(el, true)
  else hide()
}

/** 启用全局接管（幂等）。在应用根入口挂载一次即可覆盖两种壳与全部子树。 */
export function enableGlobalTooltips(): void {
  if (enabled || typeof document === 'undefined') return
  enabled = true
  injectStyle()
  stripPass(document)
  observer = new MutationObserver(onMutation)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  })
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('scroll', hide, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', hide, true)
  window.addEventListener('blur', hide)
  window.addEventListener('resize', hide)
}

/** 停用并还原监听（属性不回填；后续 title 写入会重新被接管） */
export function disableGlobalTooltips(): void {
  if (!enabled) return
  enabled = false
  hide()
  observer?.disconnect()
  observer = null
  document.removeEventListener('pointermove', onPointerMove, true)
  document.removeEventListener('pointerdown', hide, true)
  document.removeEventListener('scroll', hide, true)
  document.removeEventListener('focusin', onFocusIn, true)
  document.removeEventListener('focusout', hide, true)
  window.removeEventListener('blur', hide)
  window.removeEventListener('resize', hide)
}
