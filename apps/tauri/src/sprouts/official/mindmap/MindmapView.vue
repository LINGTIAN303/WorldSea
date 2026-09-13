<template>
  <div class="mindmap-view">
    <!-- 左侧：导图文档列表 -->
    <aside class="mmv-sidebar">
      <div class="mmv-side-head">
        <span class="mmv-side-title">思维导图</span>
        <button class="mmv-new-btn" title="新建导图" @click="onCreateDoc"><WsIcon name="plus" size="xs" /> 新建</button>
      </div>
      <ul class="mmv-doc-list">
        <li
          v-for="d in store.sortedDocs"
          :key="d.id"
          class="mmv-doc-item"
          :class="{ active: d.id === store.currentId }"
          @click="openDoc(d.id)"
        >
          <template v-if="renamingId === d.id">
            <input
              ref="renameInputRef"
              v-model="renameText"
              class="mmv-rename-input"
              maxlength="40"
              @click.stop
              @keyup.enter="commitRename(d.id)"
              @keyup.esc="renamingId = null"
              @blur="commitRename(d.id)"
            />
          </template>
          <template v-else>
            <span class="mmv-doc-name" :title="d.name">{{ d.name }}</span>
            <span class="mmv-doc-actions">
              <span role="button" class="mmv-doc-act" title="重命名" @click.stop="startRename(d)"><WsIcon name="edit" size="xs" /></span>
              <span role="button" class="mmv-doc-act danger" title="删除导图" @click.stop="onDeleteDoc(d)"><WsIcon name="delete" size="xs" /></span>
            </span>
          </template>
        </li>
      </ul>
      <div class="mmv-side-foot">{{ saveStateText }}</div>
    </aside>

    <!-- 主区：mind-elixir 画布 -->
    <div class="mmv-main">
      <div ref="mapEl" class="mmv-map"></div>
      <WsEmpty v-if="store.currentId === null" title="没有导图" description="点击左侧「新建」创建第一张导图">
        <template #icon><WsIcon name="mindmap" size="xl" /></template>
      </WsEmpty>

      <!-- 绑定面板：选中节点时浮现 -->
      <Transition name="ws-scale-fade">
        <div v-if="selectedObj" class="mmv-bind-panel">
          <div class="mmv-bind-head">
            <span class="mmv-bind-topic">{{ selectedObj.topic }}</span>
            <button class="mmv-bind-close" title="关闭" @click="clearSelection"><WsIcon name="x" size="xs" /></button>
          </div>
          <div class="mmv-bind-row">
            <span class="mmv-bind-label">绑定实体</span>
            <CustomDropdown
              :model-value="boundEntityId ?? ''"
              :options="entityOptions"
              placeholder="选择实体…"
              class="mmv-bind-dd"
              @update:model-value="onBindEntity"
            />
          </div>
          <div v-if="boundEntity" class="mmv-bind-row mmv-bind-linked">
            <WsIcon name="link" size="xs" />
            <span class="mmv-bind-entity">{{ boundEntity.name }}</span>
            <button class="mmv-bind-btn primary" @click="goToEntity(boundEntity)"><WsIcon name="arrow-right" size="xs" /> 前往</button>
            <button class="mmv-bind-btn" @click="onUnbind">解绑</button>
          </div>
          <p class="mmv-bind-hint">绑定后，构思成熟的想法可随时跳到对应芽落地为完整实体。</p>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import type { NodeObj, MindElixirData, MindElixirInstance } from 'mind-elixir'
import { WsIcon, WsEmpty, toastSuccess } from '@worldsea/ui-kit'
import { useEntityStore, useUIStore, type Entity } from '@worldsea/entity-core'
import { CustomDropdown, useConfirm } from '@worldsea/plugin-sdk'
import { useMindmapDocStore } from './mindmapStore'

/** 节点绑定实体的元数据载体（mind-elixir 官方通用 metadata 字段） */
interface NodeMeta { entityId?: string }

const BIND_TAG_PREFIX = '⧉'

const store = useMindmapDocStore()
const entityStore = useEntityStore()
const uiStore = useUIStore()
const { confirm } = useConfirm()

