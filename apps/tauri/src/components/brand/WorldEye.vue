<!--
  WorldEye.vue — 「世界之眼」品牌视觉（三层单色位图 + CSS mask 运行时着色）
  ─────────────────────────────
  图层：眼眶 / 眉毛（跟随 --color-text-primary，明暗主题自动翻转墨色）+ 眼球地球（跟随 --color-accent 强调色轴）
  动效：开眼入场 → 随机眨眼 → 眼球跟随鼠标 → 鼠标静止后自动环顾（利萨如曲线）
  开关：data-anim-splash='off'（动画分组·启动动画）或减弱动效（根属性 / localStorage）时全静态睁眼
  坐标系：眼眶画布 1441×932（源稿 docs/misc/素材/世界之眼-分层源稿.svg），三层按百分比定位；
  眼球外以椭圆 clip-path 限定在眼窝开口内（中心 37.82%/54.45%，半径 22.9%/22%）
-->
<template>
  <div ref="rootRef" class="ws-eye" aria-hidden="true">
    <div class="ws-eye__lid" :class="{ 'ws-eye__lid--closed': !opened }">
      <div ref="groupRef" class="ws-eye__group">
        <div class="ws-eye__layer ws-eye__layer--socket"></div>
        <div class="ws-eye__clip">
          <div ref="irisRef" class="ws-eye__layer ws-eye__layer--iris"></div>
        </div>
        <div class="ws-eye__layer ws-eye__layer--brow"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const rootRef = ref<HTMLElement | null>(null)
const groupRef = ref<HTMLElement | null>(null)
const irisRef = ref<HTMLElement | null>(null)
/** 开眼入场：动效被禁用时初始化即 true（不播入场、不闪闭眼帧），启用时 mount 后放开 */
const opened = ref(!animAllowed())

// ── 动效开关：与启动页 CSS 消费的 data-anim-splash 约定同源；独立入口无 settingsStore，直接读 localStorage ──
function animAllowed(): boolean {
  try {
    const ds = document.documentElement.dataset
    if (ds.animSplash === 'off') return false
    if (ds.reduceMotion === 'on') return false
    if (localStorage.getItem('worldsea_reduce_motion') === 'true') return false
    const groups = JSON.parse(localStorage.getItem('worldsea_animations') || '{}')
    if (groups.splash === false) return false
  } catch {
    /* 解析失败按允许动效处理 */
  }
  return true
}

// ── 眼球跟随 / 环顾 / 眨眼 ──
const MAX_X = 0.032   // 位移上限（容器宽度的百分比，≈眼窝安全区）
const MAX_Y = 0.024
let raf = 0
let blinkTimer: ReturnType<typeof setTimeout> | null = null
let blinkResetTimer: ReturnType<typeof setTimeout> | null = null
let mouseHandler: ((e: MouseEvent) => void) | null = null
let target = { x: 0, y: 0 }
let cur = { x: 0, y: 0 }
let lastMove = 0
let t0 = 0

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))

function onMouseMove(e: MouseEvent) {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // 眼球中心 = clip 椭圆中心（容器 37.82% / 54.45%）；光标偏移按窗口宽度归一，全屏映射满量程
  const dx = (e.clientX - (r.left + 0.3782 * r.width)) / window.innerWidth
  const dy = (e.clientY - (r.top + 0.5445 * r.height)) / window.innerHeight
  target = { x: clamp(dx * 0.08, MAX_X), y: clamp(dy * 0.08, MAX_Y) }
  lastMove = performance.now()
}

function frame(t: number) {
  if (t - lastMove > 2500) {
    // 无人操作：利萨如曲线自动环顾
    const a = (t - t0) / 1000
    target = {
      x: Math.sin(a * 0.7) * 0.022 + Math.sin(a * 1.7) * 0.006,
      y: Math.cos(a * 0.5) * 0.01 + Math.sin(a * 1.3) * 0.005,
    }
  }
  cur.x += (target.x - cur.x) * 0.1
  cur.y += (target.y - cur.y) * 0.1
  const el = rootRef.value
  if (el) {
    const r = el.getBoundingClientRect()
    irisRef.value?.style.setProperty('transform', `translate(${cur.x * r.width}px, ${cur.y * r.height}px)`)
  }
  raf = requestAnimationFrame(frame)
}

