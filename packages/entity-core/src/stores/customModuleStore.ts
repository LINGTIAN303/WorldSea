import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CustomModule } from '../types'

const STORAGE_KEY = 'worldsea_custom_modules'

function loadModules(): CustomModule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveModules(modules: CustomModule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modules))
}

export const useCustomModuleStore = defineStore('customModule', () => {
  const modules = ref<CustomModule[]>(loadModules())

  function addModule(mod: CustomModule) {
    modules.value.push(mod)
    saveModules(modules.value)
  }

  function updateModule(id: string, changes: Partial<CustomModule>) {
    const idx = modules.value.findIndex(m => m.id === id)
    if (idx === -1) return
    modules.value[idx] = { ...modules.value[idx], ...changes, updatedAt: new Date().toISOString() }
    saveModules(modules.value)
  }

  function removeModule(id: string) {
    modules.value = modules.value.filter(m => m.id !== id)
    saveModules(modules.value)
  }

  function getModule(id: string): CustomModule | undefined {
    return modules.value.find(m => m.id === id)
  }

  return { modules, addModule, updateModule, removeModule, getModule }
})
