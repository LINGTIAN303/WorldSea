<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx" v-show="match('快捷键 keyboard shortcut 键盘')">
        <div class="sc-head">快捷键</div>
        <div class="set-hint" style="margin-bottom:8px">点击快捷键开始记录，按下新的组合键即可修改（Esc 取消录制）</div>
        <div v-if="tip" class="ss-tip" :class="tip.type">{{ tip.text }}</div>
        <div v-for="grp in shortcutGroups" :key="grp.scope" v-show="match('快捷键 ' + scopeLabel(grp.scope))" class="ss-group">
          <h5 class="ss-scope">{{ scopeLabel(grp.scope) }}</h5>
          <div v-for="s in grp.items" :key="s.id" v-show="match(s.description + ' ' + s.id)" class="ss-row">
            <span class="ss-desc">{{ s.description }}</span>
            <div class="ss-keys-area">
              <span v-if="recording !== s.id" class="ss-keys" @click="startRecord(s.id)">
                <kbd v-for="k in getDisplayKeys(s)" :key="k" class="ss-kbd">{{ fmt(k) }}</kbd>
                <span class="ss-edit-icon"><WsIcon name="edit" size="xs" /></span>
              </span>
              <span v-else class="ss-recording" @click="cancelRecord">按下新的组合键...</span>
              <button v-if="hasOverride(s.id)" class="ss-reset" @click.stop="resetKey(s.id)">↺</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { CardDeck } from '@worldsmith/ui-kit'
import { useShortcuts, normalizeKeys, formatKeyForDisplay } from '@worldsmith/ui-kit'
import WsIcon from '../../WsIcon.vue'
import { matchKeywords, SHORTCUT_CATALOG, SCOPE_ORDER, scopeLabel, type ShortcutItem } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const { setShortcut, resetShortcut, getRegisteredKeys, getDefaultKeys } = useShortcuts()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

/** 展示清单=目录（元数据）；键位权威在 registry（注册处声明 + 用户覆盖） */
const allShortcuts = computed(() => SHORTCUT_CATALOG)
const catalogById = new Map(SHORTCUT_CATALOG.map(s => [s.id, s]))

const shortcutGroups = computed(() => {
  return SCOPE_ORDER
    .map(scope => ({
      scope,
      items: allShortcuts.value.filter(s => s.scope === scope),
    }))
    .filter(g => g.items.length > 0)
})

const recording = ref<string | null>(null)
const tip = ref<{ type: 'error' | 'warn'; text: string } | null>(null)

function fmt(k: string): string {
  return formatKeyForDisplay(k)
}

function getDisplayKeys(s: ShortcutItem): string[] {
  return getRegisteredKeys(s.id) ?? s.keys
}

function hasOverride(id: string): boolean {
  const reg = getRegisteredKeys(id)
  const def = getDefaultKeys(id)
  if (!reg || !def) return false
  return JSON.stringify([...reg].sort()) !== JSON.stringify([...def].sort())
}

function startRecord(id: string) {
  const s = catalogById.get(id)
  if (s && getRegisteredKeys(s.id) === null) {
    tip.value = { type: 'warn', text: `「${s.description}」所属视图未激活，激活该视图后才能修改` }
    return
  }
  tip.value = null
  recording.value = id
}

function cancelRecord() {
  recording.value = null
}

function resetKey(id: string) {
  resetShortcut(id)
  tip.value = null
  emit('dirty')
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!recording.value) return
  // capture 阶段拦截：阻止按键流入 useShortcuts 的冒泡分发器，录制期间不触发已注册快捷键
  e.preventDefault()
  e.stopPropagation()

  const keys = normalizeKeys(e)
  // 修饰键单独按下不结束录制，等待完整组合
  if (keys.length === 0) return
  // Esc = 取消录制（同时避免把 Esc 误录为键位，破坏所在浮层的关闭行为）
  if (keys.length === 1 && keys[0] === 'escape') {
    cancelRecord()
    return
  }

  const id = recording.value
  const res = setShortcut(id, keys)
  if (!res.ok) {
    tip.value = res.conflict
      ? { type: 'error', text: `与「${res.conflict.conflictWith.map(c => c.id).join('」「')}」冲突，请换一个组合键` }
      : { type: 'error', text: '设置失败（条目不存在或不可修改）' }
    return // 保持录制态，让用户继续按键
  }
  if (res.shadowing) {
    tip.value = { type: 'warn', text: `已保存，但被更高优先级${scopeLabel(res.shadowing[0].scope)}快捷键「${res.shadowing[0].id}」遮蔽，该键不会触发` }
  } else {
    tip.value = null
  }
  emit('dirty')
  recording.value = null
}

onMounted(() => {
  document.addEventListener('keydown', onRecordKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onRecordKeydown, true)
})
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */

.ss-group { margin-bottom: 10px; }
.ss-scope { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.ss-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-radius: 4px; font-size: var(--font-size-sm); }
.ss-row:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.ss-desc { color: var(--text-color); font-size: var(--font-size-sm); }
.ss-keys-area { display: flex; align-items: center; gap: 4px; }
.ss-keys { display: flex; align-items: center; gap: 3px; cursor: pointer; padding: 2px 6px; border: 1px solid transparent; border-radius: 4px; transition: border-color 0.1s; }
.ss-keys:hover { border-color: var(--primary, var(--color-primary)); }
.ss-keys:hover .ss-edit-icon { opacity: 1; }
.ss-edit-icon { font-size: var(--font-size-xs); opacity: 0.3; margin-left: 2px; }
.ss-kbd { display: inline-flex; align-items: center; padding: 1px 5px; font-size: var(--font-size-xs); font-family: inherit; background: var(--bg-secondary, var(--color-bg-elevated)); border: 1px solid var(--border, var(--color-border)); border-radius: 3px; box-shadow: 0 1px 0 var(--border, var(--color-border)); color: var(--text-color); }
.ss-recording { font-size: var(--font-size-sm); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); padding: 2px 8px; animation: ws-pulse 0.8s infinite; cursor: pointer; }
.ss-reset { font-size: var(--font-size-base); background: none; border: none; cursor: pointer; color: var(--text-tertiary, var(--color-text-tertiary)); padding: 2px; border-radius: 3px; }
.ss-reset:hover { color: var(--danger, var(--color-danger)); background: var(--hover-bg); }
.ss-tip { margin: 0 0 8px; padding: 6px 8px; border-radius: 4px; font-size: var(--font-size-xs); }
.ss-tip.error { color: var(--danger, var(--color-danger)); background: color-mix(in srgb, var(--danger, var(--color-danger)) 10%, transparent); }
.ss-tip.warn { color: var(--warning, var(--color-warning, #b8860b)); background: color-mix(in srgb, var(--warning, var(--color-warning, #b8860b)) 10%, transparent); }
</style>
