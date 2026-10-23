<template>
  <div class="tm-overlay" v-if="show" @click.self="close">
    <div class="tm-modal" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="tm-header">
        <h3><WsIcon name="outline" size="sm" /> 模板管理</h3>
        <button class="tm-close" @click="close">✕</button>
      </div>

      <div class="tm-tabs">
        <button :class="{ active: tab === 'browse' }" @click="tab = 'browse'">浏览模板</button>
        <button :class="{ active: tab === 'create' }" @click="tab = 'create'">从实体创建</button>
      </div>

      <div v-if="tab === 'browse'" class="tm-body">
        <select v-model="typeFilter" class="tm-select">
          <option value="">全部类型</option>
          <option v-for="t in allTypes" :key="t.typeKey" :value="t.typeKey"><WsIcon :name="entitySchemaRegistry.getIconName(t.typeKey)" size="xs" /> {{ t.label }}</option>
        </select>

        <div class="tm-list" v-if="filtered.length">
          <div v-for="tmpl in filtered" :key="tmpl.id" class="tm-card">
            <div class="tm-card-h">
              <strong>{{ tmpl.name }}</strong>
              <span class="tm-type-badge"><WsIcon :name="typeIcon(tmpl.entityType)" size="xs" /> {{ typeLabel(tmpl.entityType) }}</span>
            </div>
            <p class="tm-card-desc">{{ tmpl.description }}</p>
            <div class="tm-card-actions">
              <button class="tm-btn sm" @click="applyTemplate(tmpl)"><WsIcon name="item" size="xs" /> 应用</button>
              <button class="tm-btn sm danger" @click="deleteTemplate(tmpl.id)"><WsIcon name="delete" size="xs" /></button>
            </div>
          </div>
        </div>
        <div v-else class="tm-empty">无匹配模板</div>
      </div>

      <div v-if="tab === 'create'" class="tm-body">
        <p class="tm-hint">选择一个实体，将其结构保存为模板</p>
        <select v-model="createTypeFilter" class="tm-select">
          <option value="">选择类型</option>
          <option v-for="t in allTypes" :key="t.typeKey" :value="t.typeKey"><WsIcon :name="entitySchemaRegistry.getIconName(t.typeKey)" size="xs" /> {{ t.label }}</option>
        </select>
        <div class="tm-entity-list" v-if="createTypeFilter">
          <button v-for="e in typeEntities" :key="e.id" class="tm-entity-btn" @click="saveAsTemplate(e)">
            {{ e.name }}
          </button>
        </div>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore, useTemplateStore, entitySchemaRegistry } from '@worldsea/entity-core'
import { useDialog, useConfirm, useResizable } from '@worldsea/ui-kit'
import WsIcon from '../WsIcon.vue'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const entityStore = useEntityStore()
const templateStore = useTemplateStore()
const { prompt } = useDialog()
const { confirm } = useConfirm()
const modalResizable = useResizable({ panelId: 'modal-template-manager', defaultWidth: 520, minWidth: 320 })
const allTypes = computed(() => entitySchemaRegistry.getAll())

const tab = ref<'browse' | 'create'>('browse')
const typeFilter = ref('')
const createTypeFilter = ref('')

const filtered = computed(() => {
  const items = templateStore.templates
  if (typeFilter.value) return items.filter(t => t.entityType === typeFilter.value)
  return items
})

const typeEntities = computed(() => {
  if (!createTypeFilter.value) return []
  return entityStore.entities.filter(e => e.type === createTypeFilter.value)
})

function typeLabel(type: string) {
  return entitySchemaRegistry.getLabel(type)
}

function typeIcon(type: string) { return entitySchemaRegistry.getIconName(type) }

async function applyTemplate(tmpl: any) {
  const name = await prompt('输入实体名称', '应用模板', tmpl.defaultName || '')
  if (!name) return
  const entity = {
    id: `${tmpl.entityType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: tmpl.entityType,
    name,
    description: tmpl.defaultDescription || '',
    properties: { ...tmpl.defaultProperties },
    tags: [...(tmpl.defaultTags || [])],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  entityStore.add(entity)
  close()
}

async function saveAsTemplate(e: any) {
  const name = await prompt('输入模板名称', '保存为模板', e.name + ' 模板')
  if (!name) return
  templateStore.saveFromEntity(e, name)
}

async function deleteTemplate(id: string) {
  if (await confirm({ type: 'danger', title: '删除模板', description: '确定删除此模板？' })) templateStore.remove(id)
}

function close() { tab.value = 'browse'; typeFilter.value = ''; createTypeFilter.value = ''; emit('close') }
</script>

<style scoped>
.tm-overlay { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-overlay); background: var(--overlay); display: flex; align-items: center; justify-content: center; }
.tm-modal { position: relative; max-height: 80vh; background: var(--content-bg); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.tm-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.tm-header h3 { margin: 0; font-size: var(--font-size-lg); }
.tm-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.tm-close:hover { background: var(--hover-bg); }
.tm-tabs { display: flex; border-bottom: 1px solid var(--border); }
.tm-tabs button { flex: 1; padding: 8px; border: none; background: var(--bg); cursor: pointer; font-size: var(--font-size-base); }
.tm-tabs button.active { background: var(--primary); color: var(--text); }
.tm-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.tm-select { width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 12px; }
.tm-hint { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: 12px; }
.tm-list { display: flex; flex-direction: column; gap: 8px; }
.tm-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.tm-card-h { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.tm-card-h strong { font-size: var(--font-size-base); }
.tm-type-badge { font-size: var(--font-size-xs); background: var(--accent-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
.tm-card-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 4px 0 8px; }
.tm-card-actions { display: flex; gap: 4px; }
.tm-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg, #f8f8f8); cursor: pointer; font-size: var(--font-size-sm); }
.tm-btn.sm { padding: 2px 8px; }
.tm-btn.danger { color: var(--color-danger); border-color: var(--color-danger); }
.tm-btn:hover { background: var(--bg-hover); }
.tm-empty { text-align: center; padding: 40px; color: var(--text-tertiary, var(--color-text-tertiary)); }
.tm-entity-list { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; }
.tm-entity-btn { padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); cursor: pointer; text-align: left; font-size: var(--font-size-sm); }
.tm-entity-btn:hover { background: var(--hover-bg); }
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