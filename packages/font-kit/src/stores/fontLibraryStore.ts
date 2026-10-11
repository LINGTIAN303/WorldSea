import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  type FontLibraryEntry,
  restoreFromDB,
  removeFontData,
  MAX_FONT_STORAGE,
} from '../fontInstaller'
import { useFontStore, type FontLayer } from '@worldsea/entity-core'

const STORAGE_KEY = 'worldsea_font_library'

function loadFromStorage(): FontLibraryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as FontLibraryEntry[]
  } catch {
    return []
  }
}

function saveToStorage(entries: FontLibraryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export const useFontLibraryStore = defineStore('fontLibrary', () => {
  const entries = ref<FontLibraryEntry[]>(loadFromStorage())

  const totalSize = computed(() =>
    entries.value.reduce((sum, e) => sum + e.totalSize, 0),
  )

  const isOverCapacity = computed(() => totalSize.value > MAX_FONT_STORAGE)

  function addEntry(entry: FontLibraryEntry): { ok: boolean; reason?: string } {
    if (totalSize.value + entry.totalSize > MAX_FONT_STORAGE) {
      return { ok: false, reason: '超出字体存储容量上限' }
    }

    const idx = entries.value.findIndex((e) => e.id === entry.id)
    if (idx >= 0) {
      entries.value[idx] = entry
    } else {
      entries.value.push(entry)
    }

    saveToStorage(entries.value)
    return { ok: true }
  }

  async function removeEntry(
    id: string,
  ): Promise<{ ok: boolean; affectedLayers: FontLayer[] }> {
    const entry = entries.value.find((e) => e.id === id)
    if (!entry) {
      return { ok: false, affectedLayers: [] }
    }

    const affectedLayers = getUsedByLayers(entry.family)

    if (affectedLayers.length > 0) {
      const fontStore = useFontStore()
      for (const layer of affectedLayers) {
        fontStore.resetLayer(layer)
      }
    }

    await removeFontData(entry)

    entries.value = entries.value.filter((e) => e.id !== id)
    saveToStorage(entries.value)

    return { ok: true, affectedLayers }
  }

  function getEntry(id: string): FontLibraryEntry | undefined {
    return entries.value.find((e) => e.id === id)
  }

  function getEntryByFamily(family: string): FontLibraryEntry | undefined {
    return entries.value.find((e) => e.family === family)
  }

  function getAllEntries(): FontLibraryEntry[] {
    return entries.value
  }

  function getUsedByLayers(family: string): FontLayer[] {
    const fontStore = useFontStore()
    const layers: FontLayer[] = []
    const prefs = fontStore.prefs

    for (const layer of Object.keys(prefs) as FontLayer[]) {
      if (prefs[layer].family === family) {
        layers.push(layer)
      }
    }

    return layers
  }

  async function restoreAllFonts(): Promise<void> {
    let needsSave = false
    for (const entry of entries.value) {
      const oldFamily = entry.family
      await restoreFromDB(entry)
      // restoreFromDB 可能修复了旧版 ___probe___ family
      if (entry.family !== oldFamily) needsSave = true
    }
    if (needsSave) saveToStorage(entries.value)
  }

  return {
    entries,
    totalSize,
    isOverCapacity,
    addEntry,
    removeEntry,
    getEntry,
    getEntryByFamily,
    getAllEntries,
    getUsedByLayers,
    restoreAllFonts,
  }
})
