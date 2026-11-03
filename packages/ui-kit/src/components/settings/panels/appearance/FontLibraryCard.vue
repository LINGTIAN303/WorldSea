<template>
  <!-- 字体库（卡 3）：导入 / 预览导出 / 已装字体列表（无分组 + 按 ZIP 分组） -->
  <div class="sc-head">字体库</div>
  <div class="sf-library-header">
    <button class="sf-import-btn" :class="{ 'is-busy': importingFont }" :disabled="importingFont" @click="onFontImport">
      <WsInlineLoading v-if="importingFont" size="sm" label="正在安装字体" />
      <span>{{ importingFont ? '安装中' : '导入字体' }}</span>
    </button>
    <span class="sf-storage-hint">{{ fontStorageHint }}</span>
  </div>
  <div class="sf-lib-actions">
    <SystemFontPicker />
    <button class="sf-preview-btn" title="把已装字体渲染为图片并导出 PNG/JPEG/WebP" @click="previewOpen = true">
      <WsIcon name="type" size="xs" />
      <span>预览与导出</span>
    </button>
  </div>
  <FontPreviewPanel v-model:visible="previewOpen" />
  <div v-if="fontLibraryEntries.length === 0" class="set-hint" style="padding:12px 0">尚未安装字体，点击"导入字体"添加</div>
  <div v-else class="sf-library-list">
    <!-- 无分组的独立字体 -->
    <div v-for="entry in standaloneEntries" :key="entry.id" class="sf-lib-card">
      <div class="sf-lib-info">
        <span class="sf-lib-name">{{ entry.displayName }}</span>
        <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
      </div>
      <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
      <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
      <button class="sf-lib-delete" @click="onFontDelete(entry.id)" title="删除字体">✕</button>
    </div>
    <!-- 按 ZIP 分组 -->
    <div v-for="group in fontGroups" :key="group.groupId" class="sf-lib-group">
      <div class="sf-lib-group-header">
        <WsIcon name="package" size="xs" />
        <span class="sf-lib-group-name">{{ group.groupName }}</span>
        <span class="sf-lib-group-count">{{ group.entries.length }} 字体</span>
        <button class="sf-lib-group-delete" @click="onFontGroupDelete(group.groupId)" title="删除整组">✕</button>
      </div>
      <div v-for="entry in group.entries" :key="entry.id" class="sf-lib-card sf-lib-card--grouped">
        <div class="sf-lib-info">
          <span class="sf-lib-name">{{ entry.displayName }}</span>
          <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
        </div>
        <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
        <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { pickLocalBuffers } from '@worldsea/entity-core'
import { useFontLibraryStore, type FontLibraryEntry } from '@worldsea/font-kit'
import { installFromWsfont, installFromRawFont, installFromZip } from '@worldsea/font-kit'
import WsIcon from '../../../WsIcon.vue'
import SystemFontPicker from '../../../font/SystemFontPicker.vue'
import FontPreviewPanel from '../../../font/FontPreviewPanel.vue'
import WsInlineLoading from '../../../feedback/loading/WsInlineLoading.vue'
import { toastSuccess, toastWarn } from '@worldsea/ui-kit'
import { sourceLabel, formatSize } from '../../utils'

const emit = defineEmits<{ dirty: [] }>()

const libraryStore = useFontLibraryStore()
// 字体预览与导出弹层开关
const previewOpen = ref(false)
const importingFont = ref(false)
const fontLibraryEntries = computed(() => libraryStore.getAllEntries())

const standaloneEntries = computed(() =>
  fontLibraryEntries.value.filter(e => !e.groupId),
)

interface FontGroup {
  groupId: string
  groupName: string
  entries: FontLibraryEntry[]
}

const fontGroups = computed<FontGroup[]>(() => {
  const map = new Map<string, FontGroup>()
  for (const e of fontLibraryEntries.value) {
    if (!e.groupId || !e.groupName) continue
    let group = map.get(e.groupId)
    if (!group) {
      group = { groupId: e.groupId, groupName: e.groupName, entries: [] }
      map.set(e.groupId, group)
    }
    group.entries.push(e)
  }
  return Array.from(map.values())
})

const fontStorageHint = computed(() => {
  const used = libraryStore.totalSize
  return `${(used / 1024 / 1024).toFixed(1)} MB / 400 MB`
})

async function onFontDelete(id: string) {
  const result = await libraryStore.removeEntry(id)
  if (result.ok && result.affectedLayers.length > 0) {
    toastSuccess(`已删除字体，${result.affectedLayers.join('、')}层已重置为默认`)
  } else if (result.ok) {
    toastSuccess('已删除字体')
  }
}

async function onFontGroupDelete(groupId: string) {
  const groupEntries = fontLibraryEntries.value.filter(e => e.groupId === groupId)
  if (groupEntries.length === 0) return
  const allAffectedLayers: string[] = []
  for (const entry of groupEntries) {
    const result = await libraryStore.removeEntry(entry.id)
    if (result.ok && result.affectedLayers.length > 0) {
      allAffectedLayers.push(...result.affectedLayers)
    }
  }
  const layerInfo = allAffectedLayers.length > 0 ? `，${[...new Set(allAffectedLayers)].join('、')}层已重置` : ''
  toastSuccess(`已删除整组字体（${groupEntries.length} 个）${layerInfo}`)
}

const FONT_MAX_BYTES = 200 * 1024 * 1024

/**
 * 导入字体：走 asset 协议大文件通道（不经 base64 IPC，200MB 上限得以保住）。
 * 原实现用 `<input type="file">` + `file.arrayBuffer()`，与自绘选择器统一后
 * 体积改由选择器 maxBytes 前置拦截。
 */
async function onFontImport() {
  if (importingFont.value) return
  const picked = await pickLocalBuffers({
    multiple: false,
    title: '导入字体',
    filters: [{ name: '字体（wsfont / TTF / OTF / WOFF / ZIP）', extensions: ['wsfont', 'ttf', 'otf', 'woff', 'woff2', 'zip'] }],
    maxBytes: FONT_MAX_BYTES,
  })
  if (picked.cancelled) return
  const buffer = picked.items[0]
  const path = picked.paths[0] ?? ''
  if (!buffer) {
    toastWarn(picked.reasons[0] ?? '字体文件读取失败')
    return
  }
  const fileName = path.split(/[\\/]/).pop() ?? ''
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  importingFont.value = true
  try {
    if (ext === 'zip') {
      const { entries } = await installFromZip(buffer, fileName)
      let installed = 0
      for (const entry of entries) {
        if (libraryStore.addEntry(entry).ok) installed++
      }
      toastSuccess(`已从 ZIP 安装 ${installed} 个字体`)
      return
    }
    let entry: FontLibraryEntry | undefined
    if (ext === 'wsfont') {
      entry = (await installFromWsfont(buffer)).entry
    } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
      entry = (await installFromRawFont(buffer, fileName)).entry
    }
    if (!entry) return void toastWarn('不支持的字体格式')
    const result = libraryStore.addEntry(entry)
    if (result.ok) toastSuccess(`已安装字体: ${entry.displayName}`)
    else toastWarn(result.reason || '安装失败')
  } catch (err) {
    toastWarn(err instanceof Error ? err.message : '字体安装失败，请确认文件格式正确')
  } finally {
    importingFont.value = false
  }
}
</script>
