<!--
  BlockVideo.vue - 视频展示组件
  用于在聊天消息中渲染 AI 生成的视频块。支持展开/折叠切换、全屏预览和导出保存。

  功能:
  - 默认折叠，点击标题栏展开
  - 全屏预览：点击视频进入全屏模式
  - 导出保存：从 IndexedDB 取 Blob 下载，降级为从 src 下载
-->
<template>
  <div class="block-video" @contextmenu.prevent="onContextMenu">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon"><WsIcon name="video" size="xs" /></span>
      <span class="block-title">{{ block.caption || '视频' }}</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div class="video-wrap" @click="toggleFullscreen">
          <video
            ref="videoRef"
            :src="block.src"
            class="block-video-el"
            controls
            preload="metadata"
            @loadedmetadata="onLoadedMetadata"
            @play="isPlaying = true"
            @pause="isPlaying = false"
          />
          <div class="video-overlay" v-if="!isPlaying">
            <span class="play-icon">▶</span>
          </div>
        </div>
        <div class="video-actions">
          <button class="video-action-btn" @click="exportVideo" title="导出保存">
            <WsIcon name="download" size="xs" /> 导出
          </button>
          <button class="video-action-btn" @click="toggleFullscreen" title="全屏预览">
            <WsIcon name="maximize" size="xs" /> 放大
          </button>
        </div>
        <span v-if="block.caption" class="video-caption">{{ block.caption }}</span>
        <span v-if="duration > 0" class="video-meta">{{ formatDuration(duration) }}</span>
      </div>
    </Transition>
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="menuVisible" class="video-ctx-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }" @click.stop>
        <button class="ctx-item" @click="exportVideo">导出保存</button>
        <button class="ctx-item" @click="toggleFullscreen">全屏预览</button>
        <button class="ctx-item" @click="copySrc">复制链接</button>
      </div>
    </Teleport>
    <!-- 全屏遮罩 -->
    <Teleport to="body">
      <div v-if="fullscreenOpen" class="video-fullscreen-overlay" @click.self="fullscreenOpen = false">
        <video
          :src="block.src"
          class="video-fullscreen-el"
          controls
          autoplay
        />
        <button class="fullscreen-close" @click="fullscreenOpen = false">✕</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { VideoBlock } from '@worldsmith/agent-runtime'
import { getVideo, urlToBlob } from '@worldsmith/agent-runtime/stores/video-persistence'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ block: VideoBlock }>()

const expanded = ref(false)
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const fullscreenOpen = ref(false)
const videoRef = ref<HTMLVideoElement>()
const isPlaying = ref(false)
const duration = ref(0)

function onContextMenu(e: MouseEvent): void {
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
  const close = () => { menuVisible.value = false; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

function onLoadedMetadata(): void {
  if (videoRef.value) {
    duration.value = videoRef.value.duration
  }
}

function toggleFullscreen(): void {
  fullscreenOpen.value = true
}

function buildFilename(): string {
  const caption = props.block.caption || 'video'
  const sanitized = caption.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 60)
  return `${sanitized}.mp4`
}

async function exportVideo(): Promise<void> {
  menuVisible.value = false
  const filename = buildFilename()
  try {
    const persisted = await getVideo(props.block.id)
    if (persisted?.blob) {
      downloadBlobLocal(persisted.blob, filename)
      return
    }
    if (persisted?.remoteUrl) {
      const blob = await urlToBlob(persisted.remoteUrl)
      downloadBlobLocal(blob, filename)
      return
    }
    // 降级：直接从 src 下载
    const resp = await fetch(props.block.src)
    const blob = await resp.blob()
    downloadBlobLocal(blob, filename)
  } catch {
    // 最终降级：打开新窗口
    try { window.open(props.block.src, '_blank') } catch {}
  }
}

function downloadBlobLocal(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function copySrc(): void {
  menuVisible.value = false
  const src = props.block.src
  if (src.startsWith('data:')) {
    navigator.clipboard.writeText('[base64 视频数据]').catch(() => {})
  } else {
    navigator.clipboard.writeText(src).catch(() => {})
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.block-video { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(225, 112, 85, 0.08); border: 1px solid rgba(225, 112, 85, 0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(225, 112, 85, 0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: #e17055; font-weight: 500; }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 8px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(225, 112, 85, 0.2);
  border-radius: 8px; text-align: center;
}
.video-wrap {
  position: relative; cursor: pointer; display: inline-block;
}
.block-video-el {
  max-width: 100%; max-height: 300px; border-radius: 6px; object-fit: contain;
}
.video-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.2); border-radius: 6px; transition: opacity 0.2s;
}
.video-wrap:hover .video-overlay { opacity: 0; }
.play-icon {
  font-size: 32px; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.video-actions {
  display: flex; gap: 8px; justify-content: center; margin-top: 6px;
}
.video-action-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 12px; border: 1px solid rgba(225, 112, 85, 0.2);
  background: rgba(225, 112, 85, 0.06); color: #e17055; font-size: 11px;
  cursor: pointer; transition: background 0.15s;
}
.video-action-btn:hover { background: rgba(225, 112, 85, 0.15); }
.video-caption { display: block; font-size: 11px; color: var(--agent-text-tertiary, #888); margin-top: 4px; }
.video-meta { display: block; font-size: 10px; color: var(--agent-text-tertiary, #666); margin-top: 2px; }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
.video-ctx-menu {
  position: fixed; z-index: 10000;
  background: rgba(20,20,30,0.96); border: 1px solid rgba(225, 112, 85, 0.3);
  border-radius: 8px; padding: 4px 0; min-width: 160px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5); backdrop-filter: blur(8px);
}
.ctx-item {
  display: block; width: 100%; padding: 8px 14px; border: none; background: none;
  color: #ddd; font-size: 13px; text-align: left; cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover { background: rgba(225, 112, 85, 0.2); color: #fff; }
.video-fullscreen-overlay {
  position: fixed; inset: 0; z-index: 10001;
  background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center;
}
.video-fullscreen-el {
  max-width: 95vw; max-height: 90vh; border-radius: 8px;
}
.fullscreen-close {
  position: absolute; top: 16px; right: 16px;
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.6);
  color: #fff; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.fullscreen-close:hover { background: rgba(255,255,255,0.15); }
</style>
