<template>
  <!-- 「⋯ 更多操作」菜单：原 MenuBar 右侧菜单迁移（2026-08-08，MenuBar 整行移除后并入窗口栏）。
       hover 展开 / 点击固定（pin），点外部取消；菜单项通过全局事件分发到 Shell 各处理器 -->
  <div
    class="appmenu"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <button
      class="appmenu-btn"
      :class="{ 'appmenu-btn--pinned': pinned }"
      ref="triggerRef"
      aria-label="更多操作"
      title="更多操作"
      @pointerdown.stop
      @click="togglePin"
    >⋯</button>
    <Teleport to="body">
      <Transition name="ws-menu">
        <div
          v-if="menuVisible"
          class="appmenu-dropdown"
          role="menu"
          :style="dropdownStyle"
          @mouseenter="onEnter"
          @mouseleave="onLeave"
        >
          <div class="appmenu-list">
          <!-- 插件贡献项（批6）：overlay 真源带 menu 声明的自动渲染，点击 dispatch `ws-open-<id>`；
               order 升序，L0 固定项「导出到文件夹」占位 order=1.5 插在搜索之后 -->
          <button v-for="item in menuItemsBeforeExport" :key="item.id" class="menu-item" role="menuitem" @click="openOverlay(item.id)">
            <WsIcon :name="item.menu.icon" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">{{ item.menu.label }}</span>
            <span class="menu-item-shortcut">{{ item.menu.shortcutId ? formatKeysForDisplay(keysOf(item.menu.shortcutId, [])) : '' }}</span>
          </button>
          <!-- 项目=目录（2026-09-03）：打开/切换项目走 ProjectSwitcher（TitleBar/空态/Ctrl+Shift+P）；导出到文件夹保留（L0：useFileSystemProject 逻辑项） -->
          <button class="menu-item" role="menuitem" @click="saveFolder" :disabled="saving">
            <WsIcon name="save" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">{{ saving ? '导出中...' : '导出到文件夹' }}</span>
            <span class="menu-item-shortcut">{{ formatKeysForDisplay(keysOf('project.save', ['ctrl', 's'])) }}</span>
          </button>
          <button v-for="item in menuItemsAfterExport" :key="item.id" class="menu-item" role="menuitem" @click="openOverlay(item.id)">
            <WsIcon :name="item.menu.icon" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">{{ item.menu.label }}</span>
            <span class="menu-item-shortcut"></span>
          </button>
        </div>
        <div class="menu-divider"></div>
        <!-- 设置（order=99，settings 插件贡献；快捷键标注读注册表） -->
        <button v-for="item in menuItemsTail" :key="item.id" class="menu-item" role="menuitem" @click="openOverlay(item.id)">
          <span class="menu-item-icon"><WsIcon :name="item.menu.icon" size="sm" /></span>
          <span class="menu-item-label">{{ item.menu.label }}</span>
          <span class="menu-item-shortcut">{{ item.menu.shortcutId ? formatKeysForDisplay(keysOf(item.menu.shortcutId, [])) : '' }}</span>
        </button>
        </div>
      </Transition>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="appmenu-hotzone"
        :style="hotzoneStyle"
        @mouseenter="onEnter"
        @mouseleave="onLeave"
      ></div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="pinned"
        class="appmenu-overlay"
        @pointerdown.stop
        @click="unpin"
      ></div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useShortcuts, formatKeysForDisplay } from '@worldsea/plugin-sdk'
import { useFileSystemProject } from '@/composables/useFileSystemProject'
import { useToast } from '@/composables/useToast'
import { WsIcon } from '@worldsea/ui-kit'

const { register, getRegisteredKeys } = useShortcuts()
/** 菜单标注读注册表当前键位（用户改键后同步显示），fallback 为默认值 */
function keysOf(id: string, fallback: string[]): string[] {
  return getRegisteredKeys(id) ?? fallback
}
// 项目=目录（2026-09-03）：绑定入口已移除（目录即项目，走 ProjectSwitcher）；导出能力保留
const { saving, saveToFolder, lastError } = useFileSystemProject()
const { toastSuccess, toastWarn } = useToast()

const hovering = ref(false)
const pinned = ref(false)
const manuallyClosed = ref(false)
const triggerRef = ref<HTMLElement>()
const dropdownStyle = ref<Record<string, string>>({})
const hotzoneStyle = ref<Record<string, string>>({})

const menuVisible = computed(() => (hovering.value || pinned.value) && !manuallyClosed.value)

