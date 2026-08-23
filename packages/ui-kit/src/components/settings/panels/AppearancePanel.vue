<template>
  <CardDeck :count="4" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('主题 theme 外观 深色 浅色 极光 锻造 水墨 棱镜 宇宙 编辑器') : idx === 1 ? match('高亮 highlight 脉冲 动画 淡化 扩散 透明度') : true">
        <!-- 主题 -->
        <template v-if="idx === 0">
          <div class="sc-head">主题</div>
          <div class="set-theme-row">
            <button v-for="t in themes" :key="t.id" class="set-theme-btn" :class="{ on: currentThemeId === t.id }" @click="onThemeChange(t.id)">
              <WsIcon :name="t.icon" size="md" class="st-icon" />
              <span class="st-label">{{ t.label }}</span>
            </button>
          </div>
          <button class="set-theme-editor-btn" @click="openThemeEditor">
            <WsIcon name="theme-editor" size="xs" /> 主题编辑器
          </button>
        </template>
        <!-- 高亮 -->
        <template v-else-if="idx === 1">
          <div class="sc-head">高亮</div>
          <div class="set-row"><span>脉冲动画</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_pulseEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row"><span>启用淡化</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_dimmingEnabled" /><span class="set-toggle-slider"></span></label></div>
          <template v-if="store.highlight_dimmingEnabled">
            <div class="set-row"><span>淡化模式</span><select v-model="store.highlight_dimmingMode" class="set-select"><option value="simple">简单淡化</option><option value="spread">关系扩散</option></select></div>
            <div class="set-row"><span>淡化透明度</span><div class="set-range-wrap"><input type="range" min="0.1" max="0.5" step="0.05" v-model.number="store.highlight_dimOpacity" class="set-range" /><span class="set-range-val">{{ store.highlight_dimOpacity }}</span></div></div>
            <div v-if="store.highlight_dimmingMode === 'spread'" class="set-row"><span>扩散跳数</span><select v-model.number="store.highlight_spreadHops" class="set-select"><option :value="1">1 跳</option><option :value="2">2 跳</option><option :value="3">3 跳</option></select></div>
          </template>
        </template>
        <!-- 字体库 -->
        <template v-else-if="idx === 2">
          <div class="sc-head">字体库</div>
          <div class="sf-library-header">
            <label class="sf-import-btn">
              导入字体
              <input type="file" accept=".wsfont,.ttf,.otf,.woff,.woff2,.zip" @change="onFontImport" style="display:none" />
            </label>
            <span class="sf-storage-hint">{{ fontStorageHint }}</span>
          </div>
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
        <!-- 字体分层 -->
        <template v-else>
          <div class="sc-head">字体分层</div>
          <div class="set-hint" style="margin-bottom:8px">每层字体可独立设置，未设置则跟随上层默认值</div>
          <div v-for="fl in FONT_LAYERS" :key="fl.key" class="sf-layer-row">
            <div class="sf-layer-main">
              <span class="sf-layer-label">{{ fl.label }}<span class="set-hint-inline">{{ fl.hint }}</span></span>
              <div class="sf-layer-controls">
                <select class="set-select" :value="fontStore.prefs[fl.key].family" @change="onFontLayerChange(fl.key, ($event.target as HTMLSelectElement).value)">
                  <option value="">默认</option>
                  <option v-for="e in fontLibraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
                </select>
                <button class="sf-reset-btn" v-if="fontStore.prefs[fl.key].family" @click="fontStore.resetLayer(fl.key)" title="重置为默认">↺</button>
              </div>
            </div>
            <div v-if="fontStore.prefs[fl.key].family && getVariantsForFamily(fontStore.prefs[fl.key].family).length > 1" class="sf-layer-variants">
              <select class="set-select set-select--sm" :value="variantKey(fontStore.prefs[fl.key])" @change="onVariantChange(fl.key, ($event.target as HTMLSelectElement).value)">
                <option v-for="v in getVariantsForFamily(fontStore.prefs[fl.key].family)" :key="`${v.weight}-${v.style}`" :value="`${v.weight}-${v.style}`">{{ weightLabel(v.weight) }} {{ v.style === 'italic' ? '斜体' : '' }}</option>
              </select>
            </div>
          </div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettingsStore, useTheme, useFontStore, type FontLayer } from '@worldsmith/entity-core'
