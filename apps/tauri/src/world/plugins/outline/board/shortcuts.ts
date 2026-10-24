/**
 * board/shortcuts —— 白板快捷键的**单一元数据源**
 *
 * 【为什么单独抽出来】快捷键需要在两处出现：
 *  ① `useShortcuts.register()` 的注册处（权威键位，参与分发）
 *  ② `ui-kit` 的 `SHORTCUT_CATALOG`（设置面板的展示目录）
 * 两处各写一份必然漂移 —— 2026-09-16 批次 4 就是这样：白板七条只写进了注册处，
 * 设置面板里完全看不到（且目录里还留着旧大纲视图的死条目 `outline.close-detail`）。
 * 现将**元数据**收敛到本文件，注册处遍历它、守卫测试比对它，从结构上防止复发。
 *
 * 【键位说明】`Shift+1` 在本项目注册为 `['!']`：`normalizeKeys` 对非字母可打印字符
 * **不叠加 shift 修饰**（`useShortcuts.ts` 的 `normalizeKeys`），写 `['shift','1']` 永不匹配。
 * 设置面板的展示层负责把 `'!'` 拆成 `Shift + 1` 两块（见 ShortcutsPanel 的 DISPLAY_SPLIT）。
 */

export interface BoardShortcutMeta {
  id: string
  keys: string[]
  description: string
  /** 需要阻止浏览器默认行为（如 Ctrl+Z / Delete / Ctrl+0） */
  preventDefault?: boolean
}

/** 白板快捷键元数据（顺序即设置面板中的展示顺序由 scope 分组决定，此处顺序无影响） */
export const BOARD_SHORTCUT_META: BoardShortcutMeta[] = [
  {
    id: 'outline-board.undo',
    keys: ['ctrl', 'z'],
    description: '大纲白板：撤销',
    preventDefault: true,
  },
  {
    id: 'outline-board.redo',
    keys: ['ctrl', 'shift', 'z'],
    description: '大纲白板：重做',
    preventDefault: true,
  },
  {
    id: 'outline-board.delete-container',
    keys: ['delete'],
    description: '大纲白板：删除选中节点（含容器与关系）',
    preventDefault: true,
  },
  {
    id: 'outline-board.reset-zoom',
    keys: ['ctrl', '0'],
    description: '大纲白板：缩放重置为 100%',
    preventDefault: true,
  },
  {
    id: 'outline-board.zoom-in',
    keys: ['ctrl', '='],
    description: '大纲白板：放大',
    preventDefault: true,
  },
  {
    id: 'outline-board.zoom-out',
    keys: ['ctrl', '-'],
    description: '大纲白板：缩小',
    preventDefault: true,
  },
  {
    id: 'outline-board.fit-all',
    keys: ['!'],
    description: '大纲白板：适配全部',
  },
  {
    id: 'outline-board.draw-section',
    keys: ['s'],
    description: '大纲白板：画区',
  },
  {
    id: 'outline-board.escape',
    keys: ['escape'],
    description: '大纲白板：取消选中 / 退出画区',
  },
]

/** 白板快捷键 id 清单（注册/注销共用） */
export const BOARD_SHORTCUT_IDS: string[] = BOARD_SHORTCUT_META.map(m => m.id)
