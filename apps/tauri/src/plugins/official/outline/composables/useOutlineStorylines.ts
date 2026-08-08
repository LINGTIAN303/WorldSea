import { computed, type Ref } from 'vue'
import type { Entity } from '@worldsmith/entity-core'

export function useOutlineStorylines(flatNodes: Ref<Entity[]>) {
  const storylines = computed(() => {
    const set = new Set<string>()
    for (const e of flatNodes.value) {
      const raw = (e.properties.storylines as string) || ''
      for (const s of raw.split(',')) {
        const trimmed = s.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  })

  const storylineOptions = computed(() => {
    return storylines.value.map(s => ({ value: s, label: s }))
  })

  function nodesByLine(line: string, nodes: Entity[]): Entity[] {
    return nodes.filter(e => {
      const raw = (e.properties.storylines as string) || ''
      return raw.split(',').map(s => s.trim()).includes(line)
    })
  }

  function lineWordCount(line: string, nodes: Entity[]): number {
    return nodesByLine(line, nodes).reduce(
      (s, e) => s + Number(e.properties.wordCount || 0), 0
    )
  }

  return {
    storylines,
    storylineOptions,
    nodesByLine,
    lineWordCount,
  }
}
