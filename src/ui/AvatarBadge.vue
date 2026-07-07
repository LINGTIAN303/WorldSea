<template>
  <div class="avatar-badge" :class="[`shape-${shape}`]" :style="badgeStyle">
    <img v-if="src" :src="src" class="avatar-img" alt="" />
    <span v-else class="avatar-text" :style="textStyle">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getAvatarText, getAvatarColor } from './avatar'

/**
 * 统一头像组件
 *
 * 替代多处分散的头像渲染（SpaceNavbar agent-avatar / UserProfilePopover profile-avatar /
 * CreateAgentDialog avatar-circle / GroupMessageBubble speaker-avatar / AgentMessageBubble msg-icon）。
 *
 * 渲染规则：
 * - 提供 src（图片 URL/base64）→ 显示 <img>
 * - 否则 → 显示文字（avatar 文字 或 name 首字 或 '?'）+ 背景色
 *
 * 存储引用（avatar://xxx）的异步解析由调用方通过 useAvatarImage composable 完成，
 * 解析后传入 src；本组件只负责展示。
 */
const props = withDefaults(defineProps<{
  /** 图片源（URL / base64）；提供则显示图片，否则显示文字 */
  src?: string | null
  /** avatar 字段（图片/文字/引用）；src 未提供时用于推导文字 */
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

const text = computed(() => getAvatarText(props.avatar, props.name))
const bgColor = computed(() => getAvatarColor(props.color, props.role))

const badgeStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  background: props.src ? 'transparent' : bgColor.value,
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
