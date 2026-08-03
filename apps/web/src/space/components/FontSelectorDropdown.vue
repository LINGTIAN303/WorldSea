<template>
  <div class="font-selector" v-if="visible">
    <div class="selector-header">
      <span class="selector-title">选择字体</span>
      <button class="selector-close" @click="emit('close')">✕</button>
    </div>
    <div class="selector-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'online' }"
        @click="activeTab = 'online'"
      >在线字库</button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'system' }"
        @click="activeTab = 'system'"
      >系统字体</button>
    </div>
    <div class="selector-search">
      <input v-model="searchQuery" class="search-input" placeholder="搜索字体..." />
    </div>
    <div class="selector-list">
      <template v-if="activeTab === 'online'">
        <div
          v-for="font in filteredOnlineFonts"
          :key="font.fontFamily"
          class="font-item"
          :class="{ active: font.fontFamily === modelValue }"
          @click="onOnlineFontSelect(font)"
        >
          <div class="font-item-info">
            <span class="font-name">{{ font.name }}</span>
            <span class="font-name-en">{{ font.englishName }}</span>
          </div>
          <div class="font-item-meta">
            <span class="font-tag" v-if="font.licenseType">{{ font.licenseType }}</span>
            <span class="font-category">{{ font.categoryName }}</span>
          </div>
        </div>
        <div v-if="onlineLoading" class="font-empty">加载在线字库...</div>
        <div v-else-if="onlineError" class="font-empty font-hint">{{ onlineError }}</div>
        <div v-else-if="filteredOnlineFonts.length === 0" class="font-empty font-hint">
          {{ searchQuery ? '未找到匹配字体' : '在线字库是一个正在建设中的平台。' }}
        </div>
      </template>
      <template v-else>
        <div
          v-for="font in filteredSystemFonts"
          :key="font.family"
          class="font-item"
          :class="{ active: font.family === modelValue }"
          @click="emit('update:modelValue', font.family)"
        >
          <span class="font-name" :style="{ fontFamily: font.family }">{{ font.family }}</span>
          <span class="font-variants">{{ font.variants }} 变体</span>
        </div>
        <div v-if="filteredSystemFonts.length === 0" class="font-empty">
          {{ searchQuery ? '未找到匹配字体' : '加载中...' }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { list, scanSystemFonts } from '@worldsmith/font-kit'

interface WindFontsItem {
  fontFamily: string
  name: string
  englishName: string
  categoryName: string
  licenseType: string
  weightKeys: string[]
}

defineProps<{
  visible: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  close: []
  'update:modelValue': [family: string]
  'select-windfonts': [font: WindFontsItem]
}>()

const activeTab = ref<'online' | 'system'>('online')
const searchQuery = ref('')
const onlineFonts = ref<WindFontsItem[]>([])
const onlineLoading = ref(false)
const onlineError = ref('')
const registeredFonts = ref<Array<{ family: string; variants: number }>>([])
const systemFontFamilies = ref<Array<{ family: string; variants: number }>>([])

let fetchPromise: Promise<void> | null = null

async function fetchOnlineFonts() {
  if (fetchPromise) return fetchPromise
  if (onlineFonts.value.length > 0) return
  onlineLoading.value = true
  onlineError.value = ''
  fetchPromise = (async () => {
    try {
      let page = 1
      let allFonts: any[] = []
      let hasMore = true
      while (hasMore) {
        const res = await fetch(`https://app.windfonts.com/api/fonts?page=${page}&size=100`)
        const json = await res.json()
        if (json.code !== 200) {
          if (page === 1) onlineError.value = '在线字库是一个正在建设中的平台。'
          break
        }
        const dataList = json.data?.dataList || []
        allFonts = allFonts.concat(dataList)
        hasMore = allFonts.length < (json.data?.total || 0)
        page++
      }
      onlineFonts.value = allFonts.map((f: any) => ({
        fontFamily: f.fontFamily,
        name: f.name || f.chineseName || f.fontFamily,
        englishName: f.englishName || '',
        categoryName: f.fontCategory || f.category?.name || '',
        licenseType: f.licenseType || '',
        weightKeys: f.weights ? Object.keys(f.weights) : ['Regular'],
      }))
    } catch {
      onlineError.value = '在线字库是一个正在建设中的平台。'
    } finally {
      onlineLoading.value = false
      fetchPromise = null
    }
  })()
  return fetchPromise
}

function onOnlineFontSelect(font: WindFontsItem) {
  emit('select-windfonts', font)
}

onMounted(async () => {
  fetchOnlineFonts()
  try {
    const fonts = list()
    const familyMap = new Map<string, number>()
    for (const f of fonts) {
      familyMap.set(f.family, (familyMap.get(f.family) || 0) + 1)
    }
    registeredFonts.value = Array.from(familyMap.entries()).map(([family, variants]) => ({ family, variants }))
  } catch {}
  try {
    const sysFonts = await scanSystemFonts()
    const familyMap = new Map<string, number>()
    for (const f of sysFonts) {
      familyMap.set(f.family, (familyMap.get(f.family) || 0) + 1)
    }
    systemFontFamilies.value = Array.from(familyMap.entries()).map(([family, variants]) => ({ family, variants }))
  } catch {}
})

const filteredOnlineFonts = computed(() => {
  if (!searchQuery.value) return onlineFonts.value
  const q = searchQuery.value.toLowerCase()
  return onlineFonts.value.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.englishName.toLowerCase().includes(q) ||
    f.fontFamily.toLowerCase().includes(q) ||
    f.categoryName.toLowerCase().includes(q)
  )
})

const allSystemFamilies = computed(() => {
  const families = new Map<string, number>()
  for (const f of registeredFonts.value) {
    families.set(f.family, f.variants)
  }
  for (const f of systemFontFamilies.value) {
    if (!families.has(f.family)) families.set(f.family, f.variants)
  }
  return Array.from(families.entries()).map(([family, variants]) => ({ family, variants }))
})

const filteredSystemFonts = computed(() => {
  if (!searchQuery.value) return allSystemFamilies.value
  const q = searchQuery.value.toLowerCase()
  return allSystemFamilies.value.filter(f => f.family.toLowerCase().includes(q))
})
</script>

<style scoped>
.font-selector {
  width: 360px;
  max-height: 480px;
  background: var(--color-surface-elevated);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}
.selector-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.selector-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.selector-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.selector-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 14px 0;
}
.tab-btn {
  flex: 1;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 500;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  border-bottom: 2px solid transparent;
}
.tab-btn:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: var(--color-surface);
}
.selector-search {
  padding: 8px 14px;
}
.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--font-size-xs);
  background: var(--color-surface);
  color: var(--color-text);
}
.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
}
.selector-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  min-height: 200px;
}
.font-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 8px;
}
.font-item:hover {
  background: var(--color-surface);
}
.font-item.active {
  background: var(--color-primary-muted);
}
.font-item-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.font-name {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.font-name-en {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.font-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.font-tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--color-primary-muted);
  color: var(--color-primary);
  white-space: nowrap;
}
.font-category {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
.font-variants {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}
.font-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 24px;
  font-size: var(--font-size-sm);
}
.font-hint {
  color: var(--color-text-tertiary);
  font-style: italic;
}
</style>
