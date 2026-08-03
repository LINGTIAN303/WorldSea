import { onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
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
 * 战术板键盘快捷键
 *
 * - 战斗阶段：Space 结束回合；M/A/W 触发移动/攻击/等待；Esc 取消
 * - 任意阶段：1/2/3 切换势力/威胁/补给态势感知
 *
 * 焦点位于输入框/文本域/下拉框时忽略快捷键。
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  function onKeyDown(e: KeyboardEvent) {
    // 焦点在输入控件时跳过
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    if (handlers.battlePhase.value === 'battle') {
      if (e.code === 'Space') { e.preventDefault(); handlers.endTurn() }
      else if (e.key === 'm' || e.key === 'M') { handlers.beginMoveAction() }
      else if (e.key === 'a' || e.key === 'A') { handlers.beginAttackAction() }
      else if (e.key === 'w' || e.key === 'W') { handlers.waitAction() }
      else if (e.key === 'Escape') { handlers.cancelAction() }
    }
    if (e.key === '1') { handlers.toggleAwareness('influence') }
    else if (e.key === '2') { handlers.toggleAwareness('threat') }
    else if (e.key === '3') { handlers.toggleAwareness('supply') }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown)
  })
}
