import { onMounted, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import { useShortcuts, type ShortcutDef } from '@worldsmith/ui-kit'
import type { BattlePhase } from './useBattleManager'
import type { AwarenessMode } from './useAwareness'

// 键盘快捷键处理函数集合
export interface KeyboardShortcutHandlers {
  battlePhase: Ref<BattlePhase>
  endTurn: () => void
  beginMoveAction: () => void
  beginAttackAction: () => void
  waitAction: () => void
  cancelAction: () => void
  toggleAwareness: (m: AwarenessMode) => void
}

/**
 * 战术板键盘快捷键（经 useShortcuts 注册表统一分发）
 *
 * - 战斗阶段：Space 结束回合；M/A/W 触发移动/攻击/等待；Esc 取消
 * - 任意阶段：1/2/3 切换势力/威胁/补给态势感知
 *
 * 焦点位于输入控件时 view 层快捷键由注册表统一失效，无需自行跳过。
 * 战斗阶段条件在 handler 内判断（注册表条目为静态注册）。
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const { register, unregister } = useShortcuts()
  const ids: string[] = []

  function reg(def: ShortcutDef) {
    register(def)
    ids.push(def.id)
  }

  onMounted(() => {
    const inBattle = () => handlers.battlePhase.value === 'battle'
    reg({ id: 'tactical.endTurn', keys: ['space'], scope: 'view', description: '战术板：结束回合', preventDefault: true, handler: () => { if (inBattle()) handlers.endTurn() } })
    reg({ id: 'tactical.move', keys: ['m'], scope: 'view', description: '战术板：移动', handler: () => { if (inBattle()) handlers.beginMoveAction() } })
    reg({ id: 'tactical.attack', keys: ['a'], scope: 'view', description: '战术板：攻击', handler: () => { if (inBattle()) handlers.beginAttackAction() } })
    reg({ id: 'tactical.wait', keys: ['w'], scope: 'view', description: '战术板：等待', handler: () => { if (inBattle()) handlers.waitAction() } })
    reg({ id: 'tactical.cancel', keys: ['escape'], scope: 'view', description: '战术板：取消行动', handler: () => { if (inBattle()) handlers.cancelAction() } })
    reg({ id: 'tactical.awareness-influence', keys: ['1'], scope: 'view', description: '战术板：势力态势感知', handler: () => handlers.toggleAwareness('influence') })
    reg({ id: 'tactical.awareness-threat', keys: ['2'], scope: 'view', description: '战术板：威胁态势感知', handler: () => handlers.toggleAwareness('threat') })
    reg({ id: 'tactical.awareness-supply', keys: ['3'], scope: 'view', description: '战术板：补给态势感知', handler: () => handlers.toggleAwareness('supply') })
  })

  onBeforeUnmount(() => {
    ids.forEach(id => unregister(id))
  })
}
