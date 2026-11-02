<template>
  <div class="bg-map">
    <div class="bg-map__head">
      <span class="bg-map__title">界面映射</span>
      <div class="bg-map__switch" role="group" aria-label="界面映射切换">
        <button :class="{ on: map === 'workspace' }" :disabled="disabled" @click="emit('switch-map', 'workspace')">工作台</button>
        <button :class="{ on: map === 'home' }" :disabled="disabled" @click="emit('switch-map', 'home')">首页</button>
      </div>
    </div>

    <!-- 固定 16:9 舞台：切换地图只换绝对定位视图，卡内高度不塌 -->
    <div class="bg-map__stage">
      <Transition name="bg-map-fade" mode="out-in">
        <div v-if="map === 'workspace'" key="workspace" class="bg-map__viewport bg-map__viewport--workspace" role="group" aria-label="工作台界面区域">
          <button
            v-for="region in WORKSPACE_REGIONS" :key="region.target"
            class="bg-map__region" :class="[`bg-map__region--${region.target}`, { 'is-selected': selected === region.target }]"
            :disabled="disabled" :aria-pressed="selected === region.target"
            @click="emit('select', region.target)"
          >
            <BackgroundLayer :target="region.target" scope="effective" preview />
            <span class="bg-map__name">{{ region.label }}</span>
            <span class="bg-map__state" :data-state="stateOf(region.target).key">{{ stateOf(region.target).text }}</span>
          </button>
        </div>
        <div v-else key="home" class="bg-map__viewport bg-map__viewport--home">
          <button
            class="bg-map__home" :class="{ 'is-selected': selected === 'home' }" :disabled="disabled"
            :aria-pressed="selected === 'home'" @click="emit('select', 'home')"
          >
            <BackgroundLayer target="home" scope="effective" preview />
            <span class="bg-map__home-cover">项目封面<small>在编辑简介更换</small></span>
            <span class="bg-map__home-hero">项目标题 / 简介 / 操作</span>
            <span class="bg-map__home-row" aria-hidden="true"><i v-for="n in 4" :key="n"></i></span>
            <span class="bg-map__home-block bg-map__home-block--assets"><small>资产地图</small></span>
            <span class="bg-map__home-block bg-map__home-block--writing"><small>动态写作</small></span>
            <span class="bg-map__name">首页</span>
            <span class="bg-map__state" :data-state="stateOf('home').key">{{ stateOf('home').text }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- 大背景：未选中收为缩略条，选中展开 16:9 预览 -->
    <button
      class="bg-canvas-card" :class="{ 'is-selected': selected === 'canvas' }" :disabled="disabled"
      :aria-pressed="selected === 'canvas'" @click="emit('select', 'canvas')"
    >
      <BackgroundLayer target="canvas" scope="effective" preview />
      <span class="bg-canvas-card__label">大背景</span>
      <span class="bg-canvas-card__state" :data-state="stateOf('canvas').key">{{ stateOf('canvas').text }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useBackground, type BackgroundTarget } from '@worldsea/style-kit'
import BackgroundLayer from '../../layout/BackgroundLayer.vue'
import { BACKGROUND_TARGET_LABELS, BACKGROUND_WORKSPACE_TARGETS } from './backgroundTargets'

const props = defineProps<{
  scope: 'global' | 'project'
  map: 'workspace' | 'home'
  selected: BackgroundTarget
  disabled: boolean
}>()
const emit = defineEmits<{ select: [BackgroundTarget]; 'switch-map': ['workspace' | 'home'] }>()

const { effective, srcs, missing, projectConfig } = useBackground()
const WORKSPACE_REGIONS = BACKGROUND_WORKSPACE_TARGETS.map((target) => ({
  target,
  label: BACKGROUND_TARGET_LABELS[target],
}))

type TargetStateKey = 'follow' | 'missing' | 'unset' | 'on' | 'off'

/** 区域状态口径：项目跟随 > 两主题缺图 > 无图 > 启用开关 */
function stateOf(target: BackgroundTarget): { key: TargetStateKey; text: string } {
  if (props.scope === 'project' && !projectConfig.value?.targets[target]) return { key: 'follow', text: '跟随' }
  const miss = missing.value[target]
  if (miss.light && miss.dark) return { key: 'missing', text: '缺图' }
  const src = srcs.value[target]
  if (!src.light && !src.dark) return { key: 'unset', text: '未设置' }
  return effective.value[target].enabled ? { key: 'on', text: '开' } : { key: 'off', text: '关' }
}
</script>

<style scoped>
.bg-map { display: flex; flex-direction: column; gap: 8px; }

.bg-map__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bg-map__title { font-size: var(--fs-sm); color: var(--text-secondary); }

.bg-map__switch {
  display: flex;
  border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  overflow: hidden;
}
.bg-map__switch button {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.bg-map__switch button + button { border-left: 1px solid var(--sf-control-edge); }
.bg-map__switch button.on { background: var(--accent-soft); color: var(--accent); }
.bg-map__switch button:disabled { opacity: 0.5; cursor: not-allowed; }

/* 舞台固定比例；两个视图绝对定位填满，切换过渡不影响布局高度 */
.bg-map__stage {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--sf-panel-edge);
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  background: var(--bg-app);
}
.bg-map__viewport { position: absolute; inset: 0; overflow: hidden; }

/* 区域按钮自建堆叠上下文：负 z 背景层压在本区底色上、标签文字之下 */
.bg-map__region {
  position: absolute;
  overflow: hidden;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  background: var(--sf-panel-bg-muted);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}
.bg-map__region:disabled { cursor: not-allowed; }
.bg-map__region :deep(.ws-bg-layer) { z-index: -1; }

/* 工作台结构百分比：窗口栏横条、侧栏竖条、工具条/视图依次向下 */
.bg-map__region--titlebar {
  inset: 0 0 auto 0;
  height: 12%;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
}
.bg-map__region--sidebar { left: 0; top: 13%; bottom: 0; width: 22%; }
.bg-map__region--content-toolbar { left: 23%; right: 0; top: 13%; height: 15%; }
.bg-map__region--content-view { left: 23%; right: 0; top: calc(13% + 15% + 3px); bottom: 0; }

.bg-map__name { position: relative; z-index: 1; font-size: var(--fs-xs); color: var(--text-secondary); }
.bg-map__state {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.bg-map__state::before,
.bg-canvas-card__state::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.bg-map__state[data-state='on'],
.bg-canvas-card__state[data-state='on'] { color: var(--accent); }
.bg-map__state[data-state='off'],
.bg-map__state[data-state='unset'],
.bg-canvas-card__state[data-state='off'],
.bg-canvas-card__state[data-state='unset'] { color: var(--text-muted); }
.bg-map__state[data-state='follow'],
.bg-canvas-card__state[data-state='follow'] { color: var(--text-secondary); }
.bg-map__state[data-state='missing'],
.bg-canvas-card__state[data-state='missing'] { color: var(--danger); }

/* 首页地图：整图一个 home 目标；示意块只作结构参照 */
.bg-map__home {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.bg-map__home :deep(.ws-bg-layer) { z-index: -1; }
.bg-map__home:disabled { cursor: not-allowed; }

.bg-map__home-hero,
.bg-map__home-cover,
.bg-map__home-block {
  position: absolute;
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  background: var(--bg-surface);
  opacity: 0.82;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
}
.bg-map__home-hero {
  top: 8%;
  left: 6%;
  right: 36%;
  height: 22%;
  display: flex;
  align-items: center;
  padding: 0 8px;
}
.bg-map__home-cover {
  top: 8%;
  right: 6%;
  width: 26%;
  height: 22%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--sf-control-edge);
  background: transparent;
  pointer-events: none;
}
.bg-map__home-cover small { font-size: var(--fs-xs); color: var(--text-muted); opacity: 0.9; }
.bg-map__home-row {
  position: absolute;
  top: 36%;
  left: 6%;
  right: 6%;
  height: 11%;
  display: flex;
  gap: 6px;
}
.bg-map__home-row i {
  flex: 1;
  border-radius: calc(var(--radius-sm) * var(--sf-radius-scale));
  background: var(--bg-surface);
  opacity: 0.82;
}
.bg-map__home-block {
  top: 52%;
  bottom: 16%;
  display: flex;
  align-items: flex-start;
  padding: 6px;
}
.bg-map__home-block small { font-size: var(--fs-xs); color: var(--text-muted); }
.bg-map__home-block--assets { left: 6%; right: 52%; }
.bg-map__home-block--writing { left: 52%; right: 6%; }
.bg-map__home .bg-map__name { position: absolute; left: 6px; bottom: 6px; }
.bg-map__home .bg-map__state { position: absolute; right: 6px; bottom: 6px; }

.is-selected { outline: 2px solid var(--accent); outline-offset: -2px; }

/* 大背景卡片：缩略条 → 选中 16:9 预览；层位于卡片底色上、文字下 */
.bg-canvas-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 64px;
  padding: 0 10px;
  overflow: hidden;
  z-index: 0;
  border: 1px solid var(--sf-control-edge);
  border-radius: calc(var(--radius-md) * var(--sf-radius-scale));
  background: var(--sf-panel-bg-muted);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms var(--ease-out), background-color 160ms var(--ease-out);
}
.bg-canvas-card :deep(.ws-bg-layer) { z-index: -1; }
.bg-canvas-card.is-selected { aspect-ratio: 16 / 9; min-height: 0; align-items: flex-end; padding: 10px; }
.bg-canvas-card:disabled { cursor: not-allowed; }
.bg-canvas-card__label { position: relative; z-index: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.bg-canvas-card__state {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

/* 地图切换：淡入 + 轻微位移；减弱动效时直切 */
.bg-map-fade-enter-active,
.bg-map-fade-leave-active { transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out); }
.bg-map-fade-enter-from { opacity: 0; transform: translateX(8px); }
.bg-map-fade-leave-to { opacity: 0; transform: translateX(-8px); }
:root[data-reduce-motion='on'] .bg-map-fade-enter-active,
:root[data-reduce-motion='on'] .bg-map-fade-leave-active,
:root[data-reduce-motion='on'] .bg-canvas-card { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .bg-map-fade-enter-active,
  .bg-map-fade-leave-active,
  .bg-canvas-card { transition: none; }
}
</style>
