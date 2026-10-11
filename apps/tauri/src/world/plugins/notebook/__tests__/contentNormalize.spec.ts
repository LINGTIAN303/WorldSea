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
