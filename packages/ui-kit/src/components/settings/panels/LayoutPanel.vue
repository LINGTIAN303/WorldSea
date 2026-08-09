<template>
  <div class="set-card" v-show="match('思维导图 mindmap 中心 节点')">
    <div class="sc-head">思维导图</div>
    <div class="set-row"><span>中心节点上限</span><input type="number" class="set-input set-input-sm" :value="store.maxCenterNodes" min="1" max="20" @input="onMaxCenterNodesChange" /></div>
  </div>
  <div class="set-card" v-show="match('面板 panel 布局 宽度 侧边栏 位置 左右 sidebar 实体 详情 panel detail position')">
    <div class="sc-head">面板布局</div>
    <div class="set-row"><span>启用自定义视窗数量上限</span><label class="set-toggle"><input type="checkbox" :checked="store.panelLimitEnabled" @change="store.panelLimitEnabled = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
    <div class="set-row"><span>插件侧边栏位置</span>
      <div class="set-chip-group">
        <label class="set-chip" :class="{ on: store.sidebarPosition === 'left' }">
          <input type="radio" name="sidebarPos" value="left" v-model="store.sidebarPosition" /> 左侧
        </label>
        <label class="set-chip" :class="{ on: store.sidebarPosition === 'right' }">
          <input type="radio" name="sidebarPos" value="right" v-model="store.sidebarPosition" /> 右侧
        </label>
      </div>
    </div>
    <div class="set-row"><span>实体详情面板位置</span>
      <div class="set-chip-group">
        <label class="set-chip" :class="{ on: store.detailPanelPosition === 'left' }">
          <input type="radio" name="detailPos" value="left" v-model="store.detailPanelPosition" /> 左侧
        </label>
        <label class="set-chip" :class="{ on: store.detailPanelPosition === 'right' }">
          <input type="radio" name="detailPos" value="right" v-model="store.detailPanelPosition" /> 右侧
        </label>
      </div>
    </div>
    <div v-if="panelWidths.length > 0" class="set-panel-widths">
      <div v-for="pw in panelWidths" :key="pw.panelId" class="spw-row"><span class="spw-label">{{ panelLabel(pw.panelId) }}</span><span class="spw-value">{{ pw.width }}px</span><button class="spw-reset" @click="onResetPanelWidth(pw.panelId)">↺</button></div>
      <button class="set-btn" @click="resetAllWidths">重置所有面板宽度</button>
    </div>
  </div>
  <div class="set-card" v-show="match('字段 field 预设 布局 重置')">
    <div class="sc-head">字段布局预设</div>
    <div class="set-hint">重置后恢复插件原始字段顺序，删除所有自定义字段和用户预设</div>
    <div class="set-btn-row">
      <button class="set-btn" @click="resetFieldPresets">重置所有字段预设</button>
      <button class="set-btn set-btn-danger" @click="resetCustomFields">清除所有自定义字段</button>
    </div>
  </div>
  <div class="set-card" v-show="match('时间线 timeline 拖拽 泳道 甘特图 紧凑 分组')">
    <div class="sc-head">时间线</div>
    <div class="set-row"><span>拖拽改时间</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineDragEnabled" /><span class="set-toggle-slider"></span></label></div>
    <div class="set-hint">启用后可在水平模式中拖拽事件条形修改日期</div>
    <div class="set-row"><span>默认布局模式</span><select v-model="store.timelineDefaultMode" class="set-select"><option value="vertical">垂直时间线</option><option value="horizontal">水平甘特图</option></select></div>
    <div class="set-row"><span>默认泳道分组</span><select v-model="store.timelineDefaultGroup" class="set-select"><option value="none">无分组</option><option value="character">按角色</option><option value="location">按地点</option><option value="era">按纪元</option><option value="tag">按标签</option></select></div>
    <div class="set-row"><span>紧凑模式</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineCompactMode" /><span class="set-toggle-slider"></span></label></div>
    <div class="set-hint">垂直模式下使用紧凑卡片布局</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore, useFieldOrderStore, fieldRegistry } from '@worldsmith/entity-core'
import { useConfirm, getAllPanelWidths, resetPanelWidth, resetAllPanelWidths, PANEL_LABELS, toastSuccess } from '@worldsmith/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: [] }>()

const store = useSettingsStore()
const { confirm } = useConfirm()
const fieldOrderStore = useFieldOrderStore()

const panelWidths = ref<{ panelId: string; width: number }[]>([])

function refreshPanelWidths() {
  panelWidths.value = getAllPanelWidths()
}

onMounted(() => {
  refreshPanelWidths()
})

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function panelLabel(panelId: string): string {
  return PANEL_LABELS[panelId] || panelId
}

function onResetPanelWidth(id: string) {
  resetPanelWidth(id)
  refreshPanelWidths()
  toastSuccess('已恢复默认宽度')
}

function resetAllWidths() {
  resetAllPanelWidths()
  refreshPanelWidths()
  toastSuccess('已重置所有面板宽度')
}

function onMaxCenterNodesChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (val >= 1 && val <= 20) {
    store.maxCenterNodes = val
    emit('dirty')
  }
}

async function resetFieldPresets() {
  const ok = await confirm({ type: 'danger', title: '重置字段布局预设', description: '确定要重置所有字段布局预设吗？这将恢复插件原始字段顺序，删除所有用户预设。' })
  if (!ok) return
  fieldOrderStore.resetAll()
  fieldRegistry.resetToBuiltin()
  toastSuccess('已重置所有字段预设')
}

async function resetCustomFields() {
  const ok = await confirm({ type: 'danger', title: '清除自定义字段', description: '确定要清除所有自定义字段吗？此操作不可撤销！' })
  if (!ok) return
  fieldRegistry.resetToBuiltin()
  toastSuccess('已清除所有自定义字段')
}
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin: -2px 0 4px; }

.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-input-sm { width: 72px; text-align: center; }
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }

.set-chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
.set-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-lg); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; background: var(--bg, var(--color-bg-surface)); }
.set-chip input { display: none; }
.set-chip.on { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); }
.set-chip:hover { border-color: var(--primary, var(--color-primary)); }

.set-panel-widths { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-light, var(--color-border)); }
.spw-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: var(--font-size-sm); }
.spw-label { flex: 1; color: var(--text-color); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spw-value { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); font-family: monospace; flex-shrink: 0; }
.spw-reset { width: 20px; height: 20px; border: none; background: transparent; color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; font-size: var(--font-size-xs); border-radius: 3px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, color 0.15s; }
.spw-reset:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--primary); }

.set-btn-row { display: flex; gap: 8px; margin-top: 6px; }
.set-btn { font-size: var(--font-size-sm); padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border, var(--color-border)); background: var(--bg, var(--color-bg-surface)); cursor: pointer; color: var(--text-color); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.set-btn:hover { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.set-btn-danger { color: var(--danger, var(--color-danger)); border-color: var(--danger, var(--color-danger)); }
.set-btn-danger:hover { background: var(--danger, var(--color-danger)); color: #fff; }
</style>
