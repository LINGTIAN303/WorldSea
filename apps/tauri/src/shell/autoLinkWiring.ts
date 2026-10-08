/**
 * AutoLink ② 批装配件（2026-10-07）——把 entity-core 的休眠桥接到产品运行时。
 * 单独成件便于装配级测试；`main.ts` initializeBackend 调用一次。
 * 详见 docs/details/架构/AutoLink系统测绘.md §10 / docs/plans/2026-10-07-AutoLink成熟度审查与完善立项.md §三。
 */
import {
  registerDefaultStrategies,
  registerSettingsApi,
  registerConfirmApi,
  setUndoHistoryProvider,
  useSettingsStore,
} from '@worldsea/entity-core'
import { useConfirm } from '@worldsea/ui-kit'

let installed = false

export function installAutoLinkWiring(): void {
  if (installed) return

  // ① 策略注册：hint→策略（9 条默认策略；关系类型均已注册含反向对）
  registerDefaultStrategies()

  // ② 设置桥：getter 活读 store——设置面板改值即时生效
  registerSettingsApi({
    get autoCreateEntityEnabled() { return useSettingsStore().autoCreateEntityEnabled },
    get autoCreateEntityRefEnabled() { return useSettingsStore().autoCreateEntityRefEnabled },
    get autoCreateSelectorEnabled() { return useSettingsStore().autoCreateSelectorEnabled },
    get undoHistoryLimit() { return useSettingsStore().undoHistoryLimit },
    get highlight_spreadHops() { return useSettingsStore().highlight_spreadHops },
    get highlight_dimmingEnabled() { return useSettingsStore().highlight_dimmingEnabled },
  })

  // ③ 确认桥：接到 ui-kit 全局确认弹窗（WsConfirmDialog 经 Shell 全局挂载）
  registerConfirmApi({
    confirm: (o) => {
      const type = o.type === 'warning' || o.type === 'danger' ? o.type : 'info'
      return useConfirm().confirm({
        type,
        title: o.title,
        description: o.description,
        confirmText: o.confirmText,
        cancelText: o.cancelText,
      })
    },
  })

  // ④ 撤销上限：让设置「撤销历史条数」真正生效（此前恒默认 20）
  setUndoHistoryProvider(() => useSettingsStore().undoHistoryLimit)

  installed = true
}
