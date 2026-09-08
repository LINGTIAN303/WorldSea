<template>
  <div class="chapter-list">
    <div class="cl-header">
      <span class="cl-title">章节列表</span>
      <span class="cl-count">{{ chapters.length }}</span>
    </div>

    <div v-for="group in groupedChapters" :key="group.name" class="cl-group">
      <div class="cl-group-header" role="button" tabindex="0" :aria-expanded="!collapsedGroups.has(group.name)" @click="toggleGroup(group.name)" @keydown.enter.prevent="toggleGroup(group.name)" @keydown.space.prevent="toggleGroup(group.name)">
        <span class="cl-collapse"><WsIcon :name="collapsedGroups.has(group.name) ? 'chevron-right' : 'chevron-down'" size="xs" /></span>
        <span class="cl-group-name">{{ group.name }}</span>
        <span class="cl-group-count">{{ group.items.length }}</span>
      </div>
      <draggable
        v-show="!collapsedGroups.has(group.name)"
        :list="group.items"
        item-key="id"
        group="chapters"
        ghost-class="cl-ghost"
        drag-class="cl-drag"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div
            class="cl-item"
            :class="{ active: currentId === element.id }"
            role="button"
            tabindex="0"
            :aria-pressed="currentId === element.id"
            @click="$emit('select', element)"
            @keydown.enter.prevent="$emit('select', element)"
            @keydown.space.prevent="$emit('select', element)"
            @contextmenu.prevent="onContext($event, element)"
          >
            <span class="cl-item-name">{{ element.name }}</span>
            <div class="cl-item-meta">
              <span class="cl-status" :class="statusClass(element)">{{ (element.properties.status as string) || '草稿' }}</span>
              <span class="cl-words">{{ element.properties.wordCount || 0 }}字</span>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <WsEmpty v-if="chapters.length === 0" preset="no-data" title="暂无章节" />

    <div v-if="ctxMenu.show" ref="ctxMenuRef" class="cl-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" role="menu" tabindex="-1" @keydown="onCtxMenuKeydown">
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxRename" @keydown.enter.prevent="ctxRename"><WsIcon name="edit" size="xs" /> 重命名</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxCycleStatus" @keydown.enter.prevent="ctxCycleStatus"><WsIcon name="delete" size="xs" /> 切换状态</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxSetVolume" @keydown.enter.prevent="ctxSetVolume"><WsIcon name="folder" size="xs" /> 修改所属卷</div>
      <div class="cl-ctx-item" role="menuitem" tabindex="0" @click="ctxLinkOutline" @keydown.enter.prevent="ctxLinkOutline"><WsIcon name="link" size="xs" /> 关联大纲节点</div>
      <div class="cl-ctx-divider"></div>
      <div class="cl-ctx-item cl-ctx-danger" role="menuitem" tabindex="0" @click="ctxDelete" @keydown.enter.prevent="ctxDelete"><WsIcon name="delete" size="xs" /> 删除</div>
    </div>

    <div v-if="showVolumeInput" class="cl-modal-overlay" @click.self="showVolumeInput = false">
      <div class="cl-modal-sm">
        <h4>修改所属卷</h4>
        <input v-model="volumeInputVal" class="cl-input" placeholder="卷名（留空=未分组）" @keyup.enter="confirmVolume" />
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showVolumeInput = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmVolume">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showOutlinePicker" class="cl-modal-overlay" @click.self="showOutlinePicker = false">
      <div class="cl-modal-sm">
        <h4>关联大纲节点</h4>
        <div class="cl-outline-list">
          <div
            v-for="node in outlineNodes"
            :key="node.id"
            class="cl-outline-item"
            :class="{ active: outlinePickId === node.id }"
            @click="outlinePickId = node.id"
          >
            {{ node.name }}
          </div>
          <div class="cl-outline-item" :class="{ active: outlinePickId === '' }" @click="outlinePickId = ''">
            （无关联）
          </div>
        </div>
        <div class="cl-modal-actions">
          <button class="btn-secondary btn-sm" @click="showOutlinePicker = false">取消</button>
          <button class="btn-primary btn-sm" @click="confirmOutline">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, nextTick, onBeforeUnmount } from 'vue'
import draggable from 'vuedraggable'
import { WsIcon } from '@worldsea/ui-kit'
import { WsEmpty } from '@worldsea/ui-kit'
import { useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{
  chapters: Entity[]
  currentId: string
}>()

const emit = defineEmits<{
  select: [entity: Entity]
  reorder: []
  delete: [entity: Entity]
}>()

const es = useEntityStore()

const collapsedGroups = reactive(new Set<string>())

function toggleGroup(name: string) {
  if (collapsedGroups.has(name)) {
    collapsedGroups.delete(name)
  } else {
    collapsedGroups.add(name)
  }
}

interface ChapterGroup {
  name: string
  items: Entity[]
}

const groupedChapters = computed<ChapterGroup[]>(() => {
  const map = new Map<string, Entity[]>()
  for (const ch of props.chapters) {
    const vol = (ch.properties.volumeName as string) || ''
    const key = vol || '未分组'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(ch)
  }
  const result: ChapterGroup[] = []
  for (const [name, items] of map) {
    result.push({ name, items })
  }
  return result
})

const outlineNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

function statusClass(m: Entity): string {
  const s = (m.properties.status as string) || '草稿'
  if (s === '草稿') return 'st-draft'
  if (s === '修订中') return 'st-revising'
  if (s === '终稿') return 'st-final'
  return 'st-draft'
}

async function onDragEnd() {
  let order = 0
  for (const group of groupedChapters.value) {
    for (const item of group.items) {
      const currentSort = item.properties.sortOrder as number
      if (currentSort !== order) {
        await es.update(item.id, {
          properties: { ...item.properties, sortOrder: order },
        })
      }
      order++
    }
  }
  emit('reorder')
}

const ctxMenu = reactive({ show: false, x: 0, y: 0, entity: null as Entity | null })
const showVolumeInput = ref(false)
const volumeInputVal = ref('')
const showOutlinePicker = ref(false)
const outlinePickId = ref('')

const ctxMenuRef = ref<HTMLDivElement | null>(null)
let ctxMenuReturnFocusEl: HTMLElement | null = null

/** 菜单键盘导航：Esc 关闭 + 焦点归还（WAI-ARIA Menu 模式） */
function onCtxMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCtx()
  }
}