const mapEl = ref<HTMLElement | null>(null)
let mind: MindElixirInstance | null = null

/** 当前选中的节点对象（单选；多选场景取第一个） */
const selectedObj = ref<NodeObj | null>(null)

/** 重命名状态 */
const renamingId = ref<string | null>(null)
const renameText = ref('')
const renameInputRef = ref<HTMLInputElement[]>([])

const saveStateText = computed(() => {
  if (store.saveState === 'saving') return '保存中…'
  if (store.saveState === 'saved') return '已保存'
  return ''
})

/** 实体下拉选项：全部实体，label = 「名称（类型）」 */
const entityOptions = computed(() =>
  entityStore.entities.map(e => ({ value: e.id, label: `${e.name}（${e.type}）` })),
)

const boundEntityId = computed(() => (selectedObj.value?.metadata as NodeMeta | undefined)?.entityId ?? null)
const boundEntity = computed<Entity | null>(() =>
  boundEntityId.value ? entityStore.entities.find(e => e.id === boundEntityId.value) ?? null : null,
)

/* ── 画布实例管理 ── */

/** 打开指定文档：首张 init，切换 refresh（clearHistory 防止跨文档撤销）；重复点击当前文档不重建 */
function openDoc(id: string) {
  if (id === store.currentId && mind) return
  store.currentId = id
  const data = store.getDocData(id)
  if (!data || !mapEl.value) return
  if (!mind) {
    mind = new MindElixir({
      el: mapEl.value,
      direction: MindElixir.SIDE,
      locale: 'zh_CN',
      editable: true,
      contextMenu: true,
      toolBar: true,
      keypress: true,
      allowUndo: true,
      newTopicName: '新节点',
      // 主题令牌适配：CSS 变量在模板样式覆盖（跟随底色×强调色两轴），此处只选布局方向
    })
    registerBusHandlers(mind)
    mind.init(data)
  } else {
    mind.refresh(data)
    mind.clearHistory?.()
  }
  selectedObj.value = null
}

/** 注册画布事件：操作 → 防抖自动保存；选中 → 更新绑定面板 */
function registerBusHandlers(instance: MindElixirInstance) {
  instance.bus.addListener('operation', () => scheduleSave())
  instance.bus.addListener('selectNewNode', (obj: NodeObj) => { selectedObj.value = obj })
  instance.bus.addListener('selectNodes', (objs: NodeObj[]) => { selectedObj.value = objs[0] ?? null })
  instance.bus.addListener('unselectNodes', () => { selectedObj.value = null })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 防抖自动保存（operation 高频触发，800ms 静默后落盘） */
function scheduleSave() {
  const currentId = store.currentId
  if (!mind || !currentId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!mind) return
    store.persistDocData(currentId, mind.getData() as MindElixirData)
  }, 800)
}

function clearSelection() {
  try { mind?.clearSelection() } catch { /* ignore */ }
  selectedObj.value = null
}

/* ── 文档列表操作 ── */

function onCreateDoc() {
  const id = store.createDoc(`导图 ${store.docs.length + 1}`)
  openDoc(id)
  toastSuccess('已新建导图')
}

function startRename(d: { id: string; name: string }) {
  renamingId.value = d.id
  renameText.value = d.name
  nextTick(() => renameInputRef.value?.[0]?.focus())
}

function commitRename(id: string) {
  if (renamingId.value !== id) return
  store.renameDoc(id, renameText.value)
  renamingId.value = null
}

async function onDeleteDoc(d: { id: string; name: string }) {
  const ok = await confirm({
    type: 'danger',
    title: `删除导图「${d.name}」？`,
    description: '该导图的全部节点将被删除，此操作不可撤销。',
    confirmText: '删除',
  })
  if (!ok) return
  store.deleteDoc(d.id)
  const next = store.currentId
  if (next) openDoc(next)
  toastSuccess(`已删除「${d.name}」`)
}

/* ── 节点绑定实体 ── */

