/**
 * backlinkDerive — note_link 关系派生器（块 2 · 连接派生 · 阶段 1，2026-10-15）。
 *
 * 协议：docs/plans/2026-10-15-人机共写协议-md真相源转型.md §3.4「连接即内容的函数」。
 * 批计划：docs/plans/2026-10-15-块2-连接派生-批计划.md §2.1–2.3。
 *
 * 链路：md 文本 → extractNoteRefs（语法感知扫描）→ resolveNoteRef（三态解析）
 *       → computeLinkDiff（集合 diff）→ recomputeNoteLinks（skipUndo 写入 + 短路 + 串行）。
 *
 * 设计要点：
 * - 关系集＝f(content)：语义等价「全删该源笔记派生关系 + 重插」，实现为 diff——
 *   幂等、可重放、无变化零写入；歧义（多匹配）不建关系（协议裁决 E：不自动猜）；
 * - 扫描器与编辑器渲染同语义（同源正则 + 围栏/行内反引号状态机）：代码块内 `[[ ]]`
 *   不误判；转义形态 `\[\[X\]\]`（字符间夹反斜杠）不满足连续 `[[`，正则天然不命中；
 * - 写入全部走 skipUndo（派生是系统行为，不进全局撤销栈——否则打字保存即冲掉撤销历史）；
 * - 同笔记重算串行排队（保存链与装载链交叠时防交错写）。
 *
 * 已知边界（一期接受，留档）：
 * - 4 空格缩进代码块内的 `[[ ]]` 会被扫到（罕见写法；围栏是主流）；
 * - 半转义 `\[[x]]`（仅转义首括号处）会被扫到（渲染上该处非链接）；
 * - 行内反引号按「先到先得最短配对」简化（GFM 复杂配对未全量复刻）。
 */
import { useBidirectional, useUndoRedo } from '@worldsea/entity-core'
import type { Entity, Relation } from '@worldsea/entity-core'
import { entitiesSvc, relationsSvc } from './serviceAccess'

/** 双链引用正则——与 noteLinkExt.tokenizer 同源（非 global；扫描侧克隆 global 版使用） */
export const NOTE_REF_RE = /\[\[([^\[\]\n]+)\]\]/

/**
 * 扫描 md 文本中的双链引用名（语法感知、去重保序、名字 trim 后返回）。
 * 跳过围栏代码块区间（``` / ~~~，含未闭合围栏至文末）与行内反引号段。
 */
export function extractNoteRefs(md: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let fenceChar: string | null = null
  let fenceLen = 0
  for (const line of md.split('\n')) {
    if (fenceChar !== null) {
      // 围栏内：仅识别闭合行（同字符、长度 ≥ 开启、行内除围栏仅空白）
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
      continue // 围栏内一律不扫
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      fenceChar = open[1][0]
      fenceLen = open[1].length
      continue // 开启行自身不扫（其 info string 非正文）
    }
    collectRefsFromPlainLine(line, out, seen)
  }
  return out
}

