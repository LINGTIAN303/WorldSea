/**
 * md 往返幂等矩阵（块 1 阶段 1 遗留补全，2026-10-15）
 *
 * 契约：一次往返的输出即「规范化固定点」——再次往返必须恒等（md1 === md2）。
 * 矩阵覆盖各节点族；引擎规范化点（协议 §3.2 已接受）：列表符号统一 `-`、强调 `**`、
 * 表格对齐填充、未命中方言的转义锁定。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { roundtrip } from './markdownTestKit'

/** 断言「固定点」：一次往返的输出，再往返必须恒等 */
function expectFixedPoint(md: string): void {
  const md1 = roundtrip(md)
  const md2 = roundtrip(md1)
  expect(md2).toBe(md1)
}

function makeEntity(id: string, type: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type, name, description: '', properties: {}, tags: [], createdAt: now, updatedAt: now }
}

describe('md 往返幂等矩阵（固定点契约）', () => {
  let pinia: Pinia
  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('行内标记混排（粗/斜/删/行内码/链接）', () => {
    expectFixedPoint('**粗** 与 *斜* 与 ~~删~~ 与 `码` 与 [链接](https://example.com) 混排。\n')
  })

  it('嵌套列表（无序嵌有序）', () => {
    expectFixedPoint('- 甲\n  - 甲一\n  - 甲二\n- 乙\n\n1. 一\n2. 二\n')
  })

  it('引用与引用内列表', () => {
    expectFixedPoint('> 引用第一行\n>\n> - 引内列表\n> - 第二项\n')
  })

  it('任务列表（勾选两态 + 嵌套）', () => {
    expectFixedPoint('- [ ] 待办甲\n- [x] 完成乙\n  - [ ] 子项\n')
  })

  it('表格（空单元格 + 对齐冒号）', () => {
    expectFixedPoint('| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| 1 | | 3 |\n')
  })

  it('代码块（带语言与不带语言）', () => {
    expectFixedPoint('```ts\nconst a = 1\n```\n\n```\n纯文本内容\n```\n')
  })

  it('图片两态（标准语法 / 内嵌 HTML 尺寸对齐）', () => {
    expectFixedPoint('![标准](assets/a.png)\n')
    expectFixedPoint('<img src="assets/b.png" alt="尺寸图" width="320" height="180" data-align="center" style="display:block;margin-left:auto;margin-right:auto">\n')
  })

  it('硬换行（行尾双空格规范化）', () => {
    expectFixedPoint('第一行  \n第二行\n')
  })

  it('双链命中（noteLink mark 固定点）', async () => {
    const es = useEntityStore()
    await es.add(makeEntity('nb-fx', 'notebook', '固定点笔记'), 'user')
    expectFixedPoint('参见 [[固定点笔记]]。\n')
  })

  it('mention 命中（节点固定点）', async () => {
    const es = useEntityStore()
    await es.add(makeEntity('ch-fx', 'character', '固定点角色'), 'user')
    expectFixedPoint('主角 @固定点角色 出场。\n')
  })

  it('未命中方言（转义锁定也是固定点）', () => {
    expectFixedPoint('[[未命中笔记]] 与 @未命中角色。\n')
  })

  it('混合长文（标题/段落/列表/表格/代码块/分割线/引用）', () => {
    expectFixedPoint([
      '# 大标题',
      '',
      '段落正文，含 **强调** 与 `代码`。',
      '',
      '## 小节',
      '',
      '- 列表一',
      '- 列表二',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```py',
      'print(1)',
      '```',
      '',
      '---',
      '',
      '> 结尾引用',
      '',
    ].join('\n'))
  })
})
