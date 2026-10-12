/**
 * contentNormalize — 笔记正文装载归一契约（2026-10-11 装载网关）。
 *
 * 三态判定锁定：
 * ① 含 `<` → HTML 放行（幂等关键 + 存量内容零变化）
 * ② markdown 块级信号 → 渲染（标题/表格/围栏/列表/引用），产物为裸 HTML（无聊天外壳）
 * ③ 其余纯文本 → 旧行为拆段（plainTextToEditorHtml）
 * 反例集锁定保守信号集：算式 `**`、`-5度`、单行 `a | b` 等普通文本不被误转。
 */
import { describe, it, expect } from 'vitest'
import { normalizeNoteContent } from '../contentNormalize'

describe('contentNormalize · markdown 渲染分支', () => {
  it('ATX 标题 → <h1>…<h3>', () => {
    expect(normalizeNoteContent('# 大标题')).toContain('<h1>大标题</h1>')
    expect(normalizeNoteContent('## 小节')).toContain('<h2>')
    expect(normalizeNoteContent('### 条目')).toContain('<h3>')
  })

  it('GFM 表格（Agent 高频产物）→ <table>，含表头与单元格', () => {
    const md = '| 名称 | 值 |\n| --- | --- |\n| 攻击 | 99 |'
    const html = normalizeNoteContent(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>')
    expect(html).toContain('攻击')
    expect(html).toContain('99')
  })

  it('对齐冒号表格分隔行同样识别', () => {
    const md = '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |'
    expect(normalizeNoteContent(md)).toContain('<table>')
  })

  it('围栏代码块 → 裸 pre>code，无聊天外壳（ws-code-block/复制按钮）', () => {
    const md = '前文\n\n```ts\nconst a = 1\n```\n\n后文'
    const html = normalizeNoteContent(md)
    expect(html).toContain('<pre>')
    expect(html).toContain('const a = 1')
    expect(html).not.toContain('ws-code-block')
    expect(html).not.toContain('ws-code-copy')
  })

  it('无序/有序列表（同类 ≥2 行）→ <ul>/<ol>', () => {
    expect(normalizeNoteContent('- 甲\n- 乙')).toContain('<ul>')
    expect(normalizeNoteContent('1. 第一\n2. 第二')).toContain('<ol>')
  })

  it('引用块 → <blockquote>', () => {
    expect(normalizeNoteContent('> 引用内容')).toContain('<blockquote>')
  })

  it('Agent 完整笔记语料：标题+表格+代码块+列表组合渲染', () => {
    const md = [
      '# 角色设定',
      '',
      '基础属性如下：',
      '',
      '| 属性 | 数值 |',
      '| --- | --- |',
      '| 力量 | 88 |',
      '',
      '技能列表：',
      '',
      '- 火球术',
      '- 冰霜新星',
      '',
      '```json',
      '{"level": 12}',
      '```',
    ].join('\n')
    const html = normalizeNoteContent(md)
    for (const marker of ['<h1>', '<table>', '<ul>', '<pre>', '火球术']) {
      expect(html).toContain(marker)
    }
  })

  it('Agent 任务列表语料：- [ ]/- [x] 规范化为 TipTap 任务节点（跨链路 I2）', () => {
    const html = normalizeNoteContent('# 待办\n\n- [ ] 未完成项\n- [x] 已完成项')
    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('data-type="taskItem"')
    expect(html).not.toContain('input')
    // 勾选态分别落位
    expect(html).toContain('data-checked="false"')
    expect(html).toContain('data-checked="true"')
    expect(html).toContain('未完成项')
    expect(html).toContain('已完成项')
  })

  it('无 checkbox 的普通列表不被任务列表规范化触碰', () => {
    const html = normalizeNoteContent('- 甲\n- 乙')
    expect(html).not.toContain('data-type="taskList"')
    expect(html).not.toContain('data-type="taskItem"')
  })
})

describe('contentNormalize · HTML 放行分支（幂等 + 存量零变化）', () => {
  it('已是 HTML 的内容原样返回（逐字节不变）', () => {
    const html = '<p>旧笔记内容</p><table><tbody><tr><td>x</td></tr></tbody></table>'
    expect(normalizeNoteContent(html)).toBe(html)
  })

  it('归一产物（含标签）再次归一 → 原样返回（幂等）', () => {
    const once = normalizeNoteContent('# 标题\n\n- 列表')
    expect(normalizeNoteContent(once)).toBe(once)
  })

  it('无 md 信号的含 < 文本放行（HTML 判定线，普通比较式不受影响）', () => {
    expect(normalizeNoteContent('a < b')).toBe('a < b')
  })

  it('md 信号 + 内嵌 HTML 混合：md 渲染、HTML 透传（2026-10-11 顺序修正：< 放行不再一票否决 md）', () => {
    const md = '# 标题\n\n第一行<br>第二行'
    const html = normalizeNoteContent(md)
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<br>')
  })
})

describe('contentNormalize · 纯文本拆段分支（旧行为保持）', () => {
  it('无信号纯文本按换行拆 <p>', () => {
    expect(normalizeNoteContent('第一段\n第二段')).toBe('<p>第一段</p><p>第二段</p>')
  })

  it('HTML 转义保持（无信号纯文本里 < > & 不被当作标签）', () => {
    expect(normalizeNoteContent('文本 a 与 b')).toBe('<p>文本 a 与 b</p>')
    expect(normalizeNoteContent('比较 a 与 b，含 & 符号')).toContain('&amp;')
  })
})

describe('contentNormalize · 保守信号反例集（防误伤）', () => {
  it.each([
    ['行内强调不成转', '这段话里有 **强调** 记号', '<strong>'],
    ['行首负数不成列表', '-5 度的天气', '<ul>'],
    ['行中乘号不成列表', '面积 = 3 * 4 = 12', '<ul>'],
    ['单行竖线不成表格', '参数 a | b 含义待定', '<table>'],
    ['行中引用符号不成引用', '值 > 100 时触发', '<blockquote>'],
    ['破折号行不成标题', '#1 选手表现优异', '<h1>'],
  ])('%s：%s 不触发 markdown 渲染', (_name, text, marker) => {
    const html = normalizeNoteContent(text)
    expect(html).not.toContain(marker)
    expect(html).toContain('<p>')
  })

  it('单行列表为弱信号孤行：不转列表，保持纯文本拆段（2026-10-11 收紧误伤）', () => {
    expect(normalizeNoteContent('- 待办一件事')).toBe('<p>- 待办一件事</p>')
    expect(normalizeNoteContent('1. 5折 的增长率')).toBe('<p>1. 5折 的增长率</p>')
  })

  it('单行列表 + 任一强信号共存：整体按 markdown 渲染（md 文档判定优先）', () => {
    const md = '# 标题\n\n- 孤行列表项'
    const html = normalizeNoteContent(md)
    expect(html).toContain('<h1>')
    expect(html).toContain('<ul>')
  })
})

describe('contentNormalize · 文本表格修复（2026-10-12 走查：行间空行表格降级为文本段）', () => {
  it('端到端｜整篇 md（表格行间带空行）→ marked 降级 → 修复回 <table>', () => {
    // 根因形态复现：表格行间空行 → GFM 不识别；文档有标题信号 → 走 marked → 逐行 <p> 降级
    const md = '# 设定\n\n| 区 | 母题 | 牵力性质 |\n\n| --- | --- | --- |\n\n| 持守区 | 留 | 聚 |\n\n| 斩断区 | 断 | 分 |'
    const html = normalizeNoteContent(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>区</th>')
    expect(html).toContain('<td>持守区</td>')
    expect(html).toContain('<td>分</td>')
    expect(html).not.toContain('<p>| ')
  })

  it('存量数据｜<p>|…|</p> 连续段组（HTML 放行分支）→ 修复为 <table>', () => {
    const stored = '<p>| 区 | 母题 |</p><p>| --- | --- |</p><p>| 持守区 | 留 |</p><p>| 斩断区 | 断 |</p>'
    const html = normalizeNoteContent(stored)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>母题</th>')
    expect(html).toContain('<td>留</td>')
    expect(html).toContain('<td>断</td>')
    expect(html).not.toContain('<p>| ')
  })

  it('纯文本拆段分支｜行间空行（<p></p> 间隔）→ 跨空段修复', () => {
    // 无任何 md 信号（无标题/列表）→ plainTextToEditorHtml 逐行拆段（空行 → <p></p>）
    const txt = '| a | b |\n\n| --- | --- |\n\n| 1 | 2 |'
    const html = normalizeNoteContent(txt)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('幂等：修复产物再归一 → 原样返回', () => {
    const once = normalizeNoteContent('<p>| a | b |</p><p>| --- | --- |</p><p>| 1 | 2 |</p>')
    expect(once).toContain('<table>')
    expect(normalizeNoteContent(once)).toBe(once)
  })

  it('反例｜连续竖线段但无分隔行 → 不修（保持文本）', () => {
    const stored = '<p>| a | b |</p><p>| 1 | 2 |</p><p>| 3 | 4 |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })

  it('反例｜列数不一致 → 不修', () => {
    const stored = '<p>| a | b |</p><p>| --- | --- |</p><p>| 1 | 2 | 3 |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })

  it('反例｜仅两段（表头 + 分隔，无数据行）→ 不修', () => {
    const stored = '<p>| a | b |</p><p>| --- | --- |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })

  it('组前后普通段落零影响（只替换组本体，不吞上下文）', () => {
    const stored = '<p>前言一段。</p><p>| a | b |</p><p>| --- | --- |</p><p>| 1 | 2 |</p><p>后记。</p>'
    const html = normalizeNoteContent(stored)
    expect(html).toContain('<p>前言一段。</p>')
    expect(html).toContain('<table>')
    expect(html).toContain('<p>后记。</p>')
  })

  it('行内容含 `|` 与中文标点（真实语料形态）→ 正确切格', () => {
    const stored = '<p>| 区 | 宿命底色 | 星位（登记合计） |</p><p>| --- | --- | --- |</p><p>| 持守区 | 守者必先失其所守 | 戍垣、承钟、抱磐、长明（80） |</p>'
    const html = normalizeNoteContent(stored)
    expect(html).toContain('<th>宿命底色</th>')
    expect(html).toContain('<td>守者必先失其所守</td>')
    expect(html).toContain('<td>戍垣、承钟、抱磐、长明（80）</td>')
  })
})

describe('contentNormalize · 半转换修复（空表 + 残留数据行 → 并入，2026-10-12 真实数据实锤）', () => {
  it('TipTap 保存态｜表头 + 全空行 + 后随数据行组 → 空行由数据行替换', () => {
    const stored = '<table style="min-width: 125px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>星位</p></th><th colspan="1" rowspan="1"><p>结构</p></th></tr><tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr></tbody></table><p>| 截川 | 一字横切 |</p><p>| 落刃 | 锐角前突 |</p>'
    const html = normalizeNoteContent(stored)
    expect(html).toContain('<td><p>截川</p></td>')
    expect(html).toContain('<td><p>锐角前突</p></td>')
    expect(html).not.toContain('<p>| ')
  })

  it('marked 原生｜thead + 空 tbody + 后随单行数据 → 插入 tbody', () => {
    const stored = '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody></tbody></table><p>| 1 | 2 |</p>'
    const html = normalizeNoteContent(stored)
    expect(html).toContain('<td><p>1</p></td>')
    expect(html).toContain('<td><p>2</p></td>')
    expect(html).not.toContain('<p>| ')
  })

  it('反例｜表格已有内容 td + 后随行段 → 不并（防误伤）', () => {
    const stored = '<table><tbody><tr><th><p>a</p></th></tr><tr><td><p>x</p></td></tr></tbody></table><p>| 1 | 2 |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })

  it('反例｜列数不符 → 不并', () => {
    const stored = '<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr></tbody></table><p>| 1 | 2 | 3 |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })

  it('反例｜行组自带分隔行 → 不并入（交由规则一处理的形态，此处单组<3行故均不转）', () => {
    const stored = '<table><tbody><tr><th><p>a</p></th></tr></tbody></table><p>| --- |</p><p>| 1 |</p>'
    expect(normalizeNoteContent(stored)).toBe(stored)
  })
})
