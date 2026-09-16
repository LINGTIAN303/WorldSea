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
