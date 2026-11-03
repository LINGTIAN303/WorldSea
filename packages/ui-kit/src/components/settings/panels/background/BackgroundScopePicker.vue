<template>
  <!-- 范围：选图期间锁住范围/目标，保证选图结果落到发起时的目标 -->
  <div class="bg-scope bg-seg-row" role="group" aria-label="背景范围">
    <button class="bg-seg" :class="{ on: scope === 'global' }" :disabled="picking !== null" @click="emit('update:scope', 'global')">全局</button>
    <button
      class="bg-seg"
      :class="{ on: scope === 'project' }"
      :disabled="!hasProject || picking !== null"
      :title="hasProject ? '仅当前项目' : '未打开项目'"
      @click="emit('scopeProject')"
    >本项目</button>
  </div>
  <p v-if="!hasProject" class="set-hint">未打开项目，仅可设置全局背景。</p>

  <!-- 项目范围：跟随全局 / 本项目自定义 -->
  <template v-if="scope === 'project'">
    <div class="bg-project">
      <span class="bg-project__state">{{ isProjectCustom ? '本项目自定义中' : '当前跟随全局' }}</span>
      <button class="set-btn bg-project__btn" :disabled="picking !== null" @click="onToggleProjectCustom">
        {{ isProjectCustom ? '恢复跟随全局' : '本项目自定义' }}
      </button>
    </div>
    <p v-if="!isProjectCustom" class="set-hint">当前跟随全局；改为本项目自定义后可单独选图。</p>
    <p v-else-if="!hasAnyPath" class="set-hint">本项目自定义已继承全局参数，请为本项目重新选择图片。</p>
  </template>
</template>

<script setup lang="ts">
const props = defineProps<{
  scope: 'global' | 'project'
  hasProject: boolean
  isProjectCustom: boolean
  hasAnyPath: boolean
  picking: 'light' | 'dark' | null
}>()

const emit = defineEmits<{
  'update:scope': [scope: 'global' | 'project']
  scopeProject: []
  makeCustom: []
  followGlobal: []
}>()

function onToggleProjectCustom() {
  if (props.isProjectCustom) emit('followGlobal')
  else emit('makeCustom')
}
</script>