import { useFontPresets, useFontLibraryStore, type FontLibraryEntry, type FontVariantEntry } from '@worldsmith/font-kit'
import { installFromWsfont, installFromRawFont, installFromZip } from '@worldsmith/font-kit'
import WsIcon from '../../WsIcon.vue'
import { toastSuccess, CardDeck } from '@worldsmith/ui-kit'
import { matchKeywords, FONT_LAYERS, weightLabel, sourceLabel, formatSize } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

// ── 叠放翻卡：复用通用 CardDeck（翻卡逻辑/样式已下沉 ui-kit useCardDeck + CardDeck.vue） ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const store = useSettingsStore()
const { currentThemeId } = useTheme()
const fontStore = useFontStore()
const { getPresetByFamily, markInstalled } = useFontPresets()
const libraryStore = useFontLibraryStore()
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

// 预设主题：id 保留给 entity-core currentThemeId 追踪（active 高亮）；
// mode 映射到 App 壳三态（唯一 data-theme 控制源，避免命名 id 写入 data-theme 破坏明暗）；
// accent 为令牌风味（写 --accent 覆盖，与圆角/密度合并）。通过 ws-set-theme 事件交由 App 壳落地。
const themes = [
  { id: 'aurora-abyss', icon: 'theme-aurora-abyss', label: '极光深渊', mode: 'dark', accent: '#8b5cf6' },
  { id: 'light', icon: 'theme-light', label: '明亮', mode: 'light', accent: '#4a6cf7' },
  { id: 'forge-ember', icon: 'theme-forge-ember', label: '锻造炉', mode: 'dark', accent: '#c87830' },
  { id: 'ink-scroll', icon: 'theme-ink-scroll', label: '水墨卷轴', mode: 'light', accent: '#2a2018' },
  { id: 'crystal-prism', icon: 'theme-crystal-prism', label: '晶体棱镜', mode: 'dark', accent: '#64b4ff' },
  { id: 'cosmic', icon: 'theme-cosmic', label: '宇宙', mode: 'dark', accent: '#a855f7' },
]

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function onThemeChange(id: string) {
  const t = themes.find(x => x.id === id)
  // 交由 App 壳落地（data-theme 唯一控制源）：App 监听 ws-set-theme → setMode + setUserOverrides
  window.dispatchEvent(new CustomEvent('ws-set-theme', { detail: { id, mode: t?.mode ?? 'dark', accent: t?.accent } }))
  emit('dirty')
}

function openThemeEditor() {
  window.dispatchEvent(new CustomEvent('ws-open-theme-editor'))
}

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

function onFontLayerChange(layer: FontLayer, family: string) {
  fontStore.setLayerFont(layer, family)
  if (family) {
    const preset = getPresetByFamily(family)
    if (preset) markInstalled(preset.id)
  }
}

function getVariantsForFamily(family: string): FontVariantEntry[] {
  const entry = fontLibraryEntries.value.find(e => e.family === family)
  return entry?.variants ?? []
}

function variantKey(pref: { weight: number; style: string }): string {
  return `${pref.weight}-${pref.style}`
}

function onVariantChange(layer: FontLayer, key: string) {
  const [w, s] = key.split('-')
  fontStore.setLayerVariant(layer, Number(w), s)
}

function onFontImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 200 * 1024 * 1024) {
    toastSuccess(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)} MB)，上限 200 MB`)
    input.value = ''
    return
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  ;(async () => {
    try {
      const buffer = await file.arrayBuffer()

      if (ext === 'zip') {
        const { entries } = await installFromZip(buffer, file.name)
        let installed = 0
        for (const entry of entries) {
          const result = libraryStore.addEntry(entry)
          if (result.ok) installed++
        }
        toastSuccess(`已从 ZIP 安装 ${installed} 个字体`)
      } else {
        let entry: FontLibraryEntry | undefined

        if (ext === 'wsfont') {
          const result = await installFromWsfont(buffer)
          entry = result.entry
        } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
          const result = await installFromRawFont(buffer, file.name)
          entry = result.entry
        }

        if (entry) {
          const result = libraryStore.addEntry(entry)
          if (result.ok) {
            toastSuccess(`已安装字体: ${entry.displayName}`)
          } else {
            toastSuccess(result.reason || '安装失败')
          }
        } else {
          toastSuccess('不支持的字体格式')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '字体安装失败，请确认文件格式正确'
      toastSuccess(msg)
    }
  })()
  input.value = ''
}
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin: -2px 0 4px; }
.set-hint-inline { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: normal; }

.set-theme-row { display: flex; gap: 6px; }
.set-theme-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 1px solid var(--border, var(--color-border)); border-radius: 8px; background: var(--bg, var(--color-bg-surface)); cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.set-theme-btn:hover { border-color: var(--primary, var(--color-primary)); }
.set-theme-btn.on { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.st-icon { font-size: var(--font-size-xl); }
.st-label { font-size: var(--font-size-xs); color: var(--text-secondary); }
.set-theme-editor-btn {
  margin-top: 8px; width: 100%; padding: 8px 12px; border: 1px dashed var(--border, var(--color-border));
  border-radius: 8px; background: transparent; cursor: pointer; font-size: var(--font-size-sm);
  color: var(--text-secondary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; text-align: center;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.set-theme-editor-btn:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }

.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }

.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }
.set-select--sm { max-width: 160px; font-size: var(--fs-sm); padding: 3px 6px; }

/* ── 字体设置面板 ── */
.sf-layer-label { display: flex; flex-direction: column; gap: 2px; }
.sf-layer-controls { display: flex; align-items: center; gap: 6px; }
.sf-reset-btn {
  width: 24px; height: 24px; border: none; background: transparent;
  cursor: pointer; border-radius: 4px; font-size: var(--font-size-sm);
  color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.sf-reset-btn:hover { background: var(--hover-bg); color: var(--primary); }
.sf-layer-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; }
.sf-layer-main { display: flex; align-items: center; justify-content: space-between; }
.sf-layer-variants { padding-left: 120px; }

.sf-import-btn {
  display: inline-block; padding: 6px 14px; border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary);
  transition: border-color 0.15s, color 0.15s;
}
.sf-import-btn:hover { border-color: var(--primary); color: var(--primary); }

.sf-library-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sf-storage-hint { font-size: var(--fs-sm); color: var(--color-text-muted); }
.sf-library-list { display: flex; flex-direction: column; gap: 8px; }
.sf-lib-card {
  position: relative; padding: 10px 12px; border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: var(--color-surface);
}
.sf-lib-info { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.sf-lib-name { font-weight: 500; }
.sf-lib-source { font-size: var(--fs-xs); padding: 1px 6px; border-radius: 3px; background: var(--color-surface-hover); }
.sf-lib-source[data-source="wsfont"] { color: #5b8def; }
.sf-lib-source[data-source="raw"] { color: #8a8a8a; }
.sf-lib-source[data-source="windfonts"] { color: #4caf50; }
.sf-lib-source[data-source="preset"] { color: #9c6ade; }
.sf-lib-source[data-source="zip"] { color: #e8a838; }
.sf-lib-preview { font-size: var(--fs-base); margin: 4px 0; color: var(--color-text-secondary); }
.sf-lib-meta { font-size: var(--fs-xs); color: var(--color-text-muted); }
.sf-lib-delete {
  position: absolute; top: 8px; right: 8px; background: none; border: none;
  cursor: pointer; color: var(--color-text-muted); font-size: var(--fs-base); padding: 2px 4px; border-radius: 3px;
}
.sf-lib-delete:hover { color: var(--color-danger); background: var(--color-surface-hover); }
.sf-lib-group { margin-top: 8px; border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
.sf-lib-group-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: var(--color-surface-hover); border-bottom: 1px solid var(--color-border);
  font-size: var(--fs-md); font-weight: 500;
}
.sf-lib-group-name { flex: 1; }
.sf-lib-group-count { font-size: var(--fs-xs); color: var(--color-text-muted); font-weight: 400; }
.sf-lib-group-delete {
  background: none; border: none; cursor: pointer; color: var(--color-text-muted);
  font-size: var(--fs-base); padding: 2px 4px; border-radius: 3px;
}
.sf-lib-group-delete:hover { color: var(--color-danger); background: var(--color-surface); }
.sf-lib-card--grouped { border: none; border-radius: 0; border-bottom: 1px solid var(--color-border-subtle); }
.sf-lib-card--grouped:last-child { border-bottom: none; }
</style>
