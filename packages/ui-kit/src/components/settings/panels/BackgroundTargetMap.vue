<template>
  <div class="bg-map">
    <div class="bg-map__head">
      <span class="bg-map__title">界面映射</span>
      <div class="bg-map__controls">
        <div class="bg-map__theme" role="group" aria-label="预览主题">
          <button :class="{ on: previewTheme === 'light' }" :aria-pressed="previewTheme === 'light'" :disabled="disabled" aria-label="亮色预览" @click="emit('switch-theme', 'light')">亮</button>
          <button :class="{ on: previewTheme === 'dark' }" :aria-pressed="previewTheme === 'dark'" :disabled="disabled" aria-label="暗色预览" @click="emit('switch-theme', 'dark')">暗</button>
        </div>
        <div class="bg-map__switch" role="group" aria-label="界面映射切换">
          <button :class="{ on: map === 'workspace' }" :aria-pressed="map === 'workspace'" :disabled="disabled" @click="emit('switch-map', 'workspace')">工作台</button>
          <button :class="{ on: map === 'home' }" :aria-pressed="map === 'home'" :disabled="disabled" @click="emit('switch-map', 'home')">首页</button>
        </div>
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
            :title="regionTitle(region.target)"
            @click="emit('select', region.target)"
          >
            <BackgroundLayer :target="region.target" :scope="previewScope(region.target)" :preview-theme="previewTheme" preview />
            <span class="bg-map__name">{{ region.label }}</span>
            <span v-if="region.target === 'content-toolbar' && toolbarMode !== 'bar'" class="bg-map__mode" :data-mode="toolbarMode">{{ toolbarModeBadge }}</span>
            <span class="bg-map__state" :data-state="stateOf(region.target).key">{{ stateOf(region.target).text }}</span>
          </button>
        </div>
        <div v-else key="home" class="bg-map__viewport bg-map__viewport--home" role="group" aria-label="首页界面">
          <button
            class="bg-map__home" :class="{ 'is-selected': selected === 'home' }" :disabled="disabled"
            :aria-pressed="selected === 'home'" aria-label="首页" @click="emit('select', 'home')"
          >
            <BackgroundLayer target="home" :scope="previewScope('home')" :preview-theme="previewTheme" preview />
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
      <BackgroundLayer target="canvas" :scope="previewScope('canvas')" :preview-theme="previewTheme" preview />
      <span class="bg-canvas-card__label">大背景</span>
      <span class="bg-canvas-card__state" :data-state="stateOf('canvas').key">{{ stateOf('canvas').text }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBackground, type BackgroundTarget, type BackgroundTheme } from '@worldsea/style-kit'
import BackgroundLayer from '../../layout/BackgroundLayer.vue'
import { BACKGROUND_TARGET_LABELS, BACKGROUND_WORKSPACE_TARGETS } from './backgroundTargets'

export type ToolbarMode = 'bar' | 'overlay' | 'none' | 'unavailable'

const props = defineProps<{
  scope: 'global' | 'project'
  map: 'workspace' | 'home'
  selected: BackgroundTarget
  disabled: boolean
  toolbarMode: ToolbarMode
  previewTheme: BackgroundTheme
}>()
const emit = defineEmits<{
  select: [BackgroundTarget]
  'switch-map': ['workspace' | 'home']
  'switch-theme': [BackgroundTheme]
}>()

const {
  globalConfig, projectConfig, globalSrcs, projectSrcs, globalMissing, projectMissing,
} = useBackground()
const WORKSPACE_REGIONS = BACKGROUND_WORKSPACE_TARGETS.map((target) => ({
  target,
  label: BACKGROUND_TARGET_LABELS[target],
}))

function projectTarget(target: BackgroundTarget) {
  return props.scope === 'project' ? projectConfig.value?.targets[target] : undefined
}

/** 预览范围跟随编辑范围：项目自定义看项目图，其余看全局图 */
function previewScope(target: BackgroundTarget): 'global' | 'project' {
  return projectTarget(target) ? 'project' : 'global'
}

type TargetStateKey = 'follow' | 'missing' | 'unset' | 'on' | 'off'

const toolbarModeBadge = computed(() => (
  props.toolbarMode === 'overlay' ? '悬浮'
    : props.toolbarMode === 'none' ? '隐藏'
      : props.toolbarMode === 'unavailable' ? '无视图'
        : ''
))

function regionTitle(target: BackgroundTarget): string {
  const base = `${BACKGROUND_TARGET_LABELS[target]}：${stateOf(target).text}`
  return target === 'content-toolbar' && toolbarModeBadge.value
    ? `${base}；${toolbarModeBadge.value}工具条`
    : base
}

/** 区域状态口径：项目跟随 > 两主题缺图 > 无图 > 启用开关 */
function stateOf(target: BackgroundTarget): { key: TargetStateKey; text: string } {
  const custom = projectTarget(target)
  if (props.scope === 'project' && !custom) return { key: 'follow', text: '跟随' }
  const cfg = custom ?? globalConfig.value.targets[target]
  const src = custom ? projectSrcs.value[target] : globalSrcs.value[target]
  const miss = custom ? projectMissing.value[target] : globalMissing.value[target]
  if (miss.light && miss.dark) return { key: 'missing', text: '缺图' }
  if (!src.light && !src.dark) return { key: 'unset', text: '未设置' }
  return cfg.enabled ? { key: 'on', text: '开' } : { key: 'off', text: '关' }
}
</script>

<style scoped src="./background-target-map.css"></style>
