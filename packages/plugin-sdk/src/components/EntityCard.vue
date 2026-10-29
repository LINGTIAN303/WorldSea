<template>
  <div
    ref="wrapperEl"
    class="entity-card-wrapper"
    :class="{
      'is-flipped': hasImageField && flipped,
      'batch-selected': batchSelected,
      'batch-mode': batchMode,
      'active': active,
      'hl-pulse': active && settings.highlight_pulseEnabled,
      'dimmed': dimmed,
      'search-highlight': searchHighlighted,
    }"
    :style="{ '--hl-dim-opacity': settings.highlight_dimOpacity }"
    @mouseover="onHoverOver"
    @mouseout="onHoverOut"
  >
    <!-- 有封面字段时走双面卡：正面文字、背面图片（翻转态由卡片自持） -->
    <div v-if="hasImageField" class="entity-card-flipper">
      <div class="entity-card card-front" role="button" tabindex="0" :aria-label="activateLabel" :aria-pressed="batchMode ? batchSelected : undefined" @click="emit('activate')" @keydown.enter.prevent="emit('activate')" @keydown.space.prevent="emit('activate')">
        <EntityCardCover :entity="entity" :cover-field-key="coverFieldKey" :hovered="hovered" />
        <div class="card-header">
          <WsIcon class="card-icon" :name="icon" size="sm" />
          <div class="card-body">
            <h3>{{ entity.name }}</h3>
            <slot name="subtitle" :entity="entity">
              <p v-if="cardSubtitle">{{ subtext }}</p>
              <p v-else>{{ typeText }}</p>
            </slot>
          </div>
          <div v-if="cardFooterFields.length" class="card-footer">
            <span
              v-for="ff in cardFooterFields"
              :key="ff.key"
              class="card-tag"
              :class="ff.classMap?.[String(entity.properties[ff.key] || '')]"
            >
              {{ entity.properties[ff.key] }}
            </span>
          </div>
        </div>
        <button class="card-flip-btn" :aria-label="flipped ? '翻回正面' : '翻转查看图片'" @click.stop="flipped = true" title="翻转查看图片"><WsIcon name="refresh" size="xs" /></button>
      </div>
      <div class="entity-card card-back" role="button" tabindex="0" :aria-label="`翻转回 ${entity.name} 正面`" @click="flipped = false" @keydown.enter.prevent="flipped = false" @keydown.space.prevent="flipped = false">
        <EntityCardBack :entity="entity" :cover-field-key="coverFieldKey" />
        <div class="card-back-info">
          <h3>{{ entity.name }}</h3>
          <p v-if="cardSubtitle">{{ subtext }}</p>
          <p v-else>{{ typeText }}</p>
        </div>
        <button class="card-flip-btn" aria-label="翻转回正面" @click.stop="flipped = false" title="翻转回正面"><WsIcon name="refresh" size="xs" /></button>
      </div>
    </div>

    <div v-else class="entity-card" role="button" tabindex="0" :aria-label="activateLabel" :aria-pressed="batchMode ? batchSelected : undefined" @click="emit('activate')" @keydown.enter.prevent="emit('activate')" @keydown.space.prevent="emit('activate')">
      <div class="card-header">
        <WsIcon class="card-icon" :name="icon" size="sm" />
        <div class="card-body">
          <h3>{{ entity.name }}</h3>
          <slot name="subtitle" :entity="entity">
            <p v-if="cardSubtitle">{{ subtext }}</p>
            <p v-else>{{ typeText }}</p>
          </slot>
        </div>
        <div v-if="cardFooterFields.length" class="card-footer">
          <span
            v-for="ff in cardFooterFields"
            :key="ff.key"
            class="card-tag"
            :class="ff.classMap?.[String(entity.properties[ff.key] || '')]"
          >
            {{ entity.properties[ff.key] }}
          </span>
        </div>
      </div>
    </div>

    <!-- 悬停形象预览（需求 #1/#4/#13）：有形象图且设置开启时，延迟浮现（防扫卡误触） -->
    <EntityCardHoverPreview
      v-if="previewVisible"
      :anchor="wrapperEl!"
      :src="entity.portrait!"
      :kind="entity.portraitKind || 'static'"
      :frameless="settings.hoverPreviewFrameless"
      :actions="entity.portraitMeta?.model"
      :motion="entity.portraitMeta?.motion"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 实体卡片（网格单元）。翻转态自持——原先由父级维护一张 flippedId 数组，
 * 卡片自己知道正面/背面，父级只需管选中与高亮。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useSettingsStore, type Entity } from '@worldsea/entity-core'
