import { describe, it, expect } from 'vitest'
import { stripMarkdownSyntax, toDisplayText, toPlainText } from '../fieldValue'

/**
 * 只读展示的 markdown 去语法守卫。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §六补
 * 这组用例两半：**该洗掉的洗掉** 与 **不该动的别动**；后半同样重要——
 * 把「2 * 3」或 `snake_case` 啃掉，比留着星号更像 BUG。
 */

describe('该洗掉的洗掉', () => {
  it('强调与行内代码只剩内容', () => {
    expect(stripMarkdownSyntax('出身**渔村**，人称*剑客*')).toBe('出身渔村，人称剑客')
    expect(stripMarkdownSyntax('用 `night_watch` 记时')).toBe('用 night_watch 记时')
    expect(stripMarkdownSyntax('__双下划线__与~~划掉~~')).toBe('双下划线与划掉')
  })

  it('行首标题与引用去掉标记，列表符归成中点', () => {
    expect(stripMarkdownSyntax('## 早年\n> 师承沈砚\n- 出身渔村\n* 守夜人')).toBe('早年\n师承沈砚\n· 出身渔村\n· 守夜人')
  })

  it('数字标号不动（它本来就是可读的）', () => {
    expect(stripMarkdownSyntax('1. 立誓\n2. 远行')).toBe('1. 立誓\n2. 远行')
  })

  it('链接与图片只留锚文本', () => {
    expect(stripMarkdownSyntax('[守夜人](https://ws.test/night)')).toBe('守夜人')
    expect(stripMarkdownSyntax('![封面](/img/a.png)')).toBe('封面')
    expect(stripMarkdownSyntax('[引用式][ref]')).toBe('引用式')
  })

  it('历史富文本标签一并剥掉（先剥标签再去语法）', () => {
    expect(toPlainText('<p>**带标签的**粗</p>')).toBe('带标签的粗')
  })

  it('展示文本走同一口径（表格式与摘要式因此自动跟着干净）', () => {
    expect(toDisplayText('## 头衔**守夜人首领**', 'textarea')).toBe('头衔守夜人首领')
  })
})

describe('不该动的别动', () => {
  const UNTOUCHED = [
    '2 * 3 = 6',
    'a_b_c 与 snake_case_id',
    '100% 完成 * 注：星号单出不配对',
    'C# / F# 语言',
    '— 破折号开头不是列表',
    '路径 D:/WorldSea 与 -号在词内',
  ]

  for (const text of UNTOUCHED) {
    it(`「${text}」原样保留`, () => {
      expect(stripMarkdownSyntax(text)).toBe(text)
    })
  }

  it('空串与无语法字符走快路径', () => {
    expect(stripMarkdownSyntax('')).toBe('')
    expect(stripMarkdownSyntax('普通正文，无标记')).toBe('普通正文，无标记')
  })
})
