<template>
  <!--
    BlockImage.vue - 图片展示组件
    用于在聊天消息中渲染 AI 生成的图片块。支持展开/折叠切换和右键菜单操作。

    功能:
    - 默认折叠，点击标题栏展开
    - 右键菜单：导出保存、复制图片、复制链接
    - 导出保存优先从 IndexedDB 取 Blob（高品质原图），降级为从 src 下载
    - 使用 Teleport 将右键菜单渲染到 body，避免被父容器裁剪
  -->
  <div class="block-image" @contextmenu.prevent="onContextMenu">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon"><WsIcon name="image" size="xs" /></span>
      <span class="block-title">{{ block.caption || block.alt || '图片' }}</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" ref="contentRef" class="block-content">
        <A2UIResolvedImage :src="block.src" :alt="block.alt || ''" img-class="block-img" @click="onImageClick" />
        <span v-if="block.caption" class="img-caption">{{ block.caption }}</span>
      </div>
    </Transition>
    <!-- 右键菜单，使用 Teleport 渲染到 body 以确保 z-index 生效 -->
    <Teleport to="body">
      <div v-if="menuVisible" class="img-ctx-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }" @click.stop>
        <button class="ctx-item" @click="exportImage">导出保存</button>
        <button class="ctx-item" @click="copyImage">复制图片</button>
        <button class="ctx-item" @click="copySrc">复制链接</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ImageBlock } from '@worldsmith/agent-runtime'
import { getImage, downloadBlob, srcToBlob } from '@worldsmith/agent-runtime/stores/image-persistence'
import A2UIResolvedImage from '../a2ui/A2UIResolvedImage.vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ block: ImageBlock }>()

/** 图片是否已展开 */
const expanded = ref(false)
/** 右键菜单是否可见 */
const menuVisible = ref(false)
/** 菜单 X 坐标 */
const menuX = ref(0)
/** 菜单 Y 坐标 */
const menuY = ref(0)
/** 图片 DOM 引用 */
const contentRef = ref<HTMLElement>()

/** 获取已渲染的 <img> 元素 */
function getImgEl(): HTMLImageElement | null {
  return contentRef.value?.querySelector('img.block-img') || null
}

/** 右键菜单打开，自动在下次点击时关闭 */
function onContextMenu(e: MouseEvent): void {
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
  const close = () => { menuVisible.value = false; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

/** 点击图片收起右键菜单 */
function onImageClick(): void {
  menuVisible.value = false
}

/** 根据图片标题生成安全的文件名 */
function buildFilename(): string {
  const caption = props.block.caption || props.block.alt || 'image'
  const sanitized = caption.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 60)
  return `${sanitized}.png`
}

/** 从 Canvas 异步获取 Blob */
function canvasToBlob(img: HTMLImageElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    } catch {
      // Canvas tainted 或其他错误
      resolve(null)
    }
  })
}

/** 用 crossOrigin="anonymous" 重新加载远程图片，成功后可通过 Canvas 提取 */
function loadCrossOriginImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** 导出保存图片到本地
 *  优先级：
 *  1. IndexedDB 原始 Blob（最高质量）
 *  2. 从已渲染的 <img> 元素通过 Canvas 提取（Blob URL 同源时有效）
 *  3. 用 crossOrigin="anonymous" 重新加载远程图片 + Canvas 提取
 *  4. fetch→blob（仅同源或 CORS 允许时有效）
 *  5. data URL 直接下载
 *  6. 最终降级：新窗口打开
 */
async function exportImage(): Promise<void> {
  menuVisible.value = false
  const filename = buildFilename()

  try {
    // 1. 优先从 IndexedDB 获取原始 Blob
    const persisted = await getImage(props.block.id)
    if (persisted?.blob) {
      downloadBlob(persisted.blob, filename)
      return
    }

    // 2. 从已渲染的 <img> 元素通过 Canvas 提取（Blob URL 同源时有效）
    const imgEl = getImgEl()
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      const blob = await canvasToBlob(imgEl)
      if (blob) {
        downloadBlob(blob, filename)
        return
      }
    }

    // 3. 远程 URL：用 crossOrigin="anonymous" 重新加载 + Canvas 提取
    const src = props.block.src
    if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
      const crossImg = await loadCrossOriginImage(src)
      if (crossImg) {
        const blob = await canvasToBlob(crossImg)
        if (blob) {
          downloadBlob(blob, filename)
          return
        }
      }
    }

    // 4. data URL 可直接下载
    if (src.startsWith('data:')) {
      const a = document.createElement('a')
      a.href = src
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return
    }

    // 5. 尝试 fetch→blob（同源或 CORS 允许时有效）
    try {
      const blob = await srcToBlob(src)
      downloadBlob(blob, filename)
      return
    } catch {
      // fetch 失败，继续降级
    }

    // 6. 最终降级：新窗口打开
    window.open(src, '_blank')
  } catch {
    try { window.open(props.block.src, '_blank') } catch {}
  }
}

/** 复制图片到剪贴板
 *  优先从 IndexedDB 获取，降级为 Canvas 提取，再降级为 fetch
 */
async function copyImage(): Promise<void> {
  menuVisible.value = false
  try {
    const persisted = await getImage(props.block.id)
    if (persisted?.blob) {
      await navigator.clipboard.write([new ClipboardItem({ [persisted.blob.type]: persisted.blob })])
      return
    }
    // 从 Canvas 提取
    const imgEl = getImgEl()
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      const blob = await canvasToBlob(imgEl)
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        return
      }
    }
    // fetch 降级
    const blob = await srcToBlob(props.block.src)
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {}
}

/** 复制图片链接到剪贴板。
 *  Data URL 过长，仅展示 [base64 图片数据] 提示符
 */
function copySrc(): void {
  menuVisible.value = false
  const src = props.block.src
  if (src.startsWith('data:')) {
    navigator.clipboard.writeText('[base64 图片数据]').catch(() => {})
  } else {
    navigator.clipboard.writeText(src).catch(() => {})
  }
}
</script>

<style scoped>
.block-image { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 8px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px; text-align: center;
}
.block-img { max-width: 100%; max-height: 300px; border-radius: 6px; object-fit: contain; cursor: pointer; }
.img-caption { display: block; font-size: 11px; color: var(--agent-text-tertiary, #888); margin-top: 4px; }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
.img-ctx-menu {
  position: fixed; z-index: 10000;
  background: rgba(20,20,30,0.96); border: 1px solid rgba(108,92,231,0.3);
  border-radius: 8px; padding: 4px 0; min-width: 160px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5); backdrop-filter: blur(8px);
}
.ctx-item {
  display: block; width: 100%; padding: 8px 14px; border: none; background: none;
  color: #ddd; font-size: 13px; text-align: left; cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover { background: rgba(108,92,231,0.2); color: #fff; }
</style>
