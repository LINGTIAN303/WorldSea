<script setup lang="ts">
// 系统字体选择器（字体系统 v2 批 2）：懒扫描系统字体目录 → 搜索 → 点击安装入库。
// 安装复用 installFromRawFont 完整链（FontFace + IndexedDB），装完即入「字体分层」候选；
// 已在库内的系统字体显示「已装」。浏览器预览（无 Tauri）下按钮降级隐藏。
import { ref, computed } from 'vue'
import { useSystemFonts, useFontLibraryStore, type SystemFontInfo } from '@worldsea/font-kit'
import WsIcon from '../WsIcon.vue'
import WsInlineLoading from '../feedback/loading/WsInlineLoading.vue'

const { available, scanning, fonts, scan, installFont } = useSystemFonts()
const libraryStore = useFontLibraryStore()

const open = ref(false)
const query = ref('')
const installing = ref<string | null>(null)

/** 已入库 family 集合（含非系统来源） */
const installedFamilies = computed(() => new Set(libraryStore.getAllEntries().map((e) => e.family)))

/** 扫描结果按搜索词过滤（family 不区分大小写） */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return fonts.value
  return fonts.value.filter((f) => f.family.toLowerCase().includes(q))
})

/** 展开时懒扫描（一次；重复展开不重扫——可用「重新扫描」按钮强制） */
async function onToggle() {
  open.value = !open.value
  if (open.value && fonts.value.length === 0 && !scanning.value) {
    await scan()
  }
}

async function onPick(info: SystemFontInfo) {
  if (installing.value) return
  installing.value = info.family
  try {
    await installFont(info)
  } finally {
    installing.value = null
  }
}
</script>

<template>
  <div class="sfp-wrap">
    <button class="sfp-btn" :disabled="!available" :title="available ? '扫描本机已安装的字体并添加到字体库' : '仅桌面端可用'" @click="onToggle">
      <WsIcon name="search" size="xs" />
      <span>{{ open ? '收起系统字体' : '系统字体' }}</span>
      <WsInlineLoading v-if="scanning" size="sm" label="扫描中" />
    </button>
    <div v-if="open" class="sfp-panel">
      <input v-model="query" class="sfp-search" type="text" placeholder="搜索系统字体…" />
      <div v-if="!scanning && filtered.length === 0" class="sfp-empty">{{ fonts.length ? '无匹配的系统字体' : '未扫描到系统字体' }}</div>
      <div v-else class="sfp-list">
        <button
          v-for="f in filtered"
          :key="f.path + f.weight + f.style"
          class="sfp-item"
          :class="{ installed: installedFamilies.has(f.family) }"
          :title="f.family"
          @click="installedFamilies.has(f.family) ? undefined : onPick(f)"
        >
          <span class="sfp-item-name" :style="{ fontFamily: `'${f.family}'` }">{{ f.family }}</span>
          <span class="sfp-item-state">{{ installing === f.family ? '安装中…' : installedFamilies.has(f.family) ? '已装' : '添加' }}</span>
        </button>
      </div>
      <button v-if="open" class="sfp-rescan" @click="scan()">重新扫描</button>
    </div>
  </div>
</template>

<style scoped>
.sfp-wrap { margin-top: 6px; }
.sfp-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm, 6px); background: transparent; color: var(--text-secondary, var(--color-text-secondary)); cursor: pointer; font-size: var(--font-size-sm); }
.sfp-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent); }
.sfp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sfp-panel { margin-top: 8px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm, 6px); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.sfp-search { padding: 4px 8px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-xs, 4px); background: var(--bg, var(--color-bg-surface)); color: var(--text-primary); font-size: var(--font-size-sm); outline: none; }
.sfp-search:focus { border-color: var(--accent); }
.sfp-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.sfp-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 8px; border: none; border-radius: var(--radius-xs, 4px); background: transparent; cursor: pointer; text-align: left; }
.sfp-item:hover:not(.installed) { background: var(--bg-muted, var(--color-bg-muted, rgba(127,127,127,0.15))); }
.sfp-item.installed { cursor: default; opacity: 0.75; }
.sfp-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); color: var(--text-primary); }
.sfp-item-state { flex-shrink: 0; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
.sfp-item.installed .sfp-item-state { color: var(--accent); }
.sfp-empty { padding: 12px 0; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary, var(--color-text-tertiary)); }
.sfp-rescan { align-self: flex-start; border: none; background: transparent; color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; font-size: var(--font-size-xs); padding: 0; }
.sfp-rescan:hover { color: var(--text-secondary); }
</style>
