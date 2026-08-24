<template>
  <div class="avatar-badge" :class="[`shape-${shape}`]" :style="badgeStyle">
    <img v-if="imgSrc" :src="imgSrc" class="avatar-img" :alt="text" :aria-label="text" />
    <span v-else class="avatar-text" :style="textStyle">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getAvatarText, getAvatarColor } from './avatar'
import { useAvatarImage } from '../composables/useAvatarImage'
import blackLogoUrl from '@/assets/WorldSmithLogo.svg'
import whiteLogoUrl from '@/assets/WorldSmithLogoWhite.svg'

/** 统一头像组件（渲染规则与 avatar:// 解析见 ui/avatar.ts） */
const props = withDefaults(defineProps<{
  /** 图片源（URL / base64 / object URL）；外部已解析时传入，优先级高于 avatar 内部解析 */
  src?: string | null
  /** avatar 字段原值（图片 URL/base64/`avatar://` 引用/文字）；内部自动解析 */
  avatar?: string | null
  /** 名称（文字首字 fallback；brand 时保留作语义标识/alt） */
  name?: string | null
  /** 背景色（无图片时，支持纯色或 gradient） */
  color?: string | null
  /** 角色（决定默认背景色） */
  role?: 'agent' | 'user'
  /** 品牌化：无真实头像图片时用 WorldSmith logo 作占位（自动黑白变体），保留 name 作标识 */
  brand?: boolean
  /** 尺寸 px */
  size?: number
  /** 文字字体（Agent 可传 persona 字体） */
  fontFamily?: string | null
  /** 形状 */
  shape?: 'circle' | 'rounded'
}>(), {
  size: 32,
  shape: 'circle',
  role: 'agent',
  brand: false,
})

// 内部解析 avatar 原值（支持 avatar:// 引用异步解析为 object URL）
const resolvedSrc = useAvatarImage(() => props.avatar)
// 外部 src 优先，否则用内部解析结果（真实图片地址）
const displaySrc = computed(() => props.src || resolvedSrc.value)

// 主题跟随：无真实头像且 brand 时用黑白 logo
const isDark = ref(detectDark())
let themeObserver: MutationObserver | null = null
function detectDark(): boolean {
  const theme = document.documentElement.dataset.theme
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
onMounted(() => {
  themeObserver = new MutationObserver(() => { isDark.value = detectDark() })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => { themeObserver?.disconnect(); themeObserver = null })

// 最终显示图：真实图片优先；brand 无图时用 logo
const imgSrc = computed(() => {
  if (displaySrc.value) return displaySrc.value
  if (props.brand) return isDark.value ? whiteLogoUrl : blackLogoUrl
  return ''
})

const text = computed(() => getAvatarText(props.avatar, props.name))
const bgColor = computed(() => getAvatarColor(props.color, props.role))
// brand 无真实图时用中性圆底（纯 logo 圆底），配 logo 黑白变体保证对比
const brandRoundBg = computed(() => props.brand && !displaySrc.value)

const badgeStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  background: displaySrc.value
    ? 'transparent'
    : brandRoundBg.value
      ? 'var(--color-surface-elevated)'
      : bgColor.value,
}))

const textStyle = computed(() => ({
  fontSize: Math.round(props.size * 0.5) + 'px',
  fontFamily: props.fontFamily || undefined,
}))
</script>

<style scoped>
.avatar-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--on-accent);
  font-weight: 600;
  user-select: none;
}
.shape-circle { border-radius: 50%; }
.shape-rounded { border-radius: var(--radius-sm); }
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-text {
  line-height: 1;
  color: var(--on-accent);
}
</style>
