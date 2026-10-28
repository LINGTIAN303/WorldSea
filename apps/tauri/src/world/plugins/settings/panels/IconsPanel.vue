<template>
  <CardDeck :count="iconCards.length + 1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <template v-for="(card, i) in iconCards" :key="card.kind">
        <IconSlotCard
          v-if="idx === i"
          :class="cls"
          :title="card.title"
          :subtitle="card.subtitle"
          :placeholder="card.placeholder"
          :keywords="card.keywords"
          :search-query="searchQuery"
          :groups="groupsByKind[card.kind]"
          :icon-of="iconOf"
          :source-of="sourceOf"
          :has-global="hasGlobal"
          :empty-text="card.emptyText"
          @edit="openPicker"
          @reset="resetSlot"
        />
      </template>

      <div
        v-if="idx === iconCards.length"
        class="set-card deck-card ic-card"
        :class="cls"
        v-show="match(scopeKeywords)"
      >
        <IconScopeCard
          :follow-global="iconStore.project.followGlobal"
          :project-count="projectCount"
          :global-count="globalCount"
          :ignored-global-count="iconStore.project.followGlobal ? 0 : globalCount"
          @toggle-follow="onToggleFollow"
          @reset-project="onResetProject"
          @reset-defaults="onResetDefaults"
          @clear-global="onClearGlobal"
        />
      </div>
    </template>
  </CardDeck>

  <IconPicker
    :show="pickerOpen"
    :target="pickerTarget"
    @close="closePicker"
    @confirm="confirmPicker"
    @reset="resetPickerSlot"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { entitySchemaRegistryV2, pluginAPI, useIconOverrideStore, usePluginStore, useSettingsStore } from '@worldsea/entity-core'
import { CardDeck, matchKeywords, toastSuccess, useConfirm, ICON_DOMAIN_IDS, type IconDomain } from '@worldsea/ui-kit'
import { availablePlugins } from '@/world'
import {
  defaultSyncFor,
  groupDetailTabSlots,
  groupDomainSlots,
  groupEntityTypeSlots,
  groupRegionTypeSlots,
  groupSproutSlots,
  syncTargetKeys,
  type IconPickerConfirm,
  type IconPickerTarget,
  type IconSlotListGroup,
} from '@/world/iconPanelModel'
import {
  buildDetailTabIconSlots,
  buildDomainIconSlots,
  buildIconSlots,
  buildRegionTypeIconSlots,
  entityTypeSlotsOf,
  type IconSlot,
  type IconSlotKind,
} from '@/world/iconSlots'
import IconSlotCard from './IconSlotCard.vue'
import IconScopeCard from './IconScopeCard.vue'
import IconPicker from './IconPicker.vue'

interface IconCardConfig {
  kind: IconSlotKind
  title: string
  subtitle: string
  placeholder: string
  keywords: string
  emptyText: string
}

const iconCards: IconCardConfig[] = [
  {
    kind: 'sprout',
    title: '芽图标',
    subtitle: '侧栏 / 快捷访问 / 首页跟随',
    placeholder: '搜索芽...',
    keywords: '芽 sprout 图标 icon 侧栏 视图 sprout',
    emptyText: '没有匹配的芽图标',
  },
  {
    kind: 'entityType',
    title: '实体类型图标',
    subtitle: '卡片 / 关联 / 提及 / 详情头跟随',
    placeholder: '搜索实体类型...',
    keywords: '实体类型 图标 icon 实体 entity 卡片 关联 详情',
    emptyText: '没有匹配的实体类型图标',
  },
  {
    kind: 'domain',
    title: '语义域图标',
    subtitle: '侧栏域导航 / 首页资产地图 / 设置分组',
    placeholder: '搜索语义域...',
    keywords: '语义域 域 domain 地理 生命 社会 知识 物产 时间 叙事 工具 图标',
    emptyText: '没有匹配的语义域',
  },
  {
    kind: 'detailTab',
    title: '详情页签图标',
    subtitle: '通用页签一次设置，全部实体类型跟随',
    placeholder: '搜索页签或实体类型...',
    keywords: '详情 页签 tab 信息 形象 视频 关联 关系图 家谱 成员 外交 子区域 因果链 detail tab',
    emptyText: '没有匹配的详情页签',
  },
  {
    kind: 'regionType',
    title: '区域类型图标',
    subtitle: '区域树 / 卡片 / 子区域 / 飞地',
    placeholder: '搜索区域类型...',
    keywords: '区域 类型 region 大陆 国家 城市 地标 星球 星系 regionType',
    emptyText: '没有匹配的区域类型',
  },
]

