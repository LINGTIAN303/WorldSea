/**
 * enterGuard —— 就地编辑的 Enter / Esc 守卫（2026-10-24 · 施工分解 §十三 B-IME）
 *
 * 中文输入法组合期（选词 / 上屏）：
 * - Enter 是**确认候选**，不是提交；
 * - Esc 是**关闭候选窗**，不是取消编辑。
 * 组合期必须放行默认行为（不调用 `preventDefault`），否则候选词无法上屏 / 关闭；
 * 同时也不能执行提交或取消，否则用户会在选词时丢掉整段编辑。
 *
 * `keyCode === 229` 是部分 IME 在组合期的兼容信号，与 `useShortcuts` 同口径。
 */

export interface EnterGuardOptions {
  /** true = 仅 Ctrl+Enter 触发（多行编辑的提交键） */
  ctrl?: boolean
  /** true = 仅无 Shift 时触发（Enter 提交 / Shift+Enter 换行） */
  noShift?: boolean
}

export function isImeComposing(ev: KeyboardEvent): boolean {
  return ev.isComposing || ev.keyCode === 229
}

/** Enter 提交守卫：组合期直接放行；其余情况按 opts 过滤后 preventDefault + 执行 */
export function guardEnter(ev: KeyboardEvent, run: () => void, opts: EnterGuardOptions = {}): void {
  if (isImeComposing(ev)) return
  if (opts.ctrl && !ev.ctrlKey) return
  if (opts.noShift && ev.shiftKey) return
  ev.preventDefault()
  run()
}

/** Esc 取消守卫：组合期只关候选窗，不退出编辑 */
export function guardEsc(ev: KeyboardEvent, run: () => void): void {
  if (isImeComposing(ev)) return
  ev.preventDefault()
  run()
}
