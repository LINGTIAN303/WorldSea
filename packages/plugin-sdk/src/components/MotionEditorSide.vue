<template>
  <aside class="me-side">
    <template v-if="mode === 'region'">
      <div class="me-side-head">
        <span>区域与轨迹</span>
        <span class="me-side-hint">画布空白处拖拽=新建区域 · 拖动=移动 · 角点=缩放 · Delete=删除选中</span>
      </div>
      <p v-if="!draft.regions.length" class="me-empty">尚无区域——在画布空白处拖拽框选一块（如头部/眼睛）</p>
      <div
        v-for="r in draft.regions"
        :key="r.id"
        class="me-region-item"
        :class="{ selected: r.id === selectedId }"
        @click="$emit('update:selectedId', r.id)"
      >
        <span class="me-region-name">区域 {{ r.id.slice(-4) }}</span>
        <span class="me-region-xy">x{{ Math.round(r.x) }} y{{ Math.round(r.y) }} {{ Math.round(r.w) }}×{{ Math.round(r.h) }}</span>
        <button class="me-del" aria-label="删除区域" @click.stop="removeRegion(r.id)">×</button>
      </div>
      <div v-if="selectedRegion" class="me-tracks">
        <div class="me-tracks-head">
          <span>该区域轨迹</span>
          <button class="me-add" @click="addTrack(selectedRegion.id)">+ 轨迹</button>
        </div>
        <div v-for="t in regionTracks(selectedRegion.id)" :key="t.id" class="me-track">
          <select v-model="t.trigger" @change="touch">
            <option value="loop">自动循环</option>
            <option value="hover">悬停触发</option>
            <option value="click">点击触发</option>
            <option value="mouse">追踪鼠标</option>
          </select>
          <template v-if="t.trigger === 'mouse'">
            <input v-model.number="t.dx" type="number" step="1" aria-label="横向跟随幅度" placeholder="横幅%" @change="touch" />
            <input v-model.number="t.dy" type="number" step="1" aria-label="纵向跟随幅度" placeholder="纵幅%" @change="touch" />
            <span class="me-track-hint">朝鼠标偏移的幅度上限（区域尺寸百分比）</span>
          </template>
          <template v-else>
            <input v-model.number="t.duration" type="number" min="0.1" step="0.1" aria-label="时长秒" placeholder="秒" @change="touch" />
            <label class="me-chk"><input v-model="t.loop" type="checkbox" @change="touch" />循环</label>
            <label class="me-chk"><input v-model="t.alternate" type="checkbox" @change="touch" />往返</label>
            <input v-model.number="t.dx" type="number" step="1" aria-label="横移%" placeholder="横移" @change="touch" />
            <input v-model.number="t.dy" type="number" step="1" aria-label="竖移%" placeholder="竖移" @change="touch" />
            <input v-model.number="t.rotate" type="number" step="1" aria-label="旋转度" placeholder="转°" @change="touch" />
            <input v-model.number="t.scale" type="number" step="0.1" aria-label="缩放" placeholder="缩放" @change="touch" />
          </template>
          <button class="me-del" aria-label="删除轨迹" @click="removeTrack(t.id)">×</button>
          <!-- 多关键帧时间轴（E 批）：非 mouse 轨专属（内容追踪是连续跟随无时间轴） -->
          <MotionTimeline v-if="t.trigger !== 'mouse'" :track="t" @change="touch" />
        </div>
      </div>
    </template>
    <template v-else>
      <div class="me-side-head"><span>封面焦点</span><span class="me-side-hint">点击画布设焦点 · 滚轮缩放（作封面时的取景）</span></div>
      <p class="me-focus-pos">焦点 {{ draftFocus.position || '50% 50%' }} · 缩放 {{ draftFocus.zoom ?? 1 }}×</p>
      <button class="me-add" @click="resetFocus">重置</button>
    </template>

    <div class="me-preview-head">实时预览</div>
    <div class="me-preview">
      <MotionStage :src="src" :motion="{ regions: draft.regions, tracks: draft.tracks }" />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 形象图编辑器侧栏（D4，从 MotionEditor 拆出控规模）：区域清单 + 选中区域轨迹表单
 * （含「追踪鼠标」触发）+ 焦点信息 + MotionStage 实时预览。draft/draftFocus 为父组件
 * reactive 引用直接 mutate（编辑器私有子组件，耦合限定在本对），变更经 change 上报置脏。
 */
import { computed } from 'vue'
import type { MotionConfig, MotionRegion } from '@worldsea/entity-core'
import MotionStage from './MotionStage.vue'
import MotionTimeline from './MotionTimeline.vue'

const props = defineProps<{
  src: string
  mode: 'region' | 'focus'
  draft: MotionConfig
  draftFocus: { position?: string; zoom?: number }
  selectedId: string | null
}>()

const emit = defineEmits<{ 'update:selectedId': [id: string | null]; change: [] }>()

const selectedRegion = computed(() => props.draft.regions.find(r => r.id === props.selectedId) ?? null)

const uid = () => Math.random().toString(36).slice(2, 8)
const touch = () => emit('change')

function regionTracks(regionId: string) {
  return props.draft.tracks.filter(t => t.regionId === regionId)
}
function addTrack(regionId: string) {
  props.draft.tracks.push({ id: uid(), regionId, trigger: 'mouse', duration: 2, loop: true, alternate: true, dx: 4, dy: 4, rotate: 0, scale: 1 })
  touch()
}
function removeTrack(id: string) {
  props.draft.tracks = props.draft.tracks.filter(t => t.id !== id)
  touch()
}
function removeRegion(id: string) {
  props.draft.regions = props.draft.regions.filter((r: MotionRegion) => r.id !== id)
  props.draft.tracks = props.draft.tracks.filter(t => t.regionId !== id)
  if (props.selectedId === id) emit('update:selectedId', props.draft.regions[0]?.id ?? null)
  touch()
}
function resetFocus() {
  props.draftFocus.position = undefined
  props.draftFocus.zoom = undefined
  touch()
}
</script>

<style scoped>
.me-side {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-left: 1px solid var(--border-color);
  overflow-y: auto;
  font-size: var(--font-size-xs);
}
.me-side-head { display: flex; flex-direction: column; gap: 2px; font-weight: 600; color: var(--text-secondary); }
.me-side-hint { font-weight: 400; color: var(--text-tertiary); }
.me-empty { margin: 0; color: var(--text-tertiary); }
.me-region-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.me-region-item:hover { background: var(--hover-bg); }
.me-region-item.selected { background: var(--primary-light, #eef2ff); }
.me-region-name { font-weight: 600; }
.me-region-xy { color: var(--text-tertiary); margin-left: auto; }
.me-del {
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
}
.me-del:hover { color: var(--danger, #dc2626); }
.me-tracks { display: flex; flex-direction: column; gap: 6px; }
.me-tracks-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
.me-add {
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: none;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}
.me-track { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.me-track select,
.me-track input[type='number'] {
  width: 52px;
  padding: 2px 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
.me-track select { width: auto; }
.me-chk { display: inline-flex; align-items: center; gap: 2px; color: var(--text-tertiary); }
.me-chk input { accent-color: var(--primary); }
.me-track-hint { width: 100%; color: var(--text-tertiary); }
.me-focus-pos { margin: 0; color: var(--text-tertiary); }
.me-preview-head { margin-top: 4px; font-weight: 600; color: var(--text-secondary); }
.me-preview {
  height: 150px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
</style>
