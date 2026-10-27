/**
 * 共享弹层栈：混合弹层（设置抽屉 useFocusTrap + TuiModal）按打开顺序决定
 * 谁响应 Esc / Tab。修「父层 capture 监听先吞 Esc，子弹层关不掉」。
 */
let seq = 0
const stack: string[] = []

export function createModalLayerId(): string {
  seq += 1
  return `modal-layer-${seq}`
}

export function pushModalLayer(id: string): void {
  if (!stack.includes(id)) stack.push(id)
}

export function popModalLayer(id: string): void {
  const index = stack.indexOf(id)
  if (index >= 0) stack.splice(index, 1)
}

export function isTopModalLayer(id: string): boolean {
  return stack[stack.length - 1] === id
}