/** 单行普通文本扫描：行内反引号段以换行符替换切断（防跨段拼接出伪匹配），再跑同源正则 */
function collectRefsFromPlainLine(line: string, out: string[], seen: Set<string>): void {
  const codeRe = /(`+)([\s\S]*?)\1/g
  let plain = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = codeRe.exec(line)) !== null) {
    plain += line.slice(last, m.index) + '\n'
    last = m.index + m[0].length
  }
  plain += line.slice(last)
  const re = new RegExp(NOTE_REF_RE.source, 'g')
  let r: RegExpExecArray | null
  while ((r = re.exec(plain)) !== null) {
    const name = r[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
}

/** 引用名解析三态：唯一命中（hit）/ 无匹配（miss）/ 多匹配歧义（ambiguous——裁决 E：不自动猜） */
export type NoteRefResolution =
  | { kind: 'hit'; id: string }
  | { kind: 'miss' }
  | { kind: 'ambiguous'; ids: string[] }

/** 名字 → 笔记实体三态解析（一次遍历；同名多篇 → ambiguous，不取首个） */
export function resolveNoteRef(name: string, notes: readonly Entity[]): NoteRefResolution {
  const ids: string[] = []
  for (const e of notes) {
    if (e.type === 'notebook' && e.name === name) ids.push(e.id)
  }
  if (ids.length === 0) return { kind: 'miss' }
  if (ids.length === 1) return { kind: 'hit', id: ids[0] }
  return { kind: 'ambiguous', ids }
}

/**
 * 目标关系集（当前 content 应指向的笔记 id 集合）：扫描 → 解析 → 过滤（miss/歧义/自引用跳过）。
 * code 型笔记的 content 非 md（CodeCell 不解析双链）——返回空集（其历史关系经 diff 自然清除）。
 */
export function computeDesiredLinks(note: Entity, notes: readonly Entity[]): Set<string> {
  const desired = new Set<string>()
  if (note.properties?.noteType === 'code') return desired
  const md = String(note.properties?.content ?? '')
  for (const name of extractNoteRefs(md)) {
    const r = resolveNoteRef(name, notes)
    if (r.kind === 'hit' && r.id !== note.id) desired.add(r.id)
  }
  return desired
}

/** 集合 diff（纯函数）：目标集 vs 现有 note_link forward 记录 → 待增 targetId 与待删记录 */
export function computeLinkDiff(
  desired: ReadonlySet<string>,
  current: readonly Relation[],
): { toAdd: string[]; toRemove: Relation[] } {
  const currentTargets = new Set(current.map((r) => r.targetId))
  return {
    toAdd: [...desired].filter((id) => !currentTargets.has(id)),
    toRemove: current.filter((r) => !desired.has(r.targetId)),
  }
}

/** 同笔记重算串行链（防保存链/装载链交叠时交错写） */
const recomputeChains = new Map<string, Promise<boolean>>()

/**
 * 重算某笔记的派生 note_link 关系集（f(content)）。
 * 幂等、可重放、无变化零写入（返回值＝是否有变更）。
 * 失败不抛出（console.warn 兜底）——派生失败不阻断编辑主流程。
 */
export function recomputeNoteLinks(noteId: string): Promise<boolean> {
  const prev = recomputeChains.get(noteId) ?? Promise.resolve(false)
  const task = prev
    .catch(() => false) // 前链失败不阻断后链
    .then(() => doRecompute(noteId))
    .catch((err) => {
      console.warn('[backlinkDerive] 重算失败（不影响主流程）:', err)
      return false
    })
  recomputeChains.set(noteId, task)
  void task.finally(() => {
    if (recomputeChains.get(noteId) === task) recomputeChains.delete(noteId) // 链尾清理
  })
  return task
}

async function doRecompute(noteId: string): Promise<boolean> {
  const entities = entitiesSvc()
  const relations = relationsSvc()
  const note = entities.get(noteId)
  if (!note || note.type !== 'notebook') return false // 实体已不存在——无从派生

  const desired = computeDesiredLinks(note, entities.list())
  const current = relations.list().filter((r) => r.type === 'note_link' && r.sourceId === noteId)
  const { toAdd, toRemove } = computeLinkDiff(desired, current)
  if (toAdd.length === 0 && toRemove.length === 0) return false // 幂等短路：无变化零写入

  // 删除：forward + pair 反记录成对移除（若存在）。2026-10-15 修复：inverseRegistry 已补
  // V2 注册（syncToLegacyRegistry 扩展）——note_link 新建即双记录（forward + note_linked_from，
  // pairId 配对），此处成对删除生效；存量单记录（修复前创建）无 pair，直接单删即可。
  // skipUndo——派生系统行为不进撤销栈。
  for (const rel of toRemove) {
    const pair = rel.pairId
      ? relations.list().find((r) => r.pairId === rel.pairId && r.id !== rel.id)
      : undefined
    if (pair) await relations.remove(pair.id, 'user', { skipUndo: true })
    await relations.remove(rel.id, 'user', { skipUndo: true })
  }

  // 新增：createBidirectional——note_link 现产出双记录（forward + note_linked_from，pairId 配对）
  const { createBidirectional } = useBidirectional()
  for (const targetId of toAdd) {
    await createBidirectional({ type: 'note_link', sourceId: noteId, targetId }, { skipUndo: true })
  }
  return true
}

/**
 * 全量重算（进视图时机，阶段 2）：逐笔记重算 + 孤儿关系清理。
 *
 * - 逐笔记走 recomputeNoteLinks（幂等短路下无变化零写入；同笔记串行链自动排队）；
 * - 孤儿清理：source / target 实体已不存在的 note_link 类记录（崩溃残留、外部直改存储兜底）——
 *   删除笔记的常规路径已有级联清理（entityStore.remove），此处为无状态自愈的最后防线；
 * - 失败不抛出（各步内部兜底）——返回处理的笔记数（供测试与日志）。
 */
export async function recomputeAllNoteLinks(): Promise<number> {
  const entities = entitiesSvc()
  const relations = relationsSvc()
  const notes = entities.list().filter((e) => e.type === 'notebook')
  for (const note of notes) {
    await recomputeNoteLinks(note.id)
  }

  // 孤儿清理（note_link 类：source / target 实体已不存在）
  const alive = new Set(entities.list().map((e) => e.id))
  const orphans = relations.list().filter(
    (r) =>
      (r.type === 'note_link' || r.type === 'note_linked_from') &&
      (!alive.has(r.sourceId) || !alive.has(r.targetId)),
  )
  for (const rel of orphans) {
    try {
      await relations.remove(rel.id, 'user', { skipUndo: true })
    } catch (err) {
      console.warn('[backlinkDerive] 孤儿关系清理失败（跳过该条）:', err)
    }
  }
  return notes.length
}

// ────────────────────────────────────────────────
// 引用重写器（阶段 3——改名治理；协议裁决 D：全库重写 S-1）
// ────────────────────────────────────────────────

/**
 * 将一篇 md 中的 `[[旧名]]` 引用整体替换为 `[[新名]]`（协议 §3.5 / 批计划 §2.5）。
 *
 * 规则（与派生扫描同语义——同一围栏/反引号状态机）：
 * - 仅替换 `trim(raw) === oldName` 的引用（顺带规范化空格形态 `[[ 旧名 ]]` → `[[新名]]`）；
 * - 围栏代码块与行内反引号段跳过；
 * - 转义形态（`\[\[旧名\]\]`）不匹配（字符间夹反斜杠）——「从来不是链接」的文本不重写；
 * - 无替换时 md 原样返回（count=0）。
 */
export function rewriteNoteRefs(md: string, oldName: string, newName: string): { md: string; count: number } {
  if (!md || !oldName || !newName || oldName === newName) return { md, count: 0 }
  let count = 0
  let fenceChar: string | null = null
  let fenceLen = 0
  const outLines: string[] = []
  for (const line of md.split('\n')) {
    if (fenceChar !== null) {
      // 围栏内：仅识别闭合行（同字符、长度 ≥ 开启、行内除围栏仅空白）；内容原样保留
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
      outLines.push(line)
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      fenceChar = open[1][0]
      fenceLen = open[1].length
      outLines.push(line)
      continue
    }
    const r = rewriteRefsInPlainLine(line, oldName, newName)
    outLines.push(r.line)
    count += r.count
  }
  return { md: outLines.join('\n'), count }
}

/** 单行重写：行内反引号段原样保留，仅对普通段做引用替换 */
function rewriteRefsInPlainLine(line: string, oldName: string, newName: string): { line: string; count: number } {
  const codeRe = /(`+)([\s\S]*?)\1/g
  let result = ''
  let last = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = codeRe.exec(line)) !== null) {
    const r = replaceRefsInSegment(line.slice(last, m.index), oldName, newName)
    result += r.segment + m[0] // 反引号段原样保留
    count += r.count
    last = m.index + m[0].length
  }
  const tail = replaceRefsInSegment(line.slice(last), oldName, newName)
  result += tail.segment
  count += tail.count
  return { line: result, count }
}