// 打开：记录触发元素并移焦首项；关闭：仅当焦点仍在菜单内时归还焦点
watch(() => ctxMenu.show, (show) => {
  if (show) {
    ctxMenuReturnFocusEl = document.activeElement as HTMLElement | null
    nextTick(() => {
      ctxMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
  } else if (ctxMenuReturnFocusEl) {
    const inside = ctxMenuRef.value?.contains(document.activeElement as Node)
    if (inside && ctxMenuReturnFocusEl.isConnected) ctxMenuReturnFocusEl.focus()
    ctxMenuReturnFocusEl = null
  }
})

function onContext(e: MouseEvent, entity: Entity) {
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.entity = entity
  ctxMenu.show = true
  document.addEventListener('click', closeCtx, { once: true })
}

function closeCtx() {
  ctxMenu.show = false
}

function ctxRename() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  const newName = prompt('重命名章节', ctxMenu.entity.name)
  if (newName && newName.trim()) {
    es.update(ctxMenu.entity.id, { name: newName.trim() })
  }
}

async function ctxCycleStatus() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  const statuses = ['草稿', '修订中', '终稿']
  const current = (ctxMenu.entity.properties.status as string) || '草稿'
  const idx = statuses.indexOf(current)
  const next = statuses[(idx + 1) % statuses.length]
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, status: next },
  })
}

function ctxSetVolume() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  volumeInputVal.value = (ctxMenu.entity.properties.volumeName as string) || ''
  showVolumeInput.value = true
}

async function confirmVolume() {
  showVolumeInput.value = false
  if (!ctxMenu.entity) return
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, volumeName: volumeInputVal.value },
  })
}

function ctxLinkOutline() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  outlinePickId.value = (ctxMenu.entity.properties.outlineNodeId as string) || ''
  showOutlinePicker.value = true
}

async function confirmOutline() {
  showOutlinePicker.value = false
  if (!ctxMenu.entity) return
  await es.update(ctxMenu.entity.id, {
    properties: { ...ctxMenu.entity.properties, outlineNodeId: outlinePickId.value },
  })
}

function ctxDelete() {
  ctxMenu.show = false
  if (!ctxMenu.entity) return
  emit('delete', ctxMenu.entity)
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtx)
})
</script>

<style scoped>
.chapter-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-family: var(--font-family-editor-ui);
}
.cl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.cl-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); }
.cl-count { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg-tertiary); padding: 1px 6px; border-radius: var(--radius-mid); }

.cl-group { display: flex; flex-direction: column; }
.cl-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--menubar-bg);
  border-bottom: 1px solid var(--border-light);
  user-select: none;
}
.cl-group-header:hover { background: var(--hover-bg); }
.cl-collapse { font-size: var(--font-size-xs); width: 14px; text-align: center; }
.cl-group-name { flex: 1; font-weight: var(--font-weight-medium); }
.cl-group-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cl-item {
  padding: 8px 12px 8px 20px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.1s;
}
.cl-item:hover { background: var(--hover-bg); }
.cl-item.active { background: var(--primary-light); }
.cl-item-name { display: block; font-weight: var(--font-weight-medium); font-size: var(--font-size-sm); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-item-meta { display: flex; align-items: center; gap: 6px; }
.cl-status { font-size: var(--font-size-xs); padding: 1px 5px; border-radius: var(--radius-2xs); }
.st-draft { background: var(--warning-soft, #fef3c7); color: var(--warning, #92400e); }
.st-revising { background: var(--info-soft, #dbeafe); color: var(--info, #1e40af); }
.st-final { background: var(--success-soft, #d1fae5); color: var(--success, #065f46); }
.cl-words { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cl-ghost { opacity: 0.4; background: var(--primary-light); }
.cl-drag { opacity: 0.9; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }

.cl-ctx-menu {
  position: fixed; z-index: var(--z-sticky); background: var(--modal-bg);
  border: 1px solid var(--border-color); border-radius: var(--radius-mid);
  padding: 4px 0; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.cl-ctx-item { padding: 7px 14px; font-size: var(--font-size-sm); cursor: pointer; color: var(--text-color); display: flex; align-items: center; gap: 6px; }
.cl-ctx-item:hover { background: var(--hover-bg); }
.cl-ctx-divider { height: 1px; background: var(--border-light); margin: 4px 0; }
.cl-ctx-danger { color: var(--danger); }
.cl-ctx-danger:hover { background: var(--danger-soft, rgba(220, 53, 69, 0.08)); }

.cl-modal-overlay { position: fixed; inset: 0; background: var(--color-overlay); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.cl-modal-sm { background: var(--modal-bg); border-radius: var(--radius-2xl); padding: 16px; max-width: 300px; width: 90%; }
.cl-modal-sm h4 { margin: 0 0 10px; font-size: var(--font-size-base); }
.cl-input { width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color); box-sizing: border-box; }
.cl-modal-actions { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }
.cl-outline-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.cl-outline-item { padding: 6px 10px; font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-xs); }
.cl-outline-item:hover { background: var(--hover-bg); }
.cl-outline-item.active { background: var(--active-bg); color: var(--primary); }
</style>
