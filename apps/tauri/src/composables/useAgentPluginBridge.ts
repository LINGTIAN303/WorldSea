import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export interface AgentPluginAction {
  pluginId: string
  action: string
  payload: Record<string, unknown>
  timestamp: number
}

export type AgentPluginActionHandler = (event: AgentPluginAction) => void

export function useAgentPluginBridge(pluginId: string, handler: AgentPluginActionHandler): Ref<number> {
  const eventCount = ref(0)

  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as AgentPluginAction | undefined
    if (!detail || detail.pluginId !== pluginId) return
    eventCount.value++
    handler(detail)
  }

  onMounted(() => {
    window.addEventListener('worldsmith:agent:plugin-action', listener)
  })

  onUnmounted(() => {
    window.removeEventListener('worldsmith:agent:plugin-action', listener)
  })

  return eventCount
}