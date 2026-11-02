<template>
  <div v-if="visible" class="ws-bg-layer" :class="`ws-bg-layer--${target}`" :style="scopeStyle" aria-hidden="true">
    <div class="ws-bg-layer__image"></div>
    <div class="ws-bg-layer__shade"></div>
  </div>
</template>

<script setup lang="ts">
/** 目标背景层：六目标通用；是否显示由生效配置或指定范围的运行时态决定。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useBackground, type BackgroundTarget } from '@worldsea/style-kit'

type PreviewScope = 'effective' | 'global' | 'project'

const props = withDefaults(defineProps<{ target: BackgroundTarget; preview?: boolean; scope?: PreviewScope }>(), {
  preview: false,
  scope: 'effective',
})
const { effective, srcs, missing, globalConfig, projectConfig, globalSrcs, projectSrcs, globalMissing, projectMissing } = useBackground()

// 非生效范围由层自己挑亮/暗图（根变量只承载生效配置），故监听 data-theme
const dark = ref(false)
let themeObserver: MutationObserver | null = null
function syncTheme() {
  dark.value = document.documentElement.dataset.theme === 'dark'
}
function teardownThemeObserver() {
  themeObserver?.disconnect()
  themeObserver = null
}
// 生效范围的亮暗由根变量样式表处理，只有指定范围才需要观察主题
watch(() => props.scope, (scope) => {
  teardownThemeObserver()
  if (scope === 'effective') return
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}, { immediate: true })
onBeforeUnmount(teardownThemeObserver)

/** 指定范围的配置/运行时态；项目范围无自定义目标时返回 null（隐藏，不回退生效） */
const scoped = computed(() => {
  if (props.scope === 'global') {
    return {
      cfg: globalConfig.value.targets[props.target],
      src: globalSrcs.value[props.target],
      miss: globalMissing.value[props.target],
    }
  }
  if (props.scope === 'project') {
    const cfg = projectConfig.value?.targets[props.target]
    return cfg ? { cfg, src: projectSrcs.value[props.target], miss: projectMissing.value[props.target] } : null
  }
  return null
})

// 任一主题有图且并非两主题都缺失才显示；预览模式忽略启用开关（设置卡预览用）
const visible = computed(() => {
  const view = scoped.value
  if (!view) {
    if (props.scope === 'project') return false // 项目跟随全局：层隐藏，不回退生效配置
    const cfg = effective.value[props.target]
    const src = srcs.value[props.target]
    const miss = missing.value[props.target]
    const hasSrc = !!(src.light || src.dark) && !(miss.light && miss.dark)
    return props.preview ? hasSrc : cfg.enabled && hasSrc
  }
  const { cfg, src, miss } = view
  const hasSrc = !!(src.light || src.dark) && !(miss.light && miss.dark)
  return props.preview ? hasSrc : cfg.enabled && hasSrc
})

function sizeValue(fit: string): string {
  return fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'auto'
}

// 指定范围用内联 --layer-* 覆盖样式表里的根变量映射；主题缺图回退另一主题
const scopeStyle = computed(() => {
  const view = scoped.value
  if (!view) return undefined
  const { cfg, src } = view
  const image = dark.value ? src.dark || src.light : src.light || src.dark
  return {
    '--layer-image': `url("${image}")`,
    '--layer-size': sizeValue(cfg.fit),
    '--layer-repeat': cfg.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--layer-position': `${cfg.focusX}% ${cfg.focusY}%`,
    '--layer-dim': String(cfg.dim),
    '--layer-blur': `${cfg.blur}px`,
  }
})
</script>