const scopeKeywords = '作用范围 全局 项目 跟随 图标 icon global project'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
const pluginStore = usePluginStore()
const settings = useSettingsStore()
const iconStore = useIconOverrideStore()
const { confirm } = useConfirm()

const revision = ref(0)
const sproutSignature = computed(() => settings.sprouts
  .map(sprout => `${sprout.id}:${sprout.icon}:${sprout.label}:${sprout.active}`)
  .join('|'))
const pickerSlot = ref<IconSlot | null>(null)
const pickerOpen = computed(() => pickerSlot.value !== null)

const slots = computed(() => {
  void revision.value
  void pluginStore.views.length
  void sproutSignature.value
  const schemas = entitySchemaRegistryV2.getAll()
  return [
    ...buildIconSlots({
      views: pluginStore.views,
      sprouts: settings.sprouts,
      plugins: availablePlugins(),
      schemas,
    }),
    ...buildDomainIconSlots(),
    ...buildDetailTabIconSlots(schemas),
    ...buildRegionTypeIconSlots(),
  ]
})

const sproutIconByPlugin = computed(() => {
  const map = new Map<string, string>()
  for (const slot of slots.value) {
    if (slot.kind === 'sprout' && slot.pluginId) {
      map.set(slot.pluginId, iconStore.resolve(slot.key, slot.defaultIcon))
    }
  }
  return map
})

const groupsByKind = computed<Record<IconSlotKind, IconSlotListGroup[]>>(() => ({
  sprout: groupSproutSlots(slots.value),
  entityType: groupEntityTypeSlots(slots.value, availablePlugins()).map(group => ({
    id: group.pluginId || 'unclassified',
    label: group.label,
    icon: sproutIconByPlugin.value.get(group.pluginId),
    items: group.items,
  })),
  domain: groupDomainSlots(slots.value),
  detailTab: groupDetailTabSlots(slots.value),
  regionType: groupRegionTypeSlots(slots.value),
}))

const projectCount = computed(() => Object.keys(iconStore.project.overrides).length)
const globalCount = computed(() => Object.keys(iconStore.global.overrides).length)

const pickerTarget = computed<IconPickerTarget | null>(() => {
  const slot = pickerSlot.value
  if (!slot) return null
  const typeSlots = slot.kind === 'sprout' ? entityTypeSlotsOf(slots.value, slot.pluginId) : []
  const source = iconStore.sourceOf(slot.key)
  const current = iconStore.resolve(slot.key, slot.defaultIcon)
  const domain = ICON_DOMAIN_IDS.includes(slot.domain as IconDomain)
    ? slot.domain as IconDomain
    : undefined
  return {
    key: slot.key,
    kind: slot.kind,
    label: slot.label,
    current,
    source,
    domain,
    syncCount: typeSlots.length,
    syncDefault: defaultSyncFor(typeSlots, iconStore.sourceOf, s => iconStore.resolve(s.key, s.defaultIcon), current),
    canResetProject: source === 'project',
  }
})

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function iconOf(slot: IconSlot): string {
  return iconStore.resolve(slot.key, slot.defaultIcon)
}

function sourceOf(slot: IconSlot) {
  return iconStore.sourceOf(slot.key)
}

function hasGlobal(slot: IconSlot): boolean {
  return iconStore.hasGlobal(slot.key)
}

