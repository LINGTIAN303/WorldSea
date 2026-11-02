<template><BackgroundLayer target="canvas" :preview="preview" class="workspace-bg" /></template>

<script setup lang="ts">
/** v1 兼容薄包装：旧设置卡与调用方仍按「工作台画布」消费；保留 .workspace-bg 供其预览样式定位。 */
import BackgroundLayer from './BackgroundLayer.vue'

withDefaults(defineProps<{ preview?: boolean }>(), { preview: false })
</script>
