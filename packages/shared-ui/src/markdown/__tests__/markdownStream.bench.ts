/**
 * 流式 Markdown 渲染量测（验收用；非 CI 门禁，手动 `npx vitest bench` 运行）。
 * 场景：一篇长文档按字符块逐步喂入（模拟流式），对比 ① 旧路径：每帧整段渲染（marked.parse + 消毒 + mention + 全文高亮）；
 * ② 新路径：每帧增量渲染（固化块缓存 + 尾块独立重渲）。
 */
import { bench, describe } from 'vitest'
import { createMarkdownStreamRenderer, renderFullMarkdown } from '../markdownStream'

/** 构造长文档：12 节（标题 + 段落 + 交替代码块/表格/列表），约 3K 字符 */
function buildLongDoc(): string {
  const parts: string[] = []
  for (let i = 1; i <= 12; i++) {
    parts.push(`## 第 ${i} 节`)
    parts.push('')
    parts.push(
      `这是第 ${i} 节的说明段落，包含 **要点**、\`行内代码\` 与 [参考链接](https://example.com/${i})，` +
        '用于拉长文本并覆盖行内渲染路径。',
    )
    parts.push('')
    if (i % 3 === 1) {
      parts.push('```ts')
      parts.push(`export function step${i}(value: number): number {`)
      parts.push(`  return value * ${i}`)
      parts.push('}')
      parts.push('```')
      parts.push('')
    } else if (i % 3 === 2) {
      parts.push('| 名称 | 值 |', '| --- | --- |', `| a${i} | ${i} |`, `| b${i} | ${i * 2} |`, '')
    } else {
      parts.push(`- 条目 ${i}-1`, `- 条目 ${i}-2`, `  - 嵌套 ${i}`, '')
    }
  }
  return parts.join('\n')
}

const LONG_MD = buildLongDoc()

/** 模拟流式帧：每 25 字符一帧 */
const FRAMES: string[] = []
for (let i = 25; i <= LONG_MD.length; i += 25) FRAMES.push(LONG_MD.slice(0, i))
FRAMES.push(LONG_MD)

describe(`markdown 流式逐帧渲染（${FRAMES.length} 帧 / ${LONG_MD.length} 字符）`, () => {
  bench('旧路径：每帧整段渲染', () => {
    let out = ''
    for (const frame of FRAMES) {
      out = renderFullMarkdown(frame, null)
    }
    return out
  })

  bench('新路径：每帧增量渲染', () => {
    const renderer = createMarkdownStreamRenderer()
    let out = { stableHtml: '', tailHtml: '' }
    for (const frame of FRAMES) {
      out = renderer.render(frame)
    }
    return out.stableHtml + out.tailHtml
  })
})

describe('静态整段渲染（对照）', () => {
  bench('整段一次', () => {
    return renderFullMarkdown(LONG_MD, null)
  })
})