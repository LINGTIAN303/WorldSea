<template>
  <div class="ps-wrap" ref="wrapRef">
    <!-- 触发按钮：titlebar=logo+WorldSmith+项目名；pill=轻量项目名 -->
    <button
      class="ps-trigger"
      :class="`ps--${variant}`"
      :title="currentLabel"
      @click="toggle"
    >
      <WorldSmithLogo v-if="variant === 'titlebar'" :size="15" :radius="4" class="ps-logo" />
      <span v-if="variant === 'titlebar'" class="ps-title">WorldSmith</span>
      <span class="ps-label">{{ currentLabel }}</span>
      <span class="ps-chevron"><WsIcon name="chevron-down" size="xs" /></span>
    </button>

    <!-- 下拉：打开文件夹 + 最近项目（仅切换，2026-09-03 项目=目录） -->
    <Teleport to="body">
      <div v-if="open" class="ps-backdrop" @click="close"></div>
      <Transition name="dropdown">
        <div v-if="open" class="ps-menu" :style="menuStyle">
          <div class="ps-menu-header">项目</div>
          <button class="ps-open-folder" @click="onOpenFolder">
            <WsIcon name="folder-open" size="sm" /><span>打开文件夹…</span>
          </button>
          <div class="ps-divider"></div>
          <div class="ps-recents-label">最近项目</div>
          <div v-if="recents.length === 0" class="ps-empty">暂无最近项目，点击「打开文件夹…」打开一个项目目录</div>
          <div v-else class="ps-list">
            <div
              v-for="p in recents"
              :key="p.id"
              class="ps-item"
              :class="{ active: p.id === currentProject?.id }"
              @click="onPick(p)"
            >
              <div class="ps-item-main">
                <span class="ps-item-name">{{ displayName(p) }}</span>
                <span class="ps-item-path" :title="p.dirPath ?? ''">{{ truncatePath(p.dirPath ?? '') }}</span>
              </div>
              <button
                v-if="p.id !== currentProject?.id && !p.isDefault"
                class="ps-item-remove"
                title="移除最近项目（不删除目录）"
                @click.stop="onRemove(p)"
              ><WsIcon name="trash" size="xs" /></button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon, useConfirm } from '@worldsmith/ui-kit'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import WorldSmithLogo from '@/components/brand/WorldSmithLogo.vue'
import type { ProjectInfo } from '@worldsmith/entity-core/core'

const props = withDefaults(defineProps<{
  /** titlebar=工作台窗口栏内嵌（logo+项目名）；pill=Agent 空态内嵌轻量 */
  variant?: 'titlebar' | 'pill'
}>(), { variant: 'pill' })

const { currentProject, projectList, switchProject, openProjectFromDialog, removeRecentProject, refreshProjectList } = useProjectSwitcher()
const { confirm } = useConfirm()

const open = ref(false)
const wrapRef = ref<HTMLElement>()
const menuStyle = ref<Record<string, string>>({})

/** 当前项目名：默认项目（无项目/未选目录的兜底）显示「默认工作区」 */
const currentLabel = computed(() => {
  const p = currentProject.value
  if (p?.isDefault) return '默认工作区'
  return p?.dirPath ? p.name : '默认工作区'
})

/** 列表项显示名：默认项目统一为「默认工作区」 */
function displayName(p: ProjectInfo): string {
  return p.isDefault ? '默认工作区' : p.name
}

/** 最近项目 = 有目录的项目（项目=目录语义；无目录即未打开，不展示） */
const recents = computed<ProjectInfo[]>(() => projectList.value.filter((p) => !!p.dirPath))

/** 路径截断（中间省略，保留头尾） */
function truncatePath(p: string, max = 30): string {
  if (p.length <= max) return p
  const head = p.slice(0, Math.floor(max * 0.6))
  const tail = p.slice(-Math.floor(max * 0.35))
  return `${head}…${tail}`
}

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    void refreshProjectList()
    void position()
  }
}
function close(): void {
  open.value = false
}

async function position(): Promise<void> {
  await nextTick()
  const el = wrapRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const W = 300
  const H = Math.min(360, window.innerHeight - 24)
  let left = rect.left
  let top = rect.bottom + 6
  if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8)
  if (top + H > window.innerHeight - 8) top = Math.max(8, rect.top - H - 6)
  menuStyle.value = { top: `${top}px`, left: `${left}px`, width: `${W}px`, maxHeight: `${H}px` }
}

async function onOpenFolder(): Promise<void> {
  const ok = await openProjectFromDialog()
  if (ok) close()
}

async function onPick(p: ProjectInfo): Promise<void> {
  close()
  if (p.id === currentProject.value?.id) return
  await switchProject(p.id)
}

async function onRemove(p: ProjectInfo): Promise<void> {
  const ok = await confirm({
    type: 'warning',
    title: '移除最近项目',
    description: `仅将「${p.name}」从最近项目列表移除记录，目录与其中的数据不会被删除。确定移除？`,
  })
  if (!ok) return
  const done = await removeRecentProject(p.id)
  if (done) void refreshProjectList()
}

onMounted(() => {
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEsc)
  open.value = false
})
function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
</script>

<style scoped>
.ps-wrap {
  display: inline-flex;
}
.ps-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: background 0.12s, color 0.12s;
}
.ps-trigger:hover {
  background: var(--color-surface);
}
.ps--titlebar {
  font-weight: 600;
}
.ps--titlebar .ps-logo {
  flex-shrink: 0;
}
.ps--titlebar .ps-title {
  white-space: nowrap;
}
.ps-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.ps--titlebar .ps-label {
  max-width: 200px;
  color: var(--color-primary);
}
.ps-chevron {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-tertiary);
}

.ps-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
.ps-menu {
  position: fixed;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 6px;
  overflow: hidden;
}
.ps-menu-header {
  padding: 4px 8px 6px;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ps-open-folder {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-mid);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  transition: background 0.12s;
}
.ps-open-folder:hover {
  background: var(--color-surface);
}
.ps-divider {
  height: 1px;
  background: var(--color-border);
  margin: 6px 4px;
}
.ps-recents-label {
  padding: 2px 8px 4px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}
.ps-empty {
  padding: 12px 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  text-align: center;
}
.ps-list {
  overflow-y: auto;
  max-height: 260px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ps-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-mid);
  cursor: pointer;
  transition: background 0.12s;
}
.ps-item:hover {
  background: var(--color-surface);
}
.ps-item.active {
  background: var(--color-primary-muted);
}
.ps-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ps-item-name {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ps-item-path {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.ps-item-remove {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
}
.ps-item:hover .ps-item-remove {
  opacity: 1;
}
.ps-item-remove:hover {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.12);
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>