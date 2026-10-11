/**
 * C1 门禁合成输入（固定常量合成，禁止录制会话 / 网络 / 环境依赖——对齐 dsh benchmarks/AGENTS.md）
 *
 * 三条路径共用同一批合成数据，保证「首开 / 流式 / 推理」量测口径可比。
 */
import type { TurnEvent } from '@worldsea/shared-composables/agent/turnModel'

/** 合成历史规模：200 轮 × 50 正文 delta = 1 万事件（长会话量级；单轮长流式见流式路径） */
export const HISTORY_TURNS = 200
export const DELTAS_PER_TURN = 50
/** 单轮流式 delta 数（流式消费 / 推理专项；模拟长回答的单段增长） */
export const REASONING_DELTAS = 500
/** 每个 delta 的字符数（模拟真实流式分片） */
export const DELTA_CHARS = 8

/** 第 i 个推理 delta：每 12 个换行一次（覆盖「单行增长」与「多行增长」两种形态） */
function reasoningDeltaAt(i: number): string {
  const tail = (i + 1) % 12 === 0 ? '\n' : ''
  return `检查第${i}条约束是否与前述一致，并给出依据。${tail}`
}

/** 第 i 个正文 delta（单行连续增长，模拟长回答流式） */
function textDeltaAt(i: number): string {
  return `要点${i}：` + 'x'.repeat(DELTA_CHARS)
}

/** 合成推理 delta 序列 */
export function syntheticReasoningDeltas(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(reasoningDeltaAt(i))
  return out
}

/** 合成正文 delta 序列 */
export function syntheticTextDeltas(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(textDeltaAt(i))
  return out
}

/** 每轮「推理 → 正文」交错块数（真实长轮次：多段思维链与正文交替，展平后每轮约 10 个行段） */
const BLOCKS_PER_TURN = 5

/**
 * 合成一轮事件序列（turn_start → round_start → 5 段「推理 → 正文」→ round_end）
 *
 * 交错是为了让展平产出行数接近真实长轮次（每轮 ≈ 10 个行段）：行数太少的轮次会让
 * 「整轮复用」的缓存收益不可量测（见路径① 重开用例）。
 */
export function syntheticTurn(
  turnIndex: number,
  reasoningDeltas: number,
  textDeltas: number,
): TurnEvent[] {
  const turnId = `turn-${turnIndex}`
  const events: TurnEvent[] = [
    {
      type: 'turn_start',
      turnId,
      userMessage: { id: `user-${turnIndex}`, text: `第 ${turnIndex} 个问题`, timestamp: 1_700_000_000_000 + turnIndex },
    },
    { type: 'round_start', turnId },
  ]
  for (let block = 0; block < BLOCKS_PER_TURN; block++) {
    const rStart = Math.floor((block * reasoningDeltas) / BLOCKS_PER_TURN)
    const rEnd = Math.floor(((block + 1) * reasoningDeltas) / BLOCKS_PER_TURN)
    for (let i = rStart; i < rEnd; i++) events.push({ type: 'reasoning', turnId, delta: reasoningDeltaAt(i) })
    const tStart = Math.floor((block * textDeltas) / BLOCKS_PER_TURN)
    const tEnd = Math.floor(((block + 1) * textDeltas) / BLOCKS_PER_TURN)
    for (let i = tStart; i < tEnd; i++) events.push({ type: 'text_delta', turnId, delta: textDeltaAt(i) })
  }
  events.push({ type: 'round_end', turnId })
  return events
}

/** 合成整段会话事件（默认 200 轮 × (20 推理 + 50 正文) delta） */
export function syntheticSession(
  turns: number = HISTORY_TURNS,
  deltasPerTurn: number = DELTAS_PER_TURN,
  reasoningDeltasPerTurn = 20,
): TurnEvent[] {
  const events: TurnEvent[] = []
  for (let t = 0; t < turns; t++) {
    for (const e of syntheticTurn(t, reasoningDeltasPerTurn, deltasPerTurn)) events.push(e)
  }
  return events
}

/** 单轮推理流式事件（推理流式专项：1 轮 × N 个 reasoning delta） */
export function syntheticReasoningTurn(
  count: number = REASONING_DELTAS,
  turnIndex = 0,
): TurnEvent[] {
  return syntheticTurn(turnIndex, count, 0)
}

/** 合成 Markdown 长文档（C2 增量渲染路径；40 节 + 代码块/表格/列表交替，约 6 千字符） */
export function buildMarkdownDoc(): string {
  const parts: string[] = []
  for (let i = 1; i <= 40; i++) {
    parts.push(`## 第 ${i} 节`, '')
    parts.push(
      `这是第 ${i} 节的说明段落，包含 **要点**、\`行内代码\` 与 [参考链接](https://example.com/${i})，` +
        '用于拉长文本并覆盖行内渲染路径（粗体 / 行内代码 / 链接 / 实体 mention）。',
      '',
    )
    if (i % 3 === 1) {
      parts.push(
        '```ts',
        `export function step${i}(value: number): number {`,
        `  return value * ${i}`,
        '}',
        '```',
        '',
      )
    } else if (i % 3 === 2) {
      parts.push('| 名称 | 值 | 说明 |', '| --- | --- | --- |', `| a${i} | ${i} | 第 ${i} 行 |`, '', '')
    } else {
      parts.push(`- 条目 ${i}-1`, `- 条目 ${i}-2`, `  - 嵌套 ${i}`, '', '')
    }
  }
  return parts.join('\n')
}

/** 把文档按 chunkChars 切成流式帧（最后一帧为完整文档） */
export function markdownFrames(doc: string, chunkChars = 25): string[] {
  const frames: string[] = []
  for (let i = chunkChars; i <= doc.length; i += chunkChars) frames.push(doc.slice(0, i))
  frames.push(doc)
  return frames
}

/** 合成推理长文本（摘要成本量测用；singleLine=true 时无换行） */
export function syntheticReasoningText(chars: number, singleLine: boolean): string {
  if (singleLine) return '推理内容'.repeat(Math.ceil(chars / 4)).slice(0, chars)
  const line = '推理内容检查约束并给出依据。'.repeat(4) // 每行 52 字符
  const out: string[] = []
  while (out.join('\n').length < chars) out.push(line)
  return out.join('\n').slice(0, chars)
}

/**
 * 合成 TS 代码片段（代码高亮成本量测用；默认 60 行 ≈ 1.8 千字符）
 *
 * 取 60 行是因为实测「单块 60 行 TS ≈ 1.6ms」——足够大到让「重复高亮」成为可观成本，
 * 又小到不会让门禁本身变慢。
 */
export function syntheticCodeSnippet(lines = 60): string {
  const out = ['export function step(value: number): number {']
  for (let k = 0; k < lines - 3; k++) out.push(`  const part${k} = value * ${k} // 注释 ${k}`)
  out.push('  return value', '}')
  return out.join('\n')
}