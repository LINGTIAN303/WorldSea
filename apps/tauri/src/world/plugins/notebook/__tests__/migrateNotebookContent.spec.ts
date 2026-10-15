/**
 * notebook 正文 HTML → md 转换（块 1 阶段 2，2026-10-15）
 *
 * 双身份：
 * ① 转换器单元测试（默认运行）——验证 htmlToMarkdown 的结构映射正确；
 * ② 存量转换运维脚本（默认跳过；NB_MIGRATE=1 启用）——扫真实数据目录出报告，
 *    NB_MIGRATE_WRITE=1 时写回。运行（PowerShell）：
 *    $env:NB_MIGRATE='1'; .\node_modules\.bin\vitest.CMD run migrateNotebookContent
 *
 * 数据目录：NB_MIGRATE_DIR 覆盖，默认 %USERPROFILE%\WorldSea\worlddata。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createConverter, type NotebookHtmlConverter } from '../migrations/htmlToMarkdown'
import { normalizeNoteContent } from '../contentNormalize'

describe('htmlToMarkdown 转换器（单元）', () => {
  let conv: NotebookHtmlConverter
  beforeAll(() => {
    conv = createConverter()
  })
  afterAll(() => {
    conv.dispose()
  })

  it('结构化 HTML → md（标题 / 强调 / 列表 / 任务 / 表格 / 代码块）', () => {
    const html = [
      '<h1>标题</h1>',
      '<p>正文 <strong>粗</strong> 与 <em>斜</em></p>',
      '<ul><li><p>甲</p></li><li><p>乙</p></li></ul>',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>已办</p></li></ul>',
      '<table><tbody><tr><th colspan="1" rowspan="1"><p>列A</p></th><th colspan="1" rowspan="1"><p>列B</p></th></tr><tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>2</p></td></tr></tbody></table>',
      '<pre><code class="language-js">const a = 1</code></pre>',
    ].join('')
    const md = conv.convert(html)
    expect(md).toContain('# 标题')
    expect(md).toContain('**粗**')
    expect(md).toContain('- 甲')
    expect(md).toContain('- [x] 已办')
    expect(md).toContain('| 列A')
    expect(md).toContain('```js')
  })

  it('空段落 HTML → 空输出', () => {
    expect(conv.convert('<p></p>').trim()).toBe('')
  })

  it('noteLink 的 HTML（a[data-note-id]）→ [[名]]', () => {
    const html = '<p>参见 <a class="nb-nolink" href="#" data-note-id="nb-1" data-note-name="某笔记">某笔记</a>。</p>'
    expect(conv.convert(html)).toContain('[[某笔记]]')
  })

  it('mention 的 HTML（span[data-type=mention]）→ @名', () => {
    const html = '<p>主角 <span data-type="mention" data-id="ch-1" data-label="某角色" class="nb-mention">@某角色</span> 出场。</p>'
    expect(conv.convert(html)).toContain('@某角色')
  })

  it('图片：标准 HTML img → 标准语法；带尺寸对齐 → 内嵌 HTML', () => {
    expect(conv.convert('<p><img src="assets/a.png" alt="图"></p>')).toContain('![图](assets/a.png)')
    const sized = conv.convert('<p><img src="assets/b.png" alt="图" width="300" data-align="center"></p>')
    expect(sized).toContain('width="300"')
    expect(sized).toContain('data-align="center"')
  })
})

// ── 运维脚本（默认跳过；NB_MIGRATE=1 启用）──────────────────────────────
const MIGRATE = process.env.NB_MIGRATE === '1'
const WRITE = process.env.NB_MIGRATE_WRITE === '1'
const DATA_ROOT = process.env.NB_MIGRATE_DIR || path.join(os.homedir(), 'WorldSea', 'worlddata')

describe.skipIf(!MIGRATE)('存量转换：notebook content（运维脚本）', () => {
  it('扫描 / 转换 / 报告（NB_MIGRATE_WRITE=1 时写回）', () => {
    const dir = path.join(DATA_ROOT, 'entities', 'notebook')
    expect(fs.existsSync(dir), `目录不存在：${dir}`).toBe(true)

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    const lines: string[] = []
    lines.push(`数据目录：${dir}`)
    lines.push(`模式：${WRITE ? '写回' : '干跑（未写回）'}`)
    lines.push(`笔记数：${files.length}`)

    const conv = createConverter()
    try {
      for (const f of files) {
        const fp = path.join(dir, f)
        const raw = fs.readFileSync(fp, 'utf8')
        const entity = JSON.parse(raw)
        const html = String(entity?.properties?.content ?? '')
        // 管道：容错预处理 → 转换 → md（阶段 2 时代用于兜 HTML/md 混合脏数据；
        // 阶段 3 后数据已全 md——本运维段保留作「重置/修复」工具，对 md 输入为无害直通）
        const normalized = normalizeNoteContent(html)
        const md = conv.convert(normalized)
        lines.push(`- [${entity?.id}] ${entity?.name}：${html.length}B → ${md.length}B`)
        lines.push(`  原内容前 120：${JSON.stringify(html.slice(0, 120))}`)
        lines.push(`  新内容前 120：${JSON.stringify(md.slice(0, 120))}`)
        if (WRITE) {
          // 写回：与 FileStorageBackend 同款紧凑格式；updatedAt 不动（迁移非用户编辑）
          entity.properties = { ...entity.properties, content: md }
          fs.writeFileSync(fp, JSON.stringify(entity), 'utf8')
        }
      }
    } finally {
      conv.dispose()
    }
    const report = lines.join('\n')
    console.log('\n===== 存量转换报告 =====\n' + report)
    expect(files.length).toBeGreaterThanOrEqual(0)
  })
})
