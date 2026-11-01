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

<style scoped src="./splash-screen.css"></style>
