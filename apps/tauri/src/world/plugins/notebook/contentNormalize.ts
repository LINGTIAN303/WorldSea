/**
 * contentNormalize — 笔记正文的解析前容错预处理（块 1 阶段 3，2026-10-15）。
 *
 * 【转型说明】此前为「装载网关三态归一」（md 信号检测 → 渲染 HTML / HTML 放行 / 纯文本拆段，
 * 注册于 entity-core IngestNormalizers）——随 md 真相源切换（块 1）整体退役：
 * 正文存储统一为 md，装载走 `contentType:'markdown'` 直装（useNoteEditor），
 * 归一器注册（notebook/index.ts）同步移除。
 *
 * 保留职能＝**解析前容错**（作用于装载输入与预览渲染；纪律：不改写存储原文——
 * 修复态经用户编辑保存后固化为「首次编辑规范化」，属协议 §3.2 已接受的清单）：
 * - 表格空行修复：GFM 表格要求行连续；LLM / 手工输出常带行间空行（走查实锤漂移形态，
 *   原为 HTML 层 repairTextTables）——压缩「管道行之间的空行」使表格可被识别；
 * - 围栏安全：代码块（``` / ~~~）内的内容原样保留（保真区，不做任何压缩）。
 */

/** 管道行：行首可选空白 + `|` 开头且 `|` 结尾（保守——不误伤「a | b」普通文本） */
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

/** 围栏行（``` / ~~~，允许缩进） */
function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line)
}

/**
 * 表格行间空行修复（md 文本级，行扫描 + 围栏状态机）。
 * 非围栏区中，若「管道行」之后是「空行块 + 管道行」，跳过空行块（使表格行连续）。
 * 单遍 O(n)；幂等（修复后无「管道行 + 空行块 + 管道行」结构可再修）。
 */
export function repairTableBlankLines(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceLine = isFence(line)
    if (fenceLine) inFence = !inFence
    if (!inFence && !fenceLine && isTableRow(line)) {
      out.push(line)
      // 预览空行块：若闭合位置仍是管道行 → 压缩（跳过空行块）
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      if (j > i + 1 && j < lines.length && isTableRow(lines[j])) {
        i = j - 1 // 下一轮从 j 继续（空行块被跳过）
      }
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * 笔记正文解析前容错（幂等；**不改写存储**——调用方仅在装载 / 渲染输入侧使用）。
 */
export function normalizeNoteContent(md: string): string {
  if (!md) return ''
  return repairTableBlankLines(md)
}
