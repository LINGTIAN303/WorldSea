/** Mindmap ↔ AI Agent 通信桥（CustomEvent 双向通信 + Action 协议见文档），详细见 docs/details/注释/web/plugins/official/mindmap/composables/useAgentBridge.md */
import { onMounted, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import { useMindmapStore } from '../mindmapStore'
import type { LayoutAlgorithmType } from '../mindmapStore'

export interface AgentBridgeCallbacks {
  autoLayout: (algorithm: LayoutAlgorithmType) => void
  findIsolated: () => void
  findCycles: () => void
  highlightPath: (sourceId: string, targetId: string) => void
  suggestMoveToGroup: (nodeId: string, groupId: string) => void
  selectNode: (nodeId: string) => void
  fitView: () => void
  aiOrganize: () => void
}

export function useAgentBridge(
  isActive: Ref<boolean>,
  callbacks: AgentBridgeCallbacks,
): void {
  function handle(e: Event) {
    if (!isActive.value) return
    const detail = (e as CustomEvent).detail
    if (!detail || detail.pluginId !== 'mindmap') return
    const payload = (detail.payload || {}) as Record<string, unknown>

    switch (detail.action) {
      case 'auto_layout':
        callbacks.autoLayout((payload.algorithm as any) || 'force')
        break
      case 'find_isolated':
        callbacks.findIsolated()
        break
      case 'find_cycles':
        callbacks.findCycles()
        break
      case 'highlight_path':
        if (payload.sourceId && payload.targetId) {
          callbacks.highlightPath(String(payload.sourceId), String(payload.targetId))
        }
        break
      case 'suggest_move_to_group':
        if (payload.nodeId && payload.groupId) {
          callbacks.suggestMoveToGroup(String(payload.nodeId), String(payload.groupId))
        }
        break
      case 'select_node':
        if (payload.nodeId) callbacks.selectNode(String(payload.nodeId))
        break
      case 'fit_view':
        callbacks.fitView()
        break
      case 'ai_organize':
        callbacks.aiOrganize()
        break
    }
  }

  function handleQuery(e: Event) {
    if (!isActive.value) return
    const detail = (e as CustomEvent).detail
    if (!detail || detail.pluginId !== 'mindmap') return
    if (detail.query === 'get_structure') {
      const store = useMindmapStore()
      // 把当前结构塞回 window 供 agent 读取（简单实现，不阻塞）
      ;window.__worldsmith_mindmap_structure__ = {
        sections: store.sections,
        customNodes: store.customNodes,
      }
    }
  }

  onMounted(() => {
    window.addEventListener('worldsmith:agent:plugin-action', handle as EventListener)
    window.addEventListener('worldsmith:agent:plugin-query', handleQuery as EventListener)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('worldsmith:agent:plugin-action', handle as EventListener)
    window.removeEventListener('worldsmith:agent:plugin-query', handleQuery as EventListener)
  })
}
