/**
 * useSettingsPanel — Agent 设置浮窗的位置 / 拖拽 / 开关
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - settingsPos / settingsDragged 状态
 *   - usePanelDrag 集成（排除设置浮窗内部交互区域）
 *   - updateSettingsPosition：根据输入栏 menu 按钮位置定位
 *   - onToggleSettings：打开/关闭设置浮窗
 *
 * 依赖外部 inputBarRef（用于读取菜单按钮位置）和 useAgentCommands 的
 * settingsOpen / openSettings / closeSettings。
 */
import { ref, computed, nextTick, type Ref } from 'vue'
import { usePanelDrag } from '../composables/usePanelDrag'
import type AgentInputBar from '../AgentInputBar.vue'

export interface UseSettingsPanelOptions {
  /** settingsOpen（来自 useAgentCommands） */
  settingsOpen: Ref<boolean>
  /** openSettings（来自 useAgentCommands） */
  openSettings: () => void
  /** closeSettings（来自 useAgentCommands） */
  closeSettings: () => void
  /** 输入栏组件 ref */
  inputBarRef: Ref<InstanceType<typeof AgentInputBar> | undefined>
}

export function useSettingsPanel(options: UseSettingsPanelOptions) {
  const { settingsOpen, openSettings, closeSettings, inputBarRef } = options

  const settingsPos = ref({ x: 0, y: 0 })
  const settingsDragged = ref(false)

  const { onDragStart: onSettingsDragStart } = usePanelDrag({
    x: computed({
      get: () => settingsPos.value.x,
      set: v => { settingsPos.value = { ...settingsPos.value, x: v } },
    }),
    y: computed({
      get: () => settingsPos.value.y,
      set: v => { settingsPos.value = { ...settingsPos.value, y: v } },
    }),
    onDragEnd: () => { settingsDragged.value = true },
    excludeSelector: '.settings-body,.menu-close-btn'
  })

  function updateSettingsPosition(): void {
    const bar = inputBarRef.value
    if (!bar) return
    const btn = bar.menuBtnRef
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    settingsPos.value = {
      x: rect.left,
      y: window.innerHeight - rect.top + 8,
    }
    settingsDragged.value = false
  }

  function onToggleSettings(): void {
    if (settingsOpen.value) {
      closeSettings()
    } else {
      openSettings()
      nextTick(updateSettingsPosition)
    }
  }

  return {
    settingsPos, settingsDragged,
    onSettingsDragStart,
    updateSettingsPosition, onToggleSettings,
  }
}

export type UseSettingsPanelReturn = ReturnType<typeof useSettingsPanel>
