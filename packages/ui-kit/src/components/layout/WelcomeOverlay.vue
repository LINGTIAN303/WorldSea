<template>
  <Transition name="ws-fade">
    <div v-if="visible" class="welcome-overlay" @click.self="skip">
      <div ref="dialogRef" class="welcome-card" role="dialog" aria-modal="true" aria-label="欢迎使用 WorldSea" tabindex="-1" :style="{ width: modalResizable.width.value + 'px' }">
        <button class="skip-btn" @click="skip">跳过</button>

        <div class="step-content">
          <div v-if="step === 0" class="step step-welcome">
            <div class="step-icon"><WsIcon name="globe" :size="48" /></div>
            <h1 class="step-title">欢迎使用 WorldSea</h1>
            <p class="step-desc">你的世界观构建助手。在这里，你可以创建角色、区域、时间线、势力等，并将它们编织成一个完整的虚构世界。</p>
          </div>

          <div v-if="step === 1" class="step step-start">
            <h2 class="step-title">从哪里开始？</h2>
            <div class="quick-start-grid">
              <button
                v-for="card in quickStartCards"
                :key="card.viewId"
                class="quick-card"
                @click="handleCardClick(card)"
              >
                <WsIcon :name="card.icon" size="xl" class="quick-card-icon" />
                <span class="quick-card-label">{{ card.label }}</span>
                <span class="quick-card-desc">{{ card.desc }}</span>
              </button>
            </div>
          </div>

          <div v-if="step === 2" class="step step-tips">
            <h2 class="step-title">一些小提示</h2>
            <ul class="tips-list">
              <li class="tip-item">
                <WsIcon name="keyboard" size="sm" class="tip-icon" />
                <span>使用 <kbd>Ctrl</kbd>+<kbd>K</kbd> 随时搜索你的实体</span>
              </li>
              <li class="tip-item">
                <WsIcon name="folder" size="sm" class="tip-icon" />
                <span>在侧边栏切换不同的视图模块</span>
              </li>
              <li class="tip-item">
                <WsIcon name="palette" size="sm" class="tip-icon" />
                <span>每个模块都有独特的可视化方式，探索它们吧</span>
              </li>
            </ul>
            <button class="start-btn" @click="dismiss">开始使用</button>
          </div>
        </div>

        <div class="step-nav">
          <button v-if="step > 0" class="nav-btn nav-prev" @click="step--">上一步</button>
          <div v-else class="nav-btn-placeholder"></div>

          <div class="step-dots" role="tablist" aria-label="欢迎引导步骤">
            <span
              v-for="i in 3"
              :key="i"
              class="dot"
              :class="{ active: i - 1 === step }"
              role="tab"
              :aria-selected="i - 1 === step"
              :aria-label="`第 ${i} 步`"
              tabindex="0"
              @click="step = i - 1"
              @keydown.enter.prevent="step = i - 1"
              @keydown.space.prevent="step = i - 1"
            ></span>
          </div>

          <button v-if="step < 2" class="nav-btn nav-next" @click="step++">下一步</button>
          <div v-else class="nav-btn-placeholder"></div>
        </div>
        <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useEntityStore, usePluginStore } from '@worldsea/entity-core'
import { useUIStore } from '@worldsea/entity-core'
import { useResizable, useModalShortcuts } from '@worldsea/ui-kit'
import WsIcon from '../WsIcon.vue'

const WELCOME_KEY = 'worldsea_welcomed'

const visible = ref(false)
const step = ref(0)

