<template>
  <!-- 双格式渲染：主题 SVG 直接内联（尺寸随容器）；PNG 为 data URI 走 img（16px 原生尺寸） -->
  <img v-if="isPng" :src="data" class="file-icon" alt="" />
  <span v-else class="file-icon file-icon--svg" v-html="data" />
</template>

<!--
  FileIcon.vue（2026-09-07 下沉 ui-kit，供 apps 与 shared-ui 两端共用）：文件类型图标
  （vscode-great-icons 真实图标集，用户指定），数据源 ../assets/file-icon-data.ts（构建期从主题仓库
  提取：SVG 内联 + PNG base64，运行时零依赖零请求）；容器统一 16px 方格，svg/img 撑满对齐文本基线。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { fileIconDataOf } from '../assets/fileIcons'

const props = defineProps<{ name: string }>()

const data = computed(() => fileIconDataOf(props.name))
const isPng = computed(() => data.value.startsWith('data:image'))
</script>

<style scoped>
.file-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  vertical-align: -3px;
}
.file-icon--svg {
  line-height: 0;
}
.file-icon--svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
