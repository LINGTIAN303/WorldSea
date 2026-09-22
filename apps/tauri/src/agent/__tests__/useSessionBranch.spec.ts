/**
 * useSessionBranch（UX-a）单测
 *
 * 覆盖：命令名 / 参数口径（与 Rust 命令面逐字对齐）· 事件三型分派 · 监听幂等与清理 ·
 * 消息行 → 边界匹配（截断对齐 / 重复消歧 / 匹配不到必须 null——绝不猜锚点）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
const listenMock = vi.fn()

vi.mock('@/agent/composables/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  listen: (...args: unknown[]) => listenMock(...args),
}))

import {
  matchBoundaryForTurn,
  USER_TEXT_PREVIEW_CHARS,
  loadBoundaries,
  loadCheckpoints,
  forkAt,
  rewindAt,
  createCheckpoint,
  setupBranchListener,
  teardownBranchListener,
  type RequestBoundaryDto,
  type SessionBranchEvent,
} from '@/agent/composables/useSessionBranch'

function boundary(over: Partial<RequestBoundaryDto> = {}): RequestBoundaryDto {
  return {
    requestSeq: 0,
    capturedAtMs: 1000,
    purpose: 'main',
    modelId: 'm',
    userText: '你好',
    checkpointId: null,
    checkpointKind: null,
    ...over,
  }
}

beforeEach(() => {
  invokeMock.mockReset()
  listenMock.mockReset()
})

describe('matchBoundaryForTurn', () => {
  it('精确匹配返回对应边界', () => {
    const list = [boundary({ requestSeq: 2, userText: '第二问' }), boundary({ requestSeq: 1, userText: '第一问' })]
    expect(matchBoundaryForTurn(list, '第一问')?.requestSeq).toBe(1)
  })

  it('超长文本按 120 字符截断对齐（Rust 侧同口径）', () => {
    const long = '长'.repeat(300)
    const truncated = '长'.repeat(USER_TEXT_PREVIEW_CHARS)
    expect(matchBoundaryForTurn([boundary({ userText: truncated })], long)?.userText).toBe(truncated)
  })

  it('重复文本按时间就近消歧', () => {
    const list = [
      boundary({ requestSeq: 5, userText: '重复问题', capturedAtMs: 5000 }),
      boundary({ requestSeq: 9, userText: '重复问题', capturedAtMs: 9000 }),
    ]
    expect(matchBoundaryForTurn(list, '重复问题', 8800)?.requestSeq).toBe(9)
    expect(matchBoundaryForTurn(list, '重复问题', 5200)?.requestSeq).toBe(5)
  })

  it('匹配不到必须返回 null（绝不猜锚点）', () => {
    expect(matchBoundaryForTurn([], '任意')).toBeNull()
    expect(matchBoundaryForTurn([boundary({ userText: null })], '任意')).toBeNull()
    expect(matchBoundaryForTurn([boundary({ userText: '甲' })], '乙')).toBeNull()
    expect(matchBoundaryForTurn([boundary()], '   ')).toBeNull()
  })

  it('emoji 代理对安全（按字符而非 UTF-16 单元截断）', () => {
    const text = '🎈'.repeat(200)
    const truncated = '🎈'.repeat(USER_TEXT_PREVIEW_CHARS)
    expect(Array.from(truncated).length).toBe(USER_TEXT_PREVIEW_CHARS)
    expect(matchBoundaryForTurn([boundary({ userText: truncated })], text)?.userText).toBe(truncated)
  })
})

describe('命令面（命令名与参数与 Rust 逐字对齐）', () => {
  it('forkAt → fork_session{sessionId, requestSeq}', async () => {
    invokeMock.mockResolvedValue({ id: 'child-1', title: '子会话' })
    const info = await forkAt('s1', 3)
    expect(invokeMock).toHaveBeenCalledWith('fork_session', { sessionId: 's1', requestSeq: 3 })
    expect(info.id).toBe('child-1')
  })

  it('rewindAt → rewind_session{sessionId, requestSeq}', async () => {
    invokeMock.mockResolvedValue(undefined)
    await rewindAt('s1', 4)
    expect(invokeMock).toHaveBeenCalledWith('rewind_session', { sessionId: 's1', requestSeq: 4 })
  })

  it('createCheckpoint → create_checkpoint{sessionId}', async () => {
    invokeMock.mockResolvedValue('cp-1')
    expect(await createCheckpoint('s1')).toBe('cp-1')
    expect(invokeMock).toHaveBeenCalledWith('create_checkpoint', { sessionId: 's1' })
  })

  it('loadBoundaries/loadCheckpoints 写入共享状态且容忍非数组返回', async () => {
    invokeMock.mockResolvedValueOnce([boundary({ requestSeq: 7 })])
    const list = await loadBoundaries('s1', 0)
    expect(invokeMock).toHaveBeenCalledWith('list_request_boundaries', { sessionId: 's1', limit: 0 })
    expect(list).toHaveLength(1)

    invokeMock.mockResolvedValueOnce(null)
    expect(await loadCheckpoints('s1', 0)).toEqual([])
    expect(invokeMock).toHaveBeenCalledWith('list_checkpoints', { sessionId: 's1', limit: 0 })
  })
})

describe('分支事件监听', () => {
  type Captured = { name: string; cb: (e: { event: string; payload: SessionBranchEvent }) => void }

  async function setupWithCapture(sessionId: string, hooks: Parameters<typeof setupBranchListener>[1]) {
    let captured: Captured | null = null
    const unlisten = vi.fn()
    listenMock.mockImplementation(async (name: string, cb: Captured['cb']) => {
      captured = { name, cb }
      return unlisten
    })
    await setupBranchListener(sessionId, hooks)
    return { captured: () => captured, unlisten }
  }

  it('事件三型分派到对应 hooks', async () => {
    const onForked = vi.fn()
    const onRewound = vi.fn()
    const onCheckpointCreated = vi.fn()
    const { captured } = await setupWithCapture('s1', { onForked, onRewound, onCheckpointCreated })
    const ev = captured()
    if (!ev) throw new Error('未捕获监听器')
    expect(ev.name).toBe('agent:event:session_branch:s1')

    ev.cb({ event: ev.name, payload: { type: 'forked', sessionId: 's1', childSessionId: 'c1', requestSeq: 2 } })
    ev.cb({ event: ev.name, payload: { type: 'rewound', sessionId: 's1', requestSeq: 1, dropped: 3, kept: 2 } })
    ev.cb({ event: ev.name, payload: { type: 'checkpoint_created', sessionId: 's1', requestSeq: 1, kind: 'manual' } })

    expect(onForked).toHaveBeenCalledWith('c1', 2)
    expect(onRewound).toHaveBeenCalledWith(1, 3, 2)
    expect(onCheckpointCreated).toHaveBeenCalledWith(1, 'manual')
  })

  it('监听幂等（重复 setup 只注册一次）与 teardown 清理', async () => {
    listenMock.mockImplementation(async () => vi.fn())
    await setupBranchListener('s2', {})
    await setupBranchListener('s2', {})
    expect(listenMock).toHaveBeenCalledTimes(1)
    teardownBranchListener('s2')
    // 清理后可重新注册（前一次 unlisten 已调用）
    await setupBranchListener('s2', {})
    expect(listenMock).toHaveBeenCalledTimes(2)
    teardownBranchListener('s2')
  })

  it('未知 type 不触发任何 hook（前向兼容）', async () => {
    const onForked = vi.fn()
    const { captured } = await setupWithCapture('s3', { onForked })
    const ev = captured()
    if (!ev) throw new Error('未捕获监听器')
    ev.cb({ event: ev.name, payload: { type: 'future_kind' } as unknown as SessionBranchEvent })
    expect(onForked).not.toHaveBeenCalled()
  })
})
