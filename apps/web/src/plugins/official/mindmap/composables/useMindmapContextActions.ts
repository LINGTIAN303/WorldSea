/** 思维导图右键菜单操作/内联编辑/边操作/实体表单（从 MindmapView 拆出），详细见 docs/details/注释/web/plugins/official/mindmap/composables/useMindmapContextActions.md */
import { nextTick, type Ref } from 'vue'
import { relationSchemaRegistry, getEdgeColor, useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity, Relation } from '@worldsmith/entity-core'
import type { FormFieldDef } from '@worldsmith/plugin-sdk'
import type { CanvasNode, CanvasEdge } from './canvasTypes'
import { useMindmapStore } from '../mindmapStore'
import type { useMindmapNodeOps } from './useMindmapNodeOps'
import type { useCanvasRenderer } from './useCanvasRenderer'
import type { useMindmapModals } from './useMindmapModals'
import { edgeLineStyle } from '../mindmapConfig'

/** useMindmapContextActions 依赖的外部参数 */
export interface UseMindmapContextActionsDeps {
  mindmapStore: ReturnType<typeof useMindmapStore>
  entityStore: ReturnType<typeof useEntityStore>
  relationStore: ReturnType<typeof useRelationStore>
  canvasNodes: Ref<CanvasNode[]>
  canvasEdges: Ref<CanvasEdge[]>
  selectedNodeId: { value: string }
  selectedNodes: Set<string>
  nodeOps: ReturnType<typeof useMindmapNodeOps>
  renderer: ReturnType<typeof useCanvasRenderer>
  containerRef: Ref<HTMLDivElement | null>
  imageInputRef: Ref<HTMLInputElement | undefined>
  modals: ReturnType<typeof useMindmapModals>
  rebuildGraph: () => void
  enterNestedNode: (nodeId: string) => void
}

