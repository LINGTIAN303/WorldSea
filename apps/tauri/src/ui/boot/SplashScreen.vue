<!--
  SplashScreen.vue — WorldSmith 启动页
  ─────────────────────────────────────
  双 Canvas 分层（constellation 固定动效 + interaction 鼠标交互）
  四角 HUD 装饰 + 中央标题/加载条 + bootState 控制淡出
  配色全部复用项目 CSS 变量，跟随主题切换

  生命周期：
    1. mount 时移除 index.html 里的 #ws-splash-static 静态占位
    2. 启动 Canvas 引擎
    3. watch uiStore.bootState === 'ready' 后淡出 600ms 再卸载
-->
<template>
  <div class="ws-splash" :class="{ 'ws-splash--leaving': leaving }">
    <!-- 固定动效层：脉冲星座网络 -->
    <canvas ref="constellationRef" class="ws-splash__canvas ws-splash__canvas--const"></canvas>
    <!-- 鼠标交互动效层 -->
    <canvas ref="interactionRef" class="ws-splash__canvas ws-splash__canvas--int"></canvas>

    <!-- 扫描线纹理 -->
    <div class="ws-splash__scanlines"></div>

    <!-- 四角 HUD 装饰 -->
    <div class="ws-splash__corner ws-splash__corner--tl">
      <svg viewBox="0 0 48 48" fill="none"><path d="M0 18V0h18" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-splash__corner ws-splash__corner--tr">
      <svg viewBox="0 0 48 48" fill="none"><path d="M30 0h18v18" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-splash__corner ws-splash__corner--bl">
      <svg viewBox="0 0 48 48" fill="none"><path d="M0 30v18h18" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-splash__corner ws-splash__corner--br">
      <svg viewBox="0 0 48 48" fill="none"><path d="M30 48h18V30" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>
    </div>

    <!-- 中央内容 -->
    <div class="ws-splash__content">
      <div class="ws-splash__title-glow">
        <h1 class="ws-splash__title">WorldSmith</h1>
      </div>
      <p class="ws-splash__tagline">Build Worlds. Shape Realities.</p>
      <div class="ws-splash__loader">
        <p class="ws-splash__status">{{ statusText }}<span class="ws-splash__dots">{{ dots }}</span></p>
        <div class="ws-splash__bar-track"><div class="ws-splash__bar-fill" :style="{ width: progress + '%' }"></div></div>
        <p class="ws-splash__version">v0.1.0-alpha</p>
      </div>
    </div>

    <!-- 底部标签 -->
    <div class="ws-splash__label ws-splash__label--fixed"><span class="ws-splash__dot"></span>PULSE CONSTELLATION</div>
    <div class="ws-splash__label ws-splash__label--mouse"><span class="ws-splash__dot"></span>MOUSE INTERACTION</div>

    <!-- 自定义光标点 -->
    <div ref="cursorRef" class="ws-splash__cursor"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { createSplashEngine, type SplashEngine } from './splash-canvas'
import { useUIStore } from '../../stores/uiStore'

const constellationRef = ref<HTMLCanvasElement | null>(null)
const interactionRef = ref<HTMLCanvasElement | null>(null)
const cursorRef = ref<HTMLDivElement | null>(null)

const uiStore = useUIStore()
const leaving = ref(false)

let engine: SplashEngine | null = null
let progressTimer: ReturnType<typeof setTimeout> | null = null
let dotTimer: ReturnType<typeof setInterval> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let cursorMoveHandler: ((e: MouseEvent) => void) | null = null

// 加载进度模拟
const progress = ref(0)
const dots = ref('')
const statuses = [
  'Initializing core systems',
  'Loading layout engine',
  'Mounting WASM runtime',
  'Connecting entity store',
  'Preparing canvas renderer',
  'Almost ready',
]
const statusText = ref(statuses[0])
let statusIdx = 0

function tickProgress() {
  progress.value = Math.min(100, progress.value + Math.random() * 2.5)
  const newIdx = Math.min(statuses.length - 1, Math.floor(progress.value / (100 / statuses.length)))
  if (newIdx !== statusIdx) {
    statusIdx = newIdx
    statusText.value = statuses[statusIdx]
  }
  if (progress.value < 100) {
    progressTimer = setTimeout(tickProgress, 150 + Math.random() * 200)
  } else {
    statusText.value = 'Ready'
  }
}

function tickDots() {
  const n = (dots.value.length + 1) % 4
  dots.value = '.'.repeat(n)
}

// 移除 index.html 静态 splash
function removeStaticSplash() {
  const el = document.getElementById('ws-splash-static')
  if (el) el.remove()
}

// 鼠标光标跟随
function setupCursor() {
  cursorMoveHandler = (e: MouseEvent) => {
    if (cursorRef.value) {
      cursorRef.value.style.left = e.clientX + 'px'
      cursorRef.value.style.top = e.clientY + 'px'
    }
  }
  window.addEventListener('mousemove', cursorMoveHandler)
}

