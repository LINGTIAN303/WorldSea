/**
 * 白板拖拽载荷约定（右栏节点 → 画布）
 *
 * 用 HTML5 DnD 的自定义 MIME，避免与其它芽的拖拽载荷互相干扰；
 * 与 module-builder 的 Toolbox 同路子（draggable + dragstart 写 dataTransfer）。
 */
export const NODE_DND_MIME = 'application/x-worldsea-outline-node'

/**
 * 从 drop 事件读取节点 id。
 * 注意：只在 drop 阶段可读（dragover 阶段浏览器不允许读数据），故画布侧只在 drop 里取。
 */
export function readNodeIdFromDnD(ev: DragEvent): string | null {
  const dt = ev.dataTransfer
  if (!dt) return null
  try {
    const id = dt.getData(NODE_DND_MIME)
    return id || null
  } catch {
    return null
  }
}

/**
 * dragover / drop 阶段判断「这次拖拽是不是大纲节点」。
 *
 * 【为什么需要】dragover 阶段读不到**数据**（浏览器只在 drop 时解锁），但 `types` 是可见的。
 * 据此可以：
 * ① 只在确实是节点拖拽时设置 `dropEffect` 与落点反馈（文件拖入不应该点亮画布）
 * ② 让「拖拽被接受」在**光标**上就能看出来——源侧 `effectAllowed='copy'` 而目标侧不设
 *    `dropEffect` 时，Windows/WebView2 会显示「禁止」光标，用户会认为「拖拽根本没实现」
 *    （2026-09-17 真机反馈）。
 */
export function acceptsNodeDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = Array.from(dt.types ?? [])
  return types.includes(NODE_DND_MIME)
}