const dialogRef = ref<HTMLElement | null>(null)
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// Esc 跳过收编 useModalShortcuts（modal 层）
useModalShortcuts(visible, { id: 'welcome.close', onEscape: () => skip() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 焦点陷阱：Tab 仅在弹窗内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!visible.value) return
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

watch(visible, (v) => {
  if (v) {
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown) // Tab 焦点陷阱（Esc 已收编注册表）
    nextTick(() => {
      const first =
        dialogRef.value?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? dialogRef.value
      first?.focus({ preventScroll: true })
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
})



const entityStore = useEntityStore()
const pluginStore = usePluginStore()
const uiStore = useUIStore()
const modalResizable = useResizable({ panelId: 'modal-welcome', defaultWidth: 580, minWidth: 360 })

const quickStartCards = [
  { icon: 'character', label: '创建角色', desc: '定义你世界中的人物', viewId: 'characters' },
  { icon: 'map', label: '创建区域', desc: '绘制你的世界地图', viewId: 'regions' },
  { icon: 'timeline', label: '创建事件', desc: '编织时间线', viewId: 'timeline' },
  { icon: 'organization', label: '创建势力', desc: '建立组织架构', viewId: 'organizations' },
  { icon: 'inspiration', label: '记录灵感', desc: '捕捉你的灵感碎片', viewId: 'inspirations' },
  { icon: 'mindmap', label: '思维导图', desc: '可视化你的世界', viewId: 'mindmap' },
]

function dismiss() {
  visible.value = false
  localStorage.setItem(WELCOME_KEY, 'true')
}

function skip() {
  dismiss()
}

function handleCardClick(card: { viewId: string }) {
  const view = pluginStore.views.find(v => v.id === card.viewId)
  if (view) {
    uiStore.showView(view)
  }
  dismiss()
}

onMounted(async () => {
  const alreadyWelcomed = localStorage.getItem(WELCOME_KEY)
  if (alreadyWelcomed) return

  // 不 await loadAll：检查已有实体数量（内存缓存已加载则立即返回）
  if (entityStore.entities.length > 0) return

  visible.value = true
})
</script>

<style scoped>


.welcome-overlay {
  position: fixed;
  inset: var(--titlebar-height, 32px) 0 0 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(var(--glass-blur));
}

.welcome-card {
  position: relative;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--glass-bg, var(--modal-bg));
  border: 1px solid var(--glass-border, var(--border));
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 44px 40px 30px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  backdrop-filter: blur(var(--glass-blur));
}

.skip-btn {
  position: absolute;
  top: 14px;
  right: 18px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
}
.skip-btn:hover {
  color: var(--text);
  background: var(--hover-bg);
}

.step-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.step-icon {
  font-size: var(--icon-3xl);
  margin-bottom: 16px;
  line-height: 1;
}

.step-title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text);
  margin: 0 0 12px;
}

.step-desc {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 0;
  max-width: 400px;
}

.quick-start-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

.quick-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 12px 16px;
  background: var(--gradient-card, var(--card-bg));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform 0.2s var(--ease-spring);
}
.quick-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
  transform: translateY(-3px);
}

.quick-card-icon {
  font-size: var(--font-size-3xl);
  line-height: 1;
}

.quick-card-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text);
}

.quick-card-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.tips-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tip-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  text-align: left;
  padding: 12px 16px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.tip-icon {
  font-size: var(--font-size-xl);
  flex-shrink: 0;
}

kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: var(--font-size-xs);
  font-family: var(--font-family);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
}

.start-btn {
  margin-top: 24px;
  padding: 12px 40px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  background: var(--gradient-accent);
  color: var(--color-text-inverse);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: filter var(--transition-fast), transform 0.2s var(--ease-spring), box-shadow var(--transition-fast);
}
.start-btn:hover {
  filter: brightness(1.1);
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}

.step-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.nav-btn {
  padding: 6px 18px;
  font-size: var(--font-size-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.nav-btn:hover {
  background: var(--hover-bg);
  border-color: var(--accent);
}

.nav-btn-placeholder {
  width: 80px;
}

.step-dots {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  cursor: pointer;
  transition: background var(--transition-fast), transform 0.15s ease;
}
.dot.active {
  background: var(--accent);
  transform: scale(1.3);
}
.dot:hover:not(.active) {
  background: var(--text-tertiary);
}
.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
