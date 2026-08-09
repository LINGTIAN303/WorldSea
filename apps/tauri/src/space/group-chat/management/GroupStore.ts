import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GroupChatMode } from '../types'

export interface GroupListItem {
  id: string
  name: string
  avatar: string
  mode: GroupChatMode
  lastMessage: string
  lastMessageAt: number
  unreadCount: number
  pinned: boolean
  memberCount: number
}

export const useGroupStore = defineStore('groups', () => {
  const groups = ref<GroupListItem[]>([])
  const activeGroupId = ref<string | null>(null)

  const activeGroup = computed(() => groups.value.find(g => g.id === activeGroupId.value) || null)

  function addGroup(group: GroupListItem): void {
    groups.value = [group, ...groups.value]
  }

  function removeGroup(groupId: string): void {
    groups.value = groups.value.filter(g => g.id !== groupId)
    if (activeGroupId.value === groupId) {
      activeGroupId.value = groups.value.length > 0 ? groups.value[0].id : null
    }
  }

  function setActiveGroup(groupId: string): void {
    activeGroupId.value = groupId
    const g = groups.value.find(g => g.id === groupId)
    if (g) g.unreadCount = 0
  }

  function updateGroup(groupId: string, patch: Partial<GroupListItem>): void {
    const idx = groups.value.findIndex(g => g.id === groupId)
    if (idx !== -1) {
      groups.value[idx] = { ...groups.value[idx], ...patch }
    }
  }

  function pinGroup(groupId: string): void {
    updateGroup(groupId, { pinned: true })
  }

  function unpinGroup(groupId: string): void {
    updateGroup(groupId, { pinned: false })
  }

  function incrementUnread(groupId: string): void {
    const g = groups.value.find(g => g.id === groupId)
    if (g) g.unreadCount++
  }

  function updateGroupPreview(groupId: string, lastMessage: string, lastMessageAt: number): void {
    const idx = groups.value.findIndex(g => g.id === groupId)
    if (idx !== -1) {
      groups.value[idx] = {
        ...groups.value[idx],
        lastMessage,
        lastMessageAt,
      }
    }
  }

  const sortedGroups = computed(() => {
    return [...groups.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.lastMessageAt - a.lastMessageAt
    })
  })

  return {
    groups, activeGroupId, activeGroup, sortedGroups,
    addGroup, removeGroup, setActiveGroup, updateGroup,
    pinGroup, unpinGroup, incrementUnread, updateGroupPreview,
  }
})