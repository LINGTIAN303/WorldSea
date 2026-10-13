import { ref } from 'vue'

/**
 * useAsk — 提问面板（2026-09-20 重写：单值占位 → 批量问题协议）。与 useConfirm 同位置弹出（对话区底部
 * 输入栏上方），供模型经 `ask_user_question` 工具主动提问（Rust 事件 `InteractionRequested`〔user_input〕，
 * 通道 `agent:interaction:{session_id}`）。协议细节与单面板约束详见 docs/details/注释/packages/ui-kit/useAsk.md
 */

/** 选项（label 同时是回传的选中值；description 为 UI 帮助文本） */
export interface AskOption {
  label: string
  description?: string
}

/** 单个问题（id 必填且同批唯一） */
export interface AskQuestion {
  id: string
  question: string
  /** 短标题/分组标签 */
  header?: string
  /** 选项列表（缺省 = 自由回答题，仅自定义输入） */
  options?: AskOption[]
  /** 是否多选（默认 false 单选） */
  multiSelect?: boolean
}

/** 单题答案（回传 Rust；跳过 = 空 selected 无 custom） */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** 提问请求载荷（族事件 user_input 型；调用方以交互请求 id 作 `askId` 传入） */
export interface AskRequest {
  askId: string
  questions: AskQuestion[]
}

/** 单题草稿（面板会话内状态；与 questions 1:1） */
interface AskDraft {
  /** 已选中的选项 label 列表 */
  selected: string[]
  /** 自定义输入文本 */
  custom: string
  /** 是否已跳过（跳过 = 空答案） */
  skipped: boolean
  /** 是否展开自定义输入（无选项题默认展开） */
  showCustom: boolean
}

interface AskState {
  show: boolean
  askId: string
  questions: AskQuestion[]
  /** 当前问题下标（逐题作答） */
  index: number
  /** 每题草稿（与 questions 1:1） */
  drafts: AskDraft[]
  /** 校验提示：当前题未答且未跳过（「继续」被拦截时置位） */
  incomplete: boolean
  /** 整批 resolve：answers（作答/跳过逐题 1:1）/ null（用户取消 = 拒绝作答） */
  resolve: ((answers: AskAnswer[] | null) => void) | null
}

/** 初始空态（含 resolve: null） */
function emptyState(): AskState {
  return {
    show: false,
    askId: '',
    questions: [],
    index: 0,
    drafts: [],
    incomplete: false,
    resolve: null,
  }
}

/** 模块级单例状态（与 useConfirm 同模式：弹窗全局唯一） */
const state = ref<AskState>(emptyState())

/** 当前题（无面板时返回 null） */
function currentQuestion(): AskQuestion | null {
  const s = state.value
  if (!s.show || s.index < 0 || s.index >= s.questions.length) return null
  return s.questions[s.index]
}

/** 当前题草稿（无面板时返回 null） */
function currentDraft(): AskDraft | null {
  const s = state.value
  if (!s.show || s.index < 0 || s.index >= s.drafts.length) return null
  return s.drafts[s.index]
}

/** 当前题是否满足「可前进」：已选 / 有自定义 / 已跳过（对齐 dsh error.incomplete 判据） */
function isAnswered(draft: AskDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim().length > 0 || draft.skipped
}

/**
 * 由草稿组装整批答案（对齐 dsh `submitDrafts`）：跳过 → `{ id, selected: [] }`；
 * 单选且自定义非空 → `{ id, selected: [], custom }`（custom 覆盖选中）；
 * 其余 → `{ id, selected, custom? }`（custom 有值才携带）。
 */
function buildAnswers(): AskAnswer[] {
  const s = state.value
  return s.questions.map((q, i) => {
    const d = s.drafts[i]
    const custom = d.custom.trim()
    if (d.skipped) return { id: q.id, selected: [] }
    if (!q.multiSelect && custom) return { id: q.id, selected: [], custom }
    const answer: AskAnswer = { id: q.id, selected: [...d.selected] }
    if (custom) answer.custom = custom
    return answer
  })
}