/** 段内替换：同源正则匹配，`trim(raw) === oldName` 的引用整体替换为 `[[newName]]` */
function replaceRefsInSegment(seg: string, oldName: string, newName: string): { segment: string; count: number } {
  const re = new RegExp(NOTE_REF_RE.source, 'g')
  let out = ''
  let last = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(seg)) !== null) {
    if (m[1].trim() !== oldName) continue // 非目标引用：留待尾段原样输出
    out += seg.slice(last, m.index) + `[[${newName}]]`
    last = m.index + m[0].length
    count++
  }
  out += seg.slice(last)
  return { segment: out, count }
}

/**
 * 执行笔记改名 + 全库引用重写（阶段 3；协议裁决 D：全库重写 S-1）。
 *
 * **原子语义**：改名本体 + 全部受影响笔记的 content 重写打进**同一条撤销记录**——
 * 一次 Ctrl+Z 整体回退（名字 / 引用一起回；关系存 id 不存名，回退后天然一致。
 * 撤销不触发重算：若撤销前后歧义面变化（罕见边界），由下次保存 / 进视图重算自愈）。
 *
 * 实现要点：
 * - 事务窗口＝纯同步段（entityStore.update 的 record 同步入组；persist 异步跑）——
 *   与 NotebookView.asSingleUndoStep 同模式；
 * - code 型笔记跳过（content 非 md，不做引用重写）；
 * - 重写命中的笔记在事务外触发重算（内容变 → 关系重导；一般因「关系存 id」而短路零写入，
 *   歧义消解等边界由重算收敛）；
 * - 失败兜底不抛出（console.warn）——调用方（flushPendingWrites）不因改名重写失败中断。
 *
 * @returns 重写涉及（替换命中）的笔记数
 */
export function applyNoteRename(params: {
  noteId: string
  oldName: string
  newName: string
  /** 改名 update 的载荷（name + 合并后的 properties） */
  changes: Record<string, unknown>
}): number {
  const entities = entitiesSvc()
  const { beginTransaction, commitTransaction, rollbackTransaction } = useUndoRedo()
  const rewrittenIds: string[] = []

  beginTransaction()
  try {
    // ① 改名本体（先落名；重写扫描基于名字匹配，与执行顺序无关）
    entities.update(params.noteId, params.changes, 'user')
    // ② 全库扫描重写（纯同步段：record 全部归入本事务组）
    for (const note of entities.list()) {
      if (note.type !== 'notebook' || note.properties?.noteType === 'code') continue
      const md = String(note.properties?.content ?? '')
      const r = rewriteNoteRefs(md, params.oldName, params.newName)
      if (r.count > 0) {
        entities.update(note.id, { properties: { ...note.properties, content: r.md } }, 'user')
        rewrittenIds.push(note.id)
      }
    }
    commitTransaction(
      `重命名笔记「${params.oldName} → ${params.newName}」（重写 ${rewrittenIds.length} 篇引用）`,
    )
  } catch (err) {
    rollbackTransaction()
    console.warn('[backlinkDerive] 改名重写失败（已回滚事务组）:', err)
    return 0
  }

  // ③ 重写后重算（事务外；skipUndo 派生写入 + 幂等短路）
  for (const id of rewrittenIds) {
    void recomputeNoteLinks(id)
  }
  return rewrittenIds.length
}
