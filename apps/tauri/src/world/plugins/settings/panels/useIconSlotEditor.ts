import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  customIconId,
  customIconValue,
  entitySchemaRegistryV2,
  isCustomIconValue,
  pluginAPI,
  useIconAssetStore,
  useIconOverrideStore,
  usePluginStore,
  useSettingsStore,
} from '@worldsea/entity-core'
import { ICON_DOMAIN_IDS, toastSuccess, toastWarn, type IconDomain } from '@worldsea/ui-kit'
import { buildIconSlots, entityTypeSlotsOf, type IconSlot, type IconSlotManifest } from '@/world/iconSlots'
import {
  defaultSyncFor,
  syncTargetKeys,
  type IconPickerConfirm,
  type IconPickerTarget,
} from '@/world/iconPanelModel'

/** 芽管理行内换图标：槽位、选择器目标、写入与实体类型联动。 */
export function useIconSlotEditor(options: {
  plugins: () => ReadonlyArray<{ manifest: IconSlotManifest }>
  onApplied?: () => void
}) {
  const pluginStore = usePluginStore()
  const settings = useSettingsStore()
  const iconStore = useIconOverrideStore()
  const iconAssets = useIconAssetStore()
  const revision = ref(0)
  const sproutSignature = computed(() => settings.sprouts
    .map(sprout => `${sprout.id}:${sprout.icon}:${sprout.label}:${sprout.active}`)
    .join('|'))

  const iconSlots = computed(() => {
    void revision.value
    void pluginStore.views.length
    void sproutSignature.value
    return buildIconSlots({
      views: pluginStore.views,
      sprouts: settings.sprouts,
      plugins: options.plugins(),
      schemas: entitySchemaRegistryV2.getAll(),
    })
  })

  const sproutSlotByPlugin = computed(() => {
    const map = new Map<string, IconSlot>()
    for (const slot of iconSlots.value) {
      if (slot.kind === 'sprout' && slot.pluginId) map.set(slot.pluginId, slot)
    }
    return map
  })

  const pickerSlot = ref<IconSlot | null>(null)
  const pickerOpen = computed(() => pickerSlot.value !== null)
  const pickerTarget = computed<IconPickerTarget | null>(() => {
    const slot = pickerSlot.value
    if (!slot) return null
    const typeSlots = entityTypeSlotsOf(iconSlots.value, slot.pluginId)
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

  function iconOf(sproutId: string, fallback: string): string {
    const slot = sproutSlotByPlugin.value.get(sproutId)
    return iconStore.resolve(slot?.key ?? `sprout:${sproutId}`, slot?.defaultIcon ?? fallback)
  }

  function openForSprout(id: string): void {
    const slot = sproutSlotByPlugin.value.get(id)
    if (!slot) {
      toastWarn(`找不到芽 ${id} 的图标槽位`)
      return
    }
    pickerSlot.value = slot
  }

  function close(): void {
    pickerSlot.value = null
  }

  function applyIcon(key: string, icon: string, applyGlobal: boolean): void {
    if (applyGlobal) iconStore.applyToGlobal(key, icon)
    else iconStore.setProjectIcon(key, icon)
  }

  async function confirm(payload: IconPickerConfirm): Promise<void> {
    const slot = pickerSlot.value
    if (!slot) return
    let icon = payload.icon
    if (payload.applyGlobal && isCustomIconValue(icon)) {
      const id = customIconId(icon)
      const promoted = id ? await iconAssets.promoteToGlobal(id) : null
      if (!promoted) {
        toastWarn('自定义图标同步到全局失败，请重试')
        return
      }
      icon = customIconValue(promoted.id)
    }
    const oldIcon = iconStore.resolve(slot.key, slot.defaultIcon)
    applyIcon(slot.key, icon, payload.applyGlobal)
    let synced = 0
    if (payload.syncTypes) {
      for (const key of syncTargetKeys(entityTypeSlotsOf(iconSlots.value, slot.pluginId), iconStore.sourceOf, s => iconStore.resolve(s.key, s.defaultIcon), oldIcon)) {
        applyIcon(key, icon, payload.applyGlobal)
        synced++
      }
    }
    const scope = payload.applyGlobal ? '全局 + 本项目' : '本项目'
    toastSuccess(synced > 0 ? `已更新图标（${scope}），并同步 ${synced} 个实体类型` : `已更新图标（${scope}）`)
    options.onApplied?.()
    close()
  }

  function reset(): void {
    const slot = pickerSlot.value
    if (!slot) return
    iconStore.clearProjectIcon(slot.key)
    toastSuccess('已取消本项目图标设置')
    options.onApplied?.()
    close()
  }

  let stopViewWatch: (() => void) | null = null
  onMounted(() => {
    stopViewWatch = pluginAPI.onViewChange(() => { revision.value++ })
  })
  onUnmounted(() => {
    stopViewWatch?.()
  })

  return { iconSlots, iconOf, pickerOpen, pickerTarget, openForSprout, close, confirm, reset }
}