export function useMindmapContextActions(deps: UseMindmapContextActionsDeps) {
  const {
    mindmapStore, entityStore, relationStore,
    canvasNodes, canvasEdges,
    selectedNodeId,
    nodeOps, renderer, containerRef, imageInputRef,
    modals, rebuildGraph,
  } = deps

  // 临时状态：关系创建时的源/目标/类型（onNodeClick 与 onPickRelation 共享）
  let _relTypId = ''
  let _edgeSrcId = ''
  let _edgeTgtId = ''

  /** 表单字段定义 */
  function getFormFields(_type: string): FormFieldDef[] {
    return [
      { key: 'name', label: '名称', type: 'text', required: true, placeholder: '名称' },
      { key: 'description', label: '描述', type: 'textarea' },
      { key: 'tags', label: '标签', type: 'tags' },
    ]
  }

  // ===== 关系/边创建 =====

  /** 创建关系边并写入 store */
  function createRelationEdge(srcId: string, tgtId: string, relType: string): void {
    const edgeId = `rel-${Date.now()}`
    const rt = relationSchemaRegistry.getAll().find(r => r.typeKey === relType)
    canvasEdges.value.push({
      id: edgeId, source: srcId, target: tgtId,
      sourceId: srcId, targetId: tgtId,
      label: rt?.label || relType, arrow: true, bidir: false,
      relType, relLabel: rt?.label || relType,
      bidirectional: false, symmetric: false,
      color: getEdgeColor(relType, 'warm'),
      curveStyle: edgeLineStyle(relType) as CanvasEdge['curveStyle'],
      dashed: false, noArrow: false, hidden: false, selected: false,
    })
    const newRel: Relation = {
      id: edgeId, type: relType,
      label: rt?.label || relType,
      sourceId: srcId, targetId: tgtId,
      properties: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    relationStore.add(newRel)
  }

  // ===== 实体类型/关系类型选择器 =====

  function ctxCreateNode(): void {
    mindmapStore.hideContextMenu()
    modals.showTypePicker.value = true
  }

  function onPickType(type: string): void {
    modals.showTypePicker.value = false
    modals.entityFormType.value = type
    modals.editingEntity.value = null
    modals.showEntityForm.value = true
  }

  function onPickRelation(rt: { type: string; label: string }): void {
    modals.showRelationPicker.value = false
    _relTypId = rt.type
    createRelationEdge(_edgeSrcId, _edgeTgtId, _relTypId)
  }

  async function onEntityFormSave(data: {
    name: string
    description: string
    properties: Record<string, unknown>
    tags: string[]
  }): Promise<void> {
    const now = new Date().toISOString()
    if (modals.editingEntity.value) {
      await entityStore.update(modals.editingEntity.value.id, {
        name: data.name, description: data.description,
        properties: data.properties, tags: data.tags,
      })
    } else {
      const entity: Entity = {
        id: `${modals.entityFormType.value.slice(0, 4)}-${Date.now()}`,
        type: modals.entityFormType.value, name: data.name, description: data.description,
        properties: data.properties, tags: data.tags, createdAt: now, updatedAt: now,
      }
      await entityStore.add(entity)
    }
    modals.showEntityForm.value = false
    await entityStore.loadAll()
    rebuildGraph()
  }

  // ===== 内联编辑（节点名称 / 边标签）=====

  function ctxEditName(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    const targetId = ctxMenu.nodeId || selectedNodeId.value
    if (!targetId) return
    const node = canvasNodes.value.find(n => n.id === targetId)
    if (!node) return
    modals.inlineEditTarget.value = targetId
    modals.inlineEditText.value = node.name
    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      const cam = renderer.camera.value
      modals.inlineEditStyle.value = {
        left: (node.x * cam.k + rect.width / 2 - cam.x * cam.k) + 'px',
        top: (node.y * cam.k + rect.height / 2 - cam.y * cam.k) + 'px',
      }
    }
    modals.showInlineEdit.value = true
    nextTick(() => {
      const input = document.querySelector<HTMLInputElement>('.mm-inline-input')
      input?.focus()
    })
  }

  function commitInlineEdit(): void {
    if (!modals.inlineEditTarget.value) return
    const targetId = modals.inlineEditTarget.value
    // 判断是边还是节点
    const edge = canvasEdges.value.find(e => e.id === targetId)
    if (edge) {
      // 边标签编辑
      edge.relLabel = modals.inlineEditText.value
      edge.label = modals.inlineEditText.value
      const rel = relationStore.relations.find(r => r.id === targetId)
      if (rel) relationStore.update(rel.id, { label: modals.inlineEditText.value })
    } else {
      // 节点名称编辑
      nodeOps.renameNode(targetId, modals.inlineEditText.value)
      const entity = entityStore.entities.find(e => e.id === targetId)
      if (entity) entityStore.update(entity.id, { name: modals.inlineEditText.value })
    }
    modals.showInlineEdit.value = false
  }

  function cancelInlineEdit(): void {
    modals.showInlineEdit.value = false
  }

  // ===== 描述/标签编辑器 =====

  function ctxEditDescription(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    modals.descEditorTargetId.value = ctxMenu.nodeId
    const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
    modals.descEditorText.value = entity?.description || ''
    modals.showDescEditor.value = true
  }

  async function saveDescription(): Promise<void> {
    if (!modals.descEditorTargetId.value) return
    await entityStore.update(modals.descEditorTargetId.value, {
      description: modals.descEditorText.value,
    })
    modals.showDescEditor.value = false
    await entityStore.loadAll()
    rebuildGraph()
  }

  function ctxEditTags(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    modals.tagEditorTargetId.value = ctxMenu.nodeId
    const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
    modals.tagEditorText.value = entity?.tags?.join('\n') || ''
    modals.showTagEditor.value = true
  }

  async function saveTags(): Promise<void> {
    if (!modals.tagEditorTargetId.value) return
    const tags = modals.tagEditorText.value.split('\n').map(s => s.trim()).filter(Boolean)
    await entityStore.update(modals.tagEditorTargetId.value, { tags })
    modals.showTagEditor.value = false
    await entityStore.loadAll()
    rebuildGraph()
  }

  // ===== 折叠/删除/连线 =====

  function ctxToggleCollapse(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.toggleCollapse(ctxMenu.nodeId)
    rebuildGraph()
  }

  function ctxDeleteNode(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.deleteNode(ctxMenu.nodeId)
    const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
    if (entity) entityStore.remove(ctxMenu.nodeId)
  }

  function startEdgeConnect(): void {
    mindmapStore.hideContextMenu()
    mindmapStore.startEdgeConnect(mindmapStore.ui.contextMenu.nodeId)
  }

  // ===== 边编辑 =====

  function editEdgeLabel(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.edgeId) return
    const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
    if (!edge) return
    modals.inlineEditTarget.value = ctxMenu.edgeId
    modals.inlineEditText.value = edge.relLabel || ''
    modals.showInlineEdit.value = true
    nextTick(() => {
      const input = document.querySelector<HTMLInputElement>('.mm-inline-input')
      input?.focus()
    })
  }

  function editEdgeType(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.edgeId) return
    const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
    if (!edge) return
    _edgeSrcId = edge.source
    _edgeTgtId = edge.target
    _relTypId = edge.relType
    modals.availableRelationTypes.value = relationSchemaRegistry.getAll().map(r => ({
      type: r.typeKey, label: r.label || r.typeKey,
    }))
    modals.showRelationPicker.value = true
  }

  function deleteEdge(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.edgeId) return
    nodeOps.deleteEdge(ctxMenu.edgeId)
  }

  function setEdgeStyle(style: string): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.edgeId) return
    mindmapStore.setEdgeStyle(ctxMenu.edgeId, { lineStyle: style as 'bezier' | 'straight' | 'taxi' | 'unbundled-bezier' })
    const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
    if (edge) edge.curveStyle = style as CanvasEdge['curveStyle']
  }

  // ===== 颜色选择 =====

  function onPickColor(color: string): void {
    modals.showColorPicker.value = false
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.setCustomColor(ctxMenu.nodeId, color)
    mindmapStore.setNodeColor(ctxMenu.nodeId, color)
  }

  // ===== 中心节点操作 =====

  function ctxSetCenter(): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.setAsCenter(ctxMenu.nodeId)
  }

  function ctxSetCenterStyle(style: string): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.setCenterStyle(ctxMenu.nodeId, style)
  }

  function ctxAddCenter(): void {
    mindmapStore.hideContextMenu()
    nodeOps.addCenter()
  }

  // ===== 自定义节点添加 =====

  function ctxAddTextbox(): void {
    mindmapStore.hideContextMenu()
    nodeOps.addTextbox()
  }

  function ctxAddImage(): void {
    mindmapStore.hideContextMenu()
    imageInputRef.value?.click()
  }

  function onImageFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      nodeOps.addImage(reader.result as string, file.name)
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  function ctxEditImage(): void {
    mindmapStore.hideContextMenu()
    imageInputRef.value?.click()
  }

  function ctxAddNote(): void {
    mindmapStore.hideContextMenu()
    nodeOps.addNote()
  }

  function ctxEditNoteContent(): void {
    mindmapStore.hideContextMenu()
    ctxEditName()
  }

  function ctxAddLink(): void {
    mindmapStore.hideContextMenu()
    nodeOps.addLink()
  }

  function ctxAddGroup(): void {
    mindmapStore.hideContextMenu()
    nodeOps.addGroup()
  }

  function ctxSetTextboxSize(size: string): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.setTextboxSize(ctxMenu.nodeId, size as 'small' | 'medium' | 'large')
  }

  function ctxSetTextboxStyle(style: string): void {
    mindmapStore.hideContextMenu()
    const ctxMenu = mindmapStore.ui.contextMenu
    if (!ctxMenu.nodeId) return
    nodeOps.setTextboxStyle(ctxMenu.nodeId, style)
  }

  // ===== 提供给外部使用的临时状态访问器 =====
  function setEdgeDraft(srcId: string, tgtId: string, relType: string): void {
    _edgeSrcId = srcId
    _edgeTgtId = tgtId
    _relTypId = relType
  }
  function getEdgeDraft(): { srcId: string; tgtId: string; relType: string } {
    return { srcId: _edgeSrcId, tgtId: _edgeTgtId, relType: _relTypId }
  }

  return {
    // 表单
    getFormFields,
    // 关系/边创建
    createRelationEdge,
    // 类型/关系选择器
    ctxCreateNode, onPickType, onPickRelation, onEntityFormSave,
    // 内联编辑
    ctxEditName, commitInlineEdit, cancelInlineEdit,
    // 描述/标签
    ctxEditDescription, saveDescription, ctxEditTags, saveTags,
    // 折叠/删除/连线
    ctxToggleCollapse, ctxDeleteNode, startEdgeConnect,
    // 边编辑
    editEdgeLabel, editEdgeType, deleteEdge, setEdgeStyle,
    // 颜色
    onPickColor,
    // 中心节点
    ctxSetCenter, ctxSetCenterStyle, ctxAddCenter,
    // 自定义节点
    ctxAddTextbox, ctxAddImage, onImageFileSelected, ctxEditImage,
    ctxAddNote, ctxEditNoteContent, ctxAddLink, ctxAddGroup,
    ctxSetTextboxSize, ctxSetTextboxStyle,
    // 临时状态
    setEdgeDraft, getEdgeDraft,
  }
}
