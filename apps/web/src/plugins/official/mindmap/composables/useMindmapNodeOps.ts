import type { Ref } from 'vue'
import type { CanvasNode, CanvasEdge } from './canvasTypes'

/**
 * 节点增删改的工厂函数
 * Q1 把这些从 MindmapView.vue 拆出来
 */
export function useMindmapNodeOps(opts: {
  canvasNodes: Ref<CanvasNode[]>
  canvasEdges: Ref<CanvasEdge[]>
}) {
  function makeBaseNode(overrides: Partial<CanvasNode> & { id: string; name: string; type: string }): CanvasNode {
    return {
      x: 500, y: 400, vx: 0, vy: 0, fx: 500, fy: 400,
      width: 80, height: 50,
      color: '#78909c', icon: 'edit', label: overrides.type,
      tags: [], description: '', degree: 0, customColor: '',
      isRoot: false, isCollapsed: false, childCount: 0,
      centerStyle: '', textboxSize: '', textboxStyle: '',
      imageUrl: '', linkUrl: '', hidden: false,
      selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
      ...overrides,
    }
  }

  function addTextbox(): void {
    opts.canvasNodes.value.push(makeBaseNode({
      id: `textbox-${Date.now()}`,
      name: '文本框',
      type: 'textbox',
      x: 500, y: 350, fx: 500, fy: 350,
      width: 160, height: 80,
      color: '#eab308', icon: 'edit', label: '文本框',
    }))
  }

  function addNote(): void {
    opts.canvasNodes.value.push(makeBaseNode({
      id: `note-${Date.now()}`,
      name: '备注',
      type: 'note',
      x: 500, y: 400, fx: 500, fy: 400,
      width: 140, height: 60,
      color: '#ca8a04', icon: 'outline', label: '备注',
    }))
  }

  function addLink(): void {
    opts.canvasNodes.value.push(makeBaseNode({
      id: `link-${Date.now()}`,
      name: '链接',
      type: 'link',
      x: 500, y: 450, fx: 500, fy: 450,
      width: 140, height: 40,
      color: '#3b82f6', icon: 'link', label: '链接',
    }))
  }

  function addGroup(): void {
    opts.canvasNodes.value.push(makeBaseNode({
      id: `group-${Date.now()}`,
      name: '分组',
      type: 'group',
      x: 500, y: 400, fx: 500, fy: 400,
      width: 300, height: 200,
      color: '#999', icon: 'item', label: '分组',
    }))
  }

  function addCenter(): void {
    opts.canvasNodes.value.push({
      id: `center-${Date.now()}`,
      name: '中心',
      type: 'center',
      x: 400, y: 300, vx: 0, vy: 0, fx: 400, fy: 300,
      width: 120, height: 120,
      color: '#a78bfa', icon: 'star', label: '中心',
      tags: [], description: '', degree: 0, customColor: '',
      isRoot: true, isCollapsed: false, childCount: 0,
      centerStyle: '', textboxSize: '', textboxStyle: '',
      imageUrl: '', linkUrl: '', hidden: false,
      selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
    })
  }

  function addImage(dataUrl: string, fileName: string): void {
    opts.canvasNodes.value.push({
      id: `image-${Date.now()}`,
      name: fileName,
      type: 'image',
      x: 500, y: 400, vx: 0, vy: 0, fx: 500, fy: 400,
      width: 150, height: 120,
      color: '#999', icon: 'image', label: '图片',
      tags: [], description: '', degree: 0, customColor: '',
      isRoot: false, isCollapsed: false, childCount: 0,
      centerStyle: '', textboxSize: '', textboxStyle: '',
      imageUrl: dataUrl, linkUrl: '', hidden: false,
      selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
    })
  }

  function setTextboxSize(nodeId: string, size: 'small' | 'medium' | 'large' | 'wide'): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (!node) return
    node.textboxSize = size === 'medium' ? '' : size
    switch (size) {
      case 'small': node.width = 120; node.height = 60; break
      case 'large': node.width = 220; node.height = 110; break
      case 'wide': node.width = 280; node.height = 80; break
      default: node.width = 160; node.height = 80; break
    }
  }

  function setTextboxStyle(nodeId: string, style: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (node) node.textboxStyle = style === 'default' ? '' : style
  }

  function setCenterStyle(nodeId: string, style: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (node) node.centerStyle = style === 'default' ? '' : style
  }

  function setAsCenter(nodeId: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (!node) return
    node.type = 'center'
    node.width = 120
    node.height = 120
    node.isRoot = true
  }

  function toggleCollapse(nodeId: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (node) node.isCollapsed = !node.isCollapsed
  }

  function setCustomColor(nodeId: string, color: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (color) {
      if (node) node.customColor = color
    } else {
      if (node) node.customColor = ''
    }
  }

  function renameNode(nodeId: string, name: string): void {
    const node = opts.canvasNodes.value.find(n => n.id === nodeId)
    if (node) node.name = name
  }

  function deleteNode(nodeId: string): void {
    opts.canvasNodes.value = opts.canvasNodes.value.filter(n => n.id !== nodeId)
    opts.canvasEdges.value = opts.canvasEdges.value.filter(
      e => e.source !== nodeId && e.target !== nodeId,
    )
  }

  function deleteSelected(selectedIds: Set<string>): void {
    for (const id of selectedIds) {
      deleteNode(id)
    }
  }

  function deleteEdge(edgeId: string): void {
    opts.canvasEdges.value = opts.canvasEdges.value.filter(e => e.id !== edgeId)
  }

  return {
    makeBaseNode,
    addTextbox, addNote, addLink, addGroup, addCenter, addImage,
    setTextboxSize, setTextboxStyle, setCenterStyle, setAsCenter,
    toggleCollapse, setCustomColor, renameNode, deleteNode, deleteSelected, deleteEdge,
  }
}