import type { CardFieldDef } from './types'
import EntityCardCover from './EntityCardCover.vue'
import EntityCardBack from './EntityCardBack.vue'
import EntityCardHoverPreview from './EntityCardHoverPreview.vue'

const props = withDefaults(defineProps<{
  entity: Entity
  icon?: string
  coverFieldKey?: string
  hasImageField?: boolean
  cardSubtitle?: string
  typeFieldKey?: string
  cardFooterFields?: CardFieldDef[]
  batchMode?: boolean
  batchSelected?: boolean
  active?: boolean
  dimmed?: boolean
  searchHighlighted?: boolean
  selecting?: boolean
}>(), {
  icon: '',
  coverFieldKey: 'coverImage',
  hasImageField: false,
  cardSubtitle: '',
  typeFieldKey: '',
  cardFooterFields: () => [],
  batchMode: false,
  batchSelected: false,
  active: false,
  dimmed: false,
  searchHighlighted: false,
})

const emit = defineEmits<{ activate: [] }>()

const flipped = ref(false)

/** 副标题两来源：指定字段 key，或回落到「类型字段」 */
const subtext = computed(() => String(props.entity.properties[props.cardSubtitle] || ''))
const typeText = computed(() => String(props.entity.properties[props.typeFieldKey] || ''))
const activateLabel = computed(() => (props.batchMode ? `选择 ${props.entity.name}` : `打开 ${props.entity.name}`))

// ── 悬停形象预览（形象图批 B）：设置开 + 有形象图才浮现；250ms 延迟防扫卡误触 ──
// 事件判定用 mouseover/out + relatedTarget 包含检查（D3 走查修复）：model-viewer 内部
// 元素切换会在指针静止时重派发 enter/leave 序列（实测 [over,enter,out,leave] 连发），
// mouseenter/mouseleave 配对被冲垮致预览计时器被清——relatedTarget 仍在卡内即忽略；
// leave 再经 150ms 确认 + matches(':hover') 浏览器真实态复核兜底。
const settings = useSettingsStore()
const wrapperEl = ref<HTMLElement | null>(null)
const previewVisible = ref(false)
/** 悬停态（即时，无延迟）：供视频封面悬停播（C 批）与预览门控共用 */
const hovered = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined

/** relatedTarget 仍在卡内 = 内部元素切换，非真离开/进入 */
function fromInside(e: MouseEvent): boolean {
  const rt = e.relatedTarget
  return !!rt && !!wrapperEl.value?.contains(rt as Node)
}

function onHoverOver(e: MouseEvent) {
  if (fromInside(e)) return
  clearTimeout(leaveTimer)
  hovered.value = true
  if (!settings.entityCardHoverPreview || !props.entity.portrait) return
  // D4 走查终修：model-viewer 会反复重派 over/out 对（假 leave 的 relatedTarget 还会是
  // 卡外元素，卡内检查防不住）——若每次 over 都重置 250ms 计时，预览永不出现。
  // 在途计时不重置：真离开（150ms 确认 + :hover 复核）才清。
  if (hoverTimer) return
  hoverTimer = setTimeout(() => {
    previewVisible.value = true
    hoverTimer = undefined
  }, 250)
}
function onHoverOut(e: MouseEvent) {
  if (fromInside(e)) return
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => {
    if (wrapperEl.value?.matches(':hover')) return // 伪 leave 兜底：浏览器真实 hover 态
    hovered.value = false
    clearTimeout(hoverTimer)
    hoverTimer = undefined
    previewVisible.value = false
  }, 150)
}
onBeforeUnmount(() => {
  clearTimeout(hoverTimer)
  clearTimeout(leaveTimer)
})
</script>

