<!--
  WorldSmithLogo.vue — WorldSmith 品牌 Logo（位图内嵌 SVG，像素无损）
  ─────────────────────────────────────────────────
  源图：src-tauri/icons/WorldSmith.svg（1536×1536 base64 内嵌 PNG，透明背景）
  深色主题下原图（黑形）不可见，故提供白色变体（WorldSmithLogoWhite.svg）按 tone 切换。
  用途：标题栏 / 启动页 / 关于页等内部展示。应用/托盘图标走 tauri bundle icon（PNG/ICO/ICNS）。
-->
<template>
  <img
    class="ws-logo"
    :src="logoUrl"
    :width="size"
    :height="size"
    :style="styleObj"
    :alt="alt"
    :aria-label="alt"
    draggable="false"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import blackLogoUrl from '@/assets/WorldSmithLogo.svg'
import whiteLogoUrl from '@/assets/WorldSmithLogoWhite.svg'

const props = withDefaults(
  defineProps<{
    /** 边长（px）；默认 16，标题栏等小场景够用 */
    size?: number
    /** 圆角（px），0=直角（默认） */
    radius?: number
    /** 替代文本 */
    alt?: string
    /** 颜色：auto=跟随主题（深色→白、浅色→黑）；black=固定黑形；white=固定白形 */
    tone?: 'auto' | 'black' | 'white'
  }>(),
  { size: 16, radius: 0, alt: 'WorldSmith', tone: 'auto' },
)

// 当前主题是否为深色（用于 auto 色调切换）
const isDark = ref(detectDark())
let themeObserver: MutationObserver | null = null

function detectDark(): boolean {
  const root = document.documentElement
  const theme = root.dataset.theme
  if (theme === 'dark') return true
  if (theme === 'light') return false
  // system 或无显式：跟随系统 prefers-color-scheme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

onMounted(() => {
  // 监听 data-theme 变更（useTheme 三态模型统一写在 html 上）
  themeObserver = new MutationObserver(() => {
    isDark.value = detectDark()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
})

const logoUrl = computed(() => {
  if (props.tone === 'white') return whiteLogoUrl
  if (props.tone === 'black') return blackLogoUrl
  return isDark.value ? whiteLogoUrl : blackLogoUrl
})

const styleObj = computed(() => {
  const s: Record<string, string> = {}
  if (props.radius) s.borderRadius = `${props.radius}px`
  return s
})
</script>

<style scoped>
.ws-logo {
  display: inline-block;
  flex-shrink: 0;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}
</style>
