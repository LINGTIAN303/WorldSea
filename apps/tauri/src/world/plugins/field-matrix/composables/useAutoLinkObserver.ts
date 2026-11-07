import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  autoLinkDecisionStore,
  autoLinkRuntime,
  autoLinkStrategyRegistry,
  potentialLinkIndex,
  semanticHintRegistry,
  userFieldMappingStore,
} from '@worldsea/entity-core'
import type {
  AutoLinkDecision,
  AutoLinkRuntimeEvent,
  PotentialLink,
} from '@worldsea/entity-core'
import { getWorldService } from '../../../service-registry'
import type { WorldSettingsService } from '../../../services'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function settingsSvc(): WorldSettingsService {
  const svc = getWorldService<WorldSettingsService>('world.settings')
  if (!svc) throw new Error('[field-matrix] world.settings 服务未就绪（视图渲染早于起树）')
  return svc
}

export function useAutoLinkObserver() {
  const links = ref<PotentialLink[]>([])
  const decisions = ref<AutoLinkDecision[]>([])
  const paused = ref(false)
  const frozen = ref<AutoLinkRuntimeEvent[]>([])
  const strategies = computed(() => autoLinkStrategyRegistry.getAll())
  const hints = computed(() => semanticHintRegistry.getAll())
  const mappings = computed(() => userFieldMappingStore.getAll())
  const events = computed(() => paused.value ? frozen.value : autoLinkRuntime.events.value)
  const unresolvedLinks = computed(() => links.value.filter(link => !link.resolved))
  const resolvedLinks = computed(() => links.value.filter(link => link.resolved))
  const stageToggles = computed(() => [
    { id: 'suggestions', label: '关联建议', enabled: true, detail: '详情页建议面板' },
    { id: 'auto-create-entity', label: '自动创建实体', enabled: settingsSvc().autoCreateEntityEnabled(), detail: '保存时按建议建实体' },
    { id: 'auto-create-ref', label: '自动创建实体引用', enabled: settingsSvc().autoCreateEntityRefEnabled(), detail: '建立实体引用关系' },
    { id: 'auto-create-selector', label: '自动创建选择器', enabled: settingsSvc().autoCreateSelectorEnabled(), detail: '字段映射选择器' },
  ])

  function refresh() {
    links.value = potentialLinkIndex.getAll()
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    decisions.value = autoLinkDecisionStore.getAll()
      .slice()
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))
  }

  const stopWatch = watch(autoLinkRuntime.version, refresh)

  function togglePause() {
    if (!paused.value) frozen.value = autoLinkRuntime.events.value.slice()
    paused.value = !paused.value
    if (!paused.value) refresh()
  }

  function clearEvents() {
    autoLinkRuntime.clear()
  }

  onMounted(refresh)
  onBeforeUnmount(stopWatch)

  return {
    events,
    links,
    decisions,
    strategies,
    hints,
    mappings,
    unresolvedLinks,
    resolvedLinks,
    stageToggles,
    paused,
    togglePause,
    clearEvents,
    refresh,
  }
}