/** 绑定/换绑实体：写 metadata + tags 徽章，重渲染该节点并保存 */
function onBindEntity(entityId: string) {
  const obj = selectedObj.value
  if (!obj || !entityId || !mind) return
  const entity = entityStore.entities.find(e => e.id === entityId)
  if (!entity) return
  // 移除旧绑定徽章，写入新徽章与元数据
  const tags = (obj.tags ?? []).filter(t => typeof t === 'string' && !t.startsWith(BIND_TAG_PREFIX))
  tags.push(`${BIND_TAG_PREFIX} ${entity.name}`)
  obj.tags = tags
  obj.metadata = { ...(obj.metadata as NodeMeta | undefined), entityId }
  rerenderNode(obj)
  scheduleSave()
}

function onUnbind() {
  const obj = selectedObj.value
  if (!obj || !mind) return
  obj.tags = (obj.tags ?? []).filter(t => !(typeof t === 'string' && t.startsWith(BIND_TAG_PREFIX)))
  obj.metadata = { ...(obj.metadata as NodeMeta | undefined), entityId: undefined }
  rerenderNode(obj)
  scheduleSave()
}

/** 节点对象变更后重渲染（reshapeNode 接受 Partial patch） */
function rerenderNode(obj: NodeObj) {
  try {
    const el = mind!.findEle(obj.id)
    if (el) mind!.reshapeNode(el, { tags: obj.tags, metadata: obj.metadata })
  } catch {
    /* 节点可能已被删除 */
  }
}

/** 跳转到绑定实体的对应芽视图 */
function goToEntity(entity: Entity) {
  const viewMap: Record<string, string> = {
    character: 'characters', region: 'regions', event: 'timeline',
    organization: 'organizations', concept: 'concepts', item: 'items',
  }
  const viewId = viewMap[entity.type]
  if (!viewId) {
    toastSuccess(`实体「${entity.name}」暂无专属视图`)
    return
  }
  uiStore.setView(viewId)
}

/* ── 生命周期 ── */

onMounted(async () => {
  await entityStore.loadAll()
  await store.loadAll()
  if (store.currentId) openDoc(store.currentId)
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  // 卸载前把未落盘的变更立即保存
  const currentId = store.currentId
  if (mind && currentId) {
    store.persistDocData(currentId, mind.getData() as MindElixirData)
  }
  try { mind?.destroy() } catch { /* ignore */ }
  mind = null
})

// 暴露给调试/未来 Agent 桥接（非模板必需）
defineExpose({ getMindmapInstance: () => mind })
</script>

<style scoped>
.mindmap-view { display: flex; height: 100%; overflow: hidden; }

/* 左侧文档列表 */
.mmv-sidebar {
  width: 220px; flex-shrink: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--border, var(--border-color));
  background: var(--bg-surface, var(--card-bg));
}
.mmv-side-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 12px 8px;
}
.mmv-side-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); color: var(--text-primary, var(--text-color)); }
.mmv-new-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px; font-size: var(--font-size-xs);
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-xs, 4px);
  background: transparent; color: var(--text-secondary); cursor: pointer;
  transition: background var(--duration-fast, 0.1s), border-color var(--duration-fast, 0.1s), color var(--duration-fast, 0.1s);
}
.mmv-new-btn:hover { border-color: var(--accent, var(--primary)); color: var(--accent, var(--primary)); }
.mmv-doc-list { list-style: none; margin: 0; padding: 0 6px; overflow-y: auto; flex: 1; }
.mmv-doc-item {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; margin-bottom: 2px; border-radius: var(--radius-xs, 4px);
  font-size: var(--font-size-xs); color: var(--text-secondary);
  cursor: pointer; transition: background var(--duration-fast, 0.1s), color var(--duration-fast, 0.1s);
}
.mmv-doc-item:hover { background: var(--bg-muted, var(--hover-bg)); }
.mmv-doc-item.active {
  background: var(--accent-soft, var(--primary-light));
  color: var(--accent, var(--primary)); font-weight: var(--font-weight-semibold);
}
.mmv-doc-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mmv-doc-actions { display: none; gap: 4px; }
.mmv-doc-item:hover .mmv-doc-actions { display: inline-flex; }
.mmv-doc-act { display: inline-flex; opacity: 0.6; cursor: pointer; }
.mmv-doc-act:hover { opacity: 1; }
.mmv-doc-act.danger:hover { color: var(--danger); }
.mmv-rename-input {
  width: 100%; padding: 2px 6px; font-size: var(--font-size-xs);
  border: 1px solid var(--accent, var(--primary)); border-radius: var(--radius-2xs, 3px);
  background: var(--bg-surface, var(--card-bg)); color: var(--text-primary, var(--text-color)); outline: none;
}
.mmv-side-foot {
  padding: 8px 12px; font-size: var(--text-micro-font-size, 10px);
  color: var(--text-muted, var(--text-tertiary));
  border-top: 1px solid var(--border, var(--border-color));
  min-height: 28px;
}

