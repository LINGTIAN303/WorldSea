<template>
  <div v-if="ctxMenu.show" class="mm-ctx-menu" :style="menuStyle">
    <!-- 节点操作 -->
    <button v-if="ctxMenu.nodeId" class="mm-ctx-item" @click="$emit('edit-name')"><WsIcon name="edit" size="xs" /> 编辑名称</button>
    <button v-if="ctxMenu.nodeId && !ctxNodeIsCustom" class="mm-ctx-item" @click="$emit('edit-description')"><WsIcon name="edit" size="xs" /> 编辑描述</button>
    <button v-if="ctxMenu.nodeId && !ctxNodeIsCustom" class="mm-ctx-item" @click="$emit('edit-tags')"><WsIcon name="tag" size="xs" /> 编辑标签</button>
    <button v-if="ctxMenu.nodeId" class="mm-ctx-item" @click="$emit('connect')"><WsIcon name="link" size="xs" /> 连接</button>
    <button v-if="ctxMenu.nodeId && selectedCount >= 2" class="mm-ctx-item" @click="$emit('create-section')"><WsIcon name="item" size="xs" /> 创建分组框</button>
    <button v-if="ctxMenu.nodeId && selectedCount >= 2" class="mm-ctx-item" @click="$emit('analyze-relation')"><WsIcon name="search" size="xs" /> 分析关系</button>
    <button v-if="ctxMenu.nodeId && selectedCount >= 2" class="mm-ctx-item" @click="$emit('analyze-relation-ai')"><WsIcon name="concept" size="xs" /> AI 分析关系</button>
    <button v-if="ctxMenu.nodeId && !ctxNodeIsCustom" class="mm-ctx-item" @click="$emit('toggle-collapse')">
      <WsIcon name="folder" size="xs" /> {{ collapsedText }}
    </button>
    <button v-if="ctxMenu.nodeId && ctxMenu.nodeType === 'section'" class="mm-ctx-item" @click="$emit('promote-section')"><WsIcon name="arrow-up" size="xs" /> 提升为实体分组</button>
    <button v-if="ctxMenu.nodeId && ctxMenu.nodeType === 'section'" class="mm-ctx-item danger" @click="$emit('remove-section')"><WsIcon name="delete" size="xs" /> 删除分组框</button>
    <button v-if="ctxMenu.nodeId" class="mm-ctx-item" @click="$emit('delete-node')"><WsIcon name="delete" size="xs" /> 删除</button>
    <div v-if="ctxMenu.nodeId" class="mm-ctx-divider"></div>

    <!-- 边操作 -->
    <button v-if="ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('edit-edge-label')"><WsIcon name="tag" size="xs" /> 编辑标签</button>
    <button v-if="ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('edit-edge-type')"><WsIcon name="refresh" size="xs" /> 更改关系类型</button>
    <button v-if="ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('delete-edge')"><WsIcon name="delete" size="xs" /> 删除关系</button>
    <div v-if="ctxMenu.edgeId" class="mm-ctx-divider"></div>
    <div v-if="ctxMenu.edgeId" class="mm-ctx-submenu-wrap">
      <button class="mm-ctx-item"><WsIcon name="outline" size="xs" /> 连线样式 ▸</button>
      <div class="mm-ctx-submenu">
        <button class="mm-ctx-item" @click="$emit('set-edge-style', 'bezier')">贝塞尔曲线</button>
        <button class="mm-ctx-item" @click="$emit('set-edge-style', 'straight')">— 直线</button>
        <button class="mm-ctx-item" @click="$emit('set-edge-style', 'taxi')">∟ 折线</button>
      </div>
    </div>

    <!-- 中心节点不显示"设为中心"和"进入子图" — 思维导图只有一个根 -->
    <div v-if="ctxMenu.nodeId && !ctxMenu.isCenter" class="mm-ctx-divider"></div>
    <button v-if="ctxMenu.nodeId && !ctxMenu.isCenter" class="mm-ctx-item" @click="$emit('set-center')"><WsIcon name="target" size="xs" /> 设为中心节点</button>
    <button v-if="ctxMenu.nodeId && !ctxMenu.isCenter && !ctxNodeIsCustom && ctxMenu.nodeType !== 'section'" class="mm-ctx-item" @click="$emit('enter-subgraph')"><WsIcon name="search" size="xs" /> 进入子图</button>
    <div v-if="ctxMenu.isCenter" class="mm-ctx-submenu-wrap">
      <button class="mm-ctx-item"><WsIcon name="palette" size="xs" /> 样式 ▸</button>
      <div class="mm-ctx-submenu">
        <button class="mm-ctx-item" @click="$emit('set-center-style', 'default')">默认</button>
        <button class="mm-ctx-item" @click="$emit('set-center-style', 'gold')">金色</button>
        <button class="mm-ctx-item" @click="$emit('set-center-style', 'flame')">火焰</button>
        <button class="mm-ctx-item" @click="$emit('set-center-style', 'ocean')">海洋</button>
        <button class="mm-ctx-item" @click="$emit('set-center-style', 'forest')">森林</button>
      </div>
    </div>
    <div v-if="ctxMenu.nodeType === 'textbox'" class="mm-ctx-submenu-wrap">
      <button class="mm-ctx-item"><WsIcon name="outline" size="xs" /> 大小 ▸</button>
      <div class="mm-ctx-submenu">
        <button class="mm-ctx-item" @click="$emit('set-textbox-size', 'small')">小</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-size', 'medium')">中</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-size', 'large')">大</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-size', 'wide')">宽</button>
      </div>
    </div>
    <div v-if="ctxMenu.nodeType === 'textbox'" class="mm-ctx-submenu-wrap">
      <button class="mm-ctx-item"><WsIcon name="palette" size="xs" /> 样式 ▸</button>
      <div class="mm-ctx-submenu">
        <button class="mm-ctx-item" @click="$emit('set-textbox-style', 'default')">默认</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-style', 'blue')">蓝色</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-style', 'green')">绿色</button>
        <button class="mm-ctx-item" @click="$emit('set-textbox-style', 'pink')">粉色</button>
      </div>
    </div>
    <button v-if="ctxMenu.nodeType === 'image'" class="mm-ctx-item" @click="$emit('edit-image')"><WsIcon name="image" size="xs" /> 编辑图片</button>
    <button v-if="ctxMenu.nodeType === 'note'" class="mm-ctx-item" @click="$emit('edit-note-content')"><WsIcon name="edit" size="xs" /> 编辑内容</button>

    <!-- 空白处操作 -->
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('create-node')">＋ 新建节点</button>
    <div v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-divider"></div>
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('add-textbox')"><WsIcon name="edit" size="xs" /> 文本框</button>
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('add-image')"><WsIcon name="image" size="xs" /> 图片</button>
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('add-note')"><WsIcon name="outline" size="xs" /> 备注</button>
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('add-link')"><WsIcon name="link" size="xs" /> 链接</button>
    <button v-if="!ctxMenu.nodeId && !ctxMenu.edgeId" class="mm-ctx-item" @click="$emit('add-group')"><WsIcon name="item" size="xs" /> 分组</button>

    <!-- 笔迹操作 -->
    <template v-if="ctxMenu.strokeId">
      <div class="mm-ctx-divider"></div>
      <div class="mm-ctx-item" role="button" tabindex="0" @click="$emit('delete-stroke')" @keydown.enter="$emit('delete-stroke')"><WsIcon name="delete" size="xs" /> 删除笔迹</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ContextMenuState } from '../mindmapStore'