function openPicker(slot: IconSlot): void {
  pickerSlot.value = slot
}

function closePicker(): void {
  pickerSlot.value = null
}

function applyIcon(key: string, icon: string, applyGlobal: boolean): void {
  if (applyGlobal) iconStore.applyToGlobal(key, icon)
  else iconStore.setProjectIcon(key, icon)
}

function confirmPicker(payload: IconPickerConfirm): void {
  const slot = pickerSlot.value
  if (!slot) return
  const oldIcon = iconStore.resolve(slot.key, slot.defaultIcon)
  applyIcon(slot.key, payload.icon, payload.applyGlobal)
  let synced = 0
  if (slot.kind === 'sprout' && payload.syncTypes) {
    const typeSlots = entityTypeSlotsOf(slots.value, slot.pluginId)
    for (const key of syncTargetKeys(typeSlots, iconStore.sourceOf, s => iconStore.resolve(s.key, s.defaultIcon), oldIcon)) {
      applyIcon(key, payload.icon, payload.applyGlobal)
      synced++
    }
  }
  const scope = payload.applyGlobal ? '全局 + 本项目' : '本项目'
  toastSuccess(synced > 0 ? `已更新图标（${scope}），并同步 ${synced} 个实体类型` : `已更新图标（${scope}）`)
  closePicker()
}

function resetSlot(slot: IconSlot): void {
  iconStore.clearProjectIcon(slot.key)
  toastSuccess('已取消本项目图标设置')
}

function resetPickerSlot(): void {
  const slot = pickerSlot.value
  if (!slot) return
  iconStore.clearProjectIcon(slot.key)
  toastSuccess('已取消本项目图标设置')
  closePicker()
}

function onToggleFollow(value: boolean): void {
  if (!value) {
    const snapshotted = iconStore.setFollowGlobal(false)
    toastSuccess(snapshotted > 0
      ? `已停止跟随全局，并保留当前图标（快照 ${snapshotted} 项）`
      : '已停止跟随全局，本项目使用芽/实体类型默认')
    return
  }
  iconStore.setFollowGlobal(true)
  toastSuccess('已恢复跟随全局；本项目单独设置的图标仍优先')
}

async function onResetProject(): Promise<void> {
  const ok = await confirm({
    type: 'warning',
    title: '清除本项目全部图标？',
    description: '未单独设置的槽位会回落到全局（跟随开启时）或芽默认。',
    confirmText: '清除',
  })
  if (!ok) return
  iconStore.resetProjectIcons()
  toastSuccess('已清除本项目全部图标')
}

async function onResetDefaults(): Promise<void> {
  const ok = await confirm({
    type: 'danger',
    title: '回到芽默认？',
    description: '会清空本项目全部图标覆盖并停止跟随全局，所有槽位回到芽/实体类型默认。',
    confirmText: '回到默认',
  })
  if (!ok) return
  iconStore.resetToDefaults()
  toastSuccess('已回到芽默认')
}

async function onClearGlobal(): Promise<void> {
  const ok = await confirm({
    type: 'danger',
    title: '清除全局图标？',
    description: '所有跟随全局的项目会回落到默认；已独立的项目保留自己的图标。',
    confirmText: '清除全局',
  })
  if (!ok) return
  iconStore.clearGlobalIcons()
  toastSuccess('已清除全局图标')
}

let stopViewWatch: (() => void) | null = null

watch(
  () => [pluginStore.views.length, settings.sprouts.map(sprout => `${sprout.id}:${sprout.active}`).join('|')] as const,
  () => { revision.value++ },
)

onMounted(() => {
  stopViewWatch = pluginAPI.onViewChange(() => { revision.value++ })
})
onUnmounted(() => {
  stopViewWatch?.()
})

defineExpose({
  goToCard: (index: number) => deckRef.value?.goToCard(index),
})
</script>

<style scoped>
.ic-card { gap: 8px; }
</style>
