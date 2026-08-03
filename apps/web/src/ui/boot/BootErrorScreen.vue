<!--
  BootErrorScreen.vue — 启动失败错误页
  ─────────────────────────────────────
  当 governor.boot() 报告 hasCriticalFailure 时显示。
  复用 SplashScreen 的视觉风格（深色背景 + HUD 装饰 + 扫描线）。

  功能：
    1. 展示失败的 critical 模块列表（id/name/error）
    2. 展示被跳过的模块列表（id/reason）
    3. "重试启动"按钮：重新加载页面
    4. "继续进入"按钮：调用 recoverFromError() 强制进入主界面（可能功能不完整）

  生命周期：
    由 App.vue 根据 bootState === 'error' 条件渲染
-->
<template>
  <div class="ws-boot-error">
    <!-- 扫描线纹理 -->
    <div class="ws-boot-error__scanlines"></div>

    <!-- 四角 HUD 装饰（错误态用红色调） -->
    <div class="ws-boot-error__corner ws-boot-error__corner--tl">
      <svg viewBox="0 0 48 48" fill="none"><path d="M0 18V0h18" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-boot-error__corner ws-boot-error__corner--tr">
      <svg viewBox="0 0 48 48" fill="none"><path d="M30 0h18v18" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-boot-error__corner ws-boot-error__corner--bl">
      <svg viewBox="0 0 48 48" fill="none"><path d="M0 30v18h18" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>
    <div class="ws-boot-error__corner ws-boot-error__corner--br">
      <svg viewBox="0 0 48 48" fill="none"><path d="M30 48h18V30" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>

    <!-- 中央内容 -->
    <div class="ws-boot-error__content">
      <div class="ws-boot-error__icon">
        <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
          <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2.5" stroke-opacity="0.4"/>
          <path d="M32 18v18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          <circle cx="32" cy="46" r="2.5" fill="currentColor"/>
        </svg>
      </div>

      <h1 class="ws-boot-error__title">启动失败</h1>
      <p class="ws-boot-error__subtitle">关键模块加载失败，应用无法正常启动</p>

      <!-- 失败模块列表 -->
      <div v-if="failedModules.length > 0" class="ws-boot-error__section">
        <h2 class="ws-boot-error__section-title">失败模块（{{ failedModules.length }}）</h2>
        <div class="ws-boot-error__list">
          <div v-for="m in failedModules" :key="m.id" class="ws-boot-error__item ws-boot-error__item--failed">
            <div class="ws-boot-error__item-header">
              <span class="ws-boot-error__item-name">{{ m.name }}</span>
              <code class="ws-boot-error__item-id">{{ m.id }}</code>
            </div>
            <p class="ws-boot-error__item-error">{{ m.error }}</p>
          </div>
        </div>
      </div>

      <!-- 跳过模块列表 -->
      <div v-if="skippedModules.length > 0" class="ws-boot-error__section">
        <h2 class="ws-boot-error__section-title">跳过模块（{{ skippedModules.length }}）</h2>
        <div class="ws-boot-error__list">
          <div v-for="m in skippedModules" :key="m.id" class="ws-boot-error__item ws-boot-error__item--skipped">
            <div class="ws-boot-error__item-header">
              <span class="ws-boot-error__item-name">{{ m.id }}</span>
            </div>
            <p class="ws-boot-error__item-error">{{ m.reason }}</p>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="ws-boot-error__actions">
        <button class="ws-boot-error__btn ws-boot-error__btn--primary" @click="retry">
          重试启动
        </button>
        <button class="ws-boot-error__btn ws-boot-error__btn--secondary" @click="continueAnyway">
          继续进入（可能功能不完整）
        </button>
      </div>

      <p class="ws-boot-error__hint">
        建议先检查控制台日志，或联系开发者反馈问题
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '../../stores/uiStore'

const uiStore = useUIStore()

const failedModules = computed(() => uiStore.bootError?.failedModules ?? [])
const skippedModules = computed(() => uiStore.bootError?.skippedModules ?? [])

/** 重试启动：重新加载页面 */
function retry() {
  window.location.reload()
}

/** 强制进入主界面（可能功能不完整） */
function continueAnyway() {
  uiStore.recoverFromError()
}
</script>

<style>
.ws-boot-error {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ws-bg-base, #0a0e1a);
  color: var(--ws-text-primary, #e8eaf0);
  font-family: var(--ws-font-mono, 'JetBrains Mono', 'Cascadia Code', monospace);
  overflow: auto;
  padding: 24px;
}

.ws-boot-error__scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent 0,
    transparent 2px,
    rgba(255, 255, 255, 0.015) 2px,
    rgba(255, 255, 255, 0.015) 3px
  );
}

.ws-boot-error__corner {
  position: absolute;
  width: 48px;
  height: 48px;
  color: #ff6b6b;
  opacity: 0.5;
}
.ws-boot-error__corner--tl { top: 24px; left: 24px; }
.ws-boot-error__corner--tr { top: 24px; right: 24px; }
.ws-boot-error__corner--bl { bottom: 24px; left: 24px; }
.ws-boot-error__corner--br { bottom: 24px; right: 24px; }

.ws-boot-error__content {
  position: relative;
  max-width: 640px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.ws-boot-error__icon {
  color: #ff6b6b;
  margin-bottom: 8px;
}

.ws-boot-error__title {
  font-size: 28px;
  font-weight: 700;
  color: #ff6b6b;
  letter-spacing: 0.05em;
  margin: 0;
}

.ws-boot-error__subtitle {
  font-size: 14px;
  color: var(--ws-text-secondary, #9ca3af);
  margin: 0 0 16px;
}

.ws-boot-error__section {
  width: 100%;
  margin-bottom: 8px;
}

.ws-boot-error__section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ws-text-secondary, #9ca3af);
  margin: 0 0 8px;
}

.ws-boot-error__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}

.ws-boot-error__item {
  padding: 12px 16px;
  border-radius: 6px;
  border-left: 3px solid;
  background: rgba(255, 255, 255, 0.03);
}
.ws-boot-error__item--failed {
  border-left-color: #ff6b6b;
}
.ws-boot-error__item--skipped {
  border-left-color: #fbbf24;
}

.ws-boot-error__item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.ws-boot-error__item-name {
  font-size: 14px;
  font-weight: 600;
}

.ws-boot-error__item-id {
  font-size: 11px;
  color: var(--ws-text-tertiary, #6b7280);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 3px;
}

.ws-boot-error__item-error {
  font-size: 12px;
  color: var(--ws-text-secondary, #9ca3af);
  margin: 0;
  word-break: break-word;
}

.ws-boot-error__actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.ws-boot-error__btn {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.ws-boot-error__btn--primary {
  background: #ff6b6b;
  color: #fff;
}
.ws-boot-error__btn--primary:hover {
  background: #ff5252;
}

.ws-boot-error__btn--secondary {
  background: transparent;
  color: var(--ws-text-secondary, #9ca3af);
  border-color: rgba(255, 255, 255, 0.15);
}
.ws-boot-error__btn--secondary:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--ws-text-primary, #e8eaf0);
}

.ws-boot-error__hint {
  font-size: 11px;
  color: var(--ws-text-tertiary, #6b7280);
  margin: 8px 0 0;
}
</style>
