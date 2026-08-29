<template>
  <div class="creation-panel">
    <!-- 空状态：无选中视图 -->
    <div v-if="!activeViewId" class="creation-empty">
      <WsIcon name="palette" size="lg" class="empty-icon" />
      <p class="empty-title">创作面板</p>
      <p class="empty-hint">选择一个创作视图开始</p>
      <button class="view-select-btn" @click="openPicker($event)">
        <WsIcon name="plus" size="sm" />选择视图
      </button>
    </div>
    <!-- 有视图时渲染 -->
    <template v-else>
      <div class="creation-header">
        <span class="creation-view-label">{{ activeViewLabel }}</span>
        <button class="creation-switch" @click="openPicker($event)" title="切换视图"><WsIcon name="refresh" size="xs" /></button>
      </div>
      <div class="creation-body">
        <component :is="activeViewComponent" />
      </div>
    </template>

    <!-- [③] 视图选择浮窗菜单（2026-08-29 由居中弹窗改为锚定触发按钮的浮窗菜单） -->
    <Teleport to="body">
      <div v-if="showPicker" class="picker-backdrop" @click="showPicker = false"></div>
      <Transition name="dropdown">
        <div v-if="showPicker" class="picker-menu" :style="pickerStyle">
          <div class="picker-header">选择创作视图</div>
          <button
            v-for="v in viewOptions"
            :key="v.id"
            class="picker-item"
            :class="{ active: v.id === activeViewId }"
            @click="selectView(v.id)"
          >
            <WsIcon :name="v.icon || 'palette'" size="sm" />
            <span class="picker-item-label">{{ v.label }}</span>
          </button>
          <div v-if="viewOptions.length === 0" class="picker-empty">暂无可用创作视图</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { usePluginStore } from '@worldsmith/entity-core'

const pluginStore = usePluginStore()
const showPicker = ref(false)
const pickerStyle = ref<Record<string, string>>({ bottom: '8px', right: '8px' })
const activeViewId = ref('')

/** 可用的插件创作视图（排除空间/主视图 `custom` 等非创作视图） */
const viewOptions = computed(() => {
  return pluginStore.views.filter(v => v.id !== 'custom')
})

const activeViewLabel = computed(() => {
  const v = pluginStore.views.find(v => v.id === activeViewId.value)
  return v?.label ?? ''
})

const activeViewComponent = computed(() => {
  const v = pluginStore.views.find(v => v.id === activeViewId.value)
  return v?.component ?? null
})

/** 打开浮窗菜单：锚定触发按钮（右下角） */
function openPicker(ev: MouseEvent) {
  const el = ev.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  pickerStyle.value = {
    bottom: `${Math.max(8, window.innerHeight - rect.top + 6)}px`,
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
  }
  showPicker.value = true
}

function selectView(id: string) {
  activeViewId.value = id
  showPicker.value = false
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') showPicker.value = false
}

onMounted(() => {
  document.addEventListener('keydown', onDocKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown, true)
})
</script>

<style scoped>
.creation-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.creation-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8px;
  padding: 20px;
  text-align: center;
}
.empty-icon {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}
.empty-title {
  margin: 0;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
}
.empty-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.view-select-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.view-select-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.creation-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.creation-view-label {
  flex: 1;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}
.creation-switch {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.creation-switch:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.creation-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
/* 浮窗菜单（锚定触发按钮） */
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}
.picker-menu {
  position: fixed;
  min-width: 220px;
  max-width: 280px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 6px;
  z-index: 10001;
}
.picker-header {
  padding: 6px 10px 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}
.picker-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.picker-item.active {
  background: var(--color-primary-muted);
  color: var(--color-text-primary);
}
.picker-item-label {
  flex: 1;
}
.picker-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>
