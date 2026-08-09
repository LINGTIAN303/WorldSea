import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FontCategoryToken, FontWeightToken, LetterSpacingToken } from '@worldsmith/font-kit'
import type { TextAnimationEffect } from '@worldsmith/font-kit'

export interface PersonaFontProfile {
  id: string
  name: string
  fontFamily: string
  fallbackFamily: string
  fontCategory: FontCategoryToken
  sizeScale: number
  weightDefault: FontWeightToken
  letterSpacing: LetterSpacingToken
  animationStyle: {
    messageEnter: TextAnimationEffect
    panelTransition: 'spring' | 'smooth' | 'snap'
    notificationStyle: 'pulse' | 'bounce' | 'wave'
  }
  accentColor: string
  fontSource?: {
    type: 'system' | 'wsfont' | 'url' | 'windfonts'
    path?: string
    weight?: string
  }
}

const BUILTIN_PROFILES: PersonaFontProfile[] = [
  {
    id: 'default',
    name: '默认助手',
    fontFamily: 'system-ui',
    fallbackFamily: 'sans-serif',
    fontCategory: 'base',
    sizeScale: 1.0,
    weightDefault: 'medium',
    letterSpacing: 'normal',
    animationStyle: { messageEnter: 'fadeIn', panelTransition: 'smooth', notificationStyle: 'pulse' },
    accentColor: '#6c5ce7',
  },
  {
    id: 'scholar',
    name: '学者',
    fontFamily: 'Georgia',
    fallbackFamily: 'serif',
    fontCategory: 'serif',
    sizeScale: 1.05,
    weightDefault: 'normal',
    letterSpacing: 'wide',
    animationStyle: { messageEnter: 'typewriter', panelTransition: 'spring', notificationStyle: 'pulse' },
    accentColor: '#4a6cf7',
  },
  {
    id: 'bard',
    name: '吟游诗人',
    fontFamily: 'Segoe Script',
    fallbackFamily: 'cursive',
    fontCategory: 'display',
    sizeScale: 1.1,
    weightDefault: 'semibold',
    letterSpacing: 'wider',
    animationStyle: { messageEnter: 'wave', panelTransition: 'spring', notificationStyle: 'bounce' },
    accentColor: '#e8a050',
  },
  {
    id: 'architect',
    name: '建筑师',
    fontFamily: 'Consolas',
    fallbackFamily: 'monospace',
    fontCategory: 'mono',
    sizeScale: 0.95,
    weightDefault: 'medium',
    letterSpacing: 'normal',
    animationStyle: { messageEnter: 'slideIn', panelTransition: 'snap', notificationStyle: 'pulse' },
    accentColor: '#00c8b4',
  },
]

const STORAGE_KEY = 'worldsmith_persona_font_profile'
const CUSTOM_PROFILES_KEY = 'worldsmith_persona_custom_profiles'

function loadProfileId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'default'
  } catch { return 'default' }
}

function saveProfileId(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch {}
}

function loadCustomProfiles(): PersonaFontProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROFILES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCustomProfiles(profiles: PersonaFontProfile[]) {
  try { localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(profiles)) } catch {}
}

export const usePersonaFontStore = defineStore('persona-font', () => {
  const activeProfileId = ref(loadProfileId())
  const customProfiles = ref<PersonaFontProfile[]>(loadCustomProfiles())

  const allProfiles = computed(() => [...BUILTIN_PROFILES, ...customProfiles.value])

  const activeProfile = computed<PersonaFontProfile>(() => {
    return allProfiles.value.find(p => p.id === activeProfileId.value) || BUILTIN_PROFILES[0]
  })

  function setActiveProfile(id: string) {
    activeProfileId.value = id
    saveProfileId(id)
  }

  function addCustomProfile(profile: PersonaFontProfile) {
    const idx = customProfiles.value.findIndex(p => p.id === profile.id)
    if (idx >= 0) customProfiles.value[idx] = profile
    else customProfiles.value.push(profile)
    saveCustomProfiles(customProfiles.value)
  }

  function removeCustomProfile(id: string) {
    customProfiles.value = customProfiles.value.filter(p => p.id !== id)
    saveCustomProfiles(customProfiles.value)
    if (activeProfileId.value === id) setActiveProfile('default')
  }

  return {
    activeProfileId,
    activeProfile,
    allProfiles,
    customProfiles,
    BUILTIN_PROFILES,
    setActiveProfile,
    addCustomProfile,
    removeCustomProfile,
  }
})