function blink() {
  const g = groupRef.value
  if (!g) return
  g.classList.add('ws-eye__group--blink')
  blinkResetTimer = setTimeout(() => g.classList.remove('ws-eye__group--blink'), 120)
}

function scheduleBlink(first = false) {
  blinkTimer = setTimeout(
    () => {
      blink()
      scheduleBlink()
    },
    first ? 1600 : 2800 + Math.random() * 2700,
  )
}

onMounted(() => {
  if (!animAllowed()) return
  mouseHandler = onMouseMove
  window.addEventListener('mousemove', mouseHandler)
  t0 = performance.now()
  lastMove = t0
  raf = requestAnimationFrame(frame)
  // 开眼入场：等首帧闭眼样式提交后再放开，触发 0.65s 过渡
  requestAnimationFrame(() => requestAnimationFrame(() => (opened.value = true)))
  scheduleBlink(true)
})

onUnmounted(() => {
  if (mouseHandler) window.removeEventListener('mousemove', mouseHandler)
  if (raf) cancelAnimationFrame(raf)
  if (blinkTimer) clearTimeout(blinkTimer)
  if (blinkResetTimer) clearTimeout(blinkResetTimer)
})
</script>

<style scoped>
.ws-eye {
  position: relative;
  width: 100%;
  aspect-ratio: 1441 / 932;
  pointer-events: none;
}

/* 开眼入场层与眨眼层分开：入场一次性过渡（弹性缓动），眨眼高频快速过渡，互不打架 */
.ws-eye__lid,
.ws-eye__group {
  position: absolute;
  inset: 0;
  transform-origin: 37.82% 54.45%;
}
.ws-eye__lid {
  transition: transform 0.65s cubic-bezier(0.3, 1.35, 0.45, 1);
}
.ws-eye__lid--closed {
  transform: scaleY(0.045);
}
.ws-eye__group {
  transition: transform 0.09s ease-in;
}
.ws-eye__group--blink {
  transform: scaleY(0.05);
}

/* 三层单色位图 → mask 着色：墨色层随 --color-text-primary 翻转明暗，虹膜随 --color-accent 走强调色轴 */
.ws-eye__layer {
  position: absolute;
  background: var(--color-text-primary, #f4f4f5);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.ws-eye__layer--socket {
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  -webkit-mask-image: url('@/assets/eye/eye-socket.webp');
  mask-image: url('@/assets/eye/eye-socket.webp');
}
.ws-eye__layer--brow {
  left: 3.12%;
  top: 17.6%;
  width: 62.11%;
  height: 39.06%;
  -webkit-mask-image: url('@/assets/eye/eye-brow.webp');
  mask-image: url('@/assets/eye/eye-brow.webp');
}
.ws-eye__layer--iris {
  left: 23.94%;
  top: 33.37%;
  width: 28.66%;
  height: 43.24%;
  background: var(--color-accent, #0891b2);
  will-change: transform;
  -webkit-mask-image: url('@/assets/eye/eye-iris.webp');
  mask-image: url('@/assets/eye/eye-iris.webp');
}
.ws-eye__clip {
  position: absolute;
  inset: 0;
  clip-path: ellipse(22.9% 22% at 37.82% 54.45%);
}

/* 动画分组·启动动画关闭：与 SplashScreen 的关闭约定同组 */
:root[data-anim-splash='off'] .ws-eye__lid,
:root[data-anim-splash='off'] .ws-eye__group {
  transition: none !important;
}
:root[data-anim-splash='off'] .ws-eye__lid--closed {
  transform: none;
}
</style>
