import { computed } from 'vue'
import {
  getNodeTypeInfo,
  getEdgeTypeInfo,
  getNodeColor,
  getEdgeColor,
  getAllNodeTypes,
  getAllEdgeTypes,
  type TypeInfo,
  type EdgeTypeInfo,
} from '../core'

export function useTypeMapping() {
  function getColor(type: string, theme: 'cool' | 'warm'): string {
    return getNodeColor(type, theme)
  }

  function getEdgeColorForTheme(type: string, theme: 'cool' | 'warm'): string {
    return getEdgeColor(type, theme)
  }

  function getShape(type: string): string {
    return getNodeTypeInfo(type).shape
  }

  function getIcon(type: string): string {
    return getNodeTypeInfo(type).icon
  }

  function getLabel(type: string): string {
    return getNodeTypeInfo(type).label
  }

  function getEdgeLabel(type: string): string {
    return getEdgeTypeInfo(type).label
  }

  const nodeTypeList = computed<TypeInfo[]>(() => getAllNodeTypes())
  const edgeTypeList = computed<EdgeTypeInfo[]>(() => getAllEdgeTypes())

  return {
    getColor,
    getEdgeColor: getEdgeColorForTheme,
    getShape,
    getIcon,
    getLabel,
    getEdgeLabel,
    nodeTypeList,
    edgeTypeList,
  }
}
