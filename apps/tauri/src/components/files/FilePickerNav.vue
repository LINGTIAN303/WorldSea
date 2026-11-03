<template>
  <!-- 导航行：后退 / 前进 / 上级 / 可编辑路径 / 刷新 -->
  <div class="fp-nav">
    <button class="fp-icon-btn" title="后退" :disabled="historyIndex <= 0" @click="emit('back')">
      <WsIcon name="arrow-left" size="sm" />
    </button>
    <button class="fp-icon-btn" title="前进" :disabled="historyIndex >= historyLength - 1" @click="emit('forward')">
      <WsIcon name="arrow-right" size="sm" />
    </button>
    <button class="fp-icon-btn" title="上一级" :disabled="!canGoUp" @click="emit('up')">
      <WsIcon name="chevron-up" size="sm" />
    </button>
    <input
      v-model="pathDraft"
      class="fp-path"
      spellcheck="false"
      aria-label="当前路径（可直接编辑后回车跳转）"
      @keydown.enter.prevent="emit('commitPath')"
      @keydown.esc.prevent="emit('resetPath')"
    />
    <button class="fp-icon-btn" title="刷新" @click="emit('reload')">
      <WsIcon name="refresh" size="sm" />
    </button>
  </div>

  <!-- 搜索行：当前目录内按名称过滤（不递归；切换目录自动清空）+ 视图切换 -->
  <div class="fp-search-row">
    <div class="fp-search-wrap">
      <WsIcon name="search" size="xs" class="fp-search-icon" />
      <input
        v-model="query"
        class="fp-search"
        type="search"
        spellcheck="false"
        placeholder="在当前文件夹中搜索名称"
        aria-label="在当前文件夹中搜索"
      />
      <button v-if="query" class="fp-search-clear" title="清除搜索" @click="query = ''">
        <WsIcon name="close" size="xs" />
      </button>
    </div>
    <!-- 视图切换：详细信息列表 / 缩略图网格（aria-pressed 标注当前态） -->
    <div class="fp-view-toggle" role="group" aria-label="视图模式">
      <button
        class="fp-view-btn"
        :class="{ on: viewMode === 'list' }"
        :aria-pressed="viewMode === 'list'"
        title="详细信息视图"
        @click="emit('setViewMode', 'list')"
      ><WsIcon name="list" size="xs" /></button>
      <button
        class="fp-view-btn"
        :class="{ on: viewMode === 'grid' }"
        :aria-pressed="viewMode === 'grid'"
        title="缩略图网格视图"
        @click="emit('setViewMode', 'grid')"
      ><WsIcon name="grid" size="xs" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{
  historyIndex: number
  historyLength: number
  canGoUp: boolean
  viewMode: 'list' | 'grid'
}>()

const pathDraft = defineModel<string>('pathDraft', { required: true })
const query = defineModel<string>('query', { required: true })

const emit = defineEmits<{
  back: []
  forward: []
  up: []
  reload: []
  commitPath: []
  resetPath: []
  setViewMode: [mode: 'list' | 'grid']
}>()
</script>