/* 主区画布 */
.mmv-main { flex: 1; position: relative; overflow: hidden; }
.mmv-map { width: 100%; height: 100%; }

/* mind-elixir 主题适配：映射到 WorldSea 设计令牌，自动跟随底色×强调色两轴 */
.mmv-map :deep(.map-container),
.mmv-map.map-container {
  --main-color: var(--text-primary, var(--text-color));
  --main-bgcolor: var(--bg-surface, var(--card-bg));
  --main-bgcolor-transparent: transparent;
  --main-border: 1px solid var(--border, var(--border-color));
  --color: var(--text-primary, var(--text-color));
  --bgcolor: var(--bg-surface, var(--card-bg));
  --selected: var(--accent-soft, var(--primary-light));
  --accent-color: var(--accent, var(--primary));
  --root-color: var(--on-accent, #fff);
  --root-bgcolor: var(--accent, var(--primary));
  --root-border-color: var(--accent, var(--primary));
  --panel-color: var(--text-secondary);
  --panel-bgcolor: var(--bg-surface, var(--card-bg));
  --panel-border-color: var(--border, var(--border-color));
  background: var(--bg-app, var(--bg));
}

/* 绑定面板（右下浮条） */
.mmv-bind-panel {
  position: absolute; right: 16px; bottom: 16px; width: 280px;
  background: var(--bg-surface, var(--card-bg));
  border: 1px solid var(--border, var(--border-color));
  border-radius: var(--radius-mid, 8px);
  box-shadow: var(--shadow-lg, var(--shadow-md));
  padding: 12px;
  z-index: var(--z-dropdown, 100);
}
.mmv-bind-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mmv-bind-topic {
  flex: 1; font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm);
  color: var(--text-primary, var(--text-color));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmv-bind-close {
  background: none; border: none; cursor: pointer; color: var(--text-muted, var(--text-tertiary));
  display: inline-flex; padding: 2px; border-radius: var(--radius-2xs, 3px);
}
.mmv-bind-close:hover { color: var(--text-primary, var(--text-color)); background: var(--bg-muted, var(--hover-bg)); }
.mmv-bind-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.mmv-bind-label { font-size: var(--font-size-xs); color: var(--text-muted, var(--text-tertiary)); flex-shrink: 0; }
.mmv-bind-dd { flex: 1; }
.mmv-bind-linked { flex-wrap: wrap; }
.mmv-bind-entity { font-size: var(--font-size-xs); color: var(--text-secondary); flex: 1; }
.mmv-bind-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; font-size: var(--font-size-xs);
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-2xs, 3px);
  background: transparent; color: var(--text-secondary); cursor: pointer;
}
.mmv-bind-btn:hover { border-color: var(--accent, var(--primary)); color: var(--accent, var(--primary)); }
.mmv-bind-btn.primary { background: var(--accent, var(--primary)); border-color: var(--accent, var(--primary)); color: var(--on-accent, #fff); }
.mmv-bind-btn.primary:hover { filter: brightness(1.08); color: var(--on-accent, #fff); }
.mmv-bind-hint { margin: 0; font-size: var(--text-micro-font-size, 10px); color: var(--text-muted, var(--text-tertiary)); line-height: 1.5; }
</style>