export function useAsk() {
  /**
   * 发起提问面板（由族事件监听器 `agent:interaction:{sessionId}` 的 user_input 分派调用）
   * 返回：作答/跳过整批答案数组；用户取消 → null（调用方回传「拒绝作答」）
   */
  function ask(request: AskRequest): Promise<AskAnswer[] | null> {
    return new Promise(resolve => {
      state.value = {
        show: true,
        askId: request.askId,
        questions: request.questions,
        index: 0,
        // 无选项题默认展开自定义输入（否则无作答入口）
        drafts: request.questions.map(q => ({
          selected: [],
          custom: '',
          skipped: false,
          showCustom: !(q.options && q.options.length > 0),
        })),
        incomplete: false,
        resolve,
      }
    })
  }

  /** 单选：点选即前进（选中清空自定义——两者互斥，custom 覆盖语义） */
  function chooseOption(label: string): void {
    const q = currentQuestion()
    const d = currentDraft()
    if (!q || !d) return
    d.selected = [label]
    d.custom = ''
    d.skipped = false
    state.value.incomplete = false
    advance()
  }

  /** 多选：toggle（不前进，由「继续」推进） */
  function toggleOption(label: string): void {
    const d = currentDraft()
    if (!d) return
    const at = d.selected.indexOf(label)
    if (at >= 0) d.selected.splice(at, 1)
    else d.selected.push(label)
    d.skipped = false
    state.value.incomplete = false
  }

  /** 自定义输入（v-model 逐字）；单选下的「覆盖 selected」由提交时归一（同 dsh submitDrafts） */
  function setCustom(text: string): void {
    const d = currentDraft()
    if (!d) return
    d.custom = text
    if (text.trim().length > 0) d.skipped = false
    state.value.incomplete = false
  }

  /** 展开/收起自定义输入 */
  function toggleCustom(): void {
    const d = currentDraft()
    if (!d) return
    d.showCustom = !d.showCustom
  }

  /** 跳过当前题（空答案）并前进（末题即提交） */
  function skip(): void {
    const d = currentDraft()
    if (!d) return
    d.skipped = true
    d.selected = []
    d.custom = ''
    state.value.incomplete = false
    advance()
  }

  /** 继续 / 提交：未答且未跳过 → 拦截并提示 */
  function advance(): void {
    const s = state.value
    const d = currentDraft()
    if (!d) return
    if (!isAnswered(d)) {
      s.incomplete = true
      return
    }
    if (s.index < s.questions.length - 1) {
      s.index += 1
      s.incomplete = false
    } else {
      submit()
    }
  }

  /** 上一步：回到上一题（草稿保留；已在首题则忽略）——2026-09-20 走查后新增 */
  function prev(): void {
    const s = state.value
    if (!s.show || s.index <= 0) return
    s.index -= 1
    s.incomplete = false
  }

  /** 提交整批答案（resolve answers 并关闭） */
  function submit(): void {
    const s = state.value
    const resolve = s.resolve
    const answers = buildAnswers()
    state.value = emptyState()
    resolve?.(answers)
  }

  /** 取消（resolve null = 用户拒绝作答 → ASK_DENIED；关闭面板） */
  function cancel(): void {
    const resolve = state.value.resolve
    state.value = emptyState()
    resolve?.(null)
  }

  /**
   * kernel 侧已解决（族事件 `InteractionResolved`，如随轮取消 / 超时）→ 关闭对应面板。
   * 按 askId 匹配才关闭（避免误关后到的新请求）；本地按「拒绝」收口，
   * 调用方回传对已解决 ask_id 返回 false（幂等无害）。
   */
  function dismiss(askId: string): void {
    if (!state.value.show || state.value.askId !== askId) return
    cancel()
  }

  return {
    state,
    ask,
    chooseOption,
    toggleOption,
    setCustom,
    toggleCustom,
    skip,
    advance,
    prev,
    submit,
    cancel,
    dismiss,
    currentQuestion,
    currentDraft,
  }
}