<template>
  <div class="avatar-badge" :class="[`shape-${shape}`]" :style="badgeStyle">
    <img v-if="displaySrc" :src="displaySrc" class="avatar-img" alt="" />
    <span v-else class="avatar-text" :style="textStyle">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getAvatarText, getAvatarColor } from './avatar'
import { useAvatarImage } from '../composables/useAvatarImage'

/**
 * 统一头像组件
 *
 * 替代多处分散的头像渲染（SpaceNavbar agent-avatar / UserProfilePopover profile-avatar /
 * CreateAgentDialog avatar-circle / GroupMessageBubble speaker-avatar / AgentMessageBubble msg-icon）。
 *
 * 渲染规则：
 * - avatar 为图片源（URL/base64/`avatar://` 引用）→ 内部 useAvatarImage 解析为可显示 src → 显示 <img>
 * - avatar 为文字/空 → 显示文字（avatar 文字 或 name 首字 或 '?'）+ 背景色
 * - 外部 src prop（若有）优先级最高，覆盖内部解析（用于外部已解析的直接图片）
 *
 * `avatar://xxx` 存储引用由内部 useAvatarImage 异步解析为 object URL（含生命周期管理），
 * 调用方只需传 avatar 原值，无需自行解析。
 */
const props = withDefaults(defineProps<{
  /** 图片源（URL / base64 / object URL）；外部已解析时传入，优先级高于 avatar 内部解析 */
  src?: string | null
  /** avatar 字段原值（图片 URL/base64/`avatar://` 引用/文字）；内部自动解析 */
  avatar?: string | null
  /** 名称（文字首字 fallback） */
  name?: string | null
  /** 背景色（无图片时，支持纯色或 gradient） */
  color?: string | null
  /** 角色（决定默认背景色） */
  role?: 'agent' | 'user'
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
})

// 内部解析 avatar 原值（支持 avatar:// 引用异步解析为 object URL）
const resolvedSrc = useAvatarImage(() => props.avatar)
// 外部 src 优先，否则用内部解析结果
const displaySrc = computed(() => props.src || resolvedSrc.value)

const text = computed(() => getAvatarText(props.avatar, props.name))
const bgColor = computed(() => getAvatarColor(props.color, props.role))

const badgeStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  background: displaySrc.value ? 'transparent' : bgColor.value,
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
  color: #fff;
  font-weight: 600;
  user-select: none;
}
.shape-circle { border-radius: 50%; }
.shape-rounded { border-radius: 6px; }
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-text {
  line-height: 1;
  color: #fff;
}
</style>
