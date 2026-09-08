<template>
  <div class="builder-view">
    <div v-if="!viewingModuleId" class="builder-list">
      <!-- 新建模块按钮上移 R3 视图工具条（图标/标题 R3 面包屑已提供） -->
      <Teleport to="#view-toolbar-create">
        <CreateButton label="新建模块" @click="createNewModule" />
      </Teleport>
      <div class="bl-head">
        <button class="bl-guide-btn" @click="showGuide = true"><WsIcon name="question" size="xs" /> 使用指南</button>
      </div>
      <div class="bl-grid" :class="{ 'is-empty': customModuleStore.modules.length === 0 }">
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
    <!-- 编辑器（以工具条+视图为画布） -->
    <PageEditor v-else :module-id="viewingModuleId" @back="viewingModuleId = null" @publish="onPublish" />
    <ModuleDeleteModal :show="showDeleteConfirm" :module-name="moduleToDelete?.name ?? ''" @close="showDeleteConfirm = false" @confirm="executeDelete" />
    <ModulePublishModal :show="showPublishModal" :module-name="moduleToPublish?.name ?? ''" @close="closePublishModal" @confirm="confirmPublish" />
    <ModuleGuideModal :show="showGuide" @close="showGuide = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { CreateButton } from '@worldsea/plugin-sdk'
import { useCustomModuleStore } from '@worldsea/entity-core'
import { registerModule, unregisterModule, getCustomModuleViews } from '../../../core/ModuleRuntime'
import { setModuleViewData, clearModuleViewData } from '../../../core/ModuleViewRegistry'
import { pluginAPI, usePluginStore } from '@worldsea/entity-core'
import { createEmptyLayoutSchema } from './types/layoutSchema'
import ModuleRuntimeRenderer from './runtime/ModuleRuntimeRenderer.vue'
import ModuleCard from './components/ModuleCard.vue'
import ModuleDeleteModal from './components/ModuleDeleteModal.vue'
import ModulePublishModal from './components/ModulePublishModal.vue'
import ModuleGuideModal from './components/ModuleGuideModal.vue'
import PageEditor from './PageEditor.vue'
import type { CustomModule, PluginView } from '@worldsea/entity-core'

const customModuleStore = useCustomModuleStore()
const pluginStore = usePluginStore()

const viewingModuleId = ref<string | null>(null)
const showDeleteConfirm = ref(false)
const moduleToDelete = ref<CustomModule | null>(null)
const showPublishModal = ref(false)
const moduleToPublish = ref<CustomModule | null>(null)
const showGuide = ref(false)

const CUSTOM_VIEW_PLUGIN_ID = 'official.module-builder'

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
    layoutSchema: createEmptyLayoutSchema() as any,
  }
  customModuleStore.addModule(mod)
  viewingModuleId.value = id
}

function startEdit(id: string) {
  viewingModuleId.value = id
}

/**
 * 清理某模块已发布到 pluginAPI / pluginStore / 视图数据注册表的视图。
 * 供删除与重新发布前调用，避免旧视图残留（发布路径去重）。
 */
function unpublishModuleViews(modId: string) {
  const prefix = `custom.${modId}.`
  for (const v of pluginAPI.getViews()) {
    if (v.id.startsWith(prefix)) pluginAPI.unregisterView(v.id)
  }
  const keep = pluginStore.views.filter(v => !v.id.startsWith(prefix))
  pluginStore.views.splice(0, pluginStore.views.length, ...keep)
  clearModuleViewData(modId)
}

/**
 * 完全注销模块：反注册实体/关系 schema + 清理已发布视图。
 * 修复「删除模块后实体类型/视图泄漏」。
 */
function unpublishModule(modId: string) {
  unregisterModule(modId)
  unpublishModuleViews(modId)
}

function onPublish(id: string) {
  const mod = customModuleStore.getModule(id)
  if (!mod) return
  moduleToPublish.value = mod
  showPublishModal.value = true
}

function closePublishModal() {
  showPublishModal.value = false
  moduleToPublish.value = null
}

function confirmPublish() {
  const mod = moduleToPublish.value
  if (!mod) return

  if (mod.entityTypes.length === 0) {
    showPublishModal.value = false
    moduleToPublish.value = null
    return
  }

  // 注册 schema（内部先反注册旧 schema，避免重复）
  registerModule(mod)
  // 清理旧视图 + 视图数据（去重，避免重发布残留）
  unpublishModuleViews(mod.id)

  // 收敛为单一运行时视图语义，注册到 pluginAPI 与 pluginStore（侧边栏）
  const views = getCustomModuleViews(mod)
  for (const v of views) {
    setModuleViewData(v.id, { module: { ...mod } as any, viewConfig: null as any })
    const view: PluginView = {
      id: v.id,
      label: v.label,
      icon: v.icon,
      component: ModuleRuntimeRenderer,
      pluginId: CUSTOM_VIEW_PLUGIN_ID,
    }
    pluginAPI.registerView(view)
    // registerView 会把 pluginId 覆写为 currentPluginId（运行时最后一次激活的插件），
    // 这里再显式归一到父插件，保证侧边栏按插件启停过滤时不会意外隐藏
    view.pluginId = CUSTOM_VIEW_PLUGIN_ID
    pluginStore.registerView(view)
  }

  mod.updatedAt = new Date().toISOString()
  customModuleStore.updateModule(mod.id, mod)

  showPublishModal.value = false
  moduleToPublish.value = null
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
    unpublishModule(moduleToDelete.value.id)
    customModuleStore.removeModule(moduleToDelete.value.id)
    moduleToDelete.value = null
    showDeleteConfirm.value = false
  }
}
</script>

<style scoped>
.builder-view { display: flex; flex-direction: column; height: 100%; }
/* list 撑满视图高度并作为 flex 列，使空状态可垂直居中到视图中间 */
.builder-list { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 20px; overflow-y: auto; }
/* 上移 R3：包裹新建按钮，避免撑满 .vt-controls（flex:1） */
.bl-actions { display: flex; align-items: center; gap: 8px; }
.bl-head { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.bl-guide-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.bl-guide-btn:hover { background: var(--hover-bg); color: var(--text-color); }
.bl-grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
/* 空状态：bl-grid 切换为 flex 并水平+垂直居中空提示 */
.bl-grid.is-empty { display: flex; align-items: center; justify-content: center; }
.bl-empty { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 60px 0; }
.ble-icon { font-size: var(--icon-2xl); display: block; margin-bottom: 12px; }
.bl-empty h3 { font-size: var(--font-size-lg); margin: 0 0 8px; }
.bl-empty p { font-size: var(--font-size-sm); color: var(--text-secondary); }
.editor-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }
.ep-icon { font-size: var(--icon-2xl); color: var(--text-tertiary); }
.editor-placeholder h3 { font-size: var(--font-size-lg); margin: 0; }
.editor-placeholder p { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0 0 8px; }
.btn-ghost { padding: 6px 12px; background: transparent; border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); }
.btn-ghost:hover { background: var(--hover-bg); }
</style>
