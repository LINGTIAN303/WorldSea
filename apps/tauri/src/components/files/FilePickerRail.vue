<template>
  <!-- 左轨：最近访问 / 快捷位置 / 盘符（从 FilePickerHost 抽出，控制单文件规模） -->
  <div class="fp-rail">
    <div v-if="recentDirs.length" class="fp-rail-group">
      <div class="fp-rail-title">最近访问</div>
      <button
        v-for="dir in recentDirs"
        :key="dir"
        class="fp-rail-item"
        :class="{ on: samePath(dir, activePath) }"
        :title="dir"
        @click="$emit('navigate', dir)"
      >
        <WsIcon name="clock" size="xs" />
        <span>{{ railLabel(dir) }}</span>
      </button>
    </div>
    <div class="fp-rail-group">
      <div class="fp-rail-title">快捷位置</div>
      <button
        v-for="loc in quickLocations"
        :key="loc.id"
        class="fp-rail-item"
        :class="{ on: samePath(loc.path, activePath) }"
        :title="loc.path"
        @click="$emit('navigate', loc.path)"
      >
        <WsIcon :name="loc.icon" size="xs" />
        <span>{{ loc.label }}</span>
      </button>
    </div>
    <div class="fp-rail-group">
      <div class="fp-rail-title">此电脑</div>
      <button
        v-for="drive in drives"
        :key="drive.path"
        class="fp-rail-item"
        :class="{ on: driveRootOf(activePath) === normalizePath(drive.path) }"
        :title="driveTitle(drive)"
        @click="$emit('navigate', drive.path)"
      >
        <WsIcon name="cat-storage" size="xs" />
        <span>{{ drive.name }}</span>
      </button>
      <div v-if="drives.length === 0" class="fp-rail-empty">未取到盘符</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * FilePickerRail —— 选择器左轨子组件。
 * 只负责渲染与导航事件；路径归一/比较工具从 filePickerModel 引入。
 */
import { WsIcon } from '@worldsea/ui-kit'
import {
  driveRootOf,
  driveTitle,
  normalizePath,
  type DriveEntry,
  type QuickLocation,
} from './filePickerModel'

defineProps<{
  /** 最近实际做出选择的目录（新在前） */
  recentDirs: string[]
  /** 快捷位置 */
  quickLocations: QuickLocation[]
  /** 盘符列表 */
  drives: DriveEntry[]
  /** 当前目录（高亮判断） */
  activePath: string
}>()

defineEmits<{ navigate: [path: string] }>()

/** 真实路径比较口径（大小写与分隔符归一） */
function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()
}

/** 左轨标签：末两级路径，够区分又不会撑爆 168px 栏宽 */
function railLabel(path: string): string {
  const segs = normalizePath(path).split('/').filter(Boolean)
  return segs.slice(-2).join('/') || path
}
</script>
