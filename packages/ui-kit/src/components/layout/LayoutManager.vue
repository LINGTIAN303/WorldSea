<template>
  <div class="lm-overlay" v-if="show" @click.self="close">
    <div class="lm-modal" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="lm-header">
        <h3><WsIcon name="settings" size="sm" /> 布局管理</h3>
        <button class="lm-close" @click="close"><WsIcon name="close" size="xs" /></button>
      </div>
      <div class="lm-body">
        <div v-for="et in entityTypes" :key="et.type" class="lm-type-section">
          <div class="lm-type-header">
            <WsIcon class="lm-type-icon" :name="et.icon" size="sm" />
            <span class="lm-type-label">{{ et.label }}</span>
            <span class="lm-type-key">{{ et.type }}</span>
          </div>
          <div class="lm-presets">
            <div v-for="preset in et.presets" :key="preset.name" class="lm-preset-item">
              <span class="lm-preset-name" :class="{ active: preset.isActive }">{{ preset.name }}</span>
              <span class="lm-preset-count">{{ preset.fieldCount }} 字段</span>
              <button v-if="preset.name !== '默认'" class="lm-preset-apply" @click="applyPreset(et.type, preset.name)" title="应用"><WsIcon name="chevron-right" size="xs" /></button>
              <button v-if="preset.name !== '默认'" class="lm-preset-del" @click="deletePreset(et.type, preset.name)" title="删除"><WsIcon name="close" size="xs" /></button>
            </div>
            <div v-if="et.presets.length === 0" class="lm-empty">无预设</div>
          </div>
          <div class="lm-type-actions">
            <button class="lm-action-btn" @click="resetType(et.type)"><WsIcon name="delete" size="xs" /> 重置</button>
          </div>
        </div>
        <WsEmpty v-if="entityTypes.length === 0" preset="no-data" title="暂无已注册的实体类型" />
      </div>
      <div class="lm-footer">
        <button class="lm-btn lm-btn-danger" @click="resetAll"><WsIcon name="delete" size="xs" /> 重置所有</button>
        <button class="lm-btn lm-btn-secondary" @click="close">关闭</button>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fieldRegistry, entitySchemaRegistry } from '@worldsmith/entity-core'
import { useFieldOrderStore } from '@worldsmith/entity-core'
import { useConfirm, useResizable } from '@worldsmith/ui-kit'
import { toastSuccess } from '../../composables/useToast'
import WsIcon from '../WsIcon.vue'
import WsEmpty from '../WsEmpty.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const fieldOrderStore = useFieldOrderStore()
const { confirm } = useConfirm()
const modalResizable = useResizable({ panelId: 'modal-layout-manager', defaultWidth: 520, minWidth: 320 })

const entityTypes = computed(() => {
  void fieldRegistry.version.value
  const types = fieldRegistry.getEntityTypes()
  return types.map(type => {
    const presets = fieldOrderStore.getPresetNames(type)
    const activePreset = fieldOrderStore.getActivePreset(type)
    return {
      type,
      icon: entitySchemaRegistry.getIconName(type),
      label: entitySchemaRegistry.getLabel(type),
      presets: presets.map(name => {
        const order = fieldOrderStore.getPresetOrder(type, name)
        return {
          name,
          fieldCount: order?.length ?? fieldRegistry.getFields(type).length,
          isActive: name === activePreset,
        }
      }),
    }
  })
})

async function applyPreset(entityType: string, presetName: string) {
  const order = fieldOrderStore.getPresetOrder(entityType, presetName)
  if (order) {
    fieldRegistry.setOrder(entityType, order)
    fieldOrderStore.loadPreset(entityType, presetName)
    toastSuccess(`已应用预设「${presetName}」`)
  }
}

async function deletePreset(entityType: string, presetName: string) {
  const ok = await confirm({ type: 'danger', title: '删除预设', description: `确定删除预设「${presetName}」吗？` })
  if (!ok) return
  fieldOrderStore.deletePreset(entityType, presetName)
  toastSuccess(`已删除预设「${presetName}」`)
}

async function resetType(entityType: string) {
  const ok = await confirm({ type: 'warning', title: '重置字段布局', description: '确定重置此类型的字段布局吗？' })
  if (!ok) return
  fieldOrderStore.resetToDefault(entityType)
  fieldRegistry.resetToBuiltin(entityType)
  toastSuccess('已重置')
}

async function resetAll() {
  const ok = await confirm({ type: 'warning', title: '重置所有字段布局预设', description: '确定重置所有字段布局预设吗？这将恢复插件原始字段顺序。' })
  if (!ok) return
  fieldOrderStore.resetAll()
  fieldRegistry.resetToBuiltin()
  toastSuccess('已重置所有布局预设')
}

function close() {
  emit('close')
}
</script>

<style scoped>
.lm-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: var(--color-overlay); display: flex; align-items: center; justify-content: center; }
.lm-modal { position: relative; max-height: 80vh; background: var(--content-bg, var(--color-bg-surface)); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.lm-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border, var(--color-border)); }
.lm-header h3 { margin: 0; font-size: var(--font-size-lg); }
.lm-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.lm-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.lm-type-section { margin-bottom: 16px; border: 1px solid var(--border, var(--color-border)); border-radius: 8px; overflow: hidden; }
.lm-type-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--bg-tertiary, var(--color-bg-elevated)); }
.lm-type-icon { font-size: var(--font-size-lg); }
.lm-type-label { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.lm-type-key { font-size: var(--font-size-xs); color: var(--text-tertiary); font-family: monospace; margin-left: auto; }
.lm-presets { padding: 8px 14px; }
.lm-preset-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: var(--font-size-sm); }
.lm-preset-name { color: var(--text-color); }
.lm-preset-name.active { color: var(--accent); font-weight: var(--font-weight-semibold); }
.lm-preset-count { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: auto; }
.lm-preset-apply { background: none; border: none; cursor: pointer; font-size: var(--font-size-sm); color: var(--accent); padding: 2px 6px; border-radius: 3px; transition: background 0.12s; }
.lm-preset-apply:hover { background: var(--accent-bg, color-mix(in srgb, var(--color-primary) 12%, transparent)); }
.lm-preset-del { background: none; border: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--danger, var(--color-danger)); padding: 2px 6px; border-radius: 3px; opacity: 0.5; transition: opacity 0.12s; }
.lm-preset-del:hover { opacity: 1; }
.lm-type-actions { padding: 6px 14px 10px; display: flex; gap: 6px; }
.lm-action-btn { font-size: var(--font-size-xs); padding: 3px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: 4px; background: var(--bg, var(--color-bg-elevated)); cursor: pointer; color: var(--text-secondary); transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.lm-action-btn:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.lm-empty { font-size: var(--font-size-sm); color: var(--text-tertiary); padding: 4px 0; }
.lm-footer { display: flex; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border, var(--color-border)); }
.lm-btn { padding: 7px 16px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); border: 1px solid var(--border); }
.lm-btn-danger { color: var(--danger, var(--color-danger)); border-color: var(--danger, var(--color-danger)); background: transparent; }
.lm-btn-danger:hover { background: var(--danger, var(--color-danger)); color: var(--color-text-inverse); }
.lm-btn-secondary { background: var(--bg-tertiary); color: var(--text-secondary); }
.lm-btn-secondary:hover { background: var(--hover-bg); }
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
