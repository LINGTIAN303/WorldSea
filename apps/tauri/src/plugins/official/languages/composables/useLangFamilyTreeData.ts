import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'

export interface LangNode {
  id: string
  name: string
  langType: string
  scriptType: string
  languageFamily: string
  scope: string
  x: number
  y: number
  color: string
  icon: string
}

export type LangRelation = '同源' | '借词' | '混合' | '变体' | '祖先语言'

export interface LangEdge {
  sourceId: string
  targetId: string
  type: 'branch' | 'related'
  relation?: LangRelation
}

export interface LangTreeData {
  nodes: LangNode[]
  edges: LangEdge[]
}

const TYPE_ICONS: Record<string, string> = {
  '自然语言': 'message', '魔法语言': 'sparkles', '古代语': 'scroll',
  '方言': 'chat', '手语': 'hand', '密码': 'lock',
}

const TYPE_COLORS: Record<string, string> = {
  '自然语言': '#58a6ff', '魔法语言': '#d2a8ff', '古代语': '#d29922',
  '方言': '#3fb950', '手语': '#79c0ff', '密码': '#f0883e',
}

const FAMILY_COLORS: Record<string, string> = {
  '印欧语系': '#58a6ff', '汉藏语系': '#f0883e', '乌拉尔语系': '#3fb950',
  '阿尔泰语系': '#d29922', '闪含语系': '#f778ba', '尼日尔-刚果语系': '#a371f7',
  '南岛语系': '#79c0ff', '达罗毗荼语系': '#d2a8ff', '高加索语系': '#8b949e',
}

function getFamilyColor(family: string): string {
  if (FAMILY_COLORS[family]) return FAMILY_COLORS[family]
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    hash = ((hash << 5) - hash + family.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 60%)`
}

export function useLangFamilyTreeData() {
  const es = useEntityStore()
  const rs = useRelationStore()

  const langEntities = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'language')
  )

  const nodes = computed<LangNode[]>(() =>
    langEntities.value.map(e => {
      const lt = (e.properties.langType as string) || '自然语言'
      const fam = (e.properties.languageFamily as string) || ''
      return {
        id: e.id,
        name: e.name,
        langType: lt,
        scriptType: (e.properties.scriptType as string) || '',
        languageFamily: fam,
        scope: (e.properties.scope as string) || '',
        x: 0,
        y: 0,
        color: fam ? getFamilyColor(fam) : (TYPE_COLORS[lt] || '#95a5a6'),
        icon: TYPE_ICONS[lt] || 'text',
      }
    })
  )

  const edges = computed<LangEdge[]>(() => {
    const result: LangEdge[] = []
    for (const r of rs.relations) {
      if (r.type === 'language_branch') {
        result.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          type: 'branch',
        })
      } else if (r.type === 'related_language') {
        const rel = (r.properties?.relation as LangRelation) || '同源'
        result.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          type: 'related',
          relation: rel,
        })
      }
    }
    return result
  })

  const families = computed(() => {
    const famSet = new Set<string>()
    for (const n of nodes.value) {
      if (n.languageFamily) famSet.add(n.languageFamily)
    }
    return Array.from(famSet).sort()
  })

  const treeData = computed<LangTreeData>(() => ({
    nodes: nodes.value,
    edges: edges.value,
  }))

  return { langEntities, nodes, edges, families, treeData }
}
