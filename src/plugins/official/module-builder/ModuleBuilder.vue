<template>
  <div class="builder-view">
    <div v-if="!editingModuleId" class="builder-list">
      <div class="bl-header">
        <div class="bl-left">
          <span class="bl-icon"><WsIcon name="settings" size="md" /></span>
          <h2>自定义模块</h2>
        </div>
        <button class="btn-primary" @click="createNewModule">＋ 新建模块</button>
      </div>
      <div class="bl-grid">
        <ModuleCard
          v-for="mod in customModuleStore.modules"
          :key="mod.id"
          :module="mod"
          @edit="startEdit"
          @publish="onPublish"
          @delete="onDelete"
        />
        <div v-if="customModuleStore.modules.length === 0" class="bl-empty">
          <span class="ble-icon"><WsIcon name="settings" size="xl" /></span>
          <h3>还没有自定义模块</h3>
          <p>点击「新建模块」开始创建属于你自己的插件</p>
        </div>
      </div>
    </div>
    <ModuleBuilderEditor
      v-else
      :module-id="editingModuleId"
      @back="editingModuleId = null"
    />
    <ModuleDeleteModal :show="showDeleteConfirm" :module-name="moduleToDelete?.name ?? ''" @close="showDeleteConfirm = false" @confirm="executeDelete" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import WsIcon from '../../../ui/WsIcon.vue'
import { useCustomModuleStore } from '../../../stores/customModuleStore'
import { registerModule, generateViews } from '../../../core/ModuleRuntime'
import { setModuleViewData } from '../../../core/ModuleViewRegistry'
import { pluginAPI, usePluginStore } from '@worldsmith/entity-core'
import ModuleRuntimeRenderer from './runtime/ModuleRuntimeRenderer.vue'
import ModuleCard from './components/ModuleCard.vue'
import ModuleBuilderEditor from './ModuleBuilderEditor.vue'
import ModuleDeleteModal from './components/ModuleDeleteModal.vue'
import type { CustomModule } from '@worldsmith/entity-core'

const customModuleStore = useCustomModuleStore()
const pluginStore = usePluginStore()

const editingModuleId = ref<string | null>(null)
const showDeleteConfirm = ref(false)
const moduleToDelete = ref<CustomModule | null>(null)

function createNewModule() {
  const id = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`
  const mod: CustomModule = {
    id,
    name: '',
    icon: 'settings',
    description: '',
    entityTypes: [],
    relationTypes: [],
    views: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layoutSchema: { version: 1, layout: { id: 'root', direction: 'vertical', children: [] }, components: [] },
  }
  customModuleStore.addModule(mod)
  editingModuleId.value = id
}

function startEdit(id: string) {
  editingModuleId.value = id
}

function onPublish(id: string) {
  const mod = customModuleStore.getModule(id)
  if (!mod) return
  registerModule(mod)

  if (mod.layoutSchema && mod.layoutSchema.layout.children.length > 0) {
    const viewId = `custom.${mod.id}.main`
    const existingViewIdx = pluginStore.views.findIndex(pv => pv.id === viewId)
    if (existingViewIdx >= 0) pluginStore.views.splice(existingViewIdx, 1)
    setModuleViewData(viewId, { module: { ...mod } as any, viewConfig: null as any })
    pluginAPI.registerView({ id: viewId, label: mod.name || '自定义模块', icon: mod.icon || 'settings', component: ModuleRuntimeRenderer })
  } else {
    const views = generateViews(mod)
    for (const v of views) {
      const existingViewIdx = pluginStore.views.findIndex(pv => pv.id === v.id)
      if (existingViewIdx >= 0) pluginStore.views.splice(existingViewIdx, 1)
      setModuleViewData(v.id, { module: { ...mod } as any, viewConfig: v._viewConfig as any })
      pluginAPI.registerView({ id: v.id, label: v.label, icon: v.icon, component: ModuleRuntimeRenderer })
    }
  }

  mod.updatedAt = new Date().toISOString()
  customModuleStore.updateModule(id, mod)
  alert(`"${mod.name}" 已发布到侧边栏！`)
}

function onDelete(id: string) {
  const mod = customModuleStore.getModule(id)
  if (mod) {
    moduleToDelete.value = mod
    showDeleteConfirm.value = true
  }
}

function executeDelete() {
  if (moduleToDelete.value) {
    customModuleStore.removeModule(moduleToDelete.value.id)
    moduleToDelete.value = null
    showDeleteConfirm.value = false
  }
}
</script>

<style scoped>
.builder-view { display: flex; flex-direction: column; height: 100%; }
.builder-list { padding: 20px; overflow-y: auto; }
.bl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.bl-left { display: flex; align-items: center; gap: 8px; }
.bl-icon { font-size: var(--font-size-2xl); }
.bl-header h2 { font-size: var(--font-size-xl); margin: 0; }
.bl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.bl-empty { grid-column: 1 / -1; text-align: center; padding: 60px 0; }
.ble-icon { font-size: var(--icon-2xl); display: block; margin-bottom: 12px; }
.bl-empty h3 { font-size: var(--font-size-lg); margin: 0 0 8px; }
.bl-empty p { font-size: var(--font-size-sm); color: var(--text-secondary); }
.btn-primary { padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: var(--font-size-base); }
</style>
