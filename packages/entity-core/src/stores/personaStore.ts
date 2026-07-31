import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface SavedPersona {
  id: string
  entityId: string
  entityName: string
  entityType: string
  snapshot: Record<string, unknown>
  savedAt: string
}

const STORAGE_KEY = 'worldsmith_saved_personas'

function loadPersonas(): SavedPersona[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function savePersonas(personas: SavedPersona[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personas))
}

export const usePersonaStore = defineStore('persona', () => {
  const savedPersonas = ref<SavedPersona[]>(loadPersonas())

  function addPersona(persona: Omit<SavedPersona, 'id' | 'savedAt'>) {
    const entry: SavedPersona = {
      ...persona,
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
    }
    savedPersonas.value = [...savedPersonas.value, entry]
    savePersonas(savedPersonas.value)
    return entry.id
  }

  function removePersona(id: string) {
    savedPersonas.value = savedPersonas.value.filter(p => p.id !== id)
    savePersonas(savedPersonas.value)
  }

  function getByEntityId(entityId: string): SavedPersona | undefined {
    return savedPersonas.value.find(p => p.entityId === entityId)
  }

  return { savedPersonas, addPersona, removePersona, getByEntityId }
})
