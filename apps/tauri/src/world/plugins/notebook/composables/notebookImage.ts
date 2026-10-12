/**
 * notebookImage — 图片增强扩展（批 5 I7，2026-10-12）。
 *
 * 组合方案（不引付费 drag-handle、不重造拖拽引擎）：
 * ① **宽度拖拽 = 官方 resize 引擎**（Image 3.2 内置 ResizableNodeView：四角手柄 /
 *    等比（alwaysPreserveAspectRatio）/ 触摸 / 拖拽中实时预览 / onCommit 写 width+height）。
 *    实体落库为 `width`/`height` 数字属性（HTML 标准属性，DOMPurify 保留——2026-10-12 实验实锤）。
 * ② **对齐 = 本扩展新增 align 属性**（left/center/right，null=原样）：
 *    - 编辑端：`data-align` 落到 img 上（NodeView 把属性 setAttribute），由 prose.css 的
 *      `img[data-align=…]` 规则渲染；
 *    - 落库端：renderHTML 合成对齐 style（display:block + margin auto）——**落库 HTML
 *      自带对齐**，预览端（sanitize 直渲染）及其它 HTML 渲染端无需共享 CSS 即可正确显示；
 *    - 解析端：data-align 优先，兼容历史 `align` 属性（弃用但存在）。
 * ③ alt 编辑 / 对齐按钮 = 编辑器顶部工具栏「图片上下文组」（选中图片时出现，与表格组同模式）。
 *
 * 注：NodeView 的 HTMLAttributes 只跑**各属性自己的 renderHTML**（不含本节点级 renderHTML
 * 的 style 合成）——因此编辑端对齐全靠 data-align + prose.css，两端口径在下方注释锁定。
 */
import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

export type NoteImageAlign = 'left' | 'center' | 'right'

export const NOTE_IMAGE_ALIGNS: ReadonlyArray<NoteImageAlign> = ['left', 'center', 'right']

/** align 值守卫（parseHTML 用） */
function isAlign(v: string | null): v is NoteImageAlign {
  return v === 'left' || v === 'center' || v === 'right'
}

/**
 * 对齐 → style 片段（renderHTML 与测试共用单源）。
 * left 也输出 display:block（与 prose.css 基础规则一致，显式化避免预览端无 CSS 时 inline 残留）。
 */
export function alignStyleParts(align: string | null | undefined): string[] {
  if (align === 'left') return ['display:block']
  if (align === 'center') return ['display:block', 'margin-left:auto', 'margin-right:auto']
  if (align === 'right') return ['display:block', 'margin-left:auto', 'margin-right:0']
  return []
}

export const NotebookImage = Image.extend({
  addAttributes() {
    return {
      // src / alt / title / width / height：继承官方（width/height 供 resize 引擎落库）
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute('data-align') || element.getAttribute('align')
          return isAlign(v) ? v : null
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.align ? { 'data-align': String(attributes.align) } : {},
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes } as Record<string, unknown>
    const align = attrs['data-align'] as string | null | undefined
    const styleParts = alignStyleParts(align)
    if (styleParts.length) attrs.style = styleParts.join(';')
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },
})

export default NotebookImage