onMounted(() => {
  removeStaticSplash()
  setupCursor()

  if (constellationRef.value && interactionRef.value) {
    engine = createSplashEngine(constellationRef.value, interactionRef.value)
  }

  progressTimer = setTimeout(tickProgress, 800)
  dotTimer = setInterval(tickDots, 500)

  // 监听 bootState 就绪 → 淡出
  watch(
    () => uiStore.bootState,
    (state) => {
      if (state === 'ready') {
        progress.value = 100
        statusText.value = 'Ready'
        leaving.value = true
        // 淡出动画 600ms 后由父级 v-if 卸载，这里延时清理引擎
        leaveTimer = setTimeout(() => {
          engine?.destroy()
          engine = null
        }, 700)
      }
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  engine?.destroy()
  engine = null
  if (progressTimer) clearTimeout(progressTimer)
  if (dotTimer) clearInterval(dotTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (cursorMoveHandler) window.removeEventListener('mousemove', cursorMoveHandler)
})
</script>

<style scoped>
.ws-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background:
    radial-gradient(ellipse 60% 50% at 22% 28%, color-mix(in srgb, var(--color-primary, #7C3AED) 10%, transparent) 0%, transparent 60%),
    radial-gradient(ellipse 45% 50% at 78% 55%, color-mix(in srgb, var(--color-accent, #0891B2) 7%, transparent) 0%, transparent 60%),
    linear-gradient(135deg, var(--color-bg-base, #0D0D0D) 0%, var(--color-bg-surface, #1C1917) 50%, var(--color-bg-base, #17140F) 100%);
  overflow: hidden;
  cursor: none;
  transition: opacity 0.6s ease;
}

.ws-splash--leaving {
  opacity: 0;
  pointer-events: none;
}

.ws-splash__canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.ws-splash__canvas--const { z-index: 1; }
.ws-splash__canvas--int   { z-index: 2; }

.ws-splash__scanlines {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    rgba(255, 255, 255, 0.012) 2px,
    rgba(255, 255, 255, 0.012) 3px
  );
  mix-blend-mode: overlay;
}

.ws-splash__corner {
  position: absolute;
  width: 48px;
  height: 48px;
  z-index: 5;
  pointer-events: none;
  color: var(--color-primary, #8B5CF6);
}
.ws-splash__corner svg { width: 100%; height: 100%; }
.ws-splash__corner--tl { top: 28px; left: 28px; }
.ws-splash__corner--tr { top: 28px; right: 28px; }
.ws-splash__corner--bl { bottom: 28px; left: 28px; color: var(--color-accent, #0891B2); }
.ws-splash__corner--br { bottom: 28px; right: 28px; color: var(--color-accent, #0891B2); }

.ws-splash__content {
  position: relative;
  z-index: 4;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  pointer-events: none;
}

.ws-splash__title-glow {
  position: relative;
  display: inline-block;
}
.ws-splash__title-glow::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 120%;
  height: 160%;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--color-primary, #7C3AED) 18%, transparent) 0%, transparent 70%);
  filter: blur(20px);
  z-index: -1;
}

.ws-splash__title {
  font-family: var(--font-family-display, 'Space Grotesk'), sans-serif;
  font-weight: 700;
  font-size: clamp(48px, 6vw, 84px);
  letter-spacing: 0.08em;
  color: var(--color-text-primary, #FFFFFF);
  text-transform: uppercase;
  line-height: 1;
  margin: 0;
  animation: ws-splash-breathe 4s ease-in-out infinite;
}

@keyframes ws-splash-breathe {
  0%, 100% { text-shadow: 0 0 30px color-mix(in srgb, var(--color-primary, #7C3AED) 25%, transparent), 0 0 60px color-mix(in srgb, var(--color-primary, #7C3AED) 10%, transparent); }
  50%      { text-shadow: 0 0 40px color-mix(in srgb, var(--color-primary, #7C3AED) 40%, transparent), 0 0 80px color-mix(in srgb, var(--color-accent, #0891B2) 15%, transparent); }
}

.ws-splash__tagline {
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-weight: 400;
  font-size: clamp(14px, 1.2vw, 17px);
  letter-spacing: 0.06em;
  color: var(--color-text-secondary, #94A3B8);
  margin: 0;
}

.ws-splash__loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
}

.ws-splash__status {
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-size: var(--fs-xs);
  letter-spacing: 0.12em;
  color: var(--color-text-secondary, #94A3B8);
  text-transform: uppercase;
  opacity: 0.7;
  animation: ws-splash-fade 2s ease-in-out infinite;
  margin: 0;
}
@keyframes ws-splash-fade {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 0.9; }
}

.ws-splash__bar-track {
  position: relative;
  width: 260px;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}
.ws-splash__bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary, #7C3AED), var(--color-accent, #0891B2));
  border-radius: 2px;
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-primary, #7C3AED) 60%, transparent);
  transition: width 0.3s ease;
}

.ws-splash__version {
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--color-text-secondary, #94A3B8);
  text-transform: uppercase;
  opacity: 0.5;
  margin: 0;
}

.ws-splash__label {
  position: absolute;
  z-index: 5;
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.ws-splash__label::before {
  content: '';
  display: inline-block;
  width: 16px;
  height: 1px;
  background: currentColor;
  opacity: 0.5;
}
.ws-splash__label--fixed {
  bottom: 36px;
  left: 88px;
  color: var(--color-text-secondary, #94A3B8);
}
.ws-splash__label--mouse {
  bottom: 58px;
  left: 88px;
  color: var(--color-accent, #0891B2);
}
.ws-splash__dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: ws-splash-pulse 2s ease-in-out infinite;
}
@keyframes ws-splash-pulse {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 1; }
}

.ws-splash__cursor {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent, #22D3EE);
  border: 1.5px solid rgba(255, 255, 255, 0.6);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 16px color-mix(in srgb, var(--color-accent, #22D3EE) 80%, transparent);
  left: 50%;
  top: 50%;
}

@media (max-width: 600px) {
  .ws-splash__title { font-size: 42px; letter-spacing: 0.05em; }
  .ws-splash__bar-track { width: 200px; }
  .ws-splash__label { left: 28px; }
  .ws-splash__label--mouse { bottom: 52px; }
  .ws-splash__label--fixed { bottom: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .ws-splash__title,
  .ws-splash__status,
  .ws-splash__dot { animation: none !important; }
}
</style>
