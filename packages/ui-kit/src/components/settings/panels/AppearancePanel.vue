<template>
  <CardDeck :count="6" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('主题 theme 外观 底色 深色 浅色 跟随系统 强调色 颜色 编辑器 图谱 星图 眼睛 虹膜 iris 风格 材质 实体 形变 触感 拟态 玻璃 glass neu mist') : idx === 1 ? match('背景 图片 壁纸 背景图 wallpaper 填充 焦点 暗化 模糊 分区 窗口栏 侧栏 内容区 工具条 视图 大背景 首页 画布 亮色 暗色') : idx === 2 ? match('高亮 highlight 脉冲 动画 淡化 扩散 透明度') : true">
        <!-- 主题 -->
        <template v-if="idx === 0">
          <ThemeCard @dirty="emit('dirty')" />
        </template>
        <!-- 背景 -->
        <template v-else-if="idx === 1">
          <BackgroundCard />
        </template>
        <!-- 高亮 -->
        <template v-else-if="idx === 2">
          <div class="sc-head">高亮</div>
          <div class="set-row"><span>脉冲动画</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_pulseEnabled" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row"><span>启用淡化</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_dimmingEnabled" /><span class="set-toggle-slider"></span></label></div>
          <template v-if="store.highlight_dimmingEnabled">
            <div class="set-row"><span>淡化模式</span><select v-model="store.highlight_dimmingMode" class="set-select"><option value="simple">简单淡化</option><option value="spread">关系扩散</option></select></div>
            <div class="set-row"><span>淡化透明度</span><div class="set-range-wrap"><input type="range" min="0.1" max="0.5" step="0.05" v-model.number="store.highlight_dimOpacity" class="set-range" /><span class="set-range-val">{{ store.highlight_dimOpacity }}</span></div></div>
            <div v-if="store.highlight_dimmingMode === 'spread'" class="set-row"><span>扩散跳数</span><select v-model.number="store.highlight_spreadHops" class="set-select"><option :value="1">1 跳</option><option :value="2">2 跳</option><option :value="3">3 跳</option></select></div>
          </template>
        </template>
        <!-- 字体库 -->
        <template v-else-if="idx === 3">
          <FontLibraryCard @dirty="emit('dirty')" />
        </template>
        <!-- 字体分层 -->
        <template v-else-if="idx === 4">
          <FontLayersCard />
        </template>
        <!-- 卡片与预览：悬停形象预览 + 视频封面播放策略。
             注意：本卡只允许一个 sc-head（设置外壳左列目录按 sc-head 抓标题，多条会越位错卡）——
             视频封面/形象图追踪用 set-theme-sub 组内小标题 -->
        <template v-else>
          <div class="sc-head">卡片与预览</div>
          <div class="set-row"><span>悬停卡片显示形象图</span><label class="set-toggle"><input type="checkbox" v-model="store.entityCardHoverPreview" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row" v-if="store.entityCardHoverPreview"><span>预览框无框模式</span><label class="set-toggle"><input type="checkbox" v-model="store.hoverPreviewFrameless" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-theme-sub" style="margin-top:10px">视频封面</div>
          <div class="set-row"><span>卡片内自动播放</span><select v-model="store.videoCoverAutoplay" class="set-select"><option value="off">不自动播放（默认）</option><option value="all">全部实体</option><option value="selected">仅指定实体</option></select></div>
          <div class="set-row" v-if="store.videoCoverAutoplay === 'selected'" style="flex-direction:column;align-items:stretch"><span style="margin-bottom:4px">自动播放的实体（{{ store.videoCoverAutoplayEntities.length }}）</span><EntityMultiSelect v-model="store.videoCoverAutoplayEntities" /></div>
          <div class="set-row"><span>悬停卡片时播放</span><label class="set-toggle"><input type="checkbox" v-model="store.videoCoverHoverPlay" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-row"><span>滚动时暂停播放</span><label class="set-toggle"><input type="checkbox" v-model="store.videoCoverPauseOnScroll" /><span class="set-toggle-slider"></span></label></div>
          <div class="set-theme-sub" style="margin-top:10px">形象图追踪</div>
          <div class="set-row"><span>点击实体后浮层跟随鼠标</span><label class="set-toggle"><input type="checkbox" v-model="store.portraitFollowMouse" /><span class="set-toggle-slider"></span></label></div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@worldsea/entity-core'
import EntityMultiSelect from './EntityMultiSelect.vue'
import BackgroundCard from './BackgroundCard.vue'
import ThemeCard from './appearance/ThemeCard.vue'
import FontLibraryCard from './appearance/FontLibraryCard.vue'
import FontLayersCard from './appearance/FontLayersCard.vue'
import { CardDeck } from '@worldsea/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: []; 'card-change': [index: number] }>()

// ── 叠放翻卡：复用通用 CardDeck（翻卡逻辑/样式已下沉 ui-kit useCardDeck + CardDeck.vue） ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const store = useSettingsStore()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}
</script>

<style scoped src="./appearance-panel.css"></style>
