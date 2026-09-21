import { describe, it, expect, beforeEach } from 'vitest'
import { useAsk, type AskQuestion } from '../useAsk'

/**
 * useAsk 批量提问状态机契约（Q1，2026-09-20）
 *
 * 覆盖五态 + 两条边界（对齐 dsh `QuestionComposer` 语义）：
 * ① 单选点选即前进 ② 多选 toggle + 继续 ③ 自定义（单选覆盖 / 多选补充）
 * ④ 跳过（空答案） ⑤ 取消（整批拒绝）；边界：未答未跳过拦截 / dismiss 按 askId 关闭
 */

const QUESTIONS: AskQuestion[] = [
  {
    id: 'mode',
    header: '选择模式',
    question: '用哪种模式继续？',
    options: [
      { label: '快速 (Recommended)', description: '少确认' },
      { label: '严谨' },
    ],
  },
  {
    id: 'tags',
    question: '要包含哪些内容？',
    options: [{ label: '正文' }, { label: '大纲' }],
    multiSelect: true,
  },
]

/** 模块级单例状态：每例前收口（若仍在展示中） */
function reset() {
  const { state, cancel } = useAsk()
  if (state.value.show) cancel()
}

beforeEach(reset)

describe('useAsk 批量提问状态机', () => {
  it('① 单选点选即前进；② 多选 toggle + 继续；整批答案 1:1 回传', async () => {
    const { state, ask, chooseOption, toggleOption, advance } = useAsk()
    const pending = ask({ askId: 'ask-1', questions: QUESTIONS })

    expect(state.value.show).toBe(true)
    expect(state.value.askId).toBe('ask-1')
    expect(state.value.index).toBe(0)

    // 单选：点选即前进（不进 second click 状态）
    chooseOption('严谨')
    expect(state.value.index).toBe(1)
    expect(state.value.drafts[0].selected).toEqual(['严谨'])

    // 多选：toggle 不前进
    toggleOption('正文')
    expect(state.value.index).toBe(1)
    advance()
    expect(state.value.show).toBe(false)

    await expect(pending).resolves.toEqual([
      { id: 'mode', selected: ['严谨'] },
      { id: 'tags', selected: ['正文'] },
    ])
  })

  it('边界：未答且未跳过 → 拦截并置 incomplete；toggle 取消选择后仍拦截', async () => {
    const { state, ask, advance, toggleOption, chooseOption } = useAsk()
    const pending = ask({ askId: 'ask-2', questions: QUESTIONS })

    advance()
    expect(state.value.incomplete).toBe(true)
    expect(state.value.index).toBe(0)

    chooseOption('快速 (Recommended)')
    expect(state.value.incomplete).toBe(false)
    expect(state.value.index).toBe(1)

    // 多选：选后取消（空选择）→ 仍拦截
    toggleOption('正文')
    toggleOption('正文')
    advance()
    expect(state.value.incomplete).toBe(true)
    expect(state.value.index).toBe(1)

    // 收口：跳过以完成（避免悬挂 promise）
    const { skip } = useAsk()
    skip()
    await pending
  })

  it('③ 自定义（单选）：自定义覆盖 selected（提交时归一，对齐 dsh submitDrafts）', async () => {
    const { state, ask, setCustom, advance, toggleCustom } = useAsk()
    const single: AskQuestion[] = [
      { id: 'q1', question: '你的选择？', options: [{ label: 'A' }, { label: 'B' }] },
    ]
    const pending = ask({ askId: 'ask-3', questions: single })

    toggleCustom()
    // 白盒：直接置选中——真实 UI 下单选「点选即前进」两者不会共存，
    // 此处锁定协议归一（单选有 custom → selected 清空）
    state.value.drafts[0].selected = ['A']
    setCustom('还是 C 吧')
    advance()

    await expect(pending).resolves.toEqual([
      { id: 'q1', selected: [], custom: '还是 C 吧' },
    ])
  })

  it('③ 自定义（多选）：补充语义（保留 selected）', async () => {
    const { ask, toggleOption, setCustom, advance } = useAsk()
    const multi: AskQuestion[] = [
      { id: 'q1', question: '要哪些？', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
    ]
    const pending = ask({ askId: 'ask-4', questions: multi })

    toggleOption('A')
    setCustom('外加 C')
    advance()

    await expect(pending).resolves.toEqual([
      { id: 'q1', selected: ['A'], custom: '外加 C' },
    ])
  })

  it('④ 跳过：空答案；末题跳过即提交整批', async () => {
    const { state, ask, skip } = useAsk()
    const pending = ask({ askId: 'ask-5', questions: QUESTIONS })

    skip()
    expect(state.value.index).toBe(1)
    skip()
    expect(state.value.show).toBe(false)

    await expect(pending).resolves.toEqual([
      { id: 'mode', selected: [] },
      { id: 'tags', selected: [] },
    ])
  })

  it('⑤ 取消：整批拒绝（resolve null，面板关闭）', async () => {
    const { state, ask, cancel } = useAsk()
    const pending = ask({ askId: 'ask-6', questions: QUESTIONS })

    cancel()
    await expect(pending).resolves.toBeNull()
    expect(state.value.show).toBe(false)
  })

  it('自由回答题（无 options）：默认展开自定义；未答拦截，输入后可前进', async () => {
    const { state, ask, advance, setCustom } = useAsk()
    const free: AskQuestion[] = [{ id: 'f', question: '还有什么要补充的？' }]
    const pending = ask({ askId: 'ask-7', questions: free })

    expect(state.value.drafts[0].showCustom).toBe(true)
    advance()
    expect(state.value.incomplete).toBe(true)

    setCustom('没有')
    advance()
    await expect(pending).resolves.toEqual([{ id: 'f', selected: [], custom: '没有' }])
  })

  it('导航：上一步回看（草稿保留，首题忽略）+ 下一步再推进（2026-09-20 走查后新增）', async () => {
    const { state, ask, chooseOption, toggleOption, advance, prev } = useAsk()
    const pending = ask({ askId: 'ask-nav', questions: QUESTIONS })

    chooseOption('严谨')
    expect(state.value.index).toBe(1)

    // 上一步：回到首题，已填草稿保留
    prev()
    expect(state.value.index).toBe(0)
    expect(state.value.drafts[0].selected).toEqual(['严谨'])
    // 首题再上一步：忽略
    prev()
    expect(state.value.index).toBe(0)

    // 下一步：已答 → 推进；末题前进即提交
    advance()
    expect(state.value.index).toBe(1)
    toggleOption('正文')
    advance()
    await expect(pending).resolves.toEqual([
      { id: 'mode', selected: ['严谨'] },
      { id: 'tags', selected: ['正文'] },
    ])
  })

  it('dismiss：按 askId 匹配关闭（含随轮取消路径），不匹配不关闭', async () => {
    const { state, ask, dismiss } = useAsk()
    const pending = ask({ askId: 'ask-8', questions: QUESTIONS })

    dismiss('ask-other')
    expect(state.value.show).toBe(true)

    dismiss('ask-8')
    await expect(pending).resolves.toBeNull()
    expect(state.value.show).toBe(false)
  })
})