const props = defineProps<{
  ctxMenu: ContextMenuState
  selectedCount: number
  collapsedText: string
}>()

defineEmits<{
  'edit-name': []
  'edit-description': []
  'edit-tags': []
  'connect': []
  'create-section': []
  'analyze-relation': []
  'analyze-relation-ai': []
  'toggle-collapse': []
  'promote-section': []
  'remove-section': []
  'delete-node': []
  'edit-edge-label': []
  'edit-edge-type': []
  'delete-edge': []
  'set-edge-style': [style: string]
  'set-center': []
  'set-center-style': [style: string]
  'enter-subgraph': []
  'set-textbox-size': [size: string]
  'set-textbox-style': [style: string]
  'edit-image': []
  'edit-note-content': []
  'create-node': []
  'add-textbox': []
  'add-image': []
  'add-note': []
  'add-link': []
  'add-group': []
  'delete-stroke': []
}>()

const CTX_MENU_W = 180
const CTX_MENU_H = 320

const menuStyle = computed(() => {
  let left = props.ctxMenu.x
  let top = props.ctxMenu.y
  if (left + CTX_MENU_W > window.innerWidth - 8) left = props.ctxMenu.x - CTX_MENU_W
  if (top + CTX_MENU_H > window.innerHeight - 8) top = props.ctxMenu.y - CTX_MENU_H
  left = Math.max(8, left)
  top = Math.max(8, top)
  return { left: left + 'px', top: top + 'px' }
})

const ctxNodeIsCustom = computed(() => {
  const types = ['textbox', 'image', 'note', 'link', 'group', 'center']
  return types.includes(props.ctxMenu.nodeType)
})
</script>

<style scoped>
.mm-ctx-menu { position: fixed; z-index: var(--z-detail); background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); padding: 4px 0; min-width: 160px; }
.mm-ctx-item { display: block; width: 100%; padding: 6px 14px; text-align: left; border: none; background: none; font-size: var(--font-size-sm); cursor: pointer; color: var(--text-color); white-space: nowrap; transition: background var(--transition-fast); }
.mm-ctx-item:hover { background: var(--hover-bg); }
.mm-ctx-divider { height: 1px; background: var(--border-color); margin: 4px 0; }
.mm-ctx-submenu-wrap { position: relative; }
.mm-ctx-submenu { display: none; position: absolute; left: 100%; top: 0; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); padding: 4px 0; min-width: 80px; }
.mm-ctx-submenu-wrap:hover .mm-ctx-submenu { display: block; }
</style>
