import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type UserStatus = 'online' | 'away' | 'busy' | 'dnd'

export interface UserProfile {
  nickname: string
  avatar: string
  status: UserStatus
  customStatus: string
}

const STORAGE_KEY = 'worldsmith_user_profile'

const DEFAULT_PROFILE: UserProfile = {
  nickname: '我',
  avatar: '',
  status: 'online',
  customStatus: '',
}

function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_PROFILE }
}

function saveProfile(p: UserProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {}
}

export const STATUS_CONFIG: Record<UserStatus, { label: string; color: string; icon: string }> = {
  online: { label: '在线', color: '#10b981', icon: 'circle-dot' },
  away: { label: '离开', color: '#f59e0b', icon: 'clock' },
  busy: { label: '忙碌', color: '#ef4444', icon: 'minus-circle' },
  dnd: { label: '请勿打扰', color: '#6b7280', icon: 'bell-off' },
}

export const useUserProfileStore = defineStore('user-profile', () => {
  const profile = ref<UserProfile>(loadProfile())

  const statusLabel = computed(() => {
    const cfg = STATUS_CONFIG[profile.value.status]
    return profile.value.customStatus || cfg.label
  })

  const statusColor = computed(() => STATUS_CONFIG[profile.value.status].color)

  function updateProfile(patch: Partial<UserProfile>) {
    profile.value = { ...profile.value, ...patch }
    saveProfile(profile.value)
  }

  function setStatus(status: UserStatus) {
    profile.value.status = status
    saveProfile(profile.value)
  }

  function setCustomStatus(text: string) {
    profile.value.customStatus = text
    saveProfile(profile.value)
  }

  function clearCustomStatus() {
    profile.value.customStatus = ''
    saveProfile(profile.value)
  }

  return {
    profile,
    statusLabel,
    statusColor,
    updateProfile,
    setStatus,
    setCustomStatus,
    clearCustomStatus,
  }
})
