/**
 * 白板拖拽载荷约定（右栏 → 画布）
 *
 * 两类载荷共用一套 MIME 命名（`application/x-worldsea-*`），避免与其它芽的拖拽互相干扰；
 * 走 HTML5 DnD 通用路子（draggable + dragstart 写 dataTransfer）。
 *
 * · 节点（outline_node）→ 拖入 = 为该节点建容器（已有容器则定位）
 * · 章节（manuscript）  → 拖入 = 落在空白则新建节点并关联；落在容器上则只建立关联
 *   （关联的写入口是 `@/entity/chapterLink`，本模块只管载荷解析）
 */
export const NODE_DND_MIME = 'application/x-worldsea-outline-node'
export const CHAPTER_DND_MIME = 'application/x-worldsea-manuscript-chapter'

/** 画布可接受的载荷（null = 不是本芽关心的拖拽，例如从系统拖文件） */
export type BoardDndPayload = { kind: 'node' | 'chapter'; id: string } | null

/**
 * 一次性读出载荷类型与 id。
 * 注意：只在 drop 阶段可读（dragover 阶段浏览器不允许读数据），故画布侧只在 drop 里取。
 */
export function readDndPayload(ev: DragEvent): BoardDndPayload {
  const dt = ev.dataTransfer
  if (!dt) return null
  try {
    const nodeId = dt.getData(NODE_DND_MIME)
    if (nodeId) return { kind: 'node', id: nodeId }
    const chapterId = dt.getData(CHAPTER_DND_MIME)
    if (chapterId) return { kind: 'chapter', id: chapterId }
    return null
  } catch {
    return null
  }
}

/** 只取节点 id（历史调用点的语义：章节载荷不算节点） */
export function readNodeIdFromDnD(ev: DragEvent): string | null {
  const payload = readDndPayload(ev)
  return payload?.kind === 'node' ? payload.id : null
}

/**
 * dragover / drop 阶段判断「这次拖拽是不是画布可接受的载荷」（节点或章节）。
 *
 * 【为什么需要】dragover 阶段读不到**数据**（浏览器只在 drop 时解锁），但 `types` 是可见的。
 * 据此可以：
 * ① 只在确实是本芽载荷时设置 `dropEffect` 与落点反馈（文件拖入不应该点亮画布）
 * ② 让「拖拽被接受」在**光标**上就能看出来——源侧 `effectAllowed='copy'` 而目标侧不设
 *    `dropEffect` 时，Windows/WebView2 会显示「禁止」光标，用户会认为「拖拽根本没实现」
 *    （2026-09-17 真机反馈）。
 */
export function acceptsBoardDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = Array.from(dt.types ?? [])
  return types.includes(NODE_DND_MIME) || types.includes(CHAPTER_DND_MIME)
}

/** dragover 阶段判断是不是**章节**载荷（据此把落点提示固定为「关联」而非「插前/插后/成为子节点」） */
export function carriesChapter(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types ?? []).includes(CHAPTER_DND_MIME)
}
