import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChatAgent } from '../types'
import { saveChatAgent, getAllChatAgents, deleteChatAgent as deleteChatAgentDB } from '../GroupSessionManager'
import { assignAgentColor } from '../types'

export const useAgentRegistryStore = defineStore('agent-registry', () => {
  const agents = ref<ChatAgent[]>([])

  const entityAgents = computed(() => agents.value.filter(a => a.sourceType === 'entity'))
  const customAgents = computed(() => agents.value.filter(a => a.sourceType === 'custom'))

  function addAgent(agent: ChatAgent): void {
    agents.value = [agent, ...agents.value]
  }

  function updateAgent(id: string, patch: Partial<ChatAgent>): void {
    const idx = agents.value.findIndex(a => a.id === id)
    if (idx !== -1) {
      agents.value[idx] = { ...agents.value[idx], ...patch, updatedAt: Date.now() }
    }
  }

  function removeAgent(id: string): void {
    agents.value = agents.value.filter(a => a.id !== id)
  }

  function getAgent(id: string): ChatAgent | undefined {
    return agents.value.find(a => a.id === id)
  }

  async function loadFromDB(): Promise<void> {
    agents.value = await getAllChatAgents()
  }

  async function persistAgent(agent: ChatAgent): Promise<void> {
    await saveChatAgent(agent)
  }

  async function deleteAgentAndPersist(id: string): Promise<void> {
    removeAgent(id)
    await deleteChatAgentDB(id)
  }

  function createAgentFromEntity(data: {
    entityId: string
    entityName: string
    entityType: string
    description: string
    systemPrompt: string
    modelId?: string
  }): ChatAgent {
    const now = Date.now()
    const idx = agents.value.length
    const agent: ChatAgent = {
      id: crypto.randomUUID(),
      name: data.entityName,
      avatar: data.entityName[0],
      color: assignAgentColor(idx),
      role: data.entityType,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      sourceType: 'entity',
      sourceEntityId: data.entityId,
      enabledTools: [],
      enabledSkills: [],
      baseLayerMode: 'empty',
      toolSource: 'derived',
      createdAt: now,
      updatedAt: now,
    }
    addAgent(agent)
    return agent
  }

  function createCustomAgent(data: {
    name: string
    role: string
    systemPrompt: string
    modelId?: string
  }): ChatAgent {
    const now = Date.now()
    const idx = agents.value.length
    const agent: ChatAgent = {
      id: crypto.randomUUID(),
      name: data.name,
      avatar: data.name[0],
      color: assignAgentColor(idx),
      role: data.role,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      sourceType: 'custom',
      enabledTools: [],
      enabledSkills: [],
      baseLayerMode: 'empty',
      toolSource: 'derived',
      createdAt: now,
      updatedAt: now,
    }
    addAgent(agent)
    return agent
  }

  return {
    agents,
    entityAgents,
    customAgents,
    addAgent,
    updateAgent,
    removeAgent,
    getAgent,
    loadFromDB,
    persistAgent,
    deleteAgentAndPersist,
    createAgentFromEntity,
    createCustomAgent,
  }
})