// 菜单打开时按触发按钮坐标定位（Teleport 到 body，向上展开适配侧边栏底部）
watch(menuVisible, (v) => {
  if (v) {
    nextTick(() => {
      const el = triggerRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      dropdownStyle.value = {
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 8}px`,
        minWidth: '220px',
      }
      // 衔接热区：覆盖按钮顶部与菜单底部之间的空隙（略加宽便于斜向穿越），
      // 使鼠标能从按钮平滑移动到菜单而不触发关闭
      hotzoneStyle.value = {
        left: `${rect.left - 10}px`,
        top: `${rect.top - 14}px`,
        width: `${rect.width + 20}px`,
        height: '14px',
      }
    })
  }
})

function onEnter() {
  hovering.value = true
  manuallyClosed.value = false
}

function onLeave(e: MouseEvent) {
  // 若鼠标正移入悬停组内其他元素（按钮/热区/菜单），保持菜单打开，实现衔接穿越
  const related = e.relatedTarget as HTMLElement | null
  if (related && related.closest('.appmenu, .appmenu-hotzone, .appmenu-dropdown')) {
    return
  }
  hovering.value = false
}

function togglePin() {
  if (pinned.value) {
    unpin()
  } else {
    pinned.value = true
    manuallyClosed.value = false
  }
}

function unpin() {
  pinned.value = false
  manuallyClosed.value = true
  setTimeout(() => { manuallyClosed.value = false }, 200)
}

function closeMenu() {
  pinned.value = false
  hovering.value = false
  manuallyClosed.value = true
  setTimeout(() => { manuallyClosed.value = false }, 200)
}

onMounted(() => {
  register({
    id: 'menu.import-export',
    keys: ['ctrl', 'shift', 's'],
    description: '导入/导出',
    scope: 'global',
    handler: () => { window.dispatchEvent(new CustomEvent('ws-open-import-export')) },
  })
})

/* ─── 插件贡献的菜单项（批6）：overlay 真源带 menu 声明的自动渲染 ─── */
import { pluginAPI } from '@worldsea/entity-core'
import type { PluginOverlay } from '@worldsea/entity-core'

const overlayItems = ref<PluginOverlay[]>([])
pluginAPI.onOverlayChange(() => { overlayItems.value = [...pluginAPI.getOverlays()] })
overlayItems.value = [...pluginAPI.getOverlays()]

/** 带 menu 声明的贡献项，order 升序 */
const menuContribs = computed(() =>
  overlayItems.value
    .filter(o => o.menu)
    .map(o => ({ id: o.id, menu: o.menu! }))
    .sort((a, b) => a.menu.order - b.menu.order),
)
/** L0 固定项「导出到文件夹」占位 order=1.5：前段（≤1）+ 后段（>1 且 <99）+ 尾段（设置 99） */
const menuItemsBeforeExport = computed(() => menuContribs.value.filter(i => i.menu.order <= 1))
const menuItemsAfterExport = computed(() => menuContribs.value.filter(i => i.menu.order > 1 && i.menu.order < 99))
const menuItemsTail = computed(() => menuContribs.value.filter(i => i.menu.order >= 99))

function openOverlay(id: string) {
  closeMenu()
  window.dispatchEvent(new CustomEvent(`ws-open-${id}`))
}

async function saveFolder() {
  closeMenu()
  const ok = await saveToFolder()
  if (ok) {
    toastSuccess('项目已导出到文件夹')
  } else if (lastError.value) {
    toastWarn(lastError.value)
  }
}
</script>

<style scoped>
.appmenu {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.appmenu-btn {
  width: 210px;
  height: 40px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-lg);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}

.appmenu-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.appmenu-btn--pinned {
  background: var(--hover-bg);
  color: var(--text-color);
}

.appmenu-dropdown {
  position: fixed;
  min-width: 220px;
  background: var(--glass-bg, var(--bg));
  border: 1px solid var(--glass-border, var(--border-color));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: 6px;
  z-index: 2000;
  backdrop-filter: blur(var(--glass-blur));
}

.appmenu-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--gradient-subtle, var(--hover-bg));
  color: var(--accent);
}

.menu-item-icon {
  font-size: var(--font-size-md);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.menu-item-label {
  flex: 1;
  text-align: left;
}

.menu-item-shortcut {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin-left: auto;
  padding-left: 16px;
}

.menu-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 8px;
}

.appmenu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 150;
}

/* 衔接热区：按钮与菜单之间的透明桥梁，z-index 低于菜单(2000)以免遮挡菜单项 */
.appmenu-hotzone {
  position: fixed;
  z-index: 1900;
  background: transparent;
}
</style>
