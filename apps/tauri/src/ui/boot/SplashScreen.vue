<!--
  SplashScreen.vue — WorldSea 启动页
  ─────────────────────────────────────
  双 Canvas 分层（constellation 固定动效 + interaction 鼠标交互）
  四角 HUD 装饰 + 中央标题/加载条 + bootState 控制淡出
  配色全部复用项目 CSS 变量，跟随主题切换

  生命周期：
    1. mount 时移除 index.html 里的 #ws-splash-static 静态占位
    2. 启动 Canvas 引擎
    3. watch uiStore.bootState === 'ready' 后淡出 600ms；App.vue 的 splashVisible 保留 750ms 再卸载
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
      <div class="ws-splash__logo-glow">
        <WorldEye class="ws-splash__eye" />
      </div>
      <div class="ws-splash__title-glow">
        <h1 class="ws-splash__title">WorldSea</h1>
      </div>
      <p class="ws-splash__tagline">Build Worlds. Shape Realities.</p>
      <div class="ws-splash__loader">
        <p class="ws-splash__status" aria-live="polite">{{ statusText }}</p>
        <div class="ws-splash__route" aria-hidden="true">
          <div class="ws-splash__route-track">
            <div class="ws-splash__route-fill" :style="{ width: progressPct + '%' }"></div>
            <span
              v-for="(s, i) in BOOT_STAGES"
              :key="s.key"
              class="ws-splash__route-node"
              :class="{ done: isStageDone(i), active: isStageActive(i) }"
              :style="{ left: `${stageLeft(i)}%` }"
            ></span>
            <span class="ws-splash__route-star" :style="{ left: progressPct + '%' }"></span>
          </div>
          <div class="ws-splash__route-labels">
            <span
              v-for="(s, i) in BOOT_STAGES"
              :key="s.key"
              :class="{ done: isStageDone(i), active: isStageActive(i) }"
            >{{ s.short }}</span>
          </div>
        </div>
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { createSplashEngine, type SplashEngine } from './splash-canvas'
import { useUIStore } from '../../stores/uiStore'
import WorldEye from '../../components/brand/WorldEye.vue'

const constellationRef = ref<HTMLCanvasElement | null>(null)
const interactionRef = ref<HTMLCanvasElement | null>(null)
const cursorRef = ref<HTMLDivElement | null>(null)

const uiStore = useUIStore()
const leaving = ref(false)

let engine: SplashEngine | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let cursorMoveHandler: ((e: MouseEvent) => void) | null = null

/** 真实启动阶段（与 uiStore.bootStage 一一对应；ready 不在其中） */
const BOOT_STAGES = [
  { key: 'backend', short: '核心', full: '初始化核心' },
  { key: 'project', short: '项目', full: '恢复项目' },
  { key: 'shell', short: '界面', full: '装配界面' },
  { key: 'bridge', short: '桥接', full: '系统桥接' },
] as const

const activeIndex = computed(() => {
  const i = BOOT_STAGES.findIndex(s => s.key === uiStore.bootStage)
  if (i >= 0) return i
  return uiStore.bootState === 'ready' ? BOOT_STAGES.length - 1 : 0
})

const progressPct = computed(() => {
  if (uiStore.bootState === 'ready') return 100
  const max = Math.max(1, BOOT_STAGES.length - 1)
  return (Math.min(activeIndex.value, BOOT_STAGES.length - 1) / max) * 100
})

const statusText = computed(() => {
  if (uiStore.bootState === 'ready') return '就绪'
  return BOOT_STAGES[activeIndex.value]?.full ?? BOOT_STAGES[0].full
})

function isStageDone(i: number): boolean {
  return uiStore.bootState === 'ready' || i < activeIndex.value
}

function isStageActive(i: number): boolean {
  return uiStore.bootState !== 'ready' && i === activeIndex.value
}

function stageLeft(i: number): number {
  return (i / Math.max(1, BOOT_STAGES.length - 1)) * 100
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

  // 监听 bootState 就绪 → 淡出
  watch(
    () => uiStore.bootState,
    (state) => {
      if (state === 'ready') {
        leaving.value = true
        // 淡出 600ms；父级 splashVisible 保留 750ms 后卸载，这里延时清理引擎
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

/* 世界之眼：辉光壳沿用 Logo 位（辉光 + 轻微浮动，宽度给到主视觉量级） */
.ws-splash__logo-glow {
  position: relative;
  display: inline-block;
  line-height: 0;
  margin-bottom: -6px;
}
.ws-splash__logo-glow::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 140%;
  height: 140%;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--color-primary, #7C3AED) 22%, transparent) 0%, transparent 68%);
  filter: blur(18px);
  z-index: -1;
  animation: ws-splash-breathe 4s ease-in-out infinite;
}
.ws-splash__eye {
  display: block;
  width: clamp(200px, 22vw, 260px);
  animation: ws-splash-logo-float 5s ease-in-out infinite;
}
@keyframes ws-splash-logo-float {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(-3px) scale(1.015); }
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
  margin: 0;
  min-height: 1.4em;
}

/* 四段真实航线：1px 线程 + 星头，不显示假百分比 */
.ws-splash__route {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ws-splash__route-track {
  position: relative;
  height: 1px;
  background: rgba(255, 255, 255, 0.14);
}
.ws-splash__route-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--color-primary, #7C3AED), var(--color-accent, #0891B2));
  transition: width 0.5s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.ws-splash__route-node {
  position: absolute;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  transform: translate(-50%, -50%);
  transition: background 0.3s ease, box-shadow 0.3s ease;
}
.ws-splash__route-node.done { background: var(--color-primary, #7C3AED); }
.ws-splash__route-node.active {
  width: 7px;
  height: 7px;
  background: var(--color-accent, #0891B2);
  box-shadow: 0 0 8px color-mix(in srgb, var(--color-accent, #0891B2) 65%, transparent);
}
.ws-splash__route-star {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent, #0891B2);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 7px color-mix(in srgb, var(--color-accent, #0891B2) 80%, transparent);
  transition: left 0.5s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}
.ws-splash__route-labels {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary, #94A3B8);
  text-transform: uppercase;
}
.ws-splash__route-labels span { text-align: center; opacity: 0.55; transition: color 0.3s ease, opacity 0.3s ease; }
.ws-splash__route-labels span.done { opacity: 0.85; }
.ws-splash__route-labels span.active {
  color: var(--color-accent, #0891B2);
  opacity: 1;
}

.ws-splash__version {
  font-family: var(--font-family-base, 'DM Sans'), sans-serif;
  font-size: var(--fs-2xs);
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
  font-size: var(--fs-2xs);
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
  .ws-splash__route { width: 220px; }
  .ws-splash__label { left: 28px; }
  .ws-splash__label--mouse { bottom: 52px; }
  .ws-splash__label--fixed { bottom: 30px; }
}

:root[data-anim-splash='off'] .ws-splash__title,
:root[data-anim-splash='off'] .ws-splash__dot,
:root[data-anim-splash='off'] .ws-splash__eye { animation: none !important; }

:root[data-anim-splash='off'] .ws-splash__route-fill,
:root[data-anim-splash='off'] .ws-splash__route-star,
:root[data-anim-splash='off'] .ws-splash__route-node,
:root[data-anim-splash='off'] .ws-splash__route-labels span {
  transition: none;
}
</style>
