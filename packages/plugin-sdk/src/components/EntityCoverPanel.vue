<template>
  <div class="ecp">
    <section class="ecp-section">
      <h4 class="ecp-title">封面图</h4>
      <ImageField
        :value="entity.coverImage"
        :editing="true"
        :entity-id="entity.id"
        :cover-position="entity.coverPosition || '50% 50%'"
        :cover-zoom="entity.coverZoom || 1"
        @update:value="onCover"
        @update:cover-position="onPosition"
        @update:cover-zoom="onZoom"
      />
      <p class="ecp-hint">封面用于卡片与详情头图；修改即时保存</p>
    </section>

    <section class="ecp-section">
      <h4 class="ecp-title">形象图</h4>
      <AssetField
        ref="assetRef"
        :value="entity.portrait"
        :kind="entity.portraitKind"
        category="portrait"
        @update:value="onPortrait"
        @update:kind="onPortraitKind"
      />
      <!-- 建模类动作绑定（D2 #7）：枚举 GLB 自带动作，悬停/点击触发各选指定或随机 -->
      <div v-if="entity.portraitKind === 'model' && entity.portrait" class="ecp-actions">
        <label class="ecp-action-row">
          <span>悬停时播放</span>
          <select :value="modelAction('hover')" @change="onActionChange('hover', $event)">
            <option value="random">随机动作</option>
            <option v-for="a in modelActions" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <label class="ecp-action-row">
          <span>点击时播放</span>
          <select :value="modelAction('click')" @change="onActionChange('click', $event)">
            <option value="random">随机动作</option>
            <option v-for="a in modelActions" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
      </div>
      <!-- 区域动效（D3 机制 + D4 画布编辑器）：编辑入口与摘要，表单进编辑器 -->
      <div v-if="is2DKind && entity.portrait" class="ecp-actions">
        <div class="ecp-motion-head">
          <span>区域动效</span>
          <TuiButton variant="secondary" size="sm" @click="editorOpen = true">打开画布编辑器</TuiButton>
        </div>
        <p class="ecp-hint">
          {{ motionSummary }}——画布拖拽框选区域（如头部/眼睛），配自动循环/悬停/点击/追踪鼠标轨迹
        </p>
      </div>
      <MotionEditor v-if="editorOpen" :entity="entity" @close="editorOpen = false" />
      <label class="ecp-check" :class="{ disabled: !entity.portrait }">
        <input
          type="checkbox"
          :checked="entity.coverSource === 'portrait'"
          :disabled="!entity.portrait"
          @change="onPortraitCover"
        />
        <span>形象图作为卡片封面</span>
      </label>
      <p class="ecp-hint">形象图支持静态 / 动态（GIF/APNG/WebP/Lottie）/ 3D 模型（GLB），接受透明背景；同时设置时默认用封面图，勾选后由形象图替代</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 实体「形象」面板（原封面面板，2026-10-25 形象图批计划 A 扩展）：
 * 封面图区（ImageField，IDB 链路不变）+ 形象图区（AssetField，磁盘 assets 链路）+
 * coverSource 勾选（互斥枚举，勾视频/形象的任一时刻只激活一个封面源）。
 * 延续即时保存模式（无草稿）；移除形象图时若其正作封面自动回退 image。
 */
import ImageField from './ImageField.vue'
import AssetField from './AssetField.vue'
import MotionEditor from './MotionEditor.vue'
import { TuiButton } from '@worldsea/ui-kit'
import { useEntityStore, type Entity, type CoverSource, type ModelActionConfig } from '@worldsea/entity-core'
import type { AssetKind } from '@worldsea/entity-core/core'
import { computed, ref } from 'vue'

const props = defineProps<{ entity: Entity }>()
const entityStore = useEntityStore()

const is2DKind = computed(() => props.entity.portraitKind === 'static' || props.entity.portraitKind === 'animated')
const motionCfg = computed(() => props.entity.portraitMeta?.motion)
const editorOpen = ref(false)
const motionSummary = computed(() => {
  const m = motionCfg.value
  if (!m || !m.regions.length) return '尚未配置'
  return `${m.regions.length} 区域 · ${m.tracks.length} 轨迹`
})

/** AssetField 内 PortraitRenderer 的动作清单（模型 load 后填充） */
const assetRef = ref<InstanceType<typeof AssetField> | null>(null)
const modelActions = computed(() => assetRef.value?.availableAnimations ?? [])

/** 当前动作绑定值（缺省 random） */
function modelAction(trigger: 'hover' | 'click'): string {
  return props.entity.portraitMeta?.model?.[trigger] ?? 'random'
}

/** 写动作绑定：portraitMeta 整体替换（merge patch 保持顶层其余字段） */
function onActionChange(trigger: 'hover' | 'click', e: Event) {
  const val = (e.target as HTMLSelectElement).value
  const next: ModelActionConfig = { ...props.entity.portraitMeta?.model, [trigger]: val === 'random' ? 'random' : val }
  entityStore.update(props.entity.id, {
    portraitMeta: { ...props.entity.portraitMeta, model: next },
  })
}

/** ImageField 移除时 emit null —— 归一为空串清空顶层封面 */
function onCover(val: unknown) {
  entityStore.update(props.entity.id, { coverImage: (val as string | null) ?? '' })
}
function onPosition(val: string) {
  entityStore.update(props.entity.id, { coverPosition: val })
}
function onZoom(val: number) {
  entityStore.update(props.entity.id, { coverZoom: val })
}

function onPortrait(val: string | null) {
  if (!val) {
    // 移除形象图：正作封面则回退封面图；类别与编排元数据一并清空
    const patch: Partial<Entity> = { portrait: '' }
    if (props.entity.coverSource === 'portrait') patch.coverSource = 'image'
    entityStore.update(props.entity.id, patch)
    entityStore.update(props.entity.id, { portraitKind: undefined, portraitMeta: undefined })
    return
  }
  entityStore.update(props.entity.id, { portrait: val })
}

function onPortraitKind(kind: AssetKind | null) {
  if (kind === 'video') return // video 类别不属形象图
  entityStore.update(props.entity.id, { portraitKind: kind ?? undefined })
}

function onPortraitCover(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const next: CoverSource = checked ? 'portrait' : 'image'
  entityStore.update(props.entity.id, { coverSource: next })
}
</script>

<style scoped>
.ecp { display: flex; flex-direction: column; gap: 18px; }
.ecp-section { display: flex; flex-direction: column; gap: 10px; }
.ecp-title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
}
.ecp-hint { margin: 0; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, #9ca3af); }
.ecp-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.ecp-check.disabled { color: var(--text-tertiary); cursor: not-allowed; }
.ecp-check input { accent-color: var(--primary); }
.ecp-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
}
.ecp-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.ecp-action-row select {
  max-width: 60%;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
.ecp-motion-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.ecp-motion-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
}
.ecp-motion-row input[type='number'],
.ecp-motion-row select {
  width: 52px;
  padding: 2px 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
.ecp-motion-row select { width: auto; }
.ecp-motion-chk { display: inline-flex; align-items: center; gap: 2px; color: var(--text-tertiary); }
.ecp-motion-chk input { accent-color: var(--primary); }
.ecp-motion-label { color: var(--text-tertiary); }
.ecp-motion-del {
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
}
.ecp-motion-del:hover { color: var(--danger, #dc2626); }
</style>
