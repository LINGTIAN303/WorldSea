// 空间切换统一入口（D1-b 双窗；2026-09-30 C 批：去页内回退与 toggleShell）
//
// 新壳里「Agent 面 ⇄ 工作台」是两个独立窗口（`main` / `workspace`），切换交壳做互斥显隐：
// 工作台页由壳注入 `__WORLDSEA_SPACE_SWITCH__` 桥（→ `cmd_shell_space_switch`）。
// 工作台窗侧方向固定「进入 Agent 空间」（Ctrl+Tab / 标题栏胶囊共用）；
// 反向（Agent → 工作台）由 dsh 窗口内的注入脚本直接调桥，不经过本模块。
// 无桥（浏览器预览）：忽略并警告——页内已无第二壳可切（旧页内壳切换随 E7 退场）。

type SpaceTarget = 'space' | 'workbench'

type SpaceSwitchBridge = (to: string) => Promise<unknown>

/** 项目切换期间禁止空间切换：避免另一窗继续操作旧工作区（产品域侧入口） */
let spaceSwitchBlocked = false

export function setSpaceSwitchBlocked(blocked: boolean): void {
  spaceSwitchBlocked = blocked
}

/** 切到目标空间：有壳桥走壳（窗口级互斥切换）；无桥仅警告（浏览器预览无窗口可切）。 */
export function switchShell(target: SpaceTarget): void {
  if (spaceSwitchBlocked) {
    console.warn('[shell-switch] 项目切换进行中，暂不切换空间:', target)
    return
  }
  const bridge = (globalThis as { __WORLDSEA_SPACE_SWITCH__?: SpaceSwitchBridge }).__WORLDSEA_SPACE_SWITCH__
  if (typeof bridge === 'function') {
    void bridge(target).catch(e => console.error('[shell-switch] 空间切换失败:', e))
    return
  }
  console.warn('[shell-switch] 无壳桥（浏览器预览），忽略空间切换:', target)
}
