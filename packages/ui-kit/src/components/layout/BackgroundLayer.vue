<template>
  <div v-if="visible" class="ws-bg-layer" :class="`ws-bg-layer--${target}`" aria-hidden="true">
    <div class="ws-bg-layer__image"></div>
    <div class="ws-bg-layer__shade"></div>
  </div>
</template>

<script setup lang="ts">
/** 目标背景层：五目标通用；是否显示由 store 的生效配置/运行时 URL/缺失态决定。 */
import { computed } from 'vue'
import { useBackground, type BackgroundTarget } from '@worldsea/style-kit'

const props = withDefaults(defineProps<{ target: BackgroundTarget; preview?: boolean }>(), { preview: false })
const { effective, srcs, missing } = useBackground()
// 任一主题有图且并非两主题都缺失才显示；预览模式忽略启用开关（设置卡预览用）
const visible = computed(() => {
  const cfg = effective.value[props.target]
  const src = srcs.value[props.target]
  const miss = missing.value[props.target]
  const hasSrc = !!(src.light || src.dark) && !(miss.light && miss.dark)
  return props.preview ? hasSrc : cfg.enabled && hasSrc
})
</script>