<style scoped>
/* ── 实体卡片（双线分隔：每卡自带 1px 边框 + gap 缝隙透出 app 底色）── */
.entity-card-wrapper {
  position: relative;
  display: flex;
  border: 1px solid var(--border, #ececec);
  border-radius: var(--radius-mid, 8px);
  background: var(--bg-surface, #ffffff);
  overflow: hidden;
  transition: border-color var(--dur-fast, 0.15s) var(--ease, ease),
              box-shadow var(--dur-fast, 0.15s) var(--ease, ease),
              opacity var(--dur-fast, 0.15s) var(--ease, ease);
}
.entity-card-wrapper:hover {
  border-color: var(--border-strong, #d9d9de);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(16, 24, 40, 0.05));
}
/* 打开详情：accent 描边高亮 */
.entity-card-wrapper.active {
  border-color: var(--accent, #4f46e5);
  box-shadow: 0 0 0 1px var(--accent, #4f46e5);
}
/* 批量选择态 */
.entity-card-wrapper.batch-selected {
  border-color: var(--accent, #4f46e5);
  background: var(--accent-soft, #eef2ff);
}
/* 搜索命中高亮 */
.entity-card-wrapper.search-highlight { border-color: var(--warning, #d97706); }
/* 关系高亮过滤时未命中项变暗 */
.entity-card-wrapper.dimmed { opacity: var(--hl-dim-opacity, 0.45); }

/* 选中卡片脉冲（设置「脉冲动画」）：外圈涟漪，不动布局 */
@keyframes hl-card-pulse {
  0% { box-shadow: 0 0 0 1px var(--accent, #4f46e5), 0 0 0 0 color-mix(in srgb, var(--accent, #4f46e5) 35%, transparent); }
  50% { box-shadow: 0 0 0 1px var(--accent, #4f46e5), 0 0 0 6px color-mix(in srgb, var(--accent, #4f46e5) 0%, transparent); }
  100% { box-shadow: 0 0 0 1px var(--accent, #4f46e5), 0 0 0 0 color-mix(in srgb, var(--accent, #4f46e5) 35%, transparent); }
}
.entity-card-wrapper.active.hl-pulse { animation: hl-card-pulse 1.6s var(--ease, ease) infinite; }
:root[data-anim-content='off'] .entity-card-wrapper.dimmed { transition: none; }
:root[data-anim-content='off'] .entity-card-wrapper.active.hl-pulse,
:root[data-reduce-motion='on'] .entity-card-wrapper.active.hl-pulse { animation: none; }

/* 卡片本体：可点击填充区 */
.entity-card {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  cursor: pointer;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}
.entity-card:focus-visible {
  box-shadow: 0 0 0 var(--ring-width, 3px) var(--ring-color, rgba(79, 70, 229, 0.35));
}

/* 封面：贴合卡片顶部（负边距抵消卡片内边距） */
.entity-card .card-cover-wrap { margin: -12px -12px 10px; }
.entity-card .card-cover { width: 100%; height: 110px; object-fit: cover; display: block; }

/* 卡片头部：图标 + 名称区 */
.card-header { display: flex; align-items: center; gap: 8px; min-width: 0; }
.card-icon { color: var(--accent, #4f46e5); flex-shrink: 0; }
.card-body { flex: 1; min-width: 0; }
.card-body h3 {
  margin: 0; font-size: var(--fs-base, 14px); font-weight: 600;
  color: var(--text-primary, #1f2328); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-body p {
  margin: 2px 0 0; font-size: var(--fs-xs, 11px); color: var(--text-secondary, #6b7280);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 翻转按钮：hover 浮现 */
.card-flip-btn {
  position: absolute; top: 8px; right: 8px; z-index: 1;
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  background: var(--bg-muted, #f4f4f5); border: 1px solid var(--border, #ececec);
  border-radius: var(--radius-xs, 4px); color: var(--text-secondary, #6b7280);
  cursor: pointer; opacity: 0; transition: opacity var(--dur-fast, 0.15s) var(--ease, ease);
}
.entity-card-wrapper:hover .card-flip-btn { opacity: 1; }

/* 批量态：hover 虚线描边示意「点击=选中」 */
.entity-card-wrapper.batch-mode { cursor: pointer; }
.entity-card-wrapper.batch-mode:hover { border-color: var(--accent, #4f46e5); border-style: dashed; }

/* 翻转容器（3D 双面） */
.entity-card-flipper { position: relative; flex: 1; display: flex; perspective: 1000px; }
.entity-card-flipper .entity-card { backface-visibility: hidden; transition: transform var(--dur-base, 0.22s) var(--ease, ease); }
.entity-card-flipper .card-back {
  position: absolute; inset: 0; transform: rotateY(180deg); background: var(--bg-surface, #ffffff);
}
.entity-card-wrapper.is-flipped .entity-card-flipper .card-front { transform: rotateY(180deg); }
.entity-card-wrapper.is-flipped .entity-card-flipper .card-back { transform: rotateY(0deg); }

/* 卡片背面信息区 */
.card-back-info { margin-top: auto; }
.card-back-info h3 { margin: 0; font-size: var(--fs-base, 14px); font-weight: 600; color: var(--text-primary, #1f2328); }
.card-back-info p { margin: 2px 0 0; font-size: var(--fs-xs, 11px); color: var(--text-secondary, #6b7280); }
.card-footer { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.card-tag { font-size: var(--font-size-xs); padding: 1px 6px; background: var(--hover-bg); border-radius: 4px; color: var(--text-secondary); }
</style>
