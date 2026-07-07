import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'
import {
  type FontEntry,
  type FontQuery,
  type FontSource,
  register as _register,
  unregister as _unregister,
  get as _get,
  list as _list,
  findByFamily as _findByFamily,
  query as _query,
  subscribe,
} from '../FontRegistry'
import {
  loadFont,
  loadFontFromDB,
  unloadFont,
  persistToDB,
  removeFromDB,
  listDBKeys,
} from '../FontLoader'

export type { FontEntry, FontQuery, FontSource }

export interface UseFontRegistryReturn {
  fonts: ReturnType<typeof readonly<ReturnType<typeof ref<FontEntry[]>>>>
  register: (id: string, family: string, weight: number, style: string, source: FontSource) => FontEntry
  load: (id: string) => Promise<FontEntry>
  loadFromDB: (id: string) => Promise<FontEntry | null>
  unload: (id: string) => Promise<void>
  remove: (id: string) => boolean
  get: (id: string) => FontEntry | undefined
  findByFamily: (family: string) => FontEntry[]
  query: (q: FontQuery) => FontEntry[]
  persist: (id: string, buffer: ArrayBuffer) => Promise<void>
  removeFromDB: (id: string) => Promise<void>
  listDBKeys: () => Promise<string[]>
}

export function useFontRegistry(): UseFontRegistryReturn {
  const fonts = ref<FontEntry[]>(_list())

  const stopListen = subscribe(() => {
    fonts.value = _list()
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopListen()
    })
  }

  function register(
    id: string,
    family: string,
    weight: number,
    style: string,
    source: FontSource,
  ): FontEntry {
    return _register({ id, family, weight, style, source })
  }

  function remove(id: string): boolean {
    return _unregister(id)
  }

  return {
    fonts: readonly(fonts),
    register,
    load: loadFont,
    loadFromDB: loadFontFromDB,
    unload: unloadFont,
    remove,
    get: _get,
    findByFamily: _findByFamily,
    query: _query,
    persist: persistToDB,
    removeFromDB,
    listDBKeys,
  }
}
