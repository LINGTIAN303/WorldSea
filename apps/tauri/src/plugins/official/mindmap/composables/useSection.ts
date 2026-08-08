import { computed } from 'vue'
import { useMindmapStore, type Section } from '../mindmapStore'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity, Relation } from '@worldsmith/entity-core'
import type { CanvasNode, CanvasEdge } from './canvasTypes'

export function useSection(options: {
  getNodes: () => CanvasNode[]
  getEdges: () => CanvasEdge[]
}) {
  const mindmapStore = useMindmapStore()
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()

  const sections = computed(() => Object.values(mindmapStore.sections))

  function createFromSelection(nodeIds: string[]): Section | null {
    if (nodeIds.length === 0) return null

    const id = `section-${Date.now()}`
    const section: Section = {
      id,
      name: '分组',
      color: '#6c5ce7',
      childNodeIds: [...nodeIds],
      isEntity: false,
    }
    mindmapStore.addSection(section)

    const nodes = options.getNodes()
    for (const nid of nodeIds) {
      const node = nodes.find(n => n.id === nid)
      if (node) {
        node.sectionColor = section.color
      }
    }

    nodes.push({
      id, name: '分组', type: 'section',
      x: 400, y: 300, vx: 0, vy: 0, fx: null, fy: null,
      width: 300, height: 200,
      color: section.color, icon: 'item', label: '分组',
      tags: [], description: '', degree: 0, customColor: '',
      isRoot: false, isCollapsed: false, childCount: nodeIds.length,
      centerStyle: '', textboxSize: '', textboxStyle: '',
      imageUrl: '', linkUrl: '', hidden: false,
      selected: false, highlighted: false, searchHighlight: false,
      sectionColor: section.color,
    })

    return section
  }

  function createFromRect(worldRect: { x1: number; y1: number; x2: number; y2: number }): Section | null {
    const nodes = options.getNodes()

    const containedIds: string[] = []
    for (const n of nodes) {
      if (n.type === 'section') continue
      if (n.x >= worldRect.x1 && n.x <= worldRect.x2 &&
          n.y >= worldRect.y1 && n.y <= worldRect.y2) {
        containedIds.push(n.id)
      }
    }

    return createFromSelection(containedIds)
  }

  function removeSection(id: string) {
    const section = mindmapStore.sections[id]
    if (!section) return

    const nodes = options.getNodes()
    if (section.childNodeIds.length > 0) {
      for (const nid of section.childNodeIds) {
        const node = nodes.find(n => n.id === nid)
        if (node) node.sectionColor = ''
      }
    }

    const idx = nodes.findIndex(n => n.id === id)
    if (idx >= 0) nodes.splice(idx, 1)

    mindmapStore.removeSection(id)
  }

  async function promoteToEntity(id: string): Promise<Entity | null> {
    const section = mindmapStore.sections[id]
    if (!section || section.isEntity) return null

    const now = new Date().toISOString()
    const entity: Entity = {
      id: `group-${Date.now()}`,
      type: 'group',
      name: section.name,
      description: '',
      properties: {},
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
    await entityStore.add(entity)

    for (const nid of section.childNodeIds) {
      const rel: Relation = {
        id: `rel-${Date.now()}-${nid}`,
        type: 'belongs_to',
        sourceId: nid,
        targetId: entity.id,
        label: '属于',
        properties: {},
        createdAt: now,
        updatedAt: now,
      }
      await relationStore.add(rel)
    }

    mindmapStore.updateSection(id, { isEntity: true, entityId: entity.id })
    return entity
  }

  function updateSectionName(id: string, name: string) {
    mindmapStore.updateSection(id, { name })
    const nodes = options.getNodes()
    const node = nodes.find(n => n.id === id)
    if (node) node.name = name
  }

  function updateSectionColor(id: string, color: string) {
    mindmapStore.updateSection(id, { color })
    const nodes = options.getNodes()
    const node = nodes.find(n => n.id === id)
    if (node) {
      node.color = color
      node.sectionColor = color
    }
  }

  return {
    sections,
    createFromSelection,
    createFromRect,
    removeSection,
    promoteToEntity,
    updateSectionName,
    updateSectionColor,
  }
}
