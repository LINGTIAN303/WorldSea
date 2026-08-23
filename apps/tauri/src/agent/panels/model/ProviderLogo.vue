<template>
  <img v-if="iconUrl" :src="iconUrl" class="provider-logo provider-logo--img" :style="imgStyle" :alt="props.provider" :aria-hidden="true" />
  <span v-else class="provider-logo" :style="styleObj" :aria-hidden="true">
    <slot>{{ glyph }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { providerIconUrl } from './providerIconUrl'

const props = withDefaults(defineProps<{
  provider: string
  size?: number
  label?: string
}>(), {
  size: 20,
  label: '',
})

/** 常见品牌色（16 进制）；未收录且无官方图标时用中性灰 */
const BRAND: Record<string, string> = {
  anthropic: '#D97757',
  openai: '#10A37F',
  google: '#4285F4',
  deepseek: '#4D6BFE',
  groq: '#F55036',
  openrouter: '#7A5AF8',
  zhipu: '#3D7FFF',
  qwen: '#635BFF',
  minimax: '#FF6A00',
  kimi: '#1C1C1C',
  agnes: '#3B82F6',
  sensenova: '#E4002B',
  doubao: '#325AB4',
  xai: '#111111',
  mistral: '#FF7000',
  stepfun: '#4E3CF5',
  kling: '#6C5CE7',
  longcat: '#FFB100',
  siliconflow: '#00B5E2',
  tencentcloud: '#006EFF',
  modelscope: '#FF7500',
  mimo: '#FF6B00',
  dots: '#FF2442',
}

const iconUrl = computed(() => providerIconUrl(props.provider))
const color = computed(() => BRAND[props.provider?.toLowerCase()] || '#8A8F98')
const glyph = computed(() => {
  const s = props.label || props.provider || ''
  const cleaned = s.replace(/[企业·服务]/g, '').trim()
  return (cleaned[0] || 'A').toUpperCase()
})
const imgStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))
const styleObj = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.52)}px`,
  background: `${color.value}18`,
  color: color.value,
  border: `1px solid ${color.value}55`,
}))
</script>

<style scoped>
.provider-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 6px;
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
.provider-logo--img {
  object-fit: contain;
  background: transparent;
  border: none;
  border-radius: 3px;
}
</style>