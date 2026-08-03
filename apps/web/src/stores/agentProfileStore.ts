/**
 * Agent 档案与 Provider 池管理 Store
 *
 * 管理群聊系统中的 AgentProfile（Dexie 持久化）和 ProviderSlot（localStorage 持久化）。
 * 提供完整的 CRUD 操作，以及从 localStorage 加载/保存 ProviderSlot 的逻辑。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentProfile, ProviderSlot, ProviderSlotEntry } from '@agent/group-chat/types'
import {
  listAgentProfiles,
  saveAgentProfile as dbSaveProfile,
  deleteAgentProfile as dbDeleteProfile,
} from '@agent/session/manager'

const STORAGE_KEY_PROVIDER_SLOTS = 'worldsmith_group_provider_slots'

function loadSlotsFromStorage(): ProviderSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROVIDER_SLOTS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSlotsToStorage(slots: ProviderSlot[]): void {
  localStorage.setItem(STORAGE_KEY_PROVIDER_SLOTS, JSON.stringify(slots))
}

export const useAgentProfileStore = defineStore('agentProfile', () => {
  const profiles = ref<AgentProfile[]>([])
  const slots = ref<ProviderSlot[]>(loadSlotsFromStorage())
  const loaded = ref(false)

  const enabledProfiles = computed(() => profiles.value.filter(p => p.enabled))

  async function load(): Promise<void> {
    if (loaded.value) return
    profiles.value = await listAgentProfiles()
    loaded.value = true
  }

  async function createProfile(data: Omit<AgentProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentProfile> {
    const profile: AgentProfile = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    profiles.value.push(profile)
    await dbSaveProfile(profile)
    return profile
  }

  async function updateProfile(id: string, patch: Partial<AgentProfile>): Promise<void> {
    const index = profiles.value.findIndex(p => p.id === id)
    if (index === -1) return
    const updated = { ...profiles.value[index], ...patch, updatedAt: new Date().toISOString() }
    profiles.value[index] = updated
    await dbSaveProfile(updated)
  }

  async function deleteProfile(id: string): Promise<void> {
    profiles.value = profiles.value.filter(p => p.id !== id)
    await dbDeleteProfile(id)
  }

  async function toggleAgent(id: string): Promise<void> {
    const profile = profiles.value.find(p => p.id === id)
    if (profile) {
      profile.enabled = !profile.enabled
      profile.updatedAt = new Date().toISOString()
      await dbSaveProfile(profile)
    }
  }

  function createSlot(data: Omit<ProviderSlot, 'id'>): ProviderSlot {
    const slot: ProviderSlot = { ...data, id: crypto.randomUUID() }
    slots.value.push(slot)
    saveSlotsToStorage(slots.value)
    return slot
  }

  function updateSlot(id: string, patch: Partial<ProviderSlot>): void {
    const index = slots.value.findIndex(s => s.id === id)
    if (index === -1) return
    slots.value[index] = { ...slots.value[index], ...patch }
    saveSlotsToStorage(slots.value)
  }

  function deleteSlot(id: string): void {
    slots.value = slots.value.filter(s => s.id !== id)
    saveSlotsToStorage(slots.value)
  }

  function addSlotEntry(slotId: string, entry: Omit<ProviderSlotEntry, 'id'>): void {
    const slot = slots.value.find(s => s.id === slotId)
    if (!slot) return
    slot.entries.push({ ...entry, id: crypto.randomUUID() })
    saveSlotsToStorage(slots.value)
  }

  function removeSlotEntry(slotId: string, entryId: string): void {
    const slot = slots.value.find(s => s.id === slotId)
    if (!slot) return
    slot.entries = slot.entries.filter(e => e.id !== entryId)
    saveSlotsToStorage(slots.value)
  }

  function getSlot(id: string): ProviderSlot | undefined {
    return slots.value.find(s => s.id === id)
  }

  return {
    profiles,
    slots,
    loaded,
    enabledProfiles,
    load,
    createProfile,
    updateProfile,
    deleteProfile,
    toggleAgent,
    createSlot,
    updateSlot,
    deleteSlot,
    addSlotEntry,
    removeSlotEntry,
    getSlot,
  }
})
