<template>
  <CardDeck :count="2" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <!-- slot 按 count 循环渲染，内容必须按 idx 互斥分支（否则每个循环都输出全部卡，.sc-head 重复进左列） -->
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('动画效果 减弱 动态 动画 动效 消息 脉冲 状态 面板 侧边栏 弹窗 控件 启动 眩晕 降低 可访问 reduce motion animation accessibility') : match('面板翻卡 翻卡 滚轮 滚动 边缘 二次 松开 误触 翻页 可访问 accessibility')">
        <template v-if="idx === 0">
          <div class="sc-head">动画效果</div>
          <div class="set-row">
            <span>减弱动态效果</span>
            <label class="set-toggle">
              <input type="checkbox" v-model="store.reduceMotion" />
              <span class="set-toggle-slider"></span>
            </label>
          </div>
          <p class="set-hint">开启后关闭全部界面动效（全局减弱）；关闭时保留动画，可按下述分组逐项关闭。</p>
          <div v-for="(label, key) in ANIMATION_GROUPS" :key="key" class="set-row">
            <span>{{ label }}</span>
            <label class="set-toggle">
              <input type="checkbox" :checked="!!store.animations[key]" @change="onAnimToggle(key, ($event.target as HTMLInputElement).checked)" />
              <span class="set-toggle-slider"></span>
            </label>
          </div>
          <p class="set-hint">关闭某类动画（如消息与对话）即禁用对应组件的动效，其余保持正常。</p>
        </template>
        <template v-else-if="idx === 1">
          <div class="sc-head">面板翻卡</div>
          <div class="set-row">
            <span>滚轮翻卡防误触</span>
            <label class="set-toggle">
              <input type="checkbox" v-model="store.deckWheelGateEnabled" />
              <span class="set-toggle-slider"></span>
            </label>
          </div>
          <p class="set-hint">开启后，卡片内容滚到边缘不会立即翻卡——停顿（松手）后再次滚动才翻到下一张，避免长内容惯性滚动时连环误翻；关闭则滚到边缘立即翻卡。</p>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
/**
 * AccessibilityPanel — 设置「无障碍」Tab（2026-09-06 自 apps/tauri 迁入 ui-kit）。
 * 面板三契约：goToCard / searchQuery 过滤 / dirty 上报（动效开关变更时上报设置弹窗）。
 */
import { ref, watch } from 'vue'
import { CardDeck } from '@worldsea/ui-kit'
import { useSettingsStore, ANIMATION_GROUPS } from '@worldsea/entity-core'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

const store = useSettingsStore()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

// 动效开关变更 → dirty 上报（animations 为整体替换，浅层监听即可捕获）
watch(
  () => [store.reduceMotion, store.animations] as const,
  () => emit('dirty'),
)

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.toLowerCase()
  return keywords.toLowerCase().split(/\s+/).some((k) => q.includes(k))
}

/** 逐项开关：整体替换 animations 对象（触发 App 层根属性同步） */
function onAnimToggle(key: string, val: boolean): void {
  store.animations = { ...store.animations, [key]: val }
}
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）见 ui-kit settings-panels.css，此处仅保留面板私有样式 */
</style>
