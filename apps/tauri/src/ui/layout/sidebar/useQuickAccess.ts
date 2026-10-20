import { computed, ref, watch } from 'vue'

const FAVORITES_KEY = 'worldsea_sprout_favorites'
const RECENT_KEY = 'worldsea_sprout_recent'
const RECENT_LIMIT = 5

function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  } catch {
    return []
  }
}

function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch { /* quota exceeded, 静默 */ }
}

// 模块级单例：两个侧栏入口共用同一份收藏/最近状态
const favorites = ref<string[]>(loadIds(FAVORITES_KEY))
const recent = ref<string[]>(loadIds(RECENT_KEY).slice(0, RECENT_LIMIT))

watch(favorites, ids => saveIds(FAVORITES_KEY, ids), { deep: true })
watch(recent, ids => saveIds(RECENT_KEY, ids), { deep: true })

export function useQuickAccess() {
  const favoriteSet = computed(() => new Set(favorites.value))

  function isFavorite(id: string | null | undefined): boolean {
    return !!id && favoriteSet.value.has(id)
  }

  function toggleFavorite(id: string | null | undefined) {
    if (!id) return
    favorites.value = isFavorite(id)
      ? favorites.value.filter(item => item !== id)
      : [id, ...favorites.value.filter(item => item !== id)]
  }

  /** 最近访问：最新在前、去重、上限 5；收藏不从中移除，展示层去重。 */
  function recordRecent(id: string | null | undefined) {
    if (!id) return
    recent.value = [id, ...recent.value.filter(item => item !== id)].slice(0, RECENT_LIMIT)
  }

  return { favorites, recent, isFavorite, toggleFavorite, recordRecent }
}
