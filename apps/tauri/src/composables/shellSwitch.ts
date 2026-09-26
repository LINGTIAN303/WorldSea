// 空间切换统一入口（D1-b 双窗 + 回退）
//
// 新壳里「Agent 面 ⇄ 工作台」是两个独立窗口（`main` / `workspace`），切换交壳做互斥显隐：
// 工作台页由壳注入 `__WORLDSEA_SPACE_SWITCH__` 桥（→ `cmd_shell_space_switch`）。
// 无桥时（浏览器预览 / 旧壳）回退页内壳切换（`uiStore.setShell`）。
// 三处消费同一入口：TitleBar 切换钮 · Shell 的 Ctrl+Tab · useSystemBridge 托盘「打开 Agent 对话」。
import { useUIStore } from '@/stores/uiStore'

type SpaceTarget = 'space' | 'workbench'

type SpaceSwitchBridge = (to: string) => Promise<unknown>

/** 切到目标空间：有壳桥走壳（窗口级切换），否则回退页内壳切换。 */
export function switchShell(target: SpaceTarget): void {
  const bridge = (globalThis as { __WORLDSEA_SPACE_SWITCH__?: SpaceSwitchBridge }).__WORLDSEA_SPACE_SWITCH__
  if (typeof bridge === 'function') {
    void bridge(target).catch(e => console.error('[shell-switch] 空间切换失败:', e))
    return
  }
  useUIStore().setShell(target)
}

/** 在「Agent 面 ⇄ 工作台」之间切换（按当前壳取反）。 */
export function toggleShell(): void {
  const uiStore = useUIStore()
  switchShell(uiStore.currentShell === 'workbench' ? 'space' : 'workbench')
}